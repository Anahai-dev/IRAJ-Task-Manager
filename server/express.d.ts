import type { AuthUser } from "./types.ts";

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export {};
