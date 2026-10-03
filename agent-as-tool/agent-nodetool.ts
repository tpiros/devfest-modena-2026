import { LlmAgent, NodeTool, Workflow, node } from "@google/adk";
import { z } from "zod";
import { wandSpecialist } from "./agent.ts";

// A whole Workflow as one tool. NodeTool wraps any node, a graph included: the
// tool's parameters come from the workflow's inputSchema, its result is the last
// node's output, and the inner steps show up in the coordinator's trace.

// Plain code as the last step. No model call.
const polish = (_ctx: unknown, advice: string) => ({
  advice: advice.trim(),
  stamp: "Countersigned by Ollivanders. Makers of Fine Wands since 382 B.C.",
});

const wandConsultation = new Workflow({
  name: "wand_consultation",
  description: "Runs a wand consultation: the specialist answers, then the shop countersigns.",
  inputSchema: z.object({ question: z.string().describe("The customer's question, verbatim") }),
  edges: [["START", wandSpecialist, node(polish, { name: "polish" })]],
});

export const rootAgent = new LlmAgent({
  name: "OllivandersCoordinator",
  model: "gemini-3.8-flash",
  description: "Front-of-shop coordinator at Ollivanders.",
  instruction: `You run the front of shop at Ollivanders. For any wand question call
wand_consultation with the customer's question, then relay the advice and the stamp, briefly,
in the shopkeeper's voice. If the message is not about wands, do not call a tool: ask them to
rephrase it as a wand question.`,
  tools: [new NodeTool(wandConsultation)],
});
