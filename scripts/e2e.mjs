#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// e2e.mjs — run, watch, check and clean up the E2E scenarios. TEST INSTANCE ONLY.
//
//   node scripts/e2e.mjs list
//   node scripts/e2e.mjs run      <ID> [--stale]
//   node scripts/e2e.mjs status
//   node scripts/e2e.mjs report   <ID> [--round <token>]
//   node scripts/e2e.mjs teardown <ID> [--waive-unread]
//
// A SCENARIO CAN BE RUN TWICE ON ONE COMMIT — that is what a noise-floor pair is. Each invocation
// is a ROUND, identified by the token `run` prints and appends to `_e2e-doors-<ID>.json`. `report` reads
// exactly one round (the newest, or the one `--round` names) and lists every round it knows, so the
// round it excludes is nameable rather than lost. `run` says out loud, before it queues, when the
// previous round reached a terminal nobody has reported.
//
// ── why this is thin ─────────────────────────────────────────────────────────────────────────────────
//
// The queue, the runner timer and the pipeline already do the work. This writes the right job through
// the right door and reads what came back. Everything it knows about a scenario lives in
// <store>/<ID>.json — data, not code — so adding a scenario is a JSON file, not a patch.
//
// ── it refuses to run against production ─────────────────────────────────────────────────────────────
//
// The single most important line in this file. A scenario enqueued into the production queue would run
// a synthetic matter as a real one: it would consume a real account's allowance, write a real matter
// ledger row, and put a fake run in the archive that replay-archive.mjs validates against as real client
// matter. So the pool root is checked before anything else happens, and there is no override flag. What
// counts as production is `driver/production-pool-guard.mjs`, not a rule restated below.

import "../shared/env-local.mjs";   // — FIRST: applies the CLEAROTRON_* translation before any module-top
// capture evaluates. Reads no `.env` here — that load is gated on isCliEntry(argv[1]).
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdtempSync, rmSync, mkdirSync, renameSync, statSync } from "node:fs";
import { join, dirname, resolve, basename } from "node:path";
import { driverDir } from "../shared/driver-dir.mjs";   //
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";

import { mcpToolCall } from "../driver/portal-mcp-client.mjs";
// The closed depth registry. Assertions that ask "was this claim within the configured depth" must
// resolve the depth the same way every other door does — never from a word the scenario file typed.
import { reportIdentityFor, ORDERABLE_PRODUCTS, RETIRED_PRODUCTS } from "../driver/search-policy.mjs";
// The queue's filename vocabulary, from the module that owns it. created that module because the
// vocabulary "has now been written down three times and the copies disagreed"; 's first draft wrote it
// down twice more here, from memory, and false-alarmed on every prose sidecar of every live job. Sourced,
// so the next suffix the engine adds reaches this harness the day it lands. queue-markers.mjs is PURE —
// importing it pulls in nothing, which is why this file can have it and cannot have runner.mjs (that chain
// reaches driver.config.mjs, whose unset-env defaults are PRODUCTION).
import { isLiveQueueMarker, isQueueSidecar, liveQueueState, LIVE_QUEUE_STATES, TERMINAL_QUEUE_SUFFIXES }
  from "../driver/queue-markers.mjs";
// The ONE ledger-path calculation. This file held a THIRD copy, derived from the pool root
// (`join(POOL_ROOT, "..", ".matter-ledger.jsonl")`) rather than the queue — so a deployment that put the
// pool anywhere but beside the queue would have had teardown prune a file that was not the ledger, and
// leave the real one to park tomorrow's re-run as a duplicate. usage-ledger.mjs is a pure leaf too
// (node:fs + node:path + queue-markers.mjs), so it drags no driver machinery in either.
import { matterLedgerPath } from "../driver/usage-ledger.mjs";
// Teardown asks whether a process is actually producing a run before it rewrites the record that says so.
import { claimLivenessForCodename, claimForbidsDestruction } from "../driver/claim-liveness.mjs";
// The store admission sweep (, moved here from a bundled-store CI test when the bundled scenarios
// were deleted): every job block in the configured store must be treated by the doors exactly the way
// its scenario declares, and the check has to run where the store exists — CI cannot read it.
import { validateJob } from "../driver/enqueue-schema.mjs";
import { doorGates, resolveForDoor } from "../driver/door-gates.mjs";
// — the plan-row term screen, shared with the driver rather than restated here, so the harness
// can never drift from what the plan freeze and the executor enforce. PURE (no node imports).
import { entryTermIssues } from "../providers/_shared/term-shape.mjs";
// The owner's turnaround benchmarks. The BAND owns the number and a scenario file cannot carry
// one — see the lint rule below. Another pure leaf with zero imports of its own, for the same reason
// queue-markers.mjs is: nothing in this file may reach driver.config.mjs.
import { bandForPipeline, benchmarkMinutes, benchmarkSource, TURNAROUND_BANDS, BAND_IDS }
  from "../driver/turnaround-bands.mjs";
// — THE DOORS RECEIPT IS A HISTORY OF ROUNDS, and it lives in a pure leaf for the same reason
// queue-markers.mjs and usage-ledger.mjs do: scripts/score.mjs needs the receipt path, the token parser
// and round discovery, and it is deliberately OFFLINE — importing this file would drag portal-mcp-client,
// enqueue-schema and door-gates in behind them. The receipt format and the token parser therefore exist
// ONCE, in node:fs + node:path, and both scripts read the same one.
import { readReceipt, appendRound, stampRound, tokenFromRef, roundsFromRuns, mergeRounds, selectRound,
  roundLetters, receiptPath, scenarioRefs as scenarioRefsOf, findRunsByRef as findRunsIn,
  SCENARIO_FILE, byScenarioNumber, tierOf, SCENARIO_TIERS, DEFAULT_TIER }
  from "../driver/e2e-rounds.mjs";
// 's refusal — "is this data plane production" — sourced, because this file used to restate it and
// the two copies had ALREADY drifted, in both directions:
//   CLEAROTRON_REPORTS_DIR=/srv/trademark-archive-dev  the guard passes (it matches the archive as a path
//     PREFIX, and its own test requires that a name merely resembling production's passes). The copy
//     here tested `startsWith("/srv/trademark-archive")` with no separator, so it refused an isolated
//     pool while printing "which is the PRODUCTION pool" about it — a false sentence.
//   CLEAROTRON_REPORTS_DIR="   "  the guard refuses (a blank string is not a pool). The copy here read it as
//     set and PROCEEDED — the unset case wearing a space, past the one check that stands before enqueue.
// PURE, and more so than the leaves above: production-pool-guard.mjs imports nothing at all, so it
// cannot drag driver.config.mjs — whose unset-env defaults are PRODUCTION — into this file.
import { productionPoolRefusal } from "../driver/production-pool-guard.mjs";
// — "does this run have work in it", from the module that already answers it. The teardown gate
// below needs the SAME test the unread-terminal lister applies, because two definitions of "there is
// something here to read" is how one tool licenses a purge the other would have refused. It is a pure
// leaf like the ones above: node:fs + node:path plus driver/seat-attempts.mjs, which imports NOTHING at
// all — so it cannot drag driver.config.mjs, whose unset-env defaults are PRODUCTION, into this file.
// The module's own `main()` is behind an import.meta.url guard, so importing it runs nothing.
import { hasAttemptRows } from "./e2e-unread-terminals.mjs";
import { isEntrypoint } from "../shared/is-entrypoint.mjs";   // — one entry-point test, all spellings

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");

// ── where the scenarios come from ────────────────────────────────────────────────────────────────────
//
// CLEAROTRON_E2E_DIR selects the E2E CONFIG STORE, and there is no other suite — ONE suite, no shadow
// synthetic copy. The store holds everything — the real matters a lawyer has
// answered AND the two synthetic mechanism probes (R5/R6), sitting in one table, labelled. This repo
// bundles no scenarios; unset refuses with the message below rather than running marks nobody answered.
// Value handling matches CLEAROTRON_CUSTOMERS_DIR in driver/profiles.mjs: trimmed, empty means unset.
//
// The real scenarios name live client matters, so the store cannot live in this repo, which is
// de-identified by design.
//
// THE STORE IS SWAPPED WHOLE, per directory, never merged per file. A per-file overlay reads as the
// friendlier design and is the dangerous one: a store missing R1.json would silently run the synthetic
// matter and report it as R1. That is the 2026-07-19 roster split in a new costume — intake and the
// driver resolved against DISJOINT stores, and a delivered run searched house platforms instead of the
// client's with nothing saying so. A configured-but-incomplete store therefore REFUSES.
//
// CLEAROTRON_E2E_DIR names the store's `e2e/` directory, not `e2e/scenarios/`, because one variable has to
// reach both halves: scenarios sit under `scenarios/` and the lawyer references under `baselines/`,
// which is where the scorer reads them.
export function scenarioStore(env = process.env) {
  const root = (env.CLEAROTRON_E2E_DIR ?? "").trim();
  return root
    ? { dir: join(root, "scenarios"), root, external: true, label: `CLEAROTRON_E2E_DIR=${root}` }
    : { dir: null, root: null, external: false, label: "CLEAROTRON_E2E_DIR unset — no store configured" };
}

// — THE STORE'S VERSION, NOT JUST ITS PATH. The label printed the directory and never the commit,
// so a round could not say which scenario definitions it ran and two rounds could not be compared. Worse,
// an out-of-date store fails as an assertion that quietly does not exist — indistinguishable from an
// assertion nobody wrote. This makes the version, and any reason to distrust it, part of what a run says
// about itself.
//
// A dirty or diverged store is REPORTED, not silently read: those are the two states in which the file on
// disk is not the file the config repo has under review, and a round measured against them is measuring
// something nobody can reproduce. Reported here rather than refused, because refusing to report is worse
// than reporting against a known-odd store — but it is never silent.
export function storeVersion(store, env = process.env) {
  if (!store?.external || !store.root) return null;
  const repo = dirname(store.root.replace(/\/+$/, ""));
  // `-c safe.directory` scoped to the invocation: the store is owned by whoever cloned it and the round
  // runs as someone else, so without this git refuses with "detected dubious ownership" and every call
  // below returns null. The first version of this then printed "not a readable git checkout" — which is
  // a conclusion about the STORE derived from git declining to look at it, on the exact surface whose
  // job is to say which version ran. Writes no global config.
  const git = (...args) => {
    try { return execFileSync("git", ["-c", `safe.directory=${repo}`, "-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(); }
    catch { return null; }
  };
  const head = git("rev-parse", "HEAD");
  if (!head) return { repo, head: null, note: "not a readable git checkout — its version cannot be established" };
  const notes = [];
  if (git("status", "--porcelain")) notes.push("DIRTY working tree");
  const branch = git("rev-parse", "--abbrev-ref", "HEAD");
  if (branch && branch !== "main") notes.push(`on branch '${branch}', not main`);
  const ahead = git("rev-list", "--count", "origin/main..HEAD");
  if (ahead && ahead !== "0") notes.push(`${ahead} local commit(s) origin does not have`);
  const behind = git("rev-list", "--count", "HEAD..origin/main");
  if (behind && behind !== "0") notes.push(`${behind} behind origin/main as last fetched — run scripts/sync-e2e-store.mjs`);
  return { repo, head, branch, note: notes.join("; ") || null };
}

/** The one line every surface prints: the store, its commit, and any reason to distrust it. */
export function storeLine(store, env = process.env) {
  const v = storeVersion(store, env);
  if (!v) return store.label;
  const at = v.head ? `@${v.head.slice(0, 8)}` : "@unknown";
  return `${store.label} ${at}${v.note ? `  ⚠ ${v.note}` : ""}`;
}

const STORE = scenarioStore();
const SCENARIOS = STORE.dir;

const POOL_ROOT = process.env.CLEAROTRON_REPORTS_DIR || "";
const QUEUE_DIR = process.env.CLEAROTRON_QUEUE_DIR || "";
const WORKSPACE_ROOT = process.env.CLEAROTRON_WORK_DIR || "";
const MCP_URL = process.env.TRADEMARK_MCP_HTTP_PORT
  ? `http://${process.env.TRADEMARK_MCP_HTTP_HOST || "127.0.0.1"}:${process.env.TRADEMARK_MCP_HTTP_PORT}`
  : "";
const OPS_TOKEN = process.env.PORTAL_OPS_TOKEN || "";

const die = (msg, code = 2) => { console.error(`\n${msg}\n`); process.exit(code); };

// ── the production guard ─────────────────────────────────────────────────────────────────────────────
// Not a heuristic on hostname or username: the test instance is the one whose data plane is NOT the
// production pool. THE VERDICT IS NOT DECIDED HERE — productionPoolRefusal owns what counts as
// production, and this function adds only the two things that module cannot know: that the refusal has
// to land before anything is enqueued, and that the operator's next move is to source the test
// instance's env. made the driver refuse an unset pool root too (it used to fall back to
// /srv/trademark-archive), so this now fails twice over — but it must keep failing HERE, with this
// message: the driver's refusal arrives mid-run and says nothing about sourcing the test instance's env.
function refuseProduction() {
  const { refuse, reason } = productionPoolRefusal({ poolRoot: POOL_ROOT, queueDir: QUEUE_DIR });
  if (!refuse) return;
  die(`REFUSING: ${reason}\n\n`
    + "The E2E scenarios run synthetic matters. In production they would consume a real account's\n"
    + "allowance, write a real matter-ledger row, and leave a fake run in the archive that\n"
    + "replay-archive.mjs validates against as real client matter. There is no override for this.\n"
    + "Source the test instance's env first:  set -a; . ~/.env; set +a");
}

// ── the staleness guard ──────────────────────────────────────────────────────────────────────────────
//
// A run proves things about THE COMMIT IT RAN, and nothing else. Run R1 against a clone three days
// behind, watch it go green, and the honest conclusion is "main-as-of-Tuesday was fine" — but the
// sentence everyone actually says is "the E2E passed". That is the drift this suite exists to catch,
// arriving through the front door: the 91-commits-behind dev instance was believed current by everyone
// who used it, right up until someone checked.
//
// So: name the commit under test every time, and refuse to START a paid run against a clone that is not
// current. `--stale` is the override, because testing a specific older commit is a real thing to want —
// it just has to be said out loud rather than happen by default.
function commitState() {
  const git = (...a) => { try { return execFileSync("git", ["-C", REPO, ...a], { encoding: "utf8" }).trim(); } catch { return null; } };
  const head = git("rev-parse", "HEAD");
  if (!head) return { head: null, unknown: "not a git checkout" };
  // Best-effort: an unreachable remote must not block a run, so it degrades to "unknown" and SAYS so
  // rather than reporting the clone as current.
  const fetched = git("fetch", "--quiet", "origin", "main") !== null;
  const remote = fetched ? git("rev-parse", "origin/main") : null;
  if (!remote) return { head, unknown: "could not reach origin — cannot tell whether this is current" };
  return { head, behind: Number(git("rev-list", "--count", "HEAD..origin/main") ?? 0),
           ahead: Number(git("rev-list", "--count", "origin/main..HEAD") ?? 0) };
}

function reportCommit({ paid }) {
  const c = commitState();
  const stale = process.argv.includes("--stale");
  if (c.unknown) return void console.log(`commit: ${c.head?.slice(0, 8) ?? "?"} — ${c.unknown}`);

  if (c.ahead) {
    console.log(`\ncommit: ${c.head.slice(0, 8)} — this clone is ${c.ahead} commit(s) AHEAD of origin/main.`);
    console.log("Those commits exist here and in no repository, so a result from them is not reproducible");
    console.log("and says nothing about main. Push them, or check main out.");
    if (!stale) { console.log("\nPass --stale if you meant it.\n"); process.exit(4); }
    console.log("");
  }
  if (c.behind) {
    console.log(`\ncommit: ${c.head.slice(0, 8)} — ${c.behind} commit(s) BEHIND origin/main.`);
    console.log('A green run here means "main as of then was fine", which is not what anyone will hear.');
    if (paid && !stale) {
      // — THE REMEDY NAMES SOMETHING THAT EXISTS WHEREVER THIS RUNS. It used to name
      // `trademark-test-deploy.service`, an hourly deploy unit of exactly one box; that box was wiped,
      // the rebuild never recreated it, and no documented install produces it — so the operator was
      // handed `Unit … not found` in answer to a correct refusal. Same shape as the units that carried
      // the authors' own checkout name: text that encodes the machine it was written on.
      //
      // `git pull --ff-only` is named because it is true on any checkout this harness can run from, and
      // it is the fast-forward form on purpose: a merge or a rebase here would rewrite the very thing
      // the guard is measuring. The deploy unit is named CONDITIONALLY and second, because a host that
      // has one should use it — but a host that does not must not be sent looking.
      console.log("\nRefusing to start a PAID run against stale code. Bring the checkout up to date:");
      console.log("  git pull --ff-only");
      console.log("(or, if THIS host runs a deploy timer for the checkout, let it catch up — `systemctl --user list-timers`)");
      console.log("or pass --stale if you meant it — the run then measures code that is not what main says today.\n");
      process.exit(4);
    }
    console.log("");
  }
  if (!c.ahead && !c.behind) console.log(`commit: ${c.head.slice(0, 8)} — current with origin/main`);
}

// A configured store that is not there is a deploy defect, not a fallback — and it must be said HERE,
// before readdirSync turns it into a bare ENOENT with no explanation. existsSync answers false for a
// permission error exactly as it does for a missing directory, and the harness runs under a dedicated
// suite account: a clone that account cannot read has to fail loudly rather than resolve every scenario
// to a synthetic one. Same reasoning as skills_overlay_unreadable in driver/driver.config.mjs.
function scenarioDirOrDie() {
  if (SCENARIOS && existsSync(SCENARIOS)) return SCENARIOS;
  die(STORE.external
    ? `e2e scenario store unreadable: ${SCENARIOS}\n`
      + `  ${STORE.label}\n`
      + `  CLEAROTRON_E2E_DIR must name the config repo's e2e/ directory — scenarios/ beneath it,\n`
      + `  baselines/ beside it. Check the clone exists and that this user can read it.\n`
      + `  There is no fallback: the config store is the only suite.`
    : `CLEAROTRON_E2E_DIR is unset, and there is no other suite (owner ruling 2026-08-07 — one suite,\n`
      + `  no bundled synthetic copy). Set CLEAROTRON_E2E_DIR to the config repo's e2e/ directory.`);
}

// THE SCENARIO FILENAME PATTERN IS `/^R\d+\.json$/`, IT LIVES IN driver/e2e-rounds.mjs, AND IT IS
// IMPORTED AT THE TOP OF THIS FILE. Any number of digits: R7, R10, R126 are all admitted.
//
// (Led with the current rule on purpose. This block used to open on the retired form, and two readers
// in one morning took the first thing they saw for the rule and went to check the gate by hand —.
// The history below is why the rule is what it is, and is worth keeping; it is just not the answer to
// "what does it match today".)
//
// It used to be `/^R\d\.json$/`, spelled out separately here and in
// `allScenarios` below — docs/design/e2e-product-suite.md flags that duplication by name and says what
// happens when only one copy moves: "a new naming scheme silently yields an empty list".
//
// It now lives in driver/e2e-rounds.mjs and is imported at the top of this file, because a THIRD
// copy was about to appear: `scripts/compare.mjs` selects a comparison set out of the same store and is
// offline by design, so it cannot import this file to reach one regex. It widened at the same time —
// `\d+`, because a single digit is ten IDs, the store already holds seven, and needs five more.
//
// THIS CHANGES WHAT THE LIVE STORE ADMITS, and that is the point rather than a side effect: a file
// named `R10.json` was previously skipped in silence by `list`, by `allScenarios` and therefore by the
// admission sweep — present in the store, read by nothing, and never named as absent. It is now
// loaded and swept like every other scenario.
const scenarioIds = (dir) => readdirSync(dir).filter((f) => SCENARIO_FILE.test(f))
  .map((f) => f.replace(".json", "")).sort(byScenarioNumber);

const loadScenario = (id) => {
  const dir = scenarioDirOrDie();
  const p = join(dir, `${String(id).toUpperCase()}.json`);
  if (!existsSync(p)) die(`no scenario ${id} at ${p}\n`
    + `  store: ${STORE.label}\n`
    + `  have:  ${scenarioIds(dir).join(", ") || "none"}`
    + `\n  This store is the ONLY suite — there is no bundled fallback. Add ${String(id).toUpperCase()}.json to it.`);
  return JSON.parse(readFileSync(p, "utf8"));
};

const allScenarios = () => {
  const dir = scenarioDirOrDie();
  return readdirSync(dir).filter((f) => SCENARIO_FILE.test(f))
    // The FILENAME is carried alongside the parsed scenario, because the two are used for different
    // things and nothing checked they agree: `loadScenario` selects by filename, while every finding is
    // labelled with the scenario's `id` FIELD. See the lint rule that compares them.
    .map((f) => ({ ...JSON.parse(readFileSync(join(dir, f), "utf8")), __file: f }))
    .sort((a, b) => byScenarioNumber(a.id, b.id));
};

// ── — the store is the input to the most expensive thing this repo does ─────────────────────────
//
// Every job block in the store, through BOTH admission gates, against the outcome the scenario declares.
// `validateJob` judges what the request states; `doorGates` judges what depends on the resolved profile
// (name budget, scope-vs-machinery, native-language routing). Two of the store's refusal cases pass the
// schema and are caught only by the gates — asserting on the schema alone would call the store wrong
// when it is right.
//
// `clarify` in a scenario means REFUSED BEFORE ANY MODEL CALL. Anything else means the request must be
// admissible; what happens later (dedup, delivery) is a later gate's business. The cost of skipping this
// sweep is not a red test: it is a run queued, admitted, refused and reported as an engine result — on
// scenarios whose cost is unmeasured and which need the owner's word before they start.
export function validateStoreJobs(scenarios) {
  const jobs = [];
  for (const sc of scenarios) {
    if (sc.job) jobs.push({ label: sc.id, job: sc.job, terminal: sc.expect?.terminal });
    for (const c of sc.cases ?? []) jobs.push({ label: `${sc.id}/${c.id}`, job: c.job, terminal: c.expect?.terminal });
  }
  const wrong = [];
  for (const { label, job, terminal } of jobs) {
    // The door stamps the id; a scenario carries none, so one is supplied or everything fails on
    // "missing id" and the sweep reports the wrong defect.
    const stamped = { id: `e2e-${label.replace(/[^A-Za-z0-9._@-]/g, "-")}`, ...job };
    const v = validateJob({ ...stamped });
    let g;
    try { g = doorGates({ ...stamped }); } catch (e) { g = { errors: [`doorGates threw: ${e.message}`] }; }
    const refused = v.classify !== "run" || (g.errors ?? []).length > 0;
    const wantRefused = terminal === "clarify";
    if (refused !== wantRefused) {
      const why = [...(v.classify !== "run" ? v.errors : []), ...(g.errors ?? [])].join("; ");
      wrong.push(`${label}: expect.terminal=${JSON.stringify(terminal)} wants ${wantRefused ? "REFUSED" : "ADMITTED"}, `
        + `schema=${JSON.stringify(v.classify)} gateErrors=${(g.errors ?? []).length}${why ? ` — ${why}` : ""}`);
    }
  }
  return wrong;
}

// ── store lint — the content rules that used to be CI tests over the bundled copies ─────────────────
//
// When the bundled scenarios were deleted (one suite), the CI tests that
// linted their CONTENT lost their subject. The rules survive here, generalized, and now run against
// the real store on every list/run — which is stronger than linting files nobody runs. Each rule
// exists because its violation shipped once:
//   - a duplicate-case without oneMatterAcrossDoors can never observe its duplicate (harness-caused
//     engine defect, 2026-08-04); the flag anywhere else parks a delivered case as a duplicate.
//   - `_driver/scope-ledger.json` is never written; asserting on it reported a narrowing the engine
//     had not performed (R1/R2, 2026-08-04).
//   - a knockout deliverable without the honesty ops is how "Medium, complete" shipped while missing
//     nearly every mark the lawyer named.
//   - `requiresAck` is a removed gate; a live key reads as a rule that no longer exists.
//   - `targetMinutes`/`targetBand` are the BAND's to state, not a scenario's; four scenarios in
//     one band carried four different numbers, each copied from its own expected wall.
export function lintScenarios(scenarios) {
  const wrong = [], dead = [];
  const KNOCKOUT_OPS = ["no-wildcard-exact-pair", "names-configured-depth", "register-claims-within-counts", "survivor-not-clear"];
  for (const sc of scenarios) {
    // ── THE ID FIELD AND THE FILENAME MUST AGREE ─────────────────────────────────────────────
    //
    // `run R3` loads R3.json by NAME, and every finding about it is labelled with the scenario's `id`
    // FIELD. The scoped sweep matches findings by that label. If a file ever carried a different id,
    // findings about the scenario you asked for would be labelled with the other one, the scoped refusal
    // would not match — and a scenario the doors would refuse would START AND SPEND.
    //
    // They agree in the store today, all seven. Nothing asserted it, and the store is a different repo,
    // so the invariant the scoping rests on was held by nothing but coincidence.
    if (sc.__file && sc.__file !== `${sc.id}.json`) {
      wrong.push(`${sc.id}: is declared in ${sc.__file}, so its id and its filename disagree. \`run\` selects `
        + `by filename and findings are labelled by id, so a scenario the doors refuse would start and spend. `
        + `Rename the file to ${sc.id}.json, or change the id to ${sc.__file.replace(/\.json$/, "")}.`);
    }
    const label = sc.id ?? "?";
    // ── · AN UNREADABLE TIER STOPS THE STORE, NOT JUST THE SCENARIO ───────────────────────────
    //
    // Deliberately here rather than at a selection site, because that is what gets the SCOPE right for
    // nothing: `sweepStoreOrDie()` bare (cmdList) refuses on any scenario's finding, and
    // `sweepStoreOrDie(id)` (cmdRun) refuses only on the named scenario's — 's split, already
    // implemented at the two call sites. A round that selects BY tier has to read every tier to choose,
    // so a typo anywhere corrupts the selection rather than one entry; a run that named its scenario is
    // answerable only for that one. Both fall out of where this line sits.
    try { tierOf(sc); }
    catch (e) { wrong.push(`${label}: ${e.message}`); }
    if (!(Number(sc.cost?.wallMinutes) > 0)) wrong.push(`${label}: cost.wallMinutes must state a positive number — the handover needs the number`);
    if (sc.cost?.requiresAck !== undefined) wrong.push(`${label}: cost.requiresAck is a removed gate (owner, 2026-08-04) — delete the key`);
    // — THE BAND OWNS THE BENCHMARK, so a scenario carrying one is refused rather than ignored.
    // Ignoring it would be worse than reading it: the key would sit in the store looking like the rule
    // it used to be, and the next reader would "fix" the benchmark by editing a number nothing reads.
    // That is exactly the `requiresAck` failure above, and it is why this is a refusal and not a note.
    //
    // hasOwnProperty, NOT an optional-chained property read of the key itself — deliberately. The
    // source census in driver/test/e2e-turnaround-band.test.mjs asserts that no optional-chained read
    // of either key survives anywhere in this file, and a property-access guard here would match its
    // own regex and make that census permanently green whatever else came back. For the same reason no
    // comment in this file spells that form either.
    for (const k of ["targetMinutes", "targetBand"]) {
      if (Object.prototype.hasOwnProperty.call(sc.cost ?? {}, k)) {
        dead.push(`${label}: cost.${k} = ${JSON.stringify(sc.cost[k])} is DEAD AND UNREAD — the BAND owns the`
          + ` benchmark (driver/turnaround-bands.mjs), derived from the pipeline the doors resolve this job to.`
          + ` A benchmark copied from a scenario's own expected wall can never be exceeded (#523). Delete the key.`);
      }
    }
    for (const f of sc.expect?.artifacts ?? []) {
      if (/^\/|\.\./.test(f)) wrong.push(`${label}: artifact ${JSON.stringify(f)} must be a plain run-relative name`);
    }
    const allAsserts = [...(sc.expect?.assert ?? []), ...(sc.cases ?? []).flatMap((c) => c.expect?.assert ?? [])];
    for (const a of allAsserts) {
      if (/^_driver\/scope-ledger\.json/.test(String(a.path ?? ""))) {
        wrong.push(`${label}: asserts against _driver/scope-ledger.json, which the engine never writes — the record is _driver/instructed-scope.json`);
      }
    }
    for (const c of sc.cases ?? []) {
      const dup = c.expect?.terminal === "duplicate";
      const shared = c.oneMatterAcrossDoors === true;
      if (dup && !shared) wrong.push(`${label}/${c.id}: expects \`duplicate\` without oneMatterAcrossDoors — door-suffixed refs make each door a DIFFERENT matter and the duplicate can never occur`);
      if (shared && !dup) wrong.push(`${label}/${c.id}: oneMatterAcrossDoors on a case not expecting \`duplicate\` — a shared ref parks its second door as a duplicate`);
    }
    if ((sc.expect?.artifacts ?? []).includes("knockout-assessment.md") && sc.expect?.terminal === "delivered") {
      const ops = new Set((sc.expect?.assert ?? []).map((a) => a.op));
      for (const op of KNOCKOUT_OPS) {
        if (!ops.has(op)) wrong.push(`${label}: a knockout deliverable must exercise ${op} — without it the lane can claim what it never examined (#324)`);
      }
    }
  }
  // TWO LISTS, AND THE SPLIT IS THE WHOLE CROSS-REPO ORDERING PROBLEM.
  //
  // `wrong` refuses the invocation before anything spends. `dead` does not, and must not: the scenario
  // store is a DIFFERENT REPO. Every one of the seven live scenarios carries `cost.targetMinutes` and
  // `cost.targetBand` today, so refusing on them would brick `list`, `run`, `report` and `teardown` — the
  // whole suite — until an edit lands somewhere this repo cannot reach. A harness that cannot run until
  // another repo catches up is not a stricter harness, it is a broken one.
  //
  // Ignoring them silently is the other failure, and it is exactly the `requiresAck` shape above: a key
  // sits in the store looking like the rule it used to be, and the next reader "fixes" the benchmark by
  // editing a number nothing reads. So the key is neither obeyed nor passed over — it is NAMED, on every
  // invocation, as dead and unread, with its value quoted so the reader sees what it thought it set.
  //
  // Escalating `dead` to `wrong` belongs in the change that FOLLOWS the store deleting the keys.
  return { wrong, dead };
}

// ── · WHOSE finding is it? ─────────────────────────────────────────────────────────────────────
//
// Every finding validateStoreJobs and lintScenarios produce is labelled with the scenario it came from —
// `R3`, or `R3/<case>` for a case inside one. That label is the only thing needed to tell a finding
// about the scenario you asked to run from a finding about one you did not.
//
// Exported and pure because the whole defect was that nobody could ask this question: the sweep held one
// undifferentiated list, so ONE out-of-coverage scenario refused the entire store. On the free tier that
// meant R5 (worldwide, genuinely beyond an EU+US register) made R3 unrunnable — and R3 is US-only, well
// inside coverage., and then had no route to verification at all, because no scenario
// would start on the provider they exist to deliver.
export const findingIsAbout = (finding, id) => {
  const label = String(finding ?? "").split(":")[0].trim().toLowerCase();
  const want = String(id ?? "").trim().toLowerCase();
  return Boolean(want) && (label === want || label.startsWith(`${want}/`));
};

/**
 * Sweep the whole store, print everything, and refuse only what the caller actually asked for.
 *
 * @param scenarioId  the scenario about to run — refuse only on findings naming it. NULL means every
 *                    finding is fatal, which is `list`'s contract and is DELIBERATELY UNCHANGED: a
 *                    store/doors disagreement is a defect in the store, and the command whose job is to
 *                    survey the store must keep failing on it.  is about a `run` being blocked by a
 *                    scenario it did not ask for; nothing about it argues for a quieter `list`, and
 *                    making one would trade a narrow bug for a lost early warning.
 *
 * EVERY finding is still PRINTED, whoever it is about. That half is not the bug and must not be lost:
 * the point of the sweep is that a store/doors disagreement is visible before an expensive run, and a
 * finding filtered down to silence is the same failure as a finding nobody printed. What changes is only
 * which findings STOP you — the same split this file already draws between `wrong` and `dead`.
 */
function sweepStoreOrDie(scenarioId = null) {
  const scenarios = allScenarios();
  const lint = lintScenarios(scenarios);
  // Printed BEFORE the refusal check and printed even when nothing is wrong: a dead key is a finding
  // about the store, not a reason to stop, and it must not be swallowed by an exit on the line below.
  if (lint.dead.length) {
    process.stderr.write(`dead scenario keys — read by nothing, and the store still carries them (#523):\n`
      + lint.dead.map((w) => `  ${w}`).join("\n") + "\n");
  }
  const wrong = [...validateStoreJobs(scenarios), ...lint.wrong];
  if (!wrong.length) return;

  // NULL ⇒ every finding is mine (the `list` contract). An id ⇒ only the findings that name it.
  const mine = scenarioId === null ? wrong : wrong.filter((w) => findingIsAbout(w, scenarioId));
  const others = wrong.filter((w) => !mine.includes(w));
  if (others.length) {
    // stderr, and worded so it cannot be read as a pass: these scenarios WILL refuse if asked for. On a
    // free tier with no worldwide reach that is the correct and permanent answer for R5, and saying so
    // once per invocation is how it stays visible without blocking the scenarios that do fit.
    process.stderr.write(`the store's scenarios and the doors disagree on ${others.length} OTHER scenario(s) — `
      + `not refused here, because you asked for ${scenarioId}, but each of these WILL refuse if you run it:\n`
      + others.map((w) => `  ${w}`).join("\n") + "\n");
  }
  if (mine.length) die(`the store's scenarios and the doors disagree — refusing before anything spends:\n`
    + mine.map((w) => `  ${w}`).join("\n")
    + `\n  store: ${storeLine(STORE)}`);
}

// ── · the turnaround benchmark, and which number the report judged against ─────────────────────
//
// THE DEFECT. `cost.targetMinutes` was a per-scenario field, read in two places and BOTH conditionally:
// `list` appended "(benchmark N min)" only when the key was present, and `run` printed a benchmark line
// only when the key was present. A scenario with no key therefore printed NOTHING — no benchmark at all,
// rendered as silence, which reads exactly like a benchmark that was met. And where the key WAS present
// it had been copied from the scenario's own expected wall, so the benchmark moved with the thing it was
// supposed to judge. Both halves of that are now gone: the number comes from the band table, and the
// line prints unconditionally because an undetermined benchmark is a RESULT that has to be said.
//
// THREE FUNCTIONS, ALL PURE-ISH AND ALL EXPORTED, and the split is deliberate: `turnaroundVerdict` takes
// plain values and no filesystem, so what the report says about a 171-minute run against a 120-minute
// band is provable from a fixture instead of from a three-hour clearance run.

/** Run states that mean the run has ENDED, so its wall is a turnaround rather than time-so-far.
 *
 *  A COPY, and the copy is the point. driver/progress.mjs holds the same three in a module-local const
 *  and cannot be imported here — its chain reaches driver.config.mjs, whose unset-env defaults are
 *  PRODUCTION. So the set is restated and driver/test/e2e-turnaround-band.test.mjs reads progress.mjs's
 *  SOURCE and asserts the two are equal. Getting this wrong fails silently in the worst direction: a
 *  terminal state missing from here makes every finished run of that kind read as "still in flight",
 *  and a run that is still in flight is never declared over its benchmark.
 *
 *  `postponed` and `parked-for-human` are deliberately absent from both: a park is the terminal of an
 *  INVOCATION, not of the run, and its wall is still accumulating. */
export const TERMINAL_RUN_STATES = Object.freeze(["delivered", "failed", "cancelled"]);

/**
 * WHICH BAND A SCENARIO IS IN — derived from what the doors resolve, never from what the file typed.
 *
 * Returns `{ band, minutes, source, why, runnable }`. `band === null` is an ANSWER, and `why` says which
 * of the four ways it got there.
 *
 * ONLY RUNNABLE CASES COUNT. A case whose expected terminal is `clarify` is refused before any model
 * call: it runs nothing, so it has no turnaround and cannot put a scenario in a band. This filter is
 * load-bearing rather than tidy — R0 is a knockout-band scenario whose refused cases deliberately name
 * clearance-pipeline products (including a RETIRED one, which `policyFor` still answers for), so without
 * it the scenario that runs every single round reads as mixed-pipeline and prints NOT DETERMINED
 * forever. A reader who sees NOT DETERMINED every round stops reading the line.
 *
 * NEVER `job.product`. The typed word is the thing that must not be trusted — a job may omit `product`
 * entirely and take the account default, and a job may name a product the doors reshape. This file says
 * so at its own import of the depth registry, for the same reason.
 */
export function bandForScenario(scenario, resolve = resolveForDoor) {
  const blocks = scenario?.job
    ? [{ id: scenario.id ?? "?", job: scenario.job, terminal: scenario.expect?.terminal ?? null }]
    : (scenario?.cases ?? []).map((c) => ({ id: `${scenario?.id ?? "?"}/${c.id ?? "?"}`, job: c.job, terminal: c.expect?.terminal ?? null }));
  const runnable = blocks.filter((b) => b.terminal !== "clarify");
  const no = (why) => ({ band: null, minutes: null, source: null, why, runnable: runnable.length });

  if (!runnable.length) {
    return no(scenario?.job || (scenario?.cases ?? []).length
      ? `every case is refused before any model call — nothing runs, so there is no turnaround to benchmark`
      : `the scenario declares no job and no cases — there is nothing to resolve a band from`);
  }

  const bands = new Set();
  for (const b of runnable) {
    // resolveForDoor swallows EVERY throw and answers `{resolved: null}` — an unreadable profile store
    // looks identical to a job it simply could not size. Either way the band is not determined, and
    // falling back to anything at all would print a confident benchmark derived from a resolution that
    // never happened.
    const { resolved } = resolve(b.job) ?? {};
    if (!resolved?.pipeline) {
      return no(`the doors could not resolve ${b.id}'s policy to a pipeline (profile store unreadable, or the job names no product this build runs)`
        + ` — the band is NOT DETERMINED. It is not taken from the product word the scenario file typed.`);
    }
    const band = bandForPipeline(resolved.pipeline);
    if (!band) {
      return no(`${b.id} resolves to pipeline ${JSON.stringify(resolved.pipeline)}, which driver/turnaround-bands.mjs has no benchmark for`
        + ` (it knows ${BAND_IDS.join(", ")}) — the band is NOT DETERMINED`);
    }
    bands.add(band);
  }
  if (bands.size > 1) {
    return no(`its runnable cases resolve to more than one band (${[...bands].sort().join(", ")}) — one scenario, one band.`
      + ` The harness will not pick one for you: split the scenario, or say in the store which band it is being measured in.`);
  }
  const [band] = bands;
  return { band, minutes: benchmarkMinutes(band), source: benchmarkSource(band), why: null, runnable: runnable.length };
}

/**
 * THE ENGINE'S OWN TURNAROUND FIGURE, read from the run's journal rather than recomputed.
 *
 * `<runDir>/_driver/run.jsonl` carries `{event:"quote", ...}` at run start and one
 * `{event:"turnaround-reconciliation", state, quotedHours, actualHours, ratio}` row at every terminal of
 * the clearance pipeline. Returns `null` when neither is there.
 *
 * BACKWARDS, AND THE LAST RECONCILIATION WINS. A run legitimately writes several of these across its
 * life — a rate-limit postpone and an auto-recovery park are terminals of an INVOCATION, not of the run
 * — and pipeline.mjs states that the LAST row is the run's outcome. A forward first-match returns the
 * leg that got rate-limited and reports a three-hour run as a half-hour one.
 *
 * FS-ONLY AND LOCAL, on purpose. driver/run-economics.mjs already has a `readQuote` doing the first half
 * of this, and importing it would drag progress.mjs and then driver.config.mjs into the harness, whose
 * unset-env defaults are PRODUCTION. That would not throw — it would quietly give this file production
 * defaults, which is the exact chain this file's own header forbids.
 */
/**
 * — WHICH ENGINE COMMIT THIS RUN LOADED, read from the run's own artifacts.
 *
 * `role-e2e`'s handover requires the commit on every run, and until this existed it was reconstructed
 * by joining a checkout's reflog against `startedAt`. That reconstruction expires with the reflog,
 * dies with a re-clone, and is simply wrong for any run made while the checkout sat detached — it
 * produced two near-miss wrong certifications in two days.
 *
 * READS THE LAST ROW, and a run with several is not a defect: `run.jsonl` carries one segment per
 * `start`, and a resumed segment can load different code from the one that began the run. The last
 * row is what produced the delivered artifact. `segments` is returned so a caller can SEE a mid-run
 * upgrade rather than have it averaged away.
 *
 * Returns null when the journal is unreadable or carries no row — an absence the caller reports as
 * itself. A run older than this stamp genuinely has none, and saying "unknown" is the honest answer.
 */
export function engineBuildOf(runDir) {
  let raw;
  try { raw = readFileSync(driverDir(runDir, "run.jsonl"), "utf8"); }
  catch { return null; }
  const rows = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try { const r = JSON.parse(line); if (r?.event === "engine-build") rows.push(r); } catch { /* torn line */ }
  }
  if (!rows.length) return null;
  const last = rows[rows.length - 1];
  return {
    head: last.engineHead ?? null,
    branch: last.engineBranch ?? null,
    outcome: last.outcome ?? null,
    detail: last.detail ?? null,
    segments: rows.length,
    heads: [...new Set(rows.map((r) => r.engineHead).filter(Boolean))],
    source: `_driver/run.jsonl {event:"engine-build"}${rows.length > 1 ? `, last of ${rows.length}` : ""}`,
  };
}

export function engineTurnaround(runDir) {
  let raw;
  try { raw = readFileSync(driverDir(runDir, "run.jsonl"), "utf8"); }
  catch { return null; }   // no journal — the caller decides whether that is a gap or the design
  const rows = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    // A torn final append is normal on a journal being written by another process. Skip it; never throw
    // — a parse error here would take out the whole report over one truncated line.
    try { rows.push(JSON.parse(line)); } catch { /* torn line */ }
  }
  const num = (v) => (Number.isFinite(v) ? v : null);
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i]?.event !== "turnaround-reconciliation") continue;
    return {
      quotedHours: num(rows[i].quotedHours), actualHours: num(rows[i].actualHours), ratio: num(rows[i].ratio),
      state: rows[i].state ?? null,
      source: `_driver/run.jsonl {event:"turnaround-reconciliation"}, last row`,
    };
  }
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i]?.event !== "quote") continue;
    return {
      quotedHours: num(rows[i].turnaroundHours), actualHours: null, ratio: null, state: null,
      source: `_driver/run.jsonl {event:"quote"} — sized at run start, no turnaround reconciliation recorded`,
    };
  }
  return null;
}

