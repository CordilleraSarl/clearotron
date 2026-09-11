# Install & Operate — the reference

[QUICKSTART.md](QUICKSTART.md) gets one search running in three commands. This is everything else.

Two documents in one file, and most readers need only the first. The engine needs no agent gateway — the
reasoning stages' only external LLM dependency is a coding CLI: the Claude CLI (the default) or the codex
CLI. Two other lanes call model APIs of their own: web research (`PERPLEXITY_API_KEY`, required for the
three clearance searches — §1; a Knockout search runs without it and discloses the half it skipped).
The native-script candidate lane no longer asks for a key of its own: it runs on
whichever program the run already chose, so there is nothing extra to set up for it.

**To install it and run one clearance, read §1 → §5 and stop.** That is prerequisites, install,
configuration, the free-register route if you want it, the config-store model, and a headless run. Nothing
after §5 is needed to produce a report.

| | Sections | For |
|---|---|---|
| **Installing** | §1 Prerequisites · §2 Install · §3 Configuration · §3a Free register route · §4 Config store · §5 Run a clearance | Anyone |
| **Operating** | §6 `npx clearotron start` · §7 The MCP server · §8 Access control and isolation | Running it as a service for other people |
| **Reference** | §9 What an integrator supplies · §10 Licence | — |

Before §3, decide which register you are using — it is the first real choice and the fastest route is
**Signa**, one self-serve key. The ladder and what each tier can search:
**[providers/README.md](providers/README.md)**.

Two things that are *not* in here, because they are shorter elsewhere: connecting a chat app to a finished
run is [mcp-server/CONNECT.md](mcp-server/CONNECT.md), and why something is the way it is is
[docs/decisions/](docs/decisions/README.md).

## 1. Prerequisites

- **A base toolchain**, if you are starting from a bare server image. `ubuntu:24.04` ships with none of
  `node`, `npm`, `git` or `curl`, and every step below assumes all four — including `nvm use` in the
  next line, which presupposes an nvm this page never introduces. On a bare image, start with:

  ```
  apt-get update && apt-get install -y curl git ca-certificates
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
  . "$HOME/.nvm/nvm.sh" && nvm install 22
  ```

  Skip this on any machine that already builds software.
- **Node.js >= 22.13**, and npm. A hard floor, and the minor matters: the free US register runs on
  `node:sqlite`, which is not a built-in module before 22.13 — measured across releases, 2026-09-08. On
  Node 20, or on 22.0 through 22.12, the install succeeds and the first US search fails with
  `ERR_UNKNOWN_BUILTIN_MODULE`, saying nothing about Node. `package.json` declares the floor, the
  install refuses below it before writing anything, and `nvm use` picks the pin up.
- **macOS, Linux, or native Windows for the demo; WSL2 for a clearance.** `npx clearotron
  demo` runs anywhere Node does, native Windows included. A real clearance does not: the engine resolves
  the reasoning CLI the POSIX way, so a native-Windows clearance refuses at preflight even with the CLI
  on `PATH`. Native Windows clearances are planned for a later release. Until then, on Windows,
  `wsl --install -d Ubuntu`, then `wsl -d Ubuntu`, and work through this page
  from **inside** that distribution. Name it: plain `wsl` can open a minimal image with no apt, no
  curl and no bash, and everything below assumes Ubuntu. A fresh Ubuntu has no Node at all, and
  apt's package is below the floor above, so `npx` answers "not found" before anything of ours runs.
  From the Ubuntu prompt:

  ```bash
  sudo apt update && sudo apt install -y curl
  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
  . "$HOME/.nvm/nvm.sh" && nvm install 22    # 22.13 or newer, per the floor above
  npm install -g @anthropic-ai/claude-code
  claude                              # once, interactively, to sign in
  npx clearotron install
  ```

  A *hosted* deployment needs Linux for one further thing, the systemd outbox trigger —
  [driver/systemd/README.md](driver/systemd/README.md).
- **A reasoning CLI on your `PATH`, signed in.** This is the prerequisite people miss. Every stage runs
  as a headless turn of a third-party binary, and `CLEAROTRON_AI` picks which one for the whole install.
  An API key is not a substitute for the binary — it decides what the child process is handed, not
  whether one is spawned.

  **Install one first.** The sign-in table below assumes the binary is already on the box; these are the
  same commands the installer offers when it asks you, so nothing here is new advice.

  | `CLEAROTRON_AI` | Binary | Install it with |
  |---|---|---|
  | `anthropic-agent` (default) | `claude` | `npm install -g @anthropic-ai/claude-code` |
  | `openai-agent` | `codex` | `npm install -g @openai/codex` |

  **If npm's global prefix needs root and you do not have it**, the `claude` CLI has a second route —
  `curl -fsSL https://claude.ai/install.sh | bash`, which lands in `~/.local/bin` and prints its own
  `PATH` advice. Run it by your own hand: this product will not execute a piped remote script for you,
  because a command it runs on your box has to be one you can read in full before you answer. There is
  no vendor shell installer for `codex`; on a root-only prefix, move npm's prefix instead.

  Then sign it in:

  | `CLEAROTRON_AI` | Binary | Signed-in laptop | A box you cannot complete a sign-in on |
  |---|---|---|---|
  | `anthropic-agent` (default) | `claude` | `claude` OAuth login — rides your subscription | `claude setup-token` once anywhere you *can* log in, then put it on the server as `CLAUDE_CODE_OAUTH_TOKEN` |
  | `openai-agent` | `codex` | `codex login` | `codex login --device-auth` — prints a code you complete on another device |

  **The right-hand column is about where you can complete a sign-in, not about whether the box has a
  screen.** A server you can reach a browser from takes the left-hand route perfectly well; a laptop
  locked out of the vendor's login page takes the right-hand one. Reading it as "server ⇒ setup-token"
  sends you down the fallback for no reason.

  **`claude auth login` exists and is not the one to use here.** `claude auth --help` will show it, so
  it is worth saying why it is the wrong door: an interactive login is read back from your own
  credential store, and a stage runs as a service-spawned child process that has no session of yours.
  What reaches the CLI is the token in the environment file — the stage subprocess environment is a
  spread of the driver's — and that inheritance is the whole mechanism.

  Both stay on the subscription. Reach for `CLEAROTRON_AI_BILLING=api-key` (plus `ANTHROPIC_API_KEY` or
  `CODEX_API_KEY`) only when metered billing is what you want.

  **Installed is not usable.** `npx clearotron install` proves the engine can complete a turn before it
  writes anything, and `npx clearotron doctor --probe-engine` re-proves it on a configured box. Both
  spend one cheap turn; plain `doctor` spends nothing.
- **A register credential**, and **`PERPLEXITY_API_KEY`**. Both are required for a real run and both
  fail closed at preflight — before a stage has spent, never at the grid after. The one exception is a
  Knockout search, which runs keyless: it returns register filing counts and states on the report that
  the open-web half did not run.

  Which register you pick is the first real decision, and the tiers are not equally easy to reach.
  [providers/README.md](providers/README.md) is the canonical ladder and
  [ADR-0001](docs/decisions/0001-register-ladder.md) is the reasoning. The short version: **Signa** is
  the recommended route (one self-serve key, eleven offices), **`free-tier`** is EU + US with no vendor
  contract but a 41.5 GB build for the US half (§3a), and **Corsearch / Clarivate** are the widest
  coverage on a vendor-issued credential. Whatever the chosen register cannot reach becomes a disclosed
  deferred-coverage row rather than a silent gap, at every tier.
- **Case law is optional and free** — a one-time OAuth login per source, no environment variable, no
  token: [providers/oauth-mcp-bridge/README.md](providers/oauth-mcp-bridge/README.md). Unconfigured, the
  lane stays dark and the run's ledger records that it never dispatched, so no report can claim "no
  adverse case law" off a sweep that did not run. Carried by the Full country search only.

Nothing here requires an agent platform or a database — reports are written to a directory you choose.

## 2. Install

### Which version you get

```
npm install -g clearotron          # stable — the tested one
npm install -g clearotron@beta     # newest — cut when there is something worth testing
```

A **stable** has run a real clearance end to end and had a from-scratch install driven by somebody who has
never seen the product, before it was published. A **beta** is published when a change lands that is worth
testing, or while a stable is being prepared — days apart, not on every merge; it built and the suite
passed, and nothing has driven a live register through it.

**Upgrade production to stables only.** What each channel promises and how often one is cut:
**[docs/RELEASES.md](docs/RELEASES.md)**.

