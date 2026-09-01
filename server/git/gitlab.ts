import { getGitApiConfig } from "./runtime-config.ts";

export interface GitLabBranch {
  name: string;
  commitSha: string;
  commitMessage?: string;
  protected?: boolean;
  webUrl?: string;
  isDefault?: boolean;
}

function gitlabBase(): string {
  return getGitApiConfig().gitlabBaseUrl;
}

async function fetchJson(url: string, init: RequestInit): Promise<{ ok: boolean; status: number; data: unknown; text: string }> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(getGitApiConfig().fetchTimeoutMs) });
  const text = await res.text();
  let data: unknown = text;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { ok: res.ok, status: res.status, data, text };
}

export async function listGitlabBranches(opts: {
  owner: string;
  name: string;
  token: string;
  defaultBranch: string;
}): Promise<GitLabBranch[]> {
  const gitlabUrl = gitlabBase();
  const encodedProjectPath = encodeURIComponent(`${opts.owner}/${opts.name}`);
  const headers: Record<string, string> = { "PRIVATE-TOKEN": opts.token };
  const branches: GitLabBranch[] = [];
  const api = getGitApiConfig();
  for (let page = 1; page <= api.maxPages; page++) {
    const url = `${gitlabUrl}/api/v4/projects/${encodedProjectPath}/repository/branches?per_page=${api.perPage}&page=${page}`;
    const result = await fetchJson(url, { headers });
    if (!result.ok) {
      throw new Error(`GitLab API Error (${result.status}): ${result.text}`);
    }
    const raw = Array.isArray(result.data) ? result.data : [];
    for (const b of raw as Array<Record<string, unknown>>) {
      const name = String(b.name);
      const commit = b.commit as { short_id?: string; id?: string; title?: string } | undefined;
      branches.push({
        name,
        commitSha: commit?.short_id || commit?.id?.substring(0, 7) || "",
        commitMessage: commit?.title || "",
        protected: Boolean(b.protected),
        webUrl: String(
          b.web_url || `${gitlabUrl}/${encodeURIComponent(opts.owner)}/${encodeURIComponent(opts.name)}/-/tree/${encodeURIComponent(name)}`
        ),
        isDefault: Boolean(b.default) || name === opts.defaultBranch,
      });
    }
    if (raw.length < api.perPage) break;
  }
  return branches;
}

export async function createGitlabBranch(opts: {
  owner: string;
  name: string;
  token: string;
  branchName: string;
  ref: string;
}): Promise<string> {
  const gitlabUrl = gitlabBase();
  const encodedProjectPath = encodeURIComponent(`${opts.owner}/${opts.name}`);
  const result = await fetchJson(`${gitlabUrl}/api/v4/projects/${encodedProjectPath}/repository/branches`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "PRIVATE-TOKEN": opts.token,
    },
    body: JSON.stringify({
      branch: opts.branchName,
      ref: opts.ref,
    }),
  });
  if (!result.ok) {
    const glErr = result.data as { message?: string; error?: string };
    throw new Error(glErr.message || glErr.error || result.text || "Failed to create branch on GitLab");
  }
  const glData = result.data as { web_url?: string };
  return (
    glData.web_url ||
    `${gitlabUrl}/${encodeURIComponent(opts.owner)}/${encodeURIComponent(opts.name)}/-/tree/${encodeURIComponent(opts.branchName)}`
  );
}

export async function createGitlabMergeRequest(opts: {
  owner: string;
  name: string;
  token: string;
  title: string;
  sourceBranch: string;
  targetBranch: string;
  description: string;
}): Promise<string> {
  const gitlabUrl = gitlabBase();
  const encodedProjectPath = encodeURIComponent(`${opts.owner}/${opts.name}`);
  const result = await fetchJson(`${gitlabUrl}/api/v4/projects/${encodedProjectPath}/merge_requests`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "PRIVATE-TOKEN": opts.token,
    },
    body: JSON.stringify({
      title: opts.title,
      source_branch: opts.sourceBranch,
      target_branch: opts.targetBranch,
      description: opts.description,
    }),
  });
  if (!result.ok) {
    const glErr = result.data as { message?: string };
    throw new Error(glErr.message || "Failed to create Merge Request on GitLab");
  }
  const glData = result.data as { web_url?: string };
  if (!glData.web_url) throw new Error("GitLab MR response missing web_url");
  return glData.web_url;
}

export async function getGitlabMergeRequest(opts: {
  owner: string;
  name: string;
  token: string;
  mrNumber: string;
}): Promise<{ status: "open" | "merged" | "closed" } | null> {
  const gitlabUrl = gitlabBase();
  const encodedProjectPath = encodeURIComponent(`${opts.owner}/${opts.name}`);
  const result = await fetchJson(`${gitlabUrl}/api/v4/projects/${encodedProjectPath}/merge_requests/${opts.mrNumber}`, {
    headers: { "PRIVATE-TOKEN": opts.token },
  });
  if (!result.ok) return null;
  const glData = result.data as { state?: string };
  const glState = glData.state;
  if (glState === "opened") return { status: "open" };
  if (glState === "merged") return { status: "merged" };
  if (glState === "closed") return { status: "closed" };
  return { status: "open" };
}