/**
 * WHAT THE HARNESS SAYS ABOUT ONE SCENARIO'S TURNAROUND. Pure: plain values in, strings out, no clock
 * and no filesystem — which is what makes the "says which number it judged against" requirement
 * provable from a fixture instead of from a paid run.
 *
 * `run` is `null` when there is no run to judge (`list`, `run`, and the header of `report`) and
 * `{engine, wallSeconds, terminal}` when there is. That distinction is structural on purpose: "we did
 * not look at a run" and "we looked and the run recorded no quote" are different findings, and one
 * argument that collapsed them would report the first as the second on every `list`.
 *
 * @returns {{lines: string[], investigate: string[], notProbed: string[]}} — `lines` always non-empty.
 *          The harness records and does not judge, so there is no PASS here and no verdict word: an
 *          over-benchmark run is a measurement that enters `investigate` for a human to explain.
 */
export function turnaroundVerdict({ band = null, minutes = null, source = null, why = null, runnable = null, run = null } = {}) {
  const lines = [];
  const investigate = [];
  const notProbed = [];
  const known = Boolean(band) && Number.isFinite(minutes);

  // ── line 1: the benchmark. UNCONDITIONAL — this is the whole of "no benchmark is not a pass".
  if (known) {
    lines.push(`benchmark: ${minutes} min (${band} band — driver/turnaround-bands.mjs, ${source ?? "source unrecorded"}).`
      + ` A reporting benchmark, not a budget. Nothing stops on it; a run over it is a finding to report.`);
  } else {
    lines.push(`benchmark: NOT DETERMINED — ${why ?? "no band was derived and no reason was recorded"}`);
  }

  if (!run) {
    // Nothing ran, so nothing is over. A scenario whose every case is refused before a model call has no
    // turnaround at all, and flagging it would teach the reader to skim this block on the scenario that
    // runs every round.
    if (!known && runnable !== 0) {
      investigate.push(`the turnaround benchmark could not be determined — ${why ?? "no reason recorded"}.`
        + ` A scenario with no benchmark is not a scenario inside one.`);
    }
    return { lines, investigate, notProbed };
  }

  const { engine = null, wallSeconds = null, terminal = false } = run;

  // ── line 2: the wall, in the same unit as the benchmark. MINUTES.
  // runLedger measures in SECONDS and reconcileTurnaround in HOURS; this is the one place all three
  // meet, and a missed conversion here fails by printing a plausible number rather than by throwing.
  const wallMinutes = Number.isFinite(wallSeconds) ? Math.round(wallSeconds / 60) : null;
  if (wallMinutes == null) {
    lines.push(`actual: NOT MEASURED — status.json carries no usable startedAt, so this run has no wall to place against a benchmark`);
    notProbed.push(`the run's wall could not be measured from status.json, so the turnaround benchmark was never applied to it`);
  } else if (!terminal) {
    // runLedger's wall falls back to `updatedAt` when there is no `deliveredAt`, so an unfinished run's
    // figure is TIME-SO-FAR. Calling that over the benchmark manufactures a finding about a run that has
    // not finished.
    lines.push(`actual ${wallMinutes} min → still in flight; this is time-so-far, not a turnaround. No over/under claim is made.`);
  } else if (known) {
    const d = wallMinutes - minutes;
    lines.push(`actual ${wallMinutes} min → ${d > 0 ? `${d} min OVER the ${band} band` : d === 0 ? `exactly on the ${band} band` : `inside the ${band} band, by ${-d} min`}`);
    if (d > 0) {
      investigate.push(`wall ${wallMinutes} min against the ${band} band's ${minutes} min benchmark — ${d} min over. Say WHY it took that long.`);
    }
  } else {
    lines.push(`actual ${wallMinutes} min → not placed against any benchmark, because the band is NOT DETERMINED`);
    if (runnable !== 0) {
      investigate.push(`wall ${wallMinutes} min could not be placed against a benchmark — the band is NOT DETERMINED: ${why ?? "no reason recorded"}`);
    }
  }

  // ── line 3: WHICH NUMBER THIS JUDGED AGAINST, said every time.
  // The band and the engine's quote disagree on almost every scenario, because they answer different
  // questions: the band is the wall the owner said this class of search should land inside; the quote is
  // the size of the search THIS job resolved to. Neither is recomputed here — the band comes from the
  // table, the quote comes from the run's own journal, and this line names which one the arithmetic
  // above used. Stated on agreement too, so silence never means "not checked".
  const quotedHours = Number.isFinite(engine?.quotedHours) ? engine.quotedHours : null;
  if (quotedHours != null) {
    const quotedMinutes = Math.round(quotedHours * 60);
    lines.push(`the engine quoted ${quotedHours}h (${quotedMinutes} min) for this run — ${engine.source}${engine.state ? `, state ${engine.state}` : ""}`);
    if (known) {
      lines.push(quotedMinutes === minutes
        ? `the engine's quote agrees with the band (${minutes} min).`
        : `THE TWO DISAGREE. This line judged against the BAND (${minutes} min). The engine's quote is the size of the`
          + ` search this job resolved to — effort-model.mjs turnaroundHours — not the owner's benchmark for it.`);
    } else {
      lines.push(`the band is NOT DETERMINED, so the engine's quote is the only turnaround figure this run has. Nothing was judged against it.`);
    }
  } else {
    // THREE-VALUED, and the knockout arm is the one that stops this block being skimmed. R3, R4 and R0
    // run every round and a knockout run records no quote AT ALL — the knockout lane's terminals are
    // deliberately outside logTurnaroundReconciliation's scope, because there is no quote to reconcile.
    // Reporting that as a gap is crying wolf on most of the suite.
    const found = engine
      ? `${engine.source} carries a turnaround row (state ${engine.state ?? "unstated"}) with no quoted figure on it — the run was never sized`
      : `no turnaround-reconciliation row and no quote event in _driver/run.jsonl`;
    if (band === "knockout") {
      lines.push(`no engine quote to compare: the knockout lane computes none (pipeline-knockout.mjs is outside the reconciliation's stated scope),`
        + ` so there is no engine figure for this run. By design, not a gap.`);
    } else if (band === "clearance") {
      lines.push(`no engine quote to compare — ${found}.`);
      notProbed.push(`the engine's own quote could NOT be read for this run — ${found}.`
        + ` A clearance run records both, so this is an absence, not a pass.`);
    } else {
      lines.push(`no engine quote to compare — ${found} — and the band is NOT DETERMINED. Neither side of the comparison could be established.`);
    }
  }

  return { lines, investigate, notProbed };
}

// ── doors ────────────────────────────────────────────────────────────────────────────────────────────
//
// Two doors can be driven honestly from a script. The other two cannot, and this says so rather than
// pretending: the portal and the client face both sit behind Cloudflare Access and need a real browser
// session. What CAN be driven is the lane the portal itself uses — its trigger calls ops-MCP `start_run`
// with its own ops token and a `portal` forwarder stamp — so that is what "portal" does here, labelled.
const DOORS = {
  cli: { real: true, how: "driver/enqueue.mjs writes the queue job directly" },
  "ops-mcp": { real: true, how: "start_run over the loopback ops face" },
  portal: { real: false, how: "the portal's OWN trigger lane (ops-MCP start_run, forwarder=portal). The UI itself needs a Cloudflare Access session and cannot be driven from a script." },
  "client-mcp": { real: false, how: "the client face needs a Cloudflare Access session or its API key. Enqueued through the ops lane with clientPrincipal set, which is the same admission path." },
};

// ──: A TEST SCENARIO'S MATTER SIGNATURE IS UNIQUE PER RUN ───────────────────────────────────────
//
// Matter dedup holds a 24-hour window on the matter signature (runner.findDuplicateMatter), and a fixed
// scenario submitted the SAME signature every time — same mark, same classes, same ref, same level, that
// being what a fixed scenario IS. So the second round of any calendar day was refused at the door before
// any model call: on 2026-08-04 an evening re-run of R0, R3 and R4 came back `.duplicate` at every door,
// matching that morning's round. Nothing ran.
//
// THE DEDUP RULE IS CORRECT AND IS NOT TOUCHED HERE. A real client resubmitting the same matter inside a
// day should not be searched and billed twice. The defect is on the harness's side: a test scenario is
// the one submitter for which a byte-identical resubmission is normal and expected. So the harness makes
// each ROUND a distinct matter instead of asking dedup to look the other way.
//
// This replaces `--rerun-same-matter`, which set `dupOverride` on every submission, and the guard
// that stopped that flag being pointed at a scenario testing dedup. Both are deleted: they gave
// the test harness a lever into a production safety rule, and one careless invocation then bought a paid
// clearance. `dupOverride` itself is untouched — it stays where it belongs, on the doors a requester
// uses (start_run, enqueue.mjs --dup-override, the dev-portal checkbox).
//
// PER INVOCATION, NEVER PER SUBMISSION. R0d proves that the same matter submitted twice runs once, and
// it does that by putting ONE ref through both doors (`oneMatterAcrossDoors`, below). A token minted per
// submission would hand those two doors two different matters and silently delete the only case that
// tests dedup at all. So it is minted ONCE at module load: one `e2e.mjs run` invocation, one token,
// shared by every submission that invocation makes.
//
// RANDOM, NOT THE CLOCK. Two scenarios starting in the same second is a normal event on a fast round, so
// a time-derived token collides intermittently — worse than the reliable failure it replaces. Four
// CSPRNG bytes, and nothing derived from the wall clock.
//
// IT RIDES THE REF, AND ONLY THE REF. `matterSignature` is composed of forwarder|mark|classes|customer|
// ref (+ a level suffix), and the ref is the one component a test can move without changing what is
// searched, who is billed or which profile rates it. Putting the token there means runner.mjs is not
// edited at all, so a production matter's signature is byte-for-byte what it was. Downstream the harness
// matches refs by PREFIX (`findRunsByRef`, `queueOutcomes`, `cmdTeardown`), so a suffix leaves every one
// of them working, and `report` additionally scopes itself to this round's token — see cmdReport.
export function newRunToken() { return randomBytes(4).toString("hex"); }
const RUN_TOKEN = newRunToken();
export function refForRun(baseRef, token = RUN_TOKEN) { return token ? `${baseRef}-${token}` : baseRef; }

// The refs a scenario DECLARES — one per case, or one for a single-job scenario. What a round actually
// submits is these plus the round token plus the door; every later command starts from these.
// MOVED to driver/e2e-rounds.mjs, not copied: score.mjs must resolve a scenario's refs the same
// way this file does or `--previous auto` pairs the wrong run.
const scenarioRefs = scenarioRefsOf;

// — both doors answer with JSON carrying the queued job's id (`{ ok, id, queue, queuePath, … }`).
// Read it, and return null rather than a guess when it cannot be read: an id this harness INVENTED would
// send a watcher to a queue file that does not exist, which is worse than admitting it does not know.
export function idFromDoorAnswer(out) {
  try {
    const j = JSON.parse(String(out ?? "").trim());
    return j && typeof j.id === "string" && j.id ? j.id : null;
  } catch { return null; }
}

