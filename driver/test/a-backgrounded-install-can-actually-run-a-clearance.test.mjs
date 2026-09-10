// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// ── F41 — THE CLIENT ORDERED A SEARCH AND GOT NOTHING ────────────────────
//
// A lawyer ordered a Knockout search over MCP on a fully configured install that had delivered a real
// report an hour earlier. It failed at its first stage — `CLEAROTRON_DATABASE is not set, and there is
// NO default` — and what reached the client was "stopped before it finished, and nothing was delivered.
// Clearotron has been notified and will follow up." Nobody was notified; the box has no outbox.
//
// The only variable was HOW THE PRODUCT WAS STARTED. Foreground children inherit the supervisor's
// environment. `--background` installs units that read `%h/.env` with `CLEAROTRON_NO_ENV_FILE=1`, which
// severs inheritance on purpose — so only what the supervisor WRITES arrives. It wrote the paths and the
// door secrets and not the register, its credential, the research key, the engine or the engine path.
//
// ── WHERE THE REFUSAL LIVES NOW — ruling 2026-09-06 ──────────────────────────────────────────
//
// "someone can install and select key later so it should still start." So the register, its credential,
// the engine and the engine's binary NO LONGER refuse a `--background` start. They refuse AT ORDER TIME,
// at `driver/runner.mjs`'s intake wall, before a stage dispatches and before anything is spent.
//
// THE F41 OUTCOME IS STILL FORECLOSED, which is the only thing these arms ever protected. A run on an
// unconfigured box is refused before it starts and the requester is told so honestly — never a first-
// stage crash, and never "Clearotron has been notified" on a box that notified nobody. What changed is
// WHEN the product says no, not WHETHER it says no, and arm 1 below asserts the new answer rather than
// being deleted for having the old one.
//
// These arms are driven against the REAL register and engine tables, never fixtures. A fixture would let
// the authority and the product's own tables drift apart in the one direction that passes: the arm
// asking for less than the product needs.
//
// BREAK MATRIX:
//   · the F41 environment REFUSES at ORDER time      → break: soften the blocking set, arm 1 red
//   · only what START WRITES may refuse a start     → break: mark the register at:"start", arm 1b red
//   · composing from the supervisor fixes it        → break: drop the carry loop, arm 2 red
//   · the credential set is DERIVED per register    → break: hardcode SIGNA_API_KEY, arm 3 red
//   · a narrowing value never refuses a start       → break: mark research blocking, arm 4 red
//   · composer and guard read ONE list              → break: give either its own, arm 5 red
//   · start.mjs wires both halves                   → break: remove either call, arm 6 red
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runRequirements, runRequiredNames, missingRequirements, orderTimeRefusal,
  REGISTER_ENV, RESEARCH_ENV, POOL_ENV, START, ORDER } from "../run-requirements.mjs";
// from the module that OWNS the table now, not through the wizard's re-export. The
// arm should break if the data moves again, and reading it through `bin/` would hide that.
import { PROVIDERS as REGISTER_TABLE } from "../../shared/register-selection.mjs";
import { ENGINE_BINARIES, DEFAULT_ENGINE_ID } from "../driver.config.mjs";
import { nonEmpty } from "../../shared/vacuous-pass.mjs";

const ROOT = join(dirname(dirname(fileURLToPath(import.meta.url))), "..");
// THE PRODUCT'S OWN TABLES. Not a copy — see the header.
const T = { registers: REGISTER_TABLE, engines: ENGINE_BINARIES, defaultEngine: DEFAULT_ENGINE_ID };

