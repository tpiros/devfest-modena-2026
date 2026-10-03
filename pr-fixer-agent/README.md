# pr-fixer-agent

On an actual task. Type `fix issue #1`. The intake agent reads that as
`{ issue: 1 }`, then the graph clones
[`tpiros/acme-tasks`](https://github.com/tpiros/acme-tasks) into a sandbox,
reads the issue, works out a fix, then tells you what it found and what it
changed, and waits. `yes` opens the pull request. Anything else throws the
sandbox away.

```
  you                                                        what runs
  ───                                                        ─────────
  "fix issue #1"
       │
       ▼
  ┌────────────┐   reads your message, replies { issue: 1 }
  │   intake   │   outputSchema: typed JSON, not prose                    Gemini
  └─────┬──────┘
        ▼
  ┌────────────┐   temp folder · git clone --depth 1 · npm ci
  │  prepare   │   vitest once: 4 tests fail on main → the baseline     plain code
  │            │   GET /repos/…/issues/1 → { number, title, body }
  └─────┬──────┘   (streams "cloning…", "installing…" while it works)
        ▼
  ┌────────────┐   list_files · read_file · write_file · run_tests
  │   fixer    │   four tools, all fenced inside the sandbox folder      Gemini
  └─────┬──────┘   replies "Diagnosis: … Fix: …"
        │          node(): 3 attempts with backoff, 5 min ceiling
        ▼
  ┌────────────┐   reruns vitest itself and compares with the baseline
  │   verify   │   puts "Tests: 2 fixed, 0 broke" and the full diff     plain code
  └─────┬──────┘   under the model's diagnosis and fix
        ▼
  ┌────────────┐   RequestInput: shows all of that, asks yes/no.
  │   review   │   The turn ends here. Your next message resumes it.    plain code
  └─────┬──────┘
        │
        ├── SKIP ────▶ skip: remove the sandbox, nothing pushed
        ▼ OPEN
  ┌────────────┐   git add · commit · push        POST /repos/…/pulls
  │  open_pr   │   → https://github.com/…/pull/N, sandbox removed        plain code
  └────────────┘
```

Three things the picture is making a point about:

- **Two model calls.** `intake` reads your request into one number; the
  fixer writes the fix. Everything else is a function. The model never
  runs the tests that count, never touches git, and never decides whether to
  ship.
- **The graph judges, not the model.** `verify` reruns vitest and shows the
  result next to the model's own account. `acme-tasks` is deliberately red on
  `main`, so the bar is not "all green" but "nothing that passed before fails
  now, and something improved".
- **You are the loop.** `review` yields a `RequestInput`, the run stops, and
  your `yes` or `no` on the next turn is what resumes it. No retry edge: if
  the proposal is wrong, say no and ask again.

The folder is split by concern:

```
pr-fixer-agent/
├── agent.ts     the graph and its plain-code nodes
├── intake.ts    the LlmAgent that reads your request into { issue }
├── fixer.ts     TaskSchema and the one LlmAgent
├── tools.ts     the four FunctionTools the model sees
├── sandbox.ts   run · git · createSandbox · inside · failingTests
├── github.ts    readIssue · openPullRequest, over fetch
├── state.ts     zod StateSchema and typed get/set for session state
└── config.ts    repo, base branch, model, lap cap, token
```

Needs `git`, Node 24 and two lines in `.env`: `GEMINI_API_KEY` and a
`GITHUB_TOKEN` with repo access. The token is sent as a header on each git
command and never written to disk.

## Running it

```bash
npm install
echo "GEMINI_API_KEY=your-key" > .env
echo "GITHUB_TOKEN=$(gh auth token)" >> .env   # or a fine-grained PAT scoped to the repo
npm start          # then: fix issue #1
npm run web        # the same in the dev UI, with the graph drawn on the left
```

`REPO` and `BASE_BRANCH` in `.env` point it at another repository.