function enqueueViaCli(job) {
  const dir = mkdtempSync(join(tmpdir(), "e2e-job-"));
  const f = join(dir, "job.json");
  writeFileSync(f, JSON.stringify(job, null, 2));
  try {
    const out = execFileSync("node", [join(REPO, "driver", "enqueue.mjs"), "--job", f, "--queue-dir", QUEUE_DIR],
      { encoding: "utf8", env: process.env });
    // — the ENQUEUED JOB ID, taken from the door's own answer rather than from what we sent.
    // Both doors return `{ ok, id, queuePath, … }`; parsing it here is what lets the round print and
    // record one line per job instead of one per case.
    return { ok: true, out: out.trim(), id: idFromDoorAnswer(out) };
  } catch (e) {
    return { ok: false, out: `${e.stdout ?? ""}${e.stderr ?? ""}`.trim() || e.message };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

// EXPORTED for 's arm: the not-configured branch is the whole subject, and the only honest way to
// drive it is to call this function in a process with no MCP port in scope — the state a rebuilt box
// is actually in. Asserting on the source text instead would pass on a file that no longer runs it.
export async function enqueueViaMcp(job, { clientPrincipal = false, forwarder = null } = {}) {
  // — `transport: true, status: null` is what makes this an UNAVAILABLE door rather than a
  // refusing one. A door that is not configured on this deployment never saw the job, so it holds no
  // opinion about it: recording it as a refusal manufactures agreement on the refusal cases (a
  // correctly-refusing door and an absent one produce the same line) and, on the admit cases, fires
  // #98's "the one that ACCEPTED is the defect" at the door that behaved. This is 's rule reaching
  // the one transport failure that happens BEFORE any request: not-configured is could-not-ask.
  if (!MCP_URL) return { ok: false, transport: true, status: null,
    out: "no TRADEMARK_MCP_HTTP_PORT in scope — this door is not configured on this deployment, so it was never asked" };
  try {
    const res = await mcpToolCall({ url: MCP_URL, token: OPS_TOKEN, tool: "start_run",
      args: { ...job, ...(forwarder ? { forwarder } : {}), ...(clientPrincipal ? { clientPrincipal: true } : {}) },
      timeoutMs: 30000 });
    // The id comes off the parsed object BEFORE the 400-char truncation below — a 400-char slice of a
    // JSON blob is exactly where an id goes missing without anyone noticing.
    return { ok: true, out: JSON.stringify(res).slice(0, 400), id: res?.id ? String(res.id) : null };
  // — `e.transport` is set at the THROW, by the client that knows what failed: an HTTP status
  // came back (an answer) or the connection never happened (not an answer). Classifying here instead
  // would mean re-deriving a socket failure from an error message, which is the drift named.
  } catch (e) { return { ok: false, out: e.message, status: e.status ?? null, transport: e.transport === true }; }
}

// ──: A DOOR THAT NEVER REACHED THE SCOPE QUESTION HAS NOT ANSWERED IT ──────────────────────────
//
// R0e, 2026-08-12: the cli door accepted; the ops-mcp door answered
// `MCP initialize refused (429): ops principal rate limit exceeded`. The doors "disagreed", so the
// harness named the door that BEHAVED as the defect. Two hours later the codex arm hit no 429 and the
// same case was clean — so the finding also reads as a flake, which is the worst of both.
//
// The rule the asymmetry check encodes (#98) is sound: for a case both doors should refuse, the one
// that accepted is the bug. It rests on an assumption nobody wrote down — that a refusal is a
// PRODUCT-SCOPE JUDGMENT. A 429 or a 5xx is not a judgment. The request died in the transport, before
// `start_run` ran a single scope check, so that door holds no opinion about this case at all.
//
// Treating "unknown" as "no" does not merely mislabel one door. It manufactures a disagreement out of
// two answers that were never compared, and then blames the only door that did its job.
//
// DELIBERATELY NARROW: 429 and 5xx, plus a transport that never got a status at all. A 4xx is left
// ALONE — a 400 or a 403 is the service deciding something about this request, which is exactly the
// judgment the comparison wants. Widening this to all non-2xx would start swallowing real refusals,
// and a comparison that excuses every refusal it cannot classify is worth nothing.
export const DOOR_ANSWER = Object.freeze({ ANSWERED: "answered", INFRA_UNAVAILABLE: "infra-unavailable" });

export function doorAnswerClass(answer) {
  if (!answer || answer.ok) return DOOR_ANSWER.ANSWERED;
  const status = answer.status ?? null;
  if (status === 429 || (status >= 500 && status <= 599)) return DOOR_ANSWER.INFRA_UNAVAILABLE;
  if (answer.transport === true && status === null) return DOOR_ANSWER.INFRA_UNAVAILABLE;
  return DOOR_ANSWER.ANSWERED;
}

/**
 * The #98 asymmetry verdict, over the doors that actually answered.
 * Returns { agreed, compared, unavailable, reducedCoverage } — `agreed` is TRUE when fewer than two
 * doors answered, because one opinion is not a disagreement and must never be reported as one.
 */
/**
 * — how a door's answer is CLASSIFIED on the receipt. Exported because it is the thing that has
 * to be right, and an inline object literal inside the round loop cannot be driven by an arm.
 *
 * `transport` is written on EVERY answer, including `false`, and including the CLI door which has no
 * transport concept. It was previously written on none: the word did not appear once across eighteen
 * ops-mcp entries in the two rounds that exposed this, not even as `false`. A reader could not tell a
 * door that refused from a door that was never reached, and could not tell that anything had been
 * classified at all. A field that is absent when it is false records nothing.
 */
export function receiptAnswerClassification(a) {
  return { answerClass: doorAnswerClass(a), status: a.status ?? null, transport: a.transport === true };
}

/**
 * — WHAT THE REPORT SAYS ABOUT A DOOR THAT WAS NEVER REACHED.
 *
 * The reduced-coverage line used to render `${a.status ?? "no status"}`, which for a socket nobody was
 * listening on printed `(no status)`. That is ACCURATE — the transport never returned an HTTP status, so
 * there genuinely is none — and it is the least useful true thing available. Meanwhile the receipt
 * beside it already held `connect ECONNREFUSED 127.0.0.1:18899`, which names the address nothing was
 * listening on.
 *
 * exists because an unreachable door read as a refusal. That is fixed in the DATA.
 * The operator-facing half was not: three conditions with three different remedies all rendered
 * identically, and telling them apart meant opening a JSON receipt.
 *
 *   nothing listening on the port      `connect ECONNREFUSED 127.0.0.1:18899`  → start it, or fix the port
 *   the service answered with an error  a 5xx or 429 status                     → a different problem
 *   the port was never configured       `no TRADEMARK_MCP_HTTP_PORT in scope`   → configure it
 *
 * PRECEDENCE IS REASON FIRST, because the reason is the only one of the two fields that can name an
 * address, a missing variable or a spawn failure. A status is kept beside it when both exist: `503` and
 * "upstream refused" answer different questions and a reader wants both.
 *
 * THE FALLBACK STILL READS AS AN ABSENCE, and says which absence. "no status" alone was ambiguous — it
 * meant "no HTTP status", which a reader could mistake for "the door said nothing was wrong". An answer
 * that recorded neither field is a gap in the RECEIPT, and the line says so rather than filling it with
 * a guess.
 *
 * `brief` keeps both ends, which matters here: the address is at the END of an ECONNREFUSED string, so a
 * plain head-truncate throws away the only part worth reading.
 */
export function doorUnavailableLabel(a, { max = 90 } = {}) {
  // TWO SPELLINGS OF ONE FIELD, on purpose. At RUN time an answer carries the raw output as `out`; on
  // the RECEIPT the same text is persisted as `reason` (e2e.mjs writes it from `a.out`). One formatter
  // has to serve both surfaces or they drift — which is what they were already doing: the run-time line
  // read `status ?? out` and the report line read `status` alone, so a 503 lost its sentence in one
  // place and everything lost it in the other.
  const reason = String(a?.reason ?? a?.out ?? "").replace(/\s+/g, " ").trim();
  const status = a?.status ?? null;
  if (reason && status !== null) return `${status}: ${brief(reason, max)}`;
  if (reason) return brief(reason, max);
  if (status !== null) return `status ${status}`;
  return "no status and no reason recorded";
}

export function doorAsymmetry(answers) {
  const compared = answers.filter((a) => doorAnswerClass(a) === DOOR_ANSWER.ANSWERED);
  const unavailable = answers.filter((a) => doorAnswerClass(a) === DOOR_ANSWER.INFRA_UNAVAILABLE);
  const agreed = compared.length < 2 ? true : compared.every((a) => a.ok === compared[0].ok);
  return { agreed, compared, unavailable, reducedCoverage: unavailable.length > 0 };
}

const enqueue = (job, door) =>
  door === "cli" ? enqueueViaCli(job)
  : door === "ops-mcp" ? enqueueViaMcp(job)
  : door === "portal" ? enqueueViaMcp(job, { forwarder: "portal" })
  : door === "client-mcp" ? enqueueViaMcp(job, { clientPrincipal: true })
  : { ok: false, out: `unknown door "${door}"` };

// ── run dir discovery ────────────────────────────────────────────────────────────────────────────────
//
// Keyed on status.json, NOT meta.json — this cost a debugging round and is the kind of thing that makes
// a cleanup tool quietly useless. `meta.json` is written at PUBLISH time, so a run that failed before
// publishing has none: discovery by meta.json finds every run that succeeded and not one that failed,
// which is precisely backwards for a teardown and for a report you reach for when something broke.
// status.json exists from the first stage and carries ref/runId/slug/state. mcp-server/lib/runs.mjs
// discovers the same way, for the same reason.
//
// PREFIX match on ref: the submitted ref is the scenario's ref plus this round's token plus, for a
// multi-door case, the door (E2E-R0a → E2E-R0a-<token>-cli, E2E-R0a-<token>-opsmcp), so the runs stay
// distinguishable. Passing the bare scenario ref finds every round's runs; passing `<ref>-<token>` finds
// one round's, which is what cmdReport does.
//
// The WALK moved to driver/e2e-rounds.mjs so score.mjs can reach it without importing this file.
// It returns `{runs, searched, why}` there, because "the workspace root is unset" and "there are no runs"
// are different findings; this wrapper binds WORKSPACE_ROOT and hands back the array the existing callers
// expect. Callers that need the searched-ness ask `findRunsIn` directly.
const findRunsByRef = (ref) => findRunsIn(ref, WORKSPACE_ROOT).runs;

function readJson(p) { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } }
const dotted = (obj, path) => path.split(".").reduce((o, k) => (o == null ? o : o[k]), obj);

// ── · the outbox has TWO naming schemes, because there are two moments a requester can be told ────
//
// | when                                                    | packet                              | writer |
// |---------------------------------------------------------|-------------------------------------|--------|
// | refused at intake, before a run dir exists               | `intake-<queueBase>.failed.pending` | runner.mjs failAtIntake → intakeNotify |
// | parked as a duplicate, before a run dir exists           | `intake-<queueBase>.duplicate.pending` | runner.mjs parkDuplicate → duplicateNotify |
// | a run that started and then failed                       | `<runId>.failed.pending`            | pipeline.mjs / pipeline-knockout.mjs |
// | a run that delivered (or a failure wake marker)          | `<runId>.pending`                   | runner.mjs / pipeline*.mjs |
// | a late-bind acknowledgement                              | `<runId>.bindack.pending`           | pipeline.mjs |
//
// The queue-side check knew only the first row, because it was written for R0, where that is the only
// shape there is. It matched `x.includes(<queueBase>)`, and a `<runId>.failed.pending` carries no queue
// id at all — so R2's 2112-byte packet was invisible and the report said "the requester was never told"
// about a notification sitting on disk, which it had already NAMED four lines earlier from the other
// code path. A false alarm on delivery is more expensive than the absence-reads-as-success class it
// mirrors: it points an investigation at delivery when delivery is fine.
//
// RUNID FIRST WHERE A RUN EXISTS, queue base otherwise — one function, so the two callers cannot drift
// apart again. `<runId>.` and `intake-<base>.` are matched as PREFIXES rather than substrings: both are
// exactly what the writers above compose, and the trailing dot stops one runId prefix-matching another.
//
// AND IT SEPARATES "COULD NOT LOOK" FROM "FOUND NONE". Those are the two answers this whole issue is
// about. A bare empty array made them the same sentence.
// THE RUN IS NAMED TWO WAYS TOO, and the engine says so: outbox-backoff.mjs mints the canonical dated
// `<slug>-<date>-<codename>` but honours the legacy dateless `<slug>-<codename>` when deciding whether a
// marker is already queued, because a delivery in flight across the fix wears the old name. A harness
// that knew only status.runId would read such a marker as absent — the same defect one level down. Same
// sanitiser as the engine's, so the two derive the same string from the same status.
// REPAIR — THE FALLBACK IS PART OF THE FORM. The first draft composed the dated id from
// `status.runId` alone, while the engine composes `sanitize(status.runId ?? basename(runDir))`
// (outbox-backoff.mjs rescan). A status.json carrying slug+codename but no runId therefore produced two
// forms neither of which is the name on disk, and the report said "the requester was never told" with
// confidence — the reported defect re-authored one lane over. Three names, each cited to its writer:
//
//   <slug>-<date>-<codename>   status.runId, the canonical dated form every minting site writes now
//   <date>-<codename>          outbox-backoff.mjs rescan, when status.json carries no runId
//   <slug>-<codename>          the legacy dateless form outbox-backoff.mjs still honours for a delivery
//                              in flight across the fix
//
// runner.mjs backstopFailureNotice composes `<slug>-<basename(runDir)>` for a PRE-RUN throw, which is the
// canonical dated form spelled from two pieces — it collapses onto the first entry and is not a fourth.
// The fallback applies to the DATED form only: the legacy form is slug+codename or it is nothing.
export function runIdForms(status, runDir = null) {
  const sanitize = (s) => String(s).replace(/[^A-Za-z0-9._-]/g, "_");
  const dated = status?.runId ? sanitize(status.runId) : (runDir ? sanitize(basename(runDir)) : null);
  const slugged = status?.slug && runDir ? sanitize(`${status.slug}-${basename(runDir)}`) : null;
  const legacy = status?.slug && status?.codename ? sanitize(`${status.slug}-${status.codename}`) : null;
  return [...new Set([dated, slugged, legacy].filter(Boolean))];
}

export function outboxPackets({ runId = null, runIds = [], queueBase = null } = {}, outboxDir = process.env.CLEAROTRON_OUTBOX_DIR) {
  const rids = [...new Set([runId, ...runIds].map((x) => String(x ?? "").trim()).filter(Boolean))];
  const base = String(queueBase ?? "").trim();
  if (!outboxDir) return { packets: [], unreadable: `CLEAROTRON_OUTBOX_DIR is unset — the outbox was never looked in` };
  if (!existsSync(outboxDir)) return { packets: [], unreadable: `the outbox ${outboxDir} does not exist or cannot be read` };
  if (!rids.length && !base) return { packets: [], unreadable: "neither a runId nor a queue id is known for this row, so no packet name can be composed" };
  let names;
  try { names = readdirSync(outboxDir); }
  catch (e) { return { packets: [], unreadable: `the outbox ${outboxDir} could not be listed — ${e.code || e.message}` }; }
  const hit = new Set();
  for (const rid of rids) for (const f of names) if (f.startsWith(`${rid}.`)) hit.add(f);
  if (base) for (const f of names) if (f.startsWith(`intake-${base}.`)) hit.add(f);
  return { packets: [...hit].sort(), unreadable: null };
}

// ── assertions ───────────────────────────────────────────────────────────────────────────────────────
// Every op is implemented or explicitly reported UNIMPLEMENTED. An op that silently passes because
// nobody wrote it is the exact failure mode this whole suite exists to prevent.
const OPS = {
  equals: (v, want) => ({ ok: v === want, saw: JSON.stringify(v) }),
  falsy: (v) => ({ ok: !v, saw: JSON.stringify(v) }),
  exists: (v) => ({ ok: v !== null && v !== undefined, saw: v === null ? "absent" : "present" }),
  "non-empty": (v) => ({ ok: Array.isArray(v) ? v.length > 0 : Boolean(v), saw: Array.isArray(v) ? `${v.length} item(s)` : JSON.stringify(v) }),
  length: (v, want) => ({ ok: Array.isArray(v) && v.length === want, saw: Array.isArray(v) ? `${v.length}` : JSON.stringify(v) }),
};

function evalAssertion(a, runDir) {
  const [file, field] = String(a.path ?? "").split(":");
  const full = join(runDir, file || "");

  // whole-file ops
  // `no-stage-retried` USED TO LIVE HERE. Deleted, not fixed, because the question was wrong.
  //
  // It read run.jsonl for `event:"stage"` with `attempt > 1`. Attempts are recorded per stage, in
  // `_driver/<stage>.jsonl`; the `event:"stage"` row carries no `attempt` field and, on the knockout lane,
  // there are no stage events at all — so it matched nothing, every time, and printed "every stage
  // first-attempt" for a run that had visibly retried.
  //
  // SINCE (AD-4) run.jsonl DOES carry per-dispatch `event:"attempt"` rows, so the mechanical objection
  // above no longer holds and the file could now be read correctly. Do not take that as an invitation to
  // re-add the assertion — the reason it was deleted is the paragraph below, and that reason is unchanged.
  //
  // Reading the right file would not have saved it. A retry is not pass or fail: the one observed on
  // 2026-07-30 was a validator rejecting a banned tone word and the retry coming back clean — a guard
  // WORKING. Asserted as "no retries", that correct self-correction fails; asserted as it was, it
  // passed. Whether a retry matters is a judgment, so retries are now REPORTED by the ledger, with their
  // cause and their durations, and a reader decides. Same for `framework-is-house-default`, which greped
  // methodology-read.json for a customer overlay filename — a file that only ever holds SKILL.md paths,
  // so it could never fail. Replaced by a positive `equals` on framework.json:framework_key.
  if (a.op === "no-permission-prose") {
    if (!existsSync(full)) return { ok: false, saw: `${file} absent` };
    const txt = readFileSync(full, "utf8");
    const hits = [...txt.matchAll(/\b(permission[- ]blocked|not permitted to (?:use|call)|tool was unavailable|lacked permission)\b/gi)].map((m) => m[0]);
    return { ok: hits.length === 0, saw: hits.length ? hits.slice(0, 3).join(" · ") : "clean" };
  }
  // The receipt's refusals were DECIDED before the expensive stages read them. This is the ordering the
  // 2026-07-30 run got wrong and paid 1,436s for: placement started one second after the run recorded
  // three refused slices, and a digest attempt was dispatched over a condition already sitting in its
  // own inputs. The assertion can fail three distinct ways and says which — a decision that never
  // happened, a decision that happened too late, and a run where placement never ran at all (which
  // means this scenario should not be carrying the assert, not that it passed).
  //
  // — A STAGE THE RUN NEVER REACHED IS NOT PROBED, NOT FAILED. The third branch used to return
  // `ok: false` with a message that said, in its own words, that the assert did not belong there
  // ("this assert belongs on a scenario that reaches it"). A check that prints why it should not have
  // fired and then fires anyway is an engine defect named by the harness: R2 was scored FAIL on an
  // ordering question its run never got far enough to ask. "Not probed is not a pass" has a counterpart,
  // and this is it — not reached is not failed.
  //
  // AN EMPTY LOG IS STILL A FAIL, and that is the line that keeps this from being a loosening. A run.jsonl
  // with no readable rows says nothing about whether placement ran, so the ordering cannot be established
  // — that is an absence, and an absence is a finding. Only a log that DOES carry rows, none of which is
  // the placement stage, has positively recorded that the run stopped short.
  if (a.op === "settled-before-placement") {
    if (!existsSync(full)) return { ok: false, saw: `${file} absent` };
    const rows = readFileSync(full, "utf8").trim().split("\n").map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    if (!rows.length) return { ok: false, saw: `${file} has no readable rows — the ordering cannot be established, and an unreadable log is a finding, never a reason to skip a check` };
    const decided = rows.findIndex((r) => r.event === "envelope-decision-early");
    const placed = rows.findIndex((r) => r.event === "stage" && r.stage === "placement-inquiry");
    if (placed < 0) return { ok: true, notProbed: true,
      saw: `NOT PROBED (not a pass — nothing was examined): the run recorded ${rows.length} row(s) and none is the placement-inquiry stage, so it never reached the stage this assert orders. This assert belongs on a scenario that reaches it.` };
    if (decided < 0) return { ok: false, saw: "no envelope-decision-early — the receipt's refusals were never decided" };
    return { ok: decided < placed, saw: decided < placed
      ? `decided at row ${decided}, placement at ${placed}`
      : `placement ran at row ${placed}, BEFORE the decision at ${decided}` };
  }
  // No attempt of a stage failed on a named validator token. `path` is `_driver/<stage>.jsonl:<token>`.
  // Absence of the log is a FAIL, not a pass: a stage that never wrote its telemetry is exactly the
  // "absence read as success" shape this suite exists to remove.
  if (a.op === "no-attempt-fail-token") {
    if (!existsSync(full)) return { ok: false, saw: `${file} absent — a stage that logged nothing is not a stage that passed` };
    if (!field) return { ok: false, saw: "no token given (path must be <file>:<token>)" };
    const hits = readFileSync(full, "utf8").trim().split("\n")
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter((r) => r && typeof r.fail === "string" && r.fail.includes(field))
      .map((r) => `attempt ${r.attempt ?? "?"}: ${String(r.fail).slice(0, 80)}`);
    return { ok: hits.length === 0, saw: hits.length ? hits.slice(0, 3).join(" · ") : `no attempt failed on ${field}` };
  }
  // ── lane-aware, because one lane provably mints no plan ──────────────────────────────────────
  //
  // The defect is real and stays a FAIL where it can occur: a wildcard term dispatched under the `exact`
  // predicate returns the single identical record and reads as a swept family. But the KNOCKOUT lane
  // freezes no register plan at all — its register component is a two-predicate COUNT of the mark string
  // (identical / containing), so there is no term to mispair and no artifact to read. Asserted flat, the
  // check reported `[FAIL] register-plan.json absent` on every knockout run, and a tripwire that is red
  // every day is a tripwire nobody reads.
  //
  // NOT PROBED IS NOT A PASS, and three things keep it from becoming one:
  //   - the lane is read from the run's OWN frozen sidecar, never from a word the scenario file typed;
  //   - a sidecar that is absent, unparseable or names no pipeline is a FAIL — "cannot tell which lane
  //     ran" is an absence, and an absence is a finding;
  //   - the short circuit is (knockout AND the file is absent), never the lane alone: a knockout run that
  //     somehow DID write a plan is read normally, so the check cannot be turned off by lane.
  // On every other lane an absent plan stays the defect it always was.
  if (a.op === "no-wildcard-exact-pair") {
    if (!existsSync(full)) {
      const policy = readJson(driverDir(runDir, "search-policy.json"));
      if (!policy || typeof policy.pipeline !== "string" || !policy.pipeline.trim())
        return { ok: false, saw: `${file} absent, and _driver/search-policy.json names no pipeline — which lane ran cannot be established, and an unreadable lane is a finding, never a reason to skip a check` };
      if (policy.pipeline === "knockout")
        return { ok: true, notProbed: true,
          saw: `NOT PROBED (not a pass — nothing was examined): the knockout lane mints no register plan. Its register component is a two-predicate count of the mark string, so no wildcard term exists to mispair with the exact predicate.` };
      return { ok: false, saw: `${file} absent — on the ${policy.pipeline} lane the missing plan IS the defect` };
    }
    const plan = readJson(full);
    if (!plan) return { ok: false, saw: "register-plan.json present but unparseable" };
    const entries = Array.isArray(plan) ? plan : (plan.entries ?? plan.queries ?? []);
    // — WIDENED, NOT RENAMED. Scenario files live in the config repo, so a renamed op is never
    // invoked and the check ships INERT: the suite goes green while examining nothing, which is the
    // same failure this op committed. On R2b it read a plan carrying
    // `term="**Core (BIOVELTRIN, BIO VELTRIN, BIO-VELTRIN, etc.)**"` and reported "144 entries, none
    // mispaired" — true of the wildcard/exact pairing it was looking at, and useless. The term screen
    // is the driver's own (entryTermIssues, PURE — it pulls in nothing), so the harness cannot drift
    // from what the plan freeze enforces, and `owner` rows stay exempt there: a parenthesised company
    // name is a legitimate owner term and a bracket rule would report the register lane as broken.
    const bad = [
      ...entries.filter((e) => String(e?.term ?? "").includes("*") && e?.predicate === "exact")
        .map((e) => `${e.qid ?? "?"}:${e.term} (wildcard under exact)`),
      ...entries.flatMap((e) => entryTermIssues(e).slice(0, 1).map((i) => `${e.qid ?? "?"}:${i.term} (${i.issue.slice(0, 90)})`)),
    ];
    return { ok: bad.length === 0, saw: bad.length ? `${bad.length} un-dispatchable plan row(s) — ${bad.slice(0, 3).join("; ")}` : `${entries.length} entries, none mispaired and none label/markup-shaped` };
  }
  // ── fix 3: the report asserts nothing it did not examine ────────────────────────────────────────
  //
  // Three ops, one rule, non-optional at every depth. They exist because two runs on two matters reported
  // COMPLETE while missing nearly everything the lawyer named, and nothing in the deliverable said so —
  // the lane cannot know it failed to enumerate, so the honesty has to be asserted from outside.
  //
  // `names-configured-depth` — the transparency the product promises, made checkable. A surface must name
  // the search the registry says was configured, AND name no other. The second half is the one with
  // teeth: naming nothing is unverifiable, but naming a Knockout search on a Full country run is a false
  // statement about what the client bought. The expected label comes from reportIdentityFor over the
  // run's frozen sidecar — the same registry join every other door resolves against.
  //
  // IT SCANS FOR PRODUCT NAMES NOW, not for "Depth N". The rung vocabulary is retired and the
  // scan had to go with it, or this op would report "names no depth at all" on every run this build
  // produces — a green suite turning red for the one reason that is not a defect. The names come off the
  // registry (orderable AND retired), so an archived run is still checked against the label it was sold
  // under, and nothing here is hand-typed.
  //
  // `.identity` AND NOT `.stageLabel`. Both expectation and vocabulary read the stage label until
  // now, and the op passed — but only because search-policy.test.mjs asserts the two are equal FOR
  // ORDERABLE ROWS, a pin in another file. On a retired row they are not equal: the renderers print
  // `.identity` ("Knockout review") and this op wanted `.stageLabel` ("Depth 1"), which is not in the
  // document, so it reported "names no search at all" against a document naming its product correctly —
  // and it would have gone on passing if a renderer went back to printing the internal face, because the
  // op derived its expectation from the field it was not checking. Both halves now come off the one
  // field every renderer prints (render.mjs, render-knockout.mjs).
  if (a.op === "names-configured-depth") {
    const policy = readJson(driverDir(runDir, "search-policy.json"));
    if (!policy || !policy.level) return { ok: false, saw: "_driver/search-policy.json absent or names no product — the configured search is unreadable, so no surface can be checked against it" };
    const want = reportIdentityFor(policy).identity;
    if (!want) return { ok: false, saw: `the registry has no name for "${policy.level}"` };
    if (!existsSync(full)) return { ok: false, saw: `${file} absent` };
    const every = [...new Set([...ORDERABLE_PRODUCTS, ...RETIRED_PRODUCTS]
      .map((k) => reportIdentityFor(k).identity).filter(Boolean))];
    const text = readFileSync(full, "utf8");
    const hit = every.filter((label) => text.toLowerCase().includes(label.toLowerCase()));
    // PRODUCT NAMES NEST, WHERE THE RUNG NUMBERS DID NOT. "Knockout review with register hit-counts"
    // contains "Knockout review", and "Preliminary clearance with jurisdiction deep-dive" contains
    // "Preliminary clearance" — so a document naming its product correctly would read as naming two
    // products, and this op would fail every one of those three runs. A hit that is wholly inside
    // another hit is that other hit, not a second search.
    const named = hit.filter((l) => !hit.some((o) => o !== l && o.toLowerCase().includes(l.toLowerCase())));
    if (!named.length) return { ok: false, saw: `${file} names no search at all — the run was configured as ${want}, and a surface that never says which search ran cannot be checked` };
    const others = named.filter((d) => d.toLowerCase() !== want.toLowerCase());
    return { ok: others.length === 0,
      saw: others.length ? `${file} names ${others.join(", ")} while the run was configured as ${want}` : `names ${want}, and no other search` };
  }
  // `register-claims-within-counts` — an absence claim may never exceed the configured search. On a
  // count lane the engine holds two totals per mark and no records at all, so it cannot say the register
  // is clear, and it cannot say the register is crowded either: both are claims about a field it never
  // enumerated. What it MAY say is the count, or an expectation that labels itself as one (the lane's
  // own registerEstimate already ends "This is an expectation only, not a search result").
  //
  // Scoped to the count lane and it SAYS so rather than passing elsewhere: on a lane that freezes a real
  // register plan, enumerated language is supported by the enumeration, and this op has nothing to add.
  if (a.op === "register-claims-within-counts") {
    const policy = readJson(driverDir(runDir, "search-policy.json"));
    if (!policy || typeof policy.pipeline !== "string" || !policy.pipeline.trim())
      return { ok: false, saw: "_driver/search-policy.json names no pipeline — the configured register component is unreadable, and an unreadable configuration is a finding" };
    if (policy.pipeline !== "knockout")
      return { ok: true, notProbed: true, saw: `NOT PROBED (not a pass): the ${policy.pipeline} lane enumerates register records, so enumerated register language is supported there. This op only bounds a COUNT lane.` };
    if (!existsSync(full)) return { ok: false, saw: `${file} absent` };
    const sentences = readFileSync(full, "utf8").split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
    // Only sentences that speak about the REGISTER are in scope — a common-law absence claim is the
    // knockout's own base and is evidenced by the findings it published.
    const aboutRegister = /\b(register|registered|registration|registrations|filing|filings|trade\s?mark records?)\b/i;
    // Claims a count cannot support: a sweep, an emptiness, or a crowding of the field.
    const exceedsACount = /\b(?:no|not one|zero|none)\s+(?:\w+\s+){0,3}(?:filings?|registrations?|registered\s+\w+|marks?\s+on\s+the\s+register)\b|\b(?:clear|clean)\s+on\s+the\s+register\b|\bthe\s+register\s+is\s+(?:clear|clean|crowded)\b|\bnothing\s+on\s+the\s+register\b|\b(?:crowded|dilute[sd]?|dilution|saturated)\b|\b(?:register|registry)\s+search\s+(?:found|revealed|returned|shows?)\b/i;
    // Self-labelled as an expectation, or stated as the count it is — both stay inside what ran.
    const staysInside = /\bexpect(?:ed|ation|ations)?\b|\bpending\b|\bnot a search result\b|\bhit[- ]counts?\b|\bcounts?\b|\bmay adjust\b|\banticipat/i;
    const bad = sentences.filter((s) => aboutRegister.test(s) && exceedsACount.test(s) && !staysInside.test(s));
    return { ok: bad.length === 0,
      saw: bad.length ? `${bad.length} register claim(s) beyond a count — ${bad.slice(0, 2).map((s) => `"${s.slice(0, 120)}"`).join(" · ")}`
        : `${sentences.filter((s) => aboutRegister.test(s)).length} register sentence(s), each a count or a labelled expectation` };
  }
  // `survivor-not-clear` — a mark this lane did not knock out is a SURVIVOR, never a clear. The two words
  // are one dispatch decision apart for the reader: "clear" ends the matter, "not knocked out at the
  // configured depth" sends it to clearance, which is where the enumeration the knockout never did
  // actually happens.
  //
  // Deliberately narrow. `\bclear\b` alone flags "reading materially clearer", which is correct prose
  // about a class comparison, so the pattern matches VERDICT POSITIONS only — the shapes that end a
  // matter. A noise generator on a client deliverable would be read once and then ignored, which is the
  // failure this whole issue is about.
  if (a.op === "survivor-not-clear") {
    if (!existsSync(full)) return { ok: false, saw: `${file} absent` };
    const txt = readFileSync(full, "utf8");
    const hits = [...txt.matchAll(/\b(?:is|are|was|were|reads?|rated?|comes? back|came back)\s+(?:as\s+)?(?:clear|clean)\b|\bclear(?:ed)?\s+(?:to|for)\s+(?:proceed|use|filing|adopt)\w*\b|\bno\s+conflict(?:s|ing\s+(?:marks?|rights?|registrations?))?\s+(?:were\s+|was\s+)?(?:found|identified|exist)\w*\b|\bclean\s+sweep\b|\bgood\s+to\s+go\b/gi)].map((m) => m[0]);
    return { ok: hits.length === 0,
      saw: hits.length ? `${hits.length} clear-verdict phrase(s) — ${[...new Set(hits)].slice(0, 3).join(" · ")}; a survivor reads "not knocked out at the configured depth", never "clear"`
        : "no clear-verdict phrasing" };
  }
  // ── delivery, asserted against the delivery MODE rather than a raw boolean ──────────────────────────
  //
  // `status.json:sendPending == false` was asserted directly, and it can NEVER hold on the test
  // instance — which is the only instance this suite may run on. Test runs CLEAROTRON_DELIVERY=handoff:
  // the driver writes an outbox packet and waits for an integrator to send it, and nothing here is
  // wired to consume one. So `delivered` + `sendPending: true` IS the settled terminal state, and the
  // old assertion failed R1, R2 and R3 for being correct. No delivery scenario could report a pass.
  //
  // Asserting the mode's own contract checks MORE than the boolean did: under handoff the PACKET has to
  // exist. A run that flipped sendPending without writing one would have passed the old assertion and
  // fails this one.
  if (a.op === "delivery-settled") {
    const st = readJson(full);
    if (!st) return { ok: false, saw: "status.json absent or unparseable" };
    // — THERE IS NO MODE TO READ ANY MORE, and this is the one place where that mattered rather
    // than being a comment fix. This used to open `process.env.CLEAROTRON_DELIVERY || "email"` and take a
    // `sendPending === false` branch for anything that was not `handoff`. With the variable deleted that
    // read returns undefined, the fallback makes it "email", and the assertion flips to a state the note
    // above says can NEVER hold on the test instance — every delivery assertion would red, after merge,
    // in an E2E round rather than here. Delivery is one behaviour now, so the handoff contract IS the
    // contract, unconditionally, and it checks more than the old boolean did: the PACKET has to exist.
    // — one matcher, both packet schemes, and "could not look" is not "none written". This used to
    // read `packets = []` for three different absences — outbox unset, outbox missing, runId absent from
    // status.json — and print all three as `NONE WRITTEN`, which names a delivery defect for what is a
    // harness or deployment gap. Each absence now says which one it is; all of them still FAIL, because
    // a delivery that cannot be checked is not a delivery that was checked.
    // `runDir` goes in because the engine's dated form falls back to `basename(runDir)` when status.json
    // carries no runId, and this assertion is reading that exact status.json.
    // ── — THIS IS A DELIVERY CONTRACT, AND A RUN THAT DID NOT DELIVER NEVER ENTERED IT ────────
    //
    // Owner ruling, 2026-08-22, verbatim: "clean up the failed runs. they owe the client nothing."
    // (Relayed by role-overwatch; recorded here because the rule this line encodes is a product
    // decision, not a harness preference.)
    //
    // Measured before the ruling: `sendPending` is carried by 25 of 25 delivered runs and 0 of 29
    // failed, parked or cancelled ones. It is written on the delivery paths only. So this assertion,
    // run against a failed round, compared behaviour to a contract that never applied — and it was the
    // ONLY failing line in the harness's ledger for such a round, where it read as one more consequence
    // of the run failing rather than as a check that could never have passed.
    //
    // SCOPED BY TERMINAL STATE, NOT BY THE PRESENCE OF A PACKET. Keying on the packet would ask the same
    // wrong question one step later: a failed run DOES write one, which is exactly why 220 of them are
    // sitting in the outbox. The state is what says whether the contract applied.
    //
    // AND IT SAYS SO. `ok: true` in this harness means "nothing was flagged", never "PASS" — but a
    // reader still has to be able to tell a contract that held from one that never applied, so the
    // reason is stated rather than left as a green line.
    //
    // ── 2026-08-24, AND THIS SCOPE SURVIVED IT ────────────────────────────────────────────────────
    //
    // A second owner ruling that day ordered failed runs' notification packets onto the same re-drop
    // cover as delivered ones, and `driver/outbox-backoff.mjs`'s `owedANotification` now says so. That
    // is NOT a reversal of the line below and the two must not be read as one rule: what a failed run
    // owes the CLIENT is still nothing, which is this assertion's subject; what it owes the REQUESTER
    // is the news that it failed, which is the sweep's. Different recipients.
    //
    // The wording of the return below was corrected in the same change — it said a non-delivered run
    // "owes no notification", which was true of both halves when it was written and is now true of only
    // one. A comment that is half-right is how a settled decision gets re-litigated.
    const terminal = String(st.state ?? "").trim().toLowerCase();
    if (terminal && terminal !== "delivered")
      return { ok: true, saw: `state=${terminal} — this run never entered the delivery contract, so it is `
        + `NOT ASSERTED here (#1561: a non-delivered terminal run owes the CLIENT no report; the failure `
        + `notification it owes its requester is covered by the outbox sweep, not by this line). This is `
        + `a scope statement, not a delivery that was checked.` };

    const { packets, unreadable } = outboxPackets({ runIds: runIdForms(st, runDir) });
    return { ok: st.sendPending === true && packets.length > 0,
      saw: `mode=handoff sendPending=${JSON.stringify(st.sendPending)} packet=${
        packets.length ? packets.join(", ") : unreadable ? `NOT LOOKED FOR — ${unreadable}` : "NONE WRITTEN"}` };
  }

  // `absent` — the file must NOT exist, and its absence is the asserted state, not a silent pass.
  // Exists for enforced never-produce contracts (: a case-law artifact on a non-Full-country run
  // is a product-resolution defect). This is the one place absence is PASS, and it says so out loud —
  // everywhere else in this harness a missing file is a failure, and that stays true.
  if (a.op === "absent") {
    if (!existsSync(full)) return { ok: true, saw: `${file} absent — the asserted state, stated, not a file nobody looked for` };
    let size = "?";
    try { size = `${statSync(full).size} B`; } catch {}
    return { ok: false, saw: `${file} present (${size}) — this run produced an artifact the product does not carry` };
  }

  // ── · THE FLOOR OPS — the only two checks that need a mark the register actually holds ────────
  //
  // Every mark in this corpus was invented, so every register call returned zero rows, and zero rows is
  // the one input on which screening, close-variation matching, hydration and citation all do nothing.
  // A live-mark scenario enters that half of the lane; these two ops are what stop it going quietly
  // green if the register ever stops holding the mark.
  //
  // BOTH STATE A FLOOR AND NEVER A COUNT. The register is a third party's and it moves — a filing, a
  // lapse or a bulk load shifts any exact number, and an assert pinned to one turns an ordinary week
  // into a red. The floors in the store sit at roughly half the measured figure for that reason.
  //
  // NEITHER OP LETS AN UNTAKEN ANSWER READ AS A SMALL ONE. `driver/register-count.mjs` is built on one
  // rule — "a count we could not take is never zero", carried as `total: null` plus a reason — and
  // `driver/register-records.mjs` carries its counterpart, "a fetch that failed is not an empty list".
  // A floor op that compared `null >= 45` would honour both by accident and report the wrong defect: a
  // dead credential would read as a register that has emptied out. So each op checks whether an answer
  // was taken BEFORE it compares one, and says which of the two it found.
  if (a.op === "register-count-floor") {
    if (!existsSync(full)) return { ok: false, saw: `${file} absent — a run whose register lane wrote nothing is not a run that found nothing` };
    const doc = readJson(full);
    if (!doc) return { ok: false, saw: `${file} present but unparseable` };
    const want = field ? String(field).trim().toLowerCase() : null;
    if (!want) return { ok: false, saw: "no mark given (path must be <file>:<MARK NAME>)" };
    const m = (doc.marks ?? []).find((x) => String(x?.name ?? "").trim().toLowerCase() === want);
    if (!m) return { ok: false, saw: `no mark ${JSON.stringify(field)} in ${file} — it counted ${(doc.marks ?? []).map((x) => JSON.stringify(x?.name)).join(", ") || "nothing"}` };
    const floors = a.value && typeof a.value === "object" ? a.value : null;
    if (!floors) return { ok: false, saw: "value must be an object of predicate floors, e.g. {\"identical\": 45}" };
    const saw = [], short = [], untaken = [];
    for (const [pred, floor] of Object.entries(floors)) {
      const cell = m.counts?.[pred];
      if (!cell) { untaken.push(`${pred}: no such predicate on this run's sidecar`); continue; }
      if (!Number.isFinite(cell.total)) {
        untaken.push(`${pred}: NOT TAKEN — ${String(cell.unavailable ?? "no reason recorded").slice(0, 160)}`);
        continue;
      }
      saw.push(`${pred}=${cell.total} (floor ${floor})`);
      if (!(cell.total >= floor)) short.push(`${pred} is ${cell.total}, below the floor of ${floor}`);
    }
    if (untaken.length) return { ok: false, saw: `the count was never taken, so this scenario proved nothing about the hit path — ${untaken.join(" · ")}` };
    return { ok: short.length === 0,
      saw: short.length ? `${short.join(" · ")} — either the register has thinned out under this mark or the query narrowed; re-measure before moving the floor` : saw.join(" · ") };
  }

  // The listing behind the counts, and the two properties the hit path needs from it: enough rows to
  // hydrate, and rows from more than one office so the enumerate kernel's id-set union actually runs.
  // A total-only floor would let one office satisfy it while the multi-office property silently lapsed,
  // which is the whole reason this scenario exists — so the office span is asserted separately.
  //
  // Pipeline stage 1.6 is NEVER TERMINAL by design: a batch that got its numbers and could not fetch the
  // faces behind them still delivers, with the reason recorded. That is right for the product and it is
  // exactly what would make this assert lie, because the run reaches `delivered` either way. So a
  // structural refusal and a failed term are read as what they are, ahead of any comparison.
  if (a.op === "register-records-floor") {
    if (!existsSync(full)) return { ok: false, saw: `${file} absent — the filings lane wrote nothing, not even its refusal` };
    const doc = readJson(full);
    if (!doc) return { ok: false, saw: `${file} present but unparseable` };
    if (doc.unavailable) return { ok: false, saw: `the filings were never listed — ${String(doc.unavailable).slice(0, 200)}. A listing that was refused is not a register that holds nothing.` };
    const want = field ? String(field).trim().toLowerCase() : null;
    if (!want) return { ok: false, saw: "no mark given (path must be <file>:<MARK NAME>)" };
    const m = (doc.marks ?? []).find((x) => String(x?.name ?? "").trim().toLowerCase() === want);
    if (!m) return { ok: false, saw: `no mark ${JSON.stringify(field)} in ${file} — it listed ${(doc.marks ?? []).map((x) => JSON.stringify(x?.name)).join(", ") || "nothing"}` };
    const floors = a.value && typeof a.value === "object" ? a.value : {};
    const minRecords = Number.isFinite(floors.records) ? floors.records : 1;
    const minOffices = Number.isFinite(floors.offices) ? floors.offices : 1;
    const records = Array.isArray(m.records) ? m.records : [];
    const offices = [...new Set(records.map((r) => String(r?.territory ?? "").trim().toLowerCase()).filter(Boolean))];
    // A term the register refused is REDUCED COVERAGE, and it is named whichever way the floor goes: met,
    // it qualifies what was proved; missed, it says the shortfall may be the fetch rather than the register.
    const failed = (m.terms ?? []).filter((t) => t?.ok !== true)
      .map((t) => `${t?.term ?? "?"}: ${String(t?.reason ?? "no reason recorded").slice(0, 120)}`);
    const met = records.length >= minRecords && offices.length >= minOffices;
    const body = `${records.length} record(s) (floor ${minRecords}) across ${offices.length} office(s) [${offices.join(", ") || "none"}] (floor ${minOffices})`;
    if (met) return { ok: true, saw: failed.length ? `${body} — floor met, but ${failed.length} term(s) were refused and this run covered less than it asked for: ${failed.join(" · ")}` : body };
    return { ok: false,
      saw: failed.length ? `${body}, and ${failed.length} term(s) FAILED to fetch, so the shortfall may be the fetch and not the register: ${failed.join(" · ")}`
        : `${body} — the register returned fewer rows than the hit path needs, so screening, hydration and citation ran on less than this scenario exists to give them` };
  }
  // field ops
  const fn = OPS[a.op];
  if (!fn) return { ok: false, saw: `UNIMPLEMENTED op "${a.op}" — not passing by omission`, unimplemented: true };
  const doc = readJson(full);
  if (doc === null) return { ok: false, saw: `${file} absent or unparseable` };
  return fn(field ? dotted(doc, field) : doc, a.value);
}

// ── does anything actually drain this queue? ─────────────────────────────────────────────────────────
//
// The runner is a Type=oneshot; something has to fire it. Two things ship with the repo:
// prelim-driver.timer (a 90s fallback) and prelim-driver.path (instant, but its PathExistsGlob list
// hardcodes ONE deployment's agent queues — read driver/systemd/prelim-driver.path; a .path unit cannot
// read an environment variable, which is why those globs are literal). On a
// deployment whose queue lives anywhere else, the path unit can never fire, so the timer is the only
// drain — and if the timer is disabled, nothing drains at all and every job looks like a hung run.
//
// Three states, not two: "cannot tell" is reported as itself rather than as breakage, because
// systemctl --user needs XDG_RUNTIME_DIR and a plain `sudo -u <user> node …` does not set it.
function queueDrainState() {
  const sc = (...a) => {
    try { return execFileSync("systemctl", ["--user", ...a], { encoding: "utf8" }).trim(); }
    catch (e) { const o = `${e.stdout ?? ""}`.trim(); return o || null; }
  };
  const probe = sc("is-active", "prelim-driver.timer");
  if (probe === null) return { armed: null, how: "cannot query systemd --user from here (no XDG_RUNTIME_DIR?) — check prelim-driver.timer yourself" };
  const timer = probe === "active";
  const pathActive = sc("is-active", "prelim-driver.path") === "active";
  // The path unit only helps if one of its globs actually covers OUR queue dir.
  const pathCovers = pathActive && Boolean(QUEUE_DIR) && (sc("show", "prelim-driver.path", "-p", "Paths") ?? "").includes(QUEUE_DIR);

  if (timer && pathCovers) return { armed: true, how: "timer + path watch" };
  if (timer) return { armed: true, how: pathActive ? "timer only — the path unit watches a different queue" : "the 90s timer" };
  if (pathCovers) return { armed: true, how: "path watch only — no timer fallback, so a missed event never retries" };
  return { armed: false, how: pathActive
    ? "prelim-driver.timer is not active and prelim-driver.path watches a different queue"
    : "neither prelim-driver.timer nor prelim-driver.path is active" };
}

// ── commands ─────────────────────────────────────────────────────────────────────────────────────────

// ── — WHERE A DECLARED WALL CAME FROM, PRINTED BESIDE IT ──────────────────────────────────────
//
// The class finding: scenario files carry confident, specific claims about their own history that the
// artifacts contradict — three instances in one day. `measured: true` with no provenance is the trap,
// because it tells the next reader NOT to re-measure while giving them nothing to check.
//
// So the store now stamps `cost.measuredFrom`, and this prints it. THE PRINTING IS NOT DECORATION.
// This file's own dead-key rule says why, about `targetMinutes`: a key nothing reads "would sit in the
// store looking like the rule it used to be, and the next reader would 'fix' the benchmark by editing a
// number nothing reads". A provenance block nothing prints is exactly that key.
//
// STALENESS IS THE POINT, not the counts. A figure measured months ago over one run and a figure
// measured yesterday over seventeen are both "measured: true", and only one of them should be planned
// against. The age is computed here rather than stored, so it cannot itself go stale.
// ── · DOES THIS SCENARIO PROVE THE REGISTER HIT PATH? ──────────────────────────────────────────
//
// A search for a name nobody has filed returns zero rows, and zero rows is the one input on which
// screening, close-variation matching, record hydration and citation fidelity all do nothing at all.
// A corpus of invented marks exercises the register CALL and never the code that reads its answer —
// and it goes green either way. That is the gap; this is what makes it visible.
//
// THE LABEL STATES INTENT AND WHAT IS ASSERTED — NEVER "this name is invented". The issue was filed on
// the premise that every mark in this corpus was made up, and MEASUREMENT DISAGREED: probed on
// 2026-08-25 with no class filter over EM+US+WO, five of the corpus's names return identical hits
// (ARBORA 6, VOLTMAX 4, NOVAPULSE 3, QUIETWAVE 3, AURALITH 1) and three more are found by the broad
// name match alone. R4's much-noted "first non-zero on this box" was not luck; ARBORA was a real mark
// the whole time.
//
// So an incidental collision with a real filing is not the same thing as a scenario that PROVES the hit
// path, and a label meaning "invented" would have been false for five scenarios on the day it was
// written. `live` means the mark was chosen for the crowd it sits in AND the scenario asserts a floor
// under it. `synthetic` means neither — whatever such a scenario's counts happen to come back as, no
// assert holds them there and the next bulk load can take them away without reddening anything.
//
// THREE STATES, NOT TWO, and the third is the reason this is a function rather than a field read.
// A scenario that states nothing must read as CANNOT TELL — never as synthetic, and never as silence.
// Defaulting an absent label to "synthetic" would be a guess presented as a fact, and letting it print
// nothing is 's defect exactly: a benchmark that printed only when the key was present rendered as
// silence, which reads exactly like a benchmark that was met. An unstated label is reported, every time.
export const MARK_PROVENANCE = { LIVE: "live", SYNTHETIC: "synthetic", UNSTATED: "unstated" };

export function markProvenanceOf(scenario) {
  const raw = scenario?.markProvenance;
  if (raw === MARK_PROVENANCE.LIVE) return { state: MARK_PROVENANCE.LIVE,
    why: "its mark was chosen for the crowd it sits in and a floor is asserted under it, so screening, close-variation matching, hydration and citation run against real rows" };
  if (raw === MARK_PROVENANCE.SYNTHETIC) return { state: MARK_PROVENANCE.SYNTHETIC,
    why: "its marks were not chosen for the register to hold and no floor is asserted under them, so this round proves nothing about the hit path — whatever its counts happen to come back as" };
  if (raw === undefined || raw === null || String(raw).trim() === "") return { state: MARK_PROVENANCE.UNSTATED,
    why: "this scenario states no `markProvenance`, so whether it enters the register hit path CANNOT BE TOLD from the store" };
  return { state: MARK_PROVENANCE.UNSTATED,
    why: `this scenario's \`markProvenance\` is ${JSON.stringify(raw)}, which is neither "live" nor "synthetic" — so whether it enters the register hit path CANNOT BE TOLD from the store` };
}

/**
 * What the RUN's own register sidecars say, independent of the word the scenario file typed.
 *
 * The label is a claim about the store; this is the run's corroboration of it, and the two come apart
 * in both directions that matter. A scenario labelled `live` whose counts all came back zero has lost
 * the thing it exists for — the mark stopped being crowded, or the credential died, and records
 * that nothing on the box tells those two apart. A scenario labelled `synthetic` with non-zero counts
 * is mislabelled. Neither is visible from the label alone.
 *
 * `null` totals are NOT zeros and are counted separately: `driver/register-count.mjs` carries an untaken
 * count as `total: null` plus a reason, and folding those into "all zero" would report a dead lane as an
 * empty register.
 */
export function registerCountsWitness(runDirs) {
  let sidecars = 0, cells = 0, taken = 0, nonZero = 0, untaken = 0, best = 0;
  for (const d of runDirs ?? []) {
    const doc = readJson(driverDir(d, "register-counts.json"));
    if (!doc) continue;
    sidecars += 1;
    for (const m of doc.marks ?? []) {
      for (const cell of Object.values(m?.counts ?? {})) {
        cells += 1;
        if (!Number.isFinite(cell?.total)) { untaken += 1; continue; }
        taken += 1;
        if (cell.total > 0) { nonZero += 1; best = Math.max(best, cell.total); }
      }
    }
  }
  return { sidecars, cells, taken, nonZero, untaken, best };
}

export function provenanceLines(cost, today = new Date()) {
  const p = cost?.measuredFrom;
  if (!p) {
    // An absence is a finding. A scenario asserting `measured: true` with nothing behind it is the exact
    // shape filed, so it is named rather than passed over in silence.
    return cost?.measured
      ? ["measured: true — and NOTHING says where the figure came from (#1091). Re-measure, or drop the flag."]
      : [];
  }
  const out = [];
  const days = (() => {
    const t = Date.parse(p.at);
    return Number.isFinite(t) ? Math.floor((today.getTime() - t) / 86400000) : null;
  })();
  const age = days === null ? "date unreadable" : days <= 0 ? "today" : `${days} day${days === 1 ? "" : "s"} ago`;
  const n = p.deliveredRuns;
  const runs = n == null ? "" : ` · ${n} delivered${p.failedRuns ? `, ${p.failedRuns} failed` : ""}`;
  const range = p.walls ? ` · ${p.walls.min}-${p.walls.max} min` : "";
  const med = p.medianMinutes != null ? ` · median ${p.medianMinutes}` : "";
  out.push(`measured ${p.at} (${age})${runs}${range}${med}`);
  // The provider split, when there is one. A wall population drawn from two register eras cannot be
  // summarised by one number, and the reader has to see that before planning against it.
  const provs = Object.entries(p.providers ?? {});
  if (provs.length > 1) {
    out.push(`  ⚠ TWO PROVIDER ERAS in this population — ${provs.map(([k, v]) => `${k} ${v}`).join(", ")}`
      + ` — a median across them describes neither`);
  }
  // Excluded walls, each with its reason. A wall dropped without one is indistinguishable from a wall
  // nobody measured, which is the same defect one level along.
  for (const e of p.excluded ?? []) {
    out.push(`  EXCLUDED ${e.minutes ?? "?"} min — ${e.reason ?? "no reason recorded, which is itself the defect"}`);
  }
  if (p.source) out.push(`  source: ${p.source}`);
  return out;
}

function cmdList() {
  console.log("\nE2E scenarios — each is one complete clearance unless marked $0");
  console.log(`store: ${storeLine(STORE)}\n`);
  sweepStoreOrDie();
  for (const s of allScenarios()) {
    const cost = s.cost?.measured ? `~${s.cost.wallMinutes} min` : "UNMEASURED";
    const door = DOORS[s.door] ?? { how: "" };
    console.log(`  ${s.id}  ${s.title}`);
    // — tier BESIDE door and cost, and the marks line below is untouched: the two answer
    // different questions (which round runs this, versus what it proves) and a report needs both.
    // An absent `tier` prints as `standing` because that is what it MEANS, not as blank.
    console.log(`      door=${s.door}${door.real === false ? " (stand-in — see \`run\`)" : ""}  cost=${cost}  tier=${tierOf(s)}`);
    // — EVERY scenario gets a benchmark line. This used to be a suffix appended only when the
    // scenario carried its own `cost.targetMinutes`, so a scenario with no key printed no benchmark at
    // all, and an absent benchmark is not a met one.
    for (const l of turnaroundVerdict(bandForScenario(s)).lines) console.log(`      ${l}`);
    for (const l of provenanceLines(s.cost)) console.log(`      ${l}`);
    // — which scenarios prove the register HIT path, at a glance. Unconditional, and an
    // unstated label prints as loudly as a stated one.
    {
      const mp = markProvenanceOf(s);
      const flag = mp.state === MARK_PROVENANCE.LIVE ? "✔" : mp.state === MARK_PROVENANCE.SYNTHETIC ? "·" : "?";
      console.log(`      ${flag} marks: ${mp.state.toUpperCase()} — ${mp.why}`);
      // The note is where a scenario records what it MEASURED about its own marks — an incidental
      // collision with a real filing, or what a live mark was chosen for. Printed with the label and
      // never instead of it: the label says what is asserted, the note says what was found.
      if (String(s.markProvenanceNote ?? "").trim()) console.log(`        ${s.markProvenanceNote}`);
    }
    if (s.cost?.note) console.log(`      ${s.cost.note}`);
  }
  console.log();
}

// ── why the ref is normally door-SUFFIXED, and why one case must opt out ─────────────────────────────
//
// The suffix exists so `queueOutcomes` can tell one door's marker from another's: markers are named by
// queue id, never by ref, so the ref inside the job JSON is the only handle, and two doors sharing one
// ref are indistinguishable at the queue.
//
// But `matterSignature` (runner.mjs) INCLUDES the ref — deliberately, so that two distinct matters which
// happen to share a mark and classes are not deduped into one. A door-suffixed ref therefore makes each
// door a DIFFERENT matter, and R0d — whose entire subject is "the same matter submitted twice runs once"
// — could never produce the duplicate it exists to detect. Both doors admitted on every run, and
// `report` dutifully flagged "dedupe did not fire" and "2 doors ADMITTED the same matter": two
// INVESTIGATE entries per run naming an engine defect the engine did not have. The harness was breaking
// its own test, and the evidence was sitting in the ledger row quoted verbatim in cmdTeardown below.
//
// So the suffix is opt-OUT, per case, and only R0d takes it. Attribution is the price: with a single ref
// `report` cannot say WHICH door admitted and which parked. That is the right trade — dedupe is a SET
// property (`dedupeAcrossDoors`: at least one park, never more than one admission), and which door won
// the race is not something the engine promises.
//
// It must stay opt-IN. R0e expects `delivered` at BOTH doors; give it a shared ref and its second door
// parks as a duplicate, breaking both its terminal expectation and the doors-agree comparison. R0a/b/c
// refuse before any ledger row is written, so they are indifferent either way.
//
// LAYERS ON TOP OF THIS, AND DELIBERATELY UNDERNEATH IT: `refForRun` puts the round's token on the
// BASE ref before this function ever sees it (E2E-R0d → E2E-R0d-<token>), so the opt-out still hands
// both doors ONE ref and R0d still collides with itself inside the round. A token applied per SUBMISSION
// instead would separate those two doors again and quietly delete the case. The round token makes a
// scenario a new matter every ROUND; this function decides whether its doors are one matter or two.
//
// PURE + exported, like dedupeAcrossDoors, because this one decision governs whether a case can test its
// own subject at all — and it was wrong in exactly the direction nobody re-checks.
export function refForDoor(baseRef, door, { doors = [], oneMatterAcrossDoors = false } = {}) {
  if (doors.length <= 1 || oneMatterAcrossDoors) return baseRef;
  return `${baseRef}-${String(door).replace(/\W/g, "")}`;
}

async function cmdRun(id) {
  refuseProduction();
  // Scoped to THIS scenario. Findings about the others are printed, not fatal — the store is a
  // different repo and a deployment must not be judged on scenarios it was never asked to run.
  sweepStoreOrDie(id);
  const s = loadScenario(id);
  const door = DOORS[s.door] ?? null;
  console.log(`\n${s.id} — ${s.title}`);
  // Which store this came from, on the record before the run spends. The synthetic and the real scenario
  // share an ID, so the ledger afterwards cannot tell you which one ran unless the run says so now.
  console.log(`store: ${storeLine(STORE)}`);
  // Every scenario spends, R0 included — so every scenario refuses on stale code. R0 was exempted here
  // on the belief that it is refused at the door before any model call, which its own `why` also claimed.
  // It is not: R0d's FIRST submission is expected to admit (that is how it produces a duplicate to
  // detect) and R0e's expected terminal is `delivered`. Measured 2026-07-29: R0 ran four short knockout
  // clearances across the drivable doors. Only three of its five cases are free.
  reportCommit({ paid: true });
  console.log(`door: ${s.door} — ${door?.how ?? "unknown"}`);
  // Said out loud, every time, and written into the receipt: this round's refs are not the refs in the
  // scenario file, so a reader looking at the queue, the ledger or a run dir needs the token to tell this
  // round's rows from this morning's. Nothing here overrides a guard — dedup sees a genuinely new matter,
  // which is the whole.
  console.log(`round token: ${RUN_TOKEN} — every ref this invocation submits carries it (${scenarioRefs(s)[0] ?? "E2E-*"} → ${refForRun(scenarioRefs(s)[0] ?? "E2E-*")}).`);
  console.log(`      A re-run today is a NEW matter to dedup, while a case that shares one ref across doors still collides with itself inside this round.`);
  if (door && door.real === false) console.log(`      NOTE: this is not the UI itself. Recorded as a stand-in, not as coverage of the UI.`);
  // THE COST IS INFORMATION, NOT A GATE (owner, 2026-08-04: "if i ask for an e2e i know what im asking
  // for i dont need another ack"). The acknowledgement flag that used to refuse the run with exit 3 until
  // it was passed a second time bought nothing: the operator who typed `run R1` had already decided. What
  // the handover genuinely needs is the NUMBER, so it is printed unconditionally and the run proceeds.
  // Removing the gate did not remove the disclosure.
  //
  // deleted the last of it — the flag is not named anywhere now except in the regression guard that
  // keeps it from coming back, because an extra argument was never an error on this CLI and a re-added
  // field would sit here reading as a rule.
  console.log(s.cost?.measured
    ? `\n  cost: last measured ~${s.cost.wallMinutes} min.`
    : `\n  cost: UNMEASURED — say so in the handover, and record the wall once it lands.`);
  // — UNCONDITIONAL, and from the band rather than from the scenario. The old line was guarded on
  // the scenario's own `cost.targetMinutes`, so the one scenario in the store carrying no such key
  // printed no benchmark at all before spending three hours. The number is the band's; which band, is derived
  // from the pipeline the doors resolve this scenario's job to.
  for (const l of turnaroundVerdict(bandForScenario(s)).lines) console.log(`  ${l}`);
  for (const h of s.cost?.history ?? []) console.log(`    ${h}`);
  if (s.cost?.note) console.log(`  ${s.cost.note}`);

  // ── — THE PREVIOUS ROUND, SAID OUT LOUD, BEFORE ANYTHING QUEUES ────────────────────────────────
  //
  // The 2026-08-07 closing round: R2a delivered at 22:18Z, R2b was launched at 22:20Z, and the launch
  // said nothing. The receipt now keeps both rounds, so `report R2 --round <A>` still works — but the
  // ordering that avoids the whole problem (report and score the first half BEFORE launching the second)
  // was written down nowhere, and a fix that only makes recovery possible leaves the operator to
  // discover the need for it at the most expensive moment of the round.
  //
  // It PRINTS AND PROCEEDS. The acceptance asks for a statement before it queues, not a gate: a gate
  // would need an override flag, and the house rule bans flags. `--stale` is the precedent if the owner
  // ever wants the launch to stop.
  printPreviousRoundNotice(s);

  const jobs = s.job ? [{ id: s.id, job: s.job }] : (s.cases ?? []).map((c) => ({ id: c.id, job: c.job, what: c.what, oneMatterAcrossDoors: c.oneMatterAcrossDoors === true }));

  // door: "all" is the point of R0 — a rule enforced in one door and not another is exactly the #98
  // asymmetry. Every case goes through EVERY drivable door and the answers are compared. runner.mjs's
  // claimAndPrep is the wall they all land on, so they must agree; if they ever do not, the door that
  // admits is the bug, not the door that refuses.
  const doors = s.door === "all" ? Object.entries(DOORS).filter(([, d]) => d.real).map(([k]) => k) : [s.door];

  // `token` is what lets `report` — a later, separate process — read THIS round rather than every round
  // that ever used these refs. Without it the second same-day round's report mixes both rounds' queue
  // markers into one case and flags an engine defect that is really two rounds in one directory.
  //
  // — this is a ROUND, appended to the scenario's history. It used to be the whole receipt, written
  // over whatever was there, so the second run of a pair destroyed the first round's token and the
  // first half became unreportable with nothing saying so.
  const round = { token: RUN_TOKEN, startedAt: new Date().toISOString(), startedAtSource: "run", doors, cases: [] };
  for (const { id: caseId, job, what, oneMatterAcrossDoors } of jobs) {
    // The round token goes on the BASE ref, so the door suffix (and R0d's opt-out from it) still decides
    // whether the doors are one matter or two. See refForRun and refForDoor.
    const roundRef = refForRun(job.ref);
    const answers = [];
    for (const d of doors) {
      const res = await enqueue({ ...job, ref: refForDoor(roundRef, d, { doors, oneMatterAcrossDoors }) }, d);
      answers.push({ door: d, ...res });
    }
    const { agreed, unavailable, reducedCoverage } = doorAsymmetry(answers);
    console.log(`  ${agreed ? (answers[0].ok ? "queued " : "REFUSED") : "DISAGREE"} ${caseId}${what ? ` — ${what}` : ""}`);
    // — ONE LINE PER JOB, ALWAYS. This printed one line per CASE and, when the doors agreed and
    // accepted, nothing per door — so a 2-case round across 2 doors printed 2 lines while enqueuing 4
    // jobs, and the unprinted pair carried a whole door's results including a round's `.duplicate`
    // terminal. A watcher keyed on the printout read "all terminal" with half the round still running.
    //
    // A PARTIAL ENUMERATION READS AS A COMPLETE ONE. That is the failure this repo writes rules about,
    // and the accepted-and-agreed case is exactly the one where nobody looks twice.
    //
    // The id comes from the door's own answer. When a door refused there is no job and none is printed;
    // when it accepted and the id could not be read, that is SAID rather than skipped — a missing line
    // and a line saying the id is unknown are different facts to whoever is about to watch this queue.
    for (const a of answers) {
      if (a.ok) {
        console.log(`      [${a.door}] queued ${a.id ?? "(id not reported by this door — find it in the queue by ref)"}`);
      }
      if (!agreed || !a.ok || process.env.E2E_VERBOSE) {
        console.log(`      [${a.door}] ${a.ok ? "accepted" : "refused"}: ${a.out.split("\n").slice(0, 2).join(" ").slice(0, 200)}`);
      }
    }
    if (!agreed) console.log(`      ⚠ THE DOORS DISAGREE on this case — the one that ACCEPTED is the defect`);
    // — named, never silent. A door lost to the transport costs this case a share of its door
    // coverage, and that is a fact about the ROUND, not about the product. Saying nothing here is how
    // the R0e 429 cost a third of a scenario's coverage without appearing anywhere.
    for (const a of unavailable) {
      // The WHY, not just "no status": a door that is absent from this deployment and a door that died
      // mid-request are both excluded, and a reader chasing the second should not be sent looking for it
      // when it is the first.
      // — ONE formatter, shared with the report's reduced-coverage line. This site
      // already reached for the WHY, and it had the precedence backwards: `status ?? out` printed `503`
      // and threw away the sentence beside it. Two independent renderings of one fact is the shape that
      // drifts, and these two had already drifted apart.
      console.log(`      ⓘ [${a.door}] INFRASTRUCTURE UNAVAILABLE (${doorUnavailableLabel(a, { max: 120 })}) — excluded from the comparison; this case has reduced door coverage`);
    }
    // WHAT THE DOOR SAID, not just that it said no. A door refusal happens inside `enqueue`, BEFORE any
    // queue file is written — earlier than the claimAndPrep refusal, which at least leaves a `.failed`
    // marker and its `.reason` on disk. So for these cases this receipt is the ONLY record that survives
    // the process, and recording `accepted: false` alone threw the reason away: `report` could not check
    // `expect.reasonMatches`, and a case refused for the WRONG reason read exactly like one refused for
    // the right one. Whitespace-collapsed and truncated because the two doors answer in different shapes
    // (the CLI returns JSON, the MCP door an error string) and the receipt is a record, not a transcript.
    round.cases.push({ id: caseId, ref: job.ref, submittedRef: roundRef, agreed, reducedCoverage,
      answers: answers.map((a) => ({ door: a.door, accepted: a.ok,
        // — the job id this door queued, on the RECEIPT as well as on the screen. `report` runs in
        // a later process and could otherwise only re-derive the job set from refs; a watcher reading
        // this receipt now has the ids themselves. null means the door accepted and did not say which.
        jobId: a.id ?? null,
        // — the CLASS is recorded, not re-derived. `report` runs in a later process off this
        // receipt alone; if it had to re-classify from the reason string it would have to keep a regex
        // in step with a message format, which is the failure this issue is about.
        ...receiptAnswerClassification(a),
        reason: a.ok ? null : String(a.out ?? "").replace(/\s+/g, " ").trim().slice(0, 600) || null })) });
  }
  // Written for `report`, which runs later in another process and cannot otherwise know what each door
  // said. Best-effort: failing to record must never abort a run that has already been queued — which is
  // why appendRound returns its failure rather than throwing it.
  const wrote = appendRound(POOL_ROOT, s.id, round);
  if (wrote.preserved) console.log(`  the receipt on disk was unreadable; its bytes are preserved at ${wrote.preserved}`);
  if (!wrote.ok) console.log(`  (could not record this round: ${wrote.why}\n   — \`report ${s.id}\` will not know this round's token. It is \`${RUN_TOKEN}\`, printed above.)`);
  else console.log(`  recorded as round ${RUN_TOKEN} in ${wrote.path} (${wrote.rounds} round(s) of ${s.id} now on record)`);
  // This used to say "the runner drains on its own timer", flatly, and on the test instance that was
  // false: prelim-driver.timer ships disabled, and prelim-driver.path watches the hardcoded agent queues
  // of one deployment, which are not where a test deployment keeps its queue. A job sat
  // there indefinitely and looked exactly like a hung run. So check, and say which it is.
  const drained = queueDrainState();
  // — the count, stated. The per-job lines above are the enumeration; this is what makes a SHORT
  // enumeration visible as short instead of complete.
  const queuedIds = round.cases.flatMap((c) => c.answers.filter((a) => a.accepted).map((a) => a.jobId));
  console.log(`\n${queuedIds.length} job(s) queued across ${doors.length} door(s)${
    queuedIds.some((x) => !x) ? ` — ${queuedIds.filter((x) => !x).length} did not report an id` : ""
  }. The QUEUE is the source of truth for what is in flight; watch it, not this list.`);
  console.log(`\nqueued. ${
    drained.armed === true ? `The runner drains on its own — ${drained.how}.`
    : drained.armed === null ? `Drain state UNKNOWN — ${drained.how}.`
    : `NOTHING WILL DRAIN THIS QUEUE — ${drained.how}.\nArm it with:  systemctl --user enable --now prelim-driver.timer`}`);
  console.log(`Watch it with:  node scripts/e2e.mjs status\n`);
}

// — WHAT IS THIS QUEUE FILE, asked of the file rather than of its name.
//
// Three answers, and the warning belongs to exactly one of them:
//
//   live      `isLiveQueueMarker` — queued, claimed, mid-publish or parked. Something will still happen.
//   settled   a terminal suffix. Nothing further happens, and nothing should.
//   sidecar   the prose a job is ASSEMBLED FROM, a claim's liveness/identity files, the `.reason` or
//             `.result` that says why a marker was written. Beside a job, not one.
//
// Anything else that IS a job record — JSON carrying a ref or an id — is a job in a state the runner's
// drain does not recognise, which is the one state where nothing will ever move it: the observed case is
// a marker renamed to `.stopped-for-reboot`, which stranded a CORAL FREEZE run.
//
// THE RECORD, NOT THE NAME, IS WHAT MAKES THE WARNING TRUE. The first draft of this check asked only the
// name, against four sidecar suffixes typed from memory. It missed the nine prose sidecars, so a queue
// holding one ordinary job printed three copies of "this job is invisible to it" — a false alarm on every
// job enqueued through the prose-sidecar convention, authored inside the patch whose whole subject is
// false alarms of that shape. The vocabulary is now imported from the module that owns it AND the claim
// is checked against the file: a name is evidence, a job record is proof.
export function undrainableJob(queueDir, name) {
  if (isLiveQueueMarker(name)) return null;
  const suffix = name.slice(name.lastIndexOf(".") + 1);
  if (TERMINAL_QUEUE_SUFFIXES.includes(suffix)) return null;
  if (isQueueSidecar(name)) return null;
  const job = readJson(join(queueDir, name));
  if (!job || (job.ref == null && job.id == null)) return null;   // not a job record — nothing is stranded
  return `SUFFIX THE RUNNER DOES NOT DRAIN — this job carries a ref and no drain will ever claim it`;
}

function cmdStatus() {
  refuseProduction();
  // — LIST WHAT IS THERE. This filtered on a six-suffix allowlist, so a job renamed to anything else
  // printed as "empty" — the exact state in which nothing will ever drain it. A queue dir that does not
  // exist printed "empty" too, which is a statement about the deployment reported as a statement about
  // the queue. Sidecars are listed and TAGGED rather than dropped: hiding a file is the same sin one
  // notch quieter, and a stray `.postponed.meta` is worth seeing.
  console.log(`\nqueue (${QUEUE_DIR}):`);
  if (!existsSync(QUEUE_DIR)) {
    console.log(`  THE QUEUE DIR DOES NOT EXIST — that is a deployment fact, not an empty queue`);
  } else {
    const all = readdirSync(QUEUE_DIR).sort();
    if (!all.length) console.log("  empty");
    for (const f of all) {
      const stranded = undrainableJob(QUEUE_DIR, f);
      console.log(`  ${f}${stranded ? `   ⚠ ${stranded}` : isQueueSidecar(f) ? "   · sidecar" : ""}`);
    }
  }

  console.log(`\nruns for E2E refs:`);
  let any = false;
  for (const s of allScenarios()) {
    const refs = s.job ? [s.job.ref] : (s.cases ?? []).map((c) => c.job.ref);
    for (const ref of refs) {
      for (const hit of findRunsByRef(ref)) {
        any = true;
        const st = readJson(join(hit.runDir, "status.json")) ?? {};
        console.log(`  ${ref.padEnd(10)} ${String(st.state ?? "?").padEnd(10)} ${st.step ?? ""}${st.stepN ? ` ${st.stepN}/${st.stepTotal}` : ""}  ${hit.runDir.replace(WORKSPACE_ROOT, "…")}`);
      }
    }
  }
  if (!any) console.log("  none yet");
  console.log();
}

// ── refusals leave no run dir ─────────────────────────────────────────────────────────────────────────
//
// R0's whole point is that a rule is enforced at EVERY door, and its cases are meant to be refused. But a
// refusal happens in claimAndPrep, BEFORE a run dir exists, so `findRunsByRef` finds nothing for a case
// that behaved perfectly — and cmdReport counted "no run found" as a failure. R0 could not pass, and
// three of its assertions were unimplemented on top of that.
//
// What a refusal actually leaves, and all of it is in the QUEUE and the OUTBOX:
//   <base>.failed          the job, renamed from .processing        (clarify or reject)
//   <base>.failed.reason   the reasons, plus `notify: <outcome>`
//   <base>.duplicate       + .duplicate.reason                      (dedupe)
//   <base>.done                                                     (admitted and finished)
//   outbox intake-<base>.failed.pending   the requester's rejection packet
//
// So the terminal state IS the marker suffix. Read it; do not infer it from an absent run dir.
//
// ── · ONE SUFFIX, TWO MEANINGS, AND THE RUNNER RECORDS WHICH ─────────────────────────────────────
//
// `.failed` means "refused at intake" when a run never started, and "the run broke" when one did. Read
// with intake semantics unconditionally, an R2 run that went terminal after 9 attempts with
// terminalKind `invalid-artifact-loop` was printed as `parked as "clarify"` — a clarification request to
// the requester, which is a different event with a different owner and a different next step.
//
// THE DISCRIMINATOR IS A RECORD THE RUNNER WROTE, NOT THE SHAPE OF THE NAME. Beside the marker it writes
// exactly one of two sidecars, and never both:
//   <base>.<suffix>.reason   — text, written ONLY by an intake park (failAtIntake / parkDuplicate)
//   <base>.<suffix>.result   — the run terminal's own JSON, written ONLY after a run executed
//                              ({ok, failedStage, reason, runDir, …} — runner.mjs runPrepared)
// `.result` also carries the run dir, which is how the runId — and with it the run's own packets and its
// terminalKind — is reached without guessing a path.
//
// The two tables are consulted only where they DISAGREE. `.done` reads "delivered" either way and
// `.duplicate` is written at intake only, so a missing sidecar changes nothing for those and must not
// manufacture an "undetermined". `.failed` is the one suffix whose meaning depends on the moment, so
// `.failed` with neither sidecar is reported as UNDETERMINED — never silently resolved to one of them.
const TERMINAL_BY_SUFFIX = { failed: "clarify", duplicate: "duplicate", done: "delivered", cancelled: "cancelled" };
// A run terminal writes only these three (runner.mjs: `.${res.ok ? "done" : res.cancelled ? "cancelled" : "failed"}`).
// A suffix absent from this table is one the runner writes at intake only.
const TERMINAL_BY_SUFFIX_RAN = { failed: "failed", done: "delivered", cancelled: "cancelled" };

// REPAIR — the live-state vocabulary is IMPORTED, not retyped. This file's first draft spelled it
// out twice more (an in-flight suffix set and a claim-lock regex), which is exactly the failure
// queue-markers.mjs was created for: "written down three times and the copies disagreed ". 's
// claim lock in particular is a NORMAL in-flight state — a live token is a claim in progress, a dead one
// is restored by sweepAbandonedTakeovers — and one more private copy of that rule is one more chance to
// report a claim race as a stranded job.

// A `.result` read three ways, because "not there" and "there and torn" are different findings and this
// whole issue is about not merging them. `readJson` returns null for both.
function readRecord(p) {
  if (!existsSync(p)) return { state: "absent", value: null, why: null };
  let raw;
  try { raw = readFileSync(p, "utf8"); }
  catch (e) { return { state: "unreadable", value: null, why: `${basename(p)} is on disk and could not be read (${e.code || e.message})` }; }
  try { return { state: "present", value: JSON.parse(raw), why: null }; }
  catch (e) { return { state: "torn", value: null, why: `${basename(p)} is on disk (${raw.length} bytes) and does not parse as JSON (${e.message})` }; }
}

/**
 * What the QUEUE recorded about one marker: which terminal, whether a run ever started, and where the
 * evidence for that is. `undetermined` is a real answer and is never collapsed into either reading.
 * Pure apart from the reads; queueDir is a parameter so it is testable against a temp dir.
 */
export function readMarkerTerminal(queueDir, base, suffix) {
  const name = `${base}.${suffix}`;
  const live = liveQueueState(name);
  if (live) {
    return { terminal: live, started: null, undetermined: false, inFlight: true,
      why: live === suffix
        ? "not a terminal — the job is still in the queue"
        : `not a terminal — ${name} is the #377 claim lock, which is the .processing marker renamed while its liveness token is written; a live token is a claim in progress and a dead one is restored by sweepAbandonedTakeovers`,
      runDir: null, runId: null, runIds: [], statusRead: null, terminalKind: null };
  }
  const rec = readRecord(join(queueDir, `${name}.result`));
  const hasReason = existsSync(join(queueDir, `${name}.reason`));
  const intakeWord = TERMINAL_BY_SUFFIX[suffix] ?? suffix;
  const ranWord = TERMINAL_BY_SUFFIX_RAN[suffix] ?? null;

  // REPAIR — A RECORD THAT IS THERE AND UNREADABLE IS NOT A RECORD THAT IS ABSENT. The `.result`
  // file EXISTING is itself the discriminator (runner.mjs writes it only at a run terminal, after the
  // pipeline returned), so the terminal word survives a torn file. What is lost is the run dir inside it,
  // and with it the runId — so this says that, instead of "neither sidecar is on disk to say which" about
  // a file that is on disk.
  if (rec.state === "torn" || rec.state === "unreadable") {
    return { terminal: ranWord ?? intakeWord, started: true, undetermined: ranWord === null, inFlight: false,
      why: `${rec.why} — its presence still says a run executed, but the run dir it carries could not be read`,
      runDir: null, runId: null, runIds: [], statusRead: false, terminalKind: null };
  }
  if (rec.state === "present") {
    const result = rec.value;
    const runDir = typeof result?.runDir === "string" && result.runDir ? result.runDir : null;
    const st = runDir ? readJson(join(runDir, "status.json")) : null;
    const runId = st?.runId ? String(st.runId) : null;
    return {
      runIds: runIdForms(st, runDir),
      // Whether the RUN's own record was read, which is what separates a complete runId search from one
      // that could only compose the engine's `basename(runDir)` fallback. `<date>-<codename>` is a real
      // name the engine writes, so it is worth searching — but it is not the canonical one, and finding
      // nothing under it alone is not evidence that nothing was written.
      statusRead: Boolean(st),
      terminal: ranWord ?? intakeWord, started: true, undetermined: ranWord === null, inFlight: false,
      why: ranWord === null
        ? `a run terminal record (${name}.result) sits beside a .${suffix} marker, which the runner writes at intake only`
        : `${name}.result — a run executed and this is its own terminal record`,
      runDir, runId,
      terminalKind: st?.terminalKind ?? result?.terminalKind ?? null,
    };
  }
  if (hasReason) {
    return { terminal: intakeWord, started: false, undetermined: false, inFlight: false,
      why: `${base}.${suffix}.reason — parked at intake, before any run dir existed`, runDir: null, runId: null, runIds: [], statusRead: null, terminalKind: null };
  }
  // Neither sidecar. Only report undetermined where the reading actually turns on it.
  if (ranWord === null || ranWord === intakeWord) {
    return { terminal: intakeWord, started: null, undetermined: false, inFlight: false,
      why: `no ${base}.${suffix}.reason and no .result, but both readings of .${suffix} agree`, runDir: null, runId: null, runIds: [], statusRead: null, terminalKind: null };
  }
  return { terminal: "undetermined", started: null, undetermined: true, inFlight: false,
    why: `.${suffix} means "${intakeWord}" when the job never started and "${ranWord}" when a run did, and neither `
      + `${base}.${suffix}.reason nor ${base}.${suffix}.result is on disk to say which`,
    runDir: null, runId: null, runIds: [], statusRead: null, terminalKind: null };
}

// PREFIX match, and it returns EVERY match. The submitted ref carries this round's token and, for a
// multi-door case, the door (E2E-R0a → E2E-R0a-<token>-cli, E2E-R0a-<token>-opsmcp), so an exact match on
// the scenario's ref finds nothing and taking the first hit hides the other doors — which are the entire
// point of R0. `findRunsByRef` matches by prefix for the same reason.
// queueDir is a parameter so this is testable against a temp dir. QUEUE_DIR is captured at module load,
// so a test that only sets process.env after import drives nothing and passes vacuously — which is the
// exact failure mode this whole file exists to stop.
// Dedupe read across doors. PURE + exported, because the arithmetic is the subtle part: R0d puts the SAME
// matter through every door to prove it runs ONCE, and its own note says the first submission is expected
// to ADMIT. So "every door parked as duplicate" is the wrong test — one admission is correct, two is the
// defect, and zero parks means dedupe never fired.
//
// — ADMISSION IS A WHITELIST, and an unreadable terminal is counted as neither. `t !== "duplicate"
// && t !== "clarify"` counted EVERYTHING else as an admission: a job still `.processing`, a marker whose
// terminal could not be established, a word nobody has written yet. Two of those under one ref read as
// "2 doors ADMITTED the same matter — it ran more than once", which is an engine defect that did not
// happen. A run that started and then FAILED is a genuine admission and stays one — it got past the door,
// which is the only thing dedupe is about.
export function dedupeAcrossDoors(terminals) {
  const parked = terminals.filter((t) => t === "duplicate").length;
  const admitted = terminals.filter((t) => t === "delivered" || t === "failed" || t === "cancelled").length;
  const undetermined = terminals.filter((t) => t === "undetermined").length;
  const inFlight = terminals.filter((t) => LIVE_QUEUE_STATES.includes(t)).length;
  return { parked, admitted, undetermined, inFlight, ranMoreThanOnce: admitted > 1,
    // "Nobody parked" is only a finding once every door has settled and every terminal could be read.
    // Otherwise the arithmetic is incomplete, and incomplete arithmetic must not name a defect.
    neverFired: parked === 0 && undetermined === 0 && inFlight === 0 };
}

// `knownRuns` is the caller's own findRunsByRef(ref) result — see the runId note inside.
function queueOutcomes(ref, queueDir = QUEUE_DIR, knownRuns = []) {
  if (!existsSync(queueDir)) return [];
  const files = readdirSync(queueDir);
  const out = [];
  // The ref lives inside the job JSON, which survives every rename (.json → .processing → .failed). The
  // filename never carries it.
  for (const f of files) {
    const job = readJson(join(queueDir, f));
    if (!job || !String(job.ref ?? "").startsWith(ref)) continue;
    // — EVERY suffix, not a whitelist of seven. A marker renamed to something the list did not know
    // (the `.stopped-for-reboot` that stranded CORAL FREEZE is the real one) was dropped here entirely, so
    // a job that had left a very loud trace was reported as having left no queue marker at all. The
    // greedy base match is deliberate: `<base>.failed` → (base, failed), and a base containing a dot
    // keeps it. Sidecars cannot reach this line — `.reason` is not JSON, and `.result` / `.postponed.meta`
    // are JSON with no `ref` key, so the guard above rejects all three.
    const m = /^(.*)\.([^.]+)$/.exec(f);
    if (!m) continue;
    const [, base, suffix] = m;
    const reasonFile = files.find((x) => x === `${base}.${suffix}.reason`);
    const reason = reasonFile ? readFileSync(join(queueDir, reasonFile), "utf8").trim() : null;
    const t = readMarkerTerminal(queueDir, base, suffix);
    // REPAIR — THE RUN DIR THE CALLER ALREADY HOLDS. `runPrepared`'s pre-run-throw lane writes
    // `<base>.failed.result` as `{ok:false, reason}` with NO runDir in it, and runner.mjs
    // backstopFailureNotice then writes `<slug>-<basename(runDir)>.pending` — a packet named after a run
    // the marker's own record does not name. cmdReport has that run dir in hand from findRunsByRef(ref)
    // and this used to throw it away, so on the one live lane the issue's first bullet is about ("match
    // outbox packets by runId when a run dir exists") the runId lane was still never searched.
    //
    // MATCHED ON THE DOOR'S REF, EXACTLY. driver/progress.mjs seeds a run's status.json with
    // `ref: job.ref ?? null` — the job's ref verbatim — so equality is the engine's own relation, not an
    // assumption. Do NOT relax it to the `startsWith` findRunsByRef uses: door refs are `<base>-<door>`
    // and `cli` is a PREFIX of `client-mcp`, so a prefix match would credit the cli door with the
    // client-mcp door's notification. The cross-door test pins that.
    const fromCaller = (knownRuns ?? [])
      .filter((h) => String(h?.status?.ref ?? "") === String(job.ref))
      .flatMap((h) => runIdForms(h.status, h.runDir));
    // runId FIRST where a run exists (its packets are named `<runId>.…`), the queue base otherwise (an
    // intake refusal is named `intake-<base>.…`). One matcher for both, shared with `delivery-settled`.
    const runIds = [...new Set([...t.runIds, ...fromCaller])];
    const { packets, unreadable } = outboxPackets({ runIds, queueBase: base });
    // SEARCHED AND EMPTY IS A FINDING; COULD NOT SEARCH IS NOT. This reads the ids ACTUALLY searched, not
    // the ones the marker's record happened to name — reading the latter would turn a genuine "the
    // requester was never told" into a NOT PROBED line the moment the caller supplied the run dir, which
    // is suppressing a real finding to fix a false one.
    // A search of the runId lane is COMPLETE only when some run's own status.json was read — that is the
    // record the canonical `<slug>-<date>-<codename>` name comes from. Without it the only composable name
    // is the engine's `basename(runDir)` fallback, which is worth searching and is not proof on its own.
    const searchedFully = t.statusRead === true || fromCaller.length > 0;
    const blindRunLane = t.started === true && !packets.length && !searchedFully
      ? `a run started (per ${base}.${suffix}.result) but no run record could be read${t.runDir ? ` at ${t.runDir}/status.json` : " — the record names no run dir"} and no run dir for this door was passed in, so ${runIds.length ? `only the \`${runIds.join("`, `")}\` form(s) could be composed and the canonical \`<slug>-<date>-<codename>\` name is unknown` : "the \`<runId>.*.pending\` lane was never searched"}`
      : null;
    out.push({ base, suffix, ref: job.ref, terminal: t.terminal, started: t.started,
      undetermined: t.undetermined, inFlight: t.inFlight, terminalWhy: t.why, runDir: t.runDir,
      runId: t.runId, terminalKind: t.terminalKind,
      // Same question cmdStatus's listing asks, and the same imported vocabulary answers it: a job in a
      // state neither live nor terminal is one no drain will ever claim. Reaching this line at all means
      // the file IS a job record (the `job.ref` guard above), so the name is the only thing left to ask.
      unrecognisedSuffix: !isLiveQueueMarker(`${base}.${suffix}`) && !TERMINAL_QUEUE_SUFFIXES.includes(suffix),
      reason, packets, packetsUnreadable: unreadable ?? blindRunLane });
  }
  return out;
}

// ── #514 · HAS THIS ROUND FINISHED, AND IS THAT KNOWN? ───────────────────────────────────────────────
//
// THE ONLY PLACE SETTLEDNESS IS DECIDED. Both the launch pre-flight and `report`'s stamp call this, so
// they can never disagree about whether the previous round is done — which is the disagreement that
// would silence the warning for a terminal nobody ever read.
//
// THREE STATES, and the third is the one that must not collapse into the first. `queueOutcomes` returns
// `[]` when QUEUE_DIR does not exist and `findRunsByRef` returns `[]` when the workspace root is unset:
// both mean "could not look", and both look exactly like "nothing there". A settledness judgment built
// on that reports an unlooked-at round as a settled terminal, and the operator is then told a round was
// finished by a harness that never searched for it.
export function roundSettlement(round, refs, { queueDir = QUEUE_DIR, queueSearched = null, workspaceSearched = null } = {}) {
  const searchedQueue = queueSearched === null ? Boolean(queueDir) && existsSync(queueDir) : queueSearched;
  const markers = [];
  for (const ref of refs ?? []) {
    for (const q of searchedQueue ? queueOutcomes(ref, queueDir) : []) {
      if (tokenFromRef(ref, q.ref) === round?.token) markers.push(q);
    }
  }
  const runStates = (round?.runs ?? []).map((r) => String(r?.status?.state ?? ""));
  const live = markers.filter((m) => m.inFlight === true || LIVE_QUEUE_STATES.includes(m.terminal));
  const running = runStates.filter((st) => st === "running");
  // POSITIVE EVIDENCE OF IN-FLIGHT BEATS NOT-SEARCHED. A run dir saying `running` settles the question
  // in the one direction an incomplete search cannot make wrong.
  if (live.length || running.length) {
    return { state: "in-flight", terminals: markers.map((m) => m.terminal), markers: markers.length, runs: runStates.length,
      why: `${live.length} live queue marker(s) and ${running.length} run dir(s) still \`running\`` };
  }
  if (!searchedQueue || workspaceSearched === false) {
    return { state: "unknown", terminals: markers.map((m) => m.terminal), markers: markers.length, runs: runStates.length,
      why: [!searchedQueue ? `the queue was NOT SEARCHED (${queueDir ? `CLEAROTRON_QUEUE_DIR ${queueDir} does not exist` : `CLEAROTRON_QUEUE_DIR is unset`})` : null,
            workspaceSearched === false ? `the workspace was NOT SEARCHED (CLEAROTRON_WORK_DIR is unset or unreadable)` : null]
        .filter(Boolean).join("; ") };
  }
  if (!markers.length && !runStates.length) {
    return { state: "unknown", terminals: [], markers: 0, runs: 0,
      why: "the queue and the workspace were both searched and neither holds anything for this round — its evidence may have been torn down" };
  }
  return { state: "settled", terminals: markers.map((m) => m.terminal), markers: markers.length, runs: runStates.length,
    why: `${markers.length} queue marker(s) terminal, ${runStates.length} run dir(s) not \`running\`` };
}

