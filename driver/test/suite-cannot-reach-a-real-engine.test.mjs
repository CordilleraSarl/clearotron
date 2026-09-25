// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// THE SUITE CANNOT REACH A REAL ENGINE BINARY, OR A REAL PROVIDER CREDENTIAL.
//
// THE INCIDENT. `scripts/test-run.mjs` has printed "OFFLINE SUITE — no model is called, no register is
// queried, nothing is spent" on every run since, and nothing enforced it. On 2026-08-23 a unit suite
// launched with a provider prefix reached the real `claude` on PATH and spent 284 opus-5 turns over two
// hours. The suites that dispatch a stage pin `mock-claude.mjs` themselves; the ones that forget inherit
// whatever binary the operator's shell names, and no assertion anywhere said otherwise.
//
// So the property under test is not "a mock was used" but "A REAL ENGINE WAS NOT REACHABLE" — the
// difference between a suite that happened to be offline and one that could not have been online.
//
// EVERY TEST HERE SPAWNS THE REAL WRAPPER. There is no unit-testable seam: what is being asserted is what
// `scripts/test-run.mjs` does to a child's environment before spawning it, so a test that imported a
// helper and checked its return value would be testing something the suite does not run through. Same
// reasoning, and the same shape, as suite-cannot-reach-live-data-plane.test.mjs.
//
// THE COMPLETENESS TESTS ARE THE CONTROL, and without them the rest is worth little: "a planted claude
// path is replaced" passes just as happily against a wrapper that only ever knew about claude. The two
// completeness tests plant EVERY engine in `ENGINE_BINARIES` and EVERY credential declared by every
// credential-declaring table in driver.config, both DISCOVERED at run time, so adding a provider or an
// engine reds this file until the wrapper covers it.
//
// THEY ARE BEHAVIOURAL ON PURPOSE. An earlier draft re-declared the wrapper's suffix pattern here and
// compared the two lists; that only ever proves the test agrees with its own copy. Planting the real
// names through the real wrapper cannot drift from it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

import { pinEnv, pinEnvAll } from "../../shared/env-aliases.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const RUNNER = join(ROOT, "scripts", "test-run.mjs");
const STUB = join(ROOT, "driver", "test", "refusing-engine.mjs");
const OVERRIDE = "CT_ALLOW_REAL_ENGINE";

/**
 * A child-side program that resolves a bare name on PATH the way `resolveExecutable` does, then reports
 * WHAT. Interpolated rather than imported because the child is a `node -e` one-liner with no module of
 * its own — and it has to answer the question the engine asks, which is "what does PATH give me for the
 * bare word", not "what is in this variable".
 */
const WHICH = `(() => {
  const { join, delimiter } = require("node:path");
  const { statSync, realpathSync } = require("node:fs");
  const which = (n) => {
    for (const d of String(process.env.PATH || "").split(delimiter)) {
      if (!d) continue;
      const p = join(d, n);
      try { if (statSync(p).isFile()) return realpathSync(p); } catch { /* keep walking */ }
    }
    return null;
  };
  return WHAT;
})()`;

/** Both spellings of both engine binary variables, derived the way the wrapper derives them. */
const ENGINE_VARS = [...new Set(
  ["CLEAROTRON_CLAUDE_PATH", "CLEAROTRON_CODEX_PATH"].flatMap((n) => [n, n]),
)];

/**
 * Every credential name any table in driver.config declares, discovered rather than listed.
 *
 * `config` is a getter that REFUSES when CLEAROTRON_REPORTS_DIR is unset and this suite runs with it
 * unset, so each export is read behind its own guard. A table added later is picked up for free; that is
 * the entire point of discovering rather than naming.
 */
async function declaredCredentials() {
  const m = await import("../driver.config.mjs");
  const FIELDS = ["credEnv", "apiKeyEnv", "credEnvAlso"];
  const found = new Set();
  for (const name of Object.keys(m)) {
    try {
      const val = m[name];
      if (!val || typeof val !== "object") continue;
      for (const entry of Object.values(val)) {
        if (!entry || typeof entry !== "object") continue;
        for (const f of FIELDS) {
          for (const v of Array.isArray(entry[f]) ? entry[f] : [entry[f]]) if (v) found.add(v);
        }
      }
    } catch { /* a refusing getter declares no credential */ }
  }
  return [...found];
}