/** `~/.env` exactly as F41 measured it: paths and door secrets, nothing that runs a clearance. */
// PATHS ARE SYNTHETIC, and the guard is why: no executable line may name a specific account's home
// directory. The finding measured real ones under a real service account; reproducing those literals
// here would put that account's home in the shipped tree to say something the shape already says. What
// matters to these arms is which NAMES travelled, never where they pointed.
const HOME = "/srv/example/trademark";
const AS_FOUND = {
  CLEAROTRON_REPORTS_DIR: `${HOME}/pool`,
  CLEAROTRON_WORK_DIR: `${HOME}/workspace`,
  CLEAROTRON_QUEUE_DIR: `${HOME}/queue`,
  TRADEMARK_MCP_TOKEN_SECRET: "s", PORTAL_SECRET: "s",
};
/** The same box's supervisor environment — it held everything, which is why foreground worked. */
const SUPERVISOR = {
  ...AS_FOUND,
  CLEAROTRON_DATABASE: "signa", SIGNA_API_KEY: "k",
  CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: "/usr/local/bin/claude",
  CLEAROTRON_AI_BILLING: "subscription", PERPLEXITY_API_KEY: "p",
};

/** What `bin/start.mjs` does to build the unit environment, in the same order. */
const compose = (unitEnv, supervisor) => {
  const out = { ...unitEnv };
  for (const name of runRequiredNames(supervisor, T)) {
    const v = String(supervisor[name] ?? "").trim();
    if (v && out[name] === undefined) out[name] = v;
  }
  return out;
};

test("the environment F41 found refuses AT ORDER TIME, naming what a clearance cannot do without", () => {
  const miss = missingRequirements(AS_FOUND, T);
  nonEmpty(miss.blocking, "nothing blocked on the environment that failed a client's search");
  // THE SAME NAMES, AT THE OTHER GATE. `atOrder` is what the runner's intake wall refuses over; the set
  // is unchanged, only when it is asked for. An empty `atOrder` here would mean F41 can happen again.
  nonEmpty(miss.atOrder, "nothing refuses at order time — a run on this box would reach its first stage");
  const names = miss.atOrder.map((r) => r.name);
  assert.ok(names.includes(REGISTER_ENV), "the register is what threw at the client's first stage and it is not blocking");
  assert.ok(names.includes("CLEAROTRON_AI"), "the engine is not blocking");
  assert.ok(names.includes("CLEAROTRON_CLAUDE_PATH"), "the engine's binary is not blocking");
  // EVERY BLOCKING ROW CARRIES ITS CONSEQUENCE. A refusal listing bare names sends an operator to a
  // search engine; the whole point of refusing early is that the reader can act on it where they are.
  for (const r of miss.blocking) assert.ok(r.why.trim().length > 30, `${r.name} refuses without saying what it costs`);
  // AND THE START IS NOT REFUSED OVER ANY OF THEM. This is the half of the order-time refusal that a
  // soften-the-set fix would get wrong in the safe-looking direction: leaving one of these at:"start"
  // still bricks the install the owner said must come up.
  for (const n of [REGISTER_ENV, "CLEAROTRON_AI", "CLEAROTRON_CLAUDE_PATH"])
    assert.ok(!miss.atStart.some((r) => r.name === n),
      `${n} still refuses a --background start — the owner ruled an install comes up without it`);
});

test("only what START ITSELF WRITES may refuse a start, and the pool is the whole of that", () => {
  // The split is a decision, so it is pinned rather than left to whoever edits the table next. A value
  // start writes is one whose absence is OUR bug and gives the reader nothing to go and set; a value an
  // operator supplies is one the install can legitimately come up without.
  const bare = missingRequirements({}, T);
  assert.deepEqual(bare.atStart.map((r) => r.name), [POOL_ENV],
    "something other than the pool refuses a start — a value an operator supplies must never brick the install");
  nonEmpty(bare.atOrder, "nothing refuses at order time on a bare environment");
  // NO ROW MAY BE BOTH, AND NONE MAY BE NEITHER. A blocking row with no `at` would be refused by nobody.
  for (const r of runRequirements({}, T).filter((r) => r.blocking))
    assert.ok(r.at === START || r.at === ORDER, `${r.name} blocks but names no gate to block at`);
  assert.equal(bare.atStart.length + bare.atOrder.length, bare.blocking.length,
    "a blocking row is missing from both halves — it can stop nothing");
});

