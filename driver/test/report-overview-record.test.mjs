// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// report-overview-record.test.mjs — conversion 4's transport.
//
// THE ARMS THAT MATTER MOST HERE ARE THE CONSUMER ARMS, and that is conversion 3's lesson applied where
// it costs the most. A render that satisfies only its own reader can still be wrong for everything
// downstream; this artifact's downstream is the DELIVERED REPORT, so the render is driven through the
// parsers and the splice anchor that assemble it, not merely through parseFront.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { tmpdir } from "node:os";
import {
  acceptReportOverview, renderReportOverview, recordReportOverview, readReportIdentity,
  reportOverviewWasRecorded, reportOverviewCallPaths, IDENTITY_FILE, PROSE_FILE,
} from "../report-overview-record.mjs";
import { parseFront, parseSections, parseCards, stripInternal } from "../publish/parse.mjs";

const IDENTITY = {
  schema_version: 1,
  matter: "TMP8439", title: "PROJECT NOVAPULSE", client: "ACME Interactive", use: "codename",
  classes: "9, 41", run: "2026-01-01 · corsearch + common-law",
  overall_label: "MEDIUM", overall_badge: "l3",
};
const CAPTION = "One owner holds a near-identical mark for the same goods and is likely to object.";
const CALL = {
  overall_caption: CAPTION,
  actions: [
    { text: "Use-check across marketplaces: no game titles found", source_link: "https://x.example/1" },
    { text: "Register status pull could not be closed from the public record", internal: true },
  ],
  methodology: "Register + marketplace + general web; transliteration variants searched.",
};

const runDirWith = (identity = IDENTITY) => {
  const dir = mkdtempSync(join(tmpdir(), "rov-"));
  mkdirSync(driverDir(dir), { recursive: true });
  if (identity) writeFileSync(join(dir, IDENTITY_FILE), JSON.stringify(identity, null, 2) + "\n");
  return dir;
};

test("the render carries every driver-held front-matter key, and parseFront reads them all back", () => {
  const v = acceptReportOverview(CALL, { identity: IDENTITY });
  assert.equal(v.ok, true, v.reason);
  const { fm } = parseFront(v.content);
  // The nine keys the seat used to type, now stamped — asserted by NAME AND VALUE. A key-count arm would
  // pass while a value silently went missing, which is the failure this conversion is supposed to remove.
  assert.equal(fm.type, "prelim-clearance");
  assert.equal(fm.matter, "TMP8439");
  assert.equal(fm.title, "PROJECT NOVAPULSE");
  assert.equal(fm.client, "ACME Interactive");
  assert.equal(fm.use, "codename");
  assert.equal(fm.classes, "9, 41");
  assert.equal(fm.run, "2026-01-01 · corsearch + common-law");
  assert.equal(fm.overall_label, "MEDIUM");
  assert.equal(fm.overall_badge, "l3");
  assert.equal(fm.overall_caption, CAPTION);
});

