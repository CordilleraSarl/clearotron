// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// AN OFFLINE RESUME ANSWERS ITS RECORDS FROM THE RUN, AND SENDS NOTHING TO THE REGISTER.
//
// A resume of a saved run from the writer's start was refused at its start for want of the register's key, and a
// stand-in key would have sent real register requests: the resume still checks every registration its findings cite,
// and fetches a cited record the run does not hold. With `--records replay` the resume needs no key, answers each such
// fetch from the run's own `_records/`, refuses a record the run does not hold by name, and refuses to start while the
// key is set. The resume below runs with every outgoing connection in this process refused and counted. Every mark
// below is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import https from "node:https";
import { mkdtempSync, readFileSync, rmSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { driverDir } from "../../shared/driver-dir.mjs";
import { pinEnv } from "../../shared/env-aliases.mjs";
import { writeRecordArtifacts } from "../registry-fidelity.mjs";
import { savedRecordFetch, heldRegisterCredentials, RECORD_REPLAY_REFUSAL } from "../record-replay.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLAUDE = join(HERE, "mock-claude.mjs");
chmodSync(CLAUDE, 0o755);

test("a record the run holds is answered from the run; any other is refused by name, and nothing is fetched", async (t) => {
  const d = mkdtempSync(join(tmpdir(), "record-replay-"));
  t.after(() => rmSync(d, { recursive: true, force: true }));
  writeRecordArtifacts(d, new Map([["/mark/us/86272665", { mark_text: "QZORVEL", registrationNumber: "4641314" }]]));
  assert.deepEqual(await savedRecordFetch(d, "/mark/US/86272665"), { ok: true, saved: true });
  assert.deepEqual(await savedRecordFetch(d, "/mark/eu/018922211"), { ok: false, cause: RECORD_REPLAY_REFUSAL });
  assert.deepEqual(await savedRecordFetch(null, "/mark/us/86272665"), { ok: false, cause: RECORD_REPLAY_REFUSAL });
});

test("every register credential that is set is named, a blank one is not, and an absent key names none", () => {
  const p = { credEnv: "EXAMPLE_KEY", credEnvAlso: ["EXAMPLE_SECRET"] };
  assert.deepEqual(heldRegisterCredentials(p, { EXAMPLE_KEY: "x", EXAMPLE_SECRET: " " }), ["EXAMPLE_KEY"]);
  assert.deepEqual(heldRegisterCredentials(p, { EXAMPLE_SECRET: "y" }), ["EXAMPLE_SECRET"]);
  assert.deepEqual(heldRegisterCredentials(p, {}), []);
});

test("an offline resume runs with no register key, refuses the records it does not hold, and opens no connection", async (t) => {
  const ROOT = mkdtempSync(join(tmpdir(), "clearotron-record-replay-"));
  t.after(() => rmSync(ROOT, { recursive: true, force: true }));
  const vars = { CORSEARCH_SESSION_KEY: "test-offline", CLEAROTRON_BAND_TRUTH_GATE: "0", CLEAROTRON_AI: "anthropic-agent",
    CLEAROTRON_CLAUDE_PATH: CLAUDE, CLEAROTRON_WORK_DIR: ROOT, CLEAROTRON_REPORTS_DIR: join(ROOT, "pool"), CLEAROTRON_MAX_RETRIES: "0",
    CLEAROTRON_RECOVERY_MAX: "1", CLEAROTRON_SATPROBE_CODESIDE: "0", MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced",
    MOCK_FAIL_STAGE: "joint synthesis narrative" };
  const saved0 = {};
  for (const [k, v] of Object.entries(vars)) { saved0[k] = process.env[k]; pinEnv(process.env, k, v); }
  t.after(() => { for (const [k, v] of Object.entries(saved0)) { if (v === undefined) delete process.env[k]; else pinEnv(process.env, k, v); } });

  const PL = await import("../pipeline.mjs");
  const job = { id: "job-TMPRECREPLAY1", msgId: "<TMPRECREPLAY1@x>", forwarder: "jordan", forwarderDomain: "example.com",
    ref: "TMPRECREPLAY1", markName: "MARK TMPRECREPLAY1", classes: [9, 41], provider: "corsearch" };
  const parked = await PL.pipeline(job);
  assert.equal(parked.postponed, true, "guard: the mock run parks at the writer, so there is a saved run to resume");
  delete process.env.MOCK_FAIL_STAGE;
  const codename = basename(parked.runDir).replace(/^\d{4}-\d\d-\d\d-/, "");

  // THE CONTROL: with no key and no flag the resume is refused at its start, as it was on saved data.
  delete process.env.CORSEARCH_SESSION_KEY;
  await assert.rejects(() => PL.pipeline(job, { codename }), /\[preflight\] missing CORSEARCH_SESSION_KEY/);
  // With the key set, the replay is refused before it starts: a stage's register tools would read it.
  pinEnv(process.env, "CORSEARCH_SESSION_KEY", "test-offline");
  await assert.rejects(() => PL.pipeline(job, { codename, records: "replay" }), /--records replay: CORSEARCH_SESSION_KEY is set/);
  await assert.rejects(() => PL.pipeline(job, { codename, records: "replayed" }), /--records: unknown value "replayed"/);
  delete process.env.CORSEARCH_SESSION_KEY;

  // EVERY OUTGOING CONNECTION THIS PROCESS TRIES IS REFUSED AND COUNTED, a fetch as well as a raw socket.
  const tried = [];
  const connect0 = net.Socket.prototype.connect, fetch0 = globalThis.fetch;
  net.Socket.prototype.connect = function (...a) {
    const o = a[0];
    tried.push(typeof o === "object" && o ? String(o.host ?? o.path ?? o.port) : String(o));
    throw new Error("an offline resume opened a connection");
  };
  globalThis.fetch = async (u) => { tried.push(String(u)); throw new Error("an offline resume called fetch"); };
  let res;
  try {
    // THE TRAP CATCHES A REAL REQUEST: an https request reaches the counted refusal, so an empty count below is evidence.
    try { https.get("https://register.example.invalid/record").on("error", () => {}); } catch { /* refused by the trap */ }
    assert.equal(tried.length, 1, "the trap did not catch an https request, so it proves nothing about the resume");
    tried.length = 0;
    res = await PL.pipeline(job, { codename, records: "replay" });
  }
  finally { net.Socket.prototype.connect = connect0; globalThis.fetch = fetch0; }
  assert.deepEqual(tried, [], "the offline resume opened a connection");
  assert.equal(res.ok, true, "the offline resume did not deliver");

  const events = readFileSync(driverDir(res.runDir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.ok(events.some((e) => e.event === "records-replay"), "the run does not record that its records were replayed");
  // The findings cite a registration this run never fetched: it is refused by name, and the run ships it unverified.
  const closure = events.find((e) => e.event === "registry-record-closure");
  assert.ok(closure?.failed?.length > 0, "guard: the closure asked for no record, so the replay was never exercised");
  assert.equal(closure.fetched, 0);
  for (const f of closure.failed) assert.equal(f.cause, RECORD_REPLAY_REFUSAL, `${f.uri} was refused for another reason: ${f.cause}`);
});
