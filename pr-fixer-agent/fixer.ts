import { LlmAgent } from "@google/adk";
import { z } from "zod";
import { MODEL } from "./config.ts";
import { listFiles, readSource, runTests, writeSource } from "./tools.ts";

// The only model call in the graph.

export const TaskSchema = z.object({
  number: z.number(),
  title: z.string(),
  body: z.string(),
});
export type Task = z.infer<typeof TaskSchema>;

// `{Task.title}` reads a field off this node's input. Only the part after the
// dot matters; `Task` is a label for the reader.
export const fixer = new LlmAgent({
  name: "fixer",
  model: MODEL,
  description: "Diagnoses and fixes one GitHub issue in the sandboxed repository.",
  instruction: `You are a software engineer fixing issue #{Task.number} in a
small TypeScript project.

## {Task.title}

{Task.body}

Use list_files and read_file to find the cause. Make the smallest change that
fixes this issue, with write_file. If the issue asks for a regression test, add
one. Other tests may already be failing for unrelated reasons: leave those
alone. Run run_tests before you finish.

Then reply in exactly this shape, two or three sentences each, no headings:

Diagnosis: what is wrong and where.
Fix: what you changed and why.`,
  tools: [listFiles, readSource, writeSource, runTests],
});
