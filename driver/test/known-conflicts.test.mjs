// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// known-conflicts.mjs — the WORKSPACE-LEVEL per-mark recall store. The cross-matter blindness
// this closes: the matter-dir ledger meant a refless re-run (new noref slug, same mark) started empty —
// copper-causeway could not see teal-conduit's VENERET. Pure-core tests + IO round-trip.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  markKey, markFileName, canonicalUri, parseKnownConflicts, mergeKnownConflicts,
  upsertDeliveryLegs, readKnownConflictsFor, writeKnownConflictsFor, storeDirFor,
  isAcceptedConflictRow, acceptedConflicts, STORE_SCHEMA_VERSION,
} from "../known-conflicts.mjs";
import { findRecallRegressionViolations } from "../reasoning-tripwires.mjs";

test("markKey/markFileName: diacritics fold, punctuation drops — one file per mark however it is typed", () => {
  assert.equal(markKey("VENZY™"), "venzy");
  assert.equal(markKey("Café-Riche"), "cafe riche");
  assert.equal(markFileName("Café-Riche"), "cafe-riche.json");
  assert.equal(markFileName("  "), "");
});

test("canonicalUri: full provider URLs normalize to the /mark path (the justified-arm shape); non-record uris pass through", () => {
  assert.equal(canonicalUri("https://tm.corsearch.com/mark/tr/2009-53984"), "/mark/tr/2009-53984");
  assert.equal(canonicalUri("/mark/us/90000001"), "/mark/us/90000001");
  assert.equal(canonicalUri("https://example.com/other"), "https://example.com/other");
});

test("parseKnownConflicts: token-first throws on shape defects; v1 rows parse unchanged", () => {
  assert.throws(() => parseKnownConflicts("{"), /known_conflicts_unparseable/);
  assert.throws(() => parseKnownConflicts(JSON.stringify({ marks: [] })), /known_conflicts_marks_invalid/);
  assert.throws(() => parseKnownConflicts(JSON.stringify({ marks: { venzy: {} } })), /known_conflicts_rows_invalid:venzy/);
  assert.throws(() => parseKnownConflicts(JSON.stringify({ marks: { venzy: [{ uri: "/mark/tr/1", typo: 1 }] } })), /known_conflicts_row_key_unknown:typo/);
  assert.throws(() => parseKnownConflicts(JSON.stringify({ marks: { venzy: [{ mark_text: "K" }] } })), /known_conflicts_entry_uri_missing:venzy/);
  const v1 = parseKnownConflicts(JSON.stringify({ schema_version: 1, marks: { venzy: [{ uri: "/mark/tr/1", mark_text: "VENZY", classes: null, status: "live", source: "auto:delivery x", ts: "2026-07-11T00:00:00Z" }] } }));
  assert.equal(v1.marks.venzy.length, 1);
});

test("mergeKnownConflicts: union by canonical uri — an existing row's fields WIN (human edits never overwritten)", () => {
  const a = { schema_version: 1, marks: { venzy: [{ uri: "/mark/tr/1", mark_text: "VENZY (edited by hand)", status: "dead" }] } };
  const b = { schema_version: 1, marks: { venzy: [
    { uri: "https://tm.corsearch.com/mark/tr/1", mark_text: "VENZY", status: "live" },   // same record, URL shape
    { uri: "/mark/us/2", mark_text: "VENZY", status: "live" },
  ], veneret: [{ uri: "/mark/us/3", mark_text: "VENERET", status: "live" }] } };
  const m = mergeKnownConflicts(a, b);
  assert.equal(m.marks.venzy.length, 2, "the URL-shaped duplicate deduped against the path row");
  assert.equal(m.marks.venzy[0].status, "dead", "the human-edited row wins");
  assert.equal(m.marks.veneret.length, 1);
});

