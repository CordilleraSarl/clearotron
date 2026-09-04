// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// record-ledger.test.mjs — the fetched record's BODY reaches the ledger the fidelity gate reads.
//
// THE FAILURE THIS EXISTS FOR MAKES NO NOISE AT ALL. `logCall` and `logRecordBody` are two different
// functions on the same ledger, and a provider that calls the first and forgets the second looks
// entirely healthy: the call appears in the usage diff, the record comes back correct, every test over
// the record's CONTENT passes. What breaks is downstream and one seam away — driver/registry-fidelity
// finds the run's fetched records by reading this ledger, and finding none it does not fail. It stamps
// the finding `unverified` and appends the "presented unverified" caveat to the card. Every US finding
// would carry that line forever, and nothing in this repo would say why.
//
// The env var is read at ledger MODULE LOAD, so the import below is dynamic and deliberately so: a
// static import would bind the real telemetry path and this test would append to it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "uspto-ledger-"));
const RECORD_LOG = join(dir, "records.jsonl");
const CALL_LOG = join(dir, "calls.jsonl");
process.env.CLEAROTRON_REGISTER_RECORD_LOG = RECORD_LOG;
process.env.CLEAROTRON_REGISTER_CALL_LOG = CALL_LOG;

const store = await import("../src/index-store.js");
const core = await import("../src/core.js");

const ROWS = [
  { serial: "86264144", text: "ARBORA & SONS", status: "700", classes: ["009"], owner: "ARBORA HOLDINGS SA" },
  { serial: "86264145", text: "ARBORA WORKS", status: "700", classes: ["009"], owner: "ARBORA HOLDINGS SA" },
];

function build() {
  const path = join(dir, `us-${ROWS.length}.db`);
  const db = store.createSchema(store.openIndex(path));
  store.putRecords(db, ROWS);
  store.rebuildFts(db);
  store.setMeta(db, "records", String(ROWS.length));
  store.setMeta(db, "newest_delta", new Date().toISOString());
  db.close();
  core.resetHandles();
  return { dbPath: path };
}

const ledgerRows = () => (existsSync(RECORD_LOG) ? readFileSync(RECORD_LOG, "utf8") : "")
  .split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));

test("a fetched record's body is persisted, keyed by the uri the fidelity gate indexes on", async () => {
  const auth = build();
  const tctx = { agentId: "clawdi", sessionKey: "prelim-test-run", sessionId: null };
  await core.doRecordFetch(auth, { uri: "/mark/us/86264144" }, tctx);

  const rows = ledgerRows().filter((r) => r.target === "/mark/us/86264144");
  assert.equal(rows.length, 1, "record_fetch must persist the body — the gate has no other source for it");
  const [row] = rows;
  assert.equal(row.provider, "uspto-local", "the body is attributed to this provider, not a shared default");
  assert.equal(row.sessionKey, "prelim-test-run", "the run's session key rides along or the body belongs to no run");
  // collectRecordBodies keys the map on `target`; the gate then field-compares the BODY. A body with no
  // identifiers is a body the gate can read and verify nothing against.
  assert.equal(row.body.applicationNumber, "86264144");
  assert.equal(row.body.office, "US");
  assert.equal(row.body.statusClass, "live");
});

test("a record that is not in the index persists nothing — an honest miss, not an empty body", async () => {
  const auth = build();
  const before = ledgerRows().length;
  const miss = await core.doRecordFetch(auth, { id: "99999999" }, { sessionKey: "prelim-test-run" });
  assert.ok(miss.isError);
  assert.equal(ledgerRows().length, before,
    "an absent record must not write a body — a persisted empty record would verify a finding against nothing");
});

test("batch screen persists every row it read, so a banded record needs no second fetch to be citable", async () => {
  const auth = build();
  const before = new Set(ledgerRows().map((r) => `${r.target}|${r.kind ?? ""}`));
  await core.doBatchScreen(auth, {
    uris: ["/mark/us/86264144", "/mark/us/86264145"], in_scope_classes: [9],
  }, { sessionKey: "prelim-test-run", kind: "batch_screen" });

  const targets = new Set(ledgerRows().map((r) => r.target));
  assert.ok(targets.has("/mark/us/86264144") && targets.has("/mark/us/86264145"),
    "both screened records carry a persisted body");
  assert.ok(ledgerRows().length > before.size, "screening wrote new bodies rather than reusing the fetch's");
});

test("the driver's own collector finds these bodies at the path the driver reads", async () => {
  // The end of the chain, asserted against the REAL reader rather than a re-implementation of it. A
  // body written in a shape collectRecordBodies skips is the same silent unverified caveat, one layer in.
  const { collectRecordBodies } = await import("../../../driver/registry-fidelity.mjs");
  const auth = build();
  await core.doRecordFetch(auth, { uri: "/mark/us/86264144" }, { sessionKey: "prelim-test-run" });
  const map = collectRecordBodies(RECORD_LOG, "prelim-test-run");
  const body = map.get("/mark/us/86264144");
  assert.ok(body, "the driver's collector must find the record this provider fetched");
  assert.equal(body.applicationNumber, "86264144");
});

test.after(() => { try { core.resetHandles(); rmSync(dir, { recursive: true, force: true }); } catch { /* gone */ } });
