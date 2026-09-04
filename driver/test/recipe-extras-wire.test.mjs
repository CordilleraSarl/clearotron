// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// A saved search's extras have to CHANGE something.
//
// `emailTable` and `standingInstructions` were accepted at save, validated, advertised by the recipe
// service, and frozen into every run's `_driver/search-policy.json` — and then read by nothing. A staff
// member could tick "results table in the email", write standing instructions, watch both save cleanly,
// and get a run identical to one where they had set neither. That is worse than an unbuilt feature,
// because the interface confirms it worked.
//
// So these tests are about ARRIVAL, not about validation: the sibling file (recipe-scope-fold.test.mjs)
// proves the scope reaches the run, and this one proves the extras do.

import { test } from "node:test";
import assert from "node:assert/strict";
import { STAGES } from "../stages.mjs";
import { validateRecipe, RECIPE_EXTRA_KEYS } from "../search-policy.mjs";
import { NEUTRAL_DELIVERY, deliveryForRun } from "../profiles.mjs";

// ── emailTable → the delivery shape the email is composed from ───────────────────────────────────────

const ctxWith = (extras, delivery) => ({ profile: delivery ? { delivery } : {}, searchPolicy: { extras } });

// 2026-07-28 — emailTable is now INERT. The results-table email it switched on is deleted: every run's
// mail is a cover note pointing at the one report, and bespoke client-facing mail is drafted by the
// assistant from the run's data rather than re-authored by a config knob. These tests therefore invert.
// The extra is still ACCEPTED (saved searches written while it worked must keep loading) and still
// frozen into the sidecar — it simply decides nothing, and the compose form no longer offers it.

test("emailTable no longer changes the delivery shape — the results-table email is gone", () => {
  assert.equal(deliveryForRun(ctxWith({ emailTable: true })).email, "summary");
  assert.equal(deliveryForRun(ctxWith({ emailTable: true }, { email: "summary", privileged: true })).email, "summary");
});

test("a profile still NAMING the retired word gets the cover note, and still loads", () => {
  // Live profiles in the config repo carry `email: "table"`. They must not brick, and they must not
  // get a table: the fold happens once, at the single point every caller reads the delivery shape.
  const out = deliveryForRun(ctxWith({}, { email: "table", privileged: true, style: "plain" }));
  assert.equal(out.email, "summary", "the retired word reads as the cover note");
  // — `privileged: true` is ALSO retired now, and folds the same way for the same reason: with
  // "· Attorney Work Product" dropped it selects nothing. A live profile carrying it must not brick.
  assert.equal(out.privileged, undefined, "the retired true folds away rather than surviving as a value that decides nothing");
  assert.equal(out.style, "plain", "the rest of the customer's delivery shape is untouched");
});

test("the extra is still accepted and validated, so a saved search written earlier keeps loading", () => {
  assert.ok(RECIPE_EXTRA_KEYS.includes("emailTable"), "still a known extra — removing it would fail stored recipes at load");
  const r = validateRecipe("acme", "quarterly", { label: "Quarterly", base: "knockout-search", extras: { emailTable: true } });
  assert.ok(r.ok, `a stored recipe carrying it still validates (${(r.errors ?? []).join("; ")})`);
});

test("nothing OFFERS it any more — the compose form's checkbox is gone", async () => {
  // Enforcement needs matching invitation control: a knob that no longer does anything must also stop
  // being presented, or the interface keeps promising a delivery shape the product will not honour.
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../dev-portal.mjs", import.meta.url), "utf8");
  assert.ok(!/emailTable/.test(src), "the saved-search compose form no longer advertises the results table");
});

test("no profile and no recipe is the neutral shape, not a crash", () => {
  assert.deepEqual(deliveryForRun({}), NEUTRAL_DELIVERY);
  assert.deepEqual(deliveryForRun(undefined), NEUTRAL_DELIVERY);
  assert.deepEqual(deliveryForRun({ profile: null, searchPolicy: null }), NEUTRAL_DELIVERY);
});

test("it never mutates the profile it read from — a run must not rewrite the customer's stored preference", () => {
  const delivery = { email: "summary", privileged: false };
  const ctx = ctxWith({ emailTable: true }, delivery);
  deliveryForRun(ctx);
  assert.equal(delivery.email, "summary", "the profile object is untouched");
});

// ── standingInstructions → the report-overview prompt ─────────────────────────────────────────────────

const overviewPrompt = (searchPolicy, profile = {}) =>
  STAGES["report-overview"].message({
    paths: { report: "r.md", findings: "f.json", narrative: "n.md", caseLaw: "c.md" },
    job: {}, customerUnknown: false, profile, intakeAsks: [], displayVerdict: null,
    registerOnly: false, searchPolicy,
  });

test("STANDING INSTRUCTIONS REACH THE STAGE THAT WRITES THE REPORT SHELL", () => {
  const text = "Always call out the Benelux position when one exists.";
  const out = overviewPrompt({ extras: { standingInstructions: text } });
  assert.ok(out.includes(text), "the instruction is in the prompt");
});

test("they carry the same D1 contract as the customer context pack — emphasis, never a band", () => {
  // This is free customer text entering the engine's reasoning, which is precisely the surface the profile
  // key-set walls off. It rides with the contract attached, in the same words the context pack uses.
  const out = overviewPrompt({ extras: { standingInstructions: "Lead with anything in class 9." } });
  assert.match(out, /SAVED-SEARCH STANDING INSTRUCTIONS[^]{0,400}NEVER changes a band/);
});

test("a run with no saved search, or a saved search with no instructions, adds nothing", () => {
  for (const sp of [undefined, null, {}, { extras: null }, { extras: {} }, { extras: { emailTable: true } }])
    assert.ok(!overviewPrompt(sp).includes("SAVED-SEARCH STANDING INSTRUCTIONS"), `${JSON.stringify(sp)} added no block`);
});