/**
 * Run the wrapper over a child that reports what it inherited. Every name this file cares about is
 * CLEARED from the base environment first, so the ambient shell of whoever runs the suite cannot decide
 * the result — an ambient shell is what the incident was.
 */
function runWrapper(vars, { report }) {
  const env = { ...process.env };
  for (const n of ENGINE_VARS) delete env[n];
  delete env[OVERRIDE];
  // — through the alias helper, never the literal key. This spreads `process.env`, so an inherited
  // CLEAROTRON_* spelling survives the spread and RESOLVES FIRST; assigning only the name a caller typed
  // sets nothing that wins, and the wrapper under test then reads the operator's value while every arm
  // here believes it is reading the fixture's. Measured: 7 arms in this file fail under
  // CLEAROTRON_QUEUE_DIR and pass without it. `pinEnv` writes — and deletes — every spelling.
  for (const [k, v] of Object.entries(vars)) pinEnv(env, k, v);
  const child = `console.log("REPORT:" + JSON.stringify(${report}))`;
  const r = spawnSync(process.execPath, [RUNNER, process.execPath, "-e", child], {
    cwd: ROOT, env, encoding: "utf8",
  });
  const out = r.stdout ?? "";
  const line = out.split("\n").find((l) => l.startsWith("REPORT:"));
  return {
    code: r.status,
    report: line ? JSON.parse(line.slice("REPORT:".length)) : null,
    err: r.stderr ?? "",
    all: out + (r.stderr ?? ""),
  };
}

// ── the engine binary ────────────────────────────────────────────────────────────────────────────────

test("an inherited engine path is DELETED in both spellings, and the bare name resolves to the stub", () => {
  const r = runWrapper(
    { CLEAROTRON_CLAUDE_PATH: "/usr/local/bin/claude", CLEAROTRON_CLAUDE_PATH: "/usr/bin/claude" },
    { report: WHICH.replace("WHAT", '{legacy: process.env.CLEAROTRON_CLAUDE_PATH ?? null, current: process.env.CLEAROTRON_CLAUDE_PATH ?? null, resolved: which("claude")}') },
  );
  assert.ok(r.report, `the child never reported; wrapper exited ${r.code}\n${r.all.slice(0, 800)}`);
  assert.equal(r.report.legacy, null, "an operator's inherited pin must not survive into the suite");
  assert.equal(r.report.current, null, "nor its current spelling");
  assert.equal(basename(r.report.resolved ?? ""), "refusing-engine.mjs",
    "with no variable set, the bare word the engine falls back to must resolve to the stub on PATH — "
    + `resolved to ${r.report.resolved}`);
});

// THE REGRESSION THIS FILE EXISTS TO PREVENT A SECOND TIME. The first version of the wrapper PINNED the
// legacy spelling to the stub. applyEnvAliases fills BOTH directions, so that pin reappeared under the
// current spelling inside the child; a test then assigning the legacy name its own mock produced two
// spellings that DISAGREE, the current name won, and the stub displaced the mock. Four runner arms went
// red exactly there. This drives that sequence directly.
test("the wrapper leaves NO engine variable set — the disagreement that displaced a mock cannot arise", () => {
  const r = runWrapper({}, {
    report: '{legacy: process.env.CLEAROTRON_CLAUDE_PATH ?? null, current: process.env.CLEAROTRON_CLAUDE_PATH ?? null}',
  });
  assert.ok(r.report, `the child never reported; wrapper exited ${r.code}\n${r.all.slice(0, 800)}`);
  assert.deepEqual(r.report, { legacy: null, current: null },
    "Both must be UNSET. The first version of this wrapper pinned a spelling to the stub, and while the "
    + "compatibility window was open the alias layer filled BOTH directions — so that value reappeared "
    + "under the other spelling in the child, a test assigning its own mock DISAGREED with it, the stub "
    + "displaced the mock and four runner arms went red. The window is gone (#1838) and the race with it, "
    + "but the rule it bought is kept: a wrapper that sets nothing cannot lose a race about what it set, "
    + "and the PATH shim closes the default instead.");
});

