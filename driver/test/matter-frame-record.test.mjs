// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// CONVERSION 2 — the matter frame becomes a typed call, and the driver's render has to keep SIX PARSERS
// and TWELVE READER STAGES working.
//
// ── WHY THIS FILE IS SHAPED AROUND THE CONSUMERS RATHER THAN THE RENDERER ───────────────────────────
//
// `matter-context.md` is the widest-read artifact in a run. Asserting that the render matches a golden
// string would pin the renderer to itself and prove nothing about the things that read it — and every
// one of those readers anchors on a regex that lives in ANOTHER file and can move without this one
// noticing. So the arms below call THE SHIPPED PARSERS and assert on what they return. If a consumer's
// regex changes, this file goes red where the change lands, not months later in a round.
//
// The consumers, and the fact each one would silently lose:
//   channelsDiagnosis           the common-law grid falls back to the profile default, reading as "the
//                               frame named no channels" when the frame named six
//   meaningAnglesFromMatterContext  the meaning sweep reverts to its fixed floor
//   parseIntakeAsks             an intake ask evaporates between intake and output (the VENZY miss)
//   validators.matterContext    scope drift stops being detectable
//   anchor-reader               sector/industry/jurisdiction anchors go unfound
//   findSeedNeutralityViolations (S2)  the seed-neutrality tripwire has nothing to scan
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //

import {
  acceptMatterFrame, renderMatterFrame, recordMatterFrame, matterFrameWasRecorded,
  matterFrameCallPaths, MATTER_CONTEXT_FILE, SCOPE_BASES, INTAKE_ASK_OWNERS,
} from "../matter-frame-record.mjs";
import { channelsDiagnosis, channelsFromMatterContext } from "../scope-ledger.mjs";
import { meaningAnglesFromMatterContext } from "../connotation-search.mjs";
import { parseIntakeAsks } from "../pipeline.mjs";
import { findSeedNeutralityViolations } from "../reasoning-tripwires.mjs";
import { validators } from "../verify.mjs";

const SCOPE = Object.freeze({
  marks: ["PROJECT NOVAPULSE"], classes: ["9", "41"],
  jurisdictions: ["EU", "US"], goods: "downloadable game software", customer: "ACME Interactive",
});

const PROSE = [
  "Client: ACME Interactive, a mid-size games studio.",
  "Sector: downloadable game software and live-service play.",
  "Customer base: consumer players in the EU and US; no enterprise channel.",
  "Channels of trade: digital storefronts and the studio's own site.",
  "Off-field sectors: fintech (the in-game wallet is incidental, not a financial product).",
  "Sector-convergence flags: none material this quarter.",
  "Watchlist-owner seeds: BigCo Interactive, Northwind Games.",
  "Scope reasoning: search wide across the majors, cite narrow to the instructed pair.",
].join("\n");

const PARAMS = Object.freeze({
  prose_body: PROSE,
  scope_basis: "instructed",
  scope_jurisdictions: ["EU", "US", "NZ"],
  excluded_jurisdictions: ["CN"],
  search_channels: ["amazon.com", "apps.apple.com", "play.google.com"],
  meaning_angles: ["novapulse cultural appropriation", "novapulse slang meaning"],
  meaning_angles_none: false,
  intake_asks: [{ ask: "Check descriptiveness in the US.", owner: "synthesis" }],
});

const accepted = (over = {}) => {
  const v = acceptMatterFrame({ ...PARAMS, ...over }, { instructedScope: SCOPE });
  assert.equal(v.ok, true, `expected an accepted call: ${v.reason}`);
  return v;
};

function runDir() {
  const d = mkdtempSync(join(tmpdir(), "ct-matterframe-"));
  mkdirSync(driverDir(d), { recursive: true });
  writeFileSync(driverDir(d, "instructed-scope.json"), JSON.stringify(SCOPE));
  return d;
}

// ── THE ARM THAT MATTERS: the six consumers, against the driver's render ────────────────────────────

test("conversion 2 — every consumer of matter-context.md reads the DRIVER's render correctly", () => {
  const md = accepted().content;

  const chan = channelsDiagnosis(md);
  assert.equal(chan.state, "named", "the common-law grid must see a named channel set, not a fallback");
  assert.deepEqual(chan.channels, ["amazon.com", "apps.apple.com", "play.google.com"]);
  assert.deepEqual(channelsFromMatterContext(md), chan.channels);

  assert.deepEqual(meaningAnglesFromMatterContext(md),
    ["novapulse cultural appropriation", "novapulse slang meaning"],
    "the meaning sweep appends these VERBATIM; a parse miss reverts it to the fixed floor with no error");

  assert.deepEqual(parseIntakeAsks(md), [{ ask: "Check descriptiveness in the US.", owner: "synthesis" }]);

  // S2 scans the text for seed neutrality. It must have real text to scan — a render that dropped the
  // prose body would leave the tripwire looking at machine lines and finding nothing, which reads clean.
  assert.doesNotThrow(() => findSeedNeutralityViolations([{ name: "matter-context", text: md }]));
  assert.ok(md.includes("Watchlist-owner seeds: BigCo Interactive, Northwind Games."),
    "the seed line the S2 scan is about must survive the render verbatim");

  // Every instructed value must appear, because that is what the scope bind has always meant — and the
  // driver now stamps them rather than asking the seat to retype them.
  for (const v of ["PROJECT NOVAPULSE", "9", "41", "EU", "US", "downloadable game software"])
    assert.ok(md.replace(/\s+/g, " ").includes(v), `the stamped scope must carry ${v}`);
});