/**
 * WHAT THE LAUNCH MUST SAY about the round before this one — or null when there is nothing to say.
 *
 * PURE, and it takes `settlementOf` as a function so the decision above is not restated here. Keyed on
 * `reportedState === "settled"`, NEVER on `reportedAt != null`: the issue's operator ran `report R2`
 * thirty seconds into R2b, so a round CAN be reported while in flight, and treating that as "reported"
 * would silence the warning for the terminal it reaches an hour later.
 *
 * A round teardown has cleared drives no warning at all. A warning that fires forever on a round whose
 * evidence is gone is one the operator learns to skip — including on the round where it is real.
 */
export function previousRoundNotice(rounds, settlementOf) {
  const live = (rounds ?? []).filter((r) => !r.clearedAt);
  if (!live.length) return null;
  const round = live[0];
  const settlement = settlementOf(round);
  if (settlement.state === "settled" && round.reportedState === "settled") {
    return { kind: "reported", round, settlement };
  }
  if (settlement.state === "settled") return { kind: "unreported-terminal", round, settlement };
  return { kind: settlement.state === "in-flight" ? "in-flight" : "unknown", round, settlement };
}

/** The pre-flight block itself: gather the rounds, ask the two functions above, print what they say. */
function printPreviousRoundNotice(s) {
  const refs = scenarioRefs(s);
  const receipt = readReceipt(POOL_ROOT, s.id);
  const disk = roundsFromRuns(refs, WORKSPACE_ROOT);
  const rounds = mergeRounds({ receiptRounds: receipt.rounds, diskRounds: disk.byToken });
  const notice = previousRoundNotice(rounds, (r) =>
    roundSettlement(r, refs, { queueDir: QUEUE_DIR, workspaceSearched: disk.searched }));
  if (!notice) {
    // An absence is a finding: say which absence it is, so "no earlier round" is never a receipt nobody
    // could read.
    console.log(`\nprevious round: none on record${receipt.state === "absent" ? "" : ` — ${receipt.why ?? "the receipt records no round that teardown has not cleared"}`}.`);
    return;
  }
  const { round, settlement } = notice;
  const letters = roundLetters(rounds);
  const label = `${s.id}${letters[rounds.indexOf(round)]} (token ${round.token ?? "untokened"})`;
  const dirs = (round.runs ?? []).map((r) => r.runDir);
  if (notice.kind === "reported") {
    console.log(`\nprevious round: ${label} — settled and already reported at ${round.reportedAt}. Nothing is waiting on you.`);
    return;
  }
  if (notice.kind === "in-flight") {
    console.log(`\n⚠ previous round ${label} IS STILL IN FLIGHT — ${settlement.why}.`);
    console.log(`  Launching now puts two rounds of ${s.id} in the queue at once. That is legal and it is what a`);
    console.log(`  #217 noise-floor pair is, but \`report ${s.id}\` reads ONE round: name the other with --round.`);
    return;
  }
  if (notice.kind === "unknown") {
    console.log(`\nprevious round ${label}: its state COULD NOT BE ESTABLISHED — ${settlement.why}.`);
    console.log(`  This is not "the previous round is finished and read". Nothing here is a reason to stop; it is a`);
    console.log(`  reason to look before you read this round's report as the whole picture.`);
    return;
  }
  console.log(`\n${"═".repeat(78)}`);
  console.log(`⚠ THE PREVIOUS ROUND OF ${s.id} REACHED A TERMINAL AND HAS NOT BEEN REPORTED.`);
  console.log(`\n  round:    ${label}${round.startedAt ? `, started ${round.startedAt}${round.startedAtSource === "run" ? "" : ` (from the ${round.startedAtSource})`}` : ""}`);
  console.log(`  terminal: ${settlement.terminals.filter(Boolean).join(", ") || "(no queue marker; the run dirs settled it)"} — ${settlement.why}`);
  for (const d of dirs) console.log(`  run dir:  ${d}`);
  if (round.inReceipt === false)
    console.log(`\n  The receipt holds NO ENTRY for this round — a later round overwrote it, or its own record\n`
      + `  failed to write. Its artifacts are readable; what each DOOR answered is not, and re-running\n`
      + `  produces a different round rather than this one.`);
  console.log(`\n  Read it BEFORE this round overtakes it:`);
  console.log(`    node scripts/e2e.mjs report ${s.id} --round ${round.token}`);
  for (const d of dirs) console.log(`    node scripts/score.mjs ${s.id} --run ${d}`);
  console.log(`\n  A pair is only comparable if BOTH halves are read. Nothing is lost by launching now — the`);
  console.log(`  receipt keeps every round — but the ordering that costs nothing is: report and score the`);
  console.log(`  first half, then launch the second.`);
  console.log(`${"═".repeat(78)}`);
}

