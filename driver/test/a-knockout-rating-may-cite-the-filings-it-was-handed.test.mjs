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
    assert.equal(cited(OTHER).ok, false, "another mark's filing licenses nothing");
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
    assert.match(bad.failures[0], /no research payload/, "the refusal is the one the check always gave");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
