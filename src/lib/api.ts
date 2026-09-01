export interface PageInfo {
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}

export interface PaginatedResponse<T> {
  items: T[];
  pageInfo: PageInfo;
}

export class ApiError extends Error {
  status: number;
  body?: unknown;

  constructor(message: string, status: number, body?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

function mergeHeaders(init?: RequestInit): HeadersInit {
  const headers = new Headers(init?.headers);
  if (init?.body != null && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return headers;
}

function errorMessageFromBody(data: unknown, status: number, path: string): string {
  if (data && typeof data === "object" && "error" in data) {
    const err = (data as { error?: unknown }).error;
    if (typeof err === "string" && err.trim()) return err;
  }
  return `Request failed (${status}) for ${path}`;
}

export async function apiFetch<T = unknown>(
  path: string,
  init: RequestInit = {}
): Promise<{ data: T; response: Response }> {
  const response = await fetch(path, {
    credentials: "include",
    ...init,
    headers: mergeHeaders(init),
  });

  let data: T | undefined;
  const contentType = response.headers.get("content-type");
  if (contentType?.includes("application/json")) {
    data = (await response.json()) as T;
  } else if (response.status !== 204 && init.method !== "HEAD") {
    const text = await response.text();
    if (text) data = text as unknown as T;
  }

  if (!response.ok) {
    throw new ApiError(errorMessageFromBody(data, response.status, path), response.status, data);
  }

  return { data: data as T, response };
}

export async function apiGet<T>(path: string, init?: RequestInit): Promise<T> {
  return (await apiFetch<T>(path, { ...init, method: "GET" })).data;
}

export async function apiPost<T>(path: string, body?: unknown, init?: RequestInit): Promise<T> {
  return (
    await apiFetch<T>(path, {
      ...init,
      method: "POST",
      body: body !== undefined ? JSON.stringify(body) : init?.body,
    })
  ).data;
}

export async function apiPut<T>(path: string, body?: unknown, init?: RequestInit): Promise<T> {
  return (
    await apiFetch<T>(path, {
      ...init,
      method: "PUT",
      body: body !== undefined ? JSON.stringify(body) : init?.body,
    })
  ).data;
}

export async function apiDelete<T>(path: string, init?: RequestInit): Promise<T> {
  return (await apiFetch<T>(path, { ...init, method: "DELETE" })).data;
}

export function isPaginatedResponse<T>(data: unknown): data is PaginatedResponse<T> {
  return Boolean(
    data &&
      typeof data === "object" &&
      "items" in data &&
      Array.isArray((data as PaginatedResponse<T>).items) &&
      "pageInfo" in data
  );
}

export function unwrapList<T>(data: unknown): T[] {
  if (Array.isArray(data)) return data as T[];
  if (isPaginatedResponse<T>(data)) return data.items;
  return [];
}

export async function fetchAllPages<T>(url: string, init?: RequestInit): Promise<T[]> {
  const firstUrl = new URL(url, window.location.origin);
  const results: T[] = [];
  let page = 1;

  while (true) {
    const pageUrl = new URL(firstUrl);
    pageUrl.searchParams.set("page", String(page));
    const { data } = await apiFetch<T[] | PaginatedResponse<T>>(pageUrl.pathname + pageUrl.search, init);
    if (isPaginatedResponse<T>(data)) {
      results.push(...data.items);
      if (!data.pageInfo.hasMore) break;
      page += 1;
      continue;
    }
    if (Array.isArray(data)) {
      return data as T[];
    }
    break;
  }

  return results;
}