// `run` records what each door answered, because `report` runs later in a different process and cannot
// otherwise know. A rule enforced in one door and waved through by another is exactly the #98 asymmetry,
// and it is invisible unless the answers are compared.
//
// — the receipt's PATH and FORMAT moved to driver/e2e-rounds.mjs (`receiptPath`, `readReceipt`),
// so score.mjs and this file cannot drift about where the record lives or what shape it is. Each round
// carries its own `cases`, and the reader below is handed one ROUND, never the whole file.

/**
 * WHAT THE DOORS SAID about a case that left nothing on disk — or null when the receipt cannot answer.
 *
 * A DOOR REFUSAL IS EARLIER THAN A claimAndPrep REFUSAL. `enqueue` refuses before any queue file is
 * written, so there is no `.failed` marker and no `.reason` to read; a claimAndPrep refusal leaves both.
 * For these cases the receipt `run` wrote is not a weaker source than the queue — it is the ONLY one.
 *
 * Null means "this receipt does not settle it": no receipt, no entry for this ref, or at least one door
 * accepted. The caller falls through to "left no trace", which stays a finding where it really is one.
 * Absence of evidence keeps its meaning; what changes is that present evidence is finally read.
 *
 * `reasonRecorded: false` is a receipt written before reasons were kept. It is NOT PROBED, never a pass
 * — a case refused for entirely the wrong reason reads exactly like one refused for the right one.
 */