test("conversion 2 — an asserted `none` is a different fact from an unanswered frame", () => {
  const md = accepted({ meaning_angles: [], meaning_angles_none: true }).content;
  assert.deepEqual(meaningAnglesFromMatterContext(md), [],
    "an asserted none parses as no angles — the coined-mark case, and a valid one");
  assert.match(md, /^Meaning angles: none$/m,
    "and it renders the explicit form the dictation used, so an archived reader sees the same sentence");

  // The refusals that make the assertion mean something. Neither of these could be expressed before: the
  // dictation could only catch a MISSING line, after the file was already on disk.
  const neither = acceptMatterFrame({ ...PARAMS, meaning_angles: [], meaning_angles_none: false }, { instructedScope: SCOPE });
  assert.equal(neither.ok, false);
  assert.match(neither.reason, /^matterframe_meaning_angles_missing/);
  const both = acceptMatterFrame({ ...PARAMS, meaning_angles_none: true }, { instructedScope: SCOPE });
  assert.equal(both.ok, false);
  assert.match(both.reason, /^matterframe_meaning_angles_contradictory/);
});

test("conversion 2 — an empty channel list is `all-rejected`, not `no-line`", () => {
  // The line is rendered even when the array is empty, ON PURPOSE. channelsDiagnosis distinguishes four
  // states and two of them are "the seat answered with nothing" versus "the seat never answered".
  // Omitting the line would report the second on a frame that did the first.
  const md = accepted({ search_channels: [] }).content;
  assert.equal(channelsDiagnosis(md).state, "all-rejected");
  assert.notEqual(channelsDiagnosis(md).state, "no-line");
});

test("conversion 2 — no intake asks renders the dictated `none stated`, and parses as an empty list", () => {
  const md = accepted({ intake_asks: [] }).content;
  assert.deepEqual(parseIntakeAsks(md), [],
    "an EMPTY list is the answer 'the requester asked for nothing in particular' — and it must not read as "
    + "the section being absent, which is what triggers the followup re-dispatch");
  assert.notEqual(parseIntakeAsks(md), null);
});

// ── THE REFUSALS ────────────────────────────────────────────────────────────────────────────────────

test("conversion 2 — the transport refuses what the dictation could only catch afterwards", () => {
  const bad = (over, token) => {
    const v = acceptMatterFrame({ ...PARAMS, ...over }, { instructedScope: SCOPE });
    assert.equal(v.ok, false, `expected a refusal for ${token}`);
    assert.match(v.reason, new RegExp(`^${token}`));
  };
  bad({ prose_body: "" }, "matterframe_prose_missing");
  bad({ prose_body: "too short" }, "matterframe_prose_too_short");
  bad({ scope_basis: "guessed" }, "matterframe_scope_basis_invalid");
  bad({ intake_asks: [{ ask: "x", owner: "marketing" }] }, "matterframe_intake_ask_owner_invalid");
  bad({ intake_asks: [{ ask: "", owner: "register" }] }, "matterframe_intake_ask_empty");
  // A quote inside an ask would close the rendered `- ask: "…"` early and parseIntakeAsks would read a
  // TRUNCATED ask. Refused rather than escaped: the requester's words are evidence.
  bad({ intake_asks: [{ ask: 'check the "house mark" angle', owner: "synthesis" }] }, "matterframe_intake_ask_quote");
});

test("conversion 2 — the doctrine's own vocabularies, not a tidier one", () => {
  // `worldwide` is a live value elsewhere in the driver (register-plan stamps it, scope-facts reads it to
  // decide the "registers: worldwide" coverage tail). A two-value enum would have made it unsendable.
  assert.deepEqual([...SCOPE_BASES], ["instructed", "worldwide", "inferred"]);
  assert.deepEqual([...INTAKE_ASK_OWNERS], ["common-law", "register", "synthesis"]);
  for (const basis of SCOPE_BASES) assert.equal(acceptMatterFrame({ ...PARAMS, scope_basis: basis }, { instructedScope: SCOPE }).ok, true);
});

// ── THE TRANSPORT, END TO END ───────────────────────────────────────────────────────────────────────

