// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier fast — the judges' record tools over an invented pile
//
// A RECORD THE SEARCH DOES NOT HOLD SHOWS NO GOODS LINE, NOT AN EMPTY ONE (design, 2026-10-03).
//
// A register can list a record's mark, owner, classes, offices and status with no goods wording; the goods
// come only with the full record. The judges' record tools printed an empty goods line for every such
// record, and a judge read the blank as "no overlap shown" and set an owner aside on it. A record the search
// does not hold now carries no goods field at all; one it holds carries its goods as before.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeOwnerTools } from "../owner-tools.mjs";

const HELD = "/mark/us/0001";
const BODIES = { [HELD]: { goodsServices: [{ classes: [9], description: "downloadable game software" }] } };
const pile = {
  orderMarks: ["QORVEN"], orderClasses: [9],
  questions: [{ qid: "q1", match: "exact", id: "Q1" }],
  records: [
    { id: HELD, mark: "QORVENA", owner: "Owner One Holdings Ltd", ownerCountry: "US", office: "US", classes: [9], status: "REGISTERED", filed: "2019-04-01", qids: ["q1"] },
    { id: "/mark/us/0002", mark: "QORVENO", owner: "Owner One Holdings Ltd", ownerCountry: "US", office: "US", classes: [9], status: "REGISTERED", filed: "2020-04-01", qids: ["q1"] },
  ],
  readFullRecord: (id) => BODIES[id] ?? null,
};
pile.questionById = new Map([["Q1", { id: "Q1", qid: "q1", words: ["QORVEN"], match: "exact", classes: [9], offices: ["US"], listed: true, recordsHeld: 2, count: 2 }]]);
pile.recordsOf = () => pile.records;

test("owner_records: a held record carries its goods line, one not held carries no goods field", async () => {
  const { result } = await makeOwnerTools(pile).call("owner_records", { owner: "Owner One Holdings Ltd" });
  const rows = JSON.stringify(result);
  const held = (result.list ?? []).find((r) => r.record === HELD);
  const notHeld = (result.list ?? []).find((r) => r.record === "/mark/us/0002");
  assert.ok(held && notHeld, `premise: both records listed — ${rows.slice(0, 300)}`);
  assert.match(String(held.goods), /downloadable game software/);
  assert.equal("goods" in notHeld, false, "a record not held still carries a goods line");
  assert.equal("goods_cut" in notHeld, false);
});

test("register_list: the same, for the records a question listed", async () => {
  const { result } = await makeOwnerTools(pile).call("register_list", { question: "Q1" });
  const rows = JSON.stringify(result);
  assert.match(rows, /downloadable game software/, `premise: the held record's goods are listed — ${rows.slice(0, 300)}`);
  assert.equal((rows.match(/"goods":/g) ?? []).length, 1, "a record not held still carries a goods line");
});
