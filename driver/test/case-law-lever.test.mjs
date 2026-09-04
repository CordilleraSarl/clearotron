// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// F4 — the "Case law" composer lever, wired. Before this, the stage fired only on a regex over the draft
// narrative, so the toggle sold a feature the client might not receive.
//
// (2026-08-08) REPLACED THE ADDITIVE RULE WITH A PRODUCT GATE, and the arms below are rewritten to
// match rather than deleted, because the old ones assert the exact behaviour that was removed.
//
// The lever used to be additive — it could add the stage and never suppress one the narrative called for
// — and that made the DETECTOR an unguarded second entry point. It fires mid-run, after admission, so a
// Multi-country focus search over seven territories ran a case-law pass and wrote 10 KB of findings: a
// component of a product the client did not order, unbilled, with no door and no scope guard. #92's
// one-territory rule reaches the requested path and could never reach that one.
//
// The offering gives the reading to the Full country search alone. So the detector still DETECTS and no
// longer EXECUTES: `run` is product-gated, `detected` stays truthful, and `declined` names the state
// nobody could previously see. What the detector notices is kept as `_driver/` run data; no report or
// email sentence is built from it here, because no wording enters a deliverable the owner has not agreed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { decideCaseLaw } from "../pipeline.mjs";
import { validateJob } from "../enqueue-schema.mjs";

const NEUTRAL = "The mark is distinctive in class 9 and the field is uncrowded. No blocking rights found.";
const REASONED = "The lead conflict is a famous mark whose owner has an active opposition history.";
// The one product that carries the reading, and one that does not. `caseLaw` on the policy is set FROM
// the product spec (search-policy.mjs), so these two shapes are what the pipeline actually hands in.
const FULL = { product: "full-country-search", caseLaw: true };
const FOCUS = { product: "multi-country-focus-search", caseLaw: false };

test("decideCaseLaw: on the product that carries it, the reading runs whatever the narrative says", () => {
  const d = decideCaseLaw({ job: {}, policy: FULL, narrative: NEUTRAL });
  assert.equal(d.run, true);
  assert.equal(d.requested, true, "the policy carries it because the PRODUCT does");
  assert.equal(d.detected, false, "nothing in this narrative would have triggered it");
  assert.equal(d.declined, false);
});

test("#519 detection on a product that does not carry the reading RECORDS and does not RUN", () => {
  // The defect, exactly: a Multi-country focus search whose draft narrative turns on an opposition.
  const d = decideCaseLaw({ job: {}, policy: FOCUS, narrative: REASONED });
  assert.equal(d.run, false, "this is the pass that ran on seven territories and passed no door");
  assert.equal(d.detected, true, "the observation is KEPT — the run's own reading noticed something real");
  assert.equal(d.declined, true, "and the state has a name, so a round can see it");
  assert.equal(d.eligible, false);
  assert.equal(d.product, "multi-country-focus-search");
  // The FIRST trigger in the text, not an arbitrary one: this narrative carries "famous mark" before
  // "opposition", and a reader chasing the observation needs the word the match actually turned on.
  assert.equal(d.trigger, "famous mark", "which word triggered it is recorded, or the observation is unusable");
});

test("#519 the trigger word is reported as matched, for every documented trigger", () => {
  for (const w of ["watchlist", "precedent", "case law", "case-law", "opposition", "famous mark"]) {
    const d = decideCaseLaw({ job: {}, policy: FOCUS, narrative: `The read turns on a ${w} here.` });
    assert.equal(d.detected, true, w);
    assert.equal(d.trigger, w.toLowerCase(), `the row must name ${w}, not merely that something matched`);
  }
});

test("decideCaseLaw: neither requested nor detected means nothing runs and nothing is declined", () => {
  const d = decideCaseLaw({ job: {}, policy: FOCUS, narrative: NEUTRAL });
  assert.equal(d.run, false);
  assert.equal(d.detected, false);
  assert.equal(d.declined, false, "declined means the reading was CALLED FOR and refused — not that it was silent");
});

test("#519 an unresolvable product is NOT eligible, and the row says which state it is in", () => {
  // Declining is the safe direction — the alternative is starting an unbounded pass on a product nobody
  // established — but it must be legible, or it is an absence read as a decision. REWRITTEN: the old arm
  // asserted `decideCaseLaw({job:{caseLaw:true}}).run === true`, the ungated behaviour that was removed.
  const d = decideCaseLaw({ job: { caseLaw: true }, narrative: REASONED });
  assert.equal(d.run, false);
  assert.equal(d.product, null, "the row says the product could not be read, rather than naming a wrong one");
  assert.equal(d.declined, true);
  assert.equal(decideCaseLaw({}).run, false);
  assert.equal(decideCaseLaw().run, false);
});

