const FETCH_TIMEOUT_MS = 8000;
const MAX_PAGES = 10;
const PER_PAGE = 100;

export interface GitBranch {
  name: string;
  commitSha: string;
  commitMessage?: string;
  protected?: boolean;
  webUrl?: string;
  isDefault?: boolean;
}

async function fetchJson(url: string, init: RequestInit): Promise<{ ok: boolean; status: number; data: unknown; text: string }> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  const text = await res.text();
  let data: unknown = text;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { ok: res.ok, status: res.status, data, text };
}

export async function listGithubBranches(opts: {
  owner: string;
  name: string;
  token: string;
  defaultBranch: string;
}): Promise<GitBranch[]> {
  const headers: Record<string, string> = {
    "User-Agent": "iraj-task-manager",
    Accept: "application/vnd.github.v3+json",
    Authorization: `Bearer ${opts.token}`,
  };
  const branches: GitBranch[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = `https://api.github.com/repos/${encodeURIComponent(opts.owner)}/${encodeURIComponent(opts.name)}/branches?per_page=${PER_PAGE}&page=${page}`;
    const result = await fetchJson(url, { headers });
    if (!result.ok) {
      throw new Error(`GitHub API Error (${result.status}): ${result.text}`);
    }
    const raw = Array.isArray(result.data) ? result.data : [];
    for (const b of raw as Array<Record<string, unknown>>) {
      const name = String(b.name);
      const commit = b.commit as { sha?: string } | undefined;
      branches.push({
        name,
        commitSha: commit?.sha?.substring(0, 7) || "",
        protected: Boolean(b.protected),
        webUrl: `https://github.com/${encodeURIComponent(opts.owner)}/${encodeURIComponent(opts.name)}/tree/${encodeURIComponent(name)}`,
        isDefault: name === opts.defaultBranch,
      });
    }
    if (raw.length < PER_PAGE) break;
  }
  return branches;
}

export async function getGithubRefSha(opts: { owner: string; name: string; token: string; branch: string }): Promise<string> {
  const headers: Record<string, string> = {
    "User-Agent": "iraj-task-manager",
    Accept: "application/vnd.github.v3+json",
    Authorization: `Bearer ${opts.token}`,
  };
  const result = await fetchJson(
    `https://api.github.com/repos/${encodeURIComponent(opts.owner)}/${encodeURIComponent(opts.name)}/git/ref/heads/${opts.branch}`,
    { headers }
  );
  if (!result.ok) {
    const errJson = result.data as { message?: string };
    let errMsg = `Failed to find base branch '${opts.branch}' on GitHub`;
    if (errJson?.message) errMsg += ` (${errJson.message})`;
    throw new Error(errMsg);
  }
  const data = result.data as { object?: { sha?: string } };
  if (!data.object?.sha) throw new Error("GitHub ref response missing SHA");
  return data.object.sha;
}

export async function createGithubBranch(opts: {
  owner: string;
  name: string;
  token: string;
  branchName: string;
  sha: string;
}): Promise<string> {
  const headers: Record<string, string> = {
    "User-Agent": "iraj-task-manager",
    Accept: "application/vnd.github.v3+json",
    Authorization: `Bearer ${opts.token}`,
  };
  const result = await fetchJson(
    `https://api.github.com/repos/${encodeURIComponent(opts.owner)}/${encodeURIComponent(opts.name)}/git/refs`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({ ref: `refs/heads/${opts.branchName}`, sha: opts.sha }),
    }
  );
  if (!result.ok) {
    const createErr = result.data as { message?: string; errors?: Array<{ message?: string }> };
    let errMsg = createErr.message || "Failed to create branch on GitHub";
    if (Array.isArray(createErr.errors)) {
      const details = createErr.errors.map((e) => e.message || JSON.stringify(e)).join(", ");
      errMsg += `: ${details}`;
    }
    throw new Error(errMsg);
  }
  return `https://github.com/${encodeURIComponent(opts.owner)}/${encodeURIComponent(opts.name)}/tree/${encodeURIComponent(opts.branchName)}`;
}

export async function createGithubPullRequest(opts: {
  owner: string;
  name: string;
  token: string;
  title: string;
  head: string;
  base: string;
  body: string;
}): Promise<string> {
  const result = await fetchJson(
    `https://api.github.com/repos/${encodeURIComponent(opts.owner)}/${encodeURIComponent(opts.name)}/pulls`,
    {
      method: "POST",
      headers: {
        "User-Agent": "iraj-task-manager",
        Accept: "application/vnd.github.v3+json",
        Authorization: `Bearer ${opts.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: opts.title,
        head: opts.head,
        base: opts.base,
        body: opts.body,
      }),
    }
  );
  if (!result.ok) {
    const ghErr = result.data as { message?: string };
    throw new Error(ghErr.message || "Failed to create PR on GitHub");
  }
  const ghData = result.data as { html_url?: string };
  if (!ghData.html_url) throw new Error("GitHub PR response missing html_url");
  return ghData.html_url;
}

export async function getGithubPullRequest(opts: {
  owner: string;
  name: string;
  token: string;
  prNumber: string;
}): Promise<{ status: "open" | "merged" | "closed"; merged: boolean } | null> {
  const result = await fetchJson(
    `https://api.github.com/repos/${encodeURIComponent(opts.owner)}/${encodeURIComponent(opts.name)}/pulls/${opts.prNumber}`,
    {
      headers: {
        "User-Agent": "iraj-task-manager",
        Accept: "application/vnd.github.v3+json",
        Authorization: `Bearer ${opts.token}`,
      },
    }
  );
  if (!result.ok) return null;
  const ghData = result.data as { merged?: boolean; state?: string };
  const merged = Boolean(ghData.merged);
  let status: "open" | "merged" | "closed" = ghData.state === "closed" ? "closed" : "open";
  if (merged) status = "merged";
  return { status, merged };
}
