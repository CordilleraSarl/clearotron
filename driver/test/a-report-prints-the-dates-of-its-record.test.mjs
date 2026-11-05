// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A REPORT PRINTS THE DATES OF ITS RECORD.
//
// Opening or republishing a report does not mean a new search happened. The knockout publisher stamped the clock as
// both "Searched on" and "Issued on", so a demo's finished example read as searched today. The clearance publisher
// stamped "Issued on" the same way, and both kept the first issue time in meta.json, which the page then disagreed with.
//
// DRIVEN THROUGH republishRun, the function the demo and an ordinary republish both call, over the demo's own runs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { reportDates, zurichStamp } from "../publish/report-dates.mjs";

const { republishRun } = await import("../publish/report-registry.mjs");
const DEMO = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "demo");

const NOW = new Date("2031-03-03T10:00:00.000Z");

/** A demo run copied where a publish may write, with an empty pool, and how to publish it. */
function sample(name) {
  const home = mkdtempSync(join(tmpdir(), "report-dates-"));
  const runDir = join(home, "run");
  cpSync(join(DEMO, name, "run"), runDir, { recursive: true });
  const meta = JSON.parse(readFileSync(join(DEMO, name, "meta.json"), "utf8"));
  const status = JSON.parse(readFileSync(join(runDir, "status.json"), "utf8"));
  const pool = join(home, "pool");
  mkdirSync(pool, { recursive: true });
  const read = (file) => readFileSync(join(pool, meta.runId, file), "utf8");
  return { home, status, read, publish: () => republishRun({ runId: meta.runId, meta, pool, poolUrl: "", runDir, skipRegen: true }),
    keepIssuedAt: (iso) => { const m = JSON.parse(read("meta.json")); m.issuedAt = iso; writeFileSync(join(pool, meta.runId, "meta.json"), JSON.stringify(m)); } };
}

const zurichDate = (iso) => zurichStamp(iso).slice(0, 10);

test("the record decides each date, and the clock only a first publish with no record of one", () => {
  const home = mkdtempSync(join(tmpdir(), "report-dates-"));
  try {
    const runDir = join(home, "run"), poolRunDir = join(home, "pool");
    mkdirSync(runDir); mkdirSync(poolRunDir);
    const iso = NOW.toISOString();
    assert.deepEqual(reportDates({ runDir, poolRunDir, now: NOW }), { searchedAt: null, issuedAt: iso, renderedAt: iso }, "no record: a first publish, and no search date to print");
    writeFileSync(join(runDir, "status.json"), JSON.stringify({ startedAt: "2026-09-18T12:00:00.000Z" }));
    assert.deepEqual(reportDates({ runDir, poolRunDir, now: NOW }), { searchedAt: "2026-09-18T12:00:00.000Z", issuedAt: iso, renderedAt: iso }, "a live run's first publish, before its delivery is recorded");
    writeFileSync(join(runDir, "status.json"), JSON.stringify({ startedAt: "2026-09-18T12:00:00.000Z", deliveredAt: "2026-09-18T13:00:00.000Z" }));
    assert.equal(reportDates({ runDir, poolRunDir, now: NOW }).issuedAt, "2026-09-18T13:00:00.000Z", "a delivered run republished into an empty pool");
    writeFileSync(join(poolRunDir, "meta.json"), JSON.stringify({ issuedAt: "2026-09-19T08:00:00.000Z" }));
    assert.equal(reportDates({ runDir, poolRunDir, now: NOW }).issuedAt, "2026-09-19T08:00:00.000Z", "the first issue time the pool kept wins");
    writeFileSync(join(runDir, "status.json"), JSON.stringify({ startedAt: "not a time" }));
    assert.equal(reportDates({ runDir, poolRunDir, now: NOW }).searchedAt, null, "a value that is no time is no search date");
  } finally { rmSync(home, { recursive: true, force: true }); }
});

for (const [label, name] of [["a knockout", "knockout-search"], ["a clearance", "global-preliminary-search"]]) {
  test(`${label}: a demo's example keeps its recorded issue date, and a republish neither moves it nor loses the render time`, async () => {
    const s = sample(name);
    try {
      await s.publish();
      const first = JSON.parse(s.read("meta.json"));
      assert.equal(first.issuedAt, s.status.deliveredAt, "the record's delivery is the first issue");
      assert.ok(s.read("report.html").includes(`Issued on ${zurichDate(s.status.deliveredAt)}`), "the page does not print the record's issue date");
      assert.ok(first.renderedAt && first.renderedAt !== first.issuedAt, "the time of this publish is not recorded apart");
      // An ordinary republish over a pool that holds an earlier issue time.
      s.keepIssuedAt("2026-10-01T09:00:00.000Z");
      await s.publish();
      const again = JSON.parse(s.read("meta.json"));
      assert.equal(again.issuedAt, "2026-10-01T09:00:00.000Z", "a republish moved the first issue time");
      assert.ok(s.read("report.html").includes("Issued on 2026-10-01"), "the page disagrees with the issue time its own record kept");
      assert.ok(Date.parse(again.renderedAt) >= Date.parse(first.renderedAt), "the render time did not move with the render");
    } finally { rmSync(s.home, { recursive: true, force: true }); }
  });
}

test("a knockout's Searched on is when its run started, and its catalogue date stays with the first issue", async () => {
  const s = sample("knockout-search");
  try {
    await s.publish();
    assert.match(s.read("report.html"), new RegExp(`Searched on</span><span class="v">${zurichStamp(s.status.startedAt)}`), "the page does not print the run's start as Searched on");
    assert.equal(JSON.parse(s.read("meta.json")).date, s.status.deliveredAt.slice(0, 10), "the catalogue date follows the clock");
  } finally { rmSync(s.home, { recursive: true, force: true }); }
});

test("a knockout with no recorded start prints no search date, and never today", async () => {
  const s = sample("knockout-search");
  try {
    const status = join(s.home, "run", "status.json");
    const { startedAt: _gone, ...rest } = s.status;
    writeFileSync(status, JSON.stringify(rest));
    await s.publish();
    assert.doesNotMatch(s.read("report.html"), /Searched on/, "a report with no search date printed one");
  } finally { rmSync(s.home, { recursive: true, force: true }); }
});