**Upgrading an install made before 0.2.2: pin the agent id first.** The default agent id changed from
`clawdi` to `localagent`, and that id is part of a path — your runs live under
`<workspaceRoot>/workspace-<agent>/studio/prelim-search/`. If you never set an agent id, the upgraded
install reads a workspace that does not exist yet, and an empty workspace looks like an account with no
runs rather than like a misconfiguration. Set **both** names in your environment file before starting
it, because the register-search servers read their own:

```
CLEAROTRON_DEFAULT_AGENT=clawdi
CLEAROTRON_GATHER_AGENT=clawdi
```

If your environment file already sets them, nothing changes. A first-time install needs neither.

The rest of this section is about the two ways a package reaches you, which is a separate question from
which version it is.

There are two routes in, and they are not variations on one another. **If you were sent a `.tgz` file,
you want the second one** — the first assumes access to the repository, which a customer does not have.

### From the repository

**This is the development tree, and it is for contributors.** If you want to run a clearance, take one
of the two routes above instead. A clone is not a smaller version of the package — it carries the
fixtures and sample companies the project develops against, and those load as real records. They
are not yours and they are not in the package, which excludes them deliberately.

```
git clone <this-repo> && cd <repo>
npm install            # installs all workspaces
npm test               # offline, fixture-backed suites — no network, no gateway, no spend
```

`npm test` belongs to **this** route only. It runs our test files, and those do not travel in a package
— see *From a packaged tarball* below, which never asks you to run it.

### From a packaged tarball

This is the shape a customer receives, and it is the one `scripts/verify-publishable.mjs` drives on every
CI run — it packs, installs into a tree with no checkout, and runs the verbs: **an empty project with the
tarball as a dependency.** Not an unpacked archive; there is no step here that untars anything.

```
mkdir ~/app && cd ~/app
npm init -y
npm install /path/to/clearotron-<version>.tgz
npx clearotron doctor          # reads; writes nothing, calls nobody
npx clearotron install         # the wizard
```

`npx` works from `~/app` because npm links a **dependency's** `bin` into the consuming project — the
same mechanism the note below explains, arriving here from the other side. **You do not need to `cd`
into `node_modules`**, and you should not: that directory belongs to your package manager, and anything
you write inside it can be replaced by the next `npm install`.

**Do not run `npm test` on this route.** Our test files are excluded from the package deliberately, so
there is nothing for it to run; what you get is a refusal, and the refusal's advice is written for
somebody working in a checkout. Nothing is wrong with your install.

### Cutting a package (maintainers)

Skip this unless you are the one producing the `.tgz`.

**`npm pack` alone is not the command.** The repository manifest carries
`overrides: { "buffers": "$buffers" }`, which resolves only inside the checkout; a consumer installing that
tarball dies with `Unable to resolve reference $buffers` before a single file is written. Five consecutive
releases went out that way. **The published manifest has to be sealed** — that key stripped from the
tarball, the repository's own manifest left untouched. Which route does it depends on the tree you are on:

- **A tree that carries `cut/`**: `node scripts/pack-publishable.mjs`. It packs, strips, reconciles against
  the withheld-file list and scans the packed tree in one step.
- **A public checkout**, which is what the release workflow runs on: `npm pack`, then
  `node scripts/release-artifact-seal.mjs --tarball <path>`. `pack-publishable.mjs` refuses here — it needs
  `cut/packed-artifact.mjs`, which a public tree does not carry, and exits 2 rather than packing something
  nobody checked.

Either way, prove it before publishing it:

    node scripts/release-install-check.mjs --tarball <path>

That installs the artefact as a dependency of a throwaway project, which is the only shape this failure
exists in. Installing at the root of a checkout and `npm install --dry-run` both exit 0 on a tarball that
refuses for every real user.

Two further constraints, both of which stop a package being cut from just anywhere:

- **The de-identification scan needs a full clone.** It refuses a shallow one (exit 2 — could-not-look,
  not a pass) because it walks history it cannot see.
- **It also needs its table**, passed with `--blocklist` (or `CLEAROTRON_IDENTIFIER_BLOCKLIST`), and
  that table lives in the private config store rather than in this repository. Without it the scan
  exits 2 rather than arming a weaker rule set quietly.

Both refusals are correct and neither is a workaround to route around.

**Every `clearotron` command in this document is written `npx clearotron …`, and that is not a
stylistic choice.** This repository *is* the `clearotron` package, and npm links a package's `bin` into
`node_modules/.bin` only for its **dependencies** — never for the package itself. So after `npm install`
succeeds there is no `clearotron` on your `PATH` and none in `node_modules/.bin`; a bare `clearotron`
would be `command not found` with nothing having failed.

**`npx` resolves the local package by walking up from the current directory, so it works from the
project root and any subdirectory of it — and nowhere else.** From your home directory the same line
gets you npm's `could not determine executable to run`, which names no product and suggests no fix.
That is why this document tells you to `cd` in first, and why every command below assumes you are still
there. On the repository route "the project" is the checkout; on the packaged route it is the directory
you ran `npm init` in — and on that route `clearotron` IS a dependency, so `npx` finds it in
`node_modules/.bin` exactly as the paragraph above describes.

**`clearotron install` (§3) puts the short form on your `PATH`** and you can stop typing `npx` after it:
it writes a small shim to `~/.local/bin/clearotron` pointing at this checkout. That directory needs no
root — `npm link` would want npm's global prefix, which on a default install is `/usr` and refuses
without it. Most login profiles add `~/.local/bin` to `PATH` only if it already existed when the shell
started, so in the terminal that ran the install you may need `export PATH="$HOME/.local/bin:$PATH"`
once; a new login shell picks it up by itself. The install prints which of the two you are in, and the
product's own advice follows suit — `clearotron doctor` names the form that works from where you are
standing, whichever that is.

`npm test` is the fast tier, **on the repository route**. `npm run test:full` adds the files that drive
the orchestrator end to end and is what CI runs before a merge; [CONTRIBUTING.md](CONTRIBUTING.md) draws
the line between them. Either way nothing is contacted and nothing is billed — the suite says so before
it starts. Neither runs on a packaged install: the test files are not in the package.

The engine itself has no build step. The **portal UI does** — `portal-ui/` is React + Vite — but its
built bundle (`portal-ui/dist/`) is **not committed to git**: it travels in the published package and
CI builds it, so a tarball install is already runnable while a clone needs one build first. You also
need to build after changing something under `portal-ui/src`:

```
npm run tokens         # regenerate the design tokens from shared/brand.mjs, if colours changed
npm run build:ui       # build portal-ui/dist — the portal serves this, not the sources
```

**`portal-ui/dist` is build output.** The portal serves that bundle rather than the sources, so run the
build after cloning if the directory is not there, and again whenever you change anything under
`portal-ui/src`. Until the bundle exists the UI answers with a 503 that says exactly this, and the API
keeps working throughout.

`npm test` exercises the driver and MCP server against recorded fixtures; it never calls a model or a
provider, so it is safe to run on any machine that has the repository. "Safe anywhere" is about spend,
not about where it will run — on a packaged tree it refuses, as above.

## 3. Configuration (environment)

Runtime configuration is by environment variable, and there are two ways to supply them.

**A `.env` at `~/.config/clearotron/.env`**, which the CLI entry points read for themselves — `driver/pipeline.mjs`,
`runner.mjs`, `enqueue.mjs`, `dev-portal.mjs`, `bin/start.mjs`, `bin/uspto-sync.mjs` and both MCP
servers. Nothing to source and nothing to remember; each command prints one line on stderr naming what
it read. `npx clearotron install` writes it there for you, creating the directory at mode 700.

**It used to live inside the install directory, and that is why it moved.** On a packaged install that
directory belongs to npm, so an ordinary `npm install -g clearotron` replaced the tree and deleted the
configuration — credentials included — with every command still exiting 0. If you configured an install
before this change, the old file is still read and every command tells you once to move it; move it,
contents unchanged, and the notice stops.

Three more things about it are worth knowing before you write one:

- **The environment always wins.** A name already set in the environment is left alone, empty values
  included — so a `.env` can never overrule the deployment running it, and exporting one variable for
  one command still works.
- **It is parsed, not sourced.** `$HOME` is not expanded; it stays five literal characters. Write
  absolute paths. The loader names any value that looks like an unexpanded shell variable.
- **`CLEAROTRON_NO_ENV_FILE=1` turns it off**, which is what the systemd units set: a server's
  configuration is its `EnvironmentFile` and a file inside the checkout must not contribute to it.

