import type { RequestHandler } from "express";
import type { AppConfig } from "./config.ts";
import type { DatabaseWrapper } from "./types.ts";

export interface Runtime {
  getDb(): Promise<DatabaseWrapper>;
  config: AppConfig;
  encryptSecret(text: string): string;
  decryptSecret(text: string): string;
  authenticateToken: RequestHandler;
}

let runtime: Runtime | null = null;

export function setRuntime(value: Runtime): void {
  runtime = value;
}

export function R(): Runtime {
  if (!runtime) {
    throw new Error("Application runtime has not been initialized");
  }
  return runtime;
}