test("decideCaseLaw: only a true boolean requests — garbled values are not a request", () => {
  for (const v of ["true", 1, {}, [], "yes", null]) {
    const d = decideCaseLaw({ job: { caseLaw: v }, policy: FOCUS, narrative: NEUTRAL });
    assert.equal(d.run, false, `${JSON.stringify(v)} must not be read as a request`);
  }
});

test("decideCaseLaw: detection matches each documented trigger word", () => {
  for (const w of ["watchlist", "precedent", "case law", "case-law", "opposition", "famous mark"])
    assert.equal(decideCaseLaw({ job: {}, policy: FULL, narrative: `The read turns on a ${w} here.` }).detected, true, w);
});

// A saved search asks too. The frozen policy carries the recipe's own lever, so a run named by
// recipeKey — which sends no product and no job.caseLaw — still gets what was saved.
test("decideCaseLaw: the frozen policy's lever requests, exactly as the job's does", () => {
  const d = decideCaseLaw({ job: {}, policy: FULL, narrative: NEUTRAL });
  assert.equal(d.run, true);
  assert.equal(d.requested, true);
});

test("#519 the LEVER cannot buy the reading on a product that does not sell it", () => {
  // REWRITTEN. The old arm asserted that either side asking was enough and neither could veto, because
  // neither could veto at all. The product can, and that is the change: a saved recipe or a resumed job
  // carrying `caseLaw: true` over a Multi-country focus search must not start the pass.
  const d = decideCaseLaw({ job: { caseLaw: true }, policy: FOCUS, narrative: NEUTRAL });
  assert.equal(d.run, false, "an ordered lever over the wrong product buys nothing — the door refuses it too");
  assert.equal(d.requested, true, "the ASK is still recorded truthfully");
  assert.equal(d.declined, true);
});

test("decideCaseLaw: a policy without the lever changes nothing, and only true counts", () => {
  assert.equal(decideCaseLaw({ job: {}, policy: { ...FULL, caseLaw: false }, narrative: NEUTRAL }).run, false);
  assert.equal(decideCaseLaw({ job: {}, policy: { product: "full-country-search" }, narrative: NEUTRAL }).run, false);
  assert.equal(decideCaseLaw({ job: {}, policy: { ...FULL, caseLaw: "true" }, narrative: NEUTRAL }).run, false);
});

test("#519 an archived run's `level` key resolves the product, so a resume is not silently ineligible", () => {
  // search-policy writes `product` and `level` as one value under two keys, and archived runs carry
  // `level`. Read only `product` and every resumed pre-rename Full country run stops grounding its
  // citations — with nothing in the record saying why.
  const d = decideCaseLaw({ job: {}, policy: { level: "full-country-search", caseLaw: true }, narrative: NEUTRAL });
  assert.equal(d.run, true);
  assert.equal(d.product, "full-country-search");
});

// Schema: a non-boolean is a soft warning treated as unset, matching customerUnknown/dupOverride. It must
// never reject — a garbled lever degrades to today's behaviour rather than blocking a paid run.
const BASE = { id: "job-1", msgId: "AAMkFAKE", forwarder: "owner", markName: "NOVASTORM", classes: [9] };

test("validateJob: caseLaw is REFUSED at the door — accepted-and-dropped is the worst available shape", () => {
  // It used to be accepted silently on any value: `true` bought the pass, `false` was recorded and
  // ignored, a garbled value warned and degraded. Under the offering it is not a setting at all — the
  // Full country search IS the case-law reading — so every one of those states is a requester believing
  // they bought (or switched off) something nobody sold them.
  for (const v of [true, false, "yes"]) {
    const r = validateJob({ ...BASE, caseLaw: v });
    assert.equal(r.ok, false, `caseLaw: ${JSON.stringify(v)} must be refused, not absorbed`);
    assert.equal(r.classify, "clarify");
    assert.match(r.errors.join(" "), /caseLaw is not a request setting/);
    assert.match(r.errors.join(" "), /"full-country-search"/, "and the refusal names the product to order instead");
  }
});

test("validateJob: an absent caseLaw says nothing at all", () => {
  const r = validateJob(BASE);
  assert.equal(r.warnings.some((w) => /caseLaw/.test(w)), false);
});
