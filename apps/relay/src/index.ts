import Fastify from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';

const server = Fastify({ logger: true });

await server.register(swagger, {
  openapi: {
    info: {
      title: 'NanoPay Relay',
      version: '0.0.0'
    }
  }
});

await server.register(swaggerUi, {
  routePrefix: '/docs'
});

server.get(
  '/health',
  {
    schema: {
      response: {
        200: {
          type: 'object',
          properties: {
            ok: { type: 'boolean' }
          },
          required: ['ok']
        }
      }
    }
  },
  async () => ({ ok: true })
);

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '0.0.0.0';

try {
  await server.listen({ port, host });
} catch (err) {
  server.log.error(err);
  process.exit(1);
}
