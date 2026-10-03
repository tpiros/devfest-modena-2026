import { LlmAgent } from "@google/adk";
import { ThinkingLevel } from "@google/genai";
import { z } from "zod";
import { MODEL, REPO } from "./config.ts";

// The first node. It reads your message and says which issue you mean.
// `outputSchema` forces a JSON reply, and ADK parses it into the node's output,
// so the next node receives { issue: 1 } rather than prose.

export const IssueSchema = z.object({
  issue: z.number().describe("The GitHub issue number the user wants fixed"),
});
export type Issue = z.infer<typeof IssueSchema>;

export const intake = new LlmAgent({
  name: "intake",
  model: MODEL,
  description: "Works out which issue the user wants fixed.",
  instruction: `The user is asking you to fix a GitHub issue in ${REPO}.
Reply with the JSON object naming the issue number they mean, and nothing else.`,
  outputSchema: IssueSchema,
  // Reading one number needs little thought; low keeps this step to a second.
  generateContentConfig: { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
});
