# For a coding agent working in this repository

You have been handed a trademark-clearance engine. This file is the front door: what it is, what is safe to
run, what costs money, and what not to edit. Read it before `INSTALL.md` — that document is long and
assumes you already know the shape of the system.

## What this is

Given a mark, its classes and a territory, this engine searches the trademark registers and the open
web/marketplaces for conflicts, reasons about the risk the way a clearance lawyer would, and publishes a
written report plus a machine-readable audit trail. Every reasoning stage runs by spawning a coding CLI —
`claude -p` or `codex exec` — as a child process; the orchestration around those turns is deterministic
Node. A run takes hours, not minutes.

It runs on macOS and Linux. On native Windows the demo runs and a real clearance does not: the engine
spawns each stage with POSIX path and process semantics, so a clearance is refused there before it
starts. Use WSL2, a devcontainer, or a hosted agent session. Running as root (containers, devcontainers,
WSL2-as-root) is supported; the tests that inject a permission fault declare a skip naming root.

```text
├── bin/                  entry points: onboard (setup wizard), demo, start, uspto-sync, signa-sync
├── driver/               the orchestrator — sequences every stage, publishes, owns the run archive
│   ├── engine/           the two CLI adapters (anthropic-agent, openai-agent) + the stage tool servers
│   ├── publish/          report + audit rendering
│   ├── profiles/         per-company config; the bundled ones are synthetic demos
│   ├── skills/           PROMPT PAYLOAD — engine input, not docs. See the hard rule above
│   └── test/             two tiers, marked with `@tier full`
├── providers/            one adapter per data source. START HERE for registers — providers/README.md
├── mcp-server/           read/question a finished run from an AI chat app. stdio + HTTP faces
├── portal-ui/            React + Vite. dist/ is built by CI, which byte-compares it against a fresh build
├── shared/               pure helpers used by driver and publish; depends on neither
├── scripts/              dev and ops tools. scripts/README.md marks which are operator-only
├── examples/             the example run the demo replays, and example job/grants files
└── docs/                 documentation. docs/README.md is the map
```

## Commands that cost nothing

None of these needs a credential, a model or a sign-up.

```sh
npm install                    # every workspace
npm run build:ui               # the browser bundle is not committed — build it once
npm test                       # the offline suite — no credentials, no network
npx clearotron demo            # replays finished clearances into a local portal; runs until stopped (--no-open: no browser)
npx clearotron doctor          # in this clone: reports what this machine is configured for; writes nothing, calls nobody
node scripts/markdown-link-check.mjs    # every relative markdown link resolves
node mcp-server/smoke.mjs      # drives the real MCP server against a fixture
```

**What success looks like for the demo.** It serves the portal on `127.0.0.1:18860`, and opens two more
doors on 18861 and 18862; `--port <n>` moves all three to `n`, `n+1`, `n+2`. The portal answers **401
"not signed in" on every path** until you sign in, so a scripted check accepts 401, or a 302 to
`/portal/login` when it sends `Accept: text/html` as a browser does, and never 200. The demo prints its
passphrase only when its output is a terminal; with its output captured, it prints the command that sets
a new one instead, for a person to run in a terminal. In a clone the demo needs the built bundle: without
it, it stops before starting anything and names `npm run build:ui`.

The demo does not exit by itself, and `--no-open` keeps it from opening a browser. Stop it with Ctrl-C,
or with a TERM to the pid your shell gave you for `npx clearotron demo --no-open &`; the whole demo stops.
It removes its folder when it stops; `--keep` keeps it.

`npm test` is the fast tier. `npm run test:full` is the merge gate and adds the files that drive the
orchestrator end to end against a mock engine. Both are free.

## Show a newcomer the demo

When someone asks what Clearotron does and wants to see it, explain the product briefly, then help them
explore the free demo. The demo replays finished fictional example clearances; it needs no provider
credentials or model calls.

