// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier fast — drives the pure receipt filter over receipts shaped like the ones the recall lane wrote
//
// The recall store and its searches were removed on 2026-09-24; a run from before then still carries its
// recall receipt, and its audit still lists it. Those searches read every company's remembered conflicts,
// so a new company's clearance of a mark re-found them. Measured 2026-09-23 on a test run for one
// company: its published audit listed "prior-confirmed conflict recall probe: …" for a conflict another
// company's clearance had recorded —
// a line that tells one client another has cleared the same mark. Ruled the same day: keep the
// searches, stop naming them. The audit's ask ledger and the workbook's over-the-cap rows both read the
// receipt through recallReceiptForOwnCompany.
//
// BREAK MATRIX:
//   · another company's entry is listed                      → arm 1 red
//   · an entry both companies remembered is hidden            → arm 1 red
//   · a row naming no company is listed to a named company    → arm 2 red
//   · overflow or refused entries escape the filter           → arm 3 red
//   · a receipt written before companies were named changes   → arm 4 red (an archived run would republish differently)
import { test } from "node:test";
import assert from "node:assert/strict";
import { recallReceiptForOwnCompany } from "../recall-receipt.mjs";

const entry = (qid, customers) => ({ qid, uri: `/mark/us/${qid}`, mark_text: qid.toUpperCase(), owner: null, customers });
const receipt = (customer, extra = {}) => ({
  schema_version: 2, ts: "2026-09-23T00:00:00Z", customer, cap: { mark: 50, owner: 5 },
  directives: [entry("recall-ours", ["company-a"]), entry("recall-theirs", ["company-b"]), entry("recall-both", ["company-b", "company-a"]),
    entry("recall-nobody", [null])],
  overflow: [{ qid: "recall-owner-ours", term: "Ours Ltd", customers: ["company-a"] }, { qid: "recall-owner-theirs", term: "Theirs Ltd", customers: ["company-b"] }],
  refused: [{ ...entry("recall-ours-refused", ["company-a"]), issue: "label-shaped" }, { ...entry("recall-theirs-refused", ["company-b"]), issue: "label-shaped" }],
  ...extra,
});
const qids = (xs) => xs.map((x) => x.qid);

test("a company's audit lists the recall checks its own deliveries remembered, and none of another company's", () => {
  const r = recallReceiptForOwnCompany(receipt("company-a"));
  assert.deepEqual(qids(r.directives), ["recall-ours", "recall-both"]);
  const b = recallReceiptForOwnCompany(receipt("company-b"));
  assert.deepEqual(qids(b.directives), ["recall-theirs", "recall-both"], "the rule is symmetric");
});

test("a row naming no company is listed only to a run naming none", () => {
  assert.deepEqual(qids(recallReceiptForOwnCompany(receipt(null)).directives), ["recall-nobody"]);
  assert.deepEqual(qids(recallReceiptForOwnCompany(receipt("")).directives), ["recall-nobody"], "an empty key is no company");
});

test("the over-the-cap and refused entries follow the same rule, and the receipt is otherwise untouched", () => {
  const src = receipt("company-a");
  const r = recallReceiptForOwnCompany(src);
  assert.deepEqual(qids(r.overflow), ["recall-owner-ours"]);
  assert.deepEqual(qids(r.refused), ["recall-ours-refused"]);
  assert.deepEqual(r.cap, src.cap);
  assert.equal(src.directives.length, 4, "the receipt on disk is never rewritten — the searches' record stays whole");
  const noCustomers = recallReceiptForOwnCompany(receipt("company-a", { directives: [{ qid: "recall-unnamed" }] }));
  assert.deepEqual(noCustomers.directives, [], "on a receipt that names companies, an entry that names none is not listed");
});

test("a receipt written before companies were named lists exactly as it always did", () => {
  const legacy = receipt("company-a");
  delete legacy.customer;
  assert.equal(recallReceiptForOwnCompany(legacy), legacy);
  assert.equal(recallReceiptForOwnCompany(null), null);
});
