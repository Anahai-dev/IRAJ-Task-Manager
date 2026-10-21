import crypto from "crypto";
import path from "path";

/** Documented non-secret defaults — single source for operator-tunable values. */
export const CONFIG_DEFAULTS = {
  http: {
    host: "0.0.0.0",
    port: 3000,
    trustProxy: 1,
    jsonBodyLimit: "10mb",
    shutdownTimeoutMs: 10_000,
    fallbackHostName: "app.internal",
    defaultDevOrigin: "localhost:3000",
  },
  db: {
    busyTimeoutMs: 5000,
    pgConnectionTimeoutMs: 5000,
    purgeUnverifiedUsersIntervalMs: 60 * 60 * 1000,
    purgeUnverifiedUsersAfterMs: 24 * 60 * 60 * 1000,
  },
  auth: {
    cookie: {
      name: "auth_token",
      httpOnly: true,
      sameSite: "lax" as const,
      path: "/",
      maxAgeMs: 7 * 24 * 60 * 60 * 1000,
    },
    jwt: {
      expiresIn: "7d",
      algorithm: "HS256" as const,
    },
    bcryptRounds: 10,
    passwordMinLength: 8,
    passwordResetTtlMs: 3_600_000,
    pendingRegistrationCooldownMs: 24 * 60 * 60 * 1000,
  },
  registration: {
    allowPublicRegister: false,
  },
  oauth: {
    autoProvision: false,
    stateTtlMs: 15 * 60 * 1000,
    noncePurgeIntervalMs: 10 * 60 * 1000,
    nonceRetentionMs: 20 * 60 * 1000,
    errorPageCloseDelayMs: 5000,
    gitlabUrl: "https://gitlab.com",
  },
  security: {
    cspEnabledInProduction: true,
    cspNonceBytes: 16,
    crossOriginEmbedderPolicy: false,
  },
  rateLimit: {
    api: {
      windowMs: 15 * 60 * 1000,
      max: 1000,
      message: "Too many requests from this IP, please try again after 15 minutes",
    },
    auth: {
      windowMs: 60 * 60 * 1000,
      max: 50,
      message: "Too many auth attempts from this IP, please try again after an hour",
      excludedPathSuffixes: ["/me", "/callback", "/callback/", "/url"] as const,
    },
  },
  backup: {
    exportEnabled: true,
    restoreEnabled: true,
    requireConfirm: true,
  },
  git: {
    enabled: true,
    prSyncIntervalMs: 5 * 60 * 1000,
    prSyncInitialDelayMs: 5000,
    projectActivityLimit: 50,
    api: {
      fetchTimeoutMs: 8000,
      maxPages: 10,
      perPage: 100,
    },
  },
  mail: {
    port: 587,
    from: '"IRAJ Task Manager" <noreply@example.com>',
  },
  logging: {
    morganProduction: "combined",
    morganDevelopment: "dev",
    level: "info",
  },
  pagination: {
    defaultPageSize: 500,
    maxPageSize: 5000,
    searchResultLimit: 50,
  },
} as const;

export const PLACEHOLDER_DATABASE_URL = "postgres://user:password@localhost:5432/dbname";

/** @deprecated Use `config.auth.cookie.name` after loadConfig(). */
export const AUTH_COOKIE_NAME = CONFIG_DEFAULTS.auth.cookie.name;

export interface CookieConfig {
  readonly name: string;
  readonly httpOnly: boolean;
  readonly sameSite: "lax" | "strict" | "none";
  readonly path: string;
  readonly maxAgeMs: number;
  readonly secure: boolean;
}

export interface OAuthProviderConfig {
  readonly clientId: string;
  readonly clientSecret: string;
}