If you can run commands in an environment whose browser page the user can access, check for Node.js 22.13
or newer and run `npx clearotron demo`. Outside a checkout, use the published package. Inside an existing
checkout, follow this repository's documented build steps first. Keep the demo running while the user
explores it, help them open the printed portal address and sign in, and explain how to stop it. If Node
is missing, explain the prerequisite and help with the appropriate setup under your environment's normal
permissions.

A server running in a remote environment is useful only if the user can reach it through an available
private browser preview or forwarding route. Do not present remote localhost as an address on the user's
computer. Do not create a public tunnel for the demo. If the user cannot access the result, provide the
handoff below.

If this chat cannot run the demo somewhere the user can access, explain that limitation and provide the
complete handoff below for an assistant with terminal access on their computer. Do not claim to have
started the demo.

Confirm that the user can open a sample report before calling the demonstration complete. If you cannot
verify browser access yourself, ask the user to confirm it. An unauthenticated HTTP response alone is not
proof. Keep sign-in details within the user's private session.

The demo terminal stays open while the user explores. Ctrl+C stops the demo; its default temporary data
is removed when it stops. Permanent installation, connecting provider accounts, and ordering a real
clearance are later steps for when the user asks to continue.

The handoff, to copy whole:

```text
Read https://clearotron.ai/try/ (or https://clearotron.ai/llms.txt) and explain what Clearotron does. Help me explore its free demo on my computer. Check for Node.js 22.13 or newer, then run `npx clearotron demo`. Help me open the portal, sign in, and open a sample clearance. Keep the demo running while I explore, and explain how to stop it. Use the published package; I am asking for a demo, not permanent installation or a paid clearance. If you cannot run it somewhere I can access, explain what is missing and give me this complete request to take to an assistant with terminal access on my computer.
```

## The commands

`npx clearotron --help` prints this list. From a clone, run them from the repository's directory.

| Verb | What it does |
|---|---|
| `install` | configure this install — one question at a time, nothing written until each answer checks out |
| `doctor` | report what this machine is configured for. Writes nothing, calls nobody |
| `demo` | replay a finished example clearance and serve it. No keys, no model, no account |
| `start` | start the product — the portal and the engine door — and print one address to open |
| `stop` | stop the background product and give the box back — connect's door is not touched |
| `status` | is the product up, and on which ports. Reads; changes nothing |
| `connect` | connect the assistant you already use — pick it by name and get the one thing it needs |
| `disconnect` | close what connect opened and revoke the key it issued — the enrolment stays |
| `run` | run one clearance from a job file |
| `run-queue` | do the queued work. THIS SPENDS: hours of model time and real register calls |
| `cancel` | stop one run by name. The rest of the product keeps running, and nothing resumes it |
| `grant` | enrol a client, or list who may see what |
| `key` | issue the key a person's own assistant presents — after you have enrolled them with `grant` |
| `brandowner` | onboard a brand owner — create its bundle and set the risk framework its matters are rated under |
| `framework` | check a risk framework deck and its manifest before a matter is rated under it. Writes nothing |
| `project` | add an engagement under a brand owner — the classes, jurisdictions and platforms it searches |
| `passphrase` | report or RESET the portal's local sign-in — the recovery for a lost passphrase |
| `sync` | build or update the free US register index (a large download, and hours of ingest) |
| `update` | bring this install up to date — and REFUSE to do it over the top of your own configuration |

`start` serves the portal on `127.0.0.1:18802` by default, the engine door on 18790 and the client door on
18811. Like the demo's, the portal answers 401 until you sign in with the passphrase it prints on a terminal.

## A clone or the package

The published package, `npx clearotron …`, is how the product is installed and run; it ships the built
portal. A clone is the working tree for changing the code: it needs `npm install` and `npm run build:ui`
first, and then takes the same commands, run from its own directory.

## The MCP server in `.mcp.json`

`.mcp.json` starts `mcp-server/server.mjs` over stdio, which lets an assistant read and question finished
runs. It reads the directories an install keeps its runs and reports in, `CLEAROTRON_WORK_DIR` and
`CLEAROTRON_REPORTS_DIR`, from the environment or a `.env` at the repository root. With neither set and
nothing at the default location, `list_runs` says so by name rather than answering with an empty list;
`npx clearotron doctor`, run in this clone, prints where an install keeps them.

