// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// bin/onboard.mjs — `clearotron install` and `clearotron doctor` (still `npm run setup` too).
//
// The wizard's promise is that nothing is persisted until it has been checked against the real service.
// These tests hold the parts of that promise a machine can hold offline: the check writes nothing, an
// absence and a misconfiguration are told apart, the provider preflight cannot be fooled by whatever the
// operator's shell happens to have set, and the door the EUIPO credential is validated through refuses a
// bad secret. The live end of it — driving the wizard against EUIPO with a wrong secret and watching it
// leave no .env behind — is evidence for the issue, not something to make CI dial a register for.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, existsSync, statSync, rmSync, readFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { wrapProse, proseWidth, composeEnvBody } from "../../bin/onboard.mjs";
import { preflightSkillsStore } from "../skills-store-provenance.mjs";
import { RESEARCH_PROVIDERS, SERP_PROVIDERS } from "../driver.config.mjs";
import { resolveEngineBin, readEnvFile, preflightCandidate, PROVIDERS, engineOptions,
  usptoSyncPlan, usptoConsentPrompt, isExplicitYes, backgroundSyncSpec,
  offerUsptoSync, deploymentCurrency } from "../../bin/onboard.mjs";
import { VERBS } from "../../bin/clearotron.mjs";
import { USPTO_ARCHIVE_GB, USPTO_INGEST_GB_PER_HOUR, usptoBuildHours } from "../../shared/uspto-index-size.mjs";
import { config, KNOWN_REGISTER_PROVIDERS, ENGINE_BINARIES } from "../driver.config.mjs";
import { loadEnvLocal } from "../../shared/env-local.mjs";
import { nonEmpty } from "../../shared/vacuous-pass.mjs";
import { pinEnv } from "../../shared/env-aliases.mjs";   // — a fixture pins EVERY spelling

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const ONBOARD = join(REPO, "bin", "onboard.mjs");

/**
 * A directory containing exactly one entry: a `node` symlink to the interpreter running this suite.
 *
 * This exists so `run()` can offer a hermetic PATH that still resolves `node`. Pointing PATH at
 * `dirname(process.execPath)` looks equivalent and is not: that directory is wherever this machine
 * installs node, which on a devcontainer or an npm-global prefix is also wherever it installs `claude`.
 */
const NODE_BIN = mkdtempSync(join(tmpdir(), "onboard-node-"));
symlinkSync(process.execPath, join(NODE_BIN, "node"));

/** Run the CLI with the ambient environment stripped — the shell this test runs in has real credentials. */
function run(args, env = {}) {
  try {
    const out = execFileSync(process.execPath, [ONBOARD, ...args], {
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
      // PATH is hermetic ON PURPOSE — it strips ambient credentials so a developer's own signed-in
      // engine cannot make this suite pass. But it must still resolve `node`, because the probe spawns
      // mock-claude.mjs through its `#!/usr/bin/env node` shebang and `env` searches the CHILD's PATH.
      // /usr/bin/node exists on this VM and on a dev box, so a hermetic /usr/bin:/bin resolved there and
      // the gap was invisible; a hosted runner has node ONLY in the toolcache setup-node exports, so
      // `env` failed, the probe correctly reported a startup-class engine death, and --check exited 1.
      //
      // item 1 — IT PINNED NODE BY ADMITTING NODE'S WHOLE DIRECTORY, WHICH IS NOT HERMETIC.
      // The previous line led with `dirname(process.execPath)`, and on any machine that installs CLIs
      // beside node — a devcontainer, a Codex sandbox, Claude Code on the web, an npm-global prefix —
      // that directory also holds `claude`. So the one test that asserts what `--check` says when there
      // is NO engine on PATH found one, and "--check separates an ABSENCE from a MISCONFIGURATION"
      // failed on exactly the population INSTALL.md §2 is written for. The hermeticity this comment
      // claims was being undone by the line it is attached to.
      //
      // NODE_BIN is a directory holding one symlink named `node`. The exact interpreter running this
      // suite stays resolvable on any machine — which is what the paragraph above needs — and nothing
      // that happens to be installed alongside it comes with it.
      //
      // — THIS SUITE'S CHECKOUT IS PINNED, AND SAYING SO IS NOT SILENCING ANYTHING.
      // The wizard's freshness check compares HEAD to origin/main. On CI the workspace is a branch
      // tracking origin/main parked at the sha under test, so the moment another merge lands while the
      // job queues it is genuinely one behind — and eight `--check` arms asserting exit 0 fail
      // together. Measured 2026-08-26: main read RED twice on exactly that, both reporting exactly 1,
      // with exactly one commit landing between the run starting and the arm executing; the green run
      // between them had none. The verdict was decided by queue position.
      //
      // The arms here are about what `--check` SAYS and WRITES, never about how current the machine
      // they run on happens to be. So they declare the checkout pinned — the same answer the check
      // already gives a branch with no upstream — and the arm below proves the check still fails a real
      // deployment that is behind. `env` spreads last, so a test that wants the real reader can unset it.
      env: {
        HOME: env.HOME ?? tmpdir(), PATH: [NODE_BIN, "/usr/bin", "/bin"].join(":"),
        CLEAROTRON_DOCTOR_ASSUME_PINNED: "1", ...env,
      },
    });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? -1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

/** Every tracked file's path + mtime + size, so "it wrote nothing" is an assertion and not a hope. */
function treeStamp(root) {
  const stamp = {};
  const walk = (d) => {
    for (const e of nonEmpty(readdirSync(d, { withFileTypes: true }), "readdirSync(d, { withFileTypes: true })")) {
      if (e.name === "node_modules" || e.name === ".git") continue;
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else { const s = statSync(p); stamp[relative(root, p)] = `${s.size}:${s.mtimeMs}`; }
    }
  };
  walk(root);
  return stamp;
}

test("--check on an unconfigured machine exits 0 and changes NOTHING on disk", () => {
  // Both halves of the criterion. Exit 0 alone would pass while the command quietly created a .env.
  const home = mkdtempSync(join(tmpdir(), "onboard-home-"));
  const before = treeStamp(join(REPO, "bin"));
  const beforeEnv = existsSync(join(REPO, ".env"));
  const r = run(["--check"], { HOME: home });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /Nothing was written/, r.out);
  assert.deepEqual(treeStamp(join(REPO, "bin")), before, "bin/ untouched");
  assert.equal(existsSync(join(REPO, ".env")), beforeEnv, "no .env conjured (nor an existing one removed)");
  rmSync(home, { recursive: true, force: true });
});

test("--check separates an ABSENCE from a MISCONFIGURATION", () => {
  // No `claude` and nothing set is a fresh machine: reported, exit 0. CLEAROTRON_CLAUDE_PATH naming something
  // wrong is a configuration that fails at run time, and setup is the cheap place to learn it.
  const absent = run(["--check"]);
  assert.equal(absent.code, 0, absent.out);
  assert.match(absent.out, /no `claude` on PATH/, absent.out);

  const wrong = run(["--check"], { CLEAROTRON_CLAUDE_PATH: "./claude" });
  assert.equal(wrong.code, 1, wrong.out);
  assert.match(wrong.out, /RELATIVE|not an executable file/, wrong.out);
});

test("--check refuses a CLEAROTRON_CLAUDE_PATH that is relative, naming the run-directory cwd trap", () => {
  // The trap is specific and unguessable: stage subprocesses are spawned with cwd set to the RUN
  // DIRECTORY, so a relative binary resolves against a directory that did not exist at setup time.
  const dir = mkdtempSync(join(tmpdir(), "onboard-bin-"));
  writeFileSync(join(dir, "claude"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  const r = run(["--check"], { CLEAROTRON_CLAUDE_PATH: "bin/../claude", HOME: dir });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /run directory/, r.out);
  rmSync(dir, { recursive: true, force: true });
});

test("--check names a register provider's missing credential, one variable at a time", () => {
  // euipo is the only provider needing two. Half a credential passed preflight once already.
  const r = run(["--check"], { CLEAROTRON_DATABASE: "euipo", EUIPO_CLIENT_ID: "an-id" });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /EUIPO_CLIENT_SECRET is required by euipo/, r.out);
  assert.ok(!r.out.includes("an-id"), "the check reports variable NAMES, never values");
});

test("--check refuses a provider id that names no adapter", () => {
  const r = run(["--check"], { CLEAROTRON_DATABASE: "definitely-not-a-provider" });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /names no adapter/, r.out);
});