export interface AppConfig {
  readonly isProduction: boolean;
  readonly isTest: boolean;
  readonly http: {
    readonly host: string;
    readonly port: number;
    readonly appUrl: string | undefined;
    readonly trustProxy: number | boolean;
    readonly jsonBodyLimit: string;
    readonly shutdownTimeoutMs: number;
    readonly fallbackHostName: string;
    readonly defaultDevOrigin: string;
  };
  readonly db: {
    readonly databaseUrl: string | undefined;
    readonly sqlitePath: string;
    readonly busyTimeoutMs: number;
    readonly pgConnectionTimeoutMs: number;
    readonly purgeUnverifiedUsersIntervalMs: number;
    readonly purgeUnverifiedUsersAfterMs: number;
    readonly usePostgres: boolean;
  };
  readonly security: {
    readonly secretKey: string;
    readonly tokenEncryptionKey: string;
    readonly cspEnabledInProduction: boolean;
    readonly cspNonceBytes: number;
    readonly crossOriginEmbedderPolicy: boolean;
  };
  readonly auth: {
    readonly cookie: CookieConfig;
    readonly jwt: {
      readonly expiresIn: string;
      readonly algorithm: "HS256";
    };
    readonly bcryptRounds: number;
    readonly passwordMinLength: number;
    readonly passwordResetTtlMs: number;
    readonly pendingRegistrationCooldownMs: number;
  };
  readonly registration: {
    readonly allowPublicRegister: boolean;
  };
  readonly oauth: {
    readonly autoProvision: boolean;
    readonly allowedDomains: readonly string[];
    readonly stateTtlMs: number;
    readonly noncePurgeIntervalMs: number;
    readonly nonceRetentionMs: number;
    readonly errorPageCloseDelayMs: number;
    readonly gitlabUrl: string;
    readonly gitlab: OAuthProviderConfig;
    readonly google: OAuthProviderConfig;
    readonly github: OAuthProviderConfig;
  };
  readonly rateLimit: {
    readonly api: {
      readonly windowMs: number;
      readonly max: number;
      readonly message: string;
    };
    readonly auth: {
      readonly windowMs: number;
      readonly max: number;
      readonly message: string;
      readonly excludedPathSuffixes: readonly string[];
    };
  };
  readonly backup: {
    readonly exportEnabled: boolean;
    readonly restoreEnabled: boolean;
    readonly requireConfirm: boolean;
  };
  readonly git: {
    readonly enabled: boolean;
    readonly prSyncIntervalMs: number;
    readonly prSyncInitialDelayMs: number;
    readonly projectActivityLimit: number;
    readonly api: {
      readonly fetchTimeoutMs: number;
      readonly maxPages: number;
      readonly perPage: number;
    };
  };
  readonly mail: {
    readonly host: string | undefined;
    readonly port: number;
    readonly secure: boolean;
    readonly user: string | undefined;
    readonly pass: string | undefined;
    readonly from: string;
    readonly configured: boolean;
  };
  readonly gemini: {
    readonly apiKey: string | undefined;
  };
  readonly logging: {
    readonly morganFormat: string;
    readonly level: string;
  };
  readonly pagination: {
    readonly defaultPageSize: number;
    readonly maxPageSize: number;
    readonly searchResultLimit: number;
  };
}

let loadedConfig: Readonly<AppConfig> | null = null;

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  Object.freeze(value);
  for (const key of Object.keys(value as object)) {
    const child = (value as Record<string, unknown>)[key];
    if (child !== null && typeof child === "object" && !Object.isFrozen(child)) {
      deepFreeze(child);
    }
  }
  return value;
}

export function isConfiguredPostgresUrl(raw: string | undefined | null): boolean {
  if (!raw) return false;
  const trimmed = raw.trim();
  if (!trimmed || trimmed === PLACEHOLDER_DATABASE_URL) return false;
  return /^(postgres|postgresql):\/\//i.test(trimmed);
}

function envFlag(name: string, defaultValue: boolean, env: NodeJS.ProcessEnv): boolean {
  const raw = env[name];
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

function parseIntEnv(name: string, fallback: number, env: NodeJS.ProcessEnv): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = parseInt(raw, 10);
  if (Number.isNaN(value)) {
    throw new Error(`${name} must be a number, got ${JSON.stringify(raw)}`);
  }
  return value;
}

function parseSameSite(raw: string | undefined): "lax" | "strict" | "none" {
  const value = (raw || CONFIG_DEFAULTS.auth.cookie.sameSite).toLowerCase();
  if (value === "lax" || value === "strict" || value === "none") return value;
  throw new Error(`AUTH_COOKIE_SAME_SITE must be lax, strict, or none, got ${JSON.stringify(raw)}`);
}

function parseTrustProxy(raw: string | undefined): number | boolean {
  if (raw === undefined || raw === "") return CONFIG_DEFAULTS.http.trustProxy;
  const normalized = raw.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  const asNumber = parseInt(raw, 10);
  if (!Number.isNaN(asNumber)) return asNumber;
  throw new Error(`HTTP_TRUST_PROXY must be true, false, or a number, got ${JSON.stringify(raw)}`);
}

function validateProductionSecrets(env: NodeJS.ProcessEnv, usePostgres: boolean): {
  secretKey: string;
  tokenEncryptionKey: string;
  appUrl: string;
} {
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
  if (usePostgres && !isConfiguredPostgresUrl(env.DATABASE_URL)) {
    throw new Error(
      "FATAL: DATABASE_URL must be set to a valid PostgreSQL connection string in production when Postgres is required."
    );
  }
  return {
    secretKey: env.SECRET_KEY,
    tokenEncryptionKey: env.TOKEN_ENCRYPTION_KEY,
    appUrl,
  };
}

