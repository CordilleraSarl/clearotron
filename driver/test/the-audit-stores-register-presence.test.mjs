// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — the audit stores every live, matter-in-scope enumerated record, whatever its
// screen verdict. On the measured run, 65 live in-scope records carrying the client's dominant element
// ended in NO stored artifact: the recall machinery keys on surface:* verdicts by design, and audit.md
// — the one artifact that survives the purge — never heard of them. These arms plant DIFFERENT members
// of each class a filter quantifies over (the every/never rule), never only the member the code was
// written against.
import test from "node:test";
import assert from "node:assert/strict";
import { deriveRegisterPresence, scopeOfficeSet, US_STATE_OFFICE } from "../publish/register-presence.mjs";
import { buildAuditMd } from "../publish/audit-from-spine.mjs";

const rec = (over = {}) => ({
  record_id: "/mark/us/DEFAULT0001", mark_text: "SOMEMARK", office: "us", jurisdictions: "US",
  classes: [9], status: "REGISTERED", owner_name: "OWNER LLC",
  screen: { screen_verdict: "surface:in-scope-live", status: "REGISTERED" },
  application_date: "2020-01-01", registration_date: "2021-01-01",
  ...over,
});
const band = (...records) => ({ enumerated: records, crowds: [] });
const derive = (records, opts = {}) => deriveRegisterPresence(band(...records),
  { dominantElement: "PROPER", scopeClasses: ["9", "35", "42"], scopeTerritories: ["US", "EU"], ...opts });
const ids = (p) => p.rows.map((r) => r.record_id);

test("liveness gates the store — and every dead spelling of the class, not one", () => {
  const live = rec({ record_id: "/a/live" });
  const noStatus = rec({ record_id: "/a/nostatus", status: null, screen: { screen_verdict: "surface:in-scope-live" } });
  const deadWord = rec({ record_id: "/a/deadword", status: "EXPIRED", screen: { screen_verdict: "surface:in-scope-live", status: "EXPIRED" } });
  const deadScreen = rec({ record_id: "/a/deadscreen", screen: { live_status: "dead", screen_verdict: "surface:in-scope-live" } });
  const p = derive([live, noStatus, deadWord, deadScreen]);
  assert.deepEqual(ids(p), ["/a/live", "/a/nostatus"], "live + unknown-status stored; word-dead and screen-dead both out");
});

test("NO screen-verdict filter exists — the not-owed verdicts are where the measured 65 lived", () => {
  const surfaced = rec({ record_id: "/v/surfaced" });
  const allClass = rec({ record_id: "/v/allclass", screen: { screen_verdict: "surface:all-class" } });
  const verdictless = rec({ record_id: "/v/none", screen: {} });
  const p = derive([surfaced, allClass, verdictless]);
  assert.deepEqual(ids(p), ["/v/allclass", "/v/none", "/v/surfaced"], "all three verdict shapes stored");
  assert.equal(p.rows.find((r) => r.record_id === "/v/none").screen_verdict, null, "an absent verdict is stored as null, not ''");
});

test("class scope: match stored, mismatch out, class-less and empty-scope fail-safe IN", () => {
  const inCls = rec({ record_id: "/c/in", classes: [42] });
  const outCls = rec({ record_id: "/c/out", classes: [25] });
  const noCls = rec({ record_id: "/c/none", classes: [] });
  const p = derive([inCls, outCls, noCls]);
  assert.deepEqual(ids(p), ["/c/in", "/c/none"]);
  const q = derive([outCls], { scopeClasses: [] });
  assert.deepEqual(ids(q), ["/c/out"], "no class scope recorded ⇒ no class restriction");
});

test("territory scope: EU pulls EM, member nationals and WO; US pulls XS; outsiders stay out", () => {
  const em = rec({ record_id: "/t/em", jurisdictions: "EM", office: "em" });
  const fr = rec({ record_id: "/t/fr", jurisdictions: "FR", office: "fr" });
  const de = rec({ record_id: "/t/de", jurisdictions: "DE", office: "de" });
  const wo = rec({ record_id: "/t/wo", jurisdictions: "WO", office: "wo" });
  const xs = rec({ record_id: "/t/xs", jurisdictions: "XS", office: "xs" });
  const india = rec({ record_id: "/t/in", jurisdictions: "IN", office: "in" });
  const brazil = rec({ record_id: "/t/br", jurisdictions: "BR", office: "br" });
  const officeless = rec({ record_id: "/t/none", jurisdictions: null, office: null });
  const p = derive([em, fr, de, wo, xs, india, brazil, officeless]);
  assert.deepEqual(ids(p), ["/t/de", "/t/em", "/t/fr", "/t/none", "/t/wo", "/t/xs"],
    "EM + two different member nationals + WO + XS + the office-less fail-safe in; IN and BR out");
});

