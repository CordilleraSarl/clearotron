// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// preflightEngineBinary — the run-start check that the engine binary exists and can be executed.
//
// preflightCredentials' sibling, at the same door and with the same discipline: a run whose work is
// impossible refuses BEFORE it costs anything and before it leaves a run directory behind. What it adds
// over "the stage will fail anyway" is WHERE the failure lands. A stage-time ENOENT arrives after the
// run dir, the frozen profile and the status sidecar exist, and it reads as a model fault; here it is a
// configuration refusal naming the variable.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { fileURLToPath } from "node:url";

import { preflightEngineBinary, ENGINE_BINARIES, DEFAULT_ENGINE_ID, engineAdapterSpecifier } from "../driver.config.mjs";
import { registeredEngines, DEFAULT_ENGINE } from "../gateway.mjs";
import { nonEmpty } from "../../shared/vacuous-pass.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const RUNNER = join(HERE, "..", "runner.mjs");
const CLAUDE = join(HERE, "mock-claude.mjs");
chmodSync(CLAUDE, 0o755);

/** A PATH holding exactly one executable, so a bare-name lookup is decidable rather than ambient. */
function pathWith(name) {
  const dir = mkdtempSync(join(tmpdir(), "engine-bin-"));
  const p = join(dir, name);
  writeFileSync(p, "#!/bin/sh\nexit 0\n");
  chmodSync(p, 0o755);
  return { dir, p };
}

test("a bare name is resolved off PATH, exactly as spawn would", () => {
  const { dir, p } = pathWith("claude");
  const r = preflightEngineBinary({ PATH: dir });
  assert.equal(r.engine, "anthropic-agent", "unset CLEAROTRON_AI is the production default");
  assert.equal(r.binEnv, "CLEAROTRON_CLAUDE_PATH");
  assert.equal(r.resolved, p, "and it reports WHICH file it found");
});

test("a bare name that is not on PATH refuses, and prints the PATH it searched", () => {
  const empty = mkdtempSync(join(tmpdir(), "engine-empty-"));
  assert.throws(() => preflightEngineBinary({ PATH: empty }), (e) => {
    assert.match(e.message, new RegExp(`CLEAROTRON_CLAUDE_PATH.*unset — defaulting to "claude"`, "s"),
      "an unset variable must say it is unset, not name a value the reader never wrote — and it must say "
      + "so under the CURRENT spelling, which is the one a reader would go and set (#1850)");
    assert.match(e.message, /not on PATH/);
    assert.ok(e.message.includes(empty), "naming the PATH turns 'not found' into something actionable");
    return true;
  });
});

test("THE TRAP: a relative CLEAROTRON_CLAUDE_PATH refuses, and says why it cannot work", () => {
  // the developer env example shipped exactly this value, so this was the DOCUMENTED setting. It looks correct
  // and cannot work: since the engine child's cwd is the RUN DIRECTORY, so Node resolves the
  // relative command inside the run and the ENOENT names a path nobody typed.
  assert.throws(() => preflightEngineBinary({ CLEAROTRON_CLAUDE_PATH: "driver/test/mock-claude.mjs", PATH: "/usr/bin" }), (e) => {
    assert.match(e.message, /RELATIVE path/);
    assert.match(e.message, /run directory as its cwd|RUN DIRECTORY as its cwd/i);
    assert.ok(e.message.includes(join(REPO, "driver/test/mock-claude.mjs")),
      "the refusal spells out the absolute form, so the fix is a paste rather than a deduction");
    return true;
  });
  // and the absolute form of the very same file is accepted
  assert.equal(preflightEngineBinary({ CLEAROTRON_CLAUDE_PATH: CLAUDE, PATH: "" }).resolved, CLAUDE);
});

test("an absolute path is checked for what spawn actually needs: a regular file with the execute bit", () => {
  const dir = mkdtempSync(join(tmpdir(), "engine-abs-"));
  const missing = join(dir, "nope");
  const notExec = join(dir, "plain"); writeFileSync(notExec, "#!/bin/sh\n"); chmodSync(notExec, 0o644);
  const isDir = join(dir, "adir"); mkdirSync(isDir);

  for (const [bin, what] of [[missing, "missing"], [notExec, "present but not executable"], [isDir, "a directory"]]) {
    assert.throws(() => preflightEngineBinary({ CLEAROTRON_CLAUDE_PATH: bin, PATH: "" }),
      /not an executable file/, `${what} must refuse`);
  }
  // A directory passes existsSync and passes X_OK — both, which is why neither alone is the check.
  assert.ok(existsSync(isDir), "the directory really is there — existsSync alone would have passed it");
});