**Or the environment directly** — your shell, a container spec, a systemd `EnvironmentFile`. This is
what production does, and nothing about it changed.

Vendor credentials keep their vendor’s name — `SIGNA_API_KEY`, `PERPLEXITY_API_KEY`,
`ANTHROPIC_API_KEY` — because those already say who you bought them from.

The two billing rows fold into one name. Only the engine you selected is ever consulted, so one value
serves whichever it is; if you set both old names to different values, there was never a single answer,
and now there is a single name.

Variables not in this table are internal tunables. They keep their names.

**Two paths and one provider are the whole required set.** `CLEAROTRON_DATABASE` picks the register
(§1); `CLEAROTRON_REPORTS_DIR` says where finished reports are published; `CLEAROTRON_WORK_DIR` says where
runs happen. The pool has **no default at all** — unset, the engine refuses and names the variable
rather than choosing a directory on your behalf, because the wrong choice writes a report into an
archive somebody else owns. The workspace root defaults to `$HOME/trademark/workspace`, which is also
what `npx clearotron install` writes, so the wizard and the bare default agree.

If you would rather not write this file by hand, `npx clearotron install` asks for a base directory, creates
these paths under it, checks what it can check without billing you before it writes anything, and never
touches a path you did not name — an engine turn, an EUIPO token exchange, and an offered (not assumed)
Perplexity ping. A paid register key is deliberately not probed: a call against a metered subscription is
a charge you did not ask for, so that credential is written on your word. `npx clearotron doctor`
reports what is set and what is missing, and writes nothing.

Only the integrator-set knobs are shown — copy what you need:

```sh
# ── Reasoning engine (LLM) ─────────────────────────────────────────────
CLEAROTRON_AI=anthropic-agent            # headless `claude -p`
CLEAROTRON_CLAUDE_PATH=claude             # path to the Claude CLI (default: `claude` on PATH)
CLEAROTRON_AI_BILLING=subscription       # `subscription` (OAuth, default) | `api-key`
# ANTHROPIC_API_KEY=sk-ant-...           # only when CLEAROTRON_AI_BILLING=api-key
# CLEAROTRON_AI=openai-agent             # …or the second adapter: headless `codex exec`
# CLEAROTRON_CODEX_PATH=codex              # path to the codex CLI (default: `codex` on PATH)

# ── Where this install keeps its data ──────────────────────────────────
# REQUIRED. CLEAROTRON_REPORTS_DIR has NO default: unset, a run refuses and names it.
# It is the one path the engine will not guess, because guessing wrong means
# publishing a client's report into somebody else's archive.
CLEAROTRON_REPORTS_DIR=/home/you/trademark/pool   # published reports + audits (outside the repo)
CLEAROTRON_WORK_DIR=/home/you/trademark/workspace   # run directories and queues
CLEAROTRON_REPORTS_URL=https://reports.example.com # base URL the pool is served at (for report links)
CLEAROTRON_CUSTOMERS_DIR=/etc/trademark/profiles # your private customer-config store (default: bundled profiles/)

# ── Run it under your own name ─────────────────────────────────────────
# Optional, and read at start-up. Unset, a report says only what the software is —
# it never carries somebody else's practice name. See TRADEMARKS.md, which is also
# where the limits on the CLEAROTRON name itself are stated.
CLEAROTRON_BRAND_NAME=Your Firm           # stamped into report titles, the pool index and Excel metadata
CLEAROTRON_BRAND_TAGLINE=                 # empty means ABSENT: no strapline is rendered at all
CLEAROTRON_BRAND_PRODUCT=Trademark clearance   # what the deliverable is called

# ── Register provider (choose ONE) ─────────────────────────────────────
CLEAROTRON_DATABASE=clarivate       # REQUIRED — corsearch | clarivate | signa | euipo | uspto-local | free-tier
                                         # No default: unset, a run refuses.
CLARIVATE_API_KEY=...                    # the credential for the provider named above
# CLARIVATE_API_BASE=...                  # optional; defaults to the adapter's base
# CORSEARCH_SESSION_KEY=...
# SIGNA_API_KEY=...
# SIGNA_BASE_URL=...                      # optional; defaults to the adapter's base
# CORSEARCH_SESSION_KEY=...               # …or an enterprise vendor, via a sales agreement
# CLARIVATE_API_KEY=... / CLARIVATE_API_BASE=...
# USPTO_LOCAL_DB=/var/lib/trademark/uspto/us.db   # no vendor account — see §3a below

# ── …or the FREE EU register, as the provider (no subscription) ────────
# CLEAROTRON_DATABASE=euipo
# EUIPO_CLIENT_ID=... / EUIPO_CLIENT_SECRET=...
EUIPO_ENVIRONMENT=production              # REQUIRED with euipo — sandbox | production are SEPARATE
                                          # deployments over different corpora. There is no default:
                                          # unset, the adapter refuses by name.

# ── Web research — REQUIRED for all four products (see §1) ─────────────
PERPLEXITY_API_KEY=...

# ── Optional data sources ──────────────────────────────────────────────
# Case law has NO token variable. Access is free and immediate, and setup is a one-time OAuth login
# per source — providers/oauth-mcp-bridge/README.md. Unset, the lane stays dark and the run records
# that its sweep never dispatched, so no report can claim "no adverse case law" off an absent sweep.

# ── MCP HTTP read face — only if you expose it remotely ────────────────
# TRADEMARK_MCP_HTTP_PORT=18790           # the port the HTTP face listens on
# MCP_ALLOWED_EMAIL_DOMAINS=example.com   # gate access by email domain
# CLEAROTRON_OIDC_AUDIENCE=...          # the audience your provider issues (any provider)
# CLEAROTRON_CLIENT_OIDC_AUDIENCE=...  # the CLIENT door's audience; MUST differ from CLEAROTRON_OIDC_AUDIENCE
# CF_ACCESS_TEAM=...         # ONLY if fronting with Cloudflare Access; otherwise set *_OIDC_ISSUER
# TRADEMARK_MCP_AUTH_DISABLED=1           # LOCAL TESTING ONLY — on its own the face refuses to start;
# TRADEMARK_MCP_DEV=1                     #   it needs this too, plus a loopback host and a set
#                                         #   CLEAROTRON_ACCESS_FILE (§8)
```

Note: delivery is one behaviour and not a setting — the driver writes delivery/event packets and
never sends, which is what keeps a run entirely gateway-free. The full intake and delivery contracts
live in [docs/INTAKE.md](docs/INTAKE.md) and [docs/DELIVERY.md](docs/DELIVERY.md).

**`CLEAROTRON_DELIVERY` is retired ** and so is its old spelling. It used to select between the
packet lane above and a second lane that pushed the same events through one agent platform's gateway as
chat messages; that platform is not part of this product, so the second value named a deployment nobody
installing this could build. If either spelling is still in your environment the driver prints a warning
on every run and ignores the value. **If yours was set to `stage`, nothing is sending your notices** —
the packets are being written and are waiting for an integrator to consume them.

## 3a. Running without a paid register vendor

`uspto-local` searches a copy of the United States register that you build on your own disk from
USPTO's public bulk data. No vendor, no invoice, and no extra software — Node 22 ships the database
engine it uses.

**The bill is time and disk, not money.** From one complete build read end to end on 2026-08-11 (767
files, backfile and dailies): **41.5 GB** downloaded, **~9 hours** to ingest at 4.6 GB/h, **20 GB** of
free disk to provision, settling to a **10.1 GB** index plus roughly 33 MB of nightly top-ups. The
download decides whether you want to do this today; the index is what you provision for. Both figures
live in `shared/uspto-index-size.mjs`, and a test fails if any doc disagrees with it.

`npx clearotron install` offers to start the build in the background when you give it a
`USPTO_LOCAL_DB` path that does not exist yet. It asks first, names the size in the question, and
takes only a typed `yes`. The build is resumable, so it need not happen in one sitting.

**It covers the United States and nothing else**, and it is honest about the rest: no sound-alike
search, no opposition or TTAB records, no mark images. Each is disclosed as a gap rather than answered
with something weaker or rendered as "none found". Every other territory in a matter becomes a stated
gap in the report — pair it with EUIPO for Europe, which is what `free-tier` is.

**The EU register needs none of this.** `euipo` and the EU half of `free-tier` work as soon as your
credentials are in, and the US office rides as a deferred coverage row until the index exists.

**Nothing schedules the sync for you.** The daily refresh, the systemd and cron recipes, and the
staleness thresholds that decide when an index is too old to trust are in
[providers/uspto-local/README.md](providers/uspto-local/README.md).