test("upsertDeliveryLegs: canonicalizes uris (original kept as source_url), stamps source/ts/customer, appends only", () => {
  const ledger = { schema_version: 1, marks: {} };
  const { added } = upsertDeliveryLegs(ledger, {
    names: ["VENZY"], codename: "copper-causeway", ts: "2026-07-11T01:15:50Z", customer: "cordillera",
    legs: [
      { uri: "https://tm.corsearch.com/mark/tr/2009-53984", mark_text: "VENZY", classes: ["5"], status: "live", owner: "Doruk İlkay", jurisdiction: "TR" },
      { uri: "/mark/tr/2009-53984", mark_text: "VENZY", status: "live" },   // duplicate in path shape
    ],
  });
  assert.equal(added, 1, "the two shapes of one record add once");
  const row = ledger.marks.venzy[0];
  assert.equal(row.uri, "/mark/tr/2009-53984");
  assert.equal(row.source_url, "https://tm.corsearch.com/mark/tr/2009-53984");
  assert.equal(row.owner, "Doruk İlkay");
  assert.equal(row.jurisdiction, "TR");
  assert.equal(row.customer, "cordillera");
  assert.equal(row.source, "auto:delivery copper-causeway");
});

test("IO round-trip: write under matter A, read under matter B — the cross-matter recall this exists for", () => {
  const studio = mkdtempSync(join(tmpdir(), "kc-studio-"));
  const w = writeKnownConflictsFor(studio, {
    names: ["VENZY"], codename: "teal-conduit", ts: "2026-07-08T02:00:00Z",
    legs: [{ uri: "/mark/us/veneret1", mark_text: "VENERET", classes: ["5"], status: "live", owner: "Halvern/Torvex" }],
  });
  assert.deepEqual(w, { added: 1, upgraded: 0, unreadable: 0 });
  assert.ok(existsSync(join(storeDirFor(studio), "venzy.json")));
  // a DIFFERENT matter id is irrelevant — the read keys on the searched mark name
  const merged = readKnownConflictsFor(studio, ["VENZY"], { legacyPath: join(studio, "noref-new-matter", "_known-conflicts.json") });
  assert.equal(merged.marks.venzy[0].mark_text, "VENERET");
  // legacy matter-sibling ledger merges in, its rows winning
  const legacyDir = join(studio, "noref-old-matter"); mkdirSync(legacyDir, { recursive: true });
  writeFileSync(join(legacyDir, "_known-conflicts.json"), JSON.stringify({ schema_version: 1, marks: { venzy: [{ uri: "/mark/us/veneret1", mark_text: "VENERET (hand-edited)", status: "dead" }] } }));
  const withLegacy = readKnownConflictsFor(studio, ["VENZY"], { legacyPath: join(legacyDir, "_known-conflicts.json") });
  assert.equal(withLegacy.marks.venzy.length, 1);
  assert.equal(withLegacy.marks.venzy[0].status, "dead", "the legacy (possibly human-edited) row wins the merge");
  assert.equal(readKnownConflictsFor(studio, ["UNSEEN MARK"]), null, "no store, no legacy ⇒ null (tripwire no-op)");
});

test("write is append-only across deliveries; a second run of the same mark only adds new records", () => {
  const studio = mkdtempSync(join(tmpdir(), "kc-studio-"));
  writeKnownConflictsFor(studio, { names: ["ACME"], codename: "run-one", ts: "t1",
    legs: [{ uri: "/mark/us/1", mark_text: "ACME", status: "live" }] });
  const w = writeKnownConflictsFor(studio, { names: ["ACME"], codename: "run-two", ts: "t2",
    legs: [{ uri: "/mark/us/1", mark_text: "ACME", status: "live" }, { uri: "/mark/eu/2", mark_text: "ACME", status: "live" }] });
  assert.deepEqual(w, { added: 1, upgraded: 0, unreadable: 0 }, "one new leg; the already-delivered row needs no upgrade");
  const doc = parseKnownConflicts(readFileSync(join(storeDirFor(studio), "acme.json"), "utf8"));
  assert.equal(doc.marks.acme.length, 2);
  assert.equal(doc.marks.acme[0].source, "auto:delivery run-one", "the first delivery's row is untouched");
});

