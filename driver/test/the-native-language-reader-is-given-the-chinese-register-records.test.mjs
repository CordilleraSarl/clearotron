// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE NATIVE-LANGUAGE READER IS GIVEN THE CHINESE REGISTER RECORDS, AND CITES ONLY WHAT IT WAS SHOWN.
//
// It was told it had "CNIPA register rows" and was given the register unit's note, a count. No register reading it
// made could be grounded, so every one became a lead. It now reads the transliteration and numeric search's own band:
//   · the Chinese records only, once each, live ones first, each with the goods text the run holds for it;
//   · a missing band, an unreadable one and one holding no Chinese record stay three different states, and none of
//     them makes an otherwise empty input a reading;
//   · a capped list says how many it shows of how many, and a record or a platform row the cap left out cannot ground
//     a reading; one it was shown can, and that reading reaches synthesis undemoted.
// Invented values only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chineseRegisterRecords, buildNativereadPayload, groundReadItems, NATIVEREAD_RECORDS_CAP } from "../jx-units.mjs";

const run = () => {
  const dir = mkdtempSync(join(tmpdir(), "nativeread-records-"));
  mkdirSync(join(dir, "register-units"), { recursive: true });
  return dir;
};
const band = (dir, blocks) => writeFileSync(join(dir, "register-units", "transliteration-numeric-band.json"), JSON.stringify(blocks));
const rec = (office, n, extra = {}) => ({ record_id: `/mark/${office}/${n}`, mark_text: `INVENTED ${n}`, owner_name: "Invented Owner Co", status: "Registered", classes: [9], ...extra });

test("only the Chinese records are given, once each, live ones first, with their held goods where the run holds them", () => {
  const dir = run();
  try {
    band(dir, [
      { state: "enumerated", records: [rec("jp", 1), rec("cn", 30, { status: "Expired" }), rec("cn", 20), rec("kr", 2)] },
      { state: "incomplete", sample: [rec("cn", 20), rec("cn", 10)] },
    ]);
    mkdirSync(join(dir, "_records"), { recursive: true });
    writeFileSync(join(dir, "_records", "cn-20.json"), JSON.stringify({ _uri: "/mark/cn/20", goodsAndServices: [{ classNumber: 9, description: "invented software" }] }));
    const { state, records } = chineseRegisterRecords(dir);
    assert.equal(state, "read");
    assert.deepEqual(records.map((r) => r.id), ["/mark/cn/10", "/mark/cn/20", "/mark/cn/30"], "not the Chinese records, once each, live first");
    assert.match(records.find((r) => r.id === "/mark/cn/20").goods[0].text, /invented software/);
    assert.equal(records.find((r) => r.id === "/mark/cn/10").goods, null);
    assert.equal(records.find((r) => r.id === "/mark/cn/10").goodsFrom, "nothing held");
    const { payload } = buildNativereadPayload({ registerRecords: { state, records } });
    assert.match(payload, /^## Chinese register records supplied \(3 of 3\)$/m);
    assert.match(payload, /\/mark\/cn\/10 \| INVENTED 10 \| owner: Invented Owner Co \| Registered \| classes 9 \| goods: nothing held/);
    assert.doesNotMatch(payload, /\/mark\/(jp|kr)\//, "another office's record was given as Chinese");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a missing band, an unreadable one and one with no Chinese record stay distinct, and none is evidence to read", () => {
  const dir = run();
  try {
    assert.equal(chineseRegisterRecords(dir).state, "missing");
    writeFileSync(join(dir, "register-units", "transliteration-numeric-band.json"), "{ torn");
    assert.equal(chineseRegisterRecords(dir).state, "unreadable");
    band(dir, [{ state: "enumerated", records: [rec("jp", 1)] }]);
    const none = chineseRegisterRecords(dir);
    assert.deepEqual(none, { state: "read", records: [] });
    const built = buildNativereadPayload({ registerRecords: none });
    assert.match(built.payload, /^## No Chinese register records were supplied for this reading$/m);
    assert.equal(built.sections, 0, "an empty register heading made an empty input a reading");
    assert.deepEqual(built.register, { state: "read", eligible: 0, shown: 0 });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a capped list says how many it shows of how many, and only what was shown grounds a reading, which reaches synthesis undemoted", () => {
  const records = Array.from({ length: NATIVEREAD_RECORDS_CAP + 5 }, (_, i) => ({ id: `/mark/cn/${String(i).padStart(3, "0")}`, mark: `M${i}`, owner: null, status: null, classes: [], goods: null }));
  const { payload, uris, register } = buildNativereadPayload({ registerRecords: { state: "read", records } });
  assert.match(payload, new RegExp(`## Chinese register records supplied \\(${NATIVEREAD_RECORDS_CAP} of ${NATIVEREAD_RECORDS_CAP + 5}\\)`));
  assert.deepEqual(register, { state: "read", eligible: NATIVEREAD_RECORDS_CAP + 5, shown: NATIVEREAD_RECORDS_CAP });
  const shown = records[0].id, omitted = records[NATIVEREAD_RECORDS_CAP].id;
  assert.ok(uris.has(shown) && !uris.has(omitted));
  const [read, lead] = groundReadItems([
    { kind: "conflict-read", record_uri: shown, analysis_en: "a", severity_hint: "high", grounds_en: "the row shown" },
    { kind: "conflict-read", record_uri: omitted, analysis_en: "b", severity_hint: "high", grounds_en: "a row it never saw" },
  ], uris);
  assert.equal(read.grounded, true);
  assert.equal(read.demoted, undefined, "a reading of a record it was shown reached synthesis as a lead");
  assert.equal(lead.demoted, "lead", "a record the cap left out grounded a reading");
});