## 4. The config-store model

### The four things, and what contains what

Read this before the rest of the section. Everything is one tree, and a person is given access to
points on it.

| What it is | What the product calls it | Where it lives | What creates it |
|---|---|---|---|
| A group of people and the companies they clear for — a firm, a brand team, one customer of a hosted install | **organisation** (`tenant` in `grants.json`) | a key under `tenants` in `grants.json`, with its `name` | setup creates the first; after that, a key you add to `grants.json` |
| A company you do clearances for | **company** (`account` in `grants.json` and on the wire; the CLI calls it **brand owner**) | a bundle in the customer store, keyed by an account key, and listed under exactly one organisation | the portal's `+ New company`, or `npx clearotron brandowner add <key>` |
| One engagement under that company — its classes, jurisdictions, platforms | **project** | inside that company's bundle | `npx clearotron project add` |
| Someone who may see some of it | **person** | `grants.json`: their access under each organisation's `users`, their two switches under `people` | the portal's People page, or `npx clearotron grant add` |

Nesting, in one line: **an organisation contains companies; a company contains projects; a person is
given access to points on that tree — the whole install, an organisation, or one company — and sees
everything below them.**

Three consequences worth stating, because each has surprised someone:

- **A company belongs to exactly one organisation.** The guest list is refused at load if a company is
  listed under two; another organisation's people are given access to it where it lives.
- **A person holds two switches, and nothing else is a permission.** **Run clearances** starts and
  stops them; **Manage** adds people, adds companies and changes settings. Viewing is not a permission:
  access is viewing. A person with no entry under `people` sees what their access covers and starts
  nothing.
- **A key grants no reach of its own.** `npx clearotron key issue` mints the identity a person's assistant
  presents; what that identity may see and do is decided by the guest list at the moment of each call.
  Enrol first, issue second — a key for someone with no access reaches nothing, and is not an error
  anywhere.

**The file keeps its words.** The screens say organisation, company and person; `grants.json`, the wire
and the command line keep `tenant` and `account`, and the CLI verb stays `brandowner`. Moving them would
break every file and script written against them.


A clearance run is shaped by a **customer profile** — a small JSON file that declares that customer's
marketplaces, default classes/jurisdictions, own-brand names to exclude, delivery style, and (optionally)
a bespoke risk framework. A job resolves to a profile by the **forwarder's email domain**; if nothing
matches, the neutral Generic default applies.

- **Bundled with the package** (`driver/profiles/`): `generic.json` (the Generic default) and
  `demo-brand-owner.json`, the account the demo runs as, so you can run and read the machinery
  immediately. `driver/profiles/README.md` documents every field. (A clone of the repository carries
  three more, marked `testFixture` in their own files: the test suite reads them, no install offers
  them, and they are excluded from the published package as well.)
- **Your real customers live outside the repo.** Point `CLEAROTRON_CUSTOMERS_DIR` at your own private
  config store and the engine loads *those* accounts instead. **Same engine, different config path** —
  the code carries no customer identities.

  Two things go with it, and both are refusals rather than preferences:

  - **`PROFILE_REPO_ROOT` moves too.** The customer directory has to sit inside the repository that
    variable names, because editing a profile is a commit. Point one somewhere new and leave the other
    behind and the portal and the profile service both refuse to start, naming both variables.
  - **That repository needs a `user.name` and a `user.email` of its own.** Saves are committed under
    the name of whoever asked for them, but git also records who *made* the commit, and it will not
    commit at all without one. A service account usually has no global git identity, so a store created
    by hand needs its own:

    ```bash
    git init -b main /srv/clearotron-store
    git -C /srv/clearotron-store config user.name  "clearotron local install"
    git -C /srv/clearotron-store config user.email "clearotron@example.com"
    ```

    `clearotron start` does this for the store it creates. A store you make yourself does not get it,
    and the symptom is the first save failing at a commit rather than anything about profiles.
- **Run data is external too.** Published reports, audits, and per-run state go to the archive pool at
  `CLEAROTRON_REPORTS_DIR`. Nothing customer-specific is committed to the repository.

The profile set and the archive pool are the two things a deployment supplies; the engine is otherwise
self-contained.

### What a customer store holds besides the profile

A customer is not only its `<key>.json`. Two more things sit beside it, both optional, both shipped as
working examples in `driver/profiles/`:

- **A context pack** — `<key>.context.md`, a sibling of the profile. Free prose about the account that
  the engine attaches to the profile it loads. One ships beside a bundled demo customer.
- **Project overlays** — `projects/<customer-key>/<slug>.json`. A project is one engagement under a
  customer: a launch screening, a flagship clearance, a regional push. Each may carry its own
  `<slug>.context.md` beside it. `projects/demo-brand-owner/japan-and-korea-app-launch.json` is the
  shipped example.

### What a project may and may not change

A project overlays eight fields and is refused if it sets any of the other nine:

| A project may set | Only the customer may set |
|---|---|
| `platforms` · `defaultClasses` · `defaultJurisdictions` · `marketplaceDensity` · `delivery` · `riskAppetite` · `industry` · `defaultProduct` | `name` · `matchDomains` · `selfExclusionOwners` · `frameworkPath` · `workedExamplesPath` · `allowedRecipes` · `jxPolicy` · `runCaps` · `demoData` |

The split is identity and rating authority: a project selects machinery, never who the customer is or
what standard their risk is rated against. Setting a customer-only key in an overlay fails validation by
name rather than being ignored.

**A project replaces the fields it states — except `platforms`, which is added to the customer's.** The
customer's marketplaces are client-mandated: the account asked for those to be swept, and an engagement
may add to that instruction but never revoke it. Every other overlaid field replaces outright, so an
overlay stating `defaultClasses` narrows to exactly what it states.

### Your store replaces the shipped one — it does not layer on it

**Setting `CLEAROTRON_CUSTOMERS_DIR` replaces the whole tree, projects included.** The engine reads your
store's customers and your store's `projects/`, and none of ours. That is deliberate — a deployment's
roster holds its own accounts and nothing of ours — but it is silent, and it is the one thing here that
becomes an incident on a real deployment rather than a bundled one:

- A job naming a project your store does not carry is **not refused**. The `projectKey` is dropped and
  the run proceeds on the customer's own defaults — its classes, its marketplaces, its product — and the
  report records no project. Nothing warns, so this reads as a clean run of the wrong scope.
- `generic.json` — the universal fallback — is the ONE file that does fall through: if your store does
  not supply one, the bundled copy is used by name, so an empty store still resolves every unprofiled
  job. (An earlier version of this line said "nothing else fills in"; since the layering change that is
  true of everything EXCEPT generic, and the difference is exactly a fresh install working or 500ing.)

Copy or author the customers, context packs and project overlays you want; assume you inherit none.

## 5. Run a headless clearance report

