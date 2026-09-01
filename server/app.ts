import express, { type Express, type Request, type Response, type NextFunction } from "express";
import path from "path";
import crypto from "crypto";
import helmet from "helmet";
import compression from "compression";
import rateLimit from "express-rate-limit";
import morgan from "morgan";
import cookieParser from "cookie-parser";
import type { AppConfig } from "./config.ts";
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
  const { encryptSecret, decryptSecretOrEmpty } = createSecretCipher(config.tokenEncryptionKey);

  const app = express();
  app.set("trust proxy", 1);

  const authenticateToken = createAuthenticateToken({ getDb, secretKey: config.secretKey });
  setRuntime({
    getDb,
    config,
    encryptSecret,
    decryptSecret: decryptSecretOrEmpty,
    authenticateToken,
  });

  app.use(morgan(config.isProduction ? "combined" : "dev"));

  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.locals.cspNonce = crypto.randomBytes(16).toString("base64");
    next();
  });

  const gitlabOrigin =
    process.env.GITLAB_URL && /^https?:\/\//i.test(process.env.GITLAB_URL)
      ? new URL(process.env.GITLAB_URL).origin
      : null;

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
  if (gitlabOrigin && !cspImgSrc.includes(gitlabOrigin)) {
    cspImgSrc.push(gitlabOrigin);
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
  if (gitlabOrigin && !cspConnectSrc.includes(gitlabOrigin)) {
    cspConnectSrc.push(gitlabOrigin);
  }

  app.use(
    helmet({
      contentSecurityPolicy: config.isProduction
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
      crossOriginEmbedderPolicy: false,
    })
  );

  app.use(compression());

  const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 1000,
    standardHeaders: true,
    legacyHeaders: false,
    validate: { xForwardedForHeader: false },
    message: { error: "Too many requests from this IP, please try again after 15 minutes" },
  });
  app.use("/api/", apiLimiter);

  const authLimiter = rateLimit({
    windowMs: 60 * 1000 * 60,
    max: 50,
    validate: { xForwardedForHeader: false },
    message: { error: "Too many auth attempts from this IP, please try again after an hour" },
  });
  app.use("/api/auth/", (req, res, next) => {
    const skip =
      req.path === "/me" ||
      req.path.endsWith("/callback") ||
      req.path.endsWith("/callback/") ||
      req.path.endsWith("/url");
    if (skip) {
      next();
      return;
    }
    authLimiter(req, res, next);
  });

  app.use(express.json({ limit: "10mb" }));
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
