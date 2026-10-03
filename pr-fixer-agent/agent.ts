import {
  DEFAULT_ROUTE,
  FunctionNode,
  RequestInput,
  Workflow,
  createEvent,
  node,
  type NodeContext,
} from "@google/adk";
import { REPO } from "./config.ts";
import { TaskSchema, fixer, type Task } from "./fixer.ts";
import { openPullRequest, readIssue } from "./github.ts";
import { IssueSchema, intake, type Issue } from "./intake.ts";
import { createSandbox, failingTests, git, removeSandbox, run } from "./sandbox.ts";
import { StateSchema, get, set } from "./state.ts";

// A real agent. Say "fix issue #1". The intake agent reads that as
// { issue: 1 }, then the graph clones the repo into a sandbox, reads the
// issue, works out a fix, and tells you what it found and what it changed and
// waits. "yes" pushes the branch and opens the pull request. Anything else
// throws the sandbox away.
//
//   START -> intake -> prepare -> fixer -> verify -> review --OPEN--> open_pr
//                                                      |
//                                                      +--SKIP--> skip
//
// Two model calls: intake reads your request, the fixer writes the fix. The
// clone, the tests, the pause and the PR are plain code.

const text = (t: string) => ({ role: "model", parts: [{ text: t }] });
const branchFor = (issue: number) => `fix/issue-${issue}`;

// `ctx.emit` streams an event before the node has finished. The prepare step
// takes a while, and this is how it keeps the trace alive in the meantime.
function progress(ctx: NodeContext, author: string) {
  return (step: string) =>
    ctx.emit(createEvent({ author, invocationId: ctx.invocationContext.invocationId, content: text(step) }));
}

// --- Prepare: plain code ---
// Sandbox, clone, install, read the issue. The repo is red on main (one
// failing test per open issue), so "all green" is the wrong bar: record what
// fails before the fix and judge against that later.

async function prepare(ctx: NodeContext, { issue }: Issue): Promise<Task> {
  const report = progress(ctx, "prepare");
  const dir = await createSandbox(branchFor(issue), report);
  try {
    report("running the tests once to record what already fails");
    const baseline = await failingTests(dir);
    const { number, title, body } = await readIssue(issue);

    set(ctx, { dir, issue, title, baseline: [...baseline.keys()] });
    report(`${baseline.size} tests fail before the fix`);
    return { number, title, body };
  } catch (error) {
    await removeSandbox(dir); // a failure here must not leave a folder behind
    throw error;
  }
}

// --- Verify: plain code ---
// The model said it ran the tests. The graph runs them again anyway and puts
// the result next to the model's proposal, so you judge both at once.

async function verify(ctx: NodeContext, proposal: string) {
  const dir = get(ctx, "dir");
  set(ctx, { proposal });

  const baseline = new Set(get(ctx, "baseline"));
  const failing = new Set((await failingTests(dir)).keys());
  const fixed = baseline.difference(failing).size;
  const broke = failing.difference(baseline).size;
  const diff = (await run(dir, "git", "diff")).out;

  const tests = `Tests: ${fixed} fixed, ${broke} broke.`;
  const report = [proposal, "", tests, "", diff.length > 4000 ? `${diff.slice(0, 4000)}\n…` : diff].join("\n");
  // The full report is the output (review shows it); the trace line stays short.
  return createEvent({ output: report, content: text(tests) });
}

// --- Review: pause for a human ---
// Yielding a RequestInput ends the turn. The next message you type is the
// answer, and `rerunOnResume` runs this function again with it.

const review = new FunctionNode(
  "review",
  function* (ctx, report: string) {
    const answer = ctx.resumeInputs["open_pr"];
    if (answer === undefined) {
      yield new RequestInput({
        interruptId: "open_pr",
        message: `${report}\n\nOpen a pull request on ${REPO} with this? (yes/no)`,
      });
      return;
    }
    const yes = String(answer).trim().toLowerCase().startsWith("y");
    yield createEvent({ route: yes ? "OPEN" : "SKIP", output: report, content: text(yes ? "approved" : "declined") });
  },
  { rerunOnResume: true },
);

// --- Terminal nodes: plain code, each one removes the sandbox ---

async function openPr(ctx: NodeContext) {
  const dir = get(ctx, "dir");
  const issue = get(ctx, "issue");
  const title = `Fix #${issue}: ${get(ctx, "title")}`;

  await git(dir, "add", "--all");
  await git(dir, "commit", "--quiet", "--message", title);
  await git(dir, "push", "--quiet", "--set-upstream", "origin", branchFor(issue));
  const pr = await openPullRequest({
    title,
    head: branchFor(issue),
    body: `Closes #${issue}\n\n${get(ctx, "proposal")}\n\n_Opened by an ADK agent._`,
  });

  await removeSandbox(dir);
  return `Opened ${pr.html_url}`;
}

async function skip(ctx: NodeContext) {
  await removeSandbox(get(ctx, "dir"));
  return "Nothing pushed. The sandbox is gone.";
}

// --- Workflow ---
// The fixer is the one node that talks to Gemini for real work, so it gets
// the guard rails: three attempts with backoff for a transient 429, and a
// ceiling on the call. A route that matches no edge would end the branch
// silently; DEFAULT_ROUTE makes the fallback explicit.

const skipNode = node(skip, { name: "skip" });

export const rootAgent = new Workflow({
  name: "pr_fixer",
  stateSchema: StateSchema,
  edges: [
    [
      "START",
      intake,
      node(prepare, { name: "prepare", inputSchema: IssueSchema, outputSchema: TaskSchema }),
      node(fixer, { inputSchema: TaskSchema, retryConfig: { maxAttempts: 3, initialDelay: 2 }, timeout: 300 }),
      node(verify, { name: "verify" }),
      review,
    ],
    [review, { OPEN: node(openPr, { name: "open_pr" }), SKIP: skipNode, [DEFAULT_ROUTE]: skipNode }],
  ],
});
