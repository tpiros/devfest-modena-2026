import { FunctionTool, LlmAgent, Workflow, node } from "@google/adk";
import { z } from "zod";

// --- Tools ---

const searchWikipedia = new FunctionTool({
  name: "search_wikipedia",
  description: "Search Wikipedia for biographical information about a person",
  parameters: z.object({
    query: z.string().describe("The person to search for on Wikipedia"),
  }),
  execute: async ({ query }) => {
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json`;
    const searchRes = await fetch(searchUrl);
    const searchData = (await searchRes.json()) as any;
    if (!searchData.query?.search?.length)
      return { result: "No results found" };
    const title = searchData.query.search[0].title;
    const summaryRes = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
    );
    const summaryData = (await summaryRes.json()) as any;
    return { result: summaryData.extract || "No information found" };
  },
});

// --- Schemas ---

const QuoteSchema = z.object({
  quote: z.string().describe("The text of the quote"),
  author: z.string().describe("The author of the quote"),
});
type Quote = z.infer<typeof QuoteSchema>;

// --- Node 1: plain code ---
// Calling an API and reading the answer back needs no judgement, so this step
// is a function rather than an agent. In a graph, a node can be either.

const FALLBACK: Quote = {
  quote: "The best way out is always through.",
  author: "Robert Frost",
};

async function fetchQuote(): Promise<Quote> {
  try {
    const res = await fetch("https://zenquotes.io/api/random", {
      signal: AbortSignal.timeout(5000),
    });
    const [{ q, a }] = (await res.json()) as Array<{ q: string; a: string }>;
    // "Unknown" is nobody to research, and "zenquotes.io" is how the API
    // reports a rate limit.
    if (a === "Unknown" || a === "zenquotes.io") return FALLBACK;
    return { quote: q, author: a };
  } catch {
    return FALLBACK; // a network hiccup cannot kill a live demo
  }
}

// --- Node 2: an agent, because summarising a bio needs judgement ---
// `{Quote.author}` reads the `author` field off this node's input, which is
// whatever the previous node returned. Only the part after the dot matters:
// `Quote` is a label for the reader, and `{Anything.author}` resolves the same.

const authorResearcher = new LlmAgent({
  name: "author_researcher",
  model: "gemini-3.8-flash",
  description: "Researches a person on Wikipedia and returns a concise bio.",
  instruction: `Search Wikipedia for {Quote.author} using the search_wikipedia tool.

Return a concise 2-3 sentence bio covering who they are and why they are
notable. No preamble.`,
  tools: [searchWikipedia],
});

// --- Node 3: an agent ---
// A node's input is only its immediate predecessor's output, so the quote is
// out of reach as `{Quote.quote}` here. `<Quote.quote from fetch_quote>` binds
// to a named node instead and reaches any node that already ran in this turn.
// The bio arrives as this node's input, appended to the conversation.

const cardWriter = new LlmAgent({
  name: "card_writer",
  model: "gemini-3.8-flash",
  description: "Writes a punchy one-line daily inspiration card.",
  instruction: `You write punchy "Daily Inspiration" cards.

The quote: "<Quote.quote from fetch_quote>"
The author: <Quote.author from fetch_quote>

Their background is in the message above. Combine all of it into exactly ONE
line that ends with "— <Quote.author from fetch_quote>". No preamble, no
surrounding quotes, no extra formatting.`,
});

// --- Workflow ---
// One row of edges reads as the pipeline: start, fetch the quote, research the
// author, write the card. Each node's return value is the next node's input.

export const rootAgent = new Workflow({
  name: "quote_pipeline",
  edges: [
    [
      "START",
      node(fetchQuote, { name: "fetch_quote", outputSchema: QuoteSchema }),
      node(authorResearcher, { inputSchema: QuoteSchema }),
      cardWriter,
    ],
  ],
});