export function doorRefusal(receipt, ref, expect = null) {
  const rc = (receipt?.cases ?? []).find((c) => c.ref === ref) ?? null;
  const recorded = rc?.answers ?? [];
  // — ONLY THE DOORS THAT ANSWERED. `doorAsymmetry` has excluded unavailable doors from the #98
  // comparison since, but this function did not, and it is the one that prints
  // "refused at the door by cli, ops-mcp". A door that was never asked was listed there as a refuser,
  // so a case where one door refused correctly and the other did not exist read EXACTLY like a case
  // where both refused as ordered — which is the whole reason every case runs against every door.
  //
  // Same `answerClass ?? doorAnswerClass(a)` fallback the round summary uses: a receipt written before
  // carries no class, and `doorAnswerClass` reads those as ANSWERED rather than retrospectively
  // inventing infrastructure failures in rounds nobody can re-run.
  const answers = recorded.filter((a) => (a.answerClass ?? doorAnswerClass(a)) === DOOR_ANSWER.ANSWERED);
  const excluded = recorded.filter((a) => (a.answerClass ?? doorAnswerClass(a)) === DOOR_ANSWER.INFRA_UNAVAILABLE)
    .map((a) => a.door);
  if (!answers.length || !answers.every((a) => a.accepted === false)) return null;
  const wantReason = expect?.reasonMatches ?? null;
  const reasonRecorded = answers.some((a) => a.reason);
  const want = expect?.terminal ?? null;
  return {
    doors: answers.map((a) => a.door),
    // — the doors that could not be asked, so the caller can say the case proved less than it
    // looks like it proved. Empty is the normal case and reads as full coverage.
    excluded,
    reasons: answers.map((a) => ({ door: a.door, reason: a.reason ?? null })),
    reasonRecorded,
    wantReason,
    // Only meaningful when a reason was recorded: with none, nothing was compared and `missed` would
    // read as "every door said the right thing" on a receipt that recorded nothing at all.
    missed: (wantReason && reasonRecorded)
      ? answers.filter((a) => !String(a.reason ?? "").toLowerCase().includes(String(wantReason).toLowerCase())).map((a) => a.door)
      : [],
    // A scenario that ORDERED an admission and got a refusal is a defect however cleanly it reads.
    orderedAdmission: Boolean(want) && !["clarify", "reject", "refused", "duplicate"].includes(want),
  };
}

// ── the run ledger: what HAPPENED, not whether it was good ───────────────────────────────────────────
//
// The harness runs the thing and records what it did. It does not grade the output. Verdict quality,
// whether a native-script candidate is a sound rendering, whether a crowd was read well — none of that
// is mechanically checkable, and an assertion that pretends otherwise is worse than no assertion,
// because it prints a word like PASS next to a question it never asked.
//
// A retry is the clean example. One observed 2026-07-30: the model wrote a banned tone word, a validator
// rejected the file, the retry was clean. That is a guard WORKING. `no-stage-retried` called the same
// event a pass (it read the wrong file) and, once fixed to read the right one, would have called it a
// failure. Both wrong — a retry is a FACT that needs a reader, not a boolean.
//
// So retries, degradations and durations are reported here, loudly, and the reader decides whether each
// cause was a guard doing its job or a fault worth chasing.
const secs = (n) => (n == null ? "?" : n >= 3600 ? `${Math.floor(n / 3600)}h${String(Math.floor((n % 3600) / 60)).padStart(2, "0")}m`
  : n >= 60 ? `${Math.floor(n / 60)}m${String(Math.round(n % 60)).padStart(2, "0")}s` : `${Math.round(n)}s`);

function runLedger(runDir) {
  const st = readJson(join(runDir, "status.json")) ?? {};
  const dd = driverDir(runDir);
  const attempts = [];
  let files = [];
  try { files = readdirSync(dd).filter((f) => f.endsWith(".jsonl") && f !== "run.jsonl"); } catch { /* no _driver */ }
  for (const f of files) {
    const stage = f.replace(/\.jsonl$/, "");
    for (const line of readFileSync(join(dd, f), "utf8").split("\n")) {
      if (!line.trim()) continue;
      let e; try { e = JSON.parse(line); } catch { continue; }
      // A model-turn record, as distinct from a code-side ledger row that happens to carry a number.
      if (!Number.isFinite(Number(e?.attempt)) || !("engine" in e)) continue;
      attempts.push({ stage, attempt: Number(e.attempt), wall: Number(e.wall) || null, fail: e.fail || null,
        model: e.model ?? null, status: e.status ?? null, code: e.code ?? null, signals: e.signals ?? null,
        // — THE BUDGET THE KILL HAPPENED AGAINST. The driver has always written `timeoutSec` on
        // the per-attempt row; this reader picked its fields by name and dropped it, so the ledger could
        // say a stage was "killed at its 6m01s wall" and had no way to say whether 6m01s was the stage's
        // whole budget or a stage hanging inside a much larger one. Those are opposite findings.
        timeoutSec: Number(e.timeoutSec) || null,
        usage: e.usage ?? null });
    }
  }

  // Wall clock from the run's own record. startedAt survives a resume (A3) and resumedAt/attempts are
  // recorded separately, so a recovered run's true elapsed is readable rather than reset to the resume.
  const t0 = st.startedAt ? Date.parse(st.startedAt) : null;
  const t1 = st.deliveredAt ? Date.parse(st.deliveredAt) : (st.updatedAt ? Date.parse(st.updatedAt) : null);
  const wall = t0 && t1 ? (t1 - t0) / 1000 : null;

  const jx = readJson(join(dd, "jx-lanes.json"));
  const degraded = [];
  for (const [lane, row] of Object.entries(jx?.fold?.lanes ?? {})) {
    // `degraded` is the boolean, `degradedCause` the text. Interpolating the boolean here would
    // print "zh: true" — no exception, no failing test, and the cause gone from the ledger entirely.
    if (row?.degraded) degraded.push(`lane ${lane}: ${row.degradedCause ?? "cause not recorded"} (accepted ${(row.accepted ?? []).length})`);
  }
  // the shadow units degrade separately from the lane and for different reasons (a SERP credential
  // outage is a UNIT failure) — an investigator who only sees lanes never learns the grid died
  const jxUnits = readJson(join(dd, "jx", "units.json"));
  for (const [key, row] of Object.entries(jxUnits?.units ?? {})) {
    if (row?.degraded) degraded.push(`unit ${key}: ${row.degradedCause ?? "cause not recorded"} (attempt ${row.attempts ?? "not recorded"})`);
  }

  return { st, attempts, wall, degraded, stageLogs: files.length };
}

// Everything worth a human's attention, in one list. Each entry is a thing to INVESTIGATE — never a
// judgment about whether it was wrong. A retry might be a guard working; a slow stage might be a
// crowded field. The reader decides.
// Keep BOTH ends when shortening. A driver failure reads `invalid_file:<long run-dir path>:<the actual
// reason>` — the reason is last, so a plain head-truncate throws away the only part worth reading. This
// cost a round: the first ledger printed `…:mark "PROJECT HALCYON` and dropped `banned tone "Massive"`.
function brief(s, max = 150) {
  const t = String(s);
  if (t.length <= max) return t;
  const head = Math.max(30, Math.floor(max * 0.3));
  return `${t.slice(0, head)} … ${t.slice(-(max - head - 3))}`;
}

function investigate({ st, attempts, degraded }) {
  const out = [];
  if (!attempts.length) out.push(`no model-attempt records found — the ledger cannot describe this run; do not read that as clean`);

  for (let i = 0; i < attempts.length; i++) {
    const a = attempts[i];
    if (!(a.attempt > 1)) continue;
    // The previous attempt is the NEAREST PRIOR row, searched BACKWARDS from the retry record's own
    // index. A stage log carries every attempt-1 row the stage ever produced — a warm resume appends a
    // FRESH attempt-1 after the retry, and an earlier round's clean attempt-1 precedes the kill (the
    // real synthesis.jsonl shape: [a1 ok, a1 fail 137/hardWall, a2 ok, a1 ok]). A forward first-match
    // landed on the shadowing ok row, so the ledger printed "cause not recorded" over a recorded kill
    // and the 137/hardWall stall heuristic below never fired at all.
    let prev = null;
    for (let j = i - 1; j >= 0; j--) {
      if (attempts[j].stage === a.stage && attempts[j].attempt === a.attempt - 1) { prev = attempts[j]; break; }
    }
    let why = prev?.fail ? brief(prev.fail) : "cause not recorded on the previous attempt";
    if (prev?.code === 137 || prev?.signals?.hardWall) {
      // — say WHAT IT WAS KILLED AGAINST, because that is what decides the reading. A wall kill at
      // the stage's own budget is "this stage is sized too small"; the same kill inside a budget it never
      // approached is "this stage hung". The budget is stated, never inferred: an attempt row that does
      // not carry one reads as NOT RECORDED, which is a gap in the record and not a stage without a wall.
      const budget = prev.timeoutSec ? `against its ${prev.timeoutSec}s budget + the 60s grace` : "a budget this attempt did not record";
      why = `killed at its ${secs(prev.wall)} wall`;
      if (prev.wall && a.wall && a.wall < prev.wall / 2) why += `, but the retry took only ${secs(a.wall)} — reads as a stall, not as too little time`;
      // TRAILING, not spliced in after the wall: the wall and the stall sub-clause are one sentence that
      // an existing guard asserts as one string, and the budget is a qualifier on the whole reading
      // rather than a word inside that contrast.
      why += ` (${budget})`;
    }
    out.push(`${a.stage} retried (attempt ${a.attempt}) — ${why}`);
  }
  // the row names its own kind ("lane zh: …" / "unit serp-grid:zh: …") — units degrade for different
  // reasons than lanes do, and a hardcoded "lane" here would mislabel every one of them
  for (const d of degraded) out.push(`degraded — ${d}`);
  if (st.state && st.state !== "delivered") out.push(`terminal state is "${st.state}"${st.failedStage ? ` at ${st.failedStage}` : ""}${st.reason ? ` — ${brief(st.reason, 120)}` : ""}`);
  return out;
}

// `bench` is `bandForScenario`'s answer, threaded in rather than recomputed per ref so one scenario
// cannot be measured against two benchmarks in one report.
//
// RETURNS AN OBJECT, NOT AN ARRAY — the shape changed in and there is exactly one call site. NOT
// PROBED had nowhere to go before: this function could only report things to investigate, so a run whose
// wall or whose engine quote could not be READ had to be either flagged as a defect or dropped, and it
// was dropped. A third answer needs a second list.
function printLedger(runDir, bench = null) {
  const facts = runLedger(runDir);
  const { st, attempts, wall, stageLogs } = facts;
  const stages = [...new Set(attempts.map((a) => a.stage))];
  const tk = st.tokens?.total ?? {};
  const tot = (tk.input || 0) + (tk.output || 0) + (tk.cacheRead || 0) + (tk.cacheWrite || 0);

  console.log(`  wall ${secs(wall)}${st.resumedAt ? ` (RESUMED — resumedAt ${st.resumedAt}; startedAt is the FIRST start)` : ""}`
    + ` · ${stages.length} stage(s) / ${attempts.length} attempt(s) across ${stageLogs} log(s)`
    + (tot ? ` · ${(tot / 1e6).toFixed(1)}M tokens (${Math.round(((tk.cacheRead || 0) / tot) * 100)}% cache read)` : ""));

  // Durations, longest first — the metric that tells you where a run actually went.
  const byStage = new Map();
  for (const a of attempts) byStage.set(a.stage, (byStage.get(a.stage) || 0) + (a.wall || 0));
  const slow = [...byStage].filter(([, w]) => w).sort((x, y) => y[1] - x[1]);
  if (slow.length) console.log(`  durations: ${slow.map(([s2, w]) => `${s2} ${secs(w)}`).join(" · ")}`);

  // — the benchmark, this run's wall against it, and which number that judgement used. A no-op
  // `bench` is not silently tolerated: `turnaroundVerdict({})` prints NOT DETERMINED and flags, which is
  // the direction a wiring mistake has to fail in.
  const v = turnaroundVerdict({
    ...(bench ?? {}),
    run: { engine: engineTurnaround(runDir), wallSeconds: wall, terminal: TERMINAL_RUN_STATES.includes(String(st.state ?? "")) },
  });
  for (const l of v.lines) console.log(`  ${l}`);

  return { investigate: [...investigate(facts), ...v.investigate], notProbed: v.notProbed };
}

// ── · the delivered run's own address ────────────────────────────────────────────────────────────
//
// Every run stamps a URL into status.json, meta.json and the handoff packet, and until 2026-08-04 the test
// host had no rule to serve that URL shape — so every report link a test run emitted 404'd while the
// identical shape worked on prod. The suite exists for what only a running deployment can show, and it may
// run ONLY on test, so the delivered artifact's own address was the one thing about delivery that could not
// be checked where delivery is checked. A run reported `delivered`, wrote a dead URL, and nothing noticed:
// an absence reading as success, which is the failure this harness was rebuilt to stop.
//
// WHY LOOPBACK-WITH-A-HOST-HEADER, and not the stamped URL as written. The public host is fronted by a
// Cloudflare tunnel with its own Access app, so an unauthenticated fetch gets the Access login page rather
// than the portal — live-surface-check.mjs states that rule and reports such a route as "not probed", never
// as "passed". Caddy's own listener is bind 127.0.0.1 and sits BEHIND the tunnel, so a request carrying the
// stamped URL's Host header reaches the same routing table with no JWT. That is the request that goes from
// 404 to 401 when the rule is present, and it tests the REWRITE — which a direct call to the portal port
// would skip entirely.
//
// WHAT IT RECORDS, AND WHAT IT REFUSES TO CONCLUDE. A 404 means the route does not exist, and that is the
// finding. Anything else is recorded as the fact it is: 401 is the healthy answer from loopback (the portal
// verifies a CF Access JWT in-handler and we deliberately carry none), and a 2xx/3xx resolves too. Whether
// the report BEHIND the URL is any good stays with the reader, exactly as the artifact check beside it.
// Read at CALL time, not at import: the test instance sets it per invocation, and a module-level const
// would freeze whatever the environment happened to be when this file was first loaded.
const edgeOrigin = () => process.env.CLEAROTRON_EDGE_ORIGIN || "http://127.0.0.1:8081";

export async function probeStampedUrl(stampedUrl) {
  let target, origin;
  try { target = new URL(stampedUrl); origin = new URL(edgeOrigin()); }
  catch { return { error: `unparseable — stamped url ${JSON.stringify(stampedUrl)} or CLEAROTRON_EDGE_ORIGIN ${JSON.stringify(edgeOrigin())}` }; }
  const { request } = await import(origin.protocol === "https:" ? "node:https" : "node:http");
  return new Promise((done) => {
    const req = request({
      host: origin.hostname, port: origin.port || (origin.protocol === "https:" ? 443 : 80),
      method: "HEAD", path: `${target.pathname}${target.search}`,
      headers: { Host: target.host }, timeout: 10_000,
    }, (res) => { res.resume(); done({ status: res.statusCode }); });
    req.on("timeout", () => { req.destroy(); done({ error: "timed out after 10s" }); });
    req.on("error", (e) => done({ error: e.code || e.message }));
    req.end();
  });
}

/**
 * — WAS THE ORDER DELIVERED? One line, and it leads.
 *
 * Owner's rule, 2026-08-25: a refusal after model work is never reported as a pass. The failure this
 * closes is not that the information was missing — `state=failed` was already printed — it is that it
 * was printed BESIDE a verdict, on one line, in a form the eye finishes at the wrong word:
 *
 *     state=failed verdict=CONDITIONAL sendPending=undefined
 *
 * Five R2 rounds in the seven days to 2026-08-25 refused at the verdict stage, each having written a
 * full narrative and every report card first. `CONDITIONAL` there is the verdict of a report NOBODY
 * SIGNED, and it reads as the answer.
 *
 * `deliveredAt` is required, not just `state`. They can disagree — a run can reach the delivery contract
 * and not settle in it — and the timestamp is the one that means the order actually left.
 */
export function deliveryLine(st) {
  if (st?.state === "delivered" && st?.deliveredAt) return `DELIVERED — ${st.deliveredAt}`;
  return `NOT DELIVERED — THE ORDER WAS REFUSED. state=${st?.state ?? "?"}`
    + (st?.failedStage ? ` at ${st.failedStage}` : "")
    + (st?.deliveredAt ? "" : ", never settled into delivery") + ".";
}