test("spec 64 (B3): opposition_end + deadline_source_uri ride the row when the leg carries them", () => {
  const ledger = { schema_version: 1, marks: {} };
  upsertDeliveryLegs(ledger, { names: ["VENZY"], codename: "x", ts: "t",
    legs: [{ uri: "/mark/ch/06198", mark_text: "DEMVENZY", status: "live", opposition_end: "2026-07-13", deadline_source_uri: "/mark/ch/06198" }] });
  assert.equal(ledger.marks.venzy[0].opposition_end, "2026-07-13");
  assert.equal(ledger.marks.venzy[0].deadline_source_uri, "/mark/ch/06198");
  assert.doesNotThrow(() => parseKnownConflicts(JSON.stringify(ledger)), "v2 fields parse clean");
});

// ---- review fixes ---------------------------------------------------------------------------------
test("review fix: an unreadable/hand-annotated store file is SKIPPED at write, never rebuilt from scratch", () => {
  const studio = mkdtempSync(join(tmpdir(), "kc-studio-"));
  writeKnownConflictsFor(studio, { names: ["ACME"], codename: "run-one", ts: "t1",
    legs: [{ uri: "/mark/us/1", mark_text: "ACME", status: "live" }] });
  const p = join(storeDirFor(studio), "acme.json");
  // a human annotates a row with a key the strict parser rejects — their edit must survive any later delivery
  const doc = JSON.parse(readFileSync(p, "utf8"));
  doc.marks.acme[0].note = "manually confirmed dead — do not re-probe";
  writeFileSync(p, JSON.stringify(doc, null, 2));
  const before = readFileSync(p, "utf8");
  const seen = [];
  const w = writeKnownConflictsFor(studio, { names: ["ACME"], codename: "run-two", ts: "t2",
    legs: [{ uri: "/mark/eu/2", mark_text: "ACME", status: "live" }],
    onError: (path, err) => seen.push([path, String(err.message)]) });
  assert.deepEqual(w, { added: 0, upgraded: 0, unreadable: 1 }, "the delivery skips the unparseable file — and SAYS it did");
  assert.equal(readFileSync(p, "utf8"), before, "the human-edited file is byte-identical — never destroyed");
  // round 3: skipping is right, silence is not. `added: 0` alone reads exactly like the healthy
  // steady state (every leg already known), so the write reports the file it could not use.
  assert.equal(seen.length, 1);
  assert.equal(seen[0][0], p);
  assert.match(seen[0][1], /known_conflicts_row_key_unknown:note/);
});

test("review fix: markKey keeps non-Latin scripts — the store works for Cyrillic/Greek/CJK marks", () => {
  assert.equal(markKey("ЯНДЕКС"), "яндекс");
  assert.equal(markKey("凤凰"), "凤凰");
  assert.equal(markFileName("ЯНДЕКС"), "яндекс.json");
  assert.equal(markKey("VENZY™"), "venzy", "ASCII behavior unchanged");
  const studio = mkdtempSync(join(tmpdir(), "kc-studio-"));
  assert.equal(writeKnownConflictsFor(studio, { names: ["ЯНДЕКС"], codename: "x", ts: "t",
    legs: [{ uri: "/mark/ru/1", mark_text: "ЯНДЕКС", status: "live" }] }).added, 1, "a non-Latin mark persists");
  assert.equal(readKnownConflictsFor(studio, ["ЯНДЕКС"]).marks["яндекс"].length, 1);
});

