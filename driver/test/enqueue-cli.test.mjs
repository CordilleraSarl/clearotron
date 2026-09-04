// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Headless intake contract: the enqueue CLI is intake door #1 (door #2 is the ops-MCP
// start_run — same job shape, same validator). These tests prove the contract end-to-end: a CLI-queued
// job in an EXPLICIT queue dir (CLEAROTRON_QUEUE_DIR — no agent workspaces involved at intake) is admitted
// by the runner and runs to .done; an invalid request is refused BEFORE anything lands in the queue;
// a dry-run writes nothing; an id collision is a hard no-op (re-delivery safety, mirrors start_run).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { parseArgs, assembleFromFlags } from "../enqueue.mjs";
import { validateJob } from "../enqueue-schema.mjs";
import { pinEnv } from "../../shared/env-aliases.mjs";   // — a fixture pins EVERY spelling
import { refuseOnPreRunFailure } from "./precondition-refusal.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLAUDE = join(HERE, "mock-claude.mjs");
const CLI = join(HERE, "..", "enqueue.mjs");
process.env.CORSEARCH_SESSION_KEY ||= "test-offline";

// Run the CLI as a real subprocess (the contract is the process boundary: exit codes + stdout JSON).
function runCli(args, env) {
  const r = spawnSync(process.execPath, [CLI, ...args], { env: { ...process.env, ...env }, encoding: "utf8" });
  let out = null;
  try { out = JSON.parse(r.stdout); } catch { /* non-JSON stdout = the test will assert on it */ }
  return { code: r.status, out, stdout: r.stdout, stderr: r.stderr };
}

// PINNED UNDER THE CURRENT SPELLING, and that is a property of the compat window rather than a
// preference. `scripts/test-run.mjs` contains the suite by pre-setting the LEGACY `CLEAROTRON_QUEUE_DIR`
// inside the run root; `applyEnvAliases` then populates `CLEAROTRON_QUEUE_DIR` from it, and that
// derived value is inherited by every child this file spawns. A child handed an explicit LEGACY value
// therefore arrives with both spellings set and disagreeing — where the documented rule is that the
// current name wins — so the wrapper's containment silently outranked this test's own queue and the
// job was written somewhere else entirely. Overriding the CURRENT name replaces the inherited value by
// key, which is what the spawned CLI needs.
//
// BOTH SPELLINGS CARRY THE SAME VALUE, and the legacy one is not belt-and-braces. The second half of
// this test imports the runner INTO THIS PROCESS after assigning these keys onto `process.env`, and the
// translation does not re-run on that import: `applyEnvAliases` fires once at its own module's load
// point, and the cache-buster on `runner.mjs` does not re-evaluate an already-loaded `shared/` module.
// So nothing would carry the current spelling down to the legacy name the config actually reads, and
// the runner would drain the wrapper's containment directory instead of this test's queue. Two spellings
// agreeing on one value is the documented quiet state ("a half-migrated environment that agrees with
// itself says nothing"), so this buys the in-process arm correctness at no cost in noise.
test("enqueue CLI → explicit CLEAROTRON_QUEUE_DIR → runner drains to .done (fully headless intake)", async () => {
  const root = mkdtempSync(join(tmpdir(), "prelim-encli-"));
  const qdir = join(root, "intake-queue"); // NOT under any workspace-<agent> — the headless product shape
  const env = {
    CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE,
    CLEAROTRON_WORK_DIR: root, CLEAROTRON_REPORTS_DIR: join(root, "pool"),
    CLEAROTRON_QUEUE_DIR: qdir, CLEAROTRON_QUEUE_DIR: qdir,
    CLEAROTRON_MAX_RETRIES: "0", MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced",
    CORSEARCH_SESSION_KEY: "test-offline",  // doc-27 register-cred preflight is fail-closed at claim
    CLEAROTRON_SATPROBE_CODESIDE: "0", CLEAROTRON_BAND_TRUTH_GATE: "0",  // hermetic: no provider dialing, no ledger to evidence bands
  };

  const q = runCli(["--mark", "NOVAPULSE PROBE", "--classes", "9, 41", "--goods", "downloadable game software",
    "--forwarder", "jordan", "--forwarder-email", "jordan.lee@example.com", "--id", "encli-1"], env);
  assert.equal(q.code, 0, q.stderr);
  assert.equal(q.out.queued, true);
  assert.equal(q.out.classify, "run");
  assert.equal(q.out.queuePath, join(qdir, "encli-1.json"));
  const job = JSON.parse(readFileSync(join(qdir, "encli-1.json"), "utf8"));
  assert.equal(job.markName, "NOVAPULSE PROBE");
  assert.deepEqual(job.classes, [9, 41]);
  assert.deepEqual(job.marks, [{ name: "NOVAPULSE PROBE", classes: [9, 41] }]);
  assert.equal(job.enqueuedVia, "cli/enqueue");
  assert.ok(job.msgId && job.conversationId, "delivery-threading defaults stamped");
  assert.ok(!existsSync(join(qdir, "encli-1.json.tmp")), "no tmp residue after the atomic publish");

  // The runner must see the explicit queue (config.queueDirs) and run the job to .done as defaultAgent.
  for (const [k, v] of Object.entries(env)) pinEnv(process.env, k, v);
  const { main } = await import(`../runner.mjs?bust=${Math.random()}`);
  await main({ once: true });
  // — BEFORE the assertions below. A run that never started leaves its
  // reason in the packets beside the queue; without this the counts below report it as a
  // product defect.
  refuseOnPreRunFailure(join(root, "prelim-outbox"), "enqueue-cli.test.mjs");
  assert.ok(existsSync(join(qdir, "encli-1.done")), "runner admitted + ran the CLI-queued job");
  const res = JSON.parse(readFileSync(join(qdir, "encli-1.done.result"), "utf8"));
  assert.equal(res.ok, true, JSON.stringify(res));
  // BOTH spellings, or the leak survives under the other name: the sibling tests in this file share
  // this process, and a stray current-name value is translated back down to the legacy one on the next
  // load that runs the aliases.
  pinEnv(process.env, "CLEAROTRON_QUEUE_DIR", undefined);
  delete process.env.CLEAROTRON_QUEUE_DIR;
});