async function cmdReport(id, { round: requestedToken = null } = {}) {
  refuseProduction();
  const s = loadScenario(id);
  const refs = scenarioRefs(s);
  let failures = 0, unimplemented = 0;
  // NOT PROBED is a THIRD state, and it exists so a check can decline honestly instead of going quietly
  // green. It never enters `toInvestigate` — a check that could not apply is not a defect — so it has to
  // be counted and printed, or the closing "Nothing FLAGGED" would read as "everything was checked".
  const notProbed = [];
  const toInvestigate = [];

  // ── which ROUND this report is about ─────────────────────────────────────────────────────────
  //
  // Since a scenario's refs now carry a per-round token, a directory can hold several rounds of the same
  // scenario at once — which is the point: a round can be re-run the same day without tearing down the
  // evidence of the one before it. So the report has to say WHICH round it read. It takes the token from
  // the doors receipt `run` wrote, because `report` is a separate, later process and has no other way to
  // know.
  //
  // Unscoped is a REAL answer, not a fallback that pretends: a receipt from before (or one that
  // failed to write) leaves this reading every round's markers under one case, exactly as it did before,
  // and it says so rather than implying the numbers below describe one run. That matters most for R0d,
  // whose dedupe arithmetic is a SET property — two rounds' markers under one ref read as "2 doors
  // ADMITTED the same matter", an engine defect that never happened.
  // ── — EVERY ROUND, NAMED, BEFORE ONE OF THEM IS READ ──────────────────────────────────────────
  //
  // The receipt is a history now, and the workspace is searched for rounds the receipt never recorded
  // (the 2026-08-07 case: R2b's `run` overwrote the single-token receipt R2a had written). Both sources
  // are merged and every round is printed with its token, so the round this report EXCLUDES is nameable
  // instead of merely counted. `--round <token>` then selects it.
  const receiptRead = readReceipt(POOL_ROOT, s.id);
  const disk = roundsFromRuns(refs, WORKSPACE_ROOT);
  const rounds = mergeRounds({ receiptRounds: receiptRead.rounds, diskRounds: disk.byToken });
  const letters = roundLetters(rounds);
  const settlementOf = (r) => roundSettlement(r, refs, { queueDir: QUEUE_DIR, workspaceSearched: disk.searched });

  console.log(`\nROUNDS of ${s.id} — ${rounds.length} known. This report reads exactly ONE of them.`);
  if (receiptRead.state !== "present") console.log(`  receipt: ${receiptRead.why}`);
  else if (receiptRead.migrated) console.log(`  receipt: ${receiptRead.why}`);
  // NOT SEARCHED IS NOT EMPTY, the same distinction this file already makes about run dirs below. An
  // empty list from a directory nobody walked reads as "these are all of them".
  if (!disk.searched) console.log(`  run dirs NOT SEARCHED — ${disk.why}. Rounds that left no receipt entry cannot appear below.`);
  else if (disk.untokened) console.log(`  ${disk.untokened} run dir(s) carry a ref with NO round token — pre-#388 or submitted by hand, so they belong to no nameable round.`);
  if (!QUEUE_DIR || !existsSync(QUEUE_DIR)) console.log(`  queue NOT SEARCHED — ${QUEUE_DIR ? `CLEAROTRON_QUEUE_DIR ${QUEUE_DIR} does not exist` : `CLEAROTRON_QUEUE_DIR is unset`}. No round below can be called settled.`);
  for (const [i, r] of rounds.entries()) {
    const st = settlementOf(r);
    console.log(`  ${s.id}${letters[i]}  token ${r.token ?? "(untokened)"}  ${st.state.padEnd(9)}`
      + `  started ${r.startedAt ?? "unknown"}${r.startedAtSource && r.startedAtSource !== "run" ? ` (${r.startedAtSource})` : ""}`
      + `  doors ${r.doors.join(",") || "(not recorded)"}`
      + `  ${r.reportedState === "settled" ? `reported ${r.reportedAt}` : r.reportedAt ? `read ${r.reportedAt} while ${r.reportedState} — NOT a reported terminal` : "NOT REPORTED"}`);
    if (st.terminals.filter(Boolean).length) console.log(`         terminal(s): ${st.terminals.filter(Boolean).join(", ")}`);
    for (const run of r.runs ?? []) {
      console.log(`         run dir: ${run.runDir}`);
      // — the handover's "commit SHA on test" field, READ rather than reconstructed. An absence
      // is printed as itself: a run that predates the stamp has none, and inventing one from a reflog
      // is the reconstruction this replaces.
      const eb = engineBuildOf(run.runDir);
      if (!eb) console.log(`         engine build: NOT RECORDED — this run predates the run-start stamp (#1423); any attribution for it is a reflog reconstruction`);
      else {
        const dirty = eb.outcome === "clean" ? "" : `  ⚠ ${eb.outcome.toUpperCase()}`;
        console.log(`         engine build: ${eb.head ?? "(none)"}${eb.branch ? ` on ${eb.branch}` : " (detached)"}${dirty}`);
        if (eb.outcome !== "clean") console.log(`                       ${eb.detail}`);
        if (eb.heads.length > 1) console.log(`                       ${eb.segments} segments loaded ${eb.heads.length} different commits — this run was resumed across an engine change: ${eb.heads.map((h) => h.slice(0, 8)).join(" → ")}`);
      }
    }
    if (!r.inReceipt) console.log(`         no receipt entry — a later round overwrote it, so what each DOOR answered for this round is unrecoverable`);
    if (r.clearedAt) console.log(`         teardown cleared this round's evidence at ${r.clearedAt}`);
    console.log(`         read it: node scripts/e2e.mjs report ${s.id} --round ${r.token ?? "<token>"}`);
  }

  const picked = selectRound(rounds, requestedToken);
  if (picked.error) die(`${picked.error}\n  the ROUNDS block above lists them.`);
  const round = picked.round;
  const roundToken = round?.token ?? null;
  console.log(roundToken
    ? `\nround: token ${roundToken} (${s.id}${letters[rounds.indexOf(round)]}) — ${picked.why}. This report reads ONLY what that round submitted. Other rounds' runs and markers are counted, not read.`
    : `\nround: NO TOKEN — ${receiptRead.state === "present" ? "the receipt records a round that carries none" : receiptRead.why}. This report is UNSCOPED and reads every round that ever used these refs as one. Re-run the scenario with the current e2e.mjs to scope it.`);

  // — THE BENCHMARK IS STATED ONCE FOR THE SCENARIO, HERE, BEFORE ANY REF. It is resolved once and
  // threaded into every ledger below, so a report cannot measure one scenario against two numbers. It is
  // printed here as well as beside each run because a scenario can have NO run dir at all — R0's refused
  // cases are the normal case, not the edge one — and the loop below `continue`s past those. A scenario
  // that produced no run still owes the reader a benchmark and a reason.
  const bench = bandForScenario(s);
  const head = turnaroundVerdict(bench);
  for (const l of head.lines) console.log(l);
  toInvestigate.push(...head.investigate);
  notProbed.push(...head.notProbed);

  for (const ref of refs) {
    // Prefix for THIS round; the bare scenario ref when there is no token to scope by.
    const scoped = roundToken ? refForRun(ref, roundToken) : ref;
    const allHits = findRunsByRef(ref);
    const hits = allHits.filter((h) => String(h.status?.ref ?? "").startsWith(scoped));
    const kase = (s.cases ?? []).find((c) => c.job?.ref === ref) ?? null;

    // A REFUSED case has no run dir, and that is the correct outcome — the gate is in claimAndPrep, which
    // runs before one exists. "no run found" used to count as a failure, so every case that behaved
    // perfectly failed. Read the queue marker instead: the suffix IS the terminal state.
    // Queue facts are read ALWAYS, not only when there is no run dir. A multi-door case can have both at
    // once: R0d puts the same matter through every door, so one admits (and gets a run dir) while the rest
    // park as duplicates (queue markers only). Branching on `!hits.length` meant findRunsByRef's PREFIX
    // match found the admitting door and the duplicate park was never reported at all — the very thing the
    // case exists to prove.
    // `allHits` goes in so a marker whose own `.result` names no run dir can still have its `<runId>.…`
    // packets found — the pre-run-throw lane, where runner.mjs's backstop notifies from a run dir the
    // marker never records. Unfiltered by round on purpose: the per-door ref match inside is stricter
    // than the round prefix, and a run from an earlier round carries an earlier round's ref.
    const allQs = queueOutcomes(ref, QUEUE_DIR, allHits);
    const qs = allQs.filter((q) => String(q.ref ?? "").startsWith(scoped));
    // Recorded, never flagged: leftovers from an earlier round are a housekeeping fact for the reader,
    // not a finding about the engine. They are what `teardown <ID>` clears — it stays on the bare ref so
    // it sweeps every round, this one included.
    // "OTHER", not "earlier": under `--round <older token>` the round excluded here is the NEWER one.
    // And it points at naming that round, not at deleting it — the old advice was `teardown <ID>`, which
    // on a pair tells the operator to clear the half they still need.
    const earlier = (allQs.length - qs.length) + (allHits.length - hits.length);
    if (earlier) console.log(`\n${ref}: ${allQs.length - qs.length} queue marker(s) and ${allHits.length - hits.length} run dir(s) belong to OTHER rounds of this ref — not read below. Name one with \`report ${s.id} --round <token>\`; the ROUNDS block above lists them.`);
    const want = kase?.expect?.terminal ?? null;
    if (!hits.length && !qs.length) {
      // NOTHING ON DISK IS NOT NOTHING KNOWN. A door refusal is decided inside `enqueue`, before a queue
      // file exists — so `findRunsByRef` and the marker sweep both come back empty for a case that
      // behaved exactly as ordered. On R0, seven of nine cases are that shape, and this branch reported
      // all seven as "nothing can be said about it": a perfect R0 printed an INVESTIGATE block that was
      // seven-eighths false, which is how a reader learns to skip the block a real finding appears in.
      //
      // The answer is in the doors receipt, which this function already read. It is not a weaker source
      // than the queue — for these cases it is the ONLY source, written by the process that asked.
      // THE ROUND'S OWN door answers, not the scenario's newest. `doorRefusal` already takes anything
      // shaped `{cases:[…]}`, which a round is.
      const refusal = doorRefusal(round, ref, kase?.expect ?? null);
      if (refusal) {
        console.log(`\n${ref} — refused at the door by ${refusal.doors.join(", ")}`);
        // — never silent. One door refusing as ordered while the other was absent is a WEAKER
        // result than both refusing, and the line above cannot show the difference on its own.
        if (refusal.excluded.length)
          console.log(`  ⓘ reduced door coverage: ${refusal.excluded.join(", ")} could not be asked, so this case was proved by ${refusal.doors.length} door(s), not ${refusal.doors.length + refusal.excluded.length}`);
        console.log(`  ordered terminal: ${want ?? "(not stated)"} · observed: refused before any queue file existed, which is why nothing is on disk`);
        if (!refusal.reasonRecorded) {
          notProbed.push(`${ref}: the doors refused, but this receipt records no REASON — re-run with the current e2e.mjs to check expect.reasonMatches`);
          console.log(`  reason: NOT RECORDED by the round that wrote this receipt — not a pass`);
        } else {
          for (const r of refusal.reasons) console.log(`      [${r.door}] ${String(r.reason ?? "(no reason recorded)").slice(0, 160)}`);
          if (refusal.wantReason && refusal.missed.length)
            toInvestigate.push(`${ref}: refused, but ${refusal.missed.join(", ")} did not say "${refusal.wantReason}" — a refusal for the wrong reason reads exactly like the right one`);
          else if (refusal.wantReason) console.log(`  [ ok ] every door's reason carries "${refusal.wantReason}"`);
        }
        if (refusal.orderedAdmission)
          toInvestigate.push(`${ref}: ordered terminal "${want}" but every door REFUSED it at admission`);
        continue;
      }
      // — A ROUND WITH NO RECEIPT ENTRY IS NOT A ROUND THAT LEFT NO TRACE. When a later round
      // overwrote a v1 receipt, this round's door answers are gone: `doorRefusal` returns null and this
      // branch would push "left no trace" for every door-refused case — on R0 that is seven false
      // INVESTIGATE lines, exactly what removed. It is NOT PROBED, and it names the reason.
      if (round && round.inReceipt === false) {
        console.log(`\n${ref}: no run dir AND no queue marker, and this round has NO RECEIPT ENTRY — what the doors answered was never recorded, or a later round overwrote it`);
        notProbed.push(`${ref}: this round's door answers are unrecoverable — the receipt holds no entry for round ${roundToken}, so a refusal at the door (which writes no queue file) left nothing to read`);
        continue;
      }
      console.log(`\n${ref}: no run dir AND no queue marker — the case left no trace at all`);
      toInvestigate.push(`${ref}: left no trace — neither a run nor a queue marker, so nothing can be said about it`);
      continue;
    }
    if (qs.length) {
      // — "no run dir, which is correct for a refusal" is a CONCLUSION, and findRunsByRef can only
      // support it when it was able to look. With CLEAROTRON_WORK_DIR unset it walks nothing and every
      // run in existence comes back as zero hits, which this line then read out as correct behaviour.
      // refuseProduction requires the pool and the queue, not the workspace root, so the unset state is
      // reachable on a real invocation.
      const searched = Boolean(WORKSPACE_ROOT) && existsSync(WORKSPACE_ROOT);
      console.log(`\n${ref} — ${qs.length} door(s) at the queue${
        hits.length ? ` · ${hits.length} run dir(s)`
        : searched ? " · no run dir, which is correct for a refusal"
        : ` · run dirs NOT SEARCHED — ${WORKSPACE_ROOT ? `CLEAROTRON_WORK_DIR ${WORKSPACE_ROOT} is unreadable` : `CLEAROTRON_WORK_DIR is unset`}`}`);
      if (!hits.length && !searched)
        toInvestigate.push(`${ref}: run dirs were not searched (${WORKSPACE_ROOT ? `CLEAROTRON_WORK_DIR ${WORKSPACE_ROOT} unreadable` : `CLEAROTRON_WORK_DIR unset`}) — "no run dir" here is the harness not looking, not the engine not running`);
      console.log(`  ordered terminal: ${want ?? "(not stated)"}`);

      // DEDUPE IS A SET PROPERTY, not a per-door one. R0d submits the SAME matter through every door to
      // prove it runs ONCE, and its own note says the first submission is expected to ADMIT. So one door
      // legitimately comes back `delivered` and the rest `duplicate` — comparing each door against
      // "duplicate" individually flags the admitting door as a defect, which is a false positive in the
      // one report that has to be trustworthy. What actually matters: at least one park, and never more
      // than one admission.
      const setLevelDedupe = want === "duplicate" && qs.length > 1;
      if (setLevelDedupe) {
        const d = dedupeAcrossDoors(qs.map((q) => q.terminal));
        console.log(`  dedupe across ${qs.length} door(s): ${d.admitted} admitted, ${d.parked} parked as duplicate`
          + `${d.inFlight ? `, ${d.inFlight} still in flight` : ""}${d.undetermined ? `, ${d.undetermined} terminal(s) UNDETERMINED` : ""}`);
        // Incomplete arithmetic names no defect: with a door still in flight or a terminal that could not
        // be read, "nobody parked" is a reading of the harness's own blind spot, not of the engine.
        if (d.undetermined || d.inFlight)
          notProbed.push(`${ref}: the dedupe arithmetic is INCOMPLETE — ${d.inFlight} door(s) still in flight, ${d.undetermined} terminal(s) undetermined. Re-read once every door has settled.`);
        if (d.neverFired) toInvestigate.push(`${ref}: the same matter went through ${qs.length} doors and NONE parked as a duplicate — dedupe did not fire`);
        if (d.ranMoreThanOnce) toInvestigate.push(`${ref}: ${d.admitted} doors ADMITTED the same matter — it ran more than once`);
      }

      for (const q of qs) {
        console.log(`  ${q.ref.padEnd(30)} ${q.terminal.padEnd(13)} marker ${q.base}.${q.suffix}`
          + `${q.terminalKind ? ` · terminalKind ${q.terminalKind}` : ""}${q.runId ? ` · run ${q.runId}` : ""}`);
        console.log(`      terminal read from: ${q.terminalWhy}`);
        if (q.reason) console.log(`      reason: ${brief(q.reason.replace(/\n/g, " · "), 200)}`);
        if (q.unrecognisedSuffix)
          toInvestigate.push(`${q.ref}: marker ${q.base}.${q.suffix} carries a suffix the runner's drain does not recognise — a marker renamed to something else is invisible to the runner forever (the .stopped-for-reboot that stranded CORAL FREEZE)`);

        // — an UNDETERMINED terminal neither passes nor fails the ordered one. Comparing it would be
        // a guess dressed as a reading, and the guess is what this issue is about.
        if (q.undetermined) {
          notProbed.push(`${q.ref}: the terminal behind marker ${q.base}.${q.suffix} could not be established — ${q.terminalWhy}`);
        } else if (want && !setLevelDedupe && q.terminal !== want) {
          toInvestigate.push(`${q.ref}: ordered terminal "${want}" but the queue says "${q.terminal}"`);
        }
        // Who owes the requester a notice: every door that settled somewhere other than delivered. Until
        // this was `clarify || duplicate` — the two intake parks — so a run that started and then
        // FAILED was never asked for its packet at all, even though the pipeline writes one
        // (`<runId>.failed.pending`). A door that admitted and delivered owes nothing here, and a door
        // still in flight has not reached the question yet.
        //
        // REPAIR — AN UNDETERMINED TERMINAL IS ASKED THE QUESTION TOO. It was excluded, so a `.failed`
        // marker with neither sidecar had its packet neither looked for nor reported NOT PROBED: the one
        // state where the harness cannot tell what happened was also the one state where it said nothing
        // about the requester. It is asked, and its answer can only be a NOT PROBED line — whether a
        // notice is OWED depends on the terminal, and the terminal is what could not be established.
        const owesNotice = q.terminal === "clarify" || q.terminal === "duplicate" || q.terminal === "failed" || q.undetermined;
        if (owesNotice) {
          // The contract from #92: a refusal must PARK *and NOTIFY*, never fail silently.
          console.log(`      requester notified: ${
            q.packets.length ? q.packets.join(", ")
            : q.packetsUnreadable ? `CANNOT TELL — ${q.packetsUnreadable}`
            : q.undetermined ? "no packet found, and whether one is owed is undetermined"
            : "NO packet — the requester was never told"}`);
          if (q.packets.length) { /* told */ }
          else if (q.packetsUnreadable) notProbed.push(`${q.ref}: whether the requester was told could not be established — ${q.packetsUnreadable}`);
          else if (q.undetermined) notProbed.push(`${q.ref}: no outbox packet was found for marker ${q.base}.${q.suffix}, and whether one is owed is undetermined — ${q.terminalWhy}`);
          else toInvestigate.push(`${q.ref}: settled as "${q.terminal}" but NO outbox packet was written — the requester was never told`);
          // Only against an established terminal: an undetermined one is undetermined precisely because
          // the `.reason` sidecar this reads is absent, so flagging it would name a wrong rule for a rule
          // nobody recorded.
          if (kase?.expect?.reasonMatches && !q.undetermined
              && !(q.reason ?? "").toLowerCase().includes(String(kase.expect.reasonMatches).toLowerCase())) {
            toInvestigate.push(`${q.ref}: the "${q.terminal}" reason does not mention "${kase.expect.reasonMatches}" — it may be firing on the wrong rule`);
          }
        }
      }
    }
    // No run dir is the correct outcome for a case that was refused, so there is nothing further to read.
    if (!hits.length) continue;
    const { runDir } = hits[0];
    const st = readJson(join(runDir, "status.json")) ?? {};
    console.log(`\n${ref} — ${runDir}`);
    // — DELIVERED OR NOT, FIRST, BEFORE THE VERDICT. Owner's rule, 2026-08-25: a refusal after
    // model work is never reported as a pass. A run that refuses at the verdict stage has written its
    // narrative and every report card first, so `verdict=CONDITIONAL` prints on a report nobody signed
    // — and read left to right, `state=failed verdict=CONDITIONAL` invites the eye to the second word.
    // Five R2 rounds did exactly this in the seven days to 2026-08-25. The answer to "was this
    // delivered" is therefore its own line, above, in the words used for a failed order.
    console.log(`  ${deliveryLine(st)}`);
    console.log(`  state=${st.state ?? "?"} verdict=${st.verdict ?? "-"} sendPending=${st.sendPending}`);

    // Which skills changed since this run started — the resume question, stated as fact not as a rule.
    // — THE THREE ANSWERS THIS CHECK CAN GIVE, and it used to give one of them silently.
    //
    // It regexes path+sha pairs out of the witness file and compares each against the live file. Every
    // absence read as "nothing changed": a witness whose rows carry `"sha": null` (methodology-witness.mjs
    // returns null when the file cannot be hashed) matched no pair and printed nothing; a shape drift in
    // the witness matched no pair and printed nothing; and a recorded file that has since been DELETED
    // failed `existsSync`, set `live = null`, and was skipped — which is precisely the case the witness
    // module was written for ("DELETING an overlay file mid-run silently swaps a customer's own framework
    // for the Generic default … That is a rating change nobody asked for and nobody can see").
    //
    // An absent witness file stays a printed NOTE rather than a finding: it is written only when a stage
    // prompt carries `skills/…md` refs, so lanes that carry none legitimately have no witness, and a
    // tripwire that is red every day is one nobody reads.
    const witPath = driverDir(runDir, "methodology-read.json");
    const wit = readJson(witPath);
    if (!wit) {
      console.log(`  prose drift: ${existsSync(witPath) ? "_driver/methodology-read.json is unreadable" : "no _driver/methodology-read.json"}`
        + ` — whether the methodology moved under this run cannot be established (it is written only when a stage prompt carries skills/*.md refs)`);
    } else {
      const read = JSON.stringify(wit);
      const changed = [], gone = [];
      let pairs = 0;
      for (const m of read.matchAll(/"(?:path|file)"\s*:\s*"([^"]+\.md)"[^}]*?"sha(?:256)?"\s*:\s*(?:"([0-9a-f]{6,})"|(null))/g)) {
        const [, p, sha, isNull] = m;
        pairs++;
        if (isNull) { gone.push(`${p} (the run recorded no hash for it)`); continue; }
        if (!existsSync(p)) { gone.push(`${p} (recorded by the run, NOT on disk now)`); continue; }
        const live = execFileSync("sha256sum", [p], { encoding: "utf8" }).slice(0, sha.length);
        if (live !== sha) changed.push(p);
      }
      if (!pairs) {
        console.log(`  ⚠ prose drift NOT CHECKED: _driver/methodology-read.json holds no readable path+sha pair`);
        toInvestigate.push(`${ref}: the methodology witness carries no readable path+sha pair — the harness cannot tell whether the prose moved under this run, and reading that as "nothing changed" is the absence-as-success shape`);
      }
      if (changed.length || gone.length) {
        if (changed.length) console.log(`  ⚠ PROSE CHANGED since this run started: ${changed.join(", ")}`);
        if (gone.length) console.log(`  ⚠ PROSE GONE since this run started: ${gone.join(", ")}`);
        console.log(`    A resume would replay those stages' FROZEN output and prove nothing. Run fresh.`);
      } else if (pairs) {
        console.log(`  prose drift: ${pairs} recorded document(s), all unchanged since this run started`);
      }
    }

    // ── the deliverables the scenario ORDERED ────────────────────────────────────────────────────────
    //
    // `expect.artifacts` was declared by R1, R2 and R3 — six filenames each — and read by nothing:
    // `grep -c artifacts scripts/e2e.mjs` was 0. It looked like coverage on the page and asserted nothing,
    // which is this file's own named failure mode: an absence read as SUCCESS. even renamed an entry
    // in all three (report.client.html → report.html) with no behavioural effect whatsoever, because
    // nothing consumed the key.
    //
    // Checked as existence only. Whether a report is any GOOD is a judgment and stays with the reader;
    // whether the run produced the file it was asked for is a fact, and this is that fact.
    // An ordered artifact lives in ONE OF TWO PLACES and the scenario file does not say which, because
    // from the reader's side the distinction is invisible: some are working files in the run dir
    // (report.md, findings.json, status.json), and some are PUBLISHED-surface files that only ever exist
    // in the pool (report.html, meta.json, audit.xlsx). Searching the run dir alone reported R2's
    // report.html, meta.json and audit.xlsx as "never written" while all three sat in the pool, correct
    // and complete — the run had delivered. R3 passed only because all five of its artifacts happen to
    // be run-dir files, so the defect stayed invisible until a scenario ordered a published one.
    //
    // The pool copy of the workbook is ALSO renamed `<runId>-audit.xlsx`, so a bare-name check misses it
    // even in the right directory. Accept either form there.
    //
    // A check that cries wolf is worse than no check: it teaches the reader to skim past exactly the
    // line that would matter on the day an artifact really is missing.
    const runId = String(st.runId ?? "").trim();
    const poolDir = runId ? join(POOL_ROOT, runId) : "";
    const artifactPresent = (f) => existsSync(join(runDir, f))
      || (poolDir && existsSync(join(poolDir, f)))
      || (poolDir && runId && existsSync(join(poolDir, `${runId}-${f}`)));
    const missing = (s.expect?.artifacts ?? []).filter((f) => !artifactPresent(f));
    if (s.expect?.artifacts?.length) {
      console.log(`  [${missing.length ? "FAIL" : " ok "}] ordered artifacts present`
        + `\n           ${s.expect.artifacts.length} ordered (run dir + pool) · ${missing.length ? `MISSING: ${missing.join(", ")}` : "all present"}`);
      if (missing.length) { failures++; toInvestigate.push(`${ref}: ordered artifact(s) never written — ${missing.join(", ")}`); }
    }

    // — does the run's own stamped URL resolve? See probeStampedUrl above for why this goes through
    // the loopback edge with a Host header rather than fetching the address as written.
    const stamped = String(st.url ?? "").trim();
    if (stamped) {
      const { status, error } = await probeStampedUrl(stamped);
      const dead = status === 404;
      // "not probed" is its own answer and is never reported as a pass — but it IS flagged, because a
      // delivered run whose address could not be checked is a gap in exactly the evidence this exists for.
      const word = error ? "FAIL" : dead ? "FAIL" : " ok ";
      console.log(`  [${word}] the run's stamped URL resolves`
        + `\n           ${stamped}\n           via ${edgeOrigin()} with Host: ${(() => { try { return new URL(stamped).host; } catch { return "?"; } })()} → `
        + (error ? `NOT PROBED (${error})` : `HTTP ${status}${dead ? " — the route does not exist" : status === 401 ? " (portal Access check; the route resolves)" : ""}`));
      if (dead) { failures++; toInvestigate.push(`${ref}: the run's own report URL 404s — ${stamped}`); }
      else if (error) { failures++; toInvestigate.push(`${ref}: could not probe the run's own report URL (${error}) — ${stamped}`); }
    } else if (st.state === "delivered") {
      // A multi-name knockout stamps NO single url BY DESIGN: one address would be the first
      // name standing for the batch, so the packet carries `reports[{mark, url}]` instead. Read it —
      // from the run dir, or from the pool meta once the run dir is archived — and probe every per-mark
      // address exactly as the single-url arm does. Only a delivered run with neither a url nor a
      // reports[] list is the CLEAROTRON_REPORTS_URL absence this arm was written for.
      const batchReports = (() => {
        try { return JSON.parse(readFileSync(driverDir(runDir, "delivery.json"), "utf8")).reports ?? []; } catch { /* archived or pre-batch */ }
        try { return JSON.parse(readFileSync(join(poolDir, "meta.json"), "utf8")).reports ?? []; } catch { /* no pool entry */ }
        return [];
      })();
      const withUrl = batchReports.filter((r) => String(r?.url ?? "").trim());
      if (withUrl.length) {
        for (const r of withUrl) {
          const { status, error } = await probeStampedUrl(r.url);
          const dead = status === 404;
          const word = error || dead ? "FAIL" : " ok ";
          console.log(`  [${word}] the batch report for ${r.mark} resolves\n           ${r.url} → `
            + (error ? `NOT PROBED (${error})` : `HTTP ${status}${dead ? " — the route does not exist" : status === 401 ? " (portal Access check; the route resolves)" : ""}`));
          if (dead) { failures++; toInvestigate.push(`${ref}: ${r.mark}'s report URL 404s — ${r.url}`); }
          else if (error) { failures++; toInvestigate.push(`${ref}: could not probe ${r.mark}'s report URL (${error}) — ${r.url}`); }
        }
      } else if (batchReports.length) {
        console.log(`  [FAIL] the run's stamped URL resolves\n           delivered as a batch of ${batchReports.length}, but no report entry carries a url — CLEAROTRON_REPORTS_URL is unset on this instance`);
        failures++; toInvestigate.push(`${ref}: batch delivered with no per-report URL stamped (CLEAROTRON_REPORTS_URL unset?)`);
      } else {
        // A delivered run with no URL at all is the same absence one step earlier: CLEAROTRON_REPORTS_URL unset
        // makes publishReport stamp null, and the handoff packet then carries no address for anyone to open.
        console.log(`  [FAIL] the run's stamped URL resolves\n           delivered, but status.json carries no url — CLEAROTRON_REPORTS_URL is unset on this instance`);
        failures++; toInvestigate.push(`${ref}: delivered with no report URL stamped (CLEAROTRON_REPORTS_URL unset?)`);
      }
    }

    // Category A only: did the run do what was ORDERED. These are stable because the JOB SPEC is stable
    // — level, territory count, components attached, overlay resolved, delivery settled. Nothing here
    // grades the output.
    //
    // CASE-level asserts are evaluated too. They were declared and never reached: this loop read only
    // `s.expect.assert`, and `kase` was consulted solely for `terminal` and `reasonMatches`. R0 has no
    // scenario-level asserts at all, so R0 ran ZERO assertions — and R0e's `profileKey == "generic"`,
    // the only substantive check in the whole scenario and the entire point of the #83 roster-blindness
    // case, was silently dead. Same class of defect as the artifacts key above: declared, never asked.
    for (const a of [...(s.expect?.assert ?? []), ...(kase?.expect?.assert ?? [])]) {
      const r = evalAssertion(a, runDir);
      if (r.unimplemented) unimplemented++;
      if (r.notProbed) notProbed.push(`${ref}: ${a.what} — ${r.saw}`);
      else if (!r.ok) { failures++; toInvestigate.push(`ordered-vs-ran: ${a.what} — ${r.saw}`); }
      console.log(`  [${r.notProbed ? "n/p " : r.ok ? " ok " : "FAIL"}] ${a.what}\n           ${r.saw}`);
    }

    const led = printLedger(runDir, bench);
    toInvestigate.push(...led.investigate.map((x) => `${ref}: ${x}`));
    notProbed.push(...led.notProbed.map((x) => `${ref}: ${x}`));
  }


  // ── · did this round enter the register HIT path, or only the register CALL? ───────────────────
  //
  // Reported the same way reduced door coverage is, one block up: a round that never ran a mark the
  // register holds proved nothing about screening, close-variation matching, hydration or citation, and
  // it reaches `delivered` looking exactly like a round that did. So the line prints on every report,
  // whatever it says, and a synthetic-only round lands in NOT PROBED rather than passing in silence.
  //
  // NOT `toInvestigate`. There is nothing to investigate about the PRODUCT in a synthetic scenario —
  // a synthetic mark is the right choice for most of this corpus. What it costs is coverage, and coverage
  // is what NOT PROBED is for.
  //
  // The scenario's LABEL and the RUN's own sidecars are read separately and then compared, because each
  // catches what the other cannot: the label is the only thing that can say a round was synthetic BY
  // DESIGN, and the sidecars are the only thing that can say a live mark stopped coming back.
  {
    const mp = markProvenanceOf(s);
    const w = registerCountsWitness((round?.runs ?? []).map((r) => r.runDir));
    const witness = w.sidecars === 0
      ? "no register-counts sidecar was read, so the run itself corroborates nothing either way"
      : `${w.nonZero}/${w.taken} counted cell(s) came back non-zero${w.best ? ` (highest ${w.best})` : ""}`
        + `${w.untaken ? `, and ${w.untaken} cell(s) were NEVER TAKEN — an untaken count is not a zero` : ""}`;
    console.log(`\nmarks: ${mp.state.toUpperCase()} — ${mp.why}`);
    console.log(`  run's own register counts: ${witness}`);

    if (mp.state === MARK_PROVENANCE.SYNTHETIC) {
      notProbed.push(`marks: no mark this scenario searches was chosen for the register to hold, and no floor is `
        + `asserted under any of them, so screening, close-variation matching, record hydration and citation fidelity `
        + `were not proved to have run on anything. A count that came back non-zero here is an incidental collision `
        + `with a real filing, not coverage: nothing holds it there. This round proves the register CALL and not the `
        + `code that reads its answer (#1870).`);
    } else if (mp.state === MARK_PROVENANCE.UNSTATED) {
      notProbed.push(`marks: ${mp.why}. Whether this round entered the register hit path cannot be established from the `
        + `store, and an unstated label is not a synthetic one — add \`markProvenance\` to ${s.id}.json (#1870).`);
    } else if (w.sidecars > 0 && w.taken > 0 && w.nonZero === 0) {
      // The direction the label cannot catch.: nothing on this box distinguishes a register that
      // has emptied out under this mark from a credential that stopped working, so this names both.
      toInvestigate.push(`marks: ${s.id} is declared LIVE and every count it took came back ZERO. Either the register `
        + `no longer holds this mark in the classes searched — in which case the scenario needs a new mark, not a lower `
        + `floor — or the register credential has stopped working and is failing as an empty answer (#1871). This round `
        + `did NOT enter the hit path whatever the label says.`);
    } else if (w.sidecars > 0 && w.taken === 0 && w.cells > 0) {
      toInvestigate.push(`marks: ${s.id} is declared LIVE and not one of its ${w.cells} count cell(s) was TAKEN — every `
        + `one carries a reason instead of a number, so the register lane never answered and the hit path was not entered.`);
    }
  }
  // ── did every door give the same answer? ────────────────────────────────────────────────────────────
  // Only R0 drives more than one door. A rule enforced at one door and waved through by another is the
  // #98 asymmetry, and it is invisible unless the answers are compared — so `run` records them and this
  // reads the receipt. No receipt is reported as "cannot tell", never as agreement.
  if (s.door === "all") {
    // — read THIS ROUND's answers, and distinguish the three ways they can be missing: no receipt
    // at all, a receipt that holds no entry for the round being read, and a round that recorded them.
    const rec = round && round.inReceipt ? round : null;
    if (!rec && round && round.inReceipt === false) {
      console.log(`\ndoors: round ${roundToken} has NO RECEIPT ENTRY at ${receiptPath(POOL_ROOT, s.id)} — a later round overwrote it, so what each door answered for THIS round is unrecoverable`);
      notProbed.push(`doors: round ${roundToken}'s door answers were never recorded or were overwritten — whether the doors agreed cannot be established for this round, and re-running produces a different round, not this one`);
    } else if (!rec) {
      console.log(`\ndoors: NO RECEIPT at ${receiptPath(POOL_ROOT, s.id)} — cannot tell whether the doors agreed`);
      toInvestigate.push(`no doors receipt — run this scenario with the current e2e.mjs to record what each door answered`);
    } else {
      const dis = rec.cases.filter((c) => !c.agreed);
      // — a door lost to the transport is REDUCED COVERAGE, and it is reported as its own line.
      // Older receipts carry no answerClass; `doorAnswerClass` falls back to "answered" for them, which
      // reproduces the previous reading rather than inventing a retrospective one.
      const unavailable = rec.cases
        .map((c) => ({ c, out: (c.answers || []).filter((a) => (a.answerClass ?? doorAnswerClass(a)) === DOOR_ANSWER.INFRA_UNAVAILABLE) }))
        .filter((x) => x.out.length);
      console.log(`\ndoors: ${rec.doors.join(", ") || "(not recorded)"} — ${rec.cases.length} case(s), ${dis.length} disagreement(s), ${unavailable.length} case(s) with reduced door coverage`);
      for (const c of dis) {
        const accepted = c.answers.filter((a) => a.accepted).map((a) => a.door);
        console.log(`  ⚠ ${c.id}: accepted by ${accepted.join(", ") || "(none)"}, refused by ${c.answers.filter((a) => !a.accepted).map((a) => a.door).join(", ") || "(none)"}`);
        toInvestigate.push(`${c.id}: THE DOORS DISAGREE — accepted by ${accepted.join(", ")}; the door that ACCEPTED is the defect`);
      }
      for (const { c, out } of unavailable) {
        const who = out.map((a) => `${a.door} (${doorUnavailableLabel(a)})`).join(", ");
        console.log(`  ⓘ ${c.id}: ${who} never reached the scope question — excluded from the asymmetry comparison`);
        // NOT toInvestigate: there is nothing to investigate about the PRODUCT here. It goes to the
        // round's own limitations, because what it cost is coverage, and a reader deciding what this
        // round proved needs to know a door was missing from it.
        notProbed.push(`${c.id}: ${who} was infrastructure-unavailable, so this case compared fewer doors than the scenario asks for — re-run it before reading its door agreement as evidence`);
      }
    }
  }

  // ── the harness never declares success ──────────────────────────────────────────────────────────────
  // Success is a judgment: was the conclusion right, why did it retry, what did it miss. None of that is
  // here. So there is no PASS. Either something wants investigating, or nothing was FLAGGED — which is
  // not the same as "fine", and says so.
  // NOT PROBED prints BEFORE the verdict line and unconditionally, so "Nothing FLAGGED" is never the
  // last word about a check that declined to look. Each row carries its own reason: the reader is told
  // what was not examined and why, which is the whole difference between this and a silent pass.
  if (notProbed.length) {
    console.log(`\n${"═".repeat(78)}\nNOT PROBED — ${notProbed.length} check(s) declined to look, and NOT PROBED IS NOT A PASS:\n`);
    for (const x of notProbed) console.log(`  ?  ${x}`);
  }
  if (toInvestigate.length) {
    console.log(`\n${"═".repeat(78)}\nINVESTIGATE — ${toInvestigate.length} thing(s):\n`);
    for (const x of toInvestigate) console.log(`  !  ${x}`);
  } else {
    console.log(`\n${"═".repeat(78)}\nNothing FLAGGED${notProbed.length ? ` — of the checks that RAN. ${notProbed.length} did not, listed above` : ""}.`);
  }
  console.log(`\nThis is a record of what ran. It is NOT a pass, and a clean ledger is NOT success.`);
  console.log(`Read the report and the findings: whether the conclusion is right, what it missed, and`);
  console.log(`whether each retry above was a guard working or a fault worth chasing.\n`);

  // — RECORD THAT THIS ROUND WAS READ, and in what state it was read.
  //
  // `reportedState` is the settlement word from the SAME function the launch pre-flight uses, so only a
  // round read AFTER it settled counts as reported. The issue's operator ran `report R2` thirty seconds
  // into R2b: keying on `reportedAt != null` would have marked that round read and permanently silenced
  // the warning for the terminal it reached two hours later.
  //
  // Best-effort and SAID OUT LOUD when it fails — a receipt that cannot be written means the launch
  // warning will keep firing, and the operator has to know which of the two it is looking at.
  //
  // The round's own start time rides along, because a round the receipt never held (discovered on disk
  // after a later round overwrote it) would otherwise be stamped with no start time and sort as the
  // oldest round there is.
  if (roundToken) {
    const stamp = stampRound(POOL_ROOT, s.id, roundToken, {
      startedAt: round.startedAt, startedAtSource: round.startedAtSource,
      reportedAt: new Date().toISOString(), reportedState: settlementOf(round).state });
    if (!stamp.ok) console.log(`\n(could not record that round ${roundToken} was read: ${stamp.why}\n `
      + ` — \`run ${s.id}\` will keep warning that this round is unreported.)`);
    else if (stamp.appended) console.log(`\n(${stamp.why})`);
  }

  // Exit code is for a caller that needs to notice, not a verdict: non-zero means "something here wants
  // a human", zero means "nothing was flagged". Neither says the run was good.
  process.exit(toInvestigate.length ? 1 : 0);
}

// — PRESERVE BEFORE YOU PURGE, AND PROVE THE TARBALL IS NOT EMPTY.
//
// R0 leaves real product in the pool by design: R0d's first submission MUST admit so the second can be
// caught as a duplicate, and R0e's expected terminal is `delivered`. Admitting means publishing, so every
// round adds two reports titled "E2E … PROBE" to what staff read. Each behaviour is correct; the
// combination is not, and it compounds with the nameless-knockout rows.
//
// Teardown is what removes them, and until now teardown DESTROYED THE EVIDENCE ALONG WITH THE ARTIFACT.
// The role file already told a human to tar the run dirs first. That is the wrong place for it: a step
// that only exists in prose is a step that is skipped on the round where it mattered.
//
// THE LISTING IS THE PROOF, not the exit code of tar. An empty or single-entry tarball would satisfy
// "the file exists" and satisfy nobody else, so the entry count is read back off the archive and a
// preservation that produced nothing REFUSES to purge that run. Losing a probe's report is cheap.
// Losing the run dir that says why it behaved as it did is not.
const EVIDENCE_DIR = () => process.env.CLEAROTRON_E2E_EVIDENCE_DIR
  || join(process.env.HOME || "/tmp", "e2e-evidence");

/**
 * Tar `runDir` into the round's evidence directory and return { ok, path, entries, why }.
 * NEVER throws. `entries` is read back from the written archive — the count is evidence, not a guess.
 */