test("the order-time refusal speaks two vocabularies, and only one of them may reach a browser", () => {
  const r = orderTimeRefusal(AS_FOUND, T, { envFile: "/srv/example/.env" });
  assert.ok(r, "an unconfigured box produced no refusal at all");
  // THE OPERATOR'S: names, reasons, and the file to edit — they can act on all three.
  for (const n of r.names) assert.match(r.operator, new RegExp(n), `${n} is missing from the operator refusal`);
  assert.match(r.operator, /\/srv\/example\/\.env/, "the operator refusal names no file to edit");
  // THE CLIENT'S: no variable name of any shape. `driver/test/portal-service.test.mjs` refuses exactly
  // this on a body a browser renders, and a client cannot act on an environment variable anyway.
  assert.doesNotMatch(r.client, /CLEAROTRON_|PORTAL_/, `a switch name reached the client: ${r.client}`);
  assert.doesNotMatch(r.client, /[A-Z][A-Z0-9]*_[A-Z0-9_]+/, `a variable-shaped name reached the client: ${r.client}`);
  // AND NEITHER PROMISES ANYTHING. F41's whole damage was the sentence after the failure, not the
  // failure: "Clearotron has been notified and will follow up", on a box with no outbox.
  for (const [who, text] of [["operator", r.operator], ["client", r.client]]) {
    assert.doesNotMatch(text, /has been notified|will follow up/i, `the ${who} refusal promises a notice nobody sent`);
    assert.match(text, /[Nn]othing has been (searched|spent)/, `the ${who} refusal does not say nothing was spent`);
  }
  // A CONFIGURED BOX GETS NULL, not an empty-ish object a caller could read as a refusal.
  assert.equal(orderTimeRefusal(SUPERVISOR, T), null, "a fully configured box was refused at order time");
});

test("composing from the supervisor's own configuration is what makes that box work", () => {
  const composed = compose(AS_FOUND, SUPERVISOR);
  const miss = missingRequirements(composed, T);
  assert.deepEqual(miss.blocking.map((r) => r.name), [], "the composed unit environment still cannot run a clearance");
  assert.deepEqual(miss.narrowing.map((r) => r.name), [], "the composed unit environment still narrows the product");
  // AND IT ACTUALLY CARRIED THINGS. Without this the arm passes on a composer that copies nothing,
  // because AS_FOUND would have had to be complete already — which is the defect, inverted.
  const carried = Object.keys(composed).filter((k) => !(k in AS_FOUND));
  nonEmpty(carried, "the composer added nothing — this arm would pass over a no-op");
  for (const n of [REGISTER_ENV, "SIGNA_API_KEY", "CLEAROTRON_AI", "CLEAROTRON_CLAUDE_PATH", RESEARCH_ENV])
    assert.ok(carried.includes(n), `${n} did not travel into the unit environment`);
});

test("the credential set is DERIVED from the chosen register, never a list in this code", () => {
  const signa = runRequiredNames({ ...SUPERVISOR, [REGISTER_ENV]: "signa" }, T);
  const free = runRequiredNames({ ...SUPERVISOR, [REGISTER_ENV]: "free-tier" }, T);
  assert.ok(signa.includes("SIGNA_API_KEY"), "signa's credential is not required under signa");
  assert.ok(!free.includes("SIGNA_API_KEY"), "signa's credential is required under free-tier — the set is hardcoded");
  // free-tier's own row, read from the product's table rather than restated here.
  const spec = REGISTER_TABLE.find((p) => p.id === "free-tier");
  nonEmpty(spec?.credentials ?? [], "the register table has no credentials for free-tier — the arm would prove nothing");
  for (const k of spec.credentials) assert.ok(free.includes(k), `${k} is required by free-tier and does not travel`);
});

