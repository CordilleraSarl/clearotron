// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// EACH OWNER CHECK KEEPS ITS OWN ANSWER FILE.
//
// A knockout writes each owner check's answer to a file and hands the reading seat that file's path, one
// line per owner. The file was named after the owner's name in Latin letters alone, so two checks could
// write to one file: one owner holding filings for two marks, two owners whose names reduce to the same
// letters, or two names with no Latin letters. The later answer then overwrote the earlier one, and both
// owners' lines pointed at it: one of them was read with another owner's answer. What each check asks is
// unchanged; only where its answer is kept.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runOwnerChecks, composeOwnerQuery, ownerPayloadFile } from "../owner-use-check.mjs";
import { ownerCheckLines } from "../stages-knockout.mjs";

// Rows that shared one file under the old name.
const ROWS = [
  { mark: "VELTRIS", owner: "Quarvintex AG", recordIds: ["/mark/eu/1"], classes: [9] },
  { mark: "BRIMHOLT", owner: "Quarvintex AG", recordIds: ["/mark/eu/2"], classes: [9] },    // one owner, two marks
  { mark: "VELTRIS", owner: "Zorbquell, Inc.", recordIds: ["/mark/eu/3"], classes: [9] },
  { mark: "VELTRIS", owner: "ZORBQUELL INC", recordIds: ["/mark/eu/4"], classes: [9] },     // same letters
  { mark: "VELTRIS", owner: "维尔特里斯有限公司", recordIds: ["/mark/cn/5"], classes: [9] },
  { mark: "VELTRIS", owner: "クアルヴィンテクス株式会社", recordIds: ["/mark/jp/6"], classes: [9] }, // no Latin letters
];
const answerFor = (o) => `Answer for ${o.owner} on ${o.mark}: https://example.test/${ROWS.indexOf(o)}`;
const exec = async (query) => {
  const o = ROWS.find((r) => composeOwnerQuery(r) === query);
  return { ok: true, text: answerFor(o) };
};

test("every row keeps its own answer, and the reading seat is pointed at it", async () => {
  const d = mkdtempSync(join(tmpdir(), "owner-answers-"));
  try {
    mkdirSync(join(d, "research"));
    mkdirSync(join(d, "_driver"));
    const rows = await runOwnerChecks({ owners: ROWS, exec, runDir: d });
    assert.equal(new Set(rows.map((r) => r.payloadFile)).size, ROWS.length, "two checks share an answer file");
    rows.forEach((r, i) => assert.equal(readFileSync(join(d, "research", r.payloadFile), "utf8"), answerFor(ROWS[i]),
      `row ${i} holds another row's answer`));
    // The seat's dispatch names each owner once, with its own file.
    const K = { runDir: d, ownerChecks: join(d, "_driver", "owner-checks.json") };
    writeFileSync(K.ownerChecks, JSON.stringify({ schema: 1, checks: rows }));
    const lines = ownerCheckLines(K);
    rows.forEach((r, i) => assert.ok(lines[i].endsWith(join(d, "research", r.payloadFile)), `line ${i} points elsewhere`));
    // THE CONTROL: the old name, the owner's Latin letters alone, puts these six rows in three files.
    const oldName = (o) => `owner-${o.owner.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "owner"}.md`;
    assert.equal(new Set(ROWS.map(oldName)).size, 3, "the fixture no longer reproduces the clash");
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("a row's file name is the same on every run and still reads as its owner", () => {
  assert.equal(ownerPayloadFile(ROWS[0]), ownerPayloadFile({ ...ROWS[0] }));
  assert.match(ownerPayloadFile(ROWS[0]), /^owner-quarvintex-ag-[0-9a-f]{10}\.md$/);
  assert.match(ownerPayloadFile(ROWS[4]), /^owner-owner-[0-9a-f]{10}\.md$/);
});