// ── ROUND-2 (review problem 3): CONTEXT for the next attempt ≠ a premise for a later verdict ────────
// P2-A added a store write at the FAILED terminal so the next attempt on a matter can see the ratings
// the dead attempt produced instead of re-running a recall no-op. That is the point of the write. But
// the same rows feed readKnownConflictsFor → findRecallRegressionViolations → recallRegressionMaterial
// → decideRegisterGap → the deliver-conditional floor, which sets verdict = "CONDITIONAL" and quotes
// "a prior-confirmed live conflict was neither carried nor justified this run: …" into the report.
// A finding from a run nobody accepted — one the reviewer BLOCKED, or that the recall floor killed —
// cannot be the premise of that clamp. So rows carry `terminal`, verdict surfaces read
// acceptedConflicts(), and the recall PROBES keep reading everything.
test("terminal provenance: delivered rows are accepted; failed-terminal rows are context only", () => {
  const ledger = { schema_version: 1, marks: {} };
  upsertDeliveryLegs(ledger, { names: ["VENZY"], codename: "synthetic-one", ts: "2026-07-30T00:00:00Z",
    legs: [{ uri: "/mark/tr/2009-53984", mark_text: "VENZY", classes: ["5"], status: "live" }] });
  assert.equal(ledger.marks.venzy[0].terminal, "delivered", "the default and the delivered terminal agree");
  upsertDeliveryLegs(ledger, { names: ["VENZY"], codename: "synthetic-two", ts: "2026-07-30T01:00:00Z",
    terminal: "failed:register-digest",
    legs: [{ uri: "/mark/tr/2010-11111", mark_text: "VENZY", classes: ["5"], status: "live" }] });
  assert.equal(ledger.marks.venzy[1].terminal, "failed:register-digest");

  // the DEFAULT is what protects the existing tripwire: every row written before this change came
  // from a delivered terminal, and every hand-edited row was put there deliberately.
  assert.equal(isAcceptedConflictRow({ uri: "/mark/x/1" }), true, "absent terminal ⇒ accepted (legacy + human rows)");
  assert.equal(isAcceptedConflictRow({ uri: "/mark/x/1", terminal: "delivered" }), true);
  assert.equal(isAcceptedConflictRow({ uri: "/mark/x/1", terminal: "failed:verdict" }), false);

  const kept = acceptedConflicts(ledger);
  assert.deepEqual(kept.marks.venzy.map((r) => r.uri), ["/mark/tr/2009-53984"], "the verdict surface sees only the accepted row");
  assert.deepEqual(ledger.marks.venzy.map((r) => r.uri), ["/mark/tr/2009-53984", "/mark/tr/2010-11111"],
    "…and the store itself is untouched — the recall probes still see the failed run's legs as context");
  // acceptedConflicts is a COPY, never a mutation of the caller's ledger
  assert.notEqual(kept.marks.venzy, ledger.marks.venzy);
  assert.equal(acceptedConflicts(null), null, "a null store passes through (the caller's own guard owns it)");
});

test("terminal provenance: an unaccepted run's leg cannot raise a recall-regression clamp on a later run", () => {
  const ledger = { schema_version: 1, marks: {} };
  upsertDeliveryLegs(ledger, { names: ["VENZY"], codename: "synthetic-two", ts: "2026-07-30T01:00:00Z",
    terminal: "failed:register-digest",
    legs: [{ uri: "/mark/tr/2010-11111", mark_text: "VENZY", classes: ["5"], status: "live" }] });
  const args = { searchedNames: ["VENZY"], carriedUris: [], fetchedUris: [], registerFindingsMd: "", inScopeClasses: ["5"] };
  // unfiltered — the substrate the CONTEXT readers use — still names it
  assert.equal(findRecallRegressionViolations({ knownConflicts: ledger, ...args }).length, 1);
  // filtered — what every verdict surface reads — does not
  assert.equal(findRecallRegressionViolations({ knownConflicts: acceptedConflicts(ledger), ...args }).length, 0,
    "a run that never shipped must not clamp a later delivered report CLEAR→CONDITIONAL, nor be quoted in it");
});

