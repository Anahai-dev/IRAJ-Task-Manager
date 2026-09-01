import crypto from "crypto";
import path from "path";

export const PLACEHOLDER_DATABASE_URL = "postgres://user:password@localhost:5432/dbname";
export const AUTH_COOKIE_NAME = "auth_token";

export interface AppConfig {
  isProduction: boolean;
  port: number;
  host: string;
  secretKey: string;
  tokenEncryptionKey: string;
  appUrl: string | undefined;
  allowPublicRegister: boolean;
  oauthAutoProvision: boolean;
  oauthAllowedDomains: string[];
  sqlitePath: string;
}

export function isConfiguredPostgresUrl(raw: string | undefined | null): boolean {
  if (!raw) return false;
  const trimmed = raw.trim();
  if (!trimmed || trimmed === PLACEHOLDER_DATABASE_URL) return false;
  return /^(postgres|postgresql):\/\//i.test(trimmed);
}

function envFlag(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return defaultValue;
  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  throw new Error(`${name} must be a boolean (true/false), got ${JSON.stringify(raw)}`);
}

function parseDomainList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const isProduction = env.NODE_ENV === "production";
  const port = env.PORT ? parseInt(env.PORT, 10) : 3000;
  if (Number.isNaN(port)) {
    throw new Error("PORT must be a number");
  }
  const host = env.HOST || "0.0.0.0";

  if (isProduction) {
    if (!env.SECRET_KEY || env.SECRET_KEY === "your-super-secret-key-change-this") {
      throw new Error(
        "FATAL: SECRET_KEY environment variable MUST be explicitly set to a secure secret in production mode."
      );
    }
    if (!env.TOKEN_ENCRYPTION_KEY || env.TOKEN_ENCRYPTION_KEY === env.SECRET_KEY) {
      throw new Error(
        "FATAL: TOKEN_ENCRYPTION_KEY must be set in production and must be distinct from SECRET_KEY."
      );
    }
    const appUrl = env.APP_URL ? env.APP_URL.trim() : "";
    if (!appUrl || appUrl === "MY_APP_URL" || !/^https?:\/\/[a-zA-Z0-9.-]+/i.test(appUrl)) {
      throw new Error(
        "FATAL: APP_URL environment variable MUST be explicitly set to a valid URL starting with http:// or https:// in production mode."
      );
    }
    return {
      isProduction,
      port,
      host,
      secretKey: env.SECRET_KEY,
      tokenEncryptionKey: env.TOKEN_ENCRYPTION_KEY,
      appUrl,
      allowPublicRegister: envFlag("ALLOW_PUBLIC_REGISTER", false),
      oauthAutoProvision: envFlag("OAUTH_AUTO_PROVISION", false),
      oauthAllowedDomains: parseDomainList(env.OAUTH_ALLOWED_DOMAINS),
      sqlitePath: env.SQLITE_PATH || path.join(process.cwd(), "database.sqlite"),
    };
  }

  let secretKey = env.SECRET_KEY;
  if (!secretKey) {
    secretKey = crypto.randomBytes(64).toString("hex");
    console.warn(
      "WARNING: SECRET_KEY is not set. Using a dynamically generated secret. Existing sessions will be invalidated if the server restarts."
    );
  }

  const tokenEncryptionKey = env.TOKEN_ENCRYPTION_KEY || secretKey;
  if (!env.TOKEN_ENCRYPTION_KEY) {
    console.warn(
      "WARNING: TOKEN_ENCRYPTION_KEY is not set. Falling back to SECRET_KEY for PAT encryption. Set a distinct key before storing production Git tokens."
    );
  }

  return {
    isProduction,
    port,
    host,
    secretKey,
    tokenEncryptionKey,
    appUrl: env.APP_URL?.trim() || undefined,
    allowPublicRegister: envFlag("ALLOW_PUBLIC_REGISTER", false),
    oauthAutoProvision: envFlag("OAUTH_AUTO_PROVISION", false),
    oauthAllowedDomains: parseDomainList(env.OAUTH_ALLOWED_DOMAINS),
    sqlitePath: env.SQLITE_PATH || path.join(process.cwd(), "database.sqlite"),
  };
}

export function getAppUrl(req: { protocol?: string; headers: Record<string, unknown> }, config: AppConfig): string {
  if (config.appUrl && /^https?:\/\/[a-zA-Z0-9.-]+/i.test(config.appUrl)) {
    return config.appUrl.replace(/\/$/, "");
  }
  if (config.isProduction) {
    const host = process.env.HOST_NAME || "app.internal";
    return `https://${host}`;
  }
  const protoHeader = req.headers["x-forwarded-proto"];
  const protocol = String(protoHeader || req.protocol || "http").split(",")[0].trim();
  const rawHost = String(req.headers["x-forwarded-host"] || req.headers.host || "localhost:3000")
    .split(",")[0]
    .trim();
  const cleanHost = rawHost.replace(/[^a-zA-Z0-9.:-]/g, "");
  return `${protocol}://${cleanHost}`;
}
