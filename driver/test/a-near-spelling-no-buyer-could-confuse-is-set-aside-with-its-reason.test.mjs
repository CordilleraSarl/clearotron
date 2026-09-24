// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A NEAR SPELLING NO BUYER COULD CONFUSE IS SET ASIDE WITH ITS REASON, NOT CARRIED AS A FINDING.
//
// The spelling band is asked as the machine writes it, and what it returns is read like any list: carry
// what a buyer in the market could take for the mark by sound, by look or by meaning, and record the rest
// as set aside with a reason. The reader that carries or drops a record is the register digest, and until
// this change it could drop a live record in the client's classes only for its goods or as a duplicate,
// so a near spelling in the client's own goods had nowhere to go but the findings. This drives the new
// `sign` ground from the digest's call to the audit workbook the reviewing lawyer reads.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import { acceptRegisterDigest, emptyFacts, joinKey, DIGEST_DROP_REASONS, DIGEST_DROP_REASON_TOKENS } from "../register-digest-record.mjs";
import { buildAuditMd, parseSpineFindingBlocks } from "../publish/audit-from-spine.mjs";
import { parseAudit } from "../publish/parse.mjs";
import { buildAudit, searchRows } from "../publish/xlsx.mjs";
import { findScreenGateViolations } from "../screen-gate.mjs";

const DRIVER = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(DRIVER, rel), "utf8");

// The owner's sentence, word for word (tracker issue 922, sentence 2).
const SENTENCE_2 = "The spelling band is asked as the machine writes it. What it returns is a pile like any other: look at how much, read what a buyer in this market could take for the mark by sound, by look or by meaning, carry only that, and record the rest as set aside with your reason. Where the mark's dominant element has a sound-alike root the machine did not write, ask for it.";
const READER_SENTENCE = "The spelling band is read differently: carry a near spelling only where a buyer in this market could take it for the mark by sound, by look or by meaning, and record each other one as a drop on the ground `sign`, with your reason.";

// The identical mark, carried; and a near spelling in the same class, live and in scope, set aside on its sign.
const IDENTICAL = { record_id: "/mark/eu/018777001", mark_text: "VELTRIS", owner_name: "Quarvintex AG", owner_country: "CH",
  classes: ["09"], status: "Registered", screen: { screen_verdict: "surface:in-scope-live" } };
const NEAR = { record_id: "/mark/eu/018777002", mark_text: "VOLTRIX", owner_name: "Zorbquell GmbH", owner_country: "DE",
  classes: ["09"], status: "Registered", screen: { screen_verdict: "surface:in-scope-live" } };
const REASON = "VOLTRIX shares only the V and the ending with VELTRIS; a buyer would hear and read a different word";

function facts() {
  const f = emptyFacts();
  f.identity = { mark: "Veltris", date: "2026-09-24", provider: "signa" };
  f.recordHost = "https://records.trademark.test";
  f.counts = [["total queries executed (search + detail-fetch)", 4], ["enumerated records", 2]];
  f.auditRows = [{ unit: "primary-sweep", searches: 2, detail_fetches: 0, query: "q1" }];
  for (const r of [IDENTICAL, NEAR]) f.recordsByUri.set(joinKey(r.record_id), r);
  return f;
}
const CALL = {
  findings_rows: [{ uri: IDENTICAL.record_id, flag_reason: "the identical mark in class 9", verify: "yes" }],
  negative_rows: [{ uri: NEAR.record_id, drop_reason: REASON, ground: "sign", variant: "VOLTRIX (spelling band)" }],
};

test("sentence 2 is in the register unit's manual as written, and nothing there says the band is searched whole", () => {
  const unit = read("skills/clearance-register/unit.md");
  assert.ok(unit.includes(SENTENCE_2), "sentence 2 is not in unit.md word for word");
  assert.doesNotMatch(unit, /searched exhaustively, never a subset/);
  assert.doesNotMatch(unit, /whether you have searched \*enough\* breadth/);
  assert.ok(read("skills/clearance-register/digest.md").includes(READER_SENTENCE), "the reader's sentence is not in digest.md");
});

