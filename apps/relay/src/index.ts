import Fastify from "fastify";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { config } from "./config.js";

const app = Fastify({ logger: true });

await app.register(swagger, {
  openapi: {
    info: {
      title: "NanoPay Relay",
      version: "0.1.0"
    }
  }
});

await app.register(swaggerUi, {
  routePrefix: "/docs",
  staticCSP: true
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

const start = async () => {
  try {
    await app.listen({
      port: config.port,
      host: "0.0.0.0"
    });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