test("THE SPLICE ANCHOR — assembleReportMd finds `# Actions` in the driver's own render", () => {
  // pipeline.mjs matches /^#\s+Actions\b/ to splice the code-built sections in. A render that put the
  // section anywhere else, or spelled the heading differently, would lose the ask list and the
  // only-you section silently — they would simply never be placed.
  const { body } = parseFront(acceptReportOverview(CALL, { identity: IDENTITY }).content);
  assert.match(body, /^#\s+Actions\b/m, "the splice anchor assembleReportMd keys on is not in the render");
  const secs = parseSections(body);
  assert.deepEqual(Object.keys(secs), ["Actions", "Methodology"], "the section set the shell may carry is exactly these two");
  assert.match(secs.Actions, /^### Checks we ran — what we found$/m, "the sub-heading predelivery-lint re-parses is missing");
});

test("the shell emits NO card and NO `# Marks` — parseCards finds nothing to parse", () => {
  const { body } = parseFront(acceptReportOverview(CALL, { identity: IDENTITY }).content);
  assert.equal(parseSections(body).Marks, undefined, "the shell authored a # Marks section — the cards are rendered separately and assembled");
  assert.deepEqual(parseCards(parseSections(body).Marks), [], "a card reached the shell");
});

test("an internal entry renders the ::p:: marker AND the client export strips it", () => {
  // Both halves, because either alone is a false pass: a marker nothing strips leaks a reviewer note to a
  // client, and a strip with no marker to find would pass on a render that emitted none.
  const { body } = parseFront(acceptReportOverview(CALL, { identity: IDENTITY }).content);
  assert.match(body, /^- ::p:: Register status pull/m, "the internal entry lost its marker");
  const client = stripInternal(body, { client: true });
  assert.ok(!client.includes("Register status pull"), "an internal reviewer note survived into the client export");
  assert.ok(client.includes("Use-check across marketplaces"), "…and the ordinary entry was stripped with it");
});

test("THE IDENTITY IS THE DRIVER'S — a seat cannot set one of the nine keys by sending it", () => {
  // The conversion's whole claim is that these values stop passing through the model. A tool that merged
  // unknown params into the front-matter would hand the seat back the exact capability just removed.
  const v = acceptReportOverview({ ...CALL, matter: "TMP0000", overall_label: "LOW", type: "something-else" }, { identity: IDENTITY });
  const { fm } = parseFront(v.content);
  assert.equal(fm.matter, "TMP8439", "a seat-sent `matter` reached the front-matter");
  assert.equal(fm.overall_label, "MEDIUM", "a seat-sent `overall_label` reached the front-matter");
  assert.equal(fm.type, "prelim-clearance", "a seat-sent `type` reached the front-matter");
});

test("no identity on disk — the shell renders the keys it has rather than inventing any", () => {
  // The archived / replayed case. An absent sidecar is a state, not a failure: the caption is the model's
  // and is always there, and the driver's keys are simply the ones it holds.
  const v = acceptReportOverview(CALL, { identity: null });
  assert.equal(v.ok, true, v.reason);
  const { fm } = parseFront(v.content);
  assert.deepEqual(Object.keys(fm), ["type", "overall_caption"], "a missing sidecar produced invented keys");
});

test("the caption refusals state the MEASURED fact, and the sentence cap is refused not folded", () => {
  assert.match(acceptReportOverview({ ...CALL, overall_caption: "" }, { identity: IDENTITY }).reason,
    /^reportoverview_caption_missing:/);
  const four = "One owner holds a near-identical mark. It is live in class 9. The owner has opposed before. Reliance turns on the goods.";
  const r = acceptReportOverview({ ...CALL, overall_caption: four }, { identity: IDENTITY });
  // REFUSED, not folded — the house rule is detector, never repair. A seat told "your caption ran to 4
  // sentences" writes three; a seat whose fourth sentence is silently cut never learns it wrote one.
  assert.match(r.reason, /^reportoverview_caption_too_long:4 sentences \(cap 3\)/,
    "the refusal must carry the measured count, which is what the seat acts on");
  assert.match(acceptReportOverview({ ...CALL, overall_caption: "Two lines\nis one too many." }, { identity: IDENTITY }).reason,
    /^reportoverview_frontmatter_newline:overall_caption/);
  assert.match(acceptReportOverview({ ...CALL, handling_note: "a\nb" }, { identity: IDENTITY }).reason,
    /^reportoverview_frontmatter_newline:handling_note/);
});

test("a newline in a caption WOULD break parseFront — the refusal is not decoration", () => {
  // Proves the guard is about a real consequence rather than a style rule: rendered with the break in
  // place, the front-matter key set is cut short exactly where the caption is.
  const broken = renderReportOverview(
    { overall_caption: "First line\nsecond line", handling_note: "", actions: [], methodology: "" }, IDENTITY);
  assert.equal(parseFront(broken).fm.overall_caption, "First line", "the break did not truncate — re-check the refusal's premise");
});

test("the action refusals name the entry-level fault", () => {
  const id = { identity: IDENTITY };
  assert.match(acceptReportOverview({ ...CALL, actions: [{ text: "" }] }, id).reason, /^reportoverview_action_text_missing:/);
  assert.match(acceptReportOverview({ ...CALL, actions: [{ text: "a\nb" }] }, id).reason, /^reportoverview_action_newline:/);
  assert.match(acceptReportOverview({ ...CALL, actions: [{ text: "x", source_link: "Corsearch (exact): NOVAPULSE" }] }, id).reason,
    /^reportoverview_action_link_unbracketable:/,
    "#875 — a citation label in a URL slot ships a link to nowhere in a document a client reads");
});

test("the floor moved to the boundary and reports the MEASURED length", () => {
  const r = acceptReportOverview({ overall_caption: "Too thin." }, { identity: null });
  assert.match(r.reason, /^reportoverview_too_short:\d+ characters rendered \(floor 120\)/);
});

test("an empty actions list omits the section rather than emitting an empty one", () => {
  const v = acceptReportOverview({ overall_caption: CAPTION, methodology: "Register + marketplace + general web sweep of the mark and its variants." }, { identity: IDENTITY });
  assert.equal(v.ok, true, v.reason);
  assert.deepEqual(Object.keys(parseSections(parseFront(v.content).body)), ["Methodology"]);
});

test("THE DISCRIMINATOR — the capture exists even for a REFUSED call, and no artifact is written", () => {
  const dir = runDirWith();
  const r = recordReportOverview(dir, { overall_caption: "" });
  assert.match(r.refused, /^reportoverview_caption_missing:/);
  assert.ok(existsSync(reportOverviewCallPaths(dir).payload), "a refused call left no capture — the conversion's own proof would be missing exactly when a run went wrong");
  assert.equal(existsSync(join(dir, PROSE_FILE)), false, "a refused call wrote the shell anyway");
  assert.equal(reportOverviewWasRecorded(dir), true, "the discriminator must answer for a refused call too — it records that the TOOL was used, not that it succeeded");
});

test("an accepted call writes the shell, and the capture holds what ARRIVED", () => {
  const dir = runDirWith();
  const r = recordReportOverview(dir, CALL);
  assert.equal(r.refused, null);
  assert.equal(r.written, join(dir, PROSE_FILE));
  assert.equal(r.actions, 2);
  const written = readFileSync(join(dir, PROSE_FILE), "utf8");
  assert.equal(parseFront(written).fm.matter, "TMP8439", "the written file did not get the driver's identity");
  const cap = JSON.parse(readFileSync(reportOverviewCallPaths(dir).payload, "utf8"));
  assert.equal(cap.params.overall_caption, CAPTION, "the capture is the params as received, untidied");
});

test("a run with no sidecar still records — the driver's keys are absent, not invented", () => {
  const dir = runDirWith(null);
  assert.equal(readReportIdentity(dir), null, "an absent sidecar must read as null, never as {}");
  const r = recordReportOverview(dir, CALL);
  assert.equal(r.refused, null, r.refused);
  assert.deepEqual(Object.keys(parseFront(readFileSync(join(dir, PROSE_FILE), "utf8")).fm), ["type", "overall_caption"]);
});

test("no field can author `### Only you can close these` — the three-way disagreement is settled by structure", () => {
  // The skill doc taught the seat to write this section, the dispatch told it not to, and
  // buildOnlyYouSection overwrote it either way. There is no field for it now, so a seat that still
  // wants to write one has nowhere to put it but an entry's text — where it reads as a check, not a
  // section, and the code-built list is spliced in regardless.
  const v = acceptReportOverview({ ...CALL, only_you_can_close_these: ["[Time-critical] Confirm prior use"] }, { identity: IDENTITY });
  assert.equal(v.ok, true, v.reason);
  assert.ok(!v.content.includes("Only you can close these"), "an unknown param reached the render");
});