test("a test that pins its own mock still wins — the idiom 98 sites in this suite already use", () => {
  const r = runWrapper(
    { CLEAROTRON_CLAUDE_PATH: "/usr/bin/claude" },
    { report: '(process.env.CLEAROTRON_CLAUDE_PATH = "/fixture/mock-claude.mjs", {bin: process.env.CLEAROTRON_CLAUDE_PATH})' },
  );
  assert.ok(r.report, `the child never reported; wrapper exited ${r.code}\n${r.all.slice(0, 800)}`);
  assert.equal(r.report.bin, "/fixture/mock-claude.mjs",
    "a child's own same-name assignment must beat the wrapper's pin, or the stub reds 98 passing sites");
});

test("COMPLETENESS: every engine in ENGINE_BINARIES is covered, not just the one that caused the incident", async () => {
  const m = await import("../driver.config.mjs");
  const engines = Object.entries(m.ENGINE_BINARIES);
  assert.ok(engines.length >= 2, `expected the engine table, found ${engines.length} entry(ies)`);

  const planted = {};
  for (const [, spec] of engines) planted[spec.env] = `/usr/bin/${spec.fallback}`;
  const inner = "{" + engines.map(([id, sp]) =>
    `${JSON.stringify(id)}: {pin: process.env[${JSON.stringify(sp.env)}] ?? null, resolved: which(${JSON.stringify(sp.fallback)})}`).join(", ") + "}";
  const r = runWrapper(planted, { report: WHICH.replace("WHAT", inner) });
  assert.ok(r.report, `the child never reported; wrapper exited ${r.code}\n${r.all.slice(0, 800)}`);

  const reachable = Object.entries(r.report)
    .filter(([, v]) => v.pin !== null || basename(v.resolved ?? "") !== "refusing-engine.mjs")
    .map(([id, v]) => `${id}: pin=${v.pin} resolved=${v.resolved}`);
  assert.deepEqual(reachable, [],
    `these engines can still reach a real binary from a unit suite:\n  ${reachable.join("\n  ")}\n`
    + `Add the engine's variable to ENGINE_BIN_VARS and its fallback word to ENGINE_FALLBACK_NAMES in `
    + `scripts/test-run.mjs.`);
});

// ── the copy Clearotron installed──────────────────────────────────────────────────────────────
//
// The engine resolver's last step (driver.config.mjs resolveEngineProgram) reads the copy setup installed
// in the engines folder under the home directory, never PATH, and on a developer's machine that copy can
// be a REAL program. PATH is asked first, so the shim answers every child that keeps the wrapper's PATH; a
// child that composes its own PATH reaches the last step. So this asks the resolver ITSELF, inside the
// wrapper's child, with a PATH that holds nothing, for every engine the table declares.
//
// WHAT IT CANNOT CLOSE. The setting reaches every process that inherits the wrapper's environment, and no
// other. A drive that spawns a command with an environment composed from nothing, and no HOME or the real
// one, hands that command the developer's own engines folder, real programs included. Such a drive spreads
// NO_INSTALLED_ENGINES from drive-env.mjs; nothing here can see one that does not.