function resolveSecrets(
  env: NodeJS.ProcessEnv,
  isProduction: boolean,
  usePostgres: boolean
): { secretKey: string; tokenEncryptionKey: string; appUrl: string | undefined } {
  if (isProduction) {
    const validated = validateProductionSecrets(env, usePostgres);
    return validated;
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
    secretKey,
    tokenEncryptionKey,
    appUrl: env.APP_URL?.trim() || undefined,
  };
}

export function buildConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const isProduction = env.NODE_ENV === "production";
  const isTest = env.NODE_ENV === "test";
  const port = parseIntEnv("PORT", CONFIG_DEFAULTS.http.port, env);
  const host = env.HOST?.trim() || CONFIG_DEFAULTS.http.host;
  const databaseUrl = env.DATABASE_URL?.trim() || undefined;
  const usePostgres = isConfiguredPostgresUrl(databaseUrl);
  const { secretKey, tokenEncryptionKey, appUrl } = resolveSecrets(env, isProduction, usePostgres);
  const smtpHost = env.SMTP_HOST?.trim() || undefined;
  const smtpUser = env.SMTP_USER?.trim() || undefined;
  const smtpPass = env.SMTP_PASS?.trim() || undefined;
  const smtpPort = parseIntEnv("SMTP_PORT", CONFIG_DEFAULTS.mail.port, env);

  return {
    isProduction,
    isTest,
    http: {
      host,
      port,
      appUrl,
      trustProxy: parseTrustProxy(env.HTTP_TRUST_PROXY),
      jsonBodyLimit: env.JSON_BODY_LIMIT?.trim() || CONFIG_DEFAULTS.http.jsonBodyLimit,
      shutdownTimeoutMs: parseIntEnv("HTTP_SHUTDOWN_TIMEOUT_MS", CONFIG_DEFAULTS.http.shutdownTimeoutMs, env),
      fallbackHostName: env.HOST_NAME?.trim() || CONFIG_DEFAULTS.http.fallbackHostName,
      defaultDevOrigin: env.HTTP_DEFAULT_DEV_ORIGIN?.trim() || CONFIG_DEFAULTS.http.defaultDevOrigin,
    },
    db: {
      databaseUrl,
      sqlitePath: env.SQLITE_PATH?.trim() || path.join(process.cwd(), "database.sqlite"),
      busyTimeoutMs: parseIntEnv("SQLITE_BUSY_TIMEOUT_MS", CONFIG_DEFAULTS.db.busyTimeoutMs, env),
      pgConnectionTimeoutMs: parseIntEnv("PG_CONNECTION_TIMEOUT_MS", CONFIG_DEFAULTS.db.pgConnectionTimeoutMs, env),
      purgeUnverifiedUsersIntervalMs: parseIntEnv(
        "DB_PURGE_UNVERIFIED_INTERVAL_MS",
        CONFIG_DEFAULTS.db.purgeUnverifiedUsersIntervalMs,
        env
      ),
      purgeUnverifiedUsersAfterMs: parseIntEnv(
        "DB_PURGE_UNVERIFIED_AFTER_MS",
        CONFIG_DEFAULTS.db.purgeUnverifiedUsersAfterMs,
        env
      ),
      usePostgres,
    },
    security: {
      secretKey,
      tokenEncryptionKey,
      cspEnabledInProduction: envFlag("SECURITY_CSP_ENABLED", CONFIG_DEFAULTS.security.cspEnabledInProduction, env),
      cspNonceBytes: parseIntEnv("SECURITY_CSP_NONCE_BYTES", CONFIG_DEFAULTS.security.cspNonceBytes, env),
      crossOriginEmbedderPolicy: envFlag(
        "SECURITY_COEP_ENABLED",
        CONFIG_DEFAULTS.security.crossOriginEmbedderPolicy,
        env
      ),
    },
    auth: {
      cookie: {
        name: env.AUTH_COOKIE_NAME?.trim() || CONFIG_DEFAULTS.auth.cookie.name,
        httpOnly: envFlag("AUTH_COOKIE_HTTP_ONLY", CONFIG_DEFAULTS.auth.cookie.httpOnly, env),
        sameSite: parseSameSite(env.AUTH_COOKIE_SAME_SITE),
        path: env.AUTH_COOKIE_PATH?.trim() || CONFIG_DEFAULTS.auth.cookie.path,
        maxAgeMs: parseIntEnv("AUTH_COOKIE_MAX_AGE_MS", CONFIG_DEFAULTS.auth.cookie.maxAgeMs, env),
        secure: envFlag("AUTH_COOKIE_SECURE", isProduction, env),
      },
      jwt: {
        expiresIn: env.JWT_EXPIRES_IN?.trim() || CONFIG_DEFAULTS.auth.jwt.expiresIn,
        algorithm: CONFIG_DEFAULTS.auth.jwt.algorithm,
      },
      bcryptRounds: parseIntEnv("BCRYPT_ROUNDS", CONFIG_DEFAULTS.auth.bcryptRounds, env),
      passwordMinLength: parseIntEnv("PASSWORD_MIN_LENGTH", CONFIG_DEFAULTS.auth.passwordMinLength, env),
      passwordResetTtlMs: parseIntEnv("PASSWORD_RESET_TTL_MS", CONFIG_DEFAULTS.auth.passwordResetTtlMs, env),
      pendingRegistrationCooldownMs: parseIntEnv(
        "PENDING_REGISTRATION_COOLDOWN_MS",
        CONFIG_DEFAULTS.auth.pendingRegistrationCooldownMs,
        env
      ),
    },
    registration: {
      allowPublicRegister: envFlag("ALLOW_PUBLIC_REGISTER", CONFIG_DEFAULTS.registration.allowPublicRegister, env),
    },
    oauth: {
      autoProvision: envFlag("OAUTH_AUTO_PROVISION", CONFIG_DEFAULTS.oauth.autoProvision, env),
      allowedDomains: parseDomainList(env.OAUTH_ALLOWED_DOMAINS),
      stateTtlMs: parseIntEnv("OAUTH_STATE_TTL_MS", CONFIG_DEFAULTS.oauth.stateTtlMs, env),
      noncePurgeIntervalMs: parseIntEnv("OAUTH_NONCE_PURGE_INTERVAL_MS", CONFIG_DEFAULTS.oauth.noncePurgeIntervalMs, env),
      nonceRetentionMs: parseIntEnv("OAUTH_NONCE_RETENTION_MS", CONFIG_DEFAULTS.oauth.nonceRetentionMs, env),
      errorPageCloseDelayMs: parseIntEnv(
        "OAUTH_ERROR_PAGE_CLOSE_DELAY_MS",
        CONFIG_DEFAULTS.oauth.errorPageCloseDelayMs,
        env
      ),
      gitlabUrl: env.GITLAB_URL?.trim() || CONFIG_DEFAULTS.oauth.gitlabUrl,
      gitlab: {
        clientId: env.GITLAB_CLIENT_ID?.trim() || "",
        clientSecret: env.GITLAB_CLIENT_SECRET?.trim() || "",
      },
      google: {
        clientId: env.GOOGLE_CLIENT_ID?.trim() || "",
        clientSecret: env.GOOGLE_CLIENT_SECRET?.trim() || "",
      },
      github: {
        clientId: env.GITHUB_CLIENT_ID?.trim() || "",
        clientSecret: env.GITHUB_CLIENT_SECRET?.trim() || "",
      },
    },
    rateLimit: {
      api: {
        windowMs: parseIntEnv("RATE_LIMIT_API_WINDOW_MS", CONFIG_DEFAULTS.rateLimit.api.windowMs, env),
        max: parseIntEnv("RATE_LIMIT_API_MAX", CONFIG_DEFAULTS.rateLimit.api.max, env),
        message: env.RATE_LIMIT_API_MESSAGE?.trim() || CONFIG_DEFAULTS.rateLimit.api.message,
      },
      auth: {
        windowMs: parseIntEnv("RATE_LIMIT_AUTH_WINDOW_MS", CONFIG_DEFAULTS.rateLimit.auth.windowMs, env),
        max: parseIntEnv("RATE_LIMIT_AUTH_MAX", CONFIG_DEFAULTS.rateLimit.auth.max, env),
        message: env.RATE_LIMIT_AUTH_MESSAGE?.trim() || CONFIG_DEFAULTS.rateLimit.auth.message,
        excludedPathSuffixes: env.RATE_LIMIT_AUTH_EXCLUDED_PATHS
          ? env.RATE_LIMIT_AUTH_EXCLUDED_PATHS.split(",").map((p) => p.trim()).filter(Boolean)
          : [...CONFIG_DEFAULTS.rateLimit.auth.excludedPathSuffixes],
      },
    },
    backup: {
      exportEnabled: envFlag("BACKUP_EXPORT_ENABLED", CONFIG_DEFAULTS.backup.exportEnabled, env),
      restoreEnabled: envFlag("BACKUP_RESTORE_ENABLED", CONFIG_DEFAULTS.backup.restoreEnabled, env),
      requireConfirm: envFlag("BACKUP_REQUIRE_CONFIRM", CONFIG_DEFAULTS.backup.requireConfirm, env),
    },
    git: {
      enabled: envFlag("GIT_ENABLED", CONFIG_DEFAULTS.git.enabled, env),
      prSyncIntervalMs: parseIntEnv("GIT_PR_SYNC_INTERVAL_MS", CONFIG_DEFAULTS.git.prSyncIntervalMs, env),
      prSyncInitialDelayMs: parseIntEnv("GIT_PR_SYNC_INITIAL_DELAY_MS", CONFIG_DEFAULTS.git.prSyncInitialDelayMs, env),
      projectActivityLimit: parseIntEnv("GIT_PROJECT_ACTIVITY_LIMIT", CONFIG_DEFAULTS.git.projectActivityLimit, env),
      api: {
        fetchTimeoutMs: parseIntEnv("GIT_API_FETCH_TIMEOUT_MS", CONFIG_DEFAULTS.git.api.fetchTimeoutMs, env),
        maxPages: parseIntEnv("GIT_API_MAX_PAGES", CONFIG_DEFAULTS.git.api.maxPages, env),
        perPage: parseIntEnv("GIT_API_PER_PAGE", CONFIG_DEFAULTS.git.api.perPage, env),
      },
    },
    mail: {
      host: smtpHost,
      port: smtpPort,
      secure: envFlag("SMTP_SECURE", smtpPort === 465, env),
      user: smtpUser,
      pass: smtpPass,
      from: env.SMTP_FROM?.trim() || CONFIG_DEFAULTS.mail.from,
      configured: Boolean(smtpHost && smtpUser && smtpPass),
    },
    gemini: {
      apiKey: env.GEMINI_API_KEY?.trim() || undefined,
    },
    logging: {
      morganFormat:
        env.MORGAN_FORMAT?.trim() ||
        (isProduction ? CONFIG_DEFAULTS.logging.morganProduction : CONFIG_DEFAULTS.logging.morganDevelopment),
      level: env.LOG_LEVEL?.trim() || CONFIG_DEFAULTS.logging.level,
    },
    pagination: {
      defaultPageSize: parseIntEnv("PAGINATION_DEFAULT_PAGE_SIZE", CONFIG_DEFAULTS.pagination.defaultPageSize, env),
      maxPageSize: parseIntEnv("PAGINATION_MAX_PAGE_SIZE", CONFIG_DEFAULTS.pagination.maxPageSize, env),
      searchResultLimit: parseIntEnv("PAGINATION_SEARCH_LIMIT", CONFIG_DEFAULTS.pagination.searchResultLimit, env),
    },
  };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Readonly<AppConfig> {
  loadedConfig = deepFreeze(buildConfig(env));
  config = loadedConfig;
  return loadedConfig;
}

