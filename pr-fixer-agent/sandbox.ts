import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { REPO, githubToken } from "./config.ts";

// The sandbox is a fresh temp folder holding a shallow clone. Every command
// and every file the model touches goes through here.

const exec = promisify(execFile);

export interface RunResult {
  ok: boolean;
  out: string;
}

/** Run a command in `cwd`. Never throws: a non-zero exit sets `ok: false`. */
export async function run(cwd: string, cmd: string, ...args: string[]): Promise<RunResult> {
  try {
    const { stdout, stderr } = await exec(cmd, args, { cwd, timeout: 120_000, maxBuffer: 10_000_000 });
    return { ok: true, out: `${stdout}${stderr}`.trim() };
  } catch (error) {
    const { stdout = "", stderr = "" } = error as { stdout?: string; stderr?: string };
    return { ok: false, out: `${stdout}${stderr}`.trim() };
  }
}

/**
 * git with the token sent as a header on that one command. Nothing is written
 * to .git/config, so the token never lands on disk.
 */
export function git(cwd: string, ...args: string[]) {
  return run(cwd, "git", "-c", `http.extraheader=Authorization: Bearer ${githubToken()}`, ...args);
}

/** A new sandbox: clone, branch, install. Returns the folder. */
export async function createSandbox(branch: string, progress: (step: string) => void): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pr-fixer-"));
  progress(`cloning ${REPO}`);
  await git(dir, "clone", "--quiet", "--depth", "1", `https://github.com/${REPO}.git`, ".");
  await git(dir, "checkout", "--quiet", "-b", branch);
  progress("installing dependencies");
  await run(dir, "npm", "ci", "--silent", "--prefer-offline");
  return dir;
}

export function removeSandbox(dir: string) {
  return rm(dir, { recursive: true, force: true });
}

/** Resolve `path` inside `dir`, or throw if it would escape the sandbox. */
export function inside(dir: string, path: string): string {
  const full = resolve(dir, path);
  if (!full.startsWith(dir + sep)) throw new Error(`${path} is outside the sandbox`);
  return full;
}

interface VitestReport {
  testResults: {
    assertionResults: { fullName: string; status: string; failureMessages: string[] }[];
  }[];
}

/** Run the suite and return the failing tests as name -> first assertion message. */
export async function failingTests(dir: string): Promise<Map<string, string>> {
  const report = join(dir, ".vitest-report.json");
  await run(dir, "npx", "vitest", "run", "--reporter=json", `--outputFile=${report}`);
  const { testResults } = JSON.parse(await readFile(report, "utf8")) as VitestReport;
  await rm(report, { force: true });

  const failing = new Map<string, string>();
  for (const { assertionResults } of testResults) {
    for (const test of assertionResults) {
      if (test.status === "failed") failing.set(test.fullName, test.failureMessages.at(0) ?? "");
    }
  }
  return failing;
}
