import { DEFAULT_ROUTE, LlmAgent, NodeContext, Workflow, createEvent, node } from "@google/adk";
import { ThinkingLevel } from "@google/genai";
import { z } from "zod";

// Hangman as a loop. A model guesses one letter, a plain function judges it,
// and the judge's route either sends the game round again or ends it.
//
//   START -> setup -> guesser -> judge --GUESS--> guesser   (the back-edge)
//                                  |
//                                  +--DONE--> result
//
// Nothing caps a graph cycle, so the rules guarantee the exit: every lap
// either reveals a new letter or costs a life, and there are only six lives.
const LIVES = 6;

const WORDS = ["modena", "balsamic", "tortellini", "ferrari", "workflow", "gemini"];

// --- Schemas ---

const BoardSchema = z.object({
  pattern: z.string().describe("The word with hidden letters as underscores"),
  guessed: z.string().describe("Letters guessed so far"),
  livesLeft: z.number().describe("Wrong guesses still allowed"),
});

const GuessSchema = z.object({
  letter: z.string().describe("Exactly one letter, a to z, not guessed before"),
});
type Guess = z.infer<typeof GuessSchema>;

// --- The board: what the guesser is allowed to see ---
// The secret lives in state and never reaches the model.

function board(ctx: NodeContext) {
  const secret = ctx.state.get("secret") as string;
  const guessed = ctx.state.get("guessed") as string[];
  return {
    pattern: [...secret].map((c) => (guessed.includes(c) ? c : "_")).join(" "),
    guessed: guessed.join(", ") || "none yet",
    livesLeft: ctx.state.get("lives") as number,
  };
}

// --- Setup: plain code, no model call ---

function setup(ctx: NodeContext) {
  ctx.state.set("secret", WORDS[Math.floor(Math.random() * WORDS.length)]);
  ctx.state.set("guessed", []);
  ctx.state.set("lives", LIVES);
  return board(ctx);
}

// --- Guesser: the only model call per lap ---
// `{Board.pattern}` reads a field off this node's input. Only the part after
// the dot matters; `Board` is a label for the reader.

const guesser = new LlmAgent({
  name: "guesser",
  model: "gemini-3.8-flash",
  description: "Guesses one letter in a game of hangman.",
  instruction: `You are playing hangman. Find the hidden English word one letter at a time.

Word so far: {Board.pattern}
Already guessed: {Board.guessed}
Lives left: {Board.livesLeft}

Choose the single letter most likely to be in the word. Never repeat a letter
you already guessed. Reply with that one letter.`,
  outputSchema: GuessSchema,
  // One letter needs little thought; low keeps each lap short on stage.
  generateContentConfig: { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
});

// --- Judge: plain code that also picks the route ---
// The engine follows `event.route`. The `output` is the new board, which the
// next lap's guesser receives as input.

function judge(ctx: NodeContext, guess: Guess) {
  const secret = ctx.state.get("secret") as string;
  const guessed = ctx.state.get("guessed") as string[];
  const letter = guess.letter.trim().toLowerCase();

  // Only a new letter that is in the word counts. Anything else costs a life.
  const hit = !guessed.includes(letter) && secret.includes(letter);
  if (!hit) ctx.state.set("lives", (ctx.state.get("lives") as number) - 1);
  ctx.state.set("guessed", [...new Set([...guessed, letter])]);

  const next = board(ctx);
  const over = !next.pattern.includes("_") || next.livesLeft === 0;

  return createEvent({
    route: over ? "DONE" : "GUESS",
    output: next,
    content: {
      role: "model",
      parts: [{ text: `${letter} ${hit ? "✓" : "✗"}   ${next.pattern}   lives: ${next.livesLeft}` }],
    },
  });
}

// --- Result: terminal node ---

function result(ctx: NodeContext) {
  const secret = ctx.state.get("secret") as string;
  return ctx.state.get("lives") === 0
    ? `Hanged. The word was "${secret}".`
    : `Solved "${secret}" with ${ctx.state.get("lives")} lives left.`;
}

// --- Workflow ---
// Build each node once and reuse the reference: edges match nodes by identity.
// A route that matches no key would end the run silently (the dev UI flags the
// node with "NO DEFAULT"), so DEFAULT_ROUTE names the fallback explicitly.

const judgeNode = node(judge, { name: "judge", inputSchema: GuessSchema });
const resultNode = node(result, { name: "result" });

export const rootAgent = new Workflow({
  name: "hangman",
  edges: [
    ["START", node(setup, { name: "setup", outputSchema: BoardSchema }), guesser, judgeNode],
    [judgeNode, { GUESS: guesser, DONE: resultNode, [DEFAULT_ROUTE]: resultNode }],
  ],
});