test("--check reads a .env, and says which source each value came from", (t) => {
  // The loader contract is environment-wins. A value read from the wrong place is the whole bug class
  // here, so the report has to name the source rather than just the value.
  const home = mkdtempSync(join(tmpdir(), "onboard-home-"));
  const envPath = join(REPO, ".env");
  // SKIPPED, not failed, when the developer running this has actually used the wizard. Asserting here
  // would mean the tool's success breaks its own suite — `npm run setup` then `npm test` goes red. CI has
  // no .env, so the coverage is unchanged and the reason is stated rather than silently arranged around.
  if (existsSync(envPath)) { t.skip(`a real ${envPath} is present — this test would overwrite it`); return; }
  writeFileSync(envPath, "CLEAROTRON_DATABASE=uspto-local\nUSPTO_LOCAL_DB=/tmp/x.db\n", { mode: 0o600 });
  try {
    const r = run(["--check"], { HOME: home });
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /uspto-local .*\(\.env\)/, r.out);
    // and the environment beats it
    const r2 = run(["--check"], { HOME: home, CLEAROTRON_DATABASE: "euipo", EUIPO_CLIENT_ID: "a", EUIPO_CLIENT_SECRET: "b" });
    assert.match(r2.out, /euipo .*\(environment\)/, r2.out);
  } finally {
    rmSync(envPath, { force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test("the wizard refuses a non-terminal stdin instead of reading EOF as agreement", () => {
  // A wizard whose every question defaults to yes on a closed stdin is a wizard that writes a .env
  // nobody answered for.
  const r = run([]);
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /stdin is not a terminal/, r.out);
  // — the advice is `clearotron doctor` now, not `npm run setup -- --check`. Same assertion,
  // same intent: a wizard that refuses must name the thing that DOES work without a terminal. The
  // verb form is what an installed user can actually type — there is no scripts block out there.
  assert.match(r.out, /clearotron doctor/, r.out, "it points at the thing that does work non-interactively");
});

test("preflightCandidate checks the provider the CANDIDATE names, not the one the shell has set", async () => {
  // The sharp edge this wizard works around. preflightCredentials(env) takes a candidate env, but the
  // PROVIDER comes from a module-level const frozen at driver.config.mjs's first import from the REAL
  // process.env (REGISTER_PROVIDER declared in driver.config.mjs). Without the workaround, a candidate
  // naming euipo would
  // be checked against corsearch and pass for the wrong reason — which is exactly the shape of a wizard
  // that "validated" a credential it never looked at.
  //
  // The THIRD call is the one that matters most: driver.config.mjs's const is evaluated once per module
  // instance, so without a cache-busted import this works exactly once per process and answers with the
  // first call's provider forever after — a wrong answer that presents as a pass.
  const saved = { p: process.env.CLEAROTRON_DATABASE, c: process.env.CORSEARCH_SESSION_KEY };
  pinEnv(process.env, "CLEAROTRON_DATABASE", "corsearch");
  process.env.CORSEARCH_SESSION_KEY = "the-shell-has-this";
  try {
    // await, not a .then() chain returned out of try/finally: `finally` fires when the return VALUE is
    // produced, so a returned promise restores the environment before the awaited work has looked at it.
    const bad = await preflightCandidate({ CLEAROTRON_DATABASE: "euipo" });
    assert.equal(bad.ok, false, "a candidate naming euipo with no EUIPO credential must NOT pass");
    assert.match(bad.error, /EUIPO_CLIENT_ID/, bad.error);

    const second = await preflightCandidate({ CLEAROTRON_DATABASE: "uspto-local" });
    assert.equal(second.ok, false, "a SECOND call must re-read the candidate, not answer with the first call's provider");
    assert.match(second.error, /USPTO_LOCAL_DB/, second.error);

    const good = await preflightCandidate({ CLEAROTRON_DATABASE: "euipo", EUIPO_CLIENT_ID: "a", EUIPO_CLIENT_SECRET: "b" });
    assert.equal(good.ok, true, JSON.stringify(good));
    assert.equal(good.result.provider, "euipo");
    assert.deepEqual(good.result.checked, ["EUIPO_CLIENT_ID", "EUIPO_CLIENT_SECRET"]);
    // and the shell is put back exactly as it was
    assert.equal(process.env.CLEAROTRON_DATABASE, "corsearch");
  } finally {
    if (saved.p === undefined) pinEnv(process.env, "CLEAROTRON_DATABASE", undefined); else pinEnv(process.env, "CLEAROTRON_DATABASE", saved.p);
    if (saved.c === undefined) delete process.env.CORSEARCH_SESSION_KEY; else process.env.CORSEARCH_SESSION_KEY = saved.c;
  }
});

test("the EUIPO door the wizard validates through rejects a bad secret", async () => {
  // Offline, with fetch stubbed at the 401 the real endpoint returns. The wizard calls exactly this
  // pair, so a change that made getAccessToken swallow a failure would break here — which is the
  // failure that would otherwise turn "validated" into a lie.
  const { resolveConfig } = await import("../../providers/euipo/src/core.js");
  const { getAccessToken } = await import("../../providers/euipo/src/euipo-client.js");
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('{"error":"invalid_client"}', { status: 401, headers: { "content-type": "application/json" } });
  try {
    await assert.rejects(
      () => getAccessToken(resolveConfig({ clientId: "id", clientSecret: "wrong", environment: "production" }), { force: true }),
      /EUIPO token request failed: HTTP 401/,
    );
  } finally { globalThis.fetch = realFetch; }
});

test("EUIPO_ENVIRONMENT is pre-answered as production, and sandbox is not silently accepted as equivalent", () => {
  // sandbox and production are separate deployments holding different corpora. A sandbox credential
  // searches marks that do not exist, and reports that as a clean result.
  const euipo = PROVIDERS.find((p) => p.id === "euipo");
  assert.equal(euipo.extra.EUIPO_ENVIRONMENT, "production");
  assert.ok(euipo.signup.some((l) => /PRODUCTION/.test(l)), "the walkthrough says which one to ask for");
});

test("the ladder is ADR-0001's, and every free entry still says what it does NOT cover", () => {
  // THIS TEST USED TO ARGUE THE OTHER WAY, and the comment it argued with is why it is rewritten rather
  // than adjusted. It read: "The funnel this wizard serves starts at zero cost. Ordering the paid
  // vendors first would put a subscription between a reader and their first run." That is a policy
  // case, made in a test, against a question ADR-0001 had already answered — and it pinned the menu to
  // the superseded answer, so the documentation lane hit it and stopped rather than working around it.
  //
  // ADR-0001's reasoning, which is the record and not this file's to relitigate: the free tier's US
  // half is a 41.5 GB download and about nine hours of indexing before it answers one query, while
  // Signa issues a key self-serve and covers eleven offices. "Free" was doing the work of "reachable",
  // and for the US half it was not true.
  assert.deepEqual(PROVIDERS.map((p) => p.id),
    ["signa", "free-tier", "euipo", "uspto-local", "corsearch", "clarivate"],
    "recommended, then free, then sales-gated — ADR-0001 §Decision");
  assert.equal(PROVIDERS[0].id, "signa", "the recommended register is offered first");
  assert.ok(PROVIDERS.every((p) => p.covers), "every provider states its coverage");

  // THE LIMIT ASSERTION SURVIVES, re-aimed at the free entries wherever they now sit rather than at a
  // fixed slice. It is what stops a free option being sold without its limits, and re-aiming it at
  // `slice(0, 3)` would have quietly started asserting it of Signa — a paid global register that has no
  // such limit to state — while dropping the free entry that does. Driven off `cost`, so it follows the
  // ladder if the ladder moves again.
  const free = PROVIDERS.filter((p) => p.cost === "free");
  assert.ok(free.length >= 3, `only ${free.length} free provider(s) — the free tier has thinned and this arm now proves less than it reads`);
  for (const p of free) assert.match(p.covers, /nothing else|disclosed gap/, `${p.id} states its limit`);

  // The recommended entry earns its place by being ACTIONABLE, which is the half ADR-0001 said was
  // missing: it was described in seven words and the fact that it is self-serve appeared in no shipped
  // file. A reader who picks it must be told where the key comes from.
  assert.ok(PROVIDERS[0].signup?.length, "the recommended provider must carry a signup path — a key with no route to it is a dead end");
  assert.match(PROVIDERS[0].covers, /eleven offices|self-serve/, "…and say what it actually covers");
});

test("every provider this wizard offers is one the driver actually has an adapter for", () => {
  // The wizard's list and the driver's registry are two lists that can disagree, and the disagreement
  // is silent until a reader picks the row that does not exist. `uspto-local` was missing from
  // KNOWN_REGISTER_PROVIDERS for a whole release for exactly this reason.
  assert.deepEqual(
    PROVIDERS.map((p) => p.id).filter((id) => !KNOWN_REGISTER_PROVIDERS.includes(id)),
    [], "every offered provider is known to the driver",
  );
  assert.deepEqual(
    KNOWN_REGISTER_PROVIDERS.filter((id) => !PROVIDERS.some((p) => p.id === id)),
    [], "every driver provider is offered — a new adapter must not be invisible to setup",
  );
});

/**
 * Two environments agree — asserted WITHOUT EVER PUTTING A VALUE IN THE FAILURE MESSAGE.
 *
 * `assert.deepEqual` on two env objects prints both of them when it fails, and an env object is the one
 * shape in this repo whose values are secrets. On a PUBLIC repository a red arm's log is world-readable,
 * so the assertion that fires on the bad day must not be the one that publishes `PORTAL_SECRET`.
 *
 * The contract is unchanged and still exact — the same keys, and the same value under every key. Only
 * the REPORT is narrowed: a mismatch names the keys that differ and stops there, which is what a reader
 * needs in order to fix it anyway.
 */
function sameEnv(actual, expected, message) {
  assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort(), `${message} — different keys`);
  const differing = Object.keys(actual).filter((k) => actual[k] !== expected[k]).sort();
  assert.deepEqual(differing, [], `${message} — same keys, different values under: ${differing.join(", ")}`);
}

test("readEnvFile reports what the ENGINE'S loader would apply, not what a second parser thinks", () => {
  // The point of routing through shared/env-local.mjs rather than a regex: `--check` must agree
  // with the thing that actually reads the file. Two parsers that differ on quoting means the check
  // reports a value the run does not use.
  //
  // ── `home` IS PINNED, AND WITHOUT IT THIS ARM READ THE DEVELOPER'S OWN CREDENTIALS ────────────────
  //
  // The file in force resolves to `<home>/.config/clearotron/.env` and IGNORES `repoRoot`, so passing a
  // temporary `repoRoot` pinned nothing: `loadEnvLocal` defaulted `home` to `homedir()` and filled
  // `theirs` from the real machine. On a box where that file exists this arm failed — a three-key
  // fixture against somebody's actual settings — and printed both sides. env-local.mjs's own header says
  // the parameter exists for exactly this ("without it every arm about the file in force would be driven
  // against the developer's own ~/.config/clearotron/.env"); this was the one caller not passing it.
  // Found by another lane's suite run on their box, not by this arm going red on mine.
  const dir = mkdtempSync(join(tmpdir(), "onboard-env-"));
  const home = mkdtempSync(join(tmpdir(), "onboard-home-"));
  assert.deepEqual(readEnvFile(join(dir, ".env")), {}, "an absent file is empty, not an error");
  writeFileSync(join(dir, ".env"), '# a comment\nA=1\nB="two"\nC=three\n');
  const mine = readEnvFile(join(dir, ".env"));
  const theirs = {};
  loadEnvLocal({ env: theirs, repoRoot: dir, home, location: "project-root", note: () => {} });
  sameEnv(mine, theirs, "the check reads exactly what the loader applies");
  sameEnv(mine, { A: "1", B: "two", C: "three" }, "the shared parser's own answer changed");
  rmSync(dir, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

test("tracker issue 179 — an arm cannot reach the real home, and a failure names no value", () => {
  // TWO PLANTS, because the fix has two halves that fail in different ways.
  //
  // ONE — the pin. A file is planted in a home that is not this machine's. A reader still resolving
  // through `homedir()` cannot see it, so this drives the pin positively rather than asserting that
  // something did not happen.
  const home = mkdtempSync(join(tmpdir(), "onboard-realhome-"));
  const repoRoot = mkdtempSync(join(tmpdir(), "onboard-repo-"));
  mkdirSync(join(home, ".config", "clearotron"), { recursive: true });
  writeFileSync(join(home, ".config", "clearotron", ".env"), "PORTAL_SECRET=planted-not-a-real-secret\n");
  const seen = {};
  loadEnvLocal({ env: seen, repoRoot, home, note: () => {} });
  assert.deepEqual(Object.keys(seen), ["PORTAL_SECRET"],
    "the loader did not read the PINNED home, so pinning it proves nothing about which file an arm reads");

  // TWO — the reporter. Driven through a real mismatch: the message must name the KEY and never the
  // value. This is the property that matters on the day it goes red in a world-readable log.
  let msg = "";
  try { sameEnv({ PORTAL_SECRET: "aaa" }, { PORTAL_SECRET: "bbb" }, "control"); }
  catch (e) { msg = String(e.message); }
  assert.match(msg, /PORTAL_SECRET/, "a mismatch must name the key, or nobody can act on it");
  assert.doesNotMatch(msg, /aaa|bbb/, "the failure message carried the values — that is the leak itself");
  rmSync(home, { recursive: true, force: true });
  rmSync(repoRoot, { recursive: true, force: true });
});

test("reading a .env for the report does not APPLY it — --check must not configure the process it inspects", () => {
  const dir = mkdtempSync(join(tmpdir(), "onboard-env-"));
  const canary = "CLEAROTRON_ONBOARD_CANARY_NOT_A_REAL_VARIABLE";
  writeFileSync(join(dir, ".env"), `${canary}=set-by-the-file\n`);
  const seen = readEnvFile(join(dir, ".env"));
  assert.equal(seen[canary], "set-by-the-file", "it is read");
  assert.equal(process.env[canary], undefined, "and it is NOT applied to this process");
  rmSync(dir, { recursive: true, force: true });
});

test("resolveEngineBin finds a binary on PATH and flags a relative one", () => {
  const dir = mkdtempSync(join(tmpdir(), "onboard-bin-"));
  writeFileSync(join(dir, "codex"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  const savedPath = process.env.PATH;
  process.env.PATH = dir;
  try {
    // Driven on `codex` on purpose: the function was called resolveClaudeBin and its body never had
    // anything claude-specific in it. The name was the last place this file assumed one engine.
    const found = resolveEngineBin("codex");
    assert.equal(found.path, join(dir, "codex"));
    assert.equal(found.executable, true);
    assert.equal(found.relative, false);
    const rel = resolveEngineBin("./codex");
    assert.equal(rel.relative, true, "a relative path is flagged, whether or not it resolves from cwd");
  } finally { process.env.PATH = savedPath; rmSync(dir, { recursive: true, force: true }); }
});

// ── — the engine is CHOSEN, and setup proves it can run before it writes it ────────────────────
//
// The wizard offered no choice: it resolved `claude`, and five steps later, in the block about disk
// paths, assigned `CLEAROTRON_AI = "anthropic-agent"` unconditionally. The driver has shipped a second
// adapter the whole time, so a reader who runs codex had no supported path through setup. And neither
// layer checked the engine could complete a TURN — the wizard said so in prose and left it there.

test("#772 the engine menu is built from the driver's registry, plus one row that is not an engine", () => {
  const opts = engineOptions();
  assert.deepEqual(opts.filter((o) => o.id).map((o) => o.id), Object.keys(ENGINE_BINARIES),
    "every engine the driver ships is offered, and setup offers none it does not");
  assert.equal(opts[0].id, "anthropic-agent", "the production default is the Enter answer — setup must not change what a run does by accident");
  const none = opts.filter((o) => o.id === null);
  assert.equal(none.length, 1, "exactly one deliberate 'no engine' row");
  assert.match(none[0].label, /npm run example/, "…and it says what still works without one");
  for (const o of opts.filter((o) => o.id)) {
    assert.ok(o.label.includes(ENGINE_BINARIES[o.id].fallback), `${o.id} names the binary it needs`);
  }
});

test("#772 setup no longer assigns an engine behind the reader's back", () => {
  const src = readFileSync(join(REPO, "bin", "onboard.mjs"), "utf8");
  assert.ok(!/^\s*candidate\.CLEAROTRON_AI\s*=\s*"/m.test(src),
    "a hardcoded engine assignment is back — the choice must come from the menu");
  assert.match(src, /probeEngineTurn/, "and the engine is written only after a turn has proved it");
});

test("#772 --check reports the configured engine and checks THAT engine's binary variable", () => {
  // The old block read CLEAROTRON_CLAUDE_PATH unconditionally under the heading "Engine binary". On a codex
  // box it therefore reported the wrong variable and could pass for the wrong reason.
  const codex = run(["--check"], { CLEAROTRON_AI: "openai-agent" });
  assert.equal(codex.code, 0, codex.out);
  assert.match(codex.out, /openai-agent/, codex.out);
  assert.match(codex.out, /no `codex` on PATH/, codex.out);

  const wrongCodex = run(["--check"], { CLEAROTRON_AI: "openai-agent", CLEAROTRON_CODEX_PATH: "/nope/codex" });
  assert.equal(wrongCodex.code, 1, wrongCodex.out);
  assert.match(wrongCodex.out, /CLEAROTRON_CODEX_PATH/, wrongCodex.out);

  // …and a broken claude variable is NOT this box's problem when this box runs codex.
  const irrelevant = run(["--check"], { CLEAROTRON_AI: "openai-agent", CLEAROTRON_CLAUDE_PATH: "./broken" });
  assert.ok(!irrelevant.out.includes("CLEAROTRON_CLAUDE_PATH"),
    `a codex box must not be told to fix the claude variable\n${irrelevant.out}`);
});

test("#772 --check names an engine id the driver does not ship, and does not invent a second refusal", () => {
  const r = run(["--check"], { CLEAROTRON_AI: "silent-engine" });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /not an engine this driver ships/, r.out);
  assert.match(r.out, /anthropic-agent, openai-agent/, r.out);
  assert.match(r.out, /selectEngine/, "one definition of 'that is not an engine', and it is the registry's");
});

// The probe SPENDS. These two tests drive it against driver/test/mock-claude.mjs — the offline fixture
// the engine suite already spawns — so the assertion "it did/did not dial anything" is made from the
// mock's own call log rather than from a live CLI.
const MOCK_CLAUDE = join(REPO, "driver", "test", "mock-claude.mjs");

test("#772 --check does NOT spend a turn unless it is asked to", () => {
  const dir = mkdtempSync(join(tmpdir(), "onboard-probe-"));
  const log = join(dir, "calls.jsonl");
  try {
    const r = run(["--check"], { CLEAROTRON_CLAUDE_PATH: MOCK_CLAUDE, MOCK_CLAUDE_CALL_LOG: log });
    assert.equal(r.code, 0, r.out);
    assert.equal(existsSync(log), false, "a --check that dials a provider is a check that can fail for reasons that are not about this machine");
    assert.match(r.out, /--probe-engine/, "…and it says the check it did NOT make, rather than implying the engine is fine");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("#772 --check --probe-engine proves the engine with one turn, and still writes nothing", () => {
  const dir = mkdtempSync(join(tmpdir(), "onboard-probe-"));
  const log = join(dir, "calls.jsonl");
  const before = treeStamp(join(REPO, "bin"));
  const beforeEnv = existsSync(join(REPO, ".env"));
  try {
    const r = run(["--check", "--probe-engine"], { CLEAROTRON_CLAUDE_PATH: MOCK_CLAUDE, MOCK_CLAUDE_CALL_LOG: log });
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /completed a turn/, r.out);
    assert.equal(existsSync(log), true, "the engine really was invoked");
    const call = JSON.parse(readFileSync(log, "utf8").trim().split("\n")[0]);
    assert.deepEqual(call.argv.slice(5, 9), ["--model", "haiku", "--effort", "low"],
      "the cheapest rung of both tier tables, built by the adapter's own buildClaudeArgs");
    assert.deepEqual(treeStamp(join(REPO, "bin")), before, "bin/ untouched");
    assert.equal(existsSync(join(REPO, ".env")), beforeEnv, "no .env conjured");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("#772 the probe reports a signed-out engine as signed out, not as 'cannot run'", () => {
  // A binary that runs, says nothing and exits nonzero — the startup-class shape. It passes every
  // filesystem check preflightEngineBinary makes, which is the entire reason this probe exists.
  const dir = mkdtempSync(join(tmpdir(), "onboard-mute-"));
  const mute = join(dir, "claude");
  writeFileSync(mute, "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  try {
    const r = run(["--check", "--probe-engine"], { CLEAROTRON_CLAUDE_PATH: mute });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /exited before it produced anything/, r.out);
    assert.match(r.out, /signed-out shape/, "it names the mode rather than shrugging at 'cannot run'");
    assert.match(r.out, /run `claude` once/, "…and the next thing the reader does");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── item 1 — the 42 GB download is a decision, and the wizard has to take it as one ─────────
//
// Item 2 put the real numbers in the wizard's warning text. It created no gate, because there was
// nothing to gate: the wizard printed `npm run sync:uspto` and walked away. Item 1 gives it a build it
// can start, which is what makes consent mean anything — and immediately creates the failure worth
// testing: an adopter tapping Enter through a wizard, starting a 42 GB pull and a six-hour build
// having read nothing about either.
//
// So the assertions below are about the SHAPE OF THE ASK, not about the download. What must hold:
// the offer only appears when there is genuinely something to build; the question names the size; and
// only an explicit "yes" is consent — never the default, never Enter, never "y".

test("#690 the build is offered only when there is actually an index missing", () => {
  assert.equal(usptoSyncPlan({ dbPath: "/tmp/us.db", exists: true, freeBytes: 9e11 }).offer, false,
    "an index that exists is not rebuilt behind the reader's back");
  assert.equal(usptoSyncPlan({ dbPath: "", exists: false, freeBytes: 9e11 }).offer, false,
    "no path means nothing to build — not a prompt with nowhere to put it");
  assert.equal(usptoSyncPlan({ dbPath: "/tmp/us.db", exists: false, freeBytes: 9e11 }).offer, true);
});

test("#690 the consent question NAMES the download size and the hours", () => {
  const plan = usptoSyncPlan({ dbPath: "/tmp/us.db", exists: false, freeBytes: 9e11 });
  const q = usptoConsentPrompt(plan);
  assert.match(q, new RegExp(`${USPTO_ARCHIVE_GB} ?GB`),
    "the number is the point — a prompt that has drifted away from it is the defect");
  assert.match(q, new RegExp(`${usptoBuildHours()} hours`));
  assert.match(q, /background/);
  assert.match(q, /Type "yes"/, "and it tells the reader what a yes looks like, since y will not do");
  // The prompt's numbers come from the same constants the warning text quotes, so they cannot drift
  // apart into two different honest-looking figures.
  assert.equal(plan.downloadGB, USPTO_ARCHIVE_GB);
  assert.equal(plan.hours, usptoBuildHours());
  assert.equal(usptoBuildHours(), Math.round((USPTO_ARCHIVE_GB / USPTO_INGEST_GB_PER_HOUR) * 10) / 10,
    "the hours are the archive size over the measured throughput, never a remembered figure");
});

test("#690 only an explicit yes starts it — Enter is not an answer, and neither is y", () => {
  assert.equal(isExplicitYes("yes"), true);
  assert.equal(isExplicitYes("YES"), true);
  assert.equal(isExplicitYes(" yes "), true);
  for (const no of ["", " ", "y", "Y", "yeah", "ok", "n", undefined, null, "no"]) {
    assert.equal(isExplicitYes(no), false,
      `${JSON.stringify(no)} must NOT start a 42 GB download — this is the tapped-through-the-wizard case`);
  }
});

test("#690 an unmeasurable disk is reported, never read as room", () => {
  const unknown = usptoSyncPlan({ dbPath: "/tmp/us.db", exists: false, freeBytes: null });
  assert.equal(unknown.freeGB, null);
  assert.match(unknown.roomWarning, /could not be measured/);
  assert.equal(unknown.offer, true, "…and it still offers: the sync script runs the real check before it downloads");
  const tight = usptoSyncPlan({ dbPath: "/tmp/us.db", exists: false, freeBytes: 10e9 });
  assert.match(tight.roomWarning, /only 10\.0 GB free/);
  assert.match(tight.roomWarning, /partial index/, "the warning says what a short build leaves behind");
  assert.equal(usptoSyncPlan({ dbPath: "/tmp/us.db", exists: false, freeBytes: 9e11 }).roomWarning, null);
});

test("#690 the background build is detached, logged, and not waited on", () => {
  const spec = backgroundSyncSpec({ repo: "/srv/dev-instance/repo", dbPath: "/data/us.db", logFd: 7 });
  assert.equal(spec.command, process.execPath);
  assert.deepEqual(spec.args, ["/srv/dev-instance/repo/bin/uspto-sync.mjs", "--db", "/data/us.db"],
    "the index path is passed explicitly — the sync script's own default is not what the reader chose");
  assert.equal(spec.options.detached, true);
  assert.deepEqual(spec.options.stdio, ["ignore", 7, 7],
    "stdout and stderr both go to the log; a six-hour build writing into a closed terminal is lost progress");
});

test("#690 the wizard still points at the same script the docs do", () => {
  const src = readFileSync(join(REPO, "bin", "onboard.mjs"), "utf8");
  const spec = backgroundSyncSpec({ repo: "/r", dbPath: "/d.db", logFd: 1 });
  assert.ok(spec.args[0].endsWith("bin/uspto-sync.mjs"));
  assert.match(src, /npm run sync:uspto/,
    "the manual instruction stays — declining the offer must leave the reader with the command");
  const install = readFileSync(join(REPO, "INSTALL.md"), "utf8");
  assert.match(install, new RegExp(`${USPTO_ARCHIVE_GB} ?GB`),
    "INSTALL.md and the wizard quote the same download size");
});

// The half that spawns. Driven with the io and the spawn injected, because the branch that matters is
// the one where NOTHING must happen — and a spawn that only a terminal can reach is asserted nowhere.

const recorder = () => {
  const lines = [];
  const io = { ask: async () => "", say: (s) => lines.push(s), ok: (s) => lines.push(`OK ${s}`),
    info: (s) => lines.push(`. ${s}`), warn: (s) => lines.push(`! ${s}`), problem: (s) => lines.push(`X ${s}`) };
  return { io, lines, text: () => lines.join("\n") };
};
const fakeSpawn = (calls) => (command, args, options) => {
  calls.push({ command, args, options });
  return { pid: 4242, unref() { this.unrefed = true; } };
};
const ROOMY = async () => ({ bavail: 9e11, bsize: 1 });

test("#690 pressing Enter at the offer starts NOTHING", async () => {
  const r = recorder();
  const calls = [];
  const out = await offerUsptoSync("/tmp/definitely-not-here/us.db",
    { ...r.io, ask: async () => "" }, { spawn: fakeSpawn(calls), statfs: ROOMY });
  assert.equal(out.started, false);
  assert.equal(out.reason, "declined");
  assert.equal(calls.length, 0, "an empty answer must not spawn a 42 GB download");
  assert.match(r.text(), /Not started/);
  // — `clearotron sync --db`, and note the `--` is GONE on purpose: npm needed it to stop
  // eating the flags, the dispatcher forwards argv verbatim, so a `--` here would reach the target
  // as a literal argument. Seven documentation sites carried the same stale separator.
  assert.match(r.text(), /clearotron sync --db/, "…and the reader still leaves with the command");
});

test("#690 'y' does not start it either — the affirmative is the whole gate", async () => {
  for (const answer of ["y", "Y", "sure", "ok", "\n"]) {
    const calls = [];
    const out = await offerUsptoSync("/tmp/definitely-not-here/us.db",
      { ...recorder().io, ask: async () => answer }, { spawn: fakeSpawn(calls), statfs: ROOMY });
    assert.equal(out.started, false, `${JSON.stringify(answer)} must not start it`);
    assert.equal(calls.length, 0);
  }
});

test("#690 an explicit yes spawns the build detached, and says where to watch it", async () => {
  const r = recorder();
  const calls = [];
  const dir = mkdtempSync(join(tmpdir(), "onboard-sync-"));
  try {
    const db = join(dir, "us.db");
    const out = await offerUsptoSync(db, { ...r.io, ask: async () => "yes" },
      { spawn: fakeSpawn(calls), statfs: ROOMY });
    assert.equal(out.started, true);
    assert.equal(out.pid, 4242);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].args.slice(1), ["--db", db]);
    assert.equal(calls[0].options.detached, true);
    assert.equal(out.logPath, join(dir, "uspto-sync.log"));
    assert.ok(existsSync(out.logPath), "the log is opened before the child writes to it, not after");
    assert.match(r.text(), /tail -f/, "the reader is told how to watch a six-hour job");
    assert.match(r.text(), /DISCLOSED as a deferred gap/, "…and what the engine does meanwhile");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("#690 a spawn that fails is reported, not swallowed into a false 'building…'", async () => {
  const r = recorder();
  const dir = mkdtempSync(join(tmpdir(), "onboard-sync-"));
  try {
    const out = await offerUsptoSync(join(dir, "us.db"), { ...r.io, ask: async () => "yes" },
      { spawn: () => { throw new Error("ENOENT"); }, statfs: ROOMY });
    assert.equal(out.started, false);
    assert.equal(out.reason, "spawn-failed");
    assert.match(r.text(), /X could not start the build/);
    assert.match(r.text(), /Start it by hand/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("#690 an index that already exists is never rebuilt behind the reader's back", async () => {
  const dir = mkdtempSync(join(tmpdir(), "onboard-sync-"));
  try {
    const db = join(dir, "us.db");
    writeFileSync(db, "not really a database");
    const calls = [];
    const out = await offerUsptoSync(db, { ...recorder().io, ask: async () => "yes" },
      { spawn: fakeSpawn(calls), statfs: ROOMY });
    assert.equal(out.started, false);
    assert.equal(calls.length, 0, "no prompt, no spawn — there is nothing to build");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("#690 a disk that cannot be measured still offers, and says the measurement failed", async () => {
  const r = recorder();
  await offerUsptoSync("/tmp/definitely-not-here/us.db",
    { ...r.io, ask: async (q) => { r.lines.push(`? ${q}`); return ""; } },
    { spawn: () => { throw new Error("must not be reached"); },
      statfs: async () => { throw new Error("statfs unavailable"); } });
  assert.match(r.text(), /could not be measured/);
  assert.match(r.text(), /Start it now\?/, "the offer is still made — the sync script runs the real check");
});

// ── — what `--check` says about a default is DERIVED from the getters, never quoted ─────────────
//
// removed `CLEAROTRON_REPORTS_DIR`'s default outright and moved `CLEAROTRON_WORK_DIR`'s off the
// integrator platform's folder. bin/onboard.mjs went on describing both of the OLD ones, and nothing
// went red — a quoted default has nothing to disagree with. So `npm run setup -- --check`, the one
// command whose whole job is to tell a reader what this machine is configured for, confidently named a
// pool default that no longer exists and put run directories under `$HOME/.openclaw`: the exact sentence
// was raised to delete. A first-time reader provisions those paths and then meets a refusal that
// contradicts what setup just told them.
//
// These arms hold the PRINTED TEXT against the getters themselves, so the two can only move together.

/** Run `fn` with the named vars set exactly as given (undefined = deleted), then put the env back. */
function withEnv(vars, fn) {
  const saved = Object.fromEntries(Object.keys(vars).flatMap((k) => [k].map((s) => [s, process.env[s]])));
  try {
    for (const [k, v] of Object.entries(vars)) {
      pinEnv(process.env, k, v);
    }
    return fn();
  } finally {
    for (const [s, v] of Object.entries(saved)) { if (v === undefined) delete process.env[s]; else process.env[s] = v; }
  }
}

test("#827 --check prints the pool refusal and the workspace default the CONFIG produces, not a copy", (t) => {
  // `effective()` reads the repo .env as well as the environment, so a developer who has really
  // configured this checkout would take the "is set" branch and never reach the text under test.
  if (existsSync(join(REPO, ".env"))) { t.skip(`a real ${join(REPO, ".env")} is present — it would mask the unset branch`); return; }
  const home = mkdtempSync(join(tmpdir(), "onboard-827-"));
  try {
    // `run()` REPLACES the environment, so both variables are genuinely unset in the child.
    const r = run(["--check"], { HOME: home });
    assert.equal(r.code, 0, r.out);

    // ── the pool: no default, and the refusal names the variable ──────────────────────────────────
    // Taken from the getter here, so this expectation cannot be a second hand-written copy of it.
    const refusal = withEnv({ CLEAROTRON_REPORTS_DIR: undefined }, () => {
      try { config.poolRoot; return null; } catch (e) { return String(e.message); }
    });
    assert.ok(refusal,
      "config.poolRoot no longer refuses an unset pool. #774's premise has changed, not this test — "
      + "re-derive both arms against whatever the getter does now rather than deleting them.");
    assert.ok(r.out.includes(refusal),
      `--check must print the driver's OWN refusal, so the reader meets the same words here and on their\n`
      + `first run. Neither paraphrase it nor slice it.\n  want: ${refusal}\n  got:\n${r.out}`);

    // ── the workspace root: the getter's default, under the reader's OWN home ─────────────────────
    // Computed under the same HOME the child ran with — `home()` in driver.config.mjs resolves through
    // homedir(), which honours HOME on POSIX. Pinning the literal would just move the drift here.
    const wsDefault = withEnv(
      { HOME: home, OPENCLAW_HOME: undefined, CLEAROTRON_WORK_DIR: undefined },
      () => config.workspaceRoot);
    assert.ok(r.out.includes(wsDefault),
      `--check must name the workspace root the driver would really use (${wsDefault}), which is under\n`
      + `the reader's own home.\n  got:\n${r.out}`);
    assert.doesNotMatch(r.out, /\.openclaw/,
      "--check names the integrator platform's folder again — README says in bold the engine does not "
      + "require it, and #774 moved this default off it precisely so setup would stop saying so");
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("#827 bin/onboard.mjs asserts no data-plane default of its own", () => {
  // The CLAIM, not the string. The refusal legitimately NAMES /srv/trademark-archive as the danger the
  // removed default carried, and bin/example.mjs's guard list must keep naming it too — forbidding the
  // literal would fail against the correct implementation and invite the next reader to "fix" it by
  // deleting the derivation. What may not come back is a sentence stating it IS the default.
  const src = readFileSync(join(REPO, "bin", "onboard.mjs"), "utf8");
  for (const claim of [
    /default is\s+\/srv\/trademark-archive/i,
    /defaults? to\s+\/srv\/trademark-archive/i,
    /default is\s+\$HOME\/\.openclaw/i,
    /defaults? to\s+\$HOME\/\.openclaw/i,
    /default is\s+~\/\.openclaw/i,
  ]) {
    assert.doesNotMatch(src, claim,
      `bin/onboard.mjs states a data-plane default in its own words. It has no way to notice when `
      + `driver.config.mjs moves, which is exactly how #827 happened — ask the getter instead `
      + `(see defaultWith()).`);
  }
  assert.match(src, /defaultWith\(/,
    "the derivation helper is gone — the printed text is quoting something again");
});

test("#1149 item 1: the hermetic PATH cannot resolve an ambient engine — the property, not the intent", () => {
  // The helper's PATH is hermetic so a developer's own signed-in engine cannot make this suite pass, and
  // "--check separates an ABSENCE from a MISCONFIGURATION" depends on it absolutely: it asserts what the
  // wizard says when there is NO engine on PATH. That test cannot detect its own premise being false —
  // it just fails, with a message about the wizard, on machines where the premise broke.
  //
  // It broke by pinning node with `dirname(process.execPath)`, which on a devcontainer, a Codex sandbox,
  // Claude Code on the web, or any npm-global prefix is also where `claude` lives. So the premise is
  // asserted here, directly, against the same PATH `run()` builds.
  const parts = [NODE_BIN, "/usr/bin", "/bin"];
  for (const engine of Object.values(ENGINE_BINARIES).map((e) => e.fallback)) {
    for (const dir of parts) {
      assert.ok(!existsSync(join(dir, engine)),
        `the hermetic PATH resolves \`${engine}\` at ${join(dir, engine)} — every absence test in this file `
        + `is now asserting against a machine that HAS an engine, and will fail for reasons that have `
        + `nothing to do with the wizard. Keep NODE_BIN a directory holding only a node symlink.`);
    }
  }
  assert.deepEqual(readdirSync(NODE_BIN), ["node"], "NODE_BIN grew an entry — it must hold node and nothing else");
});

// ── item 5 — the wizard can produce a working API-KEY install ──────────────────────────────────
//
// THE DEFECT, in the shape it shipped: `npm run setup` never asked subscription-or-API-key. The default
// mode is `subscription`, `anthropic-agent.mjs` deletes ANTHROPIC_API_KEY from the stage subprocess under
// any other mode, and so a reader who did the natural thing — export a key, run the wizard — got an
// engine probe against a signed-out CLI, a failure that named the binary, and no route to the lane they
// were paying for. `auth.mjs` already refused the reverse footgun, so only this direction was open.
//
// These arms hold the half a machine can hold offline: that the wizard and the resolver agree about
// WHICH TWO VARIABLES a billing lane is made of. Driving a real turn is the issue's evidence, not CI's.
test("#1149-5 every engine declares the two variables its billing lane is made of", () => {
  for (const [id, spec] of Object.entries(ENGINE_BINARIES)) {
    assert.ok(spec.authEnv, `${id} declares no authEnv — the wizard cannot ask a question it has no variable for`);
    assert.ok(spec.apiKeyEnv, `${id} declares no apiKeyEnv`);
    assert.ok(spec.subscriptionHow, `${id} does not say how its subscription is established — the wizard would offer a lane it cannot explain`);
  }
});

test("#1149-5 the engine table's key name is the one auth.mjs actually refuses on — driven, not compared", async () => {
  // THE TRAP THIS EXISTS FOR, and it is live: openai's key is CODEX_API_KEY, while `openai-agent.mjs`
  // deliberately strips OPENAI_API_KEY for a clean subscription bill. A wizard that adopted the obvious
  // name would write a .env whose api-key mode `auth.mjs` refuses — the same defect item 5 removes,
  // wearing the other engine, and a table compared against literals in this file would not see it.
  //
  // So the table is DRIVEN THROUGH the resolver rather than compared to it: set the declared mode with
  // no key and read which name comes back in the refusal. Change auth.mjs's key and this reddens.
  const { resolveAuthMode } = await import("../engine/auth.mjs");
  let checked = 0;
  for (const [id, spec] of Object.entries(ENGINE_BINARIES)) {
    // Detect "is this engine policied" on an EMPTY env, never on the api-key-without-key env below —
    // that one is built to throw, so asking it the question raises the exception instead of answering.
    if (resolveAuthMode({ engineName: id, env: {} }).mode === "unknown") continue;
    const bare = { [spec.authEnv]: "api-key" };
    checked += 1;
    assert.throws(() => resolveAuthMode({ engineName: id, env: bare }),
      new RegExp(spec.apiKeyEnv),
      `${id}: auth.mjs refuses api-key mode by a name other than the ${spec.apiKeyEnv} the wizard adopts`);
    // …and the positive, so this cannot pass by everything throwing.
    const good = resolveAuthMode({ engineName: id, env: { [spec.authEnv]: "api-key", [spec.apiKeyEnv]: "k" } });
    assert.equal(good.mode, "api-key", `${id}: the declared authEnv does not select api-key mode`);
    assert.equal(good.apiBilled, true, `${id}: api-key mode is not marked api-billed`);
    const sub = resolveAuthMode({ engineName: id, env: { [spec.apiKeyEnv]: "k" } });
    assert.equal(sub.mode, "subscription", `${id}: a key with no mode set must NOT silently select api billing`);
  }
  assert.ok(checked >= 2, `only ${checked} engine(s) exercised — both adapters declare auth modes, so this arm has gone blind`);
});

test("#1149-5 the wizard's register ladder and the preflight refusal print the SAME order", () => {
  // Item 11 point 5. KNOWN_REGISTER_PROVIDERS is what the run-door refusal lists, so a reader who hits
  // it is shown an order; if that disagrees with the menu they just used, one of the two is a second
  // opinion about which register to buy, and neither says which.
  assert.deepEqual(KNOWN_REGISTER_PROVIDERS, PROVIDERS.map((p) => p.id),
    "the refusal's ladder and the wizard's ladder have diverged");
});

// ── — `--check` NAMES THE MODE, and demo is a state rather than a list of absences ───────────
//
// The engine prerequisite is the one README calls "the prerequisite people miss", and what a reader met
// on a clean box was "install it for a real run" and "a real run will refuse" — both of which describe
// only what they do not have. `npm start` seeds an example report into the pool, so a reader with no
// credentials at all gets a portal with a finished clearance in it. Nothing said so.
//
// `run()` above is hermetic by construction — NODE_BIN + /usr/bin + /bin, deliberately NOT node's own
// directory, because on a devcontainer or an npm-global prefix that directory also holds `claude` and
// this arm would find an engine on the population INSTALL.md is written for.

test("#1720 --check names the MODE on a machine with no engine, and does not send the reader to probe nothing", () => {
  const home = mkdtempSync(join(tmpdir(), "onboard-mode-"));
  const r = run(["--check"], { HOME: home });
  assert.equal(r.code, 0, r.out);

  assert.match(r.out, /MODE: demo/, `--check no longer names the mode:\n${r.out}`);
  assert.match(r.out, /everything works except starting a NEW search/,
    "the demo line stopped saying what DOES work, which is the half a reader is deciding on");
  assert.match(r.out, /To leave demo: install .+ CLI/, "nothing tells the reader how to leave demo mode");

  // Advice that cannot pay off is noise. With nothing to spawn, --probe-engine answers "there is no
  // usable binary to probe" — so offering it here spends a reader's round trip to be told what they
  // were just told.
  assert.match(r.out, /nothing to probe in demo mode/, `demo mode is still advertising the probe:\n${r.out}`);
  assert.doesNotMatch(r.out, /add --probe-engine to spend one cheap turn/,
    "the engine-present advice is being printed on a box with no engine");

  // And the absence framing this issue was filed about is gone from the line that carried it.
  assert.doesNotMatch(r.out, /install it for a real run/,
    "the old absence framing is back — it now duplicates the MODE line, in worse words");

  rmSync(home, { recursive: true, force: true });
});

// ── — THE CLOSING SCREEN, FIXED IN CODE AND PROTECTED BY NOTHING ──────────────────────────────
//
// made the wizard's successful-completion screen lead with `clearotron start` — the product —
// instead of `npm run example` and a raw `node driver/pipeline.mjs`. Measured at a06bbb67 by REVERTING
// that line rather than by reading the tests: this file stayed 41/0, and all six files that read
// bin/onboard.mjs as text stayed 132/0. The string appeared in no test in the repository.
//
// IT READS THE SOURCE, AND THAT IS A STATED LIMIT rather than a preference. The screen prints only
// after a successful interactive configuration, and the wizard refuses a non-terminal stdin
// (bin/onboard.mjs, `if (!input.isTTY)`) — so reaching it live needs a PTY plus scripted answers
// which buys a brittle arm and a flake in a suite that has already paid for one. What is asserted is
// the `say()` argument itself, not a copy of the string kept here.
//
// THE EXPECTATION IS DERIVED, NOT TYPED. The verb comes from the dispatcher's own table, so renaming
// `start` reds this arm too: the screen advertising a verb and the table defining it cannot drift apart
// silently, which is exactly the complaint made about hardcoded tables.

const closingScreen = () => {
  const src = readFileSync(ONBOARD, "utf8");
  // RE-POINTED, NOT DELETED. The heading was "Three commands from here" until the
  // owner's point 10 cut the screen to one command with what to expect — three equally-weighted options
  // is the decision handed back to a reader who has just answered a page of questions. The arms below
  // are unchanged in what they assert, because what they assert did not change: the FIRST command
  // offered must still be the product. This anchor moving is exactly the case the assertion beneath it
  // was written to catch, and it caught it.
  const i = src.indexOf("Start here:");
  assert.ok(i > 0,
    "the closing screen's heading is gone from bin/onboard.mjs, so every assertion below is aimed at "
    + "nothing. Re-point this arm at the new heading rather than deleting it.");
  const rest = src.slice(i);
  const end = rest.indexOf("} catch");
  return rest.slice(0, end > 0 ? end : 1500);
};

/**
 * Every `say(…)` string in the closing block, in the order the wizard prints them.
 *
 * BOTH QUOTE FORMS, and `${invocationPrefix}` stripped. The screen used to hold plain
 * double-quoted literals; the commands now interpolate the invocation prefix, because a reader who
 * typed a bare `clearotron` must be told `clearotron start` and a reader who came via npx must be told
 * `npx clearotron start` — one rule, resolved at print time.
 *
 * Matching only `say("…")` made this extractor return NOTHING the moment those three lines became
 * template literals, and an empty corpus makes every assertion below vacuous. The `nonEmpty()` wrapper
 * caught exactly that and refused to pass — which is why this comment exists rather than a silent green.
 *
 * The prefix is stripped rather than matched because these arms assert WHICH command leads the screen,
 * not how the reader invoked us. `npx ` and `` are both correct answers to the second question.
 */
const advertised = (block) =>
  [...block.matchAll(/say\(\s*(?:"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`)\s*\)/g)]
    .map((m) => (m[1] ?? m[2] ?? "")
      .replace(/\$\{\s*invocationPrefix\(\)\s*\}/g, "")
      .replace(/\\n/g, " ").trim())
    .filter(Boolean);

const commandsOffered = (block) =>
  advertised(block).filter((l) => /^(clearotron|npm|node)\s/.test(l));

test("#1770 the wizard's closing screen leads with the PRODUCT's own start verb", () => {
  const lines = nonEmpty(advertised(closingScreen()), "say() literals in the wizard's closing screen");
  assert.ok(Object.hasOwn(VERBS, "start"),
    "the dispatcher's `start` verb was renamed or removed, so this arm asserts a command nobody can "
    + "type. The screen and this expectation move together or the advice goes stale silently.");

  const commands = nonEmpty(commandsOffered(closingScreen()), "commands advertised by the closing screen");
  assert.equal(commands[0], "clearotron start",
    "the FIRST thing offered after a successful configuration is not the product. #1719's whole "
    + "observation was that a reader who has just finished configuring this gets pointed at the two "
    + `commands that are not it. Advertised: ${JSON.stringify(commands.slice(0, 3))}; all lines: `
    + `${JSON.stringify(lines.slice(0, 4))}`);
});

test("#1770 the pre-#1719 advice cannot come back as the closing screen's first command", () => {
  // The plant this is written against: reverting the closing screen's FIRST advertised command — the
  // `say("    clearotron start")` under bin/onboard.mjs's  comment — to `npm run example` must red.
  //
  // — CITED BY SYMBOL RATHER THAN BY LINE, because the line moved. This carried a line number into
  // bin/onboard.mjs, and that number went stale the moment the install surface above it grew — reddening
  // the citation gate for a reason with nothing to do with this arm. CONTRIBUTING's rule is exactly this:
  // cite the symbol, not the line. A number survives no move; the command it names survives every one.
  //
  // (The dead number is deliberately not repeated here. Writing it even to explain it would leave a
  // citation the gate reads as live — which is what happened on the first attempt at this comment.)
  // Stated separately because the arm above could be satisfied by a screen that offers the product
  // somewhere further down, which is not what the issue is about.
  const commands = nonEmpty(commandsOffered(closingScreen()), "commands advertised by the closing screen");
  assert.notEqual(commands[0], "npm run example",
    "the closing screen leads with `npm run example` again. From an INSTALLED package there is no "
    + "package.json and no scripts block, so that advice is not merely misordered out there — it is "
    + "unrunnable.");
  assert.doesNotMatch(commands[0], /^node\s+driver\//,
    "the closing screen leads with a raw driver invocation — the other command #1719 moved off the top");
});

// ── — THE WIZARD BOOTSTRAPS THE ENGINE INSTEAD OF STOPPING AT A SENTENCE ──────────────────────
//
// The install command lives in ENGINE_BINARIES, not in the wizard, for the same reason `authEnv` does:
// that table is what the wizard and the run-door preflight both read, and an engine described in two
// places drifts into two answers. These arms assert the table's shape and the wizard's use of it; the
// interactive flow itself is not driven here — it needs a TTY, and the file refuses without one.
test("#1720 every engine in the table carries an install command, and it is one a reader can read", () => {
  const ids = Object.keys(ENGINE_BINARIES);
  assert.ok(ids.length >= 2, "fixture precondition: this repo ships two adapters, and both are offered");
  for (const id of ids) {
    const eng = ENGINE_BINARIES[id];
    assert.equal(typeof eng.install, "string",
      `${id} has no install command, so the wizard can only tell someone to go and find one`);
    assert.ok(eng.install.trim().length > 0, `${id}'s install command is empty`);
    // NO PIPED REMOTE SCRIPT. A command this product runs on someone's box has to be one they can read
    // in full before answering; `curl … | bash` is exactly the shape that cannot be.
    assert.doesNotMatch(eng.install, /\|\s*(ba)?sh\b/,
      `${id}'s install command pipes a remote script into a shell — the wizard shows the command and `
      + "runs it as the user, so it must be readable before it runs");
    assert.doesNotMatch(eng.install, /[;&]{1,2}|`|\$\(/,
      `${id}'s install command carries shell metacharacters, and the wizard spawns it WITHOUT a shell — `
      + "it would be passed to the binary as literal arguments");
    // It is spawned as argv, so the first word has to be the program.
    const [cmd] = eng.install.split(" ");
    assert.match(cmd, /^[a-z][a-z0-9-]*$/, `${id}'s install command does not start with a plain program name`);
  }
});

test("#1720 the wizard offers the install, and does NOT take the installer's exit code as proof", () => {
  // A SOURCE-SHAPE ARM over the interactive branch, and it says so: the flow needs a TTY, so what can
  // be asserted here is that the wiring exists and that the two rules the issue is explicit about are
  // in it — the command comes from the table, and success is decided by resolution and then a turn.
  const src = readFileSync(join(REPO, "bin/onboard.mjs"), "utf8");

  assert.match(src, /confirm\([^)]*eng\.install/,
    "the wizard never offers to run the install command, so a reader with no engine still ends at a "
    + "sentence — the gap #1720 measured");
  assert.match(src, /spawnSync\(cmd, args/,
    "the install is not spawned as argv — a shell here would make the table's contents shell input");

  // The rule, asserted as an ORDER: the binary is re-resolved AFTER the spawn, and the probe still
  // gates what gets written. A wizard that wrote an engine on a zero exit code would be claiming a
  // working engine from a package manager's opinion.
  const spawnAt = src.indexOf("spawnSync(cmd, args");
  assert.ok(spawnAt > 0, "no install spawn to reason about — this arm has lost its subject");
  // WITHIN THE INSTALL BLOCK, not "anywhere after it". Searching the rest of the file finds the
  // give-me-a-path branch's own resolve and passes with the re-resolve deleted — planted exactly that
  // and this arm went green, so the window is bounded to the block that follows the spawn.
  const afterSpawn = src.slice(spawnAt, spawnAt + 900);
  assert.match(afterSpawn, /bin = resolveEngineBin\(/,
    "nothing re-resolves the binary inside the install block, so the wizard cannot tell an install "
    + "that landed on PATH from one that did not — and the only thing left to believe is the exit code");
  assert.match(src.slice(spawnAt, spawnAt + 1200), /exit code is not what settles this|not the answer/i,
    "the exit-code rule is not stated where the exit code is read, which is where the next reader "
    + "will be tempted to trust it");

  // And the sign-in hand-off, which is the half nobody here can perform for the user.
  assert.match(src, /eng\.signIn/,
    "the probe failure path does not name the engine's own sign-in command, so a signed-out CLI ends "
    + "at a description of the problem rather than the one step that fixes it");
});

// ── — the synopsis is DERIVED, and this is what makes that true ────────────────
test("--help prints every command the header documents", async () => {
  // The block used to be a hand-counted slice, `slice(1, 7)`, whose own comment said it had been
  // "widened by one when --probe-engine was added". It had not been: the slice ended at line 7 and that
  // flag sits on line 8, so `--help` never mentioned the ONE credential proof this tool already had.
  // Nothing asserted it, so nothing said so — for as long as the flag has existed.
  // tracker issues 1861/1882 — one reader for every verb that prints a synopsis; it moved to shared/.
  const { usageBlock } = await import("../../shared/usage-block.mjs");
  const src = readFileSync(ONBOARD, "utf8");
  const block = usageBlock(src);

  // Every documented invocation in the header must survive into what a reader is shown.
  const documented = src.split("\n")
    .slice(0, 40)
    .filter((l) => /^\/\/\s{2,}npx clearotron/.test(l))
    .map((l) => l.replace(/^\/\/\s+/, "").trim());
  assert.ok(documented.length >= 3, `only ${documented.length} documented commands found — the header shape moved`);
  for (const cmd of documented) {
    assert.ok(block.includes(cmd),
      `\`${cmd}\` is documented in the header and does NOT reach --help. That is the exact defect this `
      + "arm exists for: a flag nobody can discover is a flag nobody uses, and the truncation is silent.");
  }
  // And it must STOP: the synopsis is not the design-rules essay that follows it.
  assert.ok(!block.includes("DESIGN RULES"),
    "the block ran past the synopsis into the file's design notes — a reader asking for usage got an essay");
});

// ── — THE FRESHNESS CHECK STAYS HONEST ─────────────────────────────────────────
//
// The arms above declare this suite's checkout pinned so their verdicts stop depending on how busy the
// merge queue was. That is only safe if the declaration has to be ASKED FOR and the check still fails a
// real deployment without it. Both halves are here, because the half that matters is the second: a fix
// that bought green by blinding the check would delete the guard was raised for.
test("#1912 a deployment behind its upstream still FAILS — the pinned answer must be asked for", () => {
  const behind = deploymentCurrency({ run: (args) => {
    const a = args.join(" ");
    if (a.startsWith("rev-parse --is-inside-work-tree")) return { status: 0, stdout: "true\n", stderr: "" };
    if (a.includes("@{u}") && a.includes("abbrev-ref")) return { status: 0, stdout: "origin/main\n", stderr: "" };
    if (a.startsWith("rev-list --count")) return { status: 0, stdout: "3\n", stderr: "" };
    return { status: 1, stdout: "", stderr: "" };
  }, env: {} });
  assert.equal(behind.state, "behind", "without the declaration, a checkout behind its upstream is behind");
  assert.equal(behind.behind, 3, "and it still carries the count, which is what the operator acts on");

  // Asked for, and only then.
  const pinned = deploymentCurrency({ env: { CLEAROTRON_DOCTOR_ASSUME_PINNED: "1" } });
  assert.equal(pinned.state, "pinned");
  assert.match(pinned.detail, /currency is not a question here/);

  // An empty or whitespace value is NOT a declaration. A variable that is present-but-blank is the
  // shape that turns an env read into a silent yes elsewhere in this tree, and it is refused here.
  for (const v of ["", "   ", "\t"])
    assert.notEqual(deploymentCurrency({ env: { CLEAROTRON_DOCTOR_ASSUME_PINNED: v } }).state, "pinned",
      `a blank value must not declare a checkout pinned (got it for ${JSON.stringify(v)})`);
});

// THE CONDITION THAT WAS ACTUALLY REDDING, DRIVEN — not a declaration honoured in the abstract.
//
// The arm above proves `pinned` is returned when asked for, but it passes NO `run`, so it never builds
// an overtaken checkout. That is an arm that cannot fail for the reason it exists: move the pinned
// branch below the behind computation and it keeps passing while CI reds exactly as before. The gap was
// found by re-reading 's third criterion against the diff instead of against the
// intention behind it.
//
// So: ONE fake git, three commits behind — the precise state a queued job reaches when main moves under
// it — and TWO outcomes separated only by the declaration.
test("#1912 the overtaken checkout stops redding, and ONLY the declaration changes the answer", () => {
  // Three behind, the way `actions/checkout` leaves a workspace that queued while main moved.
  const overtaken = (args) => {
    const a = args.join(" ");
    if (a.startsWith("rev-parse --is-inside-work-tree")) return { status: 0, stdout: "true\n", stderr: "" };
    if (a.includes("@{u}") && a.includes("abbrev-ref")) return { status: 0, stdout: "origin/main\n", stderr: "" };
    if (a.startsWith("rev-list --count")) return { status: 0, stdout: "3\n", stderr: "" };
    return { status: 1, stdout: "", stderr: "" };
  };

  // THE CONTROL, and it must red: this is the state that failed eight --check arms at once.
  const red = deploymentCurrency({ run: overtaken, env: {} });
  assert.equal(red.state, "behind", "the fixture must BUILD the condition, or the pass below is vacuous");
  assert.equal(red.behind, 3);

  // THE SAME CONDITION, declared. Nothing else differs — same fake git, same counts, same call.
  const green = deploymentCurrency({ run: overtaken, env: { CLEAROTRON_DOCTOR_ASSUME_PINNED: "1" } });
  assert.equal(green.state, "pinned",
    "the declaration must reach the case that was redding, not merely be honoured on a checkout that "
    + "was never behind — that is the difference between this arm and the one above it");
  assert.equal(green.behind, undefined, "a pinned answer reports no count, because it computed none");

  // And it must not have ASKED git anything, which is what makes it safe on a workspace whose upstream
  // is moving underneath it. A pinned answer that still shells out is one race away from the old bug.
  let asked = 0;
  deploymentCurrency({ run: (a) => { asked += 1; return overtaken(a); },
    env: { CLEAROTRON_DOCTOR_ASSUME_PINNED: "1" } });
  assert.equal(asked, 0, "the pinned branch consulted git — it is below the behind computation, not above it");
});

test("#1912 the pinned answer is SAID in the output, not applied silently", () => {
  const r = run(["--check"]);
  assert.match(r.out, /pinned checkout \(CLEAROTRON_DOCTOR_ASSUME_PINNED\)/,
    "a doctor that quietly answers a question it was handed is the shape this surface exists to refuse — "
    + "the reader must see the assumption, not infer it from a silence");
  assert.doesNotMatch(r.out, /commit\(s\) behind/,
    "and it must not also print the count it was told not to compute");
});

// ── 2175 F16/F17/F19 · THE PROMPT SURFACE ───────────────────────────────────────────────────────────
//
// Owner, having completed setup by pressing Enter through it: "I just kept pressing enter ... We need
// consistent install guidance and MUCH SIMPLER prose for what each means and defaults. Same text
// wrapping issues throughout — I can't tell if I should be reading something somewhere or not."

test("2175-F17 explanatory prose wraps INSIDE its width, at every width a terminal might be", () => {
  const text = "When a run finishes, whoever ordered it gets a notification. This is the web address "
    + "the link in it points to. No default — it is your public hostname, and only you know it.";
  // A CLASS, NOT ONE MEMBER. The defect was that prose was broken at ONE width and handed to terminals
  // of every other width, so an arm pinned to a single width would reproduce the original mistake.
  for (const width of [30, 46, 58, 72, 94]) {
    const lines = wrapProse(text, width);
    assert.ok(lines.length > 0, `width ${width} produced nothing`);
    for (const l of lines)
      assert.ok(l.length <= width,
        `width ${width}: "${l}" is ${l.length} — a line over its width is what wrapped to column 0 and `
        + "lost the indent that was carrying the structure");
    assert.equal(lines.join(" ").split(/\s+/).join(" "), text.split(/\s+/).join(" "),
      `width ${width}: wrapping must not drop or duplicate a word`);
  }
});

test("2175-F17 the width is clamped, so neither a huge window nor a tiny one breaks the measure", () => {
  assert.ok(proseWidth(400) <= 96, "a very wide window must not produce an unreadable measure");
  assert.ok(proseWidth(20) >= 38, "a very narrow one must degrade rather than break every word");
  assert.equal(proseWidth(undefined), proseWidth(80), "an unknown column count falls back to 80");
});

test("2175-F16 every credential the wizard asks for names a URL a reader can open", () => {
  const URL_RE = /https?:\/\/[^\s)]+/;
  // THE REGISTERS, through their signup arrays. Signa is the one the product RECOMMENDS and it said
  // "the vendor's site" without naming it, which is the finding.
  const withSignup = PROVIDERS.filter((p) => p.signup?.length);
  assert.ok(withSignup.length >= 2, `only ${withSignup.length} provider(s) carry a signup array — this scan would be free`);
  for (const p of withSignup)
    assert.match(p.signup.join(" "), URL_RE,
      `${p.id}'s signup steps name no URL. "The vendor's site" is not an address, and the reader being `
      + "asked for a key is the one person who cannot be sent to a search engine");

  // THE SEARCH CREDENTIALS, through the driver's own tables — the same rows the wizard prints from, so
  // this cannot pass while the wizard shows something else.
  const adapters = [...Object.values(RESEARCH_PROVIDERS), ...Object.values(SERP_PROVIDERS)];
  assert.ok(adapters.length >= 2, `only ${adapters.length} adapter(s) found — this scan would be free`);
  for (const a of adapters) {
    assert.ok(a.obtain, `${a.credEnv} has no "where to get one" line at all`);
    assert.match(a.obtain, URL_RE,
      `${a.credEnv} names a domain but no URL. A click-path through somebody else's UI is an assertion `
      + "about a site we do not control, and it goes stale with no way to notice");
  }
});

test("2175-F20 no prompt offers to add something 'later', because nothing chases it", () => {
  const src = readFileSync(join(REPO, "bin", "onboard.mjs"), "utf8");
  assert.doesNotMatch(src, /Enter to add it later/,
    "'later' reads as a deferral the product will chase; nothing does. The bracket says [Enter to skip] "
    + "and the consequence is stated where the reader is standing");
});

test("2175-F20 every prompt in the setup sequence states what Enter does", () => {
  // THE FINDING WAS THE CLASS, NOT ANY ONE PROMPT. Four consecutive prompts, each defensible alone,
  // taught the reader that the amount of prose bears no relation to how much the answer matters — so
  // the rational move was to stop reading, which is what happened. An arm pinned to the one prompt he
  // named would let the next one drift the same way.
  const src = readFileSync(join(REPO, "bin", "onboard.mjs"), "utf8");
  const headings = [
    "Where this install keeps its data",
    "The link in delivery notifications",
    "The address clients' assistants reach this install at",
    "Where this install keeps its own configuration",
  ];
  const lines = src.split("\n");
  for (const h of headings) {
    const at = lines.findIndex((l) => l.includes(h));
    assert.ok(at >= 0, `the prompt "${h}" is gone — if it was renamed, rename it here too`);
    // The consequence must arrive with the question, not a paragraph away: a reader deciding whether to
    // press Enter is looking at the prompt, not scrolling back.
    // The window runs from the heading to the prompt call it belongs to — the text the reader actually
    // has in front of them — rather than a fixed line count, which counts comments the reader never sees
    // and was why the first version of this arm failed on a tree that satisfies the criterion.
    const end = lines.findIndex((l, i) => i > at && /await askValue\(/.test(l));
    assert.ok(end > at, `no askValue follows "${h}" — the heading is not a prompt any more`);
    const window = lines.slice(at, end + 1).filter((l) => !/^\s*\/\//.test(l)).join(" ");
    assert.match(window, /Enter accepts|Skip it|Enter to skip/,
      `"${h}" never says what pressing Enter does. A prompt that offers a default and does not say what `
      + "accepting it means is asking the reader to make a decision without telling them they made one");
  }
});

test("2175-F21 setup says it finished, and says what state it left the box in", () => {
  const src = readFileSync(join(REPO, "bin", "onboard.mjs"), "utf8");
  assert.match(src, /Setup finished\./,
    "the wizard handed the reader a next command and never said it had finished — a reader who has "
    + "skipped answers, which the header invites, cannot otherwise tell what they ended up with");
  assert.match(src, /What this box has now:/, "and the state has to be stated, not implied by silence");

  // EVERY SKIPPABLE ANSWER APPEARS. A summary that lists only what was SET tells a reader nothing about
  // what they skipped, which is the half they cannot reconstruct.
  for (const k of ["CLEAROTRON_DATABASE", "PERPLEXITY_API_KEY", "CLEAROTRON_REPORTS_DIR",
                   "CLEAROTRON_CUSTOMERS_DIR", "CLEAROTRON_REPORTS_URL", "CLEAROTRON_CLIENT_MCP_URL"]) {
    const at = src.indexOf("What this box has now:");
    assert.ok(src.slice(at, at + 1600).includes(k),
      `${k} is skippable and does not appear in the closing summary — the answers a reader skipped are `
      + "exactly the ones they cannot reconstruct");
  }
});

test("2175-F12 setup keeps the keys it does not manage, so start's secrets survive an install", () => {
  // THE SEQUENCE THAT BROKE IT: start writes its secrets, then install runs. The wizard composed the
  // file from its own answers and renamed over the target, so start's three values were gone; the next
  // start re-minted PORTAL_SECRET to a different value and signed every logged-in user out with no
  // error anywhere. A .env.bak was taken, which is not the same as not losing them: a backup is a thing
  // a reader has to know to look for, and the failure gives them no reason to look.
  const existing = {
    PORTAL_SECRET: "from-start-do-not-lose",
    PORTAL_LOCAL_USER: "someone@localhost",
    TRADEMARK_MCP_TOKEN_SECRET: "also-from-start",
    CLEAROTRON_DATABASE: "an-old-answer",
  };
  const candidate = { CLEAROTRON_DATABASE: "signa", SIGNA_API_KEY: "k" };
  const body = composeEnvBody(candidate, existing);
  const parsed = Object.fromEntries(body.split("\n")
    .filter((l) => l && !l.startsWith("#")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));

  // EVERY key start writes, not one of them: an arm that checked PORTAL_SECRET alone would pass a fix
  // that carried one value and dropped the other two, which is the shape of the original defect.
  for (const k of ["PORTAL_SECRET", "PORTAL_LOCAL_USER", "TRADEMARK_MCP_TOKEN_SECRET"])
    assert.equal(parsed[k], existing[k], `${k} did not survive — this is the sign-everyone-out defect`);

  assert.equal(parsed.CLEAROTRON_DATABASE, "signa",
    "and setup's own answer must win over the file: the reader just typed it, so this run is the newer "
    + "statement of it");
  assert.equal(parsed.SIGNA_API_KEY, "k", "a key setup collected is written");
});

test("2175-F12 a first install writes no carry section and needs no existing file", () => {
  const body = composeEnvBody({ CLEAROTRON_DATABASE: "free-tier" }, {});
  assert.doesNotMatch(body, /Kept from the existing file/,
    "a fresh box has nothing to carry, and a header explaining a section that is not there is noise");
  assert.match(body, /CLEAROTRON_DATABASE=free-tier/);
});

// ── 2191 F25 · THE STORE THE WIZARD WROTE COULD NOT BE IDENTIFIED ───────────────────────────────────
//
// Setup pointed CLEAROTRON_INSTRUCTIONS_DIR at `<cfg>/skills` and created it empty. `clearotron start`
// then makes `<cfg>` a git repository for saved searches, so the doctrine store sits inside a checkout
// that tracks no file under it — which the run preflight classifies as `blocked`. Every run on every
// install where the wizard had been run carried "doctrine store COULD NOT BE IDENTIFIED".
//
// Driven through the PRODUCT'S OWN classifier, not a re-description of it: the question is what a run
// would decide, and a second copy of that rule here could agree with itself while disagreeing with the
// door.

test("2191-F25 the shape setup used to write is genuinely blocked — the hazard is real, not assumed", () => {
  const dir = mkdtempSync(join(tmpdir(), "f25-arm-"));
  execFileSync("git", ["init", "-q", "-b", "main", dir]);
  writeFileSync(join(dir, "README.md"), "x\n");
  execFileSync("git", ["-C", dir, "add", "README.md"]);
  execFileSync("git", ["-C", dir, "-c", "user.email=a@b", "-c", "user.name=t", "commit", "-qm", "init"]);
  mkdirSync(join(dir, "skills"), { recursive: true });   // exactly what setup created: empty, untracked
  try {
    const r = preflightSkillsStore({ CLEAROTRON_INSTRUCTIONS_DIR: join(dir, "skills") });
    assert.equal(r.result.outcome, "blocked",
      "if this ever passes, the classifier changed and this whole finding needs re-measuring rather than "
      + "the fix quietly becoming unnecessary");
    assert.match(r.line, /COULD NOT BE IDENTIFIED/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("2191-F25 unset is the supported mode and it passes, which is why setup no longer writes it", () => {
  assert.equal(preflightSkillsStore({}).result.outcome, "pass",
    "leaving it unset must be a pass, or removing it from the wizard trades one blocked run for another");
  const src = readFileSync(join(REPO, "bin", "onboard.mjs"), "utf8");
  assert.doesNotMatch(src, /candidate\["CLEAROTRON_INSTRUCTIONS_DIR"\]\s*=/,
    "setup must not write a doctrine store it has just made unidentifiable");
  // AND THE READER IS TOLD, because silence here means files they drop in later are ignored with no
  // sign — which would be this defect traded for a quieter one.
  assert.match(src, /CLEAROTRON_INSTRUCTIONS_DIR stays unset/,
    "the closing note must say the name is unset and what to do when they do want an overlay");
  assert.match(src, /COMMIT it/, "including that an uncommitted store is the state that cannot be identified");
});
