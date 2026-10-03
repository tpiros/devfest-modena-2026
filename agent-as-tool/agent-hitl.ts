import {
  App,
  FunctionNode,
  LlmAgent,
  NodeTool,
  RequestInput,
  Workflow,
  createResumabilityConfig,
} from "@google/adk";
import { z } from "zod";
import { wandSpecialist } from "./agent.ts";

// agent-nodetool.ts plus one thing: a node inside the tool pauses to ask the
// customer a question. Yielding RequestInput ends the turn; the next message is
// the answer, and `rerunOnResume: true` runs this node again with it. Finished
// nodes are not re-run.

const Fitting = z.object({ question: z.string() });

const askWandArm = new FunctionNode(
  "ask_wand_arm",
  function* (ctx, input: z.infer<typeof Fitting>) {
    const arm = ctx.resumeInputs["wand_arm"];
    if (arm === undefined) {
      yield new RequestInput({ interruptId: "wand_arm", message: "Which is your wand arm, left or right?" });
      return;
    }
    yield { question: `${input.question} (wand arm: ${String(arm)})` };
  },
  { inputSchema: Fitting, rerunOnResume: true },
);

const wandFitting = new Workflow({
  name: "wand_fitting",
  description: "Fits a customer with a wand: asks for their wand arm, then the specialist recommends.",
  inputSchema: Fitting,
  edges: [["START", askWandArm, wandSpecialist]],
});

export const rootAgent = new LlmAgent({
  name: "OllivandersCoordinator",
  model: "gemini-3.8-flash",
  description: "Front-of-shop coordinator at Ollivanders.",
  instruction: `You run the front of shop at Ollivanders. For any wand question call wand_fitting
with the customer's question, then relay the recommendation, briefly, in the shopkeeper's voice.
If the message is not about wands, do not call a tool: ask them to rephrase it as a wand question.`,
  tools: [new NodeTool(wandFitting)],
});

// Resumable, so the paused tool call picks up on the next turn.
export const app = new App({
  name: rootAgent.name,
  rootAgent,
  resumabilityConfig: createResumabilityConfig({ isResumable: true }),
});
