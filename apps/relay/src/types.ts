import type { Kysely } from 'kysely';
import type { Database } from './db.js';

type Metrics = {
  counters: Record<string, number>;
  inc: (name: string, labels?: Record<string, string>) => void;
  snapshot: () => { counters: Record<string, number> };
};

declare module 'fastify' {
  interface FastifyInstance {
    db: Kysely<Database>;
    metrics: Metrics;
  }

  interface FastifyRequest {
    rawBody?: Buffer;
    auth?: {
      pubkey: string;
    };
    idempotency?: {
      key: string;
      requestHash: string;
      pubkey: string;
    };
  }
}
