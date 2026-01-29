import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { HttpError, errorResponse } from "../errors.js";
import { LIMITS } from "../constants.js";
import { ensureTagLimits, parseLimit, parseOffset, boolFromQuery } from "../utils.js";
import { requireAuth } from "../auth.js";
import { sql } from "kysely";

const offerInputSchema = z
  .object({
    title: z.string().min(1).max(LIMITS.titleMax),
    description: z.string().min(1).max(LIMITS.descriptionMax),
    tags: z.array(z.string()).default([]),
    pricing_mode: z.enum(["fixed", "quote"]),
    fixed_price_raw: z.string().max(LIMITS.priceMax).nullable().optional(),
    active: z.boolean().optional()
  })
  .superRefine((val, ctx) => {
    if (val.pricing_mode === "fixed") {
      if (!val.fixed_price_raw) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "fixed_price_raw is required for fixed pricing"
        });
      }
    }
    if (val.pricing_mode === "quote" && val.fixed_price_raw != null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "fixed_price_raw must be null for quote pricing"
      });
    }
  });

const offersQuerySchema = z.object({
  q: z.string().optional(),
  tags: z.string().optional(),
  seller_pubkey: z.string().optional(),
  pricing_mode: z.enum(["fixed", "quote"]).optional(),
  active: z.string().optional(),
  limit: z.string().optional(),
  offset: z.string().optional(),
  online_only: z.string().optional()
});

const serializeOffer = (offer: Record<string, unknown>) => ({
  ...offer,
  created_at:
    offer.created_at instanceof Date
      ? offer.created_at.toISOString()
      : offer.created_at
});

export const registerOfferRoutes = async (app: FastifyInstance) => {
  app.post(
    "/v1/offers",
    {
      preHandler: requireAuth
    },
    async (request, reply) => {
      if (!request.auth) return;
      const body = offerInputSchema.parse(request.body ?? {});
      const tags = body.tags ?? [];
      ensureTagLimits(tags);

      const active = body.active ?? true;
      const pricingMode = body.pricing_mode;
      const fixedPrice = body.fixed_price_raw ?? null;

      const inserted = await request.server.db
        .insertInto("offers")
        .values({
          seller_pubkey: request.auth.pubkey,
          title: body.title,
          description: body.description,
          tags,
          pricing_mode: pricingMode,
          fixed_price_raw: fixedPrice,
          active
        })
        .returningAll()
        .executeTakeFirst();

      if (!inserted) {
        throw new HttpError(500, "internal_error", "Failed to create offer");
      }

      reply.code(201).send({ offer: serializeOffer(inserted) });
    }
  );

  app.get("/v1/offers", async (request, reply) => {
    const query = offersQuerySchema.parse(request.query ?? {});
    const tags = query.tags
      ? query.tags
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean)
      : [];

    if (tags.length > 0) {
      ensureTagLimits(tags);
    }

    const active = boolFromQuery(query.active ?? "true");
    const limit = parseLimit(query.limit, 20, 100);
    const offset = parseOffset(query.offset, 0);
    const onlineOnly = boolFromQuery(query.online_only);

    if (query.active && active === undefined) {
      reply
        .code(400)
        .send(errorResponse("validation_error", "Invalid active flag"));
      return;
    }

    if (query.online_only && onlineOnly === undefined) {
      reply
        .code(400)
        .send(errorResponse("validation_error", "Invalid online_only flag"));
      return;
    }

    let filtered = request.server.db.selectFrom("offers");

    if (active !== undefined) {
      filtered = filtered.where("active", "=", active);
    }

    if (query.seller_pubkey) {
      filtered = filtered.where("seller_pubkey", "=", query.seller_pubkey);
    }

    if (query.pricing_mode) {
      filtered = filtered.where("pricing_mode", "=", query.pricing_mode);
    }

    if (query.q) {
      const like = `%${query.q}%`;
      filtered = filtered.where((eb) =>
        eb.or([
          eb("title", "ilike", like),
          eb("description", "ilike", like)
        ])
      );
    }

    if (tags.length > 0) {
      filtered = filtered.where(
        sql`tags @> ${sql.array(tags, "text")}`
      );
    }

    if (onlineOnly) {
      const onlineSellers = request.server.sellerPresence.listOnline();
      if (onlineSellers.length === 0) {
        reply.send({ offers: [], limit, offset, total: 0 });
        return;
      }
      filtered = filtered.where("seller_pubkey", "in", onlineSellers);
    }

    const [rows, countResult] = await Promise.all([
      filtered
        .selectAll()
        .orderBy("created_at", "desc")
        .limit(limit)
        .offset(offset)
        .execute(),
      filtered
        .select(sql<number>`count(*)`.as("count"))
        .executeTakeFirst()
    ]);

    const total = Number(countResult?.count ?? 0);

    reply.send({
      offers: rows.map((offer) => serializeOffer(offer as Record<string, unknown>)),
      limit,
      offset,
      total
    });
  });

};
