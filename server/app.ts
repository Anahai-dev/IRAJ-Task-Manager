import express, { type Express, type Request, type Response, type NextFunction } from "express";
import path from "path";
import crypto from "crypto";
import helmet from "helmet";
import compression from "compression";
import rateLimit from "express-rate-limit";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import type { AppConfig } from "./config.ts";
import { gitlabOrigin } from "./config.ts";
import { setGitApiConfig, gitApiConfigFromApp } from "./git/runtime-config.ts";
import type { DatabaseWrapper } from "./types.ts";
import { createSecretCipher } from "./auth/crypto.ts";
import { createAuthenticateToken } from "./auth/middleware.ts";
import { setRuntime } from "./runtime.ts";
import { errorHandler } from "./middleware/asyncHandler.ts";
import { healthRouter } from "./routes/health.ts";
import { authRouter } from "./routes/auth.ts";
import { backupRouter } from "./routes/backup.ts";
import { documentsRouter } from "./routes/documents.ts";
import { milestonesRouter } from "./routes/milestones.ts";
import { usersRouter } from "./routes/users.ts";
import { tasksRouter } from "./routes/tasks.ts";
import { projectsRouter } from "./routes/projects.ts";
import { teamsRouter } from "./routes/teams.ts";
import "./express.d.ts";

export interface CreateAppOptions {
  config: AppConfig;
  getDb: () => Promise<DatabaseWrapper>;
  /** Skip Vite / static SPA hosting (used in tests). */
  serveFrontend?: boolean;
}

export async function createApp(options: CreateAppOptions): Promise<Express> {
  const { config, getDb } = options;
  const serveFrontend = options.serveFrontend !== false;
  const { encryptSecret, decryptSecretOrEmpty } = createSecretCipher(config.security.tokenEncryptionKey);

  setGitApiConfig(gitApiConfigFromApp(config));

  const app = express();
  app.set("trust proxy", config.http.trustProxy);

  const authenticateToken = createAuthenticateToken({ getDb, config });
  setRuntime({
    getDb,
    config,
    encryptSecret,
    decryptSecret: decryptSecretOrEmpty,
    authenticateToken,
  });

  app.use(morgan(config.logging.morganFormat));

  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.locals.cspNonce = crypto.randomBytes(config.security.cspNonceBytes).toString("base64");
    next();
  });

  const gitlabOriginUrl = gitlabOrigin(config.oauth.gitlabUrl);

  const cspImgSrc = [
    "'self'",
    "data:",
    "blob:",
    "https://*.githubusercontent.com",
    "https://*.googleusercontent.com",
    "https://gitlab.com",
    "https://*.gitlab.com",
    "https://secure.gravatar.com",
  ];
  if (gitlabOriginUrl && !cspImgSrc.includes(gitlabOriginUrl)) {
    cspImgSrc.push(gitlabOriginUrl);
  }

  const cspConnectSrc = [
    "'self'",
    "https://github.com",
    "https://api.github.com",
    "https://gitlab.com",
    "https://*.gitlab.com",
    "https://www.googleapis.com",
    "https://*.googleapis.com",
  ];
  if (gitlabOriginUrl && !cspConnectSrc.includes(gitlabOriginUrl)) {
    cspConnectSrc.push(gitlabOriginUrl);
  }

  app.use(
    helmet({
      contentSecurityPolicy:
        config.isProduction && config.security.cspEnabledInProduction
          ? {
              directives: {
                defaultSrc: ["'self'"],
                scriptSrc: ["'self'", (_req: Request, res: Response) => `'nonce-${res.locals.cspNonce}'`],
                styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
                fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
                imgSrc: cspImgSrc,
                connectSrc: cspConnectSrc,
                frameSrc: ["'self'"],
              },
            }
          : false,
      crossOriginEmbedderPolicy: config.security.crossOriginEmbedderPolicy,
    })
  );

  app.use(compression());

  const apiLimiter = rateLimit({
    windowMs: config.rateLimit.api.windowMs,
    max: config.rateLimit.api.max,
    standardHeaders: true,
    legacyHeaders: false,
    validate: { xForwardedForHeader: false },
    message: { error: config.rateLimit.api.message },
  });
  app.use("/api/", apiLimiter);

  const authLimiter = rateLimit({
    windowMs: config.rateLimit.auth.windowMs,
    max: config.rateLimit.auth.max,
    validate: { xForwardedForHeader: false },
    message: { error: config.rateLimit.auth.message },
  });
  app.use("/api/auth/", (req, res, next) => {
    const skip = config.rateLimit.auth.excludedPathSuffixes.some(
      (suffix) => req.path === suffix || req.path.endsWith(suffix)
    );
    if (skip) {
      next();
      return;
    }
    authLimiter(req, res, next);
  });

  app.use(express.json({ limit: config.http.jsonBodyLimit }));
  app.use(cookieParser());

  app.use("/api/health", healthRouter());
  app.use("/api/auth", authRouter());
  app.use("/api/backup", backupRouter());
  app.use("/api", documentsRouter());
  app.use("/api", milestonesRouter());
  app.use(usersRouter());
  app.use(tasksRouter());
  app.use(projectsRouter());
  app.use(teamsRouter());

  if (serveFrontend) {
    if (!config.isProduction) {
      const { createServer: createViteServer } = await import("vite");
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.use(vite.middlewares);
    } else {
      const distPath = path.join(process.cwd(), "dist");
      app.use(express.static(distPath));
      app.get("*", (req, res) => {
        res.sendFile(path.join(distPath, "index.html"));
      });
    }
  }

  app.use(errorHandler);

  return app;
}
