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
// These arms are driven against the REAL register and engine tables, never fixtures. A fixture would let
// the authority and the product's own tables drift apart in the one direction that passes: the arm
// asking for less than the product needs.
//
// BREAK MATRIX:
//   · the F41 environment REFUSES at start          → break: soften the blocking set, arm 1 red
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
import { runRequirements, runRequiredNames, missingRequirements, REGISTER_ENV, RESEARCH_ENV } from "../run-requirements.mjs";
import { PROVIDERS as REGISTER_TABLE } from "../../bin/onboard.mjs";
import { ENGINE_BINARIES, DEFAULT_ENGINE_ID } from "../driver.config.mjs";
import { nonEmpty } from "../../shared/vacuous-pass.mjs";

const ROOT = join(dirname(dirname(fileURLToPath(import.meta.url))), "..");
// THE PRODUCT'S OWN TABLES. Not a copy — see the header.
const T = { registers: REGISTER_TABLE, engines: ENGINE_BINARIES, defaultEngine: DEFAULT_ENGINE_ID };

/** `~/.env` exactly as F41 measured it: paths and door secrets, nothing that runs a clearance. */
// PATHS ARE SYNTHETIC, and 's guard is why: no executable line may name a specific account's home
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

test("the environment F41 found refuses the start, naming what a clearance cannot do without", () => {
  const miss = missingRequirements(AS_FOUND, T);
  nonEmpty(miss.blocking, "nothing blocked on the environment that failed a client's search");
  const names = miss.blocking.map((r) => r.name);
  assert.ok(names.includes(REGISTER_ENV), "the register is what threw at the client's first stage and it is not blocking");
  assert.ok(names.includes("CLEAROTRON_AI"), "the engine is not blocking");
  assert.ok(names.includes("CLEAROTRON_CLAUDE_PATH"), "the engine's binary is not blocking");
  // EVERY BLOCKING ROW CARRIES ITS CONSEQUENCE. A refusal listing bare names sends an operator to a
  // search engine; the whole point of refusing at start is that the reader can act on it here.
  for (const r of miss.blocking) assert.ok(r.why.trim().length > 30, `${r.name} refuses without saying what it costs`);
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