test("THE COPY INSTALLED WITH CLEAROTRON is closed for the whole suite, whatever PATH a child composes", async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, chmodSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { pathToFileURL } = await import("node:url");
  const m = await import("../driver.config.mjs");
  const engines = Object.keys(m.ENGINE_BINARIES).sort();
  assert.ok(engines.length >= 2, `expected the engine table, found ${engines.length} entry(ies)`);
  // A module import needs a promise, which runWrapper's one-expression child cannot wait for; the base
  // environment is cleared the way runWrapper clears it, and the lookup setting too, so the answer is the
  // wrapper's and not whatever this process inherited. The child imports by file URL, written out whole so
  // the computed-import guard can read that it is one.
  const ask = (setup) => {
    const env = { ...process.env };
    for (const n of ENGINE_VARS) delete env[n];
    delete env[OVERRIDE];
    delete env[m.ENGINES_DIR_ENV];
    const child = `import(${JSON.stringify(pathToFileURL(join(ROOT, "driver", "driver.config.mjs")).href)}).then((m) => { ${setup} const out = {}; `
      + "for (const id of Object.keys(m.ENGINE_BINARIES)) { const r = m.resolveEngineProgram(id, { env: { PATH: \"/nonexistent\" } }); "
      + "out[id] = { source: r.source, resolved: r.resolved }; } console.log(\"REPORT:\" + JSON.stringify(out)); })";
    const r = spawnSync(process.execPath, [RUNNER, process.execPath, "-e", child], { cwd: ROOT, env, encoding: "utf8" });
    const line = (r.stdout ?? "").split("\n").find((l) => l.startsWith("REPORT:"));
    return { code: r.status, report: line ? JSON.parse(line.slice("REPORT:".length)) : null, all: `${r.stdout ?? ""}${r.stderr ?? ""}` };
  };

  const closed = ask("");
  assert.ok(closed.report, `the child never reported; wrapper exited ${closed.code}\n${closed.all.slice(0, 800)}`);
  const reachable = Object.entries(closed.report).filter(([, v]) => v.resolved !== null).map(([id, v]) => `${id}: ${v.source} ${v.resolved}`);
  assert.deepEqual(reachable, [],
    `a child that composes its own PATH can still reach an installed engine program:\n  ${reachable.join("\n  ")}\n`
    + `scripts/test-run.mjs must point ${m.ENGINES_DIR_ENV} at an empty directory.`);

  // THE CONTROL. The same child, with the lookup pointed at a planted tree, finds a copy for every engine:
  // the empty answer above is the wrapper closing the route, not a resolver that cannot see one.
  // Windows starts a program by its extension and has no execute bit, so the resolver takes only an
  // .exe, .com or JavaScript file there; the planted copy is named the way the vendor names it on Windows.
  const program = process.platform === "win32" ? "program.exe" : "program";
  const planted = mkdtempSync(join(tmpdir(), "planted-installed-copy-"));
  for (const spec of Object.values(m.ENGINE_BINARIES)) {
    const dir = join(planted, "node_modules", ...spec.package.split("/"));
    mkdirSync(join(dir, "bin"), { recursive: true });
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: spec.package, version: "0.0.1", bin: { [spec.fallback]: `bin/${program}` } }));
    writeFileSync(join(dir, "bin", program), "#!/bin/sh\nexit 0\n");
    chmodSync(join(dir, "bin", program), 0o755);
  }
  const open = ask(`process.env[m.ENGINES_DIR_ENV] = ${JSON.stringify(planted)};`);
  assert.ok(open.report, `the control child never reported; wrapper exited ${open.code}\n${open.all.slice(0, 800)}`);
  const found = Object.entries(open.report).filter(([, v]) => v.source === "installed").map(([id]) => id).sort();
  assert.deepEqual(found, engines, "the control could not find a planted copy, so the empty answer above proves nothing");
});

// ── the credentials ──────────────────────────────────────────────────────────────────────────────────

test("COMPLETENESS: no credential declared by any driver.config table reaches the suite", async () => {
  const creds = await declaredCredentials();
  assert.ok(creds.length >= 8, `expected the credential tables, found ${creds.length} name(s) — the discovery stopped selecting`);

  const planted = Object.fromEntries(creds.map((n) => [n, "planted-not-a-real-credential"]));
  const report = "{" + creds.map((n) => `${JSON.stringify(n)}: Boolean(process.env[${JSON.stringify(n)}])`).join(", ") + "}";
  const r = runWrapper(planted, { report });
  assert.ok(r.report, `the child never reported; wrapper exited ${r.code}\n${r.all.slice(0, 800)}`);

  const survived = Object.entries(r.report).filter(([, present]) => present).map(([n]) => n);
  assert.deepEqual(survived, [],
    `these credentials reach the suite from the ambient shell:\n  ${survived.join("\n  ")}\n`
    + `They are declared by a driver.config table but do not match CREDENTIAL_RE in scripts/test-run.mjs.`);
});

