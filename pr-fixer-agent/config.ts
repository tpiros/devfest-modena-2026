export const REPO = process.env.REPO ?? "tpiros/acme-tasks";
export const BASE_BRANCH = process.env.BASE_BRANCH ?? "main";
export const MODEL = "gemini-3.8-flash";

// Read lazily: `adk run` loads .env before the first node runs, and a missing
// token should fail with a clear message rather than at import time.
export function githubToken(): string {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("Set GITHUB_TOKEN in .env (a token with repo access).");
  return token;
}
