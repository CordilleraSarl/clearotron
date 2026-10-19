// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A KNOCKOUT RATING MAY CITE THE FILINGS IT WAS HANDED, AND ONLY ITS OWN MARK'S.
//
// The rating step's message lets a cited address come from the mark's own research payload or from the
// register filings supplied for that mark, and the receipts check read the payload alone, so a citation of a
// filing the run had fetched and handed over was refused and cost a fresh session. The check now reads both.
// It still refuses an address held for another mark, and one held nowhere.
//
// Invented marks and addresses only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";
import { knockoutReceipts } from "../verify-knockout.mjs";

const FILING = "https://register.example.test/mark/lanternwick-001";
const OTHER = "https://register.example.test/mark/novapulse-002";

function runWithRecords() {
  const dir = mkdtempSync(join(tmpdir(), "ko-receipts-"));
  mkdirSync(driverDir(dir), { recursive: true });
  mkdirSync(join(dir, "research"), { recursive: true });
  writeFileSync(join(dir, "research", "lanternwick.md"), "# LANTERNWICK\n- https://wiki.example.test/lanternwick\n");
  writeFileSync(driverDir(dir, "register-records.json"), JSON.stringify({ schema: 1, marks: [
    { name: "LANTERNWICK", records: [{ owner: "Mystery Owner LLC", url: FILING }] },
    { name: "NOVAPULSE", records: [{ owner: "Zephyr Beverages", url: OTHER }] },
  ] }));
  return dir;
}

test("a citation of a filing supplied for the mark is held evidence, as one from its own payload is", () => {
  const dir = runWithRecords();
  try {
    const cited = (url) => knockoutReceipts(dir, [{ name: "LANTERNWICK", findings: [{ name: "An invented finding", url }] }]);
    assert.deepEqual(cited("https://wiki.example.test/lanternwick").failures, [], "the payload's own address");
    assert.deepEqual(cited(FILING).failures, [], "a filing supplied for this mark");
    assert.deepEqual(cited(OTHER).failures, [REFUSAL("LANTERNWICK", OTHER)], "another mark's filing licenses nothing");
    assert.equal(cited("https://nowhere.example.test/invented").ok, false, "an address held nowhere is refused");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a mark with no payload may still cite its own supplied filing, and nothing else", () => {
  const dir = runWithRecords();
  try {
    const r = knockoutReceipts(dir, [{ name: "NOVAPULSE", findings: [{ name: "An invented finding", url: OTHER }] }]);
    assert.deepEqual(r.failures, []);
    const bad = knockoutReceipts(dir, [{ name: "NOVAPULSE", findings: [{ name: "An invented finding", url: FILING }] }]);
    assert.equal(bad.ok, false);
    // The refusal names both kinds of held evidence, so it never tells the model to drop a supplied filing.
    assert.deepEqual(bad.failures, [REFUSAL("NOVAPULSE", FILING)]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── ONE RULE, IN EVERY PLACE THE RATING STEP READS IT ─────────────────────────────────────────────────
// The step's message, its manual and the refusal it meets all state the same rule (design's wording, 2026-10-19).
// They are engine-independent strings, composed once here; the manual reaches both engines through the step's reads.
const RULE = "A cited URL must appear in the mark's own research payload or in the register records supplied for that mark.";
function REFUSAL(mark, url) {
  return `knockout_url_unreceipted:${mark}: "${url}" does not appear in the mark's own research payload or in the register records supplied for that mark — cite only held evidence`;
}
test("the rating step's message, its manual and its refusal state one citation rule, and none the old one", async () => {
  const { KO_STAGES, koPaths } = await import("../stages-knockout.mjs");
  const { readFileSync } = await import("node:fs");
  const step = Object.values(KO_STAGES).find((s) => Array.isArray(s?.skillReads) && s.skillReads.includes("skills/knockout-assess/SKILL.md"));
  assert.ok(step, "premise: the rating step is not found by its manual");
  const msg = String(step.message({ K: koPaths("/run"), job: {}, chunkNo: 0, chunkMarks: [{ name: "LANTERNWICK" }], chunkTotal: 1, probeNote: "",
    framework: { bands: [{ label: "High" }, { label: "Manageable" }] }, frameworkPath: null }));
  const manual = readFileSync(new URL("../skills/knockout-assess/SKILL.md", import.meta.url), "utf8");
  assert.ok(msg.includes("skills/knockout-assess/SKILL.md"), "premise: the message names the manual");
  for (const [where, text] of [["the message", msg], ["the manual", manual.replace(/\s+/g, " ")]]) {
    assert.ok(text.includes(RULE), `${where} does not state the rule`);
    assert.doesNotMatch(text, /THAT mark's research payload|a degraded mark cannot cite URLs/, `${where} still states the old rule`);
  }
});
