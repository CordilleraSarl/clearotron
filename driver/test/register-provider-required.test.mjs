// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// register-provider-required.test.mjs — an unset register provider REFUSES, at every door.
//
// ── WHY THIS FILE SPAWNS CHILDREN ────────────────────────────────────────────────────────────────
// The test harness declares CLEAROTRON_DATABASE for the whole run (scripts/test-run.mjs, and the
// reasoning is written there), so nothing inside this process can observe the unset state. That is the
// right call for 4000 tests that need A provider and do not care which — but it means the one property
// this issue is about becomes invisible in-process. So each case below runs a child with the variable
// explicitly cleared. Without that, this file would assert the harness's setting and prove nothing.
//
// ── WHAT WENT WRONG, AND WHY FOUR DOORS ─────────────────────────────────────────────────────────
// `REGISTER_PROVIDER` was `(process.env.CLEAROTRON_DATABASE || "corsearch")`. The comment above it
// claimed "an unknown id throws LOUDLY (never a silent default)" — true of an unknown id, false of an
// unset one, and only the second can happen by accident. The correct value was held entirely by a
// systemd drop-in in neither box's ~/.env and not in git; a rebuilt unit or a fresh box resolved to a
// vendor the deployment did not choose, and the credential guard would not have stopped it because
// both boxes still carry CORSEARCH_SESSION_KEY.
//
// The default was in FOUR places, not one, and three of them would have survived fixing the first:
//   driver.config.mjs        the headline
//   gather-config.mjs        a second `|| "corsearch"` behind it, on the gather path
//   registry-fidelity.mjs    a DUPLICATED read, deliberately not importing driver.config to stay
//                            dependency-free — so it kept defaulting, stamping a vendor name onto
//                            every fetch receipt as the provenance of where a fact came from
//   stages.mjs               not a default but a FABRICATION: an unrecognised id synthesised a doc
//                            path `providers/<id>.md` and the spawn was told to read it
//
// Each case below covers one. A fix that misses any of them leaves the failure intact somewhere.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { nonEmpty } from "../../shared/vacuous-pass.mjs";

const run = promisify(execFile);
const REPO = join(dirname(dirname(fileURLToPath(import.meta.url))), "..");

// — THE REFUSAL NAMES THE NAME AN OPERATOR SETS, and this file asserts on that name rather than
// on a literal. Its subject is "an unset provider refuses at every door", never which spelling the
// message uses; pinning the legacy one here is what made a correct fix to the message look like three
// broken doors. Derived through `currentName` so the next rename carries these three arms with it.
const REFUSES_NAMING_CURRENT = new RegExp(`CLEAROTRON_DATABASE is not set`);

// ── TAIL — "CLEARED" AND "PINNED" MEAN EVERY SPELLING, OR THEY MEAN NOTHING ──────────────────
//
// The message was already derived; the ENVIRONMENT-BUILDING below was not, and it is the half that
// decides whether these doors are asked the question at all. Since the capture in driver.config.mjs
// reads both spellings, deleting `CLEAROTRON_DATABASE` alone leaves `CLEAROTRON_DATABASE` in place
// — the harness sets both — and every one of these arms then runs against a provider that IS set.
// Measured before this change: seven arms in this file failed, and they failed by NOT REFUSING, which
// is the direction that would otherwise have read as the doors breaking.
//
// Same for the pinned direction one function down: setting the legacy name while the current one still
// holds the harness default means the CURRENT one wins, and the arm silently tests the harness's
// provider instead of the one it named.
const PROVIDER_NAMES = ["CLEAROTRON_DATABASE"];

/** `env` with every spelling of the provider variable removed, or all of them set to `value`. */
const withProviderNames = (env, value) => {
  for (const n of PROVIDER_NAMES) { if (value === undefined) delete env[n]; else env[n] = value; }
  return env;
};

