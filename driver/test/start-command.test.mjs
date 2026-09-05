// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — `npm start`, the one command that starts this product on one machine.
//
// bin/start.mjs is a supervisor: two child processes, one URL, and Ctrl-C stops everything. The parts
// worth pinning here are the ones that fail SILENTLY — a launcher whose ports disagree with the URL it
// prints, or that quietly rewrites the `.env` holding the reader's provider credentials, looks exactly
// like a working launcher until the first Start press or the next run.
//
// The spawn/teardown half is deliberately NOT tested here: it needs two real listeners and a signal, and
// forking a portal plus an MCP face inside the driver suite would cost more than it proves. What is
// mechanical is tested; what is not is proven by running the command.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { childEnv, installPaths, mergeEnvFile, resolvePorts, staffDomainFor } from "../../bin/start.mjs";
import { listenErrorMessage } from "../../shared/listen.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const plan = (ports) => childEnv({
  ports,
  paths: installPaths("/install-root/trademark"),
  user: "tester@localhost",
  staffDomains: "localhost",
  portalSecret: "portal-secret",
  tokenSecret: "token-secret",
  opsToken: "v1.body.sig",
});

test("the ports come from the environment, and a value that is not a port is refused", () => {
  // The client door joined this resolver with F26: it is started on BOTH
  // paths now, so its port is resolved here with the other two rather than only where units are
  // written. 18811 is the door's own default, imported rather than repeated.
  assert.deepEqual(resolvePorts({}), { portal: 18802, mcp: 18790, client: 18811 });
  assert.deepEqual(resolvePorts({ PORTAL_SERVICE_PORT: "9001", TRADEMARK_MCP_HTTP_PORT: "9002", CLIENT_MCP_HTTP_PORT: "9003" }),
    { portal: 9001, mcp: 9002, client: 9003 });
  // Empty means "not configured", exactly as it does everywhere else in this tree.
  assert.deepEqual(resolvePorts({ PORTAL_SERVICE_PORT: "" }), { portal: 18802, mcp: 18790, client: 18811 });
  assert.throws(() => resolvePorts({ PORTAL_SERVICE_PORT: "eighteen" }), /not a port number/);
  assert.throws(() => resolvePorts({ TRADEMARK_MCP_HTTP_PORT: "70000" }), /not a port number/);
  // The new one is held to the same rule as the two that were already here — a port that is not a port
  // must refuse wherever it is read, or the newest reader is the one with the weakest check.
  assert.throws(() => resolvePorts({ CLIENT_MCP_HTTP_PORT: "eighteen" }), /not a port number/);
  assert.throws(() => resolvePorts({ CLIENT_MCP_HTTP_PORT: "70000" }), /not a port number/);
});

test("THE SPAWNER AND THE THING THAT CALLS IT AGREE BY CONSTRUCTION, not by a shared literal", () => {
  // The defect this replaced: two places each holding their own copy of the port, with nothing
  // comparing them. corrected this comment, which had described that defect in the PRESENT tense
  // and named a systemd unit carrying PORTAL_MCP_URL — no such unit is tracked in this repo, and a
  // test comment asserting a live defect that is neither live nor in the tree is a false record in the
  // one place a reader trusts most. What remains true is the shape: here one `ports` object feeds
  // every consumer, so an arbitrary port has to appear in all of them.
  for (const mcp of [18790, 1, 65535, 24601]) {
    const e = plan({ portal: 18802, mcp });
    assert.equal(e.mcp.TRADEMARK_MCP_HTTP_PORT, String(mcp), "the face listens on it");
    assert.equal(e.portal.PORTAL_MCP_URL, `http://127.0.0.1:${mcp}`, "the portal calls it on the same one");
    assert.equal(e.mcp.TRADEMARK_MCP_ALLOWED_HOSTS, `127.0.0.1:${mcp},localhost:${mcp}`, "and the Host gate names the same one");
  }
  for (const portal of [18802, 9999]) {
    const e = plan({ portal, mcp: 18790 });
    assert.equal(e.portal.PORTAL_SERVICE_PORT, String(portal));
    assert.equal(e.url, `http://127.0.0.1:${portal}/portal`, "the URL printed to the reader is the port the portal was given");
  }
});

test("#964: the spawner's default engine-door port and the face's own default are ONE number", async () => {
  // The test above proves the ports agree WITHIN bin/start.mjs. This proves they agree ACROSS the
  // process boundary, which is the half was about: `mcp-server/http-server.mjs` held its own
  // literal 18790 for the same variable, and if either copy had moved the face would have listened
  // somewhere the portal was not calling — with no error anywhere, because both files would still be
  // internally consistent. Imported rather than grepped, so the assertion is over the value the server
  // actually uses. Safe to import: the module guards its bootstrap behind `isMain`.
  const { DEFAULT_HTTP_PORT } = await import("../../mcp-server/http-server.mjs");
  assert.equal(DEFAULT_HTTP_PORT, resolvePorts({}).mcp,
    "mcp-server/http-server.mjs and bin/start.mjs must default the engine door to the same port");
});

