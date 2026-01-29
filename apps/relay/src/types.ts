import type { Kysely } from 'kysely';
import type { Database } from './db.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: Kysely<Database>;
  }

  interface FastifyRequest {
    rawBody?: Buffer;
    auth?: {
      pubkey: string;
    };
  }
}
