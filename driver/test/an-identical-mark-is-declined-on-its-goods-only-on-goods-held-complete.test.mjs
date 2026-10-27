// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// AN IDENTICAL MARK IN A FILED CLASS IS DECLINED ON ITS GOODS ONLY ON GOODS THE RUN HOLDS COMPLETE (ruled 2026-10-27).
//
// The declination tool refused every discretionary reason on a record whose mark is identical to the applied-for
// mark, live, in one of the matter's filed classes. On a test run of a crowded field 29 goods decisions were refused
// that way and every one came back as a finding. Identical spelling and a shared class no longer bar a supported
// judgment that the registered goods are unrelated: `unrelated-goods` stands where the spec says the run holds the
// record's goods complete, and is refused, naming the state, where the goods are cut, unknown or missing. The
// record's field, the report's length and a comparison with the applied-for mark itself stay refused. A near
// spelling may now be declined on its sign, the write-up's own ground. Own file, so the call ledger is pinned
// before the driver loads. Every mark and owner is invented.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { envFrom, pinEnv } from "../../shared/env-aliases.mjs";
import { driverDir } from "../../shared/driver-dir.mjs";
pinEnv(process.env, "CLEAROTRON_WORK_DIR", envFrom(process.env, "CLEAROTRON_WORK_DIR") || mkdtempSync(join(tmpdir(), "clearotron-testroot-")));
process.env.CLEAROTRON_REGISTER_CALL_LOG = join(mkdtempSync(join(tmpdir(), "declination-goods-calls-")), "register-calls.jsonl");
writeFileSync(process.env.CLEAROTRON_REGISTER_CALL_LOG, "");

import { test } from "node:test";
import assert from "node:assert/strict";
const { acceptDeclinationCall, contradictionFor, DECLINATION_REASONS } = await import("../declination-call.mjs");
const { DIGEST_DROP_REASONS } = await import("../register-digest-record.mjs");
const { withGoodsStates } = await import("../pipeline.mjs");
const { paths } = await import("../stages.mjs");

const SCOPE = { marks: ["QZORVAK"], classes: [9, 42] };
const IDENTICAL = { uri: "/mark/eu/q1", mark: "Qzorvak", owner: "Beta GmbH", classes: [9], status: "REGISTERED" };
const NEAR = { uri: "/mark/eu/q2", mark: "Qzorvaks", owner: "Gamma SA", classes: [9], status: "REGISTERED" };
const GROUNDS = "Registered for industrial pumps and pipe fittings; nothing in the specification meets the client's game controllers.";
const decline = (rows, row_index, reason) => acceptDeclinationCall({ rows, scope: SCOPE }, { declinations: [{ row_index, reason, grounds: GROUNDS }] });

test("an identical, live, in-class mark is declined on its goods where the run holds them complete", () => {
  const r = decline([{ ...IDENTICAL, goods: "complete" }], 0, "unrelated-goods");
  assert.deepEqual([r.accepted.length, r.refused.length], [1, 0], r.refused[0]?.why);
});

test("…and refused on goods the run does not hold complete, naming what they rest on", () => {
  for (const goods of ["cut", "unknown", "absent", "not-held", "unavailable", null]) {
    const r = decline([{ ...IDENTICAL, goods }], 0, "unrelated-goods");
    assert.equal(r.accepted.length, 0, `goods ${goods}: a goods decision stood on goods the run does not hold complete`);
    assert.match(r.refused[0].why, /IDENTICAL/);
    assert.match(r.refused[0].why, new RegExp(`does not hold its goods complete \\(${goods ?? "not recorded"}\\): missing or incomplete goods do not establish`));
    assert.match(r.refused[0].why, /own-right or duplicate-of-delivered/, "the refusal names the routes still open");
  }
});