test("refused at the door: no mark → exit 2, queue stays empty; --dry-run writes nothing", () => {
  const root = mkdtempSync(join(tmpdir(), "prelim-encli-"));
  const qdir = join(root, "q");

  const bad = runCli(["--goods", "beverages", "--forwarder", "jordan", "--queue-dir", qdir], {});
  assert.equal(bad.code, 2);
  assert.equal(bad.out.ok, false);
  assert.equal(bad.out.classify, "clarify"); // runnable identity, unresolvable search subject
  assert.match(bad.stderr, /missing mark name/);
  assert.ok(!existsSync(qdir) || readdirSync(qdir).length === 0, "nothing may land in the queue on refusal");

  const noFwd = runCli(["--mark", "SOLO", "--classes", "9", "--queue-dir", qdir], {});
  assert.equal(noFwd.code, 2);
  assert.match(noFwd.stderr, /--forwarder/, "names the missing flag, not a generic validator string");

  const dry = runCli(["--mark", "DRYPROBE", "--classes", "33", "--forwarder", "jordan",
    "--queue-dir", qdir, "--dry-run"], {});
  assert.equal(dry.code, 0, dry.stderr);
  assert.equal(dry.out.dryRun, true);
  assert.equal(dry.out.classify, "run");
  assert.match(dry.out.wouldWrite, /\.json$/);
  assert.ok(!existsSync(qdir) || readdirSync(qdir).length === 0, "dry-run must not write");
});

test("--job file passthrough keeps prose verbatim; flags override; id collision exits 3", () => {
  const root = mkdtempSync(join(tmpdir(), "prelim-encli-"));
  const qdir = join(root, "q");
  const brief = `Confirmation brief with "quotes", a €-sign & <angle brackets> —\ntwo lines.`;
  const jobFile = join(root, "req.json");
  writeFileSync(jobFile, JSON.stringify({
    id: "file-1", forwarder: "sam", markName: "FILEPROBE", classes: [5],
    brief, goods: "veterinary preparations",
  }));

  // "Nordvale Labs" rather than a name on the profile roster: an untagged job naming a customer we hold now
  // clarifies at intake, which would refuse this CLI call for reasons that have nothing to do with the flag
  // overlay under test. (A real "Petcary Labs" WOULD clarify — word-boundary containment treats it as our
  // Petcary until a person says otherwise. That is intended, and it is enqueue-schema's test to make.)
  const q1 = runCli(["--job", jobFile, "--queue-dir", qdir, "--customer", "Nordvale Labs"], {});
  assert.equal(q1.code, 0, q1.stderr);
  const onDisk = JSON.parse(readFileSync(join(qdir, "file-1.json"), "utf8"));
  assert.equal(onDisk.brief, brief, "prose survives byte-for-byte (proper JSON, no sidecars needed)");
  assert.equal(onDisk.customer, "Nordvale Labs", "field flags overlay the --job file");
  assert.equal(onDisk.markName, "FILEPROBE");

  const dup = runCli(["--job", jobFile, "--queue-dir", qdir], {});
  assert.equal(dup.code, 3, "same id already queued → collision exit, no overwrite");
  assert.match(dup.stderr, /already queued/);

  const badJson = join(root, "bad.json");
  writeFileSync(badJson, "not json {{{");
  const broken = runCli(["--job", badJson, "--queue-dir", qdir], {});
  assert.equal(broken.code, 1, "malformed --job is the caller's bug — refuse loudly, enqueue nothing");
  assert.ok(!existsSync(join(qdir, "bad.json")));
});

