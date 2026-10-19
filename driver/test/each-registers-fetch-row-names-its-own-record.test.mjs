// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// EACH REGISTER'S FETCH ROW NAMES ITS OWN RECORD.
//
// What a record's goods rest on says "fetch failed" where this run's call ledger records a failed fetch of it. The
// registers write that row three ways: most give the record's address; EUIPO gives its application number; Signa
// its own opaque record id; and USPTO-local gives the serial it looked up and whether the record was found, not
// whether the call succeeded. Read as a bare number, EUIPO's row also matched a record of the same number on
// another register, so one failed fetch marked two records; and USPTO-local's rows, with no address and no `ok`,
// were never read, so an unfound record read as one nothing was asked about. Every record id is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchRowKey, recordFetchOutcomes, recordGoodsEvidence } from "../goods-evidence.mjs";

const PREFIX = "clearance-x-y-";
const row = (extra) => ({ sessionKey: `${PREFIX}screen-gate-refetch`, tool: "record_fetch", ...extra });

test("each register's row is read as the record it names", () => {
  assert.equal(fetchRowKey(row({ provider: "corsearch", target: "/mark/cn/88001-42", ok: true })), "/mark/cn/88001-42");
  assert.equal(fetchRowKey(row({ provider: "euipo", target: "018800142", ok: false })), "/mark/eu/018800142", "EUIPO's number names an EU record");
  assert.equal(fetchRowKey(row({ provider: "signa", target: "tm_ab12", ok: false })), "tm_ab12", "Signa's own id stays an id");
  assert.equal(fetchRowKey(row({ provider: "uspto-local", serial: "90000001", found: false })), "/mark/us/90000001");
  assert.equal(fetchRowKey({ tool: "band_search", target: "/mark/eu/x" }), null);
});

test("an unfound USPTO-local record is a failed fetch, and a failed EUIPO fetch marks no record of another register", () => {
  const fetches = recordFetchOutcomes([
    row({ provider: "uspto-local", serial: "90000001", found: false }),
    row({ provider: "euipo", target: "018800142", ok: false, http_status: 404 }),
  ], { runPrefix: PREFIX });
  const state = (uri) => recordGoodsEvidence({ record_id: uri }, { fetches }).state;
  assert.equal(state("/mark/us/90000001"), "unavailable", "USPTO-local's unfound record read as one nothing was asked about");
  assert.equal(state("/mark/eu/018800142"), "unavailable");
  assert.equal(state("/mark/us/018800142"), "not-held", "EUIPO's failed fetch marked a US record of the same number");
});