/** Run a snippet in a child with the provider variable explicitly cleared, under every spelling. */
async function withoutProvider(script) {
  const env = withProviderNames({ ...process.env }, undefined);
  try {
    const { stdout } = await run(process.execPath, ["-e", script], { cwd: REPO, env });
    return { ok: true, out: stdout.trim() };
  } catch (e) {
    return { ok: false, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

test("the module still IMPORTS with no provider set — the refusal is at use, not at load", async () => {
  // Deliberate. driver.config.mjs is imported by the whole test suite and by tools that never run a
  // clearance; throwing at module load would make a config read impossible without a vendor decision,
  // which is a different kind of wrong.
  const r = await withoutProvider(
    'import("./driver/driver.config.mjs").then(m => console.log(JSON.stringify({'
    + ' provider: m.REGISTER_PROVIDER, known: m.KNOWN_REGISTER_PROVIDERS })))');
  assert.ok(r.ok, `importing must not throw: ${r.out}`);
  const got = JSON.parse(r.out);
  assert.equal(got.provider, null, "unset resolves to null — NOT to a vendor name");
  assert.ok(got.known.includes("corsearch"), "and the known list is exported for the error message");
});

test("DOOR 1 — activeProvider() refuses, naming the variable and what to set it to", async () => {
  const r = await withoutProvider(
    'import("./driver/driver.config.mjs").then(m => { m.activeProvider(); console.log("NO THROW"); })'
    + '.catch(e => console.log(e.message))');
  assert.ok(!r.out.includes("NO THROW"), "an unset provider must never resolve to an adapter");
  assert.match(r.out, REFUSES_NAMING_CURRENT);
  assert.match(r.out, /NO default/);
  // ADR-0001's ladder, as a LITERAL and in order. It read `/corsearch, clarivate, signa/` — three names
  // in the arrangement the list happened to have, which made an ordering assertion out of a line whose
  // stated job is only that the message names the options. item 11 reordered the list and this
  // went red, which is the right outcome: the refusal is one of the places ADR-0001 means by "everywhere
  // the choice is presented", so a reorder here should have to be argued rather than absorbed.
  //
  // Written against the literal rather than KNOWN_REGISTER_PROVIDERS.join(", "): the message is BUILT
  // from that constant, so asserting it against the same constant would move with any reorder and stay
  // green — a test that cannot fail on the thing it names.
  assert.match(r.out, /signa, free-tier, euipo, uspto-local, corsearch, clarivate/,
    "the message tells the reader what to set, recommended first (ADR-0001)");
  assert.match(r.out, /did not choose/, "and why it refuses rather than picking one");
});

test("DOOR 2 — preflightCredentials() refuses before any model spend", async () => {
  // The run-start gate. It must fail on the missing PROVIDER, not sail through to a credential check
  // for a vendor nobody chose.
  const r = await withoutProvider(
    'import("./driver/driver.config.mjs").then(m => { m.preflightCredentials({}); console.log("NO THROW"); })'
    + '.catch(e => console.log(e.message))');
  assert.ok(!r.out.includes("NO THROW"));
  assert.match(r.out, REFUSES_NAMING_CURRENT);
});

test("DOOR 3 — the gather MCP config refuses rather than mounting a vendor's server", async () => {
  // The second `|| "corsearch"`. Fixing driver.config alone would have left every register-unit stage
  // mounting the Corsearch server and calling it.
  const r = await withoutProvider(
    'import("./driver/engine/mcp/gather-config.mjs").then(m => { m.buildGatherMcpConfig(["register"], {}); '
    + 'console.log("NO THROW"); }).catch(e => console.log(e.message))');
  assert.ok(!r.out.includes("NO THROW"), "no vendor server may be mounted for a provider nobody chose");
  assert.match(r.out, REFUSES_NAMING_CURRENT);
});

test("DOOR 4 — a fetch receipt records NO provider rather than a guessed one", async () => {
  // registry-fidelity's duplicated read. A receipt is the artifact the report render and the delivery
  // lint consult for where a fact came from; a wrong provenance label there is worse than none, because
  // it reads as an attribution.
  const r = await withoutProvider(
    'const p = (process.env.CLEAROTRON_DATABASE || "").trim().toLowerCase() || null;'
    + 'console.log(JSON.stringify({ p }));');
  assert.ok(r.ok);
  assert.equal(JSON.parse(r.out).p, null);

  // and the source really does read it that way — no `|| "corsearch"` survives in the file
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(join(REPO, "driver", "registry-fidelity.mjs"), "utf8");
  assert.ok(!/CLEAROTRON_DATABASE\s*\|\|\s*"corsearch"/.test(src),
    "registry-fidelity must not carry its own copy of the default");
});

// — THE VACUITY CHECK SITS ON THE WALK'S RESULT, and the walk is hoisted so the empty
// direction can be driven. Guarding each recursive read turned one empty leaf directory into a throw
// before a single module was read; `driver/profiles/` is a runtime write target, so a deployed box
// grows one and no clone ever does — git stores no empty directory, so CI is blind to it.
const driverModules = (dir, out = []) => {
  for (const e of readdirSync(dir)) {
    if (e === "node_modules" || e === ".git" || e === "test") continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) { driverModules(p, out); continue; }
    if (/\.(mjs|js)$/.test(e)) out.push(p);
  }
  return out;
};
/** Every driver module the sweep reads. `roots` is a parameter so the empty walk is DRIVEN, not argued. */
const driverSources = (roots = [join(REPO, "driver")]) =>
  nonEmpty(roots.flatMap((d) => driverModules(d)), "the walked driver modules");

test("no `|| \"corsearch\"` fallback survives anywhere in the driver", () => {
  // The blunt sweep, because this defect's whole character was being in more places than anyone looked.
  const offenders = [];
  for (const p of driverSources()) {
    readFileSync(p, "utf8").split("\n").forEach((line, i) => {
      if (/REGISTER_PROVIDER[^\n]*\|\|\s*["'](corsearch|clarivate|signa)["']/.test(line))
        // — carry the matched line, not only its number.
        offenders.push(`${p.slice(REPO.length + 1)}:${i + 1}  ${line.trim().slice(0, 110)}`);
    });
  }
  assert.deepEqual(offenders, [],
    "a register provider must never be defaulted — the value decides which vendor gets billed");
});

test("tracker 2018 the driver-module walk refuses an empty corpus, and an empty leaf is not one", () => {
  // BOTH DIRECTIONS. A guard moved onto the aggregate and a guard deleted read identically on a healthy
  // tree; only a walk handed an empty tree tells them apart.
  const tmp = mkdtempSync(join(tmpdir(), "b2018-register-provider-"));
  const leaf = join(REPO, "driver", "profiles", "projects", `b2018-${process.pid}`);
  try {
    mkdirSync(join(tmp, "a", "b"), { recursive: true });
    assert.throws(() => driverSources([tmp]), /VACUOUS/,
      "a walk that descended a whole tree and found no module reported a corpus instead of refusing");
    assert.throws(() => driverSources([]), /VACUOUS/, "no roots at all is not a corpus");

    const baseline = driverSources().length;
    mkdirSync(leaf, { recursive: true });
    assert.equal(driverSources().length, baseline,
      "an empty directory under driver/ changed the set of modules this sweep reads");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
    rmSync(leaf, { recursive: true, force: true });
  }
});

test("an UNKNOWN provider still throws, and differently from an unset one", async () => {
  // Both refuse; they are not the same fault and the messages must not merge. "You set it to something
  // I do not recognise" and "you set nothing" send the reader to different places.
  const env = withProviderNames({ ...process.env }, "markify");
  let out = "";
  try {
    await run(process.execPath, ["-e",
      'import("./driver/driver.config.mjs").then(m => { m.activeProvider(); console.log("NO THROW"); })'
      + '.catch(e => console.log(e.message))'], { cwd: REPO, env });
  } catch (e) { out = `${e.stdout ?? ""}${e.stderr ?? ""}`; }
  const r = await run(process.execPath, ["-e",
    'import("./driver/driver.config.mjs").then(m => { m.activeProvider(); console.log("NO THROW"); })'
    + '.catch(e => console.log(e.message))'], { cwd: REPO, env });
  const text = r.stdout.trim() || out;
  assert.match(text, /unknown REGISTER_PROVIDER "markify"/);
  assert.ok(!/is not set/.test(text), "an unknown id is a different message from an unset one");
});

// ──: a provider with MORE THAN ONE required credential ──────────────────────────────────────
//
// These SPAWN CHILDREN for the same reason as everything above, and it is worth stating because the
// first cut of this test did not and passed for the wrong reason: `REGISTER_PROVIDER` is captured at
// MODULE LOAD, so setting process.env.CLEAROTRON_DATABASE after importing driver.config.mjs
// changes nothing. The in-process version asserted against whatever provider the harness had already
// fixed, and the throw it saw was that provider's missing key, not euipo's.

/** Run a snippet in a child with CLEAROTRON_DATABASE pinned and the credential env controlled. */
async function withProvider(provider, credEnv, script) {
  const env = withProviderNames({ ...process.env }, provider);
  // Clear every register credential first, so the child's answer is about what `credEnv` supplies and
  // never about what happens to sit in the ambient environment of the box running the suite.
  // USPTO_LOCAL_DB joins the clear-list: it was already missing, so on a box that happened to
  // export it every case ran with one extra credential present — the exact "ambient environment" leak
  // this loop exists to stop. The free tier needs all three, so the omission would have hidden its
  // preflight refusal entirely.
  for (const k of ["CORSEARCH_SESSION_KEY", "CLARIVATE_API_KEY", "SIGNA_API_KEY",
    "EUIPO_CLIENT_ID", "EUIPO_CLIENT_SECRET", "USPTO_LOCAL_DB"]) delete env[k];
  Object.assign(env, credEnv);
  try {
    const { stdout } = await run(process.execPath, ["-e", script], { cwd: REPO, env });
    return { ok: true, out: stdout.trim() };
  } catch (e) {
    return { ok: false, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

const PREFLIGHT = 'import("./driver/driver.config.mjs").then(m=>{'
  + 'try{const r=m.preflightCredentials(process.env);console.log("OK "+JSON.stringify(r.checked))}'
  + 'catch(e){console.log("THREW "+e.message)}})';

test("preflightCredentials checks EVERY required variable, not just credEnv (#546)", async () => {
  // Three providers authenticate with a single key, so `credEnv` alone WAS the whole check — and it
  // silently became a HALF check the moment euipo arrived with an OAuth id AND secret. An instance
  // holding EUIPO_CLIENT_ID and no secret would pass preflight, spawn the register stage, and die on
  // the first token request: after model spend, and reported as a provider fault rather than the
  // missing credential it is.
  const idOnly = await withProvider("euipo", { EUIPO_CLIENT_ID: "an-id" }, PREFLIGHT);
  assert.match(idOnly.out, /THREW .*EUIPO_CLIENT_SECRET/, `a missing secret must abort preflight BY NAME: ${idOnly.out}`);

  const secretOnly = await withProvider("euipo", { EUIPO_CLIENT_SECRET: "a-secret" }, PREFLIGHT);
  assert.match(secretOnly.out, /THREW .*EUIPO_CLIENT_ID/, secretOnly.out);

  // Neither — BOTH named in one message, so one fix round settles it instead of two.
  const neither = await withProvider("euipo", {}, PREFLIGHT);
  assert.match(neither.out, /THREW .*EUIPO_CLIENT_ID \+ EUIPO_CLIENT_SECRET/, neither.out);

  // Both present ⇒ passes, and REPORTS what it actually checked, so a reader of the preflight line
  // can tell a two-credential check from a one-credential one.
  const both = await withProvider("euipo", { EUIPO_CLIENT_ID: "an-id", EUIPO_CLIENT_SECRET: "a-secret" }, PREFLIGHT);
  assert.equal(both.out, 'OK ["EUIPO_CLIENT_ID","EUIPO_CLIENT_SECRET"]', both.out);
});

test("the single-key providers are UNCHANGED by credEnvAlso (#546)", async () => {
  for (const [provider, key] of [["corsearch", "CORSEARCH_SESSION_KEY"],
    ["clarivate", "CLARIVATE_API_KEY"], ["signa", "SIGNA_API_KEY"]]) {
    const r = await withProvider(provider, { [key]: "x" }, PREFLIGHT);
    assert.equal(r.out, `OK ["${key}"]`, `${provider}: ${r.out}`);
    const missing = await withProvider(provider, {}, PREFLIGHT);
    assert.match(missing.out, new RegExp(`THREW .*${key}`), missing.out);
  }
});

// FOLDED SIGNA BACK INTO THE LOOP ABOVE. Between and it was split out, because it
// did not reach the end of preflight: the door also refuses a provider with no plan executor, and
// signa had none. It has one now, so it is an ordinary single-key provider again and the split-out
// test has been removed rather than left asserting a state that no longer exists.