test("the openai-agent engine is checked through ITS OWN variable", () => {
  const { dir, p } = pathWith("codex");
  const r = preflightEngineBinary({ CLEAROTRON_AI: "openai-agent", PATH: dir });
  assert.equal(r.binEnv, "CLEAROTRON_CODEX_PATH");
  assert.equal(r.resolved, p);
  assert.throws(() => preflightEngineBinary({ CLEAROTRON_AI: "openai-agent", CLEAROTRON_CODEX_PATH: "/nope/codex", PATH: dir }),
    new RegExp("CLEAROTRON_CODEX_PATH"),
    "and it names the variable the reader has to fix, not the anthropic one — under the CURRENT spelling, "
    + "even where the value arrived through the retired one (#1850)");
});

test("an unknown CLEAROTRON_AI is NOT this function's refusal to make", () => {
  // gateway.selectEngine already refuses an unregistered adapter, by name, with the available list. A
  // second differently-worded version of that error is how two definitions of "not an engine" drift.
  const r = preflightEngineBinary({ CLEAROTRON_AI: "silent-engine", PATH: "" });
  assert.equal(r.resolved, null);
  assert.equal(r.binEnv, null);
});

test("the binary→variable map still matches what the engines actually read", () => {
  // The map in driver.config duplicates knowledge that lives in the engine modules. Duplicated on
  // purpose — driver.config must not import an engine — so the drift is caught here instead of by a
  // preflight that cheerfully approves a variable nothing reads.
  //
  // DERIVED FROM THE MAP, and spelling-aware in BOTH directions — because the first cut of this arm
  // was neither. It repeated the map's literals a third time and pinned one spelling in one read
  // form, so step 4 moving these reads to `envFrom(process.env, …)` reddened it for the CONVERSION
  // rather than for a drift. An arm that cannot tell those two apart is not checking the thing it
  // claims to check — so it accepts either read form, under any spelling the alias table carries.
  const sources = {
    "anthropic-agent": ["anthropic-agent.mjs", "claude"],
    "openai-agent": ["openai-agent.mjs", "codex"],
  };
  for (const [engineId, [file, fallback]] of Object.entries(sources)) {
    const declared = ENGINE_BINARIES[engineId].env;
    // Named, not assumed: if the row ever stops carrying `env`, the line below builds a regex out of
    // nothing and this arm fails with a message about a missing read rather than about the map that
    // lost its field.
    assert.match(declared ?? "", /^[A-Z][A-Z0-9_]*$/,
      `ENGINE_BINARIES["${engineId}"].env does not name a variable — the map lost the field this arm reads`);
    const src = readFileSync(join(REPO, "driver", "engine", file), "utf8");
    const forms = [declared].flatMap((sp) => [
      new RegExp(String.raw`process\.env\.${sp}\s*\|\|\s*"${fallback}"`),
      new RegExp(String.raw`envFrom\(\s*process\.env\s*,\s*["\x27]${sp}["\x27]\s*\)\s*\|\|\s*"${fallback}"`),
    ]);
    assert.ok(forms.some((re) => re.test(src)),
      `${engineId} does not read ${declared} — under any of its spellings (${[declared].join(", ")}), `
      + `in either read form — and fall back to "${fallback}". The preflight would approve a variable the `
      + `engine does not read, which is the drift this arm exists to catch.`);
  }
});

// ──: the map is now a REGISTRY, and three readers depend on it ─────────────────────────────────
//
// It was a module-private const serving one function. It is exported now because setup was answering the
// same question with its own hardcoded answer — `CLEAROTRON_CLAUDE_PATH || "claude"` and an unconditional
// `CLEAROTRON_AI=anthropic-agent` — so the wizard could not offer the second adapter and the two lists
// could disagree in silence. The wizard's menu, the turn probe and this preflight all read this one map,
// which only helps while the map agrees with the adapter registry it is describing.

test("#772 the registry and the driver's adapter registry name the SAME engines", async () => {
  // Two lists that can disagree, and the disagreement is silent until a reader picks the row that does
  // not exist — the `uspto-local` shape from the register-provider side, one layer up.
  const registered = [...registeredEngines()].sort();
  assert.deepEqual(Object.keys(ENGINE_BINARIES).sort(), registered,
    "an adapter the driver ships must be reachable from setup, and setup must offer none that it does not");
  assert.equal(DEFAULT_ENGINE_ID, DEFAULT_ENGINE, "one production default, not two");
});

