import 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    molt?: { pubkey: string };
    rawBody?: Buffer;
  }
}
