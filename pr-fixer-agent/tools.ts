import { FunctionTool, type Context } from "@google/adk";
import { readFile, writeFile } from "node:fs/promises";
import { z } from "zod";
import { inside, run } from "./sandbox.ts";
import { get } from "./state.ts";

// The four things the model can do. Each one is scoped to the sandbox folder:
// `inside` rejects any path that would escape it.

function dirOf(ctx?: Context): string {
  if (!ctx) throw new Error("tool called without a context");
  return get(ctx, "dir");
}

export const listFiles = new FunctionTool({
  name: "list_files",
  description: "List every tracked file in the repository.",
  parameters: z.object({}),
  execute: async (_, ctx) => (await run(dirOf(ctx), "git", "ls-files")).out,
});

export const readSource = new FunctionTool({
  name: "read_file",
  description: "Read one file from the repository.",
  parameters: z.object({ path: z.string() }),
  execute: ({ path }, ctx) => readFile(inside(dirOf(ctx), path), "utf8"),
});

export const writeSource = new FunctionTool({
  name: "write_file",
  description: "Overwrite one file in the repository with new content.",
  parameters: z.object({ path: z.string(), content: z.string() }),
  execute: async ({ path, content }, ctx) => {
    await writeFile(inside(dirOf(ctx), path), content);
    return `wrote ${path}`;
  },
});

export const runTests = new FunctionTool({
  name: "run_tests",
  description: "Run the test suite and return its output.",
  parameters: z.object({}),
  execute: async (_, ctx) => (await run(dirOf(ctx), "npm", "test", "--silent")).out,
});
