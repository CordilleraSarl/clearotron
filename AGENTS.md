# For a coding agent working in this repository

You have been handed a trademark-clearance engine. This file is the front door: what it is, what is safe to
run, what costs money, and where things live. Read it before `INSTALL.md` — that document is long and
assumes you already know the shape of the system.

## What this is, in three sentences

Given a mark, its classes and a territory, this engine searches the trademark registers and the open
web/marketplaces for conflicts, reasons about the risk the way a clearance lawyer would, and publishes a
written report plus a machine-readable audit trail. Every reasoning stage runs by spawning a coding CLI —
`claude -p` or `codex exec` — as a child process; the orchestration around those turns is deterministic
Node. A run takes hours, not minutes.

## Commands that cost nothing

```sh
npm install                      # installs all workspaces
npm test                         # offline, fixture-backed. No network, no model, no credentials
npm run example                     # replays a finished example run and serves the report on 127.0.0.1:18900
npm run setup -- --check         # reports what this machine is configured for; writes nothing
node scripts/markdown-link-check.mjs    # every relative markdown link resolves
node mcp-server/smoke.mjs        # drives the real MCP server against a fixture
```

`npm test` is the fast tier. `npm run test:full` is the merge gate and adds the files that drive the
orchestrator end to end against a mock engine. Both are free.

## Commands that spend real money — never run these unprompted

```sh
node driver/runner.mjs           # drains the queue: runs real clearances against real vendors
node driver/pipeline.mjs --job … # one clearance. Hours of model time and vendor calls
npm run setup                    # spends one cheap model turn to prove the engine can complete a turn
npm run sync:uspto               # 41.5 GB download and ~9 hours of indexing
npm start                        # starts the portal; ordering a clearance queues real work
```

`npm start` itself is safe — it starts the portal and the engine door and deliberately does **not** drain
the queue. The spend happens when someone runs the runner.

## Three ways to get it running

| Lane | What you need | Notes |
|---|---|---|
| **See a finished report** | Node 22 | `npm install && npm run example`. No credentials, no model calls. |
| **Prove the whole engine for $0** | Node 22 | A full pipeline run against the mock engine — recipe in `docs/E2E.md` tier 1. Nothing is billed. |
| **Run a real clearance** | A signed-in coding CLI, one register credential, `PERPLEXITY_API_KEY` | See `providers/README.md` for which register to pick, then `INSTALL.md`. |

**Platform.** macOS and Linux natively. Native Windows is not supported — the engine resolves the CLI the
POSIX way. Use WSL2, a devcontainer, or a hosted agent session.

**Running as root** (containers, devcontainers, WSL2-as-root) **is supported and the suite is green there.**
Thirteen tests inject a permission fault by `chmod`-ing a path unreadable or unwritable, which root walks
straight through; each declares a skip naming root as the reason, and the suite reports them. If you see a
*failure* rather than a skip on one of those, it is yours.

**`driver/skills/**` is engine input, not documentation.** Those 46 Markdown files are the prompt payload
served to the model at runtime. `prelim-search/synthesis-rules.md` is a 16,000-word program. Editing them
for brevity, tone or tidiness changes what a clearance concludes. Do not touch them as part of any
documentation task.

That ban is on *editorial* edits. A separate, owner-ruled remediation of the doctrine tree is live and is
the one thing that does rewrite these files — see the identifier hold below. If you are not working that
lane, leave the tree alone; if you are, this rule is not what stops you.

**Some of the doctrine tree is under an identifier hold, and a find-and-replace makes it worse.** Real
delivered marks are present in the worked examples and in the variant/synthesis analysis around them. The
ruled fix is to rebuild each example whole — a fictional candidate searched against real register data, the
way `examples/sample-run` was produced — because renaming the candidate leaves its real conflicts attached
to a mark none of those companies owns, which turns a true analysis into a false public claim about named
firms. **Do not "finish the rename."** No mass edit — including the comment sweep in
[ADR-0005](docs/decisions/0005-comments-carry-reasoning.md) — may touch `driver/skills/**`.