test("its field, the report's length and its sign stay refused, with the goods route named", () => {
  for (const reason of ["off-field-not-major", "not-worth-the-line", "sign"]) {
    const r = decline([{ ...IDENTICAL, goods: "complete" }], 0, reason);
    assert.equal(r.accepted.length, 0, `${reason} set aside an identical, live, in-class mark`);
    assert.match(r.refused[0].why, /decline it as unrelated-goods with that ground/);
  }
});

test("a near spelling is declined on its sign; the report's length stays refused on a live in-class mark", () => {
  assert.deepEqual([decline([NEAR], 0, "sign").accepted.length], [1]);
  const room = decline([NEAR], 0, "not-worth-the-line");
  assert.equal(room.accepted.length, 0);
  assert.match(room.refused[0].why, /sign if a buyer in this market could not take its spelling for the mark/);
  assert.equal(DECLINATION_REASONS.sign.gloss, DIGEST_DROP_REASONS.sign.gloss, "the writer's sign is the write-up's, word for word");
  assert.equal(DECLINATION_REASONS.sign.discretionary, true);
});

test("a position is declined on its goods only where every identical member's goods are held complete", () => {
  const position = (goods) => ({ ...IDENTICAL, uris: ["/mark/eu/q1", "/mark/eu/q3"],
    members: [{ uri: "/mark/eu/q1", mark: "Qzorvak", classes: [9], status: "REGISTERED", goods: "complete" },
      { uri: "/mark/eu/q3", mark: "QZORVAK", classes: [42], status: "PENDING", goods }] });
  assert.equal(decline([position("complete")], 0, "unrelated-goods").accepted.length, 1);
  assert.equal(decline([position("cut")], 0, "unrelated-goods").accepted.length, 0, "one member's cut goods were read as complete");
  assert.equal(contradictionFor("unrelated-goods", position("cut"), SCOPE).includes("(cut)"), true);
});

test("the spec the tool judges carries each record's goods state, a position's members included", (t) => {
  const runDir = mkdtempSync(join(tmpdir(), "declination-goods-"));
  t.after(() => rmSync(runDir, { recursive: true, force: true }));
  mkdirSync(driverDir(runDir), { recursive: true });
  const rec = (id) => ({ record_id: `/mark/us/${id}`, mark_text: "QZORVAK", owner_name: "Alpha Ltd", classes: ["9"], status: "registered", jurisdictions: ["US"] });
  writeFileSync(join(runDir, "register-named-band.json"), JSON.stringify({ enumerated: [rec("g1"), rec("g2")], crowds: [] }));
  writeFileSync(driverDir(runDir, "band-shape.json"), JSON.stringify({ groups: { goods_test: { source: "product_words", words: ["joysticks"] } } }));
  writeFileSync(driverDir(runDir, "register-record-bodies.jsonl"), JSON.stringify({ ts: "2026-10-27T00:00:00Z", provider: "x",
    sessionKey: "clearance-qz-test-register-unit-primary", target: "/mark/us/g1",
    body: { statusText: "Registered", goodsServices: [{ classes: [9], language: "en", description: "industrial pumps" }] } }) + "\n");
  const rows = [
    { uri: "/mark/us/g1", mark: "QZORVAK", owner: "Alpha Ltd", uris: ["/mark/us/g1", "/mark/us/g2"],
      members: [{ uri: "/mark/us/g1", mark: "QZORVAK" }, { uri: "/mark/us/g2", mark: "QZORVAK" }] },
    { kind: "page", page: "shop.example/qzorvak", url: "https://shop.example/qzorvak" },
  ];
  const out = withGoodsStates({ run: { slug: "qz", codename: "test" } }, paths(runDir), rows);
  assert.equal(out[0].goods, "complete");
  assert.deepEqual(out[0].members.map((m) => m.goods), ["complete", "not-held"]);
  assert.deepEqual(out[1], rows[1], "a page is left as it is");
  assert.deepEqual(withGoodsStates({ run: {} }, paths(runDir), rows), rows, "with no session prefix the rows stay as they were");
});
