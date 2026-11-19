// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A STOPPED KNOCKOUT STARTS NO PAID CALL. Measured on the test instance, 2026-11-19: a Knockout stopped during its
// register read went on to its owner checks and made six paid web searches after the stop, until the worker itself was
// stopped. Two things let it. The register read's failure was caught as non-fatal, the stop with it, so the lane carried
// on; and the calls the lane makes itself (the counts, the web grid, the owner checks) never read the stop, which the
// gateway reads only before a model turn.
//
// So two shapes, because either fix alone passes one of them. A stop that ends the turn, the measured one: the gateway's
// next attempt meets it and throws, and the lane must not swallow that. A stop recorded while the turn still finishes:
// nothing throws, and only a call that reads the stop before it starts can keep the owner checks from running. In both,
// every paid call the code makes is counted by the moment it started, against the moment of the stop. Every name is
// invented.
import { mkdirSync, mkdtempSync, existsSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pinEnv, envFrom } from "../../shared/env-aliases.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = mkdtempSync(join(tmpdir(), "knockout-stop-spend-"));
pinEnv(process.env, "CLEAROTRON_WORK_DIR", envFrom(process.env, "CLEAROTRON_WORK_DIR") || join(ROOT, "ws"));
pinEnv(process.env, "CLEAROTRON_REPORTS_DIR", join(ROOT, "pool"));
pinEnv(process.env, "CLEAROTRON_DATABASE", "signa");
pinEnv(process.env, "CLEAROTRON_REGISTER_CALL_LOG", join(ROOT, "register-calls.jsonl"));
pinEnv(process.env, "CLEAROTRON_REGISTER_RECORD_LOG", undefined);
pinEnv(process.env, "CLEAROTRON_SIGNA_ANSWER_MEMORY", undefined);
pinEnv(process.env, "CLEAROTRON_INSTRUCTIONS_DIR", undefined);
process.env.CLEAROTRON_AI = "anthropic-agent";
pinEnv(process.env, "CLEAROTRON_CLAUDE_PATH", join(HERE, "mock-claude.mjs"));
process.env.CLEAROTRON_RECOVERY_MAX = "0";
process.env.MOCK_VERDICT = "CLEAR";
process.env.MOCK_SKEPTIC = "no flags surfaced";
process.env.MOCK_KO_CHECK_OWNERS = "1";   // the reading asks for its filings' owners to be searched, so owner checks are owed

import { test } from "node:test";
import assert from "node:assert/strict";

const { driverDir } = await import("../../shared/driver-dir.mjs");
const { knockoutInner } = await import("../pipeline-knockout.mjs");
const { answeredGrid } = await import("./knockout-grid-fixture.mjs");
const { fixtureFileName } = await import("../register-records.mjs");

const NAMES = ["LANTERNWICK", "QUILLBRAE"];
const filing = (id, mark, owner) => ({ record_id: `/mark/em/${id}`, mark_text: mark, owner_name: owner, status: "Registered", classes: [4], office: "em" });

/** One Knockout through the lane on the stage path, every paid call it makes itself recorded by when it started. */
async function knockout(codename, env = {}) {
  const fixtures = join(ROOT, `records-${codename}`);
  mkdirSync(fixtures, { recursive: true });
  for (const [i, name] of NAMES.entries())
    writeFileSync(join(fixtures, fixtureFileName(name, {})), JSON.stringify({ records: [filing(`${i}1`, name, `Brightmoor ${i} Ltd`), filing(`${i}2`, name, `Holloway ${i} GmbH`)], total: 2 }));
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  const id = `ko-${codename}`;
  const studioRoot = join(ROOT, "studio", id);
  const dir = join(studioRoot, "clearance-search", "runs", "lanternwick", `2026-11-19-${codename}`);
  mkdirSync(driverDir(dir), { recursive: true });
  const run = { runDir: dir, studioRoot, slug: "lanternwick", date: "2026-11-19", codename, archiveDir: join(studioRoot, "archive", `2026-11-19-${codename}`) };
  const job = { id, markName: NAMES[0], marks: NAMES.map((name) => ({ name })), classes: [4], jurisdictions: ["EU"],
    forwarder: "jordan", msgId: `<${id}@x>`, ref: `E2E-${codename}`, registerFixtures: { records: fixtures } };
  const ctx = { run, job, agent: "mailagent", paths: { runDir: dir }, profile: {},
    searchPolicy: { level: "knockout-register", stageLabel: "Knockout + register", components: { registerProbe: true } } };
  const calls = [];
  const at = (kind) => calls.push({ kind, at: Date.now() });
  let res = null, thrown = null;
  try {
    res = await knockoutInner(ctx, job, {
      countExecutor: async () => { at("count"); return { ok: true, total: 3 }; },
      gridExecutor: async (spec) => { at("web grid"); return answeredGrid(spec, [{ title: "An invented listing", url: "https://example.test/listing" }]); },
      sweepExecutor: async () => { at("owner check"); return { ok: true, text: "An invented trader sells candles. https://example.test/trader" }; },
    });
  } catch (e) { thrown = e; }
  finally { for (const k of Object.keys(env)) delete process.env[k]; }
  const stoppedAt = existsSync(join(dir, ".cancel")) ? Date.parse(JSON.parse(readFileSync(join(dir, ".cancel"), "utf8")).ts) : null;
  return { res, thrown, dir, calls, stoppedAt };
}