That exclusion is enforced by no script yet, which is why ADR-0005 has it written down in four places
rather than one. This is one of the four. Do not treat any of them as the redundant copy.

**`examples/sample-run/run/*.md` are generated artefacts** of a real run. Do not edit them by hand.

**One register provider is active at a time.** There is no fallback and no default. If register work is
unconfigured, a run refuses by name — that is deliberate, because a register that answered "no conflicts
found" while unconfigured is the most dangerous output this system can produce.

**A zero must be a real zero.** Anywhere you touch counting, coverage or completeness: an empty result, a
missing file, or a failed call must never be reported as a clean negative. This is the repository's
central doctrine and the source of more defects than any other cause.

**Never commit client data.** No real company names, marks, matter numbers or run ids — in code,
comments, tests or fixtures. Two guards check for it specifically: one sweeps every
tracked file for client identity, and one sweeps for operator identity and undeclared citations.

**Twenty-three test files scan the tracked tree, not two** — everything importing
`shared/tracked-files.mjs`. They fail on content in files your diff never opened, so expect one of these
rather than a test of your own: `grep -l tracked-files.mjs driver/test/*.test.mjs`.

**Know what the identifier guards do not cover, because a green run is not a clearance:**

- On a public clone they run in **sentinel mode** — the roster they match against is private, so they
  exercise the matcher and identify nobody.
- **A roster entry protects the spellings it declares.** An entry marked suffixable also catches the name
  plus a trailing suffix, which was added after a real name sat in this tree wearing exactly that shape.
  Other near-misses are not covered: a real mark with a single vowel changed passed the matcher.

The reviewer is the check. Say so in your PR rather than citing a passing test.

**Adding an environment variable** means adding a row to `docs/architecture/05-config-governance.md` and a
row to `.env.example`. Both are ratcheted — a guard fails a new name that
lacks either.

## The tree

```text
├── bin/                  entry points: onboard (setup wizard), demo, start, uspto-sync, signa-sync
├── driver/               the orchestrator — sequences every stage, publishes, owns the run archive
│   ├── engine/           the two CLI adapters (anthropic-agent, openai-agent) + the stage tool servers
│   ├── publish/          report + audit rendering
│   ├── profiles/         per-customer config; the bundled ones are synthetic demos
│   ├── skills/           PROMPT PAYLOAD — engine input, not docs. See the hard rule above
│   └── test/             two tiers, marked with `@tier full`
├── providers/            one adapter per data source. START HERE for registers — providers/README.md
├── mcp-server/           read/question a finished run from an AI chat app. stdio + HTTP faces
├── portal-ui/            React + Vite. dist/ is committed and CI byte-compares it against a fresh build
├── shared/               pure helpers used by driver and publish; depends on neither
├── scripts/              dev and ops tools. scripts/README.md marks which are operator-only
├── examples/             the example run the demo replays, and example job/grants files
└── docs/                 documentation. docs/README.md is the map
```

## Where the money and the truth live

- **Configuration** is environment variables. A `.env` at the repo root is read by every CLI entry point;
  the environment always wins over it. `CLEAROTRON_REPORTS_DIR` (where reports are published) has no default and
  must be set.
- **Run data** never lives in the repository. Published reports and audits go to the archive pool at
  `CLEAROTRON_REPORTS_DIR`; run directories to `CLEAROTRON_WORK_DIR`.
- **Customer configuration** is external too: `CLEAROTRON_CUSTOMERS_DIR` points at a private store. The bundled
  profiles are inventions used by the test suite.

## Before you open a pull request

```sh
npm run test:full        # the merge gate
npm run test:providers
npm run lint:driver
npm run typecheck -w portal-ui
npm run tokens:check
node scripts/markdown-link-check.mjs
node scripts/spdx-headers.mjs --check
npm run build:ui && git add portal-ui/dist    # only if you changed portal-ui/src — CI requires byte equality
```

Grep the suite log for `[repo-guard] SKIPPED`: a guard that skipped cleared nothing, and CI asserts there
are none. `CONTRIBUTING.md` has the full rules.
