import { BASE_BRANCH, REPO, githubToken } from "./config.ts";

// GitHub's REST API over fetch. No CLI to install, just a token.

async function api<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`https://api.github.com/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Authorization: `Bearer ${githubToken()}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!res.ok) throw new Error(`GitHub ${path} returned ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

export interface Issue {
  number: number;
  title: string;
  body: string;
}

export const readIssue = (number: number) => api<Issue>(`repos/${REPO}/issues/${number}`);

export function openPullRequest(pr: { title: string; head: string; body: string }) {
  return api<{ html_url: string }>(`repos/${REPO}/pulls`, { ...pr, base: BASE_BRANCH });
}