test("PORTAL_MCP_URL is an ORIGIN — a value carrying /mcp produces /mcp/mcp and 404s on the first press", () => {
  const e = plan({ portal: 18802, mcp: 18790 });
  assert.ok(!/\/mcp/.test(e.portal.PORTAL_MCP_URL), e.portal.PORTAL_MCP_URL);
  assert.ok(!e.portal.PORTAL_MCP_URL.endsWith("/"), "no trailing slash either — the client appends the path");
});

test("both doors prove who the caller is, and NO *_AUTH_DISABLED is required or left to chance", () => {
  const e = plan({ portal: 18802, mcp: 18790 });
  assert.equal(e.portal.PORTAL_AUTH_MODE, "local");
  assert.equal(e.mcp.TRADEMARK_MCP_AUTH_MODE, "token");
  // Named `0`, not merely absent: a stray `.env` written for something else must not be able to hand
  // this command a bypass, and the command must not be readable as depending on one.
  assert.equal(e.mcp.TRADEMARK_MCP_AUTH_DISABLED, "0");
  assert.equal(e.mcp.TRADEMARK_MCP_DEV, "0");
  for (const [child, env] of [["portal", e.portal], ["mcp", e.mcp]]) {
    for (const [k, v] of Object.entries(env)) {
      assert.ok(!(/_AUTH_DISABLED$/.test(k) && v !== "0"), `${child} must not be given ${k}=${v}`);
      assert.ok(!/^(PROFILE|RECIPE)_(AUTH_DISABLED|DEV)$/.test(k), `${child} must not be given ${k} — the portal builds those services in-process`);
    }
  }
});

test("exactly one process reads <repo>/.env, and the children are told so", () => {
  const e = plan({ portal: 18802, mcp: 18790 });
  assert.equal(e.portal.CLEAROTRON_NO_ENV_FILE, "1");
  assert.equal(e.mcp.CLEAROTRON_NO_ENV_FILE, "1");
});

test("TWO PROCESSES, ONE SECRET — the sharpest coupling in the trigger lane", () => {
  // The portal's ops key is signed with TRADEMARK_MCP_TOKEN_SECRET and the face verifies it with the
  // same name. Hand the two ends different values and every Start press comes back 401 from the door,
  // which the portal surfaces as an upstream refusal — an engine fault, with nothing anywhere naming
  // the secret. Both ends are filled from one object for that reason; this is what says so.
  const e = plan({ portal: 18802, mcp: 18790 });
  assert.ok(e.mcp.TRADEMARK_MCP_TOKEN_SECRET, "the face must be given the secret its keys are signed with");
  assert.equal(e.portal.TRADEMARK_MCP_TOKEN_SECRET, e.mcp.TRADEMARK_MCP_TOKEN_SECRET);
});

test("the data plane is explicit — never the code default, which is a real archive on a real machine", () => {
  const e = plan({ portal: 18802, mcp: 18790 });
  for (const env of [e.portal, e.mcp]) {
    for (const k of ["CLEAROTRON_REPORTS_DIR", "CLEAROTRON_WORK_DIR", "CLEAROTRON_QUEUE_DIR", "CLEAROTRON_OUTBOX_DIR",
      "CLEAROTRON_RUN_LOCK_DIR", "CLEAROTRON_ACCESS_FILE"]) {
      assert.ok(env[k], `${k} must be named`);
      assert.ok(!env[k].startsWith("/srv/trademark-archive"), `${k} must never resolve to the production archive`);
    }
  }
  // Saved searches are 404 with no store, and a 404 renders as an error string in a settings panel.
  assert.ok(e.portal.CLEAROTRON_RECIPES_DIR);
  assert.equal(e.portal.RECIPE_REPO_ROOT, installPaths("/install-root/trademark").configStore);
  // The store is its OWN directory, not the install base: recipe-service commits through git, and a
  // repository rooted over the pool and the queue would see every run as untracked.
  assert.notEqual(e.portal.RECIPE_REPO_ROOT, "/install-root/trademark");
});

test("the staff domain is derived from the one address that can sign in", () => {
  assert.equal(staffDomainFor("alex@example-firm.com"), "example-firm.com");
  assert.equal(staffDomainFor("Alex@Example-Firm.com"), "example-firm.com");
  assert.equal(staffDomainFor("svc-runner@localhost"), "localhost");
  assert.equal(staffDomainFor("nonsense"), "");
  assert.equal(staffDomainFor(undefined), "");
});

