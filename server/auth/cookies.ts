import type { CookieOptions, Response } from "express";
import type { CookieConfig } from "../config.ts";

export function getCookieOptions(cookie: CookieConfig): CookieOptions {
  return {
    httpOnly: cookie.httpOnly,
    secure: cookie.secure,
    sameSite: cookie.sameSite,
    path: cookie.path,
    maxAge: cookie.maxAgeMs,
  };
}

export function setAuthCookie(res: Response, token: string, cookie: CookieConfig): void {
  res.cookie(cookie.name, token, getCookieOptions(cookie));
}

export function clearAuthCookie(res: Response, cookie: CookieConfig): void {
  res.clearCookie(cookie.name, {
    httpOnly: cookie.httpOnly,
    secure: cookie.secure,
    sameSite: cookie.sameSite,
    path: cookie.path,
  });
}
