import { CONFIG_DEFAULTS } from "../config.ts";
import type { AppConfig } from "../config.ts";

export interface GitApiRuntimeConfig {
  fetchTimeoutMs: number;
  maxPages: number;
  perPage: number;
  gitlabBaseUrl: string;
}

let gitApiConfig: GitApiRuntimeConfig = {
  fetchTimeoutMs: CONFIG_DEFAULTS.git.api.fetchTimeoutMs,
  maxPages: CONFIG_DEFAULTS.git.api.maxPages,
  perPage: CONFIG_DEFAULTS.git.api.perPage,
  gitlabBaseUrl: CONFIG_DEFAULTS.oauth.gitlabUrl,
};

export function setGitApiConfig(config: GitApiRuntimeConfig): void {
  gitApiConfig = config;
}

export function getGitApiConfig(): GitApiRuntimeConfig {
  return gitApiConfig;
}

export function gitApiConfigFromApp(config: AppConfig): GitApiRuntimeConfig {
  return {
    fetchTimeoutMs: config.git.api.fetchTimeoutMs,
    maxPages: config.git.api.maxPages,
    perPage: config.git.api.perPage,
    gitlabBaseUrl: config.oauth.gitlabUrl,
  };
}