test("THEY RIDE THE SHELL, NOT THE RATING STAGE — the boundary the context pack observes", () => {
  // report-overview shapes emphasis and ordering. synthesis sets the bands. Feeding customer prose into
  // the rating stage is the thing the whole key-set discipline exists to prevent, so if a later change
  // moves this block, this is the test that should stop it.
  const text = "Treat lookalikes in class 25 as the headline.";
  const sp = { extras: { standingInstructions: text } };
  // Asserted, not guarded with an `if`. A conditional here would keep passing after somebody renamed the
  // rating stage, which is exactly when this check stops being true and most needs to fail.
  const synth = STAGES["synthesis"];
  assert.equal(typeof synth?.message, "function", "the rating stage is still called 'synthesis' — if this fails, re-point the check, do not delete it");
  const out = synth.message({
    paths: { report: "r.md", findings: "f.json", narrative: "n.md", caseLaw: "c.md", audit: "a.md", grid: "g.md" },
    job: {}, customerUnknown: false, profile: {}, intakeAsks: [], framework: null, searchPolicy: sp,
    registerOnly: false, enforcerSignals: null, jxAim: null, crowdContext: null,
  });
  assert.ok(!out.includes(text), "the rating stage never sees it");
});

// ── the retired one ──────────────────────────────────────────────────────────────────────────────────

test("defaultDeadlineDays is GONE, and refuses by name so the reason is readable at the point of failure", () => {
  // Ruled out 2026-07-27: a deadline is temporal and belongs to the request, not to a template that
  // outlives it. A saved search silently re-dating every future run from a number set months ago is worse
  // than typing the date.
  assert.ok(!RECIPE_EXTRA_KEYS.includes("defaultDeadlineDays"));
  const r = validateRecipe("acme", "quick", { label: "X", base: "global-preliminary-search", extras: { defaultDeadlineDays: 5 } });
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /no longer a saved-search setting/);
  assert.match(r.errors[0], /Set the needed-by date on the run instead/, "and it says what to do instead");
});

test("every declared extra is now wired — this list and the consumers cannot drift apart again", () => {
  // The defect this file exists for was a key that validated and did nothing. Adding a key to
  // RECIPE_EXTRA_KEYS without a consumer recreates it exactly, so the roster is asserted rather than
  // trusted: a new extra fails here until someone writes the test that proves it arrives somewhere.
  assert.deepEqual([...RECIPE_EXTRA_KEYS].sort(), ["emailTable", "standingInstructions"]);
});

test("a STORED recipe still carrying the retired extra loads fine — retirement is not an outage", async () => {
  // The two doors are deliberately different. Saving one is refused, because that is somebody asking for
  // a behaviour that no longer exists. LOADING one must not be, because a key that never did anything
  // would otherwise take out every run naming that saved search — a tidy-up becoming an incident on
  // config nobody touched. It is dropped on the way through so it cannot round-trip back into the store.
  const { mkdtempSync, mkdirSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { loadRecipes } = await import("../search-policy.mjs");

  const dir = mkdtempSync(join(tmpdir(), "recipes-retired-"));
  mkdirSync(join(dir, "acme"), { recursive: true });
  writeFileSync(join(dir, "acme", "legacy.json"), JSON.stringify({
    version: 2, label: "Legacy screen", base: "global-preliminary-search",
    extras: { emailTable: true, defaultDeadlineDays: 14 },
  }));

  const recipes = loadRecipes({ dir, force: true });
  const loaded = recipes.get("acme/legacy");
  assert.ok(loaded, "the saved search still loads");
  assert.equal(loaded.extras.emailTable, true, "its live extra is intact");
  assert.ok(!("defaultDeadlineDays" in loaded.extras), "and the retired one is dropped, not carried back into a save");
});

test("the knockout lane takes no delivery preference for its MAIL — there is nothing left to honour", async () => {
  // NARROWED, DELIBERATELY, AND HERE IS WHY. This guard used to forbid `ctx.profile?.delivery`
  // anywhere in pipeline-knockout.mjs. Every word of its reasoning was about the MAIL — the lane read the
  // profile's delivery to pick a table-or-summary email shape, silently ignoring the saved search, and
  // that whole preference was retired when the cover note became the one shape. The assertion was written
  // wider than the rule it defends: it banned reading the OVERLAY, not the mail preference.
  //
  // The overlay carries a second field the retirement never touched, and profiles.mjs says so in its own
  // comment beside NEUTRAL_DELIVERY: "`privileged` still varies by customer". Under that field
  // decides the confidentiality marking on both report templates, and the profile is the only thing
  // permitted to change it — so the lane MUST read it, and the old wording made the clearance's own rule
  // unreachable from the knockout. The guard was wrong, not the change; it is narrowed rather than
  // deleted, and rather than bypassed.
  //
  // WHAT STILL HAS TO STAY TRUE: no mail-shape read creeps back. composeKnockoutEmail takes no delivery
  // argument (publish/knockout.mjs:258) and the lane must not fold one in.
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../pipeline-knockout.mjs", import.meta.url), "utf8");
  assert.ok(!/deliveryForRun/.test(src), "no fold — the lane's mail has exactly one shape");
  assert.ok(!/delivery\??\.email/.test(src), "and no read of the retired email preference");
  assert.ok(!/composeKnockoutEmail\([^)]*delivery/s.test(src), "the cover note is never handed a preference");
  // The one read that IS allowed, pinned so it cannot quietly become something wider: the overlay goes to
  // publishKnockout for the confidentiality posture, and nowhere else.
  assert.match(src, /delivery: ctx\.profile\?\.delivery,/, "the posture overlay reaches publish (#761)");
});