test("the digest's tool offers the sign ground the record accepts, and says what it means", () => {
  const src = read("engine/mcp/recording-server.mjs");
  const at = src.indexOf("negative_rows: {");
  const enumMatch = /enum: (\[[^\]]*\])/.exec(src.slice(at));
  assert.ok(at > 0 && enumMatch, "no ground list found on the digest tool's negative rows");
  assert.deepEqual(JSON.parse(enumMatch[1]), [...DIGEST_DROP_REASON_TOKENS], "the tool offers a different ground list from the one the record accepts");
  assert.ok(src.slice(at, at + 3000).replace(/"\s*\+\s*"/g, "").includes("`sign` (a near spelling a buyer in this market could not take for the mark, by sound, by look or by meaning)"),
    "the tool does not say what the sign ground means");
  assert.equal(DIGEST_DROP_REASONS.sign?.seatJudged, true, "a sign drop is the reader's judgment, not the screen's");
});

test("a live near spelling in the client's classes is set aside on its sign, with its reason, and needs no record fetched", () => {
  const v = acceptRegisterDigest(CALL, facts());
  assert.ok(v.ok, `the digest refused a sign drop: ${v.reason}`);
  assert.deepEqual(v.model.negative_rows.map((r) => [r.uri, r.ground, r.drop_reason]), [[NEAR.record_id, "sign", REASON]]);
  assert.deepEqual(parseSpineFindingBlocks(v.content, "").map((b) => b.title).filter((t) => /VOLTRIX/.test(t)), [], "the set-aside spelling is a finding");
  // The fetch check is for drops on the goods, which need the record's own goods. A drop on the sign does not.
  assert.deepEqual(findScreenGateViolations(v.content, new Set()), [], "a sign drop was held to the goods-drop fetch check");
  // THE CONTROL: the same record dropped on its goods, unfetched, is still held to it.
  const goods = acceptRegisterDigest({ ...CALL, negative_rows: [{ ...CALL.negative_rows[0], ground: "off-field", drop_reason: "dropped — off-field (relevance gate): other goods" }] }, facts());
  assert.ok(goods.ok, goods.reason);
  assert.equal(findScreenGateViolations(goods.content, new Set()).length, 1, "the control goods drop was not held to the fetch check");
});

test("the set-aside spelling reaches the audit workbook's search log with its reason", async () => {
  const v = acceptRegisterDigest(CALL, facts());
  assert.ok(v.ok, v.reason);
  const dir = mkdtempSync(join(tmpdir(), "sign-drop-"));
  try {
    const auditMd = join(dir, "audit.md");
    writeFileSync(auditMd, buildAuditMd(v.content, "").md);
    const parsed = parseAudit(auditMd);
    const rows = searchRows(parsed, { findings: [] });
    const row = rows.find((r) => /VOLTRIX/.test(r["Search term / variant"]));
    assert.ok(row, `no search-log row for the set-aside spelling:\n${rows.map((r) => r["Search term / variant"]).join("\n")}`);
    assert.ok(row.Result.includes("a buyer would hear and read a different word"), `the reason is not on the row: ${row.Result}`);
    assert.notEqual(row.Outcome, "→ Findings");
    // …and in the workbook itself, on the sheet the lawyer opens.
    const book = join(dir, "audit.xlsx");
    await buildAudit({ findings: [], coverage: [], fetchState: {} }, parsed, book, "VELTRIS", {});
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(book);
    const text = [];
    wb.getWorksheet("What was searched").eachRow((r) => text.push(r.values.slice(1).map((x) => String(x ?? "")).join(" | ")));
    assert.ok(text.some((t) => t.includes("VOLTRIX") && t.includes("a buyer would hear and read a different word")),
      `the set-aside spelling and its reason are not on the What was searched sheet:\n${text.join("\n")}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