/** Populated by `loadConfig()` — do not read before boot. */
export let config: Readonly<AppConfig>;

export function getConfig(): Readonly<AppConfig> {
  if (!loadedConfig) {
    throw new Error("Configuration has not been loaded. Call loadConfig() during application boot.");
  }
  return loadedConfig;
}

export function getAppUrl(
  req: { protocol?: string; headers: Record<string, unknown> },
  cfg: Pick<AppConfig, "isProduction" | "http">
): string {
  if (cfg.http.appUrl && /^https?:\/\/[a-zA-Z0-9.-]+/i.test(cfg.http.appUrl)) {
    return cfg.http.appUrl.replace(/\/$/, "");
  }
  if (cfg.isProduction) {
    return `https://${cfg.http.fallbackHostName}`;
  }
  const protoHeader = req.headers["x-forwarded-proto"];
  const protocol = String(protoHeader || req.protocol || "http").split(",")[0].trim();
  const rawHost = String(req.headers["x-forwarded-host"] || req.headers.host || cfg.http.defaultDevOrigin)
    .split(",")[0]
    .trim();
  const cleanHost = rawHost.replace(/[^a-zA-Z0-9.:-]/g, "");
  return `${protocol}://${cleanHost}`;
}

export function gitlabOrigin(gitlabUrl: string): string | null {
  if (!gitlabUrl || !/^https?:\/\//i.test(gitlabUrl)) return null;
  try {
    return new URL(gitlabUrl).origin;
  } catch {
    return null;
  }
}