1. Make sure `CLEAROTRON_AI` names the engine you want (`anthropic-agent` or `openai-agent`), its CLI is
   authenticated, and your active register provider's credential is set. `npx clearotron doctor
   --probe-engine` answers all three, and the engine half of it by actually running a turn — an
   executable on `PATH` that is signed out passes every other check and fails at the first stage.

2. Write a **job file**. The required fields are an `id`, a `forwarder` handle, at least one mark
   **name**, and either classes or a goods description — a customer profile can supply the last one.
   `msgId` is optional: it threads the reply into the original email, and a job without one is warned,
   not refused. A minimal neutral example:

   ```json
   {
     "id": "job-2026-0001",
     "msgId": "<intake-2026-0001@example.com>",
     "forwarder": "alex",
     "forwarderEmail": "alex@example.com",
     "forwarderDomain": "example.com",
     "marks": [{ "ref": "TM-0001", "name": "IRONWHISK", "classes": [9, 42] }],
     "goods": "cloud software for weather analytics",
     "jurisdictions": ["US"],
     "product": "knockout-search"
   }
   ```

   **`product` names which of the four searches you are ordering, and the example names it on purpose.**
   It orders a **Knockout search over one territory** — the cheapest of the four and the fastest way to
   prove the install works end to end. It is not the product you would order for a real matter; it is the
   one that answers "does this run at all" in minutes rather than hours. Change it when you have a matter.

   | product | case law | native language |
   |---|---|---|
   | `knockout-search` | no | not offered |
   | `global-preliminary-search` | no | not offered |
   | `multi-country-focus-search` | no | offered |
   | `full-country-search` | **yes** | **automatic** |

   **Omit it and the territories decide — in a direction that will surprise you.** No `jurisdictions`
   gives you `global-preliminary-search`; two or more give `multi-country-focus-search`; and naming
   **exactly one country** gives `full-country-search`, the deepest of the four, which turns case law on
   and runs the native-language investigation automatically.

   **That is why the example above names `product` even though it lists one territory.** Delete the
   `product` line and this job — one country — becomes a `full-country-search`: the deepest of the four,
   case law on, native-language investigation running, hours instead of minutes. Narrowing the scope to
   make a first run smaller orders **more** work, not less, and naming `product` is what stops the scope
   deciding for you. An unknown value is a clarify, never a silent substitute.


3. Run the pipeline:

   ```
   npx clearotron run --job job.json
   ```

   **The example above is sized in minutes; a real clearance is sized in hours.**
   The engine sizes a knockout search at 5 to 10 minutes — which is what this job orders — and a clearance
   at up to 2.5 hours.
   The example run in `demo/` took 2 h 35 m, and it is a clearance, not a knockout. A
   single stage of a clearance can legitimately run 45 minutes — let it finish.
   [How long a run takes](#how-long-a-run-takes) below gives the provenance of each figure.

   This run sends the matter off the machine — the mark, its classes, the goods wording, and the
   client's context reach a reasoning provider and Perplexity, and the mark and its variants reach your
   register. Before the first live matter, read
   [what leaves the machine](docs/architecture/09-security-and-data.md#what-leaves-the-machine).

The driver resolves the profile, runs the reasoning stages as headless CLI turns, gates delivery on
its internal refutation verdict, and then:

- **publishes** the report (HTML + Markdown) and an Excel audit into `CLEAROTRON_REPORTS_DIR`; and
- writes **`_driver/delivery.json`** in the run directory — a self-contained handoff packet:

  ```
  { runId, agent, forwarder, forwarderEmail, msgId, conversationId, subject, emailBodyHtml, url,
    verdict, markName, whatsappTo, whatsappText }
  ```

  This packet **is the delivery contract**: an integrator's channel wiring reads it and sends the report
  by email/chat. The engine never sends messages itself — the report is already published regardless.
  Failures, intake rejections, duplicate skips and late-bind acks ride the same outbox seam as
  self-contained event packets — the full catalog + the integrator loop is
  [docs/DELIVERY.md](docs/DELIVERY.md); intake (the enqueue CLI, the job JSON, queue lifecycle,
  dedup) is [docs/INTAKE.md](docs/INTAKE.md).

### How long a run takes

Hours, not minutes.

**One measured run.** The sample in `demo/` took **2 h 35 m** from `startedAt` to
`deliveredAt` (`run/status.json`) — one mark, two classes, one register, 214 register calls, 37 model
dispatches. That is 1.29× the 2 hours the run quoted itself.

**What the engine quotes.** A knockout search is sized at 5 to 10 minutes. A clearance starts at 1.5 hours
and runs to 2.5 hours — one range for every clearance, whichever lanes it carries
(`driver/effort-model.mjs`). The quote used to add half an hour each for the case-law reading, the
native-language lane and a single-territory deep-dive; the delivered walls refuted that, so the adders
were removed.

**What the stages declare.** Every stage carries a timeout — the longest is 45 minutes, and the 16
together sum to 5.6 hours (`driver/stages.mjs`). Fan-out members run in parallel and a retry adds to
the wall, so the sum sizes the stages rather than the run.

What moves the wall is the fan-out: how many search axes the register plan compiles, whether the
marketplace sweep splits in half, how many findings need cards, and how many registers the product
sweeps. Every run records its own quote against its actual wall in `status.json`. A stage still going
after half an hour is not hung — the longest stage timeout is 45 minutes, and the engine hard-kills
anything that overruns its own.

### If a run stops before it delivers

A clearance run takes hours, so it will sometimes stop part-way: you close the lid, the machine reboots,
or the model provider caps you mid-run. **Nothing is lost.** Every finished stage stays on disk and a
resume re-runs only what is missing or invalid.

The command that continues a run is printed whenever a run ends badly — copy the line it gives you:

```
node /path/to/driver/pipeline.mjs --job /path/to/job.json --resume <codename>
```

A run stopped by a **provider rate limit** or parked for **automatic recovery** does not need you at all
— it resumes on its own as soon as its window passes, provided something is watching for it. On a server
that is the systemd units in `driver/systemd/`. Everywhere else, run the watcher yourself:

```
npx clearotron run-queue --watch
```

That polls every 90 seconds for queued jobs and for parked runs whose window has elapsed, and it resumes
them. It also notices when the machine has been asleep, so a cap that lifted overnight is picked up when
you open the laptop rather than at the next scheduled poll. Leave it running alongside your work; `Ctrl-C`
stops it, and anything still parked waits for the next time you start it.

## 6. Start the product on this machine

Everything above runs the engine from a job file. This is the product: a portal you sign in to, order a
clearance from, and read the report in.

**Plain `npx clearotron start` runs in the foreground and stops when this terminal closes** — Ctrl-C, a
dropped SSH session, a shut laptop lid ending the session: the portal goes with it. That is the right
shape for trying things. To keep it running when the window is gone:

```
npx clearotron start --background     # the same product, as user services that survive the terminal
npx clearotron status                 # is it up, and on which ports
npx clearotron stop                   # stop it and give the box back — plain `start` works again
```

`--background` never touches the assistant connector: `npx clearotron connect` opens that door
and `npx clearotron disconnect` closes it, separately and on purpose.

**If anything else on this host already runs this product, set its ports first.** The portal (18802)
and the engine door (18790) are **fixed defaults shared by every checkout on a machine**, so a second
instance collides with the first and `start` refuses rather than quietly moving. Give it its own pair
before the first start:

```
PORTAL_SERVICE_PORT=18820 TRADEMARK_MCP_HTTP_PORT=18821 npx clearotron start
```

A test instance beside a live one needs more than two ports — §8, *Two instances on one machine*, is the
whole boundary. On a host running nothing else, ignore this and carry on:

```
npx clearotron start
```

One command. It starts the portal and the engine door the portal's Start button calls, waits until both
answer, and prints one address to open. `Ctrl-C` stops both. The second run asks nothing.

**This is not `npx clearotron demo`, and the two are not interchangeable.**

| | `npx clearotron demo` | `npx clearotron start` |
|---|---|---|
| what it is | a finished report, replayed | the running product |
| credentials | none | whatever a real run needs (§3) |
| model calls | none | yes, once you order a clearance |
| what you can do | read | sign in, configure, order, read |

Use the demo to see what this system produces. Use `npx clearotron start` to run it.

### What the first start does, once

- Generates `PORTAL_SECRET` and `TRADEMARK_MCP_TOKEN_SECRET` and **appends** them to `~/.config/clearotron/.env` at
  mode 600. Append, never rewrite: that file also holds the credentials `npx clearotron install` collected.
- Creates `~/trademark/` — `pool/`, `workspace/`, `queue/`, `outbox/`, `locks/`, an empty grants file,
  and a small git repository for saved searches. Same base directory `npx clearotron install` uses, so whichever
  of the two you ran first, the other finds the same install. Move it with `npx clearotron start --base <dir>`.
- Mints your sign-in passphrase and **prints it once**. Write it down. It is stored as a scrypt digest in
  `~/trademark/portal-local-credential.json`, nothing can read it back, and no later start reprints it. To
  get a new one, run `clearotron passphrase --reset`. An install that has been signing in with
  `~/.cordillera/portal-local-credential.json`, which earlier versions shared between installs, keeps it.

### Who you are

You sign in as `<your-username>@localhost` unless you say otherwise:

```
npx clearotron start --user you@example.com
```

Setup does not ask for the address: it writes the local-account form to `.env` and shows it once, in
its summary, as the address that signs in. An address already in `.env` is kept. It is also the first
person on this install: the first start writes it into the grants file (`CLEAROTRON_ACCESS_FILE`, §8)
with access to everything and both permissions, Run clearances and Manage. Setup asks for your
organisation's name, and the same start files it there as your first organisation. The address admits
nobody else at its domain; enrolling anyone else is that same file, exactly as on a hosted instance.

**No authentication is switched off to make this work, and none can be.** Both doors prove who the
caller is — the portal by passphrase and a signed session cookie, the engine door by a mandatory
access key that `npx clearotron start` mints in memory at every start and never writes down. The key is scoped to
two verbs and capped to the customers this install knows about. The `*_AUTH_DISABLED` switches
elsewhere in this repository are for something else and are written into the child environment as `0`.

### Signing in, and putting your own provider in front

The passphrase above is the **local** door: one address, no identity provider, and the right answer for
a single-operator box. The other door is **auth-proxy** — an OIDC or JWT proxy in front of the portal
that proves the caller and passes the identity through. Which door runs and what each proves is stated
once in [docs/SECURITY.md](docs/SECURITY.md); the procedure for standing the second one up, with a
worked example, is [docs/PORTAL.md](docs/PORTAL.md#putting-your-own-login-provider-in-front).

**Leaving `PORTAL_AUTH_MODE` unset selects auth-proxy, not local.** An install that sets nothing and has
no proxy in front is the one shape to avoid — the portal refuses to start without an issuer. Say
`PORTAL_AUTH_MODE=local` if you want the passphrase door.

### It drains its own queue

`npx clearotron start` supervises a worker alongside the portal, so ordering a clearance from the portal
runs it.

The consent did not move and did not weaken. The portal prices the run, quotes how long it takes, and
asks you to confirm before anything is spent — that confirmation is the moment money is committed.
Before the worker ran, that promise was untrue in your favour: confirming queued the job, and nothing was
spent until you gave a second command in another terminal.

If you want the old separation — order here, drain deliberately over there — start with `--no-worker` and
run the queue yourself:

```
npx clearotron start --no-worker
npx clearotron run-queue --watch
```

A queued job whose worker is not running says so on the portal rather than sitting at "Waiting to start".

### What it deliberately does not do

**It does not configure a deployment.** A hosted instance is systemd units, a reverse proxy and an
identity edge (§8 for what separates one instance from another); this command touches none of them and
is not a way to set them up.

**And it does not keep this install up to date.** Nothing here pulls; your checkout stays on the commit
you cloned until you run `npx clearotron update`, which fast-forwards and reinstalls dependencies. It
refuses over a configuration store kept inside the checkout, and it refuses while a run is queued or in
flight — `npm ci` rebuilds `node_modules` under whatever is running, and a clearance assembled from
halves of two builds does not fail, it answers wrongly.

**To make that automatic**, this repository ships a unit and an hourly timer that run exactly that
command, with the same two refusals. They are generic — the checkout path comes from your
`EnvironmentFile` — and they neither start nor stop a queue drainer:

```
cp driver/systemd/clearotron-deploy.{service,timer} ~/.config/systemd/user/
systemctl --user daemon-reload && systemctl --user enable --now clearotron-deploy.timer
```

A busy box simply skips: the service exits clean when a run is live and the next firing tries again.

**`npx clearotron doctor` reports how far behind this install is**, beside everything else it checks. It
does not fetch, so the count is against your last fetch — which it says. An install that is not a git
checkout, or a branch with no upstream, says that instead of reporting a number it cannot compute.

**A current checkout is not a current deployment**, and `doctor` reports that separately. Pulling moves
the files; a long-running service keeps executing the tree it started with until something restarts it,
so a box can be honestly up to date and still answer from code that is no longer on disk. `doctor` names
any running program that started before your checkout last moved. **It does not restart them** — which
supervisor owns a service is a property of your deployment, not of this checkout — so restarting is
yours to do, and now yours to know about.

### Ports, and two warnings you will see

The portal is on 18802 and the engine door on 18790, both loopback, and both are **fixed defaults for
every checkout on the host** rather than per-install values. They move separately: the portal with
`npx clearotron start --port <n>` or `PORTAL_SERVICE_PORT=<n>`, the engine door with
`TRADEMARK_MCP_HTTP_PORT=<n>`. A port already in use produces a sentence saying which port and which
variable to change, before anything starts — it will not quietly pick another, because whatever sits in
front of it is still addressed to the old one.

Two lines on a fresh install look worse than they are:

- *"skills overlay unset — customer risk frameworks will resolve to this repo's demo fixtures."* On a
  demo install they **are** the demo fixtures, and the warning is correct to fire: it exists so that a
  real deployment never shows a synthetic framework as a client's own. It goes quiet once
  `CLEAROTRON_CUSTOMERS_DIR` and `CLEAROTRON_INSTRUCTIONS_DIR` point at your own config store (§4).
- *"saved searches ON — store=…"* names a directory under `~/trademark/`, not your repository. Editing a
  **customer profile**, however, still commits into this checkout until `PROFILE_REPO_ROOT` names a
  config store of your own. Point it at one before you edit a profile you intend to keep.

`driver/dev-portal.mjs` is **not** this. It is a loopback pool browser for people working on the engine,
its own header says never to expose it, and nothing here starts it.

## 7. Run the MCP interrogation server

The MCP server lets an external AI app read and question completed runs. Two entrypoints share one tool
set:

- **stdio (local, full tools):**

  ```
  node mcp-server/server.mjs
  ```

  Register it as a stdio MCP server in your desktop/CLI AI app (Claude Desktop/Code, Cursor, …). It
  serves the read tools (list/read/trace/search/telemetry/coverage) plus a gated, single-step "what-if"
  that re-runs one stage in a sandbox.

- **HTTP face (remote):**

  ```
  node mcp-server/http-server.mjs
  ```

  A Streamable-HTTP surface a remote user adds to their chat app by URL.

  **What it serves depends on who is asking, and one half of it spends money.** A caller the edge
  identifies gets the **read** tools (list/read/trace/search/telemetry/coverage) — no spend, no shell.
  A caller presenting an **ops token** also gets the **write verbs**: `start_run`, `stop_run`,
  `feed_context`, `mark_sent`, `ack_event`. **`start_run` bills a real search.** The write half is
  gated on that credential and account-capped (§8, *Ops tokens*), and it has its own lower rate bucket
  — but it is part of this surface, and a threat model built for a read-only endpoint is the wrong one
  for it.

  It binds loopback and is **fail-closed**: authentication is on unless you explicitly set
  `TRADEMARK_MCP_AUTH_DISABLED=1` (local testing only), it validates the auth proxy's JWT and gates by
  email domain, and it audit-logs and rate-limits.

  **Only now, with that in view:** put it behind **your own** reverse proxy / tunnel / identity
  provider — that ingress is integrator-supplied. Whoever can reach this URL and hold an ops token can
  start billable clearances, so scope the ingress and the token to that, not to reading. A worked provisioning
  runbook and end-user connection guide live in `mcp-server/remote/REMOTE-SETUP.md` and
  `mcp-server/CONNECT.md`; adapt the hostnames and IdP policy to your deployment.

  **That paragraph is about the STAFF door, and only it.** Whoever reaches it can start billable
  clearances, so leaving its exposure to a deliberate decision is the right posture. The **client
  connector** is a different door with a different answer, below — do not read the sentence above as
  covering both, which is what this section used to let a reader do.

### The client connector's ingress is not integrator-supplied

The client connector is the door a company's assistant talks to, and it
is **part of the product** rather than something a deployment invents. A reader who reaches the
Use-your-AI page and finds Connect buttons that do nothing has been failed by the install, not by
their own integration work.

**Two shapes, and the line between them is what your assistant can do — not where it runs.** Ruling
2026-09-03, on the vendor's own documented behaviour:

1. **Clearotron is installed on the machine the assistant runs on** — Claude's desktop app, Claude Code,
   Codex, the ChatGPT desktop app, an agent that runs commands. The assistant spawns the server over
   stdio. No address, no key, no network, no ingress. `npx clearotron start` prints the one line to
   paste, and `npx clearotron connect --where here` hands it over per assistant.
2. **Clearotron is running somewhere else** — a server, a cloud machine, anywhere the assistant is
   not. These need **a publicly reachable HTTPS address**, plus a key made for the person connecting.
   Always. Claude (app, web, Cowork and mobile), ChatGPT on the web, Perplexity and other agents only
   ever connect this way; Claude Code and Codex can connect either way. `npx clearotron connect
   --where elsewhere` makes the key and prints the steps for the assistant you name.

Without `--where`, `connect` asks when both answers are possible, and `--client <name>` on its own keeps
the answer that assistant had before: a key for Claude, the local line for Claude Code and Codex.
`npx clearotron disconnect` takes the same `--where`.

**A loopback address is never an answer for shape 2, and that is not about your network.** A remote MCP
connector is reached **from the vendor's cloud**, never from the reader's device. Anthropic's own help
centre states it: *"Claude connects to your remote MCP server from Anthropic's cloud infrastructure,
rather than from your local device. This is true across every Claude client, including claude.ai, Claude
Desktop, Cowork, and the mobile apps … Your MCP server must be reachable over the public internet."*
So an install behind `ssh -L` or an editor's port forward serves shape 1 perfectly and cannot serve
shape 2 at all, however the reader reaches the portal. `npx clearotron connect` says so plainly rather
than printing an address that will be rejected.

**The address is set once, at install.** `npx clearotron install` asks for it — *"the address clients'
assistants reach this install at"* — and writes `CLEAROTRON_CLIENT_MCP_URL`, which is the single value the
Use-your-AI page, a report's Ask-your-AI control and `doctor` all read. Leave it empty on a local
install: every one of those surfaces then shows its honest empty state, which is correct for a machine
with no public address. Changing it later is editing that one setting and restarting.

Whatever you provision, `npx clearotron doctor` will tell you whether the published address actually
answers — being set is not the same as being reachable, and the page and the report both render from
the value being present alone. An address that does not answer is reported as a problem with the
reason, never as configured.

### If you already have a tunnel, use it — and add one route

Most operators reaching this point already run a tunnel for the portal. **Do not start a second one.**
Your existing tunnel points at the **portal**, which is a different service on a different port from the
client connector, so the connector needs one route of its own. The better shape is the **same hostname
with a `/mcp` path**: one certificate, one tunnel entry, nothing extra to provision.

Whichever proxy is in front, the origin re-validates its JWT, and the install reads the tunnel's
dashboard-side table rather than provisioning it. A dashboard-managed tunnel — Cloudflare's, for
example, where `cloudflared tunnel run` takes a token and keeps no config file on disk — is not
writable by this product at all. The route is yours to add, in whatever dashboard your provider gives
you.

**Two ways to protect this route, and both are supported.**

- **A key, and nothing in front.** The simplest, and what a fresh install gives you. The connector
  refuses every caller who does not hold one, so the key is the whole gate by design.
- **Your identity provider in front.** What matters is the shape of the answer a non-browser request
  gets: an **OAuth challenge and a discovery document**, which assistants follow, rather than a browser
  redirect. Cloudflare Access, for example, speaks that flow, and it is what one production deployment
  served; **service tokens** are the alternative for clients that cannot do OAuth. Set
  `TRADEMARK_MCP_AUTH_MODE=cf-access` so the origin re-validates the proxy's JWT rather than trusting
  it — the mechanism is generic, whichever proxy is in front.

**One process, two doors.** A deployment that serves both people arriving through a tunnel and programs
on the same machine no longer needs to run this service twice. Set `TRADEMARK_MCP_KEY_SOCKET` to a
socket path and the service listens for a scoped access key there, while its network port continues to
take the proxy identity and never honours a key. A tunnel forwards to a port and cannot reach a socket,
so the key path is not addressable from outside the machine; who may present a key is stated by the
socket's permissions, which the startup lines print beside its path.

This replaces a **second unit run for its authentication shape** — a loopback port in key mode beside
the tunnel-fronted one — and nothing else. It is not the test-instance-beside-a-live-one arrangement
described in §8: that separation is about data and ports, it is unaffected, and its seven variables are
still all required. Removing the auth-shape duplicate is a deployment decision and nothing here does it
for you.

**Do not set `TRADEMARK_MCP_AUTH_MODE=token` alongside the socket.** That mode makes the network port
take a key as well, which is what the socket exists to avoid; the service refuses to start and says so.

**Put the socket somewhere only the service's own group can write.** The socket's own permissions decide
who may *present* a key. Whether the socket can be *replaced* is decided by the directory holding it — a
process that can remove the file can bind its own listener on the same path, and callers would then
present their keys to it. That is a different permission from the socket's and it is the one worth
checking. The service refuses to start if that directory is writable by everyone without the sticky bit,
and prints the directory's mode beside the socket's on its startup line so the number is readable without
going to look.

> ⚠ **What does not work is an INTERACTIVE-only sign-in policy on a route an assistant must reach
> without a browser.** Such a policy demands a login the vendor's servers cannot complete: they present
> a credential and get a login page back, and the connection fails with nothing useful said on either
> side — the assistant reports it could not connect while the tunnel reports a healthy request.

**Then confirm the address from outside, and use the one that answered.** Never the one you remember —
hostnames that were provisioned once and never used are exactly the ones that do not resolve, and the
failure appears later as a client whose assistant cannot connect. Ask from off the box:

```
curl -sS -o /dev/null -w '%{http_code}\n' https://<your-host>/mcp
```

Anything that comes back — including a 401 or a 405 — proves the route reaches the connector; a
connection error or a login page does not. Put the address that answered into the installer's question
(or `CLEAROTRON_CLIENT_MCP_URL`), then `npx clearotron doctor` and read the connector line.

Smoke-test either face offline:

```
npm test -w mcp-server        # fixture-backed tests
node mcp-server/smoke.mjs     # spawns the real stdio server against the fixture
```

## 8. Access control and instance isolation

**The access model is stated once, in [docs/SECURITY.md](docs/SECURITY.md)** — who may see which runs,
what an unset guest list means on each face, and which door proves identity. Read it there; do not
infer it from an install step. The operational side — issuing and rotating grants and ops tokens — is
[docs/architecture/06-operations-runbook.md](docs/architecture/06-operations-runbook.md#access-control-and-instance-isolation).

What belongs here is only what you set at install time.

**The guest list.** `CLEAROTRON_ACCESS_FILE` turns account scoping on for **every face at once** — the
portal, the MCP read face, and the client connector. `npx clearotron start` (§6) writes one into its
state directory the first time it runs: you, with access to everything, your organisation if setup was
told its name, and nobody else yet.
[examples/grants.example.json](examples/grants.example.json) is a runnable guest list over the demo
clients.

**Giving someone access.** `npx clearotron grant add` writes the same file the portal's People page
writes:

```
npx clearotron grant add <email> --tenant <organisation> --accounts <key,key|*> [--run] [--manage]
```

`--accounts '*'` is the whole organisation, including companies filed under it later. `--run` lets the
person start and stop clearances; `--manage` lets them add people and companies and change settings.
With neither, they can see what their access covers and start nothing.

**Keys for people.** `npx clearotron grant` enrols someone; it decides what they may see and issues
nothing. The key their assistant actually presents comes from a different verb:

```
npx clearotron key issue <email> [--accounts a,b] [--ttl-days 90]
```

It is printed once, on stdout, and stored nowhere — possession is the credential. Enrol first: the key
does not widen anyone's reach, because the grants file decides that.

**Ops tokens are not that, and they have no verb yet.** Reading a finished run needs no token beyond the
identity your edge proves. Three verbs do: `start_run`, `stop_run` and `feed_context`. They write into
the data plane, and `start_run` bills a real run. The only thing that mints one is a raw script:

```
node mcp-server/mint-token.mjs --scope ops --sub <name> --ttl-days 30 --verbs start_run,feed_context
```

Said plainly rather than dressed as a verb, because the distinction costs real time: **`npx clearotron
key issue` mints ACCOUNT keys only**, and `npx clearotron grant` mints nothing at all. This page
previously sent readers to `grant` for an ops token, which is why the sentence is now this long.

**When you have to re-mint one.** Not on the ordinary path any more, and this paragraph used to say
otherwise. The portal takes its ops credential afresh at the start of each call, capped to the company
roster as it stands, so a company created after the portal started can run a clearance and stop one
without anybody re-minting anything.

The pinned credential minted at startup is still the fallback, and it is where this matters. If the
signing secret cannot be read or the company store cannot be listed, the portal uses that one rather than
widening the cap to get the call through — so its account list is frozen at the moment it was minted, and
a company created since is refused at the door with `your grant [...] does not include account "..."`.
The portal says so in its log when it happens. That is when you re-mint by hand, with the new list, and
update the environment.

### Putting a surface behind your identity provider

One Access application **per audience**, and the audience is what the origin re-validates. Get this
wrong and every layer reports healthy while nothing can connect.

| Surface | Typical hostname | Audience variable | What its policy should admit | Challenge it must emit |
|---|---|---|---|---|
| Portal | `trademark.example.com/portal` | `CLEAROTRON_OIDC_AUDIENCE` | your staff, interactively | a browser redirect is fine — a person is at the keyboard |
| Staff MCP door | same host, `/mcp` | `CLEAROTRON_OIDC_AUDIENCE` | staff, **non-interactively** | an OAuth challenge, or a service token |
| Client connector | `clients-mcp.example.com/mcp` | `CLEAROTRON_CLIENT_OIDC_AUDIENCE` | your clients' assistants | an OAuth challenge, or a service token |

**The client door needs its own audience, and it refuses to start without one.** Two separate refusals,
both fail-closed and both printed with the reason:

- give it the staff audience and it refuses — *"the client surface MUST use a distinct CF Access
  application AUD … this would collapse the client/staff boundary"*;
- give it none at all, with authentication on, and it refuses too. A door that cannot tell who is asking
  does not open in a degraded mode.

Neither is a limitation to work around. If you want the client door on a key with no proxy in front,
that is `CLIENT_MCP_TOKEN_ONLY=1` — a different supported shape, not a way past these.

**Check the challenge form, not just reachability.** Two applications of the same type answer differently,
and only one shape works for an assistant:

```
curl -sSI https://<host>/mcp | grep -i 'www-authenticate\|^HTTP/'
```

- `401` with `www-authenticate: Bearer realm="OAuth"` — an assistant can follow this. Correct.
- `302` with a browser-redirect challenge (`www-authenticate: Cloudflare-Access`, for example) — an
  assistant's connection check reports *not found*, and every layer below still looks healthy.

This is a property of the application at your provider, not of this product, which is precisely why it is
easy to lose an afternoon to. Set `TRADEMARK_MCP_AUTH_MODE=cf-access` on a fronted door so the origin
re-validates the proxy's JWT.

#### The two settings that decide whether an assistant can sign in at all

Both live at your provider, neither is visible from this product's side, and **each fails in a different
shape**. Named here because a reader following this page from scratch has to find them in a console, and
"enable the OAuth option" is not a thing anyone can search for.

**1. The application must issue OAuth tokens itself, rather than sign a browser in.** That is the general
rule for any auth proxy: an MCP route has to answer with a Bearer challenge and serve
`/.well-known/oauth-authorization-server`, never a redirect to HTML. On **Cloudflare Access** the control
is the application's **Advanced settings → Managed OAuth**, and it is **OFF on a newly created
application**. Off, the route answers `302` with `www-authenticate: Cloudflare-Access` and the standard
discovery paths redirect too. On, it answers `401` with `www-authenticate: Bearer realm="OAuth"` and
serves the discovery document. Only the second is followable by an assistant, which is what the `curl`
above measures.

**2. The application must allow the vendor's own redirect address.** This one is invisible until late:
with the allowed-redirect list empty, dynamic client registration refuses every cloud assistant, and the
only symptom is the connector failing *after* the browser opens — which reads as a different bug
entirely. **The localhost and loopback toggles do not cover this**: they permit clients on your own
machine, and an assistant's sign-in comes back to its maker's cloud. On Cloudflare Access the control is
the application's **Allowed redirect URIs**. The addresses, measured 2026-09-04:

```
https://claude.ai/api/mcp/auth_callback
https://claude.com/api/mcp/auth_callback
https://chatgpt.com/connector_platform_oauth_redirect
```

`npx clearotron doctor --probe-connector` asks your own door whether each of those can register, with a
localhost control first so a broken endpoint is never reported as a policy refusal. It is opt-in because
each successful attempt creates a throwaway OAuth client on your account — every other `doctor` check
writes nothing.

> ⚠ **Deleting and recreating an application silently loses both settings AND changes its audience.**
> One cause, two unrelated-looking symptoms: sign-in stops working, and the origin's configured audience
> goes stale. Nothing on either side says so. If a connector that used to work has stopped, check
> whether the application was recreated before you change anything else.

**Seeing what a client sees.** There is no "view as" screen. The documented route is a **client-scoped
connector key**: issue one for that client with `npx clearotron key issue`, point an assistant at the
client connector with it, and you get exactly that client's scope. Changing `PORTAL_LOCAL_USER` to
impersonate someone is not the answer — local sign-in is one user by design, and the service refuses to
start if the credential does not match the configured address, so you lose your own access and take the
deployment down to answer a question.

**Two instances on one machine.** The environment is the whole isolation boundary, and **seven**
variables draw it — four for the data, three for the doors.

The four that separate what an instance can *reach*: `CLEAROTRON_REPORTS_DIR`,
`CLEAROTRON_ACCESS_FILE`, and the two data-plane directories — `CLEAROTRON_QUEUE_DIR`, where jobs
arrive, and `CLEAROTRON_OUTBOX_DIR`, where delivery packets are written for the forwarder. Point a test
instance's four at a test tree and it cannot reach production's pool, roster or queue.

The three that separate what it *binds*: `PORTAL_SERVICE_PORT` (18802), `TRADEMARK_MCP_HTTP_PORT`
(18790) and `CLIENT_MCP_HTTP_PORT` (18811). These were missing from this list and the omission is not
cosmetic: a second instance with all four data variables correctly set still crash-loops, because both
instances bind the same three defaults and the second one to start cannot listen. The symptom is a unit
that fails at boot, which reads as a broken install rather than as a port already in use.

Set all seven. Nothing else separates them.

A deployment that once ran the service twice for a different reason — one door needing a key and the
other a proxy identity — no longer has to; see *One process, two doors* in §9. That is an
authentication arrangement and has nothing to do with this one. The seven above are still all required.

## 9. What the integrator supplies

The engine is complete as a clearance-and-report producer. A deployment adds:

- **Channel delivery** — the code that reads `_driver/delivery.json` and actually sends the report by
  email/chat, plus whatever intake writes the job files.
- **Customer bundles** — the private `CLEAROTRON_CUSTOMERS_DIR` config store and any per-customer risk
  frameworks or worked-examples the profiles point at.
- **Remote ingress** — if you expose the MCP HTTP face, the reverse proxy / tunnel / IdP in front of it.

Everything above is optional to *evaluate* the engine (the bundled demo profiles and a local pool
directory are enough to produce a report end-to-end); they are what you add to run it as a service.

### Wiring channel delivery

The engine's contract ends at: run the clearance, publish the report, write `_driver/delivery.json`,
and drop a marker in the outbox directory. Sending is yours. `docs/DELIVERY.md` carries the packet
catalogue and the loop; the shape below is what the repository used to ship as a reference unit pair,
recorded here because the units retired with the path-watcher posture and the worked example should not
retire with them.

A courier is a loop over one directory, and it needs no unit of its own if you already run one:

1. **Watch the outbox** — `$CLEAROTRON_OUTBOX_DIR`. A `.pending` file appears there when a run
   finishes. Read the variable rather than guessing the directory: the wizard writes `<data
   base>/outbox`, but an unset variable falls back to `prelim-outbox` under the workspace root
   (`driver/driver.config.mjs`), so the two are not the same path and only one of them is where your
   markers are.
2. **Read what it points at.** A success marker is a few bytes naming the agent, *not* the payload —
   the payload is `_driver/delivery.json` in that run's pool directory, carrying `emailBodyHtml`,
   `whatsappText`, `url`, `verdict` and `markName`. A `.failed.pending` marker is the exception and
   carries its JSON inline. Treating a success marker as the payload is the mistake this note exists
   to prevent: it is 7 bytes and it looks empty.
3. **Send, then rename the marker.** Claim it before sending and re-queue on failure; nothing else
   will retry for you.

**An unclaimed marker is the documented terminal state, not a stall.** A box with no courier
accumulates `.pending` files while every report behind them is published and readable. Do not read that
count as undelivered client work.

## 10. Licence, and what it does not cover

This software is GNU Affero General Public License v3.0 — `LICENSE` at the repository root. That covers
the orchestrator, the provider adapters and the documentation.

AGPL §13 matters if you run it as a network service: anyone who interacts with your instance is owed
the source of **that** instance. Every network face answers with its own running commit — the portal's
About page, the MCP server's `server_info`, and `npx clearotron start --license`.

**Everything §1 told you to bring is outside it.** Read this before you count the licence as your
answer on any of them:

- **The reasoning CLI is proprietary third-party software.** Every reasoning stage spawns the Claude
  CLI or the Codex CLI as a child process. You install it and sign in to it, and your use is governed
  by that vendor's terms. AGPL-3.0 grants you nothing over it, and this repository redistributes no
  part of it.
- **Register and research providers are your own agreements.** EUIPO, the USPTO bulk product,
  `PERPLEXITY_API_KEY`, CourtListener, and the subscription registers (Corsearch, Clarivate, Signa)
  each sit on terms you accept directly with that provider. The adapters in `providers/` are ours and
  are licensed with the rest of the code; what they connect to is not.
- **npm dependencies carry their own licences.** `package-lock.json` is the resolved set, and each
  package's own licence travels with it in `node_modules`.

The licence covers the code and grants no rights in the names or marks — see `TRADEMARKS.md` for
running a deployment under your own brand.
