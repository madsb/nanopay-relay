import { config } from "./config.js";
import { createApp } from "./app.js";

const start = async () => {
  const app = await createApp();
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
