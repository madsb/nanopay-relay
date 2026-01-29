import "fastify";
import type { Kysely } from "kysely";
import type { Database } from "./db/types.js";
import type { SellerPresence } from "./ws.js";

declare module "fastify" {
  interface FastifyInstance {
    db: Kysely<Database>;
    sellerPresence: SellerPresence;
  }

  interface FastifyRequest {
    rawBody?: Buffer;
    auth?: {
      pubkey: string;
    };
  }
}
