// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// screen-gate-timeline.test.mjs —: the lawyer-facing timeline stops reporting a driver defect as a pass.
//
// `screen-gate-clean` has THREE writers and FIVE zero-causes, and this projection rendered all of them as
// the single word `screen-gate-passed`. Two of the causes — `findings-absent` and `findings-empty` — are the
// gate reading nothing at all, which screen-gate.mjs calls a driver defect "wearing a clean run's clothes".
// On a lawyer's timeline they were indistinguishable from a genuinely clean gate.
//
// THE CLIENT STRING IS OWNER-APPROVED AND PINNED BY ITS BYTES. The ruling (2026-08-18) gives the wording
// verbatim, so this file compares the whole string rather than matching a substring: a paraphrase, a
// re-punctuation, or an en dash swapped for the em dash must fail HERE rather than reach a client.
//
// The events are synthetic on purpose. Driving this through a fixture run would mean a fixture that
// happens to carry one cause; the point is the mapping across ALL five, including the two that no fixture
// produces because they are defects.

import { test, before } from "node:test";
import assert from "node:assert/strict";

let events;
before(async () => { events = await import("../lib/events.mjs"); });

const project = (e) => {
  const { timeline } = events.projectTimeline([{ ts: "2026-08-18T00:00:00Z", event: "start" }, { ts: "2026-08-18T00:00:01Z", ...e }], {});
  const row = timeline.find((t) => t.kind === "screen-gate-clean");
  assert.ok(row, "the screen-gate row vanished from the timeline entirely");
  return row;
};

test("#1228 the owner's client-visible wording is carried VERBATIM, to the byte", () => {
  assert.equal(events.CLIENT_INCOMPLETE, "Screening: incomplete — flagged for review");
  // The dash is EM DASH (U+2014). Asserted by codepoint because an en dash and a hyphen are visually
  // near-identical in a diff and this text reaches a client.
  assert.equal([...events.CLIENT_INCOMPLETE].find((c) => c.codePointAt(0) > 0x2000).codePointAt(0), 0x2014,
    "the dash in the client string is no longer an em dash — this wording is owner-approved verbatim");
});

test("#1228 a gate that COULD NOT INSPECT is not reported as a pass", () => {
  for (const cause of ["findings-absent", "findings-empty"]) {
    const row = project({ event: "screen-gate-clean", cause });
    assert.equal(row.decision, "screen-gate-incomplete", `${cause} still renders as a pass`);
    assert.equal(row.display, "Screening: incomplete — flagged for review",
      `${cause} does not carry the owner's client wording`);
    assert.equal(row.cause, cause, "the cause is dropped, so the reader cannot tell which defect this was");
  }
});

test("#1228 a gate that genuinely ran and found nothing keeps clear wording", () => {
  for (const cause of ["no-drop-rows", "all-fetched"]) {
    const row = project({ event: "screen-gate-clean", cause });
    assert.equal(row.decision, "screen-gate-passed", `${cause} is a genuinely clean gate and must read as one`);
    assert.equal(row.display, undefined, "clear rows must not carry the incomplete wording");
    assert.equal(row.cause, cause);
  }
});

test("#1228 the DEFAULT mode reads clear but says WHICH clear — it inspected, and it did not count", () => {
  // `unnamed-drops-unarmed` is the commonest path: the digest dropped rows on goods, every one names no
  // record, and this configuration does not count them. The gate DID inspect, so by the ruling's own
  // trigger it is not the "could not inspect anything" state. But screen-gate.mjs warns that folding it
  // in with `no-drop-rows` "would put a false label on the commonest path — the reader would be told the
  // digest dropped nothing on goods when it dropped and nobody counted". Carrying the cause is what
  // keeps both true: the row is clear, and it is no longer collapsed into a word that hides which clear.
  const row = project({ event: "screen-gate-clean", cause: "unnamed-drops-unarmed" });
  assert.equal(row.decision, "screen-gate-passed");
  assert.equal(row.cause, "unnamed-drops-unarmed",
    "the default path is back to being indistinguishable from 'nothing was dropped'");
});

test("#1228 a HEALED gate is distinguishable from one that never had a violation", () => {
  // pipeline.mjs's two `recovered: true` writers: violations existed and a repair healed them. Neither
  // carries a cause. They are not defects and not virgin-clean, and the timeline said the same word for
  // both.
  const healed = project({ event: "screen-gate-clean", recovered: true, pass: 2 });
  assert.equal(healed.decision, "screen-gate-passed");
  assert.equal(healed.recovered, true, "a healed gate is indistinguishable from one that never had a gap");
  assert.equal(healed.cause, null);

  const virgin = project({ event: "screen-gate-clean", cause: "no-drop-rows" });
  assert.equal(virgin.recovered, false);
});

test("#1228 a pre-#1215 event carries no cause and is NOT retro-labelled incomplete", () => {
  // Runs recorded before the cause field existed must not be re-reported as defects on the strength of a
  // field their engine never wrote. Absence of evidence is not the incomplete state.
  const row = project({ event: "screen-gate-clean" });
  assert.equal(row.decision, "screen-gate-passed", "an old run was retro-labelled from a missing field");
  assert.equal(row.cause, null);
  assert.equal(row.display, undefined);
});