test("#772 each registry row names an adapter module that loads and answers to its own id", async () => {
  // `module`/`adapter` are STRINGS so driver.config still imports no engine (see the note above). A
  // string is not checked by the module system, so it is checked here: a typo would otherwise surface as
  // a probe that cannot load an engine the preflight had just approved.
  for (const [id, spec] of Object.entries(ENGINE_BINARIES)) {
    const specifier = engineAdapterSpecifier(id);
    assert.ok(specifier?.startsWith("file:"), `${id} resolves to no adapter specifier`);
    const mod = await import(specifier);
    assert.equal(mod[spec.adapter]?.name, id, `${spec.module} must export ${spec.adapter} named "${id}"`);
  }
  assert.equal(engineAdapterSpecifier("silent-engine"), null, "and an id the driver does not ship resolves to nothing");
});

test("#772 the filesystem preflight still SPAWNS NOTHING — the turn probe is a separate door", () => {
  // driver.config.mjs's header refuses to spawn at the run door and gives its reasons (a process at every
  // run start, a credential store touched on any invocation, a preflight that can hang). added a
  // probe that DOES spawn, and it went in engine/probe.mjs precisely so this contract survives. If a
  // spawn ever appears in this file, that decision was reversed by accident.
  const src = readFileSync(join(REPO, "driver", "driver.config.mjs"), "utf8");
  assert.ok(!/child_process/.test(src), "driver.config must not gain a spawn");
  assert.ok(!/\bexecFileSync\b|\bspawnSync\b/.test(src));
});

// ── the acceptance criterion, end to end ─────────────────────────────────────────────────────────────

const job = (ref, mark) => ({
  id: `eb-${ref}`, msgId: `<eb-${ref}@x>`, forwarder: "requester", forwarderDomain: "example.com",
  ref, markName: mark, classes: [9], provider: "corsearch",
});
const studioFor = (root) => join(root, "workspace-clawdi", "studio", "prelim-search");
const queueFor = (root) => join(studioFor(root), "queue");
const runToExit = (env) => {
  const c = spawn(process.execPath, [RUNNER], { env, stdio: ["ignore", "pipe", "pipe"] });
  c.log = "";
  c.stdout.on("data", (d) => { c.log += d; });
  c.stderr.on("data", (d) => { c.log += d; });
  return new Promise((r) => c.on("exit", (code) => r({ code, log: c.log })));
};

test("CLEAROTRON_CLAUDE_PATH=/nope refuses BEFORE any run dir exists", async () => {
  const root = mkdtempSync(join(tmpdir(), "engine-nodir-"));
  const Q = queueFor(root);
  mkdirSync(Q, { recursive: true });
  writeFileSync(join(Q, "job-e.json"), JSON.stringify(job("TMP9401", "NO ENGINE")));

  const { code, log } = await runToExit({
    ...process.env,
    CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: "/nope",
    CLEAROTRON_WORK_DIR: root, CLEAROTRON_REPORTS_DIR: join(root, "pool"), CLEAROTRON_OUTBOX_DIR: join(root, "outbox"),
    CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0", CLEAROTRON_QUEUE_SCAN_MS: "100",
    CORSEARCH_SESSION_KEY: "test-offline", CLEAROTRON_SATPROBE_CODESIDE: "0", CLEAROTRON_BAND_TRUTH_GATE: "0",
  });

  assert.equal(code, 0, log);
  assert.ok(existsSync(join(Q, "job-e.failed")), `the job is marked failed\n${log}`);
  const res = JSON.parse(readFileSync(join(Q, "job-e.failed.result"), "utf8"));
  // — THE REASON NAMES THE CURRENT SPELLING, whichever one the operator set. This arm used to pin
  // the RETIRED name, so it passed while the refusal sent a reader to a variable they never touched.
  //
  // AND IT DOES NOT ASSERT THE RETIRED NAME IS ABSENT, deliberately. That shape belongs where a message
  // is being RE-AIMED at a new name; this site RESOLVES an alias, and with the compat window live the
  // retired key legitimately carries the value. Asserting its absence here would red working behaviour.
  assert.match(String(res.reason ?? ""), new RegExp("CLEAROTRON_CLAUDE_PATH"),
    `the recorded reason names the CURRENT spelling of the variable\n${log}`);
  assert.match(String(res.reason), /refused now rather than at the first stage/, "and says it is a preflight, not a stage fault");
  // — the pre-run notice is a QUEUE-level outbox packet, not a spawned ping. Same lane the intake
  // reject and duplicate notices have always taken; the only reason this one had its own was that it
  // predated them and was never re-routed.
  assert.match(log, /pre-run failure packet/, "the pre-run notice lane fires — a run dir would have routed it through the RUN-level packet lane");

  // THE criterion: refused before the run directory is created. Checked by looking for one, rather than
  // by trusting the order of two statements — a run dir left behind by a run that never started is a
  // resumable-looking husk, and the whole point of a preflight is that it produces none.
  const runs = [];
  const walk = (dir) => { for (const e of readdirSync(dir, { withFileTypes: true })) { const p = join(dir, e.name); if (!e.isDirectory()) continue; if (existsSync(driverDir(p)) || existsSync(join(p, "status.json"))) runs.push(p); else walk(p); } };
  walk(root);
  assert.deepEqual(runs, [], `no run directory may exist\n${log}`);
  assert.ok(!existsSync(join(root, "pool")) || readdirSync(join(root, "pool")).length === 0, "and nothing was published");
});