const after = ({ calls, stoppedAt }) => calls.filter((c) => c.at >= stoppedAt).map((c) => c.kind);
const journal = (dir) => readFileSync(driverDir(dir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
// A STOP IS RECORDED AS A STOP. Swallowed, it reads as a register read that failed, or as owner checks that went
// unanswered, and the run's record says something happened that did not.
const stopsRecordedAsFailures = (dir) => [
  ...journal(dir).filter((e) => e.event === "knockout-register-read-failed").map(() => "the register read recorded as failed"),
  ...(existsSync(join(dir, "owner-checks.json")) || existsSync(driverDir(dir, "owner-checks.json"))
    ? JSON.parse(readFileSync(existsSync(join(dir, "owner-checks.json")) ? join(dir, "owner-checks.json") : driverDir(dir, "owner-checks.json"), "utf8")).checks ?? [] : [])
    .filter((c) => /executor threw/.test(String(c?.cause ?? ""))).map(() => "an owner check recorded as unanswered"),
];
const settledCancelled = (dir) => JSON.parse(readFileSync(join(dir, "status.json"), "utf8")).state;

test("CONTROL: with no stop the lane makes its owner checks, so the arms below are about the stop", async () => {
  const r = await knockout("no-stop", { CLEAROTRON_MAX_RETRIES: "0" });
  assert.equal(r.res?.ok, true, `the Knockout did not deliver: ${String(r.thrown?.message ?? JSON.stringify(r.res)).slice(0, 300)}`);
  assert.ok(r.calls.some((c) => c.kind === "owner check"), `no owner check was made, so nothing below can show one stopped: ${JSON.stringify(r.calls.map((c) => c.kind))}`);
});

test("a stop that ends the register read's turn is not swallowed: no paid call starts after it, and the run ends cancelled", async () => {
  const r = await knockout("stop-ends-the-turn", { MOCK_KO_READ_STOP: "fail", CLEAROTRON_MAX_RETRIES: "1" });
  assert.ok(r.stoppedAt, "premise: the stop was recorded during the register read");
  assert.deepEqual(after(r), [], "paid calls started after the stop");
  assert.notEqual(r.res?.ok, true, "the stopped Knockout delivered");
  assert.equal(settledCancelled(r.dir), "cancelled", `the run did not settle cancelled${r.thrown ? ` (${String(r.thrown.message).slice(0, 160)})` : ""}`);
  assert.deepEqual(stopsRecordedAsFailures(r.dir), [], "the stop was swallowed and recorded as a failure");
});

test("a stop recorded while the register read's turn finishes starts no owner check: each paid call reads the stop", async () => {
  const r = await knockout("stop-turn-finishes", { MOCK_KO_READ_STOP: "complete", CLEAROTRON_MAX_RETRIES: "0" });
  assert.ok(r.stoppedAt, "premise: the stop was recorded during the register read");
  assert.deepEqual(after(r), [], "paid calls started after the stop, which nothing threw to prevent");
  assert.notEqual(r.res?.ok, true, "the stopped Knockout delivered");
  assert.equal(settledCancelled(r.dir), "cancelled", `the run did not settle cancelled${r.thrown ? ` (${String(r.thrown.message).slice(0, 160)})` : ""}`);
  assert.deepEqual(stopsRecordedAsFailures(r.dir), [], "the stop was swallowed and recorded as a failure");
});

// THE GUARD ITSELF, which the clearance lane's paid calls share: its record fetches (the screen gate's, the senior
// rights', the delivery gate's), the register plan's execution, the connotation searches, the native-language web
// searches and the own-registrations listing.
test("a guarded call runs while the run is not stopped, and a stopped run starts none", async () => {
  const { stopsWithTheRun, requestCancel, RunCancelled } = await import("../cancel.mjs");
  const dir = mkdtempSync(join(ROOT, "guard-"));
  let started = 0;
  const call = stopsWithTheRun(dir, "a paid call", async (x) => { started++; return x * 2; });
  assert.equal(await call(21), 42);
  requestCancel(dir, { via: "test", by: "test" });
  await assert.rejects(() => call(1), (e) => e instanceof RunCancelled);
  assert.equal(started, 1, "the stopped run started the call");
  assert.equal(stopsWithTheRun(dir, "absent", null), null, "an executor that is not there stays not there");
});
