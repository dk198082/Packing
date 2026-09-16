import app from "./app";
import { closeAzurePool } from "@workspace/db/azure";
import { logger } from "./lib/logger";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});

function shutdown(signal: NodeJS.Signals) {
  logger.info({ signal }, "Shutting down API server");
  server.close(() => {
    void closeAzurePool()
      .catch((error: unknown) => {
        logger.warn(
          {
            errorName:
              error instanceof Error ? error.name : "unknown",
          },
          "Azure pool did not close cleanly",
        );
      })
      .finally(() => process.exit(0));
  });
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
