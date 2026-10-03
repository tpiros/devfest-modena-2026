import type { State } from "@google/adk";
import { z } from "zod";

// Everything the graph remembers between nodes. The Workflow validates writes
// against this schema at runtime; `get` and `set` type them at compile time.

export const StateSchema = z.object({
  dir: z.string().describe("The sandbox folder"),
  issue: z.number(),
  title: z.string(),
  baseline: z.array(z.string()).describe("Tests that already failed before the fix"),
  proposal: z.string().describe("The fixer's diagnosis and fix, used as the PR body"),
});
type RunState = z.infer<typeof StateSchema>;

type HasState = { state: Readonly<State> };

export function get<K extends keyof RunState>(ctx: HasState, key: K): RunState[K] {
  const value = ctx.state.get<RunState[K]>(key);
  if (value === undefined) throw new Error(`state.${key} is not set yet`);
  return value;
}

export function set(ctx: { state: State }, values: Partial<RunState>) {
  for (const [key, value] of Object.entries(values)) ctx.state.set(key, value);
}