test("the .env writer is ADD-ONLY — it can never lose what `npm run setup` collected", () => {
  const existing = "# setup wrote this\nPERPLEXITY_API_KEY=secret-value\nPORTAL_SECRET=already-mine\n";
  const r = mergeEnvFile(existing, { PORTAL_SECRET: "NEW", TRADEMARK_MCP_TOKEN_SECRET: "minted" });
  assert.deepEqual(r.added, ["TRADEMARK_MCP_TOKEN_SECRET"], "an existing name is never rewritten");
  assert.ok(r.text.startsWith(existing), "every existing byte survives, in order");
  assert.match(r.text, /^TRADEMARK_MCP_TOKEN_SECRET=minted$/m);
  assert.match(r.text, /PERPLEXITY_API_KEY=secret-value/);

  // SECOND RUN: nothing to add, nothing written, byte-identical.
  const again = mergeEnvFile(r.text, { PORTAL_SECRET: "NEW", TRADEMARK_MCP_TOKEN_SECRET: "minted" });
  assert.deepEqual(again.added, []);
  assert.equal(again.text, r.text);
});

test("the .env writer handles no file, a file with no trailing newline, and an empty value", () => {
  const fresh = mergeEnvFile("", { PORTAL_SECRET: "a" });
  assert.deepEqual(fresh.added, ["PORTAL_SECRET"]);
  assert.match(fresh.text, /^# Written by `npm start`/);
  assert.match(fresh.text, /^PORTAL_SECRET=a$/m);

  const noNewline = mergeEnvFile("A=1", { B: "2" });
  assert.match(noNewline.text, /^A=1$/m, "the last line is not run into the block");
  assert.match(noNewline.text, /^B=2$/m);

  // An empty value is not a value. Writing `X=` would make shared/env-local.mjs apply an empty string
  // and stop the real one being picked up from the environment later.
  assert.deepEqual(mergeEnvFile("", { X: "", Y: null, Z: "z" }).added, ["Z"]);
});

test("a taken port produces a sentence naming the port and the way out, not a stack trace", () => {
  // owns this wording. The launcher used to carry its own shorter copy, which meant a user met a
  // different sentence depending on whether the launcher's pre-flight or the service's own listener
  // refused first. One implementation, asserted here through the launcher's actual call shape.
  const m = listenErrorMessage({ code: "EADDRINUSE" }, { what: "portal", host: "127.0.0.1", port: 18802, portVar: "PORTAL_SERVICE_PORT" });
  assert.match(m, /18802/);
  assert.match(m, /PORTAL_SERVICE_PORT/);
  assert.ok(!/\bat \/|\.mjs:\d+|^Error:/m.test(m), `it must read as a sentence: ${m}`);
});

test("`npm start` is wired, and is not the demo", () => {
  const pkg = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8"));
  assert.equal(pkg.scripts.start, "node bin/start.mjs");
  // The demo is a separate, credential-free path and must stay one: it replays a frozen example with no
  // keys, no model and no engine. Two commands, two jobs, and INSTALL.md says which is which.
  assert.equal(pkg.scripts.demo, "node bin/example.mjs");
});

test("the launcher never starts the standalone profile or recipe service", () => {
  // The ruling this pins: portal-service constructs both IN-PROCESS, running the same routers with the
  // portal's own verified identity as the author, so their standalone bootstraps — and the
  // PROFILE_AUTH_DISABLED / RECIPE_AUTH_DISABLED bypasses that live only inside them — are unreachable
  // from here. If a future edit spawns either one, the bypass question comes straight back.
  const src = readFileSync(join(REPO, "bin", "start.mjs"), "utf8")
    .split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
  for (const svc of ["profile-service.mjs", "recipe-service.mjs", "dev-portal.mjs"]) {
    assert.ok(!src.includes(svc), `bin/start.mjs must not reference ${svc} outside a comment`);
  }
});

test("#859 the launcher SEEDS THE POOL, and does it through the same publisher the demo uses", () => {
  // seed-pool.mjs is unit-tested against an injected publisher, which proves the guard and proves
  // nothing about whether the product calls it. This is that half: a seeding module nobody invokes and
  // an install that comes up empty are the same thing from the browser.
  //
  // Non-comment lines only, for the reason browser-check-membership.test.mjs gives: the block above
  // this wiring discusses seed-pool.mjs by name at length, and reading a comment as a call would make
  // an un-wired launcher look wired — the exact inversion this test exists to prevent.
  const src = readFileSync(join(REPO, "bin", "start.mjs"), "utf8")
    .split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
  assert.match(src, /seed-pool\.mjs/, "bin/start.mjs no longer imports the seeder");
  assert.match(src, /seedPool\(\{[^}]*pool:\s*paths\.pool/,
    "seedPool must be handed paths.pool — the install's own pool, resolved by installPaths, and never a "
    + "path this file spells a second time");
  // — the container moved to demo/ on the owner's one-term ruling, and the
  // launcher has to follow it. This arm is why that move could not be silent: the seeder walks a
  // CONTAINER of product demos, and a launcher left pointing at examples/ — which no longer holds a
  // frozen run — would seed nothing and serve an empty archive without a word.
  // The container is still `demo/`, and the launcher may WRAP that path — it publishes from a copy now,
  // because republishing writes a receipt into the directory it reads and `demo/` is tracked (tracker
  // issue 157). What must not change is which container the samples come from.
  assert.match(src, /examplesDir:[^,]*join\(REPO, "demo"\)/,
    "the samples must come from the repo's demo/ container, one child per product type");
  assert.match(src, /examplesDir:\s*publishSource\(/,
    "the launcher seeds straight out of the tracked container again — a reader who only ran the demo is "
    + "left with a dirty checkout and an engine reporting engineState: dirty");
  assert.match(src, /republish:\s*republishRun/,
    "the seeder must publish through report-registry's republishRun — the SAME function `npm run example` "
    + "uses, which handles the knockout template as well as the clearance one. A second publish path "
    + "here would seed the three products that have no capture yet differently from the one that does.");

  // And the label. The seeded document is real engine output for a fictional mark; carries the
  // banner in the artifact's own frontmatter, and this line is what a reader watching the console sees
  // while it happens. Both, not either.
  assert.match(src, /An example, not advice/,
    "the seeding step no longer says what it is putting in the archive (#1177)");
});

// ── — a local install drains its own queue ─────────────────────────────────────────────────────
// The trap this closes: the portal already prices a run, quotes how long it takes, and asks the user to
// confirm — its dialog spends nothing until you do. Until the worker ran, that promise was
// false in the reader's favour, because confirming enqueued and nothing spent until a second terminal ran
// a drain they had to have read about. These arms pin the two properties that make the worker safe rather
// than the fact that it exists: it cannot widen concurrency, and it cannot take the portal down.

const bodyOf = (f) => readFileSync(join(REPO, f), "utf8")
  .split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");

test("#1721 the worker gets the install's paths — including the run-lock dir, which is what bounds concurrency", () => {
  const envs = plan({ mcp: 18801, portal: 18802 });
  assert.ok(envs.worker, "childEnv returns no worker env — the launcher would spawn a runner pointed at the DEFAULT install");
  // THE LOAD-BEARING ONE. Every run acquires a filesystem slot in CLEAROTRON_RUN_LOCK_DIR (pipeline.acquireRunSlot),
  // so a portal-started worker and a hand-started `node driver/runner.mjs` share ONE cap. If these two ever
  // disagree, the install silently gains a second lane and the 2026-06-12 starvation is back.
  assert.equal(envs.worker.CLEAROTRON_RUN_LOCK_DIR, envs.portal.CLEAROTRON_RUN_LOCK_DIR,
    "the worker and the portal disagree about the run-lock dir — the concurrency cap is no longer shared");
  assert.equal(envs.worker.CLEAROTRON_QUEUE_DIR, envs.portal.CLEAROTRON_QUEUE_DIR,
    "the worker would drain a different queue from the one the portal fills");
  // ✕ EQUALITY ALONE WAS VACUOUS: delete the pool from the shared block and `undefined === undefined`
  // still passes. made that load-bearing — the demo's supervisor hands THIS
  // value to the snapshot writer, because a demo writes no `.env` for the writer to read. Pinned to the
  // install's own pool so a removal reds here instead of silently returning the demo to "the
  // configuration page cannot answer".
  assert.equal(envs.worker.CLEAROTRON_REPORTS_DIR, envs.portal.CLEAROTRON_REPORTS_DIR);
  assert.equal(typeof envs.worker.CLEAROTRON_REPORTS_DIR, "string");
  assert.ok(envs.worker.CLEAROTRON_REPORTS_DIR.length > 0,
    "the shared block carries no pool at all — the demo's snapshot writer would be handed nothing and the visitor's first screen would say the configuration could not be written");
  assert.equal(envs.worker.CLEAROTRON_NO_ENV_FILE, "1", "the worker would read <repo>/.env and could disagree with its supervisor");
});

test("#1721 the worker is handed NO door configuration — it talks to the queue, not to either listener", () => {
  const envs = plan({ mcp: 18801, portal: 18802 });
  for (const k of Object.keys(envs.worker)) {
    assert.ok(!/^PORTAL_|^TRADEMARK_MCP_(HTTP|AUTH|ALLOWED|DEV)/.test(k),
      `the worker env carries ${k} — a queue drainer has no listener and no door, and a secret it cannot need is a secret it can leak`);
  }
});

test("#1721 the worker is NON-FATAL — an install with no worker is a supported state, so its death must not take the portal", () => {
  const src = bodyOf("bin/start.mjs");
  assert.match(src, /start\("the worker", "driver\/runner\.mjs", envs\.worker, \{ args: \["--watch"\], fatal: false \}\)/,
    "the worker is not started with fatal:false — a worker that dies would call shutdown(1) and take the portal down with it");
  assert.match(src, /const start = \(name, script, env, \{ args = \[\], fatal = true \} = \{\}\) =>/,
    "start() no longer distinguishes a fatal child from a non-fatal one, so fatal:false above is inert");
  // The default must stay FATAL: the portal and the engine door are not optional, and a silent default flip
  // would turn a dead door into a portal that serves 500s rather than an install that stops and says why.
  assert.ok(!/fatal = false/.test(src), "the default child is no longer fatal — a dead engine door would go unreported");
});

test("#1721 --no-worker is honoured, and the old two-terminal instruction survives ONLY for that posture", () => {
  const src = bodyOf("bin/start.mjs");
  assert.match(src, /const wantWorker = !argv\.includes\("--no-worker"\)/, "there is no way to decline the worker");
  assert.match(src, /wantWorker\s*\n?\s*\? start\("the worker"/, "the worker is started unconditionally — --no-worker does nothing");
  // The closing block is the whole of the first-run story. A reader who did NOT decline must not be told to
  // run a drain in another terminal — that sentence is what made the queue look broken.
  assert.match(src, /node driver\/runner\.mjs --watch/, "the --no-worker posture no longer says how to drain by hand");
});

test("#1721 the portal is told about a worker ONLY when this launcher supervises one", () => {
  const ports = { mcp: 18801, portal: 18802 };
  const base = { paths: installPaths("/install-root/trademark"), user: "tester@localhost", staffDomains: "localhost",
    portalSecret: "portal-secret", tokenSecret: "token-secret", opsToken: "v1.body.sig" };
  const withWorker = childEnv({ ...base, ports, localWorker: true });
  const without = childEnv({ ...base, ports, localWorker: false });
  assert.equal(withWorker.portal.PORTAL_LOCAL_WORKER, "1");
  // THE PRODUCTION-SAFETY ARM. A deployed instance drains through the systemd path/timer units, which run
  // main({once:true}) and write no heartbeat. If this key were ever set by default, every queued row on
  // production would read "Waiting for a worker" — a false alarm on the one surface a client watches.
  assert.equal("PORTAL_LOCAL_WORKER" in without.portal, false,
    "the portal is told a worker is supervised when it is not — a deployment with no heartbeat would alarm on every queued row");
  assert.equal("PORTAL_LOCAL_WORKER" in childEnv({ ...base, ports }).portal, false,
    "the DEFAULT claims a supervised worker — a caller that omits the flag must not opt production in");
});

test("#1721 the portal only relabels a queued row on an EXPLICIT no — never on 'not known'", () => {
  const src = bodyOf("driver/portal-service.mjs");
  // `draining` is tri-state on purpose: true (a worker beat recently), false (we are supervising one and it
  // is gone), null (nobody told us — every deployment that is not a local install). Only false may relabel.
  assert.match(src, /draining === false \? "Waiting for a worker" : "Waiting to start"/,
    "the queued label no longer distinguishes an explicit 'no worker' from 'not known', so a deployment that never reports would alarm");
  // — the PRODUCER no longer lives here. It was an inline ternary whose only guard was this file's
  // consumer check, so planting `: false` on it left the suite green while turning every deployed queued
  // row into a false alarm. It is now `drainingState()` in driver/worker-heartbeat.mjs, held by its own
  // arms against a contract rather than a shape. What this file still owns is the CONSUMER: that only an
  // explicit false relabels, and that the producer is called rather than re-implemented here.
  assert.match(src, /const draining = drainingState\(\);/,
    "portal-service re-implements the producer instead of calling it — the #1786 plant lands here again");
  assert.ok(!/PORTAL_LOCAL_WORKER/.test(src),
    "the opt-in check is back inline in portal-service; it belongs in drainingState, where it is unit-tested");
  assert.ok(!/drainingState\(config\.|workerAlive\(config\./.test(src),
    "portal-service must not reach driver.config at module scope for this — see the queueDirs note in that file");
});

// ── — THE LAUNCHER WRITES THE SNAPSHOT THE PORTAL READS ───────────────────────────────────────
//
// A SOURCE-SHAPE ARM, and its weakness is stated rather than hidden. The spawn half of this file is
// deliberately untested — two real listeners and a signal cost more than they prove — so the wiring
// asserted here cannot be driven end to end without that. What the behavioural arm in
// flag-snapshot.test.mjs proves is that `writeFlagSnapshot` writes a snapshot carrying the engine
// block; what this proves is that the launcher CALLS it, and calls it before it spawns anything.
//
// Both halves are needed. The writer being correct while nobody invokes it is precisely the state
// measured: no runtime caller outside its own module and the tests, on the one install where the
// portal's only channel had nothing to say.
test("#1720 bin/start.mjs writes the configuration snapshot, before it spawns a child", () => {
  const src = readFileSync(join(REPO, "bin/start.mjs"), "utf8");

  // BOTH THE BINDING AND THE CALL. A source-shape arm cannot tell a working call from one whose import
  // was renamed out from under it — planted exactly that during development and this arm stayed green,
  // because the call TEXT survived. Asserting the import too costs one line and closes that hole.
  assert.match(src, /\{[^}]*\bwriteFlagSnapshot\b[^}]*\}\s*=\s*await import\(["'][^"']*flag-snapshot\.mjs["']\)/,
    "bin/start.mjs no longer imports writeFlagSnapshot from driver/flag-snapshot.mjs, so any call to it "
    + "below is a ReferenceError this arm would otherwise read as wiring");
  const callAt = src.search(/writeFlagSnapshot\s*\(/);
  assert.ok(callAt > 0,
    "bin/start.mjs no longer calls writeFlagSnapshot. The portal deliberately has no engine environment "
    + "and can only READ a snapshot; with nothing writing one on a fresh install, its configuration page "
    + "answers `engine: null` on exactly the install #1720 is about.");

  const spawnAt = src.search(/^\s*const child = spawn\(/m);
  assert.ok(spawnAt > 0, "no `const child = spawn(` in bin/start.mjs — this arm has lost its subject");
  assert.ok(callAt < spawnAt,
    "the snapshot is written after a child is already running: the portal can serve a configuration "
    + "page before the file describing it exists, which is the race the ordering here avoids");

  // AND IT MUST NOT BE FATAL. A snapshot is a diagnostic surface; refusing to start a working portal
  // because a JSON file could not be written is a worse outcome than the portal saying it cannot answer.
  const around = src.slice(Math.max(0, callAt - 400), callAt + 400);
  assert.match(around, /try\s*\{/,
    "the snapshot write is not guarded — a failure here would take down a portal that would otherwise serve");
  assert.match(around, /WARNING|could not be written/,
    "…and it must not be silent either: a missing snapshot is the state this issue is about, so the "
    + "reason belongs on stderr rather than swallowed");
});

// ── — AND THE DEMO HAS TO HAND ITS OWN INSTALL TO THAT CALL ─────────────────
//
// The arm above proves the launcher calls the writer. It cannot prove the DEMO's call succeeds, and
// that distinction is the whole defect: the call was there, it ran, and it threw — because a demo
// writes no `.env` and this process therefore carried none of the install's paths. The children had
// them (childEnv); the parent did not. A visitor's first screen read "the configuration snapshot could
// not be written", naming a deployed server's archive path.
//
// SOURCE-SHAPE, AND ITS WEAKNESS STATED, exactly as its neighbour states its own: the spawn half of
// this file is deliberately undriven, so what is pinned here is that the demo branch EXISTS and hands
// over both halves. That the writer then honours them is behavioural, in flag-snapshot.test.mjs. The
// end-to-end proof is a drive, and it belongs in the pull request rather than in a suite that would pay
// two listeners for it.
test("Refs tracker issue 2015 the demo hands the snapshot writer its own pool and env, or it writes nothing", () => {
  const src = readFileSync(join(REPO, "bin/start.mjs"), "utf8");
  const callAt = src.search(/writeFlagSnapshot\s*\(/);
  assert.ok(callAt > 0, "no writeFlagSnapshot call in bin/start.mjs — this arm has lost its subject");
  const call = src.slice(callAt, callAt + 320);
  assert.match(call, /\bDEMO\b/,
    "the snapshot call no longer distinguishes the demo. A demo writes no .env, so this process carries "
    + "no pool, config.poolRoot throws by name, and the demo's configuration page goes back to saying it "
    + "cannot answer — on the one install whose reader has never run anything");
  assert.match(call, /poolRoot:\s*paths\.pool/,
    "the demo's call hands over no poolRoot, so the writer falls back to config.poolRoot and throws");
  assert.match(call, /env:\s*\{[^}]*envs\.worker/,
    "the demo's call hands over no env, so the snapshot would describe an environment that has none of "
    + "the install's paths in it");
});

// ══ 2071: a start that will not start must not write first ════════════════════════════════════════

test("2071: refused on a held port, `start` has written NOTHING — no env file, no data plane, no grants, no seed", async () => {
  // The owner's box, reproduced: another copy holds the portal port. The old order printed five
  // state-changing lines and then refused; the acceptance is the refusal with an untouched box.
  // Spawned against the real entry (2064 discipline: status/error before stdout means anything).
  const { spawnSync } = await import("node:child_process");
  const { createServer } = await import("node:net");
  const home = mkdtempSync(join(tmpdir(), "start-home-"));
  const base = join(home, "trademark");
  const holder = createServer();
  await new Promise((r) => holder.listen(0, "127.0.0.1", r));
  const held = holder.address().port;
  // The repo's .env is where start actually writes (ENV_PATH = join(REPO, ".env")) — snapshot it, so
  // the assert below is "UNCHANGED", which holds on a dev box that legitimately carries one and on the
  // bare CI worktree alike. An absence assert here would false-red the former.
  const repoEnv = join(REPO, ".env");
  const envBefore = existsSync(repoEnv) ? readFileSync(repoEnv, "utf8") : null;
  try {
    const child = spawnSync(process.execPath, [join(REPO, "bin", "start.mjs"), "--base", base], {
      encoding: "utf8", timeout: 60000,
      // A CLEAN environment, built rather than inherited: a dev box's PORTAL_*/CLEAROTRON_* would
      // steer the gates this arm needs to fall through to the probe.
      env: { PATH: process.env.PATH, HOME: home, PORTAL_SERVICE_PORT: String(held) },
    });
    assert.ok(!child.error, `the spawn did not come back (${child.error?.message}) — a could-not-look, not a verdict`);
    assert.equal(child.status, 1, `start must refuse on the held port (status=${child.status}, signal=${child.signal})\nstderr: ${child.stderr}`);
    assert.match(child.stderr, /in use/i, "the refusal names the taken port, in #773's own words");
    // THE ACCEPTANCE: nothing was written, minted or seeded before the refusal. The env file start
    // writes is the REPO'S — ENV_PATH is join(REPO, ".env"), not the home's — and the first cut of
    // this arm asserted the home path and stayed GREEN through a planted pre-probe write. The plant
    // caught it; the corrected assert is UNCHANGED-not-absent so a dev box's own .env cannot red it.
    const envAfter = existsSync(repoEnv) ? readFileSync(repoEnv, "utf8") : null;
    assert.equal(envAfter, envBefore, "the repo's .env — where start actually writes — changed before the probe refused");
    assert.ok(!existsSync(join(home, ".env")), "and nothing invented a home .env either");
    assert.ok(!existsSync(base), "no data plane was created before the probe");
    // And the refusal must NOT carry the after-writes re-run line — nothing was written, and saying
    // otherwise would teach the reader the opposite lesson.
    assert.doesNotMatch(child.stderr, /already written state/, "a pre-write refusal claims writes happened");
  } finally {
    holder.close();
    rmSync(home, { recursive: true, force: true });
  }
});

// ══ 1986: the mint and the portal's calls cannot drift apart silently ═════════════════════════════

test("1986: the ops token start mints carries EVERY write verb the portal actually calls", () => {
  // The deployed defect: a token minted before Stop existed could start runs and not stop them, and
  // the only witness was one boot-log line nobody read. The mint's verb list and the portal's tool
  // calls are two spellings of one contract; this arm joins them at the source so the next verb the
  // portal grows reds the tree until the mint knows it.
  const start = readFileSync(join(REPO, "bin", "start.mjs"), "utf8");
  const portal = readFileSync(join(REPO, "driver", "portal-service.mjs"), "utf8");
  const mintMatch = start.match(/mintToken\(\{\s*scope:\s*"ops"[\s\S]*?verbs:\s*\[([^\]]*)\]/);
  assert.ok(mintMatch, "start.mjs no longer mints the portal ops token with an explicit verbs list — re-aim this arm");
  const minted = [...mintMatch[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
  const called = [...new Set([...portal.matchAll(/tool:\s*"([a-z_]+)"/g)].map((m) => m[1]))];
  assert.ok(called.length >= 2, `the portal's tool-call census collapsed (saw ${JSON.stringify(called)}) — the extractor broke, not the tree`);
  const missing = called.filter((t) => !minted.includes(t));
  assert.deepEqual(missing, [],
    `the portal calls ${JSON.stringify(missing)} but start.mjs mints a token that cannot — every Stop/Cancel on a box started this way fails as an upstream refusal`);
});

// ── — THE DEMO POSTURE IS THREE DIFFERENCES, AND THEY ARE ASSERTED ─────────
//
// `clearotron demo` brings up this supervisor now rather than the dev cockpit. What a demo may differ
// in is a closed list, and each half is driven here: the flag reaches the portal's environment, and it
// reaches NOTHING else — a demo that quietly relaxed the doors would pass an arm that only checked the
// flag was set.

test("2015 the demo posture reaches the portal and changes nothing about either door", () => {
  const paths = installPaths("/srv/demo-base");
  const common = { ports: { portal: 18802, mcp: 18790 }, paths, user: "demo@localhost",
    staffDomains: "localhost", portalSecret: "p", tokenSecret: "t", opsToken: "o" };
  const demo = childEnv({ ...common, demo: true });
  const live = childEnv({ ...common });

  // — ONE NAME, in `shared`, so the MCP door learns it too: its boot warning is
  // written for an operator and a demo visitor is not one. `PORTAL_DEMO` is retired rather than joined.
  assert.equal(demo.portal.CLEAROTRON_DEMO, "1", "the portal is never told it is a demo");
  assert.equal(demo.mcp.CLEAROTRON_DEMO, "1", "the MCP door is never told it is a demo, so its warning stays mis-aimed");
  assert.equal(demo.portal.PORTAL_DEMO, undefined, "the retired name is still being written");
  assert.equal(live.portal.CLEAROTRON_DEMO, undefined,
    "a live install carries the demo switch — the default is on, which would grey a real deployment");

  // AND NOTHING ELSE MOVED. This is the arm that matters: the issue's own rule is that sign-in and the
  // auth model are out of scope, so a demo must be byte-identical to a live install everywhere but the
  // keys named below.
  //
  // WIDENED THIS BY EXACTLY ONE KEY, and the closed-list shape is kept rather
  // than relaxed to a deepEqual-minus-one. The flag had to reach the MCP door because that door prints a
  // boot warning written for an operator, and a demo visitor is not one — but "the demo may add a key to
  // a door" is precisely the door the rule above exists to hold shut, so the NEXT key has to be named
  // here too. Nothing about auth, ports, secrets or paths may differ.
  for (const door of ["mcp", "worker"]) {
    const added = Object.keys(demo[door]).filter((k) => !(k in live[door]));
    assert.deepEqual(added, door === "mcp" ? ["CLEAROTRON_DEMO"] : [],
      `${door}: a demo added a key nobody declared (${added.join(", ")})`);
    for (const [k, v] of Object.entries(live[door]))
      assert.equal(demo[door][k], v, `${door}/${k}: a demo changed a value it shares with a live install`);
  }
  // The worker is told nothing at all, and that is deliberate: it drains a queue, and a demo never puts
  // anything in one.
  assert.equal(demo.worker.CLEAROTRON_DEMO, undefined,
    "the worker learned it is a demo — it has no message to re-aim and no reader to protect");
  // A CLOSED LIST, and the arm fails on anything outside it. Writing it as "everything except
  // PORTAL_DEMO" let the second difference in silently when it arrived; the credential path below is a
  // deliberate difference and is named here, so the NEXT one has to be named too.
  const DEMO_ONLY = ["CLEAROTRON_DEMO", "PORTAL_LOCAL_CREDENTIAL"];
  const surplus = Object.keys(demo.portal).filter((k) => !(k in live.portal) && !DEMO_ONLY.includes(k));
  assert.deepEqual(surplus, [], `a demo added portal keys nobody declared: ${surplus.join(", ")}`);
  for (const [k, v] of Object.entries(live.portal))
    assert.equal(demo.portal[k], v, `${k}: a demo changed a value it shares with a live install`);

  // AND THE CREDENTIAL IS INSIDE THE DEMO'S OWN BASE. Left at its default it is
  // ~/.cordillera/portal-local-credential.json, shared with every install on the box — the demo then
  // inherits a digest minted for another address and hands a visitor a sign-in they cannot pass.
  // Measured by driving it, not reasoned about.
  assert.equal(demo.portal.PORTAL_LOCAL_CREDENTIAL, paths.credential);
  assert.ok(demo.portal.PORTAL_LOCAL_CREDENTIAL.startsWith(paths.base),
    "the demo's sign-in credential is outside its own base, so removing the demo leaves it behind");
  assert.equal(live.portal.PORTAL_LOCAL_CREDENTIAL, undefined,
    "a live install had its credential path rewritten — that is not this flag's business");
  assert.equal(demo.portal.PORTAL_AUTH_MODE, "local", "sign-in is out of scope and must be untouched");
  assert.equal(demo.url, live.url, "a demo is served at the same address by the same service");
});

test("2015 the demo's data directory is its own, so trying the demo costs a real install nothing", () => {
  const demo = installPaths("/srv/home/trademark-demo");
  const live = installPaths("/srv/home/trademark");
  // Every path a run touches, not just the base: a demo sharing ANY of these is a demo that leaves
  // state behind in a real install.
  for (const key of ["pool", "workspace", "queue", "outbox", "locks", "grants", "audit", "configStore", "recipes", "credential"])
    assert.notEqual(demo[key], live[key], `${key}: the demo and a real install share this path`);
});
