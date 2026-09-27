// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// a-cap-of-zero-is-not-a-register-outcome.test.mjs — report-data carries the cap beside the flag.
//
// `listRegisterRecords` folds a cap of zero, a negative and a NaN into the same `markCap = 0`, which
// fetches nothing and marks the listing capped. report-data then emitted `capped: true` and never the cap
// itself, so a consumer could not tell a listing TRUNCATED at fifty — a register outcome — from one a cap
// of zero stopped before it began, which is a configuration. Both read as "the listing was capped".
//
// The run has always recorded the truth: it writes `cap` per mark beside `capped`. Nothing read it.
//
// WHAT THIS DOES NOT DO. It changes no sentence on the page. A cap of zero leaves every term `notAsked`,
// so the page says "the listing did not complete, so nothing here says whether one stands" — which is
// true, and which is not the same as saying a cap caused it. Saying that is new wording and therefore not
// this change.
//
// NULL IS NOT ZERO, and the last arm is the one that holds it: an archived run that recorded no cap must
// not arrive as a cap of zero, or a run that predates the field and a misconfigured one become one case.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";
import { publishKnockout } from "../publish/knockout.mjs";

const NAME = "IRONWHISK";
const FRAMEWORK = { framework_key: "house-triage", title: "t",
  bands: [{ label: "Medium", tone: "medium" }, { label: "Manageable", tone: "low" }, { label: "Low", tone: "minimal" }] };

/** Publish a run whose filings sidecar holds `entry`, and return that mark's filings block in report-data. */
async function filingsData(entry) {
  const root = mkdtempSync(join(tmpdir(), "cap-zero-"));
  const runDir = mkdtempSync(join(root, "run-"));
  mkdirSync(driverDir(runDir), { recursive: true });
  writeFileSync(driverDir(runDir, "framework.json"), JSON.stringify(FRAMEWORK));
  writeFileSync(driverDir(runDir, "register-records.json"),
    JSON.stringify({ provider: "signa", marks: [{ name: NAME, ...entry }] }));
  const poolRoot = mkdtempSync(join(root, "pool-"));
  const runId = `cap-${Math.random().toString(36).slice(2, 8)}`;
  await publishKnockout({
    runId, codename: "fixture", runDir, framework: FRAMEWORK, overall: "Low",
    findings: { marks: [{ name: NAME, rating: "Low", bullets: ["Synthetic fixture."], findings: [] }] },
    poolRoot, poolUrl: "https://trademark.test", customerKey: "generic", skipRegen: true,
  });
  return { data: JSON.parse(readFileSync(join(poolRoot, runId, "report-data.json"), "utf8")) };
}

/** Every `cap`/`capped` pair report-data carries, wherever the payload nests them. */
const capPairs = (data) => {
  const out = [];
  const walk = (n) => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) return n.forEach(walk);
    if ("capped" in n) out.push({ capped: n.capped, cap: n.cap });
    Object.values(n).forEach(walk);
  };
  walk(data);
  return out;
};

const TERMS_STOPPED = [{ term: NAME, basis: "identical", ok: false, notAsked: true, fetched: 0,
  reason: "the 0-record cap for this name was reached before this form was fetched" }];

test("a cap of ZERO reaches report-data as a cap of zero, not merely as 'capped'", async () => {
  const { data } = await filingsData({ records: [], capped: true, cap: 0, fetched: 0, terms: TERMS_STOPPED });
  const pairs = capPairs(data).filter((p) => p.capped === true);
  assert.ok(pairs.length, "no capped filings block reached report-data at all");
  assert.ok(pairs.some((p) => p.cap === 0),
    `the cap the run recorded is not in the payload: ${JSON.stringify(pairs)}`);
});

test("a listing TRUNCATED at a real cap is distinguishable from the one above", async () => {
  // The control. Without it the arm above passes on a payload that hard-codes a zero.
  const { data } = await filingsData({
    records: [{ recordId: "R1", mark: NAME, owner: "o", status: "Registered", classes: [9], territory: "UK" }],
    capped: true, cap: 50, fetched: 1,
    terms: [{ term: NAME, basis: "identical", ok: true, fetched: 1 }],
  });
  const pairs = capPairs(data).filter((p) => p.capped === true);
  assert.ok(pairs.some((p) => p.cap === 50), `the real cap is not in the payload: ${JSON.stringify(pairs)}`);
  assert.ok(!pairs.some((p) => p.cap === 0), "a listing capped at fifty reports a cap of zero");
});

test("a sidecar that recorded NO cap arrives as null, never as zero", async () => {
  // An archived run predating the field. Null is a could-not-look; zero is a cap somebody set. Folding
  // them together would put an archived run and a misconfigured one on the same line — the distinction
  // the portal's allowance contract keeps for the same reason.
  const { data } = await filingsData({
    records: [{ recordId: "R1", mark: NAME, owner: "o", status: "Registered", classes: [9], territory: "UK" }],
    capped: false, fetched: 1, terms: [{ term: NAME, basis: "identical", ok: true, fetched: 1 }],
  });
  const pairs = capPairs(data).filter((p) => "cap" in p);
  assert.ok(pairs.length, "no filings block carrying a cap reached report-data");
  assert.ok(pairs.every((p) => p.cap === null),
    `a missing cap arrived as something other than null: ${JSON.stringify(pairs)}`);
});
