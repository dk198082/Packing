import path from "node:path";
import fs from "node:fs";
import express, { type Express } from "express";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { sessionMiddleware } from "./lib/session";


const app: Express = express();
app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(sessionMiddleware);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

// --- AZURE DEPLOYMENT ---------------------------------------------------
// Optional single-service mode: if STATIC_DIR points at the built frontend
// (artifacts/packing-control-board/dist/public), this API server also
// serves it, so the whole app runs as ONE Azure App Service / Container
// Apps instance on ONE origin. That keeps the session cookie same-site/
// same-origin and avoids needing a second Azure resource. Unset in local
// dev (the Vite dev server serves the frontend on its own port instead)
// and set by ./Dockerfile / AZURE_DEPLOYMENT.md in production.
const staticDir = process.env.STATIC_DIR;
if (staticDir) {
  const resolvedStaticDir = path.resolve(staticDir);
  if (!fs.existsSync(path.join(resolvedStaticDir, "index.html"))) {
    throw new Error(
      `STATIC_DIR is set to "${resolvedStaticDir}" but no index.html was found there. ` +
        "Build the frontend first (see AZURE_DEPLOYMENT.md).",
    );
  }
  app.use(express.static(resolvedStaticDir));
  // SPA fallback: any non-API, non-file GET request returns index.html so
  // client-side routing can handle the path. Registered after "/api" so API
  // routes/404s above are never shadowed by this. Express 5 still supports
  // regex routes (unlike the removed string wildcard "*" syntax), so this
  // pattern is safe on the Express 5 this app uses.
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    res.sendFile(path.join(resolvedStaticDir, "index.html"));
  });
}

export default app;
