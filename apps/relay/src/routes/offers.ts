import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { sql } from 'kysely';
import type { Kysely } from 'kysely';
import type { Database } from '../db';
import { offerCreateSchema } from '../validators';
import { sendError, validationError } from '../http';
import { LIMITS } from '../limits';

const parseBoolean = (value: string | undefined) => {
  if (value === undefined) return undefined;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return undefined;
};

export const registerOfferRoutes = (
  app: FastifyInstance,
  db: Kysely<Database>,
  authGuard: (request: FastifyRequest, reply: FastifyReply) => Promise<void> | void
) => {
  app.post('/offers', { preValidation: authGuard }, async (request, reply) => {
    const parsed = offerCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      return validationError(reply, 'Invalid offer payload', parsed.error.flatten());
    }

    const sellerPubkey = request.molt?.pubkey;
    if (!sellerPubkey) {
      return sendError(reply, 401, 'auth.invalid_signature', 'Missing authentication', null);
    }

    const offer = await db
      .insertInto('offers')
      .values({
        seller_pubkey: sellerPubkey,
        title: parsed.data.title,
        description: parsed.data.description,
        tags: parsed.data.tags,
        pricing_mode: parsed.data.pricing_mode,
        fixed_price_raw: parsed.data.pricing_mode === 'fixed' ? parsed.data.fixed_price_raw ?? null : null,
        active: parsed.data.active ?? true
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    return reply.status(201).send({ offer });
  });

  app.get('/offers', async (request, reply) => {
    const query = request.query as {
      q?: string;
      tags?: string;
      seller_pubkey?: string;
      pricing_mode?: string;
      active?: string;
      limit?: string;
      offset?: string;
    };

    const limit = query.limit ? Number.parseInt(query.limit, 10) : 20;
    const offset = query.offset ? Number.parseInt(query.offset, 10) : 0;

    if (!Number.isFinite(limit) || limit <= 0 || limit > 100) {
      return validationError(reply, 'Invalid limit parameter');
    }
    if (!Number.isFinite(offset) || offset < 0) {
      return validationError(reply, 'Invalid offset parameter');
    }

    const active = parseBoolean(query.active ?? undefined);
    if (query.active !== undefined && active === undefined) {
      return validationError(reply, 'Invalid active parameter');
    }

    const pricingMode = query.pricing_mode;
    if (pricingMode && pricingMode !== 'fixed' && pricingMode !== 'quote') {
      return validationError(reply, 'Invalid pricing_mode parameter');
    }

    const tags = query.tags
      ? query.tags
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean)
      : [];

    if (tags.length > LIMITS.tagsMax || tags.some((tag) => tag.length > LIMITS.tagMax)) {
      return validationError(reply, 'Invalid tags parameter');
    }

    let offersQuery = db.selectFrom('offers');

    if (active !== undefined) {
      offersQuery = offersQuery.where('active', '=', active);
    } else {
      offersQuery = offersQuery.where('active', '=', true);
    }

    if (query.q) {
      const pattern = `%${query.q}%`;
      offersQuery = offersQuery.where((eb) =>
        eb.or([
          eb('title', 'ilike', pattern),
          eb('description', 'ilike', pattern)
        ])
      );
    }

    if (tags.length > 0) {
      offersQuery = offersQuery.where('tags', '@>', tags as any);
    }

    if (query.seller_pubkey) {
      offersQuery = offersQuery.where('seller_pubkey', '=', query.seller_pubkey);
    }

    if (pricingMode) {
      offersQuery = offersQuery.where('pricing_mode', '=', pricingMode as 'fixed' | 'quote');
    }

    const totalRow = await offersQuery.select(sql<number>`count(*)`.as('count')).executeTakeFirst();

    const total = Number(totalRow?.count ?? 0);

    const offers = await offersQuery
      .selectAll()
      .orderBy('created_at', 'desc')
      .limit(limit)
      .offset(offset)
      .execute();

    return reply.send({
      offers,
      limit,
      offset,
      total
    });
  });
};
