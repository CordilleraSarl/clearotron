// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A GOODS STATEMENT ASKED FOR WHOLE IS READ WHOLE.
//
// The register's search now answers with each goods statement whole (`include: ["full_goods_services"]`,
// providers/signa/src/core.js), and its rows say so (`goods_whole`). The band row is what a writer's record lookup
// reads, so an unflagged statement on such a row is the whole of its class at any length. Before, every unflagged
// statement of 280 characters or more was "completeness not established", and a flagged one "cut by the register";
// measured 2026-11-03 on both engines, a cited record's classes were written up as "cut and unread" on that answer.
// A row from an answer that did not ask keeps the default answer's rule. Every name here is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { rowGoods, goodsEvidence, statementCut, completenessUnknown, DEFAULT_ANSWER_CUT } from "../record-goods.mjs";

const LONG = `Providing scientific research in the field of invented compounds; ${"providing information about invented compounds; ".repeat(12)}all of the foregoing for invented uses`;
const row = ({ whole, truncated = false, text = LONG }) => ({
  record_id: "/mark/us/tm_invented", ...(whole ? { goods_whole: true } : {}),
  raw: { classifications: [{ nice_class: 42, goods_services_text: text, goods_services_text_truncated: truncated }] },
});

test("an unflagged statement on a row asked for whole is whole, at any length", () => {
  assert.ok(LONG.length > DEFAULT_ANSWER_CUT, "precondition: past the default answer's cut");
  const g = rowGoods(row({ whole: true }));
  assert.equal(statementCut(g), false);
  assert.equal(completenessUnknown(g), false);
  assert.match(g[0].text, /all of the foregoing for invented uses$/, "the statement reads to its end");
  const of = (r) => rowGoods(r);
  assert.deepEqual(goodsEvidence([row({ whole: true })], { of }), { held: 0, complete: 1, cut: 0, unknown: 0, none: 0 });
});

test("a row from an answer that did not ask keeps the default answer's rule", () => {
  assert.equal(completenessUnknown(rowGoods(row({ whole: false, text: LONG.slice(0, DEFAULT_ANSWER_CUT) }))), true,
    "an unflagged statement at the default cut is still not established whole");
  assert.equal(statementCut(rowGoods(row({ whole: false, truncated: true, text: LONG.slice(0, DEFAULT_ANSWER_CUT) }))), true);
});

test("a statement the register flags as cut is cut, whatever was asked for", () => {
  assert.equal(statementCut(rowGoods(row({ whole: true, truncated: true, text: LONG.slice(0, DEFAULT_ANSWER_CUT) }))), true);
});