test("GB is not an EU member any more — UK scope is what admits it (two scopes, opposite answers)", () => {
  const gb = rec({ record_id: "/t/gb", jurisdictions: "GB", office: "gb" });
  assert.deepEqual(ids(derive([gb], { scopeTerritories: ["EU"] })), [], "EU scope does not admit GB");
  assert.deepEqual(ids(derive([gb], { scopeTerritories: ["UK"] })), ["/t/gb"], "UK scope does (canonical fold UK→GB)");
});

test("an empty or absent territory scope restricts nothing — worldwide is the inclusive direction", () => {
  const india = rec({ record_id: "/t/in", jurisdictions: "IN", office: "in" });
  assert.deepEqual(ids(derive([india], { scopeTerritories: null })), ["/t/in"]);
  assert.deepEqual(ids(derive([india], { scopeTerritories: [] })), ["/t/in"]);
  assert.equal(scopeOfficeSet([]), null);
  assert.equal(scopeOfficeSet(null), null);
});

test("the dominant-element column speaks band-shape's own ladder, and noise reads null", () => {
  const tok = rec({ record_id: "/d/tok", mark_text: "PROPER DATA" });
  const edit1 = rec({ record_id: "/d/edit", mark_text: "PROPPER" });
  const concat = rec({ record_id: "/d/concat", mark_text: "PROPERLY PRESSED" });
  const noise = rec({ record_id: "/d/noise", mark_text: "ZEBRA" });
  const p = derive([tok, edit1, concat, noise]);
  const basis = Object.fromEntries(p.rows.map((r) => [r.record_id, r.dominant_element]));
  assert.equal(basis["/d/tok"], "token-identical");
  assert.equal(basis["/d/edit"], "token-edit-1");
  assert.equal(basis["/d/concat"], "concatenation");
  assert.equal(basis["/d/noise"], null, "a stored row without the element stays stored — the column is a field, not a filter");
  const q = derive([tok], { dominantElement: null });
  assert.equal(q.rows.length, 1, "no comparable dominant element still derives the store");
  assert.equal(q.rows[0].dominant_element, null);
  assert.equal(q.dominant_element, null);
});

test("XS is admitted by a US scope only", () => {
  const xs = rec({ record_id: "/t/xs", jurisdictions: US_STATE_OFFICE, office: "xs" });
  assert.deepEqual(ids(derive([xs], { scopeTerritories: ["EU", "CH"] })), [], "no US in scope ⇒ no XS");
  assert.deepEqual(ids(derive([xs], { scopeTerritories: ["US"] })), ["/t/xs"]);
});

const SPINE = [
  "# Register findings — Mark: TEST", "",
  "### Risk-relevant records",
  "| Mark | Owner | Classes | Status |", "|---|---|---|---|",
  "| TESTMARK | SOMEONE | 9 | REGISTERED |",
].join("\n");

test("buildAuditMd: no registerPresence input → no section, and the count is NULL, not zero", () => {
  const { md, counts } = buildAuditMd(SPINE, "");
  assert.ok(!md.includes("# Register Presence"), "legacy callers keep byte-identical output");
  assert.equal(counts.presenceRows, null, "absent store and empty store must differ by VALUE");
});

test("buildAuditMd renders the store: every row lands in the table, and the count agrees", () => {
  const presence = derive([
    rec({ record_id: "/p/one", mark_text: "PROPER ONE" }),
    rec({ record_id: "/p/two", mark_text: "OTHER | PIPED" }),
  ]);
  const { md, counts } = buildAuditMd(SPINE, "", { registerPresence: presence });
  assert.equal(counts.presenceRows, 2);
  const section = md.split("# Register Presence")[1];
  assert.ok(section, "section rendered");
  const tableRows = section.split("\n").filter((l) => l.startsWith("| /p/"));
  assert.equal(tableRows.length, 2, "one table row per stored record");
  assert.ok(section.includes("OTHER \\| PIPED"), "a pipe in a mark cannot break the table");
  assert.ok(section.includes("surface:in-scope-live"), "the screen verdict is stored with the record (the acceptance's own field)");
  assert.ok(section.includes("- rows: 2"));
});

test("buildAuditMd renders the honest zero when the store derived and holds nothing", () => {
  const presence = derive([]);
  const { md, counts } = buildAuditMd(SPINE, "", { registerPresence: presence });
  assert.equal(counts.presenceRows, 0);
  assert.ok(md.includes("# Register Presence"));
  assert.ok(md.includes("no live in-scope records were enumerated this run"));
});