test("the suite's own MOCK_ fixtures are NOT stripped — a guard that breaks the mocks gets deleted", () => {
  const r = runWrapper(
    { MOCK_CLAUDE_TOKEN_COUNT: "7", ANTHROPIC_API_KEY: "planted-not-a-real-credential" },
    { report: '{mock: process.env.MOCK_CLAUDE_TOKEN_COUNT ?? null, key: Boolean(process.env.ANTHROPIC_API_KEY)}' },
  );
  assert.ok(r.report, `the child never reported; wrapper exited ${r.code}\n${r.all.slice(0, 800)}`);
  assert.equal(r.report.mock, "7", "the mock engine's own controls must survive");
  assert.equal(r.report.key, false, "the credential beside it must not");
});

test("the withheld credentials are NAMED on stderr — a strip nobody can see is the incident again", () => {
  const r = runWrapper({ ANTHROPIC_API_KEY: "planted-not-a-real-credential" }, { report: "{}" });
  assert.match(r.err, /withheld 1 inherited credential\(s\): ANTHROPIC_API_KEY/,
    "the run has to say what it took away, by name");
});

// ── the way through ──────────────────────────────────────────────────────────────────────────────────

test(`${OVERRIDE} lets a real binary through, and is loud about it`, () => {
  const env = { ...process.env };
  for (const n of ENGINE_VARS) delete env[n];
  env.CLEAROTRON_CLAUDE_PATH = "/usr/bin/claude";
  env[OVERRIDE] = "1";
  const child = 'console.log("REPORT:" + JSON.stringify({bin: process.env.CLEAROTRON_CLAUDE_PATH}))';
  const r = spawnSync(process.execPath, [RUNNER, process.execPath, "-e", child], { cwd: ROOT, env, encoding: "utf8" });
  const line = (r.stdout ?? "").split("\n").find((l) => l.startsWith("REPORT:"));
  assert.ok(line, `the child never reported; wrapper exited ${r.status}\n${(r.stdout ?? "") + (r.stderr ?? "")}`);
  assert.equal(JSON.parse(line.slice(7)).bin, "/usr/bin/claude", "a named override has to actually work");
  assert.match(r.stderr ?? "", new RegExp(`${OVERRIDE} IS SET`),
    "a bypass nobody can see is the incident with an extra step");
});

// ── the stub itself ──────────────────────────────────────────────────────────────────────────────────

test("the stub refuses: non-zero, and it names itself so the cause is not a mystery", () => {
  const r = spawnSync(process.execPath, [STUB], { input: '{"prompt":"x"}', encoding: "utf8" });
  assert.notEqual(r.status, 0, "a stub that exits 0 is a mock, and a mock is what this replaces");
  assert.match(r.stderr ?? "", /CT_REFUSING_ENGINE_STUB/,
    "the refusal has to carry a token no engine would ever emit, or it reads as a model reply");
});

test("THE STUB'S OWN ADVICE MUST RUN — the array form silently sets variables named \"0\" and \"1\"", () => {
  // Advice living in a string is the one kind nothing executes, so it rots without a single test going red.
  // This one shipped wrong: `pinEnvAll` takes an OBJECT (`Object.entries(pairs)`), and the advice showed an
  // array of pairs. Following it produced `{"0":"CLEAROTRON_AI,anthropic-agent","1":"..."}` — two variables
  // named after array indices, the pin doing nothing, and no error anywhere. The advice for fixing a
  // silent-loss bug caused a silent loss.
  const src = readFileSync(STUB, "utf8");
  const call = src.match(/pinEnvAll\(childEnv,\s*([\s\S]{0,80}?)\)/);
  assert.ok(call, "the stub no longer shows a pinEnvAll example — the advice is what makes the refusal actionable");
  assert.ok(!call[1].trimStart().startsWith("["),
    `the advice shows pinEnvAll's pairs as an array (${call[1].trim().slice(0, 40)}…). Object.entries on an `
    + 'array yields index keys, so following it sets variables named "0" and "1" and pins nothing.');

  // And the form it DOES show must actually set every spelling — asserted against the helper, not read.
  const env = {};
  pinEnvAll(env, { CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: "/bin/x" });
  for (const name of ["CLEAROTRON_AI", "CLEAROTRON_CLAUDE_PATH"]) {
    for (const spelling of [name]) {
      assert.ok(spelling in env, `the documented form leaves ${spelling} unset — one spelling can still win over the other`);
    }
  }
});
