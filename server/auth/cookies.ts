import type { CookieOptions, Response } from "express";
import { AUTH_COOKIE_NAME } from "../config.ts";

export function getCookieOptions(isProduction: boolean): CookieOptions {
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    path: "/",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  };
}

export function setAuthCookie(res: Response, token: string, isProduction: boolean): void {
  res.cookie(AUTH_COOKIE_NAME, token, getCookieOptions(isProduction));
}

export function clearAuthCookie(res: Response, isProduction: boolean): void {
  res.clearCookie(AUTH_COOKIE_NAME, {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    path: "/",
  });
}
