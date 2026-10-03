import { AgentTool, LlmAgent } from "@google/adk";

// Ollivanders, three ways.
//   agent.ts          the specialists are tools; the coordinator answers (this file)
//   agent-nodetool.ts a whole Workflow as one tool
//   agent-hitl.ts     that workflow pauses to ask the customer a question
// The two specialists are defined here and shared by the other two files.

const CATALOGUE = `Holly, phoenix feather, 11". Yew, phoenix feather, 13.5".
Elder, thestral tail hair, 15". Vine, dragon heartstring, 10.75". Willow, unicorn hair, 10.25".`;

export const wandSpecialist = new LlmAgent({
  name: "WandSpecialist",
  model: "gemini-3.8-flash",
  description: "Answers questions about wand products: woods, cores, lengths, what to buy.",
  instruction: `You are a wand specialist at Ollivanders. Recommend from this catalogue:
${CATALOGUE}
If the customer's wand arm is given, mention it once. Be concise and stay in character.`,
});

export const magicalTechnician = new LlmAgent({
  name: "MagicalTechnician",
  model: "gemini-3.8-flash",
  description: "Diagnoses and repairs malfunctioning wands: wrong spells, damage, unresponsive cores.",
  instruction: `You are a magical technician at Ollivanders. Give a short diagnosis and a
recommended next step. Ask one clarifying question if the symptom is vague. Stay in character.`,
});

// `tools` instead of `subAgents`. AgentTool turns each specialist into a function
// named after it; its answer comes back as a tool result and the coordinator
// replies, so control stays here. Compare routing-agent, where control moves.
export const rootAgent = new LlmAgent({
  name: "OllivandersCoordinator",
  model: "gemini-3.8-flash",
  description: "Front-of-shop coordinator at Ollivanders.",
  instruction: `You run the front of shop at Ollivanders. For wand products call WandSpecialist;
for a malfunctioning wand call MagicalTechnician. Pass the customer's question as the request,
then answer the customer yourself, briefly, in the shopkeeper's voice. If the message is not
about wands, do not call a tool: ask them to rephrase it as a wand question.`,
  tools: [new AgentTool({ agent: wandSpecialist }), new AgentTool({ agent: magicalTechnician })],
});