test("conversion 2 — the driver writes the frame and the capture proves the transport was taken", () => {
  const dir = runDir();
  assert.equal(matterFrameWasRecorded(dir), false, "no call yet — and that is the discriminator's zero");

  const r = recordMatterFrame(dir, PARAMS);
  assert.equal(r.refused, null, `unexpected refusal: ${r.refused}`);
  assert.equal(r.written, join(dir, MATTER_CONTEXT_FILE));
  assert.equal(r.instructed_scope_stamped, true, "the driver had an intake record and must have used it");
  assert.equal(matterFrameWasRecorded(dir), true);

  const md = readFileSync(join(dir, MATTER_CONTEXT_FILE), "utf8");
  assert.deepEqual(channelsFromMatterContext(md), PARAMS.search_channels, "the FILE, not just the render");
  assert.equal(validators.matterContext(join(dir, MATTER_CONTEXT_FILE), md).ok, true);
});

test("conversion 2 — a REFUSED call still leaves the capture, and writes no frame", () => {
  const dir = runDir();
  const r = recordMatterFrame(dir, { ...PARAMS, prose_body: "" });
  assert.match(String(r.refused), /^matterframe_prose_missing/);
  assert.equal(r.written, null, "a refused frame must not reach disk");
  assert.equal(matterFrameWasRecorded(dir), true,
    "the capture exists even for a refusal — that is WHY it is the discriminator: it answers 'was the "
    + "typed transport taken', not 'did the frame come out well'");
  const capture = JSON.parse(readFileSync(matterFrameCallPaths(dir).payload, "utf8"));
  assert.equal(capture.params.prose_body, "", "the capture records what ARRIVED, untidied");
});

// ── THE TWO GUARD RULINGS (owner, 2026-08-17): stated per token, and pinned ─────────────────────────

test("conversion 2 — `frame_scope_missing` is RE-POINTED at the stamp, and can still fail", () => {
  const dir = runDir();
  recordMatterFrame(dir, PARAMS);
  const at = join(dir, MATTER_CONTEXT_FILE);

  assert.equal(validators.matterContext(at, readFileSync(at, "utf8")).ok, true);

  // THE FAILURE IT NOW NAMES, and it is a DRIVER fault rather than a seat one: the intake record is on
  // disk and the render carries no stamp. Before the conversion this token caught a seat paraphrasing the
  // scope; that defect is gone because the seat no longer types it. This one is reachable and was not.
  const unstamped = readFileSync(at, "utf8").replace(/^## Instructed scope$/m, "## Scope (unstamped)");
  const v = validators.matterContext(at, unstamped);
  assert.equal(v.ok, false, "a recorded frame with no stamped section must fail — the guard is not decorative");
  assert.match(v.reason, /^frame_scope_missing:stamp/);
});

test("conversion 2 — `meaning_angles_missing` stays live for a DICTATED frame, and is unreachable for a recorded one", () => {
  // An archived, hand-written frame: no call capture in the run dir. The old rules apply to it in full —
  // this is trap 6, a new way in and never a replacement.
  const dir = mkdtempSync(join(tmpdir(), "ct-matterframe-archive-"));
  mkdirSync(driverDir(dir), { recursive: true });
  writeFileSync(driverDir(dir, "stage-contracts.json"), JSON.stringify({ "matter-frame": { meaningAngles: 1 } }));
  const at = join(dir, MATTER_CONTEXT_FILE);
  const legacy = "# Matter context\n\nClient: ACME. Sector: gaming. Jurisdictions: EU.\n"
    + "material sector client jurisdic\n".repeat(8);
  writeFileSync(at, legacy);
  assert.equal(matterFrameWasRecorded(dir), false, "the fixture must be on the DICTATED path or it proves nothing");
  const v = validators.matterContext(at, legacy);
  assert.equal(v.ok, false);
  assert.equal(v.reason, "meaning_angles_missing",
    "an archived frame minted under the meaning-angles prompt is still held to it");

  // And the recorded path cannot produce that state at all: the transport refuses the call, so no frame
  // exists to validate. The guard is not left standing green over the new path — it is unreachable there.
  const fresh = runDir();
  const refused = recordMatterFrame(fresh, { ...PARAMS, meaning_angles: [], meaning_angles_none: false });
  assert.match(String(refused.refused), /^matterframe_meaning_angles_missing/);
  assert.equal(refused.written, null);
});

test("conversion 2 — with no intake record the stamp says `none given` rather than inventing one", () => {
  const dir = mkdtempSync(join(tmpdir(), "ct-matterframe-noscope-"));
  mkdirSync(driverDir(dir), { recursive: true });
  const r = recordMatterFrame(dir, PARAMS);
  assert.equal(r.refused, null, "a legacy/replay run with no receipt must still be able to record a frame");
  assert.equal(r.instructed_scope_stamped, false, "and it must SAY the stamp did not happen");
  assert.match(readFileSync(join(dir, MATTER_CONTEXT_FILE), "utf8"), /- \*\*Mark\(s\):\*\* none given/);
});

test("conversion 2 — the render is a projection of the model, and the prose body is untouched", () => {
  const v = accepted();
  assert.equal(renderMatterFrame(v.model), v.content, "content must be the render of the parsed model");
  assert.ok(v.content.includes(PROSE),
    "the seat's judgment prose rides VERBATIM — reflowing text that S2 scans and twelve seats read would "
    + "be the driver editing legal reasoning to fit a renderer");
});
