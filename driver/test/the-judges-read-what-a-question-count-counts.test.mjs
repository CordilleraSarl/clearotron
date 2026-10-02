// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier fast — the judges' list of register questions, on invented names
//
// THE JUDGES READ WHAT A QUESTION'S COUNT COUNTS (ruled 2026-10-02: record only).
//
// The judges' question list gives each question the register's own count. Where the register answered one
// row per record, that count counts a mark once for each country it covers, and the list says so beside the
// count, in the ruling's words. Where the register said nothing, the list is as it was.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";
import { joinPlanToBands } from "../register-plan.mjs";
import { parseNamedBand } from "../named-band.mjs";
import { loadPile } from "../pile.mjs";
import { makeOwnerTools } from "../owner-tools.mjs";

const DIR = mkdtempSync(join(tmpdir(), "judges-total-counts-"));
after(() => rmSync(DIR, { recursive: true, force: true }));

const PLAN = { plan_version: 1, regions: ["US"], entries: [
  { qid: "q-crowd", predicate: "contains", term: "QZXV", nice_classes: ["9"], goods_text: ["software"] },
  { qid: "q-plain", predicate: "contains", term: "QZXW", nice_classes: ["9"] },
] };
const BLOCKS = [
  { qid: "q-crowd", state: "incomplete", total_hits: 1756, fetched: 0, sample: [], reason: "a crowd", total_counts: "records" },
  { qid: "q-plain", state: "incomplete", total_hits: 912, fetched: 0, sample: [], reason: "a crowd" },
];

test("a count the register said counts records says so beside it, and one it said nothing about is as it was", () => {
  mkdirSync(driverDir(DIR), { recursive: true });
  writeFileSync(driverDir(DIR, "register-plan.json"), JSON.stringify(PLAN));
  writeFileSync(driverDir(DIR, "plan-execution.json"), JSON.stringify({ executed: joinPlanToBands(PLAN, { "primary-sweep": BLOCKS }).executed }));
  writeFileSync(join(DIR, "register-named-band.json"), JSON.stringify(parseNamedBand(BLOCKS)));
  const tools = makeOwnerTools(loadPile(DIR));
  const { questions } = tools.serve("register_questions", {}).result;
  const byWord = (w) => questions.find((q) => q.words.includes(w));
  assert.equal(byWord("QZXV").count, 1756);
  assert.equal(byWord("QZXV").counts, "records, one per country a mark covers");
  assert.equal(byWord("QZXW").count, 912);
  assert.equal("counts" in byWord("QZXW"), false, "a statement the register never made");
});
