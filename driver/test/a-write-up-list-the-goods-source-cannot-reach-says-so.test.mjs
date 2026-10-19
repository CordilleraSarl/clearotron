// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE WRITE-UP'S LIST IS LABELLED FROM THE RUN'S OWN EVIDENCE, AND A LIST THE LABEL CANNOT REACH SAYS SO.
//
// The write-up's list of records it must deliver or decline ends each record's line with what its goods rest on,
// read from the run's records and its register call ledger. Where that reading could not be made, the list kept its
// lines unlabelled and nothing said so, and a write-up handed no goods source reads like one whose records have
// none. Now each record of the run is labelled from its evidence, a notes page is left as it is, and a list the
// label cannot reach is recorded in the run log. Own file, so the call ledger is pinned before the driver loads.
// Every mark and owner is invented.
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { envFrom, pinEnv } from "../../shared/env-aliases.mjs";
import { driverDir } from "../../shared/driver-dir.mjs";
pinEnv(process.env, "CLEAROTRON_WORK_DIR", envFrom(process.env, "CLEAROTRON_WORK_DIR") || mkdtempSync(join(tmpdir(), "clearotron-testroot-")));
process.env.CLEAROTRON_REGISTER_CALL_LOG = join(mkdtempSync(join(tmpdir(), "write-up-goods-calls-")), "register-calls.jsonl");
writeFileSync(process.env.CLEAROTRON_REGISTER_CALL_LOG, "");

import { test } from "node:test";
import assert from "node:assert/strict";
const { withGoodsFrom } = await import("../pipeline.mjs");
const { paths } = await import("../stages.mjs");

const signa = (text) => ({ nice_class: 9, goods_services_text: text, goods_services_language: "en", goods_services_text_truncated: false });
const row = (id, owner, classifications = null) => ({ record_id: `/mark/us/${id}`, mark_text: "QZORVAK", owner_name: owner, classes: ["9"],
  status: "registered", jurisdictions: ["US"], ...(classifications ? { raw: { classifications } } : {}) });
const BAND = [row("w1", "Alpha Ltd"), row("w2", "Beta GmbH", [signa("Laser printers")]), row("w3", "Gamma SA")];
const ROWS = [
  { kind: "record", uri: "/mark/us/w1", mark: "QZORVAK", owner: "Alpha Ltd", tier: "sheet-2" },
  { kind: "record", uri: "/mark/us/w2", mark: "QZORVAK", owner: "Beta GmbH", tier: "sheet-2" },
  { kind: "record", uri: "/mark/us/w3", mark: "QZORVAK", owner: "Gamma SA", tier: "watchlist-annex" },
  { kind: "page", uri: "https://shop.example.com/qzorvak", title: "a notes page" },
];

function seedRun(t) {
  const runDir = mkdtempSync(join(tmpdir(), "write-up-goods-"));
  t.after(() => rmSync(runDir, { recursive: true, force: true }));
  mkdirSync(driverDir(runDir), { recursive: true });
  writeFileSync(join(runDir, "register-named-band.json"), JSON.stringify({ enumerated: BAND, crowds: [] }));
  writeFileSync(driverDir(runDir, "band-shape.json"), JSON.stringify({ groups: { goods_test: { source: "product_words", words: ["joysticks"] } } }));
  writeFileSync(driverDir(runDir, "register-record-bodies.jsonl"), JSON.stringify({ ts: "2026-10-18T00:00:00Z", provider: "x",
    sessionKey: "clearance-qz-test-register-unit-primary", target: "/mark/us/w1",
    body: { statusText: "Registered", goodsServices: [{ classes: [9], language: "en", description: "joysticks" }] } }) + "\n");
  return runDir;
}
const events = (runDir) => (existsSync(driverDir(runDir, "run.jsonl"))
  ? readFileSync(driverDir(runDir, "run.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);

test("each record of the run is labelled from its own evidence, and a notes page is left as it is", (t) => {
  const runDir = seedRun(t);
  const out = withGoodsFrom({ run: { slug: "qz", codename: "test" } }, paths(runDir), ROWS);
  assert.deepEqual(out.map((r) => r.goods_from ?? null), ["official record", "search answer", "nothing held", null]);
  assert.ok(!events(runDir).some((e) => e.event === "write-up-goods-from-failed"), "a labelled list was recorded as unlabelled");
});

test("a list the label cannot reach keeps its lines, and the run log says it went unlabelled", (t) => {
  const runDir = seedRun(t);
  const out = withGoodsFrom({ run: {} }, paths(runDir), ROWS);
  assert.deepEqual(out, ROWS, "the lines changed");
  const e = events(runDir).find((x) => x.event === "write-up-goods-from-failed");
  assert.ok(e, "the list went to the write-up unlabelled, and nothing said so");
  assert.equal(e.rows, ROWS.length);
});
