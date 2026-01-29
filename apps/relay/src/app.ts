import Fastify from "fastify";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { config } from "./config.js";
import { createDb } from "./db/index.js";
import { LIMITS } from "./constants.js";
import { errorResponse, toErrorResponse } from "./errors.js";
import { registerOfferRoutes } from "./routes/offers.js";
import { registerJobRoutes } from "./routes/jobs.js";

export const createApp = async (options?: { databaseUrl?: string }) => {
  const app = Fastify({
    logger: true,
    bodyLimit: LIMITS.bodyMaxBytes
  });

  const db = createDb(options?.databaseUrl ?? config.databaseUrl);
  app.decorate("db", db);
  app.addHook("onClose", async () => {
    await db.destroy();
  });

  app.addContentTypeParser(
    "application/json",
    { parseAs: "buffer" },
    (request, body, done) => {
      const buf = body as Buffer;
      request.rawBody = buf;
      if (buf.length === 0) {
        done(null, null);
        return;
      }
      try {
        const parsed = JSON.parse(buf.toString("utf8"));
        done(null, parsed);
      } catch (err) {
        done(err as Error);
      }
    }
  );

  await app.register(swagger, {
    openapi: {
      info: {
        title: "NanoPay Relay",
        version: "0.2.0"
      }
    }
  });

  await app.register(swaggerUi, {
    routePrefix: "/docs",
    staticCSP: true
  });

  app.setErrorHandler((err, _request, reply) => {
    const handled = toErrorResponse(err);
    if (handled) {
      reply
        .code(handled.statusCode)
        .send(errorResponse(handled.code, handled.message, handled.details));
      return;
    }

    const code = (err as { code?: string }).code;
    if (code === "FST_ERR_CTP_BODY_TOO_LARGE") {
      reply
        .code(413)
        .send(errorResponse("payload_too_large", "Request body too large"));
      return;
    }

    if (code === "FST_ERR_CTP_INVALID_JSON_BODY") {
      reply
        .code(400)
        .send(errorResponse("validation_error", "Invalid JSON body"));
      return;
    }

    app.log.error(err);
    reply
      .code(500)
      .send(errorResponse("internal_error", "Internal server error"));
  });

  app.get(
    "/health",
    {
      schema: {
        response: {
          200: {
            type: "object",
            properties: {
              ok: { type: "boolean" }
            },
            required: ["ok"]
          }
        }
      }
    },
    async () => ({ ok: true })
  );

  app.get("/", async () => ({ name: "nanopay-relay", docs: "/docs" }));

  await registerOfferRoutes(app);
  await registerJobRoutes(app);

  return app;
};