// ── item 3 — native Windows refuses by PLATFORM, before anything reads PATH ────────────────────
//
// INSTALL.md has promised since launch that a native-Windows run "refuses at preflight" and names the
// reason. Nothing implemented it. What a Windows user actually reached was the PATH resolver, which
// splits on ":" — so `C:\Users\…` is cut at the drive letter, and the refusal told them their
// `claude.cmd` was not on PATH while printing a PATH it had just mangled. A true sentence about a false
// premise.
//
// `platform` is injectable precisely because the population this protects cannot run this suite to find
// out: asserting it on win32 only would mean asserting it nowhere.

test("#1149 item 3: native Windows refuses by name, and never blames PATH", () => {
  assert.throws(() => preflightEngineBinary({}, { platform: "win32" }),
    /does not run on native Windows/,
    "a native-Windows run still falls through to the PATH resolver INSTALL.md says it does not reach");

  let msg = "";
  try { preflightEngineBinary({}, { platform: "win32" }); } catch (e) { msg = e.message; }
  assert.ok(!/PATH=/.test(msg),
    "the win32 refusal quotes a PATH — on win32 that value has been torn at the drive letter by the "
    + "':' split, so quoting it sends the reader after a path they never set");
  assert.match(msg, /WSL2|devcontainer/, "the refusal must name the route that does work, or it is a dead end");
});

test("#1149 item 3: every other platform is unchanged — the guard is a refusal, not a new default", () => {
  // The property is NOT "linux never throws" — with an unresolvable binary it throws for good reasons,
  // and asserting otherwise was wrong in the first draft of this test. The property is that no platform
  // other than win32 can ever reach the PLATFORM refusal, i.e. the guard did not become a second engine
  // selection path.
  for (const platform of ["linux", "darwin", "freebsd"]) {
    let msg = "";
    try { preflightEngineBinary({ CLEAROTRON_CLAUDE_PATH: "definitely-not-a-real-binary" }, { platform }); }
    catch (e) { msg = e.message; }
    assert.ok(!/does not run on native Windows/.test(msg),
      `${platform} reached the win32 refusal — the platform guard is firing on platforms it does not describe`);
  }
});