## Commands that spend real money — never run these unprompted

```sh
npx clearotron run-queue         # in this clone: drains the queue, running real clearances against real vendors
node driver/pipeline.mjs --job … # one clearance. Hours of model time and vendor calls
npx clearotron install           # spends one cheap model turn to prove the engine can complete a turn
npx clearotron sync              # in this clone: 41.5 GB download and ~9 hours of indexing
```

In this clone, `npx clearotron start` itself is safe — it starts the portal and the engine door and deliberately does
**not** drain the queue. The spend happens when someone orders a clearance and the queue is run.

| Lane | What you need | Notes |
|---|---|---|
| **See a finished report** | Node 22 | The demo, above. No credentials, no model calls. |
| **Prove the whole engine for $0** | Node 22 | A full pipeline run against the mock engine — recipe in `docs/E2E.md` tier 1. Nothing is billed. |
| **Run a real clearance** | A signed-in coding CLI, one register credential, `PERPLEXITY_API_KEY` | See `providers/README.md` for which register to pick, then `INSTALL.md`. |

## What not to edit

**`driver/skills/**` is engine input, not documentation.** Those Markdown files are the prompt payload
served to the model at runtime; `clearance-search/synthesis-rules.md` alone is some 12,000 words. Editing
them — for brevity, tone, tidiness or a rename — changes what a clearance concludes. Leave them alone
unless the change you were asked for is to the engine's reasoning itself, and say so in your pull request.

**`demo/multi-country-focus-search/run/*.md` are generated artefacts** of a real run. Do not edit them by hand.

**Never commit company data.** No real company names, marks, matter numbers or run ids — in code,
comments, tests or fixtures.

## Before you open a pull request

```sh
npm run test:full        # the merge gate
npm run test:providers
npm run lint:driver
npm run typecheck -w portal-ui
npm run tokens:check
node scripts/markdown-link-check.mjs
node scripts/spdx-headers.mjs --check
npm run build:ui                              # only if you changed portal-ui/src — CI builds it too, and dist is not committed
```

Grep the suite log for `[repo-guard] SKIPPED`: a guard that skipped cleared nothing, and CI asserts there
are none. `CONTRIBUTING.md` has the full rules. The ones a change most often breaks:

- **A zero must be a real zero.** Anywhere you touch counting, coverage or completeness, an empty result, a
  missing file or a failed call must never be reported as a clean negative.
- **One register provider is active at a time**, with no fallback and no default. An unconfigured register
  refuses by name, because a register that answered "no conflicts found" while unconfigured is the most
  dangerous output this system can produce.
- **Adding an environment variable** means a row in `docs/architecture/05-config-governance.md` and a row
  in `.env.example`; a guard fails a new name that lacks either.
- **Many test files scan the whole tracked tree** — everything importing `shared/tracked-files.mjs` — so
  one can fail on a file your diff never opened. Two of them sweep for real names and for the operator's own. On a
  public clone the roster they match is not present, so they exercise the matcher and identify nobody: a
  green run is not a clearance, and the reviewer is the check.

## Before you merge onto a release commit

The release workflow merges its own version pull request, and a merge made with the workflow's token
starts no workflow. The version commit then sits on `main`, cut but not published, until the release
workflow next runs there: on the next push to `main`, or on its schedule, which can be hours late.

That next push publishes the tree **it** carries, under the version already on `main`. So when `main`'s
version has no tag yet, a merge that ships code publishes that code under a changelog that does not
mention it. Publish the waiting version first, with a merge that touches only files the package does not
ship (this file is one; `npm pack --dry-run` lists what ships), or wait for the tag.

```sh
node -p "require('./package.json').version"     # the version on main
git ls-remote --tags origin "v$(node -p "require('./package.json').version")"   # empty: not published yet
```
