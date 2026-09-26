// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// On a register whose listing carries the register's own total, a knockout lists before it counts, so the
// identical and close counts come from the listing instead of being paid for twice. The owner lookups rode
// inside the listing, so they ran before the count gate as well: on a batch where not one mark got a
// number, the run stopped at that gate after paying for a research call per promoted owner.
//
// The lookups now run after the gate, on either order. A batch that stops there has paid for none; a batch
// that counts still gets every lookup it was owed. The knockout runs end to end on the repo's mock model,
// with the register and research calls injected, so nothing here reaches a network.
import { mkdirSync, mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pinEnv, envFrom } from "../../shared/env-aliases.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = mkdtempSync(join(tmpdir(), "owner-lookup-after-gate-"));
pinEnv(process.env, "CLEAROTRON_WORK_DIR", envFrom(process.env, "CLEAROTRON_WORK_DIR") || join(ROOT, "ws"));
pinEnv(process.env, "CLEAROTRON_REPORTS_DIR", join(ROOT, "pool"));
pinEnv(process.env, "CLEAROTRON_DATABASE", "signa");
pinEnv(process.env, "CLEAROTRON_REGISTER_CALL_LOG", join(ROOT, "register-calls.jsonl"));
pinEnv(process.env, "CLEAROTRON_REGISTER_RECORD_LOG", undefined);
pinEnv(process.env, "CLEAROTRON_SIGNA_ANSWER_MEMORY", undefined);
pinEnv(process.env, "CLEAROTRON_INSTRUCTIONS_DIR", undefined);
process.env.CLEAROTRON_AGENT = "mailagent";
process.env.CLEAROTRON_AI = "anthropic-agent";
pinEnv(process.env, "CLEAROTRON_CLAUDE_PATH", join(HERE, "mock-claude.mjs"));
process.env.CLEAROTRON_MAX_RETRIES = "0";
process.env.CLEAROTRON_RECOVERY_MAX = "0";
process.env.MOCK_VERDICT = "CLEAR";
process.env.MOCK_SKEPTIC = "no flags surfaced";

import { test } from "node:test";
import assert from "node:assert/strict";

const { driverDir } = await import("../../shared/driver-dir.mjs");
const { capabilitiesFor } = await import("../register-capabilities.mjs");
const { knockoutInner } = await import("../pipeline-knockout.mjs");
const { answeredGrid } = await import("./knockout-grid-fixture.mjs");

// A live filing in the searched class, with an owner: exactly what earns an owner lookup.
const FILING = { record_id: "tm_1", mark_text: "LANTERNWICK", owner_name: "Brightmoor Candle Co", status: "Registered", classes: [4] };
const OWNER_QUESTION = /What goods or services does the company "Brightmoor Candle Co"/;

async function knockout(codename, { countsLand }) {
  const id = `ko-${codename}`;
  const studioRoot = join(ROOT, "studio", id);
  const dir = join(studioRoot, "clearance-search", "runs", "lanternwick", `2026-09-23-${codename}`);
  mkdirSync(driverDir(dir), { recursive: true });
  const run = { runDir: dir, studioRoot, slug: "lanternwick", date: "2026-09-23", codename, archiveDir: join(studioRoot, "archive", `2026-09-23-${codename}`) };
  const job = { id, markName: "LANTERNWICK", marks: [{ name: "LANTERNWICK" }], classes: [4], jurisdictions: ["EU"],
    forwarder: "jordan", msgId: `<${id}@x>`, ref: `E2E-${codename}` };
  const ctx = { run, job, agent: "mailagent", paths: { runDir: dir }, profile: {},
    searchPolicy: { level: "knockout-register", stageLabel: "Knockout + register", components: { registerProbe: true } } };
  const order = [];
  let res = null, failure = null;
  try {
    res = await knockoutInner(ctx, job, {
      recordLister: async (term) => { order.push(`list:${term}`); return { ok: true, total: null, records: term === "LANTERNWICK" ? [FILING] : [] }; },
      countExecutor: async (term, p) => {
        order.push(`count:${p.key}:${term}`);
        return countsLand ? { ok: true, total: 3 } : { ok: false, total: null, reason: "HTTP 503: the register is down" };
      },
      gridExecutor: async (spec) => {
        order.push("sweep");
        return answeredGrid(spec, [{ title: "Lanternwick candles", url: "https://example.test/lanternwick" }]);
      },
      sweepExecutor: async (task) => {
        order.push(OWNER_QUESTION.test(task) ? "owner-lookup" : "question");
        return { ok: true, text: "Brightmoor sells candles. https://example.test/brightmoor" };
      },
    });
  } catch (e) { failure = e; }
  // A delivered run moves to its archive folder, and reports where; a stopped one stays where it began.
  return { res, failure, order, dir: res?.runDir ?? dir };
}

test("the fixture's register lists first, so the order below is the one a listing-first register takes", () => {
  assert.equal(capabilitiesFor("signa").listingAnswersCount, true);
});

test("a batch where not one count lands stops at the gate without paying for an owner lookup", async () => {
  const { res, failure, order, dir } = await knockout("counts-fail", { countsLand: false });
  assert.ok(failure || res?.ok === false, `the batch should have stopped at the count gate: ${JSON.stringify(res)}`);
  assert.match(String(failure?.message ?? res?.reason ?? ""), /no register count could be taken/);
  assert.ok(order.some((o) => o.startsWith("list:")), `the listing ran first, as this register does: ${order.join(" → ")}`);
  assert.ok(order.some((o) => o.startsWith("count:")), "the counts were asked");
  assert.equal(order.filter((o) => o === "owner-lookup").length, 0, `no owner lookup was paid for: ${order.join(" → ")}`);
  assert.equal(existsSync(driverDir(dir, "run.jsonl")), true, "the stopped run's folder is the one read below");
  assert.equal(existsSync(driverDir(dir, "owner-checks.json")), false, "and no owner-check record was written");
});

test("THE CONTROL: when the counts land, the owed owner lookup runs, after them", async () => {
  const { res, order, dir } = await knockout("counts-land", { countsLand: true });
  assert.equal(res?.ok, true, `the knockout did not deliver: ${JSON.stringify(res)}`);
  const lookups = order.map((o, i) => [o, i]).filter(([o]) => o === "owner-lookup");
  assert.equal(lookups.length, 1, `one promoted owner, one lookup: ${order.join(" → ")}`);
  const lastCount = order.map((o) => o.startsWith("count:")).lastIndexOf(true);
  assert.ok(lookups[0][1] > lastCount, `the lookup came after the counts: ${order.join(" → ")}`);
  assert.equal(existsSync(driverDir(dir, "owner-checks.json")), true, "the owner-check record is where the arm above looks for it");
});