test("a value that NARROWS the product never refuses a start — a Knockout box still starts", () => {
  const knockoutOnly = compose(AS_FOUND, SUPERVISOR);
  delete knockoutOnly[RESEARCH_ENV];
  const miss = missingRequirements(knockoutOnly, T);
  // THE PRODUCT DECISION, PINNED. Without the research key the three clearance searches refuse at
  // preflight — honestly, before anything is spent — and a Knockout search runs and discloses the half
  // it skipped. Refusing to start would take a box that can serve a real product and make it serve none.
  assert.deepEqual(miss.blocking.map((r) => r.name), [], "a narrowing value blocked the start");
  assert.ok(miss.narrowing.some((r) => r.name === RESEARCH_ENV), "the operator is not told the research key is missing");
  const row = runRequirements(knockoutOnly, T).find((r) => r.name === RESEARCH_ENV);
  assert.equal(row.blocking, false);
  assert.match(row.why, /Knockout/, "the reason must say which product still works, or it reads as a dead install");
});

test("the composer and the guard read ONE list, so the guard cannot pass on what the composer forgot", () => {
  // The join, asserted as an identity rather than by inspection: everything the guard can block on must
  // be something the composer was told to carry. A guard with names the composer never saw is a refusal
  // nobody can satisfy; a composer with names the guard never checks is F41 again.
  const required = new Set(runRequiredNames(SUPERVISOR, T));
  for (const r of runRequirements(SUPERVISOR, T))
    assert.ok(required.has(r.name), `${r.name} is checked but not carried`);
  const blockable = missingRequirements(AS_FOUND, T).blocking.map((r) => r.name);
  const carriable = new Set(runRequiredNames(SUPERVISOR, T));
  for (const n of blockable) assert.ok(carriable.has(n), `${n} can block a start and is never composed — an unsatisfiable refusal`);
});

test("start.mjs wires both halves — composition and guard — at the --background seam", () => {
  const src = readFileSync(join(ROOT, "bin", "start.mjs"), "utf8");
  assert.match(src, /runRequiredNames\(process\.env, RUN_TABLES\)/,
    "--background no longer composes the unit environment from the run requirements");
  assert.match(src, /missingRequirements\(willRead, RUN_TABLES\)/,
    "--background no longer guards the environment it just composed");
  // and it guards on the START half alone. `miss.blocking` here would refuse over a
  // register the owner ruled an install may come up without.
  assert.match(src, /if \(miss\.atStart\.length\)/,
    "--background refuses over more than what start itself writes");
  assert.match(src, /miss\.atOrder\.length/,
    "--background no longer TELLS the operator what is unconfigured — a silent unconfigured install "
    + "is the failure one step along from the one 216 fixed");
  // THE GUARD IS CHECKED AGAINST WHAT THE UNITS WILL READ, not against this shell. Checking process.env
  // would pass on exactly the box that fails, because the supervisor always has what the units lack.
  assert.match(src, /const willRead = \{ \.\.\.already, \.\.\.union \}/,
    "the guard reads something other than the composed unit environment");
});

test("start.mjs never STATICALLY imports the wizard — that cycle takes `doctor` down", () => {
  // MEASURED, not theoretical. bin/onboard.mjs already reaches back into bin/start.mjs for
  // BACKGROUND_UNITS, so a static import in this direction closes the loop — and the failure is not a
  // warning: onboard's top-level `await runCli()` never settles and `clearotron doctor` exits 13 after
  // printing most of a report. I wrote that static import while building F41 and the suite caught it.
  //
  // A dynamic import inside a function closes no load-time loop, which is why the register table is
  // fetched at call time. This arm is what stops the next reader "tidying" it back up to the top.
  const src = readFileSync(join(ROOT, "bin", "start.mjs"), "utf8");
  const statics = [...src.matchAll(/^\s*import\s[^;]*from\s+["']([^"']+)["']/gm)].map((m) => m[1]);
  assert.ok(!statics.some((sp) => /onboard\.mjs$/.test(sp)),
    "bin/start.mjs statically imports bin/onboard.mjs — that is the cycle that makes `clearotron doctor` exit 13");
  assert.match(src, /await import\("\.\/onboard\.mjs"\)/,
    "the register table is no longer fetched at call time, so the requirements authority has no registers to derive credentials from");
});