export function preserveRunDir(runDir, id, { evidenceDir = EVIDENCE_DIR(), stamp = null } = {}) {
  try {
    mkdirSync(evidenceDir, { recursive: true });
    const base = basename(runDir);
    const when = stamp || new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "");
    const out = join(evidenceDir, `${id}-${base}-teardown-${when}.tgz`);
    // stdio is pinned: a harness subprocess that inherits stdin can BLOCK waiting on it, and a teardown
    // that hangs is worse than one that fails — it stalls the round with no output to say why.
    const io = { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] };
    execFileSync("tar", ["czf", out, "-C", dirname(runDir), base], io);
    const listing = execFileSync("tar", ["tzf", out], io);
    const entries = listing.split("\n").filter(Boolean).length;
    if (!entries) return { ok: false, path: out, entries: 0, why: "the archive was written and lists ZERO entries" };
    return { ok: true, path: out, entries, why: null };
  } catch (e) {
    return { ok: false, path: null, entries: 0, why: String(e?.stderr || e?.message || e).replace(/\s+/g, " ").slice(0, 200) };
  }
}

/**
 * — CORRECT A SURVIVING RUN'S RECORD TO THE TRUTH: nothing is producing it.
 *
 * A run whose directory survives a refused purge is a run the runner's orphan reclaim can resume from,
 * and one did — ~100 minutes after a teardown that printed "complete", spending tokens on a matter the
 * owner had cancelled and holding a slot against CLEAROTRON_MAX_CONCURRENT_RUNS while the round that
 * replaced it sat unclaimed as `.json`.
 *
 * This is the correction the runbook already prescribes by hand before a purge, done by the tool that
 * knows it is needed. The reason NAMES the teardown, so an operator reading status.json later learns
 * why rather than finding a bare `failed`. Returns a row rather than throwing: a record that cannot be
 * corrected is exactly what the closing report has to say out loud.
 */
export function markTerminal(runDir, runId, why, now = () => new Date().toISOString()) {
  const stPath = join(runDir, "status.json");
  try {
    const st = readJson(stPath);
    if (!st) return { runId, ok: false, why: `no status.json at ${stPath} — cannot make it terminal` };
    if (st.state && st.state !== "running") return { runId, ok: true, why: `already ${st.state}` };
    // TMP + RENAME, like every other writer of a file the runner reads. status.json is the record the
    // orphan reclaim decides claimability from: a crash mid-write leaves a truncated JSON, the reclaim
    // cannot parse it, and the run it was being made unclaimable for is exactly the one left in the
    // worst state this function exists to prevent. Every sibling injector in the driver says the same
    // thing beside the same call.
    const body = JSON.stringify({ ...st, state: "failed",
      failedStage: st.failedStage ?? st.step ?? "unknown",
      reason: `E2E teardown (${why}): the run directory survives, so the record is corrected to the truth — `
        + `nothing is producing this run and the orphan reclaim must not resume it (${now()})` }, null, 2);
    writeFileSync(`${stPath}.tmp`, body);
    renameSync(`${stPath}.tmp`, stPath);
    return { runId, ok: true, why: "corrected to failed" };
  } catch (e) {
    return { runId, ok: false, why: `could not correct ${stPath}: ${String(e?.message ?? e).slice(0, 120)}` };
  }
}

/**
 * — WHICH ROUNDS WOULD A TEARDOWN DESTROY UNREAD, asked while they can still be saved.
 *
 * The asymmetry is the whole reason this exists. An unread terminal whose run dir is still here can be
 * read today; one that has been purged cannot, and whether it even reached terminal is unknowable
 * forever. 38 of 62 rounds reached a terminal nobody read, and of one scenario's four unread rounds all
 * but one had already been purged by the time anyone counted.
 *
 * UNREAD IS `reportedState !== "settled"`, NEVER `reportedAt == null`. A round that was opened and came
 * back `unknown` carries a `reportedAt` stamp and is exactly as unclosed as one nobody ever opened — so
 * keying on the stamp means reading a round stops it being counted whatever the read found. Measured on
 * the live receipts that hid 9 of 30. `roundSettlement` and the launch pre-flight already close on
 * `settled`; this is the same rule, not a second one.
 *
 * IT BLOCKS ON WORK PRESENT, NOT ON A DIRECTORY. `hasAttemptRows` asks for at least one seat jsonl row
 * with `run.jsonl` excluded, because a directory, a `status.json` and even a COUNT of jsonl files all
 * read identically for a run that died at birth and a run that started a second ago — `run.jsonl` is
 * there from the first moment either way. Blocking on anything weaker would refuse teardown of an
 * already-emptied scenario forever, and a command that cannot be run is a command that gets worked
 * around. What cannot be recovered is reported instead: it is context for the operator, not a veto.
 *
 * `searched:false` IS NOT AN EMPTY RESULT. A workspace nobody walked yields no run dirs, and reading
 * that as "nothing is unread" is the same fail-silent shape this whole check exists to close — so it is
 * returned as its own answer and the caller refuses on it.
 *
 * PURE given `hasWork`, which the caller may inject; the filesystem one is the default.
 */
export function unreadTerminalsInTeardown(rounds, { searched, hasWork = hasAttemptRows } = {}) {
  if (!searched) return { searched: false, blocked: [], unrecoverable: [] };
  const blocked = [];
  const unrecoverable = [];
  for (const r of rounds ?? []) {
    if (String(r?.reportedState ?? "") === "settled") continue;
    const runs = r?.runs ?? [];
    // An unsettled round with no run dir at all is a loss that already happened. Named rather than
    // dropped — an absence nobody writes down reads as though it never occurred, which is how these
    // went missing in the first place.
    if (!runs.length) { unrecoverable.push({ token: r?.token ?? null, runDir: null, startedAt: r?.startedAt ?? null }); continue; }
    for (const run of runs) {
      const row = { token: r?.token ?? null, runDir: run.runDir, startedAt: r?.startedAt ?? null };
      if (hasWork(run.runDir)) blocked.push(row); else unrecoverable.push(row);
    }
  }
  return { searched: true, blocked, unrecoverable };
}

function cmdTeardown(id) {
  refuseProduction();
  const s = loadScenario(id);
  const refs = s.job ? [s.job.ref] : (s.cases ?? []).map((c) => c.job.ref);
  // ── — REPORT-OR-WAIVE, IN FRONT OF THE PURGE ───────────────────────────────────────────────────
  //
  // Everything below this point is irreversible. Run dirs are archived and purged, queue markers and
  // outbox packets are deleted, ledger rows are pruned, and every round is finally stamped `clearedAt` —
  // which is the field that retires the launch pre-flight's unreported-terminal warning. Until this gate
  // none of it asked whether a round it was about to destroy had ever been read: the only receipt
  // interaction in this command was that closing stamp, which RECORDS the destruction and never
  // questions it. So a teardown could — and did — turn recoverable misses into permanent ones.
  //
  // The gate runs on the same two sources `report` merges, so what it refuses over is the same round
  // history an operator would be shown. It reaches no further into the filesystem than the loop below
  // already does: it inspects the very run dirs that loop is about to destroy.
  //
  // THE RUN DIR LEVEL IS LOAD-BEARING. `hasAttemptRows` reads `<dir>/_driver` with no fallback, and
  // `_driver` is a child of the DATED RUN DIR, not of the matter dir above it. `findRunsByRef` yields the
  // directory holding `status.json`, which is that same dated dir — verified on the test workspace,
  // where the parents of `_driver` and the parents of `status.json` are the same 16 directories. Handing
  // this the matter dir instead finds no `_driver`, blocks nothing, and looks green while doing it.
  const waived = process.argv.includes("--waive-unread");
  const priorRec = readReceipt(POOL_ROOT, id);
  const disk = roundsFromRuns(refs, WORKSPACE_ROOT);
  const known = mergeRounds({ receiptRounds: priorRec.rounds, diskRounds: disk.byToken });
  const gate = unreadTerminalsInTeardown(known, { searched: disk.searched });
  const waiveLine = `  Waive it deliberately, and it goes on the transcript:\n`
    + `    node scripts/e2e.mjs teardown ${id} --waive-unread`;
  // ONE EXIT CODE FOR EVERY ARM OF THIS GATE. 2 is `die`'s usage default and 4 is `run`'s stale-terminal
  // refusal, so 3 lets a script tell "teardown refused over unread terminals" from "teardown was called
  // wrong" without parsing prose. All three arms are the same refusal: this command cannot establish
  // what it is about to destroy.
  const REFUSED = 3;
  if (!waived && (priorRec.state === "unreadable" || priorRec.state === "torn")) {
    die(`REFUSING to tear down ${id} — the round receipt is ON DISK AND CANNOT BE READ, so what has been`
      + `\nread is unknowable, and this command is about to destroy the evidence that would settle it.`
      + `\n  ${priorRec.why}`
      + `\n\n  Repair or move ${priorRec.path} and re-run, or:\n${waiveLine}`, REFUSED);
  }
  // A scenario that declares NO refs has nothing here to lose, and refusing over it would make teardown
  // impossible for that scenario forever. The fail-silent case is the other one: with a workspace nobody
  // walked, no run dir is found, nothing is blocked, and the teardown goes on to stamp `clearedAt` over
  // every round — retiring the warning about rounds whose evidence is still sitting somewhere this
  // process never looked. `roundsFromRuns` reports both as `searched:false`, so they are split here.
  if (!waived && !gate.searched && refs.length) {
    die(`REFUSING to tear down ${id} — the workspace was NOT SEARCHED, so "no unread terminals" is not a`
      + `\nresult, it is the absence of a look. ${refs.length} ref(s) were never walked.`
      + `\n  ${disk.why}`
      + `\n  CLEAROTRON_WORK_DIR=${WORKSPACE_ROOT || "(unset)"}`
      + `\n\n  Point CLEAROTRON_WORK_DIR at the workspace this scenario ran in and re-run, or:\n${waiveLine}`, REFUSED);
  }
  if (!waived && gate.blocked.length) {
    const lines = gate.blocked.map((b) =>
      `  · round ${b.token ?? "(untokened)"}   started ${b.startedAt ?? "unknown"}`
      + `\n      run dir:  ${b.runDir}`
      + `\n      read it:  node scripts/e2e.mjs report ${id} --round ${b.token ?? "<token>"}`);
    die(`REFUSING to tear down ${id} — ${gate.blocked.length} round(s) this would destroy have work on disk`
      + `\nand are NOT settled. Purge them and what they said is unknowable, permanently.\n\n${lines.join("\n")}`
      + (gate.unrecoverable.length
        ? `\n\n  (${gate.unrecoverable.length} further unsettled round(s) have nothing left to read — not blocked`
          + `\n  on, because nothing this command does can recover them.)`
        : "")
      + `\n\n  READING A ROUND DOES NOT NECESSARILY SETTLE IT. A round still in flight, or one that reads`
      + `\n  back \`unknown\`, stays unsettled and will be refused again — that is the honest outcome for a`
      + `\n  round with nothing in it, and the waive is what it is for.`
      + `\n\n${waiveLine}`, REFUSED);
  }
  if (waived) {
    // A waive nobody can see is the same silence this check exists to break, so every finding it covers
    // is named on the way past — including the two that are about not being able to look at all.
    const covered = [
      ...(priorRec.state === "unreadable" || priorRec.state === "torn"
        ? [`the round receipt could not be read — ${priorRec.why}`] : []),
      ...(!gate.searched && refs.length ? [`the workspace was NOT searched — ${disk.why}`] : []),
      ...gate.blocked.map((b) => `round ${b.token ?? "(untokened)"} — unsettled, work on disk at ${b.runDir}`),
    ];
    if (covered.length) {
      console.log(`\nWAIVED (--waive-unread) — tearing down over ${covered.length} unread finding(s), named here`);
      console.log("because this destroys the only evidence that could have settled them:");
      for (const c of covered) console.log(`  · ${c}`);
      console.log("");
    }
  }
  // NAMED WHETHER OR NOT ANYTHING BLOCKED. These are unsettled rounds with nothing left to read, so they
  // never refuse — but a teardown whose unsettled rounds are ALL unrecoverable would otherwise proceed
  // saying nothing about them at all, which is the absence-nobody-writes-down shape this check exists to
  // break. Reported here rather than only inside the refusal, where an operator who is not being refused
  // would never see it.
  if (gate.unrecoverable.length) {
    console.log(`\nUNSETTLED AND ALREADY BEYOND RECOVERY (${gate.unrecoverable.length}) — not refused over, because`);
    console.log("nothing this command does can bring them back. Whether they reached terminal is unknowable:");
    for (const u of gate.unrecoverable) {
      console.log(`  · round ${u.token ?? "(untokened)"}   started ${u.startedAt ?? "unknown"}`
        + `   ${u.runDir ? `no work in ${u.runDir}` : "no run dir at all"}`);
    }
  }
  // — a teardown that could not clean up is something the NEXT round needs to know about, so every
  // problem is collected and reported at the end rather than scrolling past as one console line among
  // twenty. The exit code follows the same rule the report command uses: non-zero means "a human wants
  // to look", never "the round was bad".
  const problems = [];
  const preserved = [];
  // — one row per run teardown tried to make unclaimable, ok or not. `ok:false` is what the
  // closing report names, because "teardown complete" and "the run cannot start again" are different
  // claims and only the first was ever true.
  const unclaimable = [];

  for (const ref of refs) {
    for (const { runDir } of findRunsByRef(ref)) {
      // PRESERVE FIRST. A run dir that could not be archived is NOT purged — the artifact in the pool is
      // the cheap thing to lose and the run dir is not.
      const pres = preserveRunDir(runDir, id);
      if (!pres.ok) {
        problems.push(`${ref}: could NOT preserve ${runDir} — ${pres.why}. NOT purged; the published report is still in the pool.`);
        console.log(`  ${ref}: preservation FAILED (${pres.why}) — refusing to purge this run`);
        continue;
      }
      preserved.push(`${basename(pres.path)}  (${pres.entries} entries)`);
      console.log(`  preserved ${basename(runDir)} → ${pres.path} (${pres.entries} entries)`);
      const stPath = join(runDir, "status.json");
      const st = readJson(stPath);
      // THE TWO-STEP, NOW WITH THE STEP THAT WAS MISSING. purge-runs.mjs refuses any run whose status says
      // `running`. This wrote `failed` over that very field, logging "nothing producing it" and writing the
      // same sentence into the reason — AND NOTHING CHECKED IT. Not a pid, not a claim. On CORAL FREEZE the
      // state genuinely was a lie; the repair for that one run was generalised into an unconditional
      // rewrite, so a teardown during a live round disarmed the only guard standing between that run and
      // the delete tool.
      //
      // The claim is now READ before the record is rewritten, using the runner's own fail-safe rule.
      // `alive` and `unreadable` both stop the rewrite; they are reported apart because "we protected a
      // live run" and "we could not look" are different facts and only one of them is reassuring.
      if (st && st.state === "running") {
        const { state: claim, why } = claimLivenessForCodename(basename(runDir));
        if (claimForbidsDestruction(claim)) {
          problems.push(`${ref}: NOT torn down — ${runDir} says "running" and the claim says ${claim}: ${why}. Preserved, record left alone, purge not attempted.`);
          console.log(`  ${ref}: claim is ${claim} (${why}) — refusing to rewrite "running" or purge this run`);
          continue;
        }
        console.log(`  ${ref}: status says "running"; claim is ${claim} (${why}) — correcting the record before purge`);
        writeFileSync(stPath, JSON.stringify({ ...st, state: "failed",
          failedStage: st.failedStage ?? st.step ?? "unknown",
          reason: `E2E teardown: claim liveness reports ${claim} — ${why}; record corrected so purge-runs.mjs can act on the truth (${new Date().toISOString()})` }, null, 2));
      }
      const runId = readJson(join(runDir, "status.json"))?.runId;
      if (!runId) { console.log(`  ${ref}: no runId in meta.json — skipping purge, inspect ${runDir}`); continue; }
      // --expect is the caller stating what they believe, and purge-runs refuses on a mismatch. A run
      // lives in up to THREE places (pool, workspace archive, live), so a hardcoded --expect=1 refuses
      // every run that reached publish — which is every run that WORKED. Dry-run first, read the count
      // it reports, then state that. The guard keeps its meaning; the number stops being a guess.
      //
      // — AND THE ROOT IS READ OFF THE SAME DRY RUN, for the same reason the count is. `--apply`
      // has required `--expect-root=` since and this call never passed one, so every purge here
      // exited 2 — on every run that reached publish, which is every run that WORKED. The teardown then
      // reported "purge REFUSED" honestly and the pool was never cleaned.
      //
      // NOT `CLEAROTRON_REPORTS_DIR` FROM THIS PROCESS. That would satisfy the flag and defeat the guard: its
      // whole point is that a dry run on one estate cannot authorise an apply on another, and a root
      // this process asserts about itself proves nothing about the run that was reviewed. purge-runs
      // prints the root it RESOLVED, in the line that tells a human what to re-run; parsing that is the
      // machine doing exactly what the operator is told to do.
      let expect = 0;
      let expectRoot = null;
      try {
        const dry = execFileSync("node", [join(REPO, "scripts", "purge-runs.mjs"), `--only=${runId}`],
          { encoding: "utf8", env: process.env });
        expect = Number((dry.match(/--\s*(\d+)\s*DELETE\s*\/\s*\d+\s*KEEP\s*--/) ?? [])[1] ?? 0);
        expectRoot = (dry.match(/--expect-root=(\S+)/) ?? [])[1] ?? null;
      } catch (e) {
        const why = (e.stdout ?? e.message).toString().replace(/\s+/g, " ").slice(0, 200);
        problems.push(`${runId}: purge dry-run failed — ${why}. The published report is still in the pool.`);
        console.log(`  purge dry-run failed: ${why}`); continue;
      }
      if (!expect) { console.log(`  ${runId}: purge-runs sees nothing to delete`); continue; }
      // An absence is a finding, not a fallback: a dry run that printed no root is a dry run whose
      // shape we do not recognise, and inventing one here is how the guard becomes decoration.
      if (!expectRoot) {
        problems.push(`${runId}: purge dry-run printed no --expect-root — not applying. The published report is still in the pool.`);
        console.log(`  ${runId}: the dry run named no pool root — refusing to apply`); continue;
      }
      try {
        console.log(execFileSync("node", [join(REPO, "scripts", "purge-runs.mjs"), `--only=${runId}`, "--apply", `--expect=${expect}`, `--expect-root=${expectRoot}`],
          { encoding: "utf8", env: process.env }).trim().split("\n").filter((l) => /Removed|Pruned/.test(l)).map((l) => `  ${l}`).join("\n"));
      } catch (e) {
        const why = (e.stdout ?? e.message).toString().replace(/\s+/g, " ").slice(0, 300);
        problems.push(`${runId}: purge REFUSED — ${why}. The published report is still in the pool.`);
        console.log(`  purge REFUSED: ${why}`);
        // — a refused purge must still leave the run UNCLAIMABLE. See markTerminal above.
        const t = markTerminal(runDir, runId, "purge refused");
        unclaimable.push(t);
        console.log(`  ${runId}: ${t.ok ? `record ${t.why} — the orphan reclaim cannot resume it` : `STILL CLAIMABLE — ${t.why}`}`);
      }
    }
    // Queue markers and outbox packets are named by the QUEUE ID, not the ref — so matching the ref
    // against the filename finds nothing and both accumulate silently. Resolve queue id → ref by
    // reading each marker (the job JSON survives every rename: .json → .processing → .failed/.done),
    // then clear that id's markers AND its outbox packets.
    //
    // Every suffix is swept, not just the three drainQueue recognises: a marker renamed to something
    // else is invisible to the runner forever (the .stopped-for-reboot that stranded CORAL FREEZE), so a
    // teardown that only knew the three would leave exactly the files that cause that failure.
    const ids = new Set();
    if (existsSync(QUEUE_DIR)) {
      for (const f of readdirSync(QUEUE_DIR)) {
        const job = readJson(join(QUEUE_DIR, f));
        if (job && String(job.ref ?? "").startsWith(ref)) ids.add(f.replace(/\.[^.]+$/, "").replace(/\.(failed|done|processing|postponed|duplicate)$/, ""));
      }
      for (const f of readdirSync(QUEUE_DIR)) {
        const base = f.split(".")[0];
        if (!ids.has(base)) continue;
        rmSync(join(QUEUE_DIR, f), { force: true });
        console.log(`  removed queue marker ${f}`);
      }
    }
    const outbox = process.env.CLEAROTRON_OUTBOX_DIR;
    if (outbox && existsSync(outbox)) {
      for (const f of readdirSync(outbox)) {
        const hitsId = [...ids].some((i) => f.includes(i));
        const hitsRef = f.toLowerCase().includes(ref.toLowerCase().replace(/-/g, ""));
        if (!hitsId && !hitsRef) continue;
        rmSync(join(outbox, f), { force: true });
        console.log(`  removed outbox packet ${f}`);
      }
    }

    // The matter-ledger dedupe row. Left behind, re-running the same mark tomorrow is treated as a
    // DUPLICATE and silently parked — the exact side effect that had to be hand-pruned after CORAL
    // FREEZE before the mark could be re-sent. It lives BESIDE THE QUEUE, and it is the runner's own
    // function that says where that is: this line used to derive it from POOL_ROOT, which is the same
    // directory only while the pool and the queue share a parent. QUEUE_DIR is guaranteed set —
    // this script exits above if it is not.
    const ledger = matterLedgerPath(QUEUE_DIR);
    if (existsSync(ledger)) {
      const rows = readFileSync(ledger, "utf8").split("\n").filter(Boolean);
      // The row carries NO `ref` field — it is {sig, conversationId, msgId, id, ts, profileKey}. The ref
      // survives only inside `sig`, lowercased ("e2e|e2e duplicate probe|9||e2e-r0d-cli|level:knockout").
      // Matching on `ref` therefore never fired, and the dedupe row silently outlived the run it
      // described — so re-running the same mark would have parked as a duplicate.
      const needle = ref.toLowerCase();
      const kept = rows.filter((l) => {
        try { const r = JSON.parse(l); return !String(r.sig ?? "").toLowerCase().includes(needle) && !ids.has(String(r.id ?? "")); }
        catch { return true; }
      });
      if (kept.length !== rows.length) {
        writeFileSync(ledger, kept.length ? `${kept.join("\n")}\n` : "");
        console.log(`  pruned ${rows.length - kept.length} matter-ledger row(s) — the mark can be re-run without being read as a duplicate`);
      }
    }
  }
  // — TEARDOWN REMOVES THE EVIDENCE, SO IT MUST CLEAR THE ROUNDS TOO. Teardown is scenario-wide:
  // it sweeps every round's run dirs, queue markers and ledger rows. A round left unstamped would drive
  // the launch pre-flight's "unreported terminal" warning forever, about a round whose state is now
  // permanently unknowable — and a warning that is always on is one nobody reads on the day it is real.
  //
  // STAMPED, NOT PRUNED. The door answers are the part that exists nowhere else (a door refusal happens
  // inside `enqueue`, before any queue file is written), and teardown deletes run dirs, not the record of
  // what each door said. A pruned round could not be named by an operator who still remembers it.
  {
    const cleared = new Date().toISOString();
    const rec = readReceipt(POOL_ROOT, id);
    const stampable = rec.rounds.filter((r) => !r.clearedAt);
    for (const r of stampable) {
      const st = stampRound(POOL_ROOT, id, r.token, { clearedAt: cleared });
      if (!st.ok) problems.push(`could not mark round ${r.token ?? "(untokened)"} as torn down — ${st.why}. \`run ${id}\` will keep warning about it.`);
    }
    if (stampable.length) console.log(`\n  marked ${stampable.length} round(s) as torn down in ${rec.path} — their door answers stay, their evidence is gone`);
    else if (rec.state !== "present") console.log(`\n  no round history to mark: ${rec.why}`);
  }

  // — the two things the next round needs, said at the end where they will be read.
  if (preserved.length) {
    console.log(`\nPRESERVED (${preserved.length}) — the evidence survives; only the published artifact went:`);
    for (const p of preserved) console.log(`  ${p}`);
  } else {
    console.log("\nPRESERVED: none — no run directory was found for this scenario's refs.");
  }
  if (problems.length) {
    console.log(`\nTEARDOWN PROBLEMS (${problems.length}) — NOT swallowed. A probe that could not be cleaned up is`);
    console.log("something the next round needs to know about, and each of these leaves product-shaped");
    console.log("material in the pool a person reads:");
    for (const p of problems) console.log(`  · ${p}`);
  }
  // — never print "complete" while something it touched is still claimable, and name what is, by
  // runId. An unqualified "complete" is what let the re-claim be a surprise rather than a known cost.
  const stillClaimable = unclaimable.filter((u) => !u.ok);
  if (stillClaimable.length) {
    console.log(`\nSTILL CLAIMABLE (${stillClaimable.length}) — teardown could NOT make these unclaimable, and the`);
    console.log("runner's orphan reclaim can resume them on its next tick. Correct them before re-arming the timer:");
    for (const u of stillClaimable) console.log(`  · ${u.runId}: ${u.why}`);
    console.log("\nteardown finished WITH RUNS STILL CLAIMABLE. Re-check with:  node scripts/e2e.mjs status\n");
  } else {
    console.log("\nteardown complete — every run it touched is terminal and unclaimable."
      + "\nRe-check with:  node scripts/e2e.mjs status\n");
  }
  // Same convention as `report`: non-zero means "a human wants to look", never a verdict on the round.
  process.exit(problems.length ? 1 : 0);
}

// ── exported for test ────────────────────────────────────────────────────────────────────────────────
// This file shipped with no tests and no exports, so the assertion engine — the part that decides
// whether a paid run passed — was the one piece nobody could check. An assertion op that quietly
// mis-reads an artifact is exactly as bad as a stage that quietly mis-reads one, and it is worse in one
// way: it reports PASS while doing it. `no-wildcard-exact-pair` and `delivery-settled` both encode real
// findings, so both need pinning. Pure functions only; the commands stay CLI-shaped.
//
// The ops are pinned the same way, and one of them needs more than a fixture: `no-wildcard-exact-pair`
// reports NOT PROBED on the knockout lane because that lane provably writes no register plan. "Provably"
// is a claim about source, so the test reads the source — if a future knockout stage starts freezing a
// plan, the not-probed branch becomes a lie and that test is what says so.
//
// adds four: `outboxPackets` (the one matcher both packet schemes go through), `readMarkerTerminal`
// (which of the two meanings of a marker suffix the RUN recorded), `undrainableJob` (whether a queue file
// is a job nothing will drain, asked of the file), and `TERMINAL_BY_SUFFIX_RAN` beside the intake table it
// disagrees with. All are pure-ish reads against a directory, so a test drives them with a temp dir rather
// than a deployment.
//
// adds the turnaround block — `bandForScenario` (which band, derived from the doors, never from the
// scenario file), `engineTurnaround` (the engine's own recorded quote, read backwards off the run
// journal) and `turnaroundVerdict` (what the report says, and which of the two numbers it judged
// against). The third is pure by construction and that is what keeps this issue provable from a fixture:
// asserting that a 171-minute run reads as 51 minutes over a 120-minute band would otherwise cost a
// three-hour clearance run to check.
//
// adds two more, and both are judgments that need the QUEUE vocabulary — which is why they stayed
// here rather than moving to driver/e2e-rounds.mjs with the receipt: `roundSettlement` (has this round
// finished, and is that KNOWN) and `previousRoundNotice` (what the launch must say about the round
// before this one). They are the one place settledness is decided, so the launch warning and `report`'s
// stamp can never disagree about whether a round is done.
// adds `SCENARIO_FILE` — the ONE filename pattern, exported so the test that pins the widening
// reads the same regex `list` and the sweep read, rather than a copy that agrees today.
export { evalAssertion, OPS, queueDrainState, DOORS, runLedger, investigate, brief, secs, queueOutcomes,
  TERMINAL_BY_SUFFIX, TERMINAL_BY_SUFFIX_RAN, SCENARIO_FILE };

// ── main ─────────────────────────────────────────────────────────────────────────────────────────────
// Guarded so `import`ing this module for a test does not execute a command. Without it, the test file's
// own import would fall through to the default case and call die() → process.exit(2).
const invokedDirectly = isEntrypoint(import.meta.url);
if (invokedDirectly) {
  // — THE FLAG'S VALUE IS NOT A POSITIONAL. This was `slice(2).filter((a) => !a.startsWith("--"))`,
  // which leaves `--round`'s value as a third positional that the `[cmd, arg]` destructure silently
  // drops: `report R2 --round <token>` would have reported the NEWEST round with nothing saying so —
  // this issue wearing a flag. So `--round` is parsed out of the raw argv FIRST, and a leftover
  // positional is an error rather than a discard.
  //
  // Other flags are NOT rejected: `reportCommit` reads `--stale` straight off process.argv, and a
  // die-on-unknown-flag here would break every paid run against a deliberately older commit.
  const raw = process.argv.slice(2);
  const positional = [];
  let requestedRound = null;
  for (let i = 0; i < raw.length; i++) {
    const a = raw[i];
    if (a === "--round") {
      requestedRound = raw[++i] ?? null;
      if (!requestedRound || requestedRound.startsWith("--")) die("--round needs a round TOKEN: e2e.mjs report <ID> --round <token>\n  The token is on `run`'s output and in the ROUNDS block of any report.");
    } else if (a.startsWith("--round=")) {
      requestedRound = a.slice("--round=".length);
      if (!requestedRound) die("--round= needs a round TOKEN: e2e.mjs report <ID> --round=<token>");
    } else if (!a.startsWith("--")) positional.push(a);
  }
  const [cmd, arg, ...extra] = positional;
  if (extra.length) die(`unexpected argument "${extra[0]}"\n`
    + "usage: e2e.mjs list | run <ID> [--stale] | status | report <ID> [--round <token>] | teardown <ID> [--waive-unread]");
  switch (cmd) {
    case "list": cmdList(); break;
    case "run": if (!arg) die("usage: e2e.mjs run <ID> [--stale]"); await cmdRun(arg); break;
    case "status": cmdStatus(); break;
    case "report": if (!arg) die("usage: e2e.mjs report <ID> [--round <token>]"); await cmdReport(arg, { round: requestedRound }); break;
    case "teardown": if (!arg) die("usage: e2e.mjs teardown <ID> [--waive-unread]"); cmdTeardown(arg); break;
    default: die("usage: e2e.mjs list | run <ID> [--stale] | status | report <ID> [--round <token>] | teardown <ID> [--waive-unread]");
  }
}
