// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A KNOCKOUT'S WEB SWEEP RUNS BESIDE ITS REGISTER READING once the counts have passed their check, and not at all when the count
// check fails. Names here are invented.
import { mkdirSync, mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { pinEnv } from "../../shared/env-aliases.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = mkdtempSync(join(tmpdir(), "ko-overlap-"));
pinEnv(process.env, "CLEAROTRON_WORK_DIR", join(ROOT, "work"));
pinEnv(process.env, "CLEAROTRON_REPORTS_DIR", join(ROOT, "pool"));
pinEnv(process.env, "CLEAROTRON_DATABASE", "signa");
pinEnv(process.env, "CLEAROTRON_REGISTER_CALL_LOG", join(ROOT, "register-calls.jsonl"));
pinEnv(process.env, "CLEAROTRON_REGISTER_RECORD_LOG", undefined);
pinEnv(process.env, "CLEAROTRON_SIGNA_ANSWER_MEMORY", undefined);
pinEnv(process.env, "CLEAROTRON_INSTRUCTIONS_DIR", undefined);
pinEnv(process.env, "CLEAROTRON_CLAUDE_PATH", join(HERE, "mock-claude.mjs"));
pinEnv(process.env, "CLEAROTRON_CODEX_PATH", join(HERE, "mock-codex.mjs"));
process.env.CLEAROTRON_MAX_RETRIES = "0";
process.env.CLEAROTRON_RECOVERY_MAX = "0";
process.env.MOCK_VERDICT = "CLEAR";
process.env.MOCK_SKEPTIC = "no flags surfaced";

import { test } from "node:test";
import assert from "node:assert/strict";

const { driverDir } = await import("../../shared/driver-dir.mjs");
const { knockoutInner } = await import("../pipeline-knockout.mjs");
const { koPaths } = await import("../stages-knockout.mjs");
const { answeredGrid } = await import("./knockout-grid-fixture.mjs");

const NAMES = ["QUILLBRAE", "MOSSVALE", "LANTERNWICK", "ODRAVEL", "NOVAPULSE", "IRONWHISK", "CLUVENDRA", "BRIMSTARE", "TALLOWMERE", "PEBBLEWAY"];
const MOCK_KEYS = ["MOCK_FAIL_STAGE"];

/** One knockout of these names through the lane, on the mock engine. What the run left, whether or not it delivered. */
async function knockout(codename, names, env = {}, executors = {}) {
  for (const k of MOCK_KEYS) delete process.env[k];
  for (const [k, v] of Object.entries({ CLEAROTRON_AI: "anthropic-agent", ...env })) process.env[k] = v;
  const id = `ko-${codename}`;
  const studioRoot = join(ROOT, "studio", id);
  const dir = join(studioRoot, "clearance-search", "runs", "quillbrae", `2026-11-06-${codename}`);
  mkdirSync(driverDir(dir), { recursive: true });
  const run = { runDir: dir, studioRoot, slug: "quillbrae", date: "2026-11-06", codename, archiveDir: join(studioRoot, "archive", `2026-11-06-${codename}`) };
  const job = { id, markName: names[0], marks: names.map((name) => ({ name })), classes: [4], jurisdictions: ["EU"], forwarder: "jordan", msgId: `<${id}@x>`, ref: `E2E-${codename}` };
  const ctx = { run, job, agent: "mailagent", paths: { runDir: dir }, profile: {}, searchPolicy: { level: "knockout-register", stageLabel: "Knockout + register", components: { registerProbe: true } } };
  let res = null, thrown = null;
  try {
    res = await knockoutInner(ctx, job, {
      recordLister: async () => ({ ok: true, total: 0, records: [] }),
      countExecutor: async () => ({ ok: true, total: 0 }),
      gridExecutor: async (spec) => answeredGrid(spec, [{ title: "An invented listing", url: "https://example.test/listing" }]),
      ...executors,
      sweepExecutor: async () => ({ ok: true, text: "An invented trader sells candles. https://example.test/trader" }),
    });
  } catch (e) { thrown = e; }
  const at = existsSync(dir) ? dir : run.archiveDir;
  const json = (p) => JSON.parse(readFileSync(p, "utf8"));
  const journal = !existsSync(driverDir(at, "run.jsonl")) ? [] : readFileSync(driverDir(at, "run.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  return { res, thrown, dir: at, json, journal, K: koPaths(at),
    findings: existsSync(join(at, "knockout-findings.json")) ? json(join(at, "knockout-findings.json")) : null };
}

test("the web sweep runs beside the register reading once the counts have passed, and not at all when no count was taken", async () => {
  const names = NAMES.slice(0, 2);
  const starts = [];
  const grid = async (spec) => { starts.push(Date.now()); return answeredGrid(spec, [{ title: "An invented listing", url: "https://example.test/listing" }]); };
  const FILING = { record_id: "/mark/em/invented-1", mark_text: names[0], owner_name: "Invented Owner GmbH", owner_country: "DE", status: "Registered", classes: [4], office: "em",
    raw: { classifications: [{ nice_class: 4, goods_services_text: "Candles; wicks." }] } };
  const held = { countExecutor: async (term, p) => ({ ok: true, total: term === names[0] && p.key === "identical" ? 1 : 0 }),
    // The listing takes a while, as a register's does, so a sweep that waited for it would start after it.
    recordLister: async (term) => { await new Promise((ok) => setTimeout(ok, 1500)); listed.push(Date.now()); return term === names[0] ? { ok: true, total: 1, records: [FILING] } : { ok: true, total: 0, records: [] }; } };
  const listed = [];
  const r = await knockout("sweep-beside", names, {}, { ...held, gridExecutor: grid });
  assert.equal(r.res?.ok, true, `the knockout did not deliver: ${r.thrown?.message ?? JSON.stringify(r.res)}`);
  assert.ok(listed.length > 0, "premise: the register was listed");
  assert.ok(starts.length === names.length && Math.min(...starts) < Math.max(...listed), "the sweep began while the register was still being read");
  starts.length = 0;
  const none = await knockout("no-count", names, {}, { gridExecutor: grid, countExecutor: async () => ({ ok: false, total: null, reason: "an invented outage" }) });
  assert.ok(none.thrown || none.res?.ok === false, "a batch with no count stops, as before");
  assert.equal(starts.length, 0, "and no web search is spent on it");
});