// ── ROUND-3 (the regression round 2 introduced): A DELIVERED RUN'S CONFIRMATION MUST LAND ──────────
// The A/B/C the review ran, on the real functions, through the real files. Round 2 made the write
// append-only on the uri INCLUDING provenance, so step B added 0 rows and upgraded nothing: the leg
// stayed `failed:register-digest` and acceptedConflicts() hid it from every verdict surface forever.
// That is the recall tripwire going permanently blind on the MODAL recovery path — fail at
// verdict, re-run, deliver — which is the very path the failed-terminal write was added to serve.
test("round 3: a DELIVERED run upgrades the terminal a failed attempt wrote — A/B/C", () => {
  const studio = mkdtempSync(join(tmpdir(), "kc-studio-"));
  const LEG = { uri: "/mark/tr/2009-53984", mark_text: "VENZY", classes: ["5"], status: "live" };
  const args = { searchedNames: ["VENZY"], carriedUris: [], fetchedUris: [], registerFindingsMd: "", inScopeClasses: ["5"] };
  const violations = (doc) => findRecallRegressionViolations({ knownConflicts: doc, ...args });
  const store = () => readKnownConflictsFor(studio, ["VENZY"]);

  // A) the attempt dies at register-digest. Context: yes. Verdict surface: no. (The P3 fix, working.)
  const a = writeKnownConflictsFor(studio, { names: ["VENZY"], codename: "synthetic-one", ts: "t1",
    terminal: "failed:register-digest", legs: [LEG] });
  assert.deepEqual(a, { added: 1, upgraded: 0, unreadable: 0 });
  assert.equal(store().marks.venzy[0].terminal, "failed:register-digest");
  assert.equal(violations(store()).length, 1, "A — unfiltered, the probes still see the leg");
  assert.equal(violations(store()).filter((v) => v.material).length, 1, "A — material=1");
  assert.equal(violations(acceptedConflicts(store())).length, 0, "A — no verdict surface may read it");

  // B) the re-run DELIVERS and confirms the SAME leg. Nothing is added — and everything changes.
  const b = writeKnownConflictsFor(studio, { names: ["VENZY"], codename: "synthetic-two", ts: "t2",
    legs: [LEG] });
  assert.deepEqual(b, { added: 0, upgraded: 1, unreadable: 0 }, "no new row; the existing row's terminal is lifted");
  assert.equal(store().marks.venzy.length, 1, "an upgrade is not a second row");
  assert.equal(store().marks.venzy[0].terminal, "delivered");
  assert.equal(store().marks.venzy[0].source, "auto:delivery synthetic-one",
    "ONLY `terminal` moves — every other field of the existing row is left exactly as written");
  // C) …which is the pre- behaviour: a delivered leg is remembered and can raise the tripwire.
  assert.equal(violations(acceptedConflicts(store())).length, 1,
    "C — a leg a DELIVERED run confirmed is visible to the recall tripwire again");

  // and the monotonicity that makes the upgrade safe: a later FAILED run cannot demote it back.
  const c = writeKnownConflictsFor(studio, { names: ["VENZY"], codename: "synthetic-three", ts: "t3",
    terminal: "failed:verdict", legs: [LEG] });
  assert.deepEqual(c, { added: 0, upgraded: 0, unreadable: 0 });
  assert.equal(store().marks.venzy[0].terminal, "delivered", "delivered never degrades to failed");
  assert.equal(violations(acceptedConflicts(store())).length, 1);
});

test("round 3: the upgrade is pure-core too, and lifts every stored copy of the uri", () => {
  // a hand-edited store can hold the same record twice (path + URL shape); upgrading one and leaving
  // the other would make the same leg simultaneously visible and hidden to the verdict surface.
  const ledger = { schema_version: 3, marks: { venzy: [
    { uri: "/mark/tr/1", terminal: "failed:register-digest" },
    { uri: "https://tm.corsearch.com/mark/tr/1", terminal: "failed:verdict" },
    { uri: "/mark/tr/2", terminal: "failed:verdict" },
  ] } };
  const { added, upgraded } = upsertDeliveryLegs(ledger, { names: ["VENZY"], codename: "x", ts: "t",
    legs: [{ uri: "/mark/tr/1", mark_text: "VENZY", status: "live" }] });
  assert.equal(added, 0);
  assert.equal(upgraded, 2, "both stored shapes of the confirmed record are lifted");
  assert.deepEqual(ledger.marks.venzy.map((r) => r.terminal), ["delivered", "delivered", "failed:verdict"],
    "the leg this delivery did NOT confirm keeps its terminal");
});

