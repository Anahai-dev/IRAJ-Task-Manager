import crypto from "crypto";
import type { DatabaseWrapper } from "../types.ts";
import { getAppUrl, type AppConfig } from "../config.ts";

export class OAuthSignupDisabledError extends Error {
  constructor(message = "No account exists for this email. Ask an administrator to provision an account before signing in with OAuth.") {
    super(message);
    this.name = "OAuthSignupDisabledError";
  }
}

export class OAuthProviderMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OAuthProviderMismatchError";
  }
}

export class OAuthAccountDisabledError extends Error {
  constructor(message = "Account is inactive or disabled. Contact administrator.") {
    super(message);
    this.name = "OAuthAccountDisabledError";
  }
}

function timingSafeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function createSignedOAuthState(provider: string, redirectUri: string, secretKey: string): string {
  const nonce = crypto.randomBytes(16).toString("hex");
  const timestamp = Date.now().toString();
  const payload = `${provider}:${redirectUri}:${nonce}:${timestamp}`;
  const sig = crypto.createHmac("sha256", secretKey).update(payload).digest("hex");
  return Buffer.from(JSON.stringify({ provider, redirectUri, nonce, timestamp, sig })).toString("base64url");
}

export function getSafeOAuthRedirectUri(
  req: { query: Record<string, unknown>; protocol?: string; headers: Record<string, unknown> },
  provider: string,
  config: AppConfig
): string {
  const defaultBase = getAppUrl(req, config);
  let base = defaultBase;
  if (req.query.origin && typeof req.query.origin === "string") {
    try {
      const parsedOrigin = new URL(req.query.origin);
      const parsedHost = new URL(defaultBase);
      if (
        parsedOrigin.hostname === parsedHost.hostname ||
        (!config.isProduction && (parsedOrigin.hostname === "localhost" || parsedOrigin.hostname === "127.0.0.1"))
      ) {
        base = parsedOrigin.origin;
      }
    } catch {
      base = defaultBase;
    }
  }
  return `${base}/api/auth/${provider}/callback`;
}

