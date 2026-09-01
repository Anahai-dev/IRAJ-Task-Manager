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
    const res = await fetch(pageUrl.toString(), init);
    if (!res.ok) {
      throw new Error(`Request failed (${res.status}) for ${pageUrl.pathname}`);
    }
    const data = await res.json();
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
