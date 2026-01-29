import fastify from 'fastify';
import websocket from '@fastify/websocket';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { WebSocket } from 'ws';
import { createDb } from './db';
import { createAuthGuard } from './auth';
import { registerOfferRoutes } from './routes/offers';
import { registerJobRoutes } from './routes/jobs';
import { registerSellerWs } from './routes/ws';
import { LIMITS } from './limits';
import { config } from './config';
import { payloadTooLargeError, sendError, validationError } from './http';

export const buildServer = (options?: { db?: ReturnType<typeof createDb>; now?: () => Date }) => {
  const db = options?.db ?? createDb();
  const now = options?.now ?? (() => new Date());

  const app = fastify({
    logger: { level: config.logLevel },
    bodyLimit: LIMITS.bodyMaxBytes
  });

  app.decorate('db', db);

  const sellerSockets = new Map<string, Set<WebSocket>>();
  const notifySeller = (sellerPubkey: string) => {
    const sockets = sellerSockets.get(sellerPubkey);
    if (!sockets) return;
    for (const socket of sockets) {
      if (socket.readyState === 1) {
        socket.send(JSON.stringify({ type: 'hint.new_job' }));
      }
    }
  };

  const authGuard = createAuthGuard(db, now);

  // Capture the raw body bytes so we can hash them for signature verification.
  // We parse JSON ourselves to ensure the exact bytes are available (AUTH.md).
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (request, body: Buffer, done) => {
      request.rawBody = body;
      try {
        const text = body.toString('utf8');
        if (text.length === 0) return done(null, {});
        return done(null, JSON.parse(text));
      } catch {
        return done(Object.assign(new Error('Invalid JSON body'), { code: 'FST_ERR_CTP_INVALID_JSON_BODY' }));
      }
    }
  );

  app.register(websocket);
  app.register(swagger, {
    openapi: {
      info: {
        title: 'NanoPay Relay v0',
        version: '0.1.0'
      }
    }
  });
  app.register(swaggerUi, {
    routePrefix: '/docs'
  });

  app.get('/health', async () => ({ ok: true }));

  registerOfferRoutes(app, db, authGuard);
  registerJobRoutes(app, db, authGuard, notifySeller);
  registerSellerWs(app, sellerSockets);

  app.addHook('onClose', async () => {
    await db.destroy();
  });

  app.setNotFoundHandler((request, reply) => {
    sendError(reply, 404, 'not_found', `Route ${request.method} ${request.url} not found`, null);
  });

  app.setErrorHandler((error, request, reply) => {
    if ((error as { code?: string }).code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
      return payloadTooLargeError(reply, 'Request body too large');
    }
    if ((error as { code?: string }).code === 'FST_ERR_CTP_INVALID_JSON_BODY') {
      return validationError(reply, 'Invalid JSON body');
    }

    request.log.error(error);
    return sendError(reply, 500, 'internal_error', 'Internal server error', null);
  });

  return app;
};