// ── SECOND FINDING — HALF A'S LEDGER WAS A PLAN, AND I RELAYED IT AS A RECORD ───────────────
//
// Verification on tip `2fa20c9`: `CLEAROTRON_CLAUDE_PATH=/nope` → `✗ CLEAROTRON_CLAUDE_PATH="/nope" is not
// an executable file`. The current spelling set, the retired one named.
//
// Reproducing through the REAL entry path — `clearotron doctor`, not the function — showed it was not
// one site but EIGHT on one screen: the three engine-binary refusals, four wizard lines the half-A
// ledger listed as its own, and the pool-root refusal in `driver.config.mjs`.
//
// Half A's ledger said it carried seven `bin/onboard.mjs` emitter lines. It carried a generic
// `${name} is not set` in one loop and the wizard's candidate WRITES. The seven specific
// lines were never converted, and half B's PR relayed "the ledger closed" on the strength of that
// ledger rather than on a run. I verified B's 25 sites and took A's 8 on trust.
//
// SO THIS ARM DRIVES THE SCREEN, not the sites. A ledger can be wrong; a screen with a retired name on
// it cannot be.
test("#1673 no entry point names a retired spelling on its own screen", async () => {
  const { execFileSync } = await import("node:child_process");
  const ROOT = join(dirname(dirname(fileURLToPath(import.meta.url))), "..");
  // NAMED, NOT DERIVED, and that is right rather than lazy now: deleted the retirement map, so
  // this list is closed history and cannot grow. What the arm still buys is that no entry point prints
  // one of these dead names at a stranger who would then go looking for it in their own file.
  // ASSEMBLED FROM PIECES, NOT WRITTEN OUT, and that is not decoration. A sweep that renames the old
  // spellings to the new ones cannot tell a list of names it must REWRITE from a list of names that
  // exists BECAUSE they are dead — it rewrote this one, and the arm then reported every name in force as
  // retired. Splitting each name across a `+` leaves nothing for a whole-name matcher to find, so the
  // list survives the next sweep as well.
  //
  // AND THE 2026-09-04 SWEEP GOT IT ANYWAY, one level below where the defence was aimed. Every NAME was
  // split across a `+` and survived; the PREFIX CONSTANT was a plain literal, so a global rename rewrote
  // this one line and converted the whole dead-names list into a list of names in force. The arm then
  // reported `CLEAROTRON_QUEUE_DIR` — the live spelling — as retired, which is the exact failure the
  // paragraph above describes, arriving through the one token it did not protect. The prefix is split
  // now too. A defence against a text sweep has to cover every literal the list is BUILT from, not only
  // the ones a reader thinks of as the data.
  //
  // The list also means MORE after that sweep rather than less: the rename retired the whole `PRELIM_`
  // namespace at once, so an emitter still printing one of these sends a stranger looking for a name
  // that exists nowhere in the product.
  const P = "PRELIM" + "_";
  const retired = [P + "ENGINE", P + "ANTHROPIC_AUTH", P + "OPENAI_AUTH", P + "CLAUDE_BIN",
    P + "CODEX_BIN", P + "REGISTER_PROVIDER", P + "POOL_ROOT", P + "POOL_URL",
    P + "WORKSPACE_ROOT", P + "PROFILES_DIR", P + "SKILLS_DIR", P + "GRANTS_FILE",
    P + "NO_ENV_FILE", P + "QUEUE_DIR", P + "OUTBOX_DIR", "CF_" + "ACCESS_AUD",
    "CLIENT_CF_" + "ACCESS_AUD", P + "BRAND_NAME", P + "BRAND_TAGLINE", P + "BRAND_PRODUCT"];
  const RETIRED_RE = new RegExp(`\\b(${retired.join("|")})\\b`, "g");

  // Both read-only entries, and a deliberately broken engine path so the refusal branches fire. Every
  // other branch on this screen is exercised by an unset environment, which is what a stranger has.
  for (const args of [["doctor"], ["install", "--check"]]) {
    // EVERY RETIRED SPELLING IS CLEARED FROM THE CHILD FIRST, and that is the whole precision of this
    // arm. An emitter that REPORTS what an operator set is right to echo a retired name when the
    // operator set one — half A's rule, and it is correct. The defect is a retired name the PRODUCT
    // chose. Measured: the first cut inherited this suite's own contained environment, which sets two
    // variables under their retired spellings, and reported the honest echo as a defect.
    const env = { ...process.env, CLEAROTRON_CLAUDE_PATH: "/nope" };
    for (const n of retired) delete env[n];
    let out = "";
    try {
      out = execFileSync(process.execPath, [join(ROOT, "bin/clearotron.mjs"), ...args], {
        encoding: "utf8", cwd: ROOT, timeout: 120000, env,
      });
    } catch (e) { out = `${e.stdout ?? ""}${e.stderr ?? ""}`; }
    nonEmpty([out.trim()], `\`clearotron ${args.join(" ")}\` printed nothing — the arm would pass over silence`);
    const hits = [...new Set(out.match(RETIRED_RE) ?? [])];
    assert.deepEqual(hits, [],
      `\`clearotron ${args.join(" ")}\` tells a reader to set ${hits.join(", ")} — retired spellings, on the `
      + "screen the install instructions send them to. Fix the emitter; do not add the name here.");
  }
});
