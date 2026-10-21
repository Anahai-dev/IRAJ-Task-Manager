import type { Response } from "express";
import type { AppConfig } from "./config.ts";

export interface PageInfo {
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}

export interface PaginatedResult<T> {
  items: T[];
  pageInfo: PageInfo;
}

export interface ParsedPageParams {
  page: number;
  pageSize: number;
  offset: number;
}

export function parsePageParams(
  query: Record<string, unknown>,
  config: AppConfig["pagination"]
): ParsedPageParams {
  const rawPage = query.page ?? query.p;
  const rawSize = query.pageSize ?? query.limit;

  let page = 1;
  if (rawPage !== undefined && rawPage !== "") {
    const parsed = parseInt(String(rawPage), 10);
    if (!Number.isNaN(parsed) && parsed > 0) page = parsed;
  }

  let pageSize = config.defaultPageSize;
  if (rawSize !== undefined && rawSize !== "") {
    const parsed = parseInt(String(rawSize), 10);
    if (!Number.isNaN(parsed) && parsed > 0) pageSize = Math.min(parsed, config.maxPageSize);
  }

  return {
    page,
    pageSize,
    offset: (page - 1) * pageSize,
  };
}

export function buildPageInfo(total: number, page: number, pageSize: number): PageInfo {
  const totalPages = pageSize > 0 ? Math.ceil(total / pageSize) : 0;
  return {
    page,
    pageSize,
    total,
    hasMore: page < totalPages,
  };
}

export function sendPaginated<T>(res: Response, items: T[], pageInfo: PageInfo): void {
  res.json({ items, pageInfo });
}