export function getValidatedCallbackRedirect(
  req: { protocol?: string; headers: Record<string, unknown> },
  provider: string,
  state: unknown,
  config: AppConfig
): string {
  const defaultRedirect = `${getAppUrl(req, config)}/api/auth/${provider}/callback`;
  if (state && typeof state === "string") {
    try {
      const parsed = new URL(state);
      const host = new URL(defaultRedirect);
      if (
        (parsed.hostname === host.hostname ||
          (!config.isProduction && (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1"))) &&
        (parsed.pathname === `/api/auth/${provider}/callback` || parsed.pathname === `/api/auth/${provider}/callback/`)
      ) {
        return state;
      }
    } catch {
      // fall through
    }
  }
  return defaultRedirect;
}

export async function verifyOAuthState(
  db: DatabaseWrapper,
  req: { protocol?: string; headers: Record<string, unknown> },
  provider: string,
  state: unknown,
  secretKey: string,
  config: AppConfig
): Promise<string> {
  if (!state || typeof state !== "string") {
    throw new Error("Missing or invalid OAuth state parameter (CSRF verification failed).");
  }
  try {
    const raw = Buffer.from(state, "base64url").toString("utf8");
    const parsed = JSON.parse(raw) as {
      provider?: string;
      sig?: string;
      timestamp?: string;
      redirectUri?: string;
      nonce?: string;
    };
    if (!parsed || parsed.provider !== provider || !parsed.sig || !parsed.timestamp || !parsed.redirectUri || !parsed.nonce) {
      throw new Error("Malformed OAuth state parameter.");
    }
    if (Date.now() - parseInt(parsed.timestamp, 10) > config.oauth.stateTtlMs) {
      throw new Error("OAuth state parameter has expired. Please try signing in again.");
    }
    const existingNonce = await db.get("SELECT nonce FROM oauth_nonces WHERE nonce = ?", parsed.nonce);
    if (existingNonce) {
      throw new Error("OAuth state parameter has already been used. Please try signing in again.");
    }
    const payload = `${parsed.provider}:${parsed.redirectUri}:${parsed.nonce}:${parsed.timestamp}`;
    const expectedSig = crypto.createHmac("sha256", secretKey).update(payload).digest("hex");
    if (!timingSafeEqualHex(parsed.sig, expectedSig)) {
      throw new Error("OAuth state signature verification failed.");
    }
    await db.run("INSERT INTO oauth_nonces (nonce, timestamp) VALUES (?, ?)", [parsed.nonce, Date.now()]);
    return getValidatedCallbackRedirect(req, provider, parsed.redirectUri, config);
  } catch (e: unknown) {
    const message = String((e as { message?: string })?.message || "");
    if (message.includes("OAuth")) throw e;
    throw new Error("OAuth state verification failed. Authentication aborted for security.");
  }
}

export function emailDomainAllowed(email: string, allowedDomains: string[]): boolean {
  if (allowedDomains.length === 0) return true;
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) return false;
  return allowedDomains.includes(domain);
}

export interface OAuthProfile {
  email: string;
  name: string;
  provider: "google" | "github" | "gitlab";
}

export interface ResolveOAuthUserOptions {
  autoProvision: boolean;
  allowedDomains: string[];
  bcryptRounds: number;
}

/**
 * Existing users may log in. New OAuth identities are not inserted unless auto-provision is enabled.
 */
export async function resolveOAuthUser(
  db: DatabaseWrapper,
  profile: OAuthProfile,
  options: ResolveOAuthUserOptions
): Promise<{ id: string; name: string; email: string; role: string; tokenVersion: number; status?: string }> {
  const email = profile.email.toLowerCase().trim();
  const user = await db.get<Record<string, unknown>>("SELECT * FROM users WHERE email = ?", email);

  if (!user) {
    if (!options.autoProvision) {
      throw new OAuthSignupDisabledError();
    }
    if (!emailDomainAllowed(email, options.allowedDomains)) {
      throw new OAuthSignupDisabledError("OAuth signup is not allowed for this email domain.");
    }
    const { v4: uuidv4 } = await import("uuid");
    const id = uuidv4();
    const role = "developer";
    const randomPassword = crypto.randomBytes(32).toString("hex");
    const { hashPassword } = await import("./passwords.ts");
    const hash = await hashPassword(randomPassword, options.bcryptRounds);
    await db.run(
      "INSERT INTO users (id, name, email, passwordHash, role, tokenVersion, authProvider, emailVerified, status) VALUES (?, ?, ?, ?, ?, 1, ?, 1, 'Available')",
      [id, profile.name, email, hash, role, profile.provider]
    );
    const created = await db.get<Record<string, unknown>>(
      "SELECT id, name, email, role, status, tokenVersion FROM users WHERE id = ?",
      id
    );
    if (!created) throw new Error("Failed to create OAuth user");
    return {
      id: String(created.id),
      name: String(created.name),
      email: String(created.email),
      role: String(created.role),
      tokenVersion: Number(created.tokenVersion || 1),
      status: created.status ? String(created.status) : undefined,
    };
  }

  const status = user.status ? String(user.status) : "";
  if (status && ["inactive", "disabled", "suspended"].includes(status.toLowerCase())) {
    throw new OAuthAccountDisabledError();
  }
  const authProvider = String(user.authProvider || "local");
  if (authProvider === "local") {
    throw new OAuthProviderMismatchError(
      "An account with this email already exists with password authentication. Please sign in with your email and password."
    );
  }
  if (authProvider !== profile.provider) {
    throw new OAuthProviderMismatchError(
      `An account with this email already exists registered via ${authProvider}. Please sign in using ${authProvider}.`
    );
  }

  return {
    id: String(user.id),
    name: String(user.name),
    email: String(user.email),
    role: String(user.role),
    tokenVersion: Number(user.tokenVersion || 1),
    status: status || undefined,
  };
}