test("CLI: per-run scope and the depth selectors are reachable as flags, not only through --job", () => {
  // assembleFromFlags read flags.product/flags.recipeKey from the day the spine landed, but neither
  // flag was in the parser's table — so the reads were dead and the CLI could not name a depth at all.
  const flags = parseArgs([
    "--mark", "SCOPEPROBE", "--classes", "9", "--forwarder", "ops",
    "--jurisdictions", "US, EU", "--platforms", "gnc.com,iherb.com", "--product", "multi-country-focus-search",
  ]);
  const job = assembleFromFlags(flags);
  // COMMAS ONLY. The shared splitter used /[\\s,]+/, so `--jurisdictions "United States,France"` arrived
  // as four entries and the first two were refused as territories nobody recognizes. A territory name
  // has spaces in it; a class number and a store domain do not.
  assert.deepEqual(job.jurisdictions, ["US", "EU"], "commas, and a name may contain spaces");
  assert.deepEqual(job.platforms, ["gnc.com", "iherb.com"]);
  assert.equal(job.product, "multi-country-focus-search");
  assert.equal(validateJob(job).classify, "run");
  // the scope-vs-machinery rule reaches this door too — and it is a SPLIT, not a blanket refusal:
  // a quick screen takes territories (it renders them in its sweep) but has no grid for a store.
  const koJx = assembleFromFlags(parseArgs(["--mark", "X", "--classes", "9", "--forwarder", "ops",
    "--product", "knockout-search", "--jurisdictions", "US"]));
  assert.equal(validateJob(koJx).classify, "run");
  const koPlat = assembleFromFlags(parseArgs(["--mark", "X", "--classes", "9", "--forwarder", "ops",
    "--product", "knockout-search", "--platforms", "gnc.com"]));
  assert.equal(validateJob(koPlat).classify, "clarify");
  // and the shared validator still owns the vocabulary at this door
  const bad = assembleFromFlags(parseArgs(["--mark", "X", "--classes", "9", "--forwarder", "ops", "--platforms", "web"]));
  assert.equal(validateJob(bad).classify, "clarify");
});

// ── A FLAG NOBODY IS TOLD ABOUT IS A FLAG ONLY THE SOURCE REACHES ───────────────────────────────────
//
// `--marks` was read by the assembler and mapped by no flag, so every invocation of it died on "unknown
// flag" and the batch form was unreachable from this door. `--delivery-route` is the same convention one step
// on: it was wired into both maps and into the overlay, and left out of USAGE — so it worked and nobody
// could find out it existed. There was no check either way, which is the absence this closes.
test("every flag the parser accepts is documented in --help, and every documented flag parses", () => {
  const usage = spawnSync(process.execPath, [CLI, "--help"], { encoding: "utf8" }).stdout;
  assert.ok(usage.includes("usage: node enqueue.mjs"), "no usage text came back");
  // Derived from the parser rather than listed: the flag names are read off parseArgs itself, by
  // feeding it each candidate and seeing which are accepted. A hand-kept list is what this is replacing.
  const documented = [...usage.matchAll(/^\s{4}(--[a-z-]+)/gm)].map((m) => m[1]);
  assert.ok(documented.length > 15, `only ${documented.length} flags found in the usage text — the scrape is wrong`);
  for (const flag of documented) {
    // A documented flag must PARSE. Fed ALONE: a value flag then complains it needs one and a boolean
    // flag succeeds, and both are fine. The only failure this half is about is "unknown flag", which is
    // what a documented-but-unmapped flag answers — the `--marks` death, exactly.
    let err = null;
    try { parseArgs([flag]); } catch (e) { err = String(e.message); }
    assert.ok(!/unknown flag/.test(err ?? ""), `${flag} is documented and the parser does not know it: ${err}`);
  }
  // And the other direction, on the flags this round touched: a flag the parser takes and the usage text
  // never names is unreachable to anyone who has not read the source.
  for (const flag of ["--delivery-route", "--marks", "--native-language", "--product", "--worldwide"])
    assert.ok(documented.includes(flag), `${flag} parses but --help never names it`);
});

test("--delivery-route reaches the job, and \"portal\" is refused at this door", () => {
  const job = assembleFromFlags({ mark: "NOVAPULSE", forwarder: "jordan", classes: "9", deliveryRoute: "email" });
  assert.equal(job.deliveryRoute, "email", "the shared assembler dropped the lane");
  // Through the whole of main(), which is where the door gates run.
  const r = spawnSync(process.execPath, [CLI, "--mark", "NOVAPULSE", "--classes", "9", "--forwarder", "jordan",
    "--delivery-route", "portal", "--dry-run"], { encoding: "utf8" });
  assert.notEqual(r.status, 0, "the CLI queued a portal-route job");
  assert.match(r.stdout + r.stderr, /is not available in this build yet/);
});
