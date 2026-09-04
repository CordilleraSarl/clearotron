// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// report-card-record.test.mjs — conversion 5's transport, the first fan-out one.
//
// The arms that carry this conversion are the BINDING arms and the COUNTING arm. A card seat writing the
// wrong finding's file is the failure this stage's isolation exists to prevent, and O3c's 224/0 was a
// measured habit until the driver started binding the index.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  acceptReportCard, renderReportCard, recordReportCard, reportCardWasRecorded,
  reportCardCallPaths, findingForOrdinal, findingsDocFor, renderSourceBullet, cardFile,
} from "../report-card-record.mjs";
import { carriesOwnFrame } from "../card-frame.mjs";

// ── — THE FIXTURE IS THE REAL RECORD SHAPE NOW, AND THAT IS THE WHOLE STORY ──────────────────
//
// This fixture used to carry `register: "EUTM"` and `number: "018123456"` on the registration, and a
// `source_type` of `"register"`. NONE OF THE THREE IS A REAL VALUE. The registration schema is written
// out in contract-e3-backlog.mjs — `{"uri", optionally "classes", "status", "filed", "expiry",
// "jurisdiction"}` — and the source_type enum is `register-vendor` / `register-euipo` / the two
// common-law ones / `case-law` (gateway.mjs).
//
// The composer PREFERRED `register` and `number`, so against this fixture it looked correct, and against
// every record the engine has ever written it fell through to the enum token and the URI path and
// produced `- Source: [register-euipo · /mark/eu/018575624]` in a client-facing card. The unit test
// passed the entire time, because it was measuring a shape that does not exist.
//
// A fixture invented to suit the code under test is not evidence about the code. This one is now the
// delivered shape, and report-card-source-bullet.test.mjs holds the corpus comparison that would have
// caught it on day one.
const FINDING = (ord = 2) => ({
  ordinal: ord, mark: "NOVAPULSE",
  owner: { name: "Lumengarde SA", registrations: [{ uri: "/mark/eu/018123456", classes: ["9"], status: "Registered", jurisdiction: "EU" }] },
  source: { source_type: "register-euipo", resolved_link: "https://tm.example/m/018123456" },
});
const CALL = (ord = 2) => ({
  ordinal: String(ord),
  full_detail: [
    { lead: "Filing", text: "Registered in class 9 and renewed to 2031" },
    { lead: "Risk assessment", text: "On the available signals the owner appears likely to object" },
    { text: "owner counsel has opposed twice in this class", internal: true },
  ],
});
const runWith = (findings = [FINDING(2)]) => {
  const dir = mkdtempSync(join(tmpdir(), "rcard-"));
  writeFileSync(join(dir, "findings.json"), JSON.stringify({ findings }, null, 2));
  return dir;
};

