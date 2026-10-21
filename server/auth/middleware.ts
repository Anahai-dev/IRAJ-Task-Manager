import type { NextFunction, Request, Response } from "express";
import type { AppConfig } from "../config.ts";
import type { AuthUser, DatabaseWrapper } from "../types.ts";
import { verifyAuthToken } from "./jwt.ts";

export function createAuthenticateToken(opts: {
  getDb: () => Promise<DatabaseWrapper>;
  config: Pick<AppConfig, "security" | "auth">;
}) {
  const cookieName = opts.config.auth.cookie.name;

  return (req: Request, res: Response, next: NextFunction): void => {
    const bearer =
      req.headers.authorization && req.headers.authorization.startsWith("Bearer ")
        ? req.headers.authorization.slice(7)
        : null;
    const token = req.cookies?.[cookieName] || bearer;
    if (!token) {
      res.sendStatus(401);
      return;
    }

    let decodedUser: { id: string; tokenVersion?: number } | null = null;
    try {
      decodedUser = verifyAuthToken(token, opts.config.security.secretKey, opts.config.auth.jwt.algorithm);
    } catch {
      res.sendStatus(403);
      return;
    }

    if (!decodedUser) {
      res.sendStatus(403);
      return;
    }

    void (async () => {
      try {
        const db = await opts.getDb();
        const user = await db.get<AuthUser>(
          "SELECT id, name, email, role, rolePrefix, status, tokenVersion, emailVerified FROM users WHERE id = ?",
          decodedUser.id
        );
        if (!user) {
          res.sendStatus(403);
          return;
        }
        if (
          user.status &&
          ["inactive", "disabled", "suspended"].includes(String(user.status).toLowerCase())
        ) {
          res.status(403).json({ error: "Account is inactive or disabled." });
          return;
        }
        if (user.emailVerified === 0 || user.emailVerified === false) {
          res.status(403).json({ error: "Email address is not verified." });
          return;
        }
        const userTokenVersion = user.tokenVersion ?? 1;
        if (decodedUser.tokenVersion === undefined || decodedUser.tokenVersion !== userTokenVersion) {
          res.status(401).json({ error: "Session expired or revoked. Please sign in again." });
          return;
        }
        req.user = user;
        next();
      } catch (e) {
        console.error("Auth DB Error:", e);
        res.sendStatus(500);
      }
    })();
  };
}