// ── ROUND-3 (the same finding's second face): THE ROLLBACK HAZARD ───────────────────────────────────
// `terminal` joined ROW_KEYS while files still said schema_version 1, so a store this branch writes is
// unparseable to the previous driver (`known_conflicts_row_key_unknown:terminal`) — which swallows the
// throw and reads the store as ABSENT. The recall probes, the pre-clamp read and the reviewer pack all
// become no-ops with no signal. Half the fix is honest versioning; half is that a file which exists
// and cannot be used is never confused with a mark that has no store.
test("round 3: the store states the version it actually is, and a future version is diagnosed as one", () => {
  const studio = mkdtempSync(join(tmpdir(), "kc-studio-"));
  writeKnownConflictsFor(studio, { names: ["ACME"], codename: "run-one", ts: "t1",
    legs: [{ uri: "/mark/us/1", mark_text: "ACME", status: "live" }] });
  const p = join(storeDirFor(studio), "acme.json");
  assert.equal(JSON.parse(readFileSync(p, "utf8")).schema_version, STORE_SCHEMA_VERSION,
    "a file carrying `terminal` rows must not claim to be v1");

  // a v1 file that gains a v3 row is stamped up on the write that added it
  writeFileSync(p, JSON.stringify({ schema_version: 1, marks: { acme: [{ uri: "/mark/us/9", status: "live" }] } }));
  writeKnownConflictsFor(studio, { names: ["ACME"], codename: "run-two", ts: "t2",
    legs: [{ uri: "/mark/us/8", mark_text: "ACME", status: "live" }] });
  assert.equal(JSON.parse(readFileSync(p, "utf8")).schema_version, STORE_SCHEMA_VERSION);

  // …and a file from a NEWER driver names the real problem instead of blaming a row key
  assert.throws(() => parseKnownConflicts(JSON.stringify({ schema_version: 99, marks: {} })),
    /known_conflicts_schema_future:99/);
  assert.doesNotThrow(() => parseKnownConflicts(JSON.stringify({ schema_version: STORE_SCHEMA_VERSION, marks: {} })));
  assert.doesNotThrow(() => parseKnownConflicts(JSON.stringify({ schema_version: 1, marks: {} })), "older stores still read");
});

test("round 3: a store file that EXISTS but cannot be parsed is reported, never read as 'no store'", () => {
  const studio = mkdtempSync(join(tmpdir(), "kc-studio-"));
  writeKnownConflictsFor(studio, { names: ["ACME"], codename: "run-one", ts: "t1",
    legs: [{ uri: "/mark/us/1", mark_text: "ACME", status: "live" }] });
  const p = join(storeDirFor(studio), "acme.json");
  // what a rollback looks like from the reading side: a row key this driver does not know
  writeFileSync(p, JSON.stringify({ schema_version: 1, marks: { acme: [{ uri: "/mark/us/1", outcome: "delivered" }] } }));
  const seen = [];
  const doc = readKnownConflictsFor(studio, ["ACME"], { onError: (path, err) => seen.push([path, String(err.message)]) });
  assert.equal(doc, null, "unusable ⇒ nothing to read (the never-kill posture is unchanged)");
  assert.equal(seen.length, 1, "…but the caller is TOLD, so the no-op is not silent");
  assert.equal(seen[0][0], p);
  assert.match(seen[0][1], /known_conflicts_row_key_unknown:outcome/);
  // a mark that simply has no store stays silent — that is the normal state, not an incident
  const quiet = [];
  assert.equal(readKnownConflictsFor(studio, ["NEVER SEARCHED"], { onError: () => quiet.push(1) }), null);
  assert.equal(quiet.length, 0);
  // a reporter that throws must never cost the read
  assert.doesNotThrow(() => readKnownConflictsFor(studio, ["ACME"], { onError: () => { throw new Error("boom"); } }));
});

test("parseKnownConflicts accepts the terminal key; an unknown key still throws token-first", () => {
  const doc = JSON.stringify({ schema_version: 1, marks: { venzy: [{ uri: "/mark/tr/1", terminal: "failed:verdict" }] } });
  assert.equal(parseKnownConflicts(doc).marks.venzy[0].terminal, "failed:verdict");
  const bad = JSON.stringify({ schema_version: 1, marks: { venzy: [{ uri: "/mark/tr/1", outcome: "x" }] } });
  assert.throws(() => parseKnownConflicts(bad), /known_conflicts_row_key_unknown:outcome/);
});