test("the render is the card BODY — no head, no meta lines, so the driver composes the frame", () => {
  const v = acceptReportCard(CALL(), { boundOrdinal: "2", finding: FINDING() });
  assert.equal(v.ok, true, v.reason);
  assert.match(v.content, /^### Full detail$/m);
  // carriesOwnFrame is what assembleReportMd branches on: a body that carried its own head would be
  // handed a SECOND composed head above it. The compliant shape is frameless, and this asserts it
  // through the shipped predicate rather than by eyeballing the string.
  assert.equal(carriesOwnFrame(v.content), false, "the render carries its own frame — assembly would stack a second head on it");
  assert.ok(!/^## /m.test(v.content), "the body emitted a card head");
  assert.ok(!/^- ord:/m.test(v.content), "the body emitted a meta line the driver stamps");
});

test("every line shape the seat used to hit is the driver's now", () => {
  const { content } = acceptReportCard(CALL(), { boundOrdinal: "2", finding: FINDING() });
  assert.match(content, /^- \*\*Filing\.\*\* Registered in class 9/m, "the bold lead-in and its full stop are rendered, not typed");
  // `::p::` FIRST, before any lead-in — the position the render splits on deterministically. A flag
  // rendered after a bold lead-in reads as body text to every consumer that strips internal notes.
  assert.match(content, /^- ::p:: owner counsel/m, "the internal marker is not in the position the render splits on");
  assert.ok(!/\*\*::p::/.test(content), "the marker was bold-wrapped, which the old dictation spent a sentence forbidding");
  assert.match(content, /^- Source: \[EUIPO · 018123456\]\(https:\/\/tm\.example\/m\/018123456\)$/m,
    "the Source line is composed from the record — the OFFICE the record names and the NUMBER inside its "
    + "URI, never the source_type enum and never the URI path (#1009)");
});

test("THE SOURCE LINE COMES FROM THE RECORD — a seat cannot supply or spoof it", () => {
  // The transcription class in its purest form: the seat was composing a URL from a provider host table
  // this stage is not even given. A payload trying to set one must reach nothing.
  const v = acceptReportCard({ ...CALL(), source: { url: "https://evil.example/nope", id: "999" } },
    { boundOrdinal: "2", finding: FINDING() });
  assert.ok(!v.content.includes("evil.example"), "a seat-sent source link reached the rendered card");
  assert.match(v.content, /tm\.example\/m\/018123456/);
  // …and with no link on the record there is simply no Source line, rather than an invented one.
  const bare = acceptReportCard(CALL(), { boundOrdinal: "2", finding: { ordinal: 2, owner: { name: "X" } } });
  assert.equal(renderSourceBullet({ ordinal: 2 }), "");
  assert.ok(!/^- Source:/m.test(bare.content), "a Source line was rendered with no link on the record");
});

test("⭐ THE BOUND INDEX — a payload naming any other card is refused", () => {
  const f = FINDING();
  assert.match(acceptReportCard({ ...CALL(), ordinal: "7" }, { boundOrdinal: "2", finding: f }).reason,
    /^reportcard_ordinal_mismatch:7 — this turn is bound to card 2/);
  assert.match(acceptReportCard({ ...CALL(), ordinal: "" }, { boundOrdinal: "2", finding: f }).reason,
    /^reportcard_ordinal_missing:/);
  // NO BINDING AT ALL is refused too, and this is the arm that matters most: an unbound turn that fell
  // back to whatever the payload claimed would restore exactly the habit this conversion replaces.
  assert.match(acceptReportCard(CALL(), { boundOrdinal: null, finding: f }).reason,
    /^reportcard_no_bound_ordinal:/);
  assert.match(acceptReportCard(CALL(), { boundOrdinal: "", finding: f }).reason,
    /^reportcard_no_bound_ordinal:/);
});

test("the card is written at the BOUND ordinal's path, never at the claimed one", () => {
  const dir = runWith([FINDING(2), FINDING(3)]);
  const r = recordReportCard(dir, { ...CALL(), ordinal: "2" }, { boundOrdinal: "2" });
  assert.equal(r.written, cardFile(dir, "2"));
  assert.equal(existsSync(cardFile(dir, "3")), false, "a second card appeared from a single bound turn");
});

test("the bullet rules moved to the boundary and refuse in the turn", () => {
  const o = { boundOrdinal: "2", finding: FINDING() };
  assert.match(acceptReportCard({ ordinal: "2", full_detail: [] }, o).reason, /^reportcard_detail_missing:/);
  assert.match(acceptReportCard({ ordinal: "2", full_detail: [{ text: "" }] }, o).reason, /^reportcard_bullet_text_missing:/);
  assert.match(acceptReportCard({ ordinal: "2", full_detail: [{ text: "a\nb" }] }, o).reason, /^reportcard_bullet_newline:/);
  assert.match(acceptReportCard({ ordinal: "2", full_detail: [{ text: "EUTM 018123456 is live" }] }, o).reason,
    /^reportcard_bullet_registration_number:/,
    "the number-suppression rule was a prompt sentence and is a refusal now — the Source line is the one place a number appears");
  assert.match(acceptReportCard({ ordinal: "2", full_detail: [{ lead: "Filing.", text: "x".repeat(90) }] }, o).reason,
    /^reportcard_lead_punctuated:/);
  // The floor is measured on the RENDER, and the Source line the driver composes is itself ~60 chars —
  // so a card WITH a link can never be too short. Measured against a record that carries none, which is
  // the only shape where the floor can still speak.
  assert.match(acceptReportCard({ ordinal: "2", full_detail: [{ text: "short" }] },
    { boundOrdinal: "2", finding: { ordinal: 2, owner: { name: "X" } } }).reason,
    /^reportcard_too_short:\d+ characters/);
});

test("THE CAPTURE IS PER ORDINAL — 26 cards mean 26 captures, and a refusal is legible beside them", () => {
  const dir = runWith([FINDING(1), FINDING(2)]);
  recordReportCard(dir, CALL(1), { boundOrdinal: "1" });
  const bad = recordReportCard(dir, { ordinal: "2", full_detail: [] }, { boundOrdinal: "2" });
  assert.match(bad.refused, /^reportcard_detail_missing:/);
  assert.ok(existsSync(reportCardCallPaths(dir, "1").payload), "card 1's capture is missing");
  assert.ok(existsSync(reportCardCallPaths(dir, "2").payload), "a refused call left no capture — the discriminator would be absent exactly when a run went wrong");
  assert.equal(existsSync(cardFile(dir, "2")), false, "a refused call wrote a card anyway");
  assert.equal(reportCardWasRecorded(dir, "1"), true);
  assert.equal(reportCardWasRecorded(dir, "2"), true, "the discriminator answers for a refused call too — it records that the TOOL was used");
  assert.equal(reportCardWasRecorded(dir, "3"), false, "a card that was never attempted must read as not recorded");
  // One capture must never overwrite another: that is the whole reason the path carries the ordinal.
  assert.notEqual(reportCardCallPaths(dir, "1").payload, reportCardCallPaths(dir, "2").payload);
});

test("the finding is read from the RUN, so the Source line joins the card it was built from", () => {
  const dir = runWith([FINDING(4)]);
  assert.equal(findingForOrdinal(dir, "4")?.mark, "NOVAPULSE");
  assert.equal(findingForOrdinal(dir, "9"), null, "an ordinal with no finding must read as null, never as {}");
  const r = recordReportCard(dir, CALL(4), { boundOrdinal: "4" });
  assert.equal(r.refused, null, r.refused);
  assert.match(readFileSync(cardFile(dir, "4"), "utf8"), /^- Source: \[EUIPO · 018123456\]/m);
});

test("ARCHIVE PATH — a self-framed card still assembles the old way, and nothing here changed that", () => {
  // The archive-validator trap, ruled binding on every conversion: a new way IN, never a replacement.
  // Archived and replayed cards were hand-written under the old dictation and carry their own head;
  // `carriesOwnFrame` is the discriminator assembly branches on, and it must still see them.
  const archived = "## Lumengarde SA — NOVAPULSE, EU\n- ord: 2\n- group: on-field\n### Full detail\n- Old hand-written detail.\n";
  assert.equal(carriesOwnFrame(archived), true, "an archived card stopped being recognised — every replay would gain a second head");
  assert.equal(carriesOwnFrame(renderReportCard({ ordinal: "2", full_detail: [{ text: "x", lead: "", internal: false }] }, null)), false);
});

test("⭐ COUNTING — EVERY pipeline site that dispatches report-card binds the ordinal", () => {
  // A COUNT, not a spot check (the count-writers rule). Conversion 4's lesson was that a retirement
  // reaches the first-attempt surface and misses the correction surface: here the second site is the
  // lint-repair re-render, a FRESH COLD turn, and a card written there without a binding would land
  // unbound. Enumerated from the SOURCE so a third site added later fails this instead of shipping.
  const src = readFileSync(new URL("../pipeline.mjs", import.meta.url), "utf8");
  const sites = [...src.matchAll(/stage\("report-card",\s*\{([^}]*)\}/g)].map((m) => m[1]);
  // THREE, and the third is why this arm is a count. The scope note for this conversion said two — the
  // render fan-out and the lint-repair re-render — because those are the two anybody reads about. The
  // STALE-REPAIR re-render (`trigger: "stale-repair"`, the AD-2 A1 path) is a third, and an enumeration
  // done from memory missed it. It binds correctly; the point is that nothing would have said so.
  assert.equal(sites.length, 3,
    `pipeline dispatches report-card from ${sites.length} site(s); this test knows about 3 (the render fan-out, the lint-repair re-render, the stale-repair re-render). A new one must bind the ordinal too — read it, then update this count deliberately.`);
  for (const [i, args] of sites.entries()) {
    assert.match(args, /axis:\s*String\(/,
      `report-card dispatch site ${i + 1} does not pass an axis — the grant resolves by it AND the tool binds the card index from it, so an unbound turn writes a card that could land on any finding`);
  }
});

// A LEAD-IN IS HALF A BULLET, and the half that was unchecked. `text` was validated for newlines from the
// first draft and `lead` was not, so this arm exists because the asymmetry shipped: a two-line lead-in
// renders `- **Risk\nassessment.** …`, whose second line leaves the list entirely. The sibling arm above
// proves the text side; without this one the rule is only half enforced and the render is the thing that
// tells you, in a delivered report.
test("a lead-in carrying a newline is refused, exactly as the bullet text is", () => {
  const body = (lead) => ({ ordinal: "1", full_detail: [
    { lead, text: "The mark is confusable with the cited registration across the commercial field." },
  ] });
  const bad = acceptReportCard(body("Risk\nassessment"), { boundOrdinal: "1" });
  assert.equal(bad.ok, false, "a newline inside the lead-in must be refused, not rendered");
  assert.match(bad.reason, /^reportcard_lead_newline:/);
  // and the rule is not over-broad: an ordinary lead-in still passes. It reads "Risk assessment" rather
  // than "Risk" since D3 — a card with no read-led bullet is refused now, so a bare "Risk" would
  // fail this arm for a reason it is not about, and the arm's own subject is the newline.
  assert.equal(acceptReportCard(body("Risk assessment"), { boundOrdinal: "1" }).ok, true,
    "a normal lead-in must still be accepted — the check is on the newline, not on the field");
});

// ── — A CARD WHOSE FINDING CANNOT BE FOUND MUST NOT RENDER LIKE ONE THAT HAS NO RECORD ─────────
//
// `renderSourceBullet` returns "" for three legitimate reasons — no resolved link, a non-register source
// type, and a record-less run — and the card then ships with no `- Source:` bullet, correctly.
// A card bound to an ordinal findings.json does not carry rendered EXACTLY the same way, and that fourth
// state is a driver-side inconsistency shipping as a well-formed card.
//
// Nothing downstream separates them: `registry-record-coverage` harvests `/mark/` URIs off the delivered
// report, so a card that cites nothing has nothing to harvest and the run goes green BECAUSE the evidence
// is missing. The artifact cannot carry the distinction, so it is made before a card is written.

test("#1237: a bound ordinal findings.json does not carry is REFUSED by name, not rendered", () => {
  const v = acceptReportCard(CALL(9), { boundOrdinal: "9", finding: null, findingsReadable: true });
  assert.equal(v.ok, false, "the card rendered for an ordinal the run does not hold");
  assert.match(v.reason, /^reportcard_ordinal_unknown:9/, "refused, but not by a name a corrective ladder can key on");
});

test("#1237: a finding with an empty resolved_link still RENDERS — the record-less run stays a legitimate green", () => {
  // The state the refusal must never touch. This is what a genuine record-less finding looks like, and
  // the absent Source bullet is the correct, honest output for it.
  const recordless = { ...FINDING(2), source: { source_type: "register-euipo", resolved_link: "" } };
  const v = acceptReportCard(CALL(), { boundOrdinal: "2", finding: recordless, findingsReadable: true });
  assert.equal(v.ok, true, `a legitimate record-less finding was refused: ${v.reason}`);
  assert.doesNotMatch(v.content, /- Source:/, "a card with no record link composed a Source bullet anyway");
});

test("#1237 THE DISCRIMINATION — the two states produce different outcomes, which is the whole issue", () => {
  // Before this, both of these rendered and the artifacts were byte-identical. Asserted as a PAIR: either
  // half alone can pass while the states remain indistinguishable.
  const recordless = { ...FINDING(2), source: { source_type: "register-euipo", resolved_link: "" } };
  const legit = acceptReportCard(CALL(), { boundOrdinal: "2", finding: recordless, findingsReadable: true });
  const bug = acceptReportCard(CALL(), { boundOrdinal: "2", finding: null, findingsReadable: true });
  assert.equal(legit.ok, true);
  assert.equal(bug.ok, false);
  assert.notEqual(legit.content, bug.content, "the two states still produce the same artifact");
});

test("#1237: an UNREADABLE findings.json does not refuse — that is the pipeline-breaking downside", () => {
  // `finding == null` is true for three different causes and only one is this issue's bug. Refusing on the
  // bare null would fail every card on a run that is merely early, which is why the check is a conjunction
  // and why `findingsReadable` is measured rather than assumed.
  const unreadable = acceptReportCard(CALL(), { boundOrdinal: "2", finding: null, findingsReadable: false });
  assert.equal(unreadable.ok, true, "a card was refused because findings.json could not be read — that is not the card's fault");
  // …and a caller that has not measured it at all keeps today's behaviour rather than inheriting a refusal.
  assert.equal(acceptReportCard(CALL(), { boundOrdinal: "2", finding: null }).ok, true);
});

test("#1237: findingsDocFor keeps the CAUSE that findingForOrdinal collapses", () => {
  const dir = runWith([FINDING(2)]);
  assert.deepEqual(findingsDocFor(dir, "2").readable, true);
  assert.equal(findingsDocFor(dir, "2").finding?.ordinal, 2);
  // readable, ordinal absent — the bug state
  assert.deepEqual(findingsDocFor(dir, "9"), { readable: true, finding: null });
  // no file at all — NOT the bug state
  const empty = mkdtempSync(join(tmpdir(), "rcard-none-"));
  assert.deepEqual(findingsDocFor(empty, "2"), { readable: false, finding: null });
  // present and not JSON — also not the bug state
  const broken = mkdtempSync(join(tmpdir(), "rcard-broken-"));
  writeFileSync(join(broken, "findings.json"), "```json\n{ findings: [] }\n```");
  assert.deepEqual(findingsDocFor(broken, "2"), { readable: false, finding: null });
  // and the old reader still collapses all three, which is why it is no longer what decides
  for (const d of [dir, empty, broken]) assert.equal(findingForOrdinal(d, "9"), null);
});

test("#1237 END TO END — recordReportCard writes no card file for an ordinal the run does not carry", () => {
  // Through the real transport, because the refusal has to happen before a file lands on disk: a card
  // written and then judged is a card the assembler can pick up.
  const dir = runWith([FINDING(2)]);
  const r = recordReportCard(dir, CALL(9), { boundOrdinal: "9" });
  assert.equal(r.written, null, "a card file was written for a finding the run does not hold");
  assert.match(String(r.refused), /^reportcard_ordinal_unknown:9/);
  assert.equal(existsSync(cardFile(dir, "9")), false, "the card file exists on disk despite the refusal");
  // The capture still happened — a refused call is evidence, and that is this transport's whole shape.
  assert.ok(r.captured, "the refused call was not captured, so the refusal is unauditable");
  // The control: the ordinal the run DOES carry still writes.
  const ok = recordReportCard(dir, CALL(2), { boundOrdinal: "2" });
  assert.equal(ok.refused, null, `the healthy card was refused too: ${ok.refused}`);
  assert.ok(existsSync(cardFile(dir, "2")), "the healthy card did not write — the refusal is firing on everything");
});
