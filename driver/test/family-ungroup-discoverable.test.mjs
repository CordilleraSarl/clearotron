// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — THE CAPABILITY WAS COMPLETE AND THE OWNER ASKED WHETHER IT EXISTED.
//
// Ungroup is wired end to end: `api.setFamily({action:'ungroup'})` → `/portal/admin/families` →
// `ungroupRuns`, audited as `family-ungroup`. Nothing was missing. But the only control rendered
// CONDITIONALLY, in the multi-select bar, and only once you had ticked a run that was already in a
// family — with the reasoning in a comment beside it:
//
//     Only offered when something ticked is actually IN a family. Enforcement without matching
//     invitation control is how a dead button ends up on screen.
//
// The principle is right and the consequence was that "Remove from family" did not exist until you had
// guessed the move that reveals it. "Group as a family" is always visible, so the screen read as a
// one-way operation: you can make families and apparently not unmake them.
//
// THE FIX IS THE INVITATION, NOT THE ENFORCEMENT. The multi-select button is unchanged — that one still
// appears only when the selection can act, and it remains the way to take ONE name out. What is added is
// an Ungroup on the family header row, which is where a person looking to break up a family looks.
//
// BREAK MATRIX:
//   · the control is on the family header          → break: delete it, arm 1 goes red
//   · it calls the SAME audited capability         → break: point it elsewhere, arm 2 goes red
//   · it confirms before dissolving                → break: drop the confirm, arm 3 goes red
//   · the enforcement is untouched                 → break: make the old button unconditional, arm 4
//   · the SERVED BUNDLE carries it                 → break: skip the rebuild, arm 5 goes red
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const src = (rel) => readFileSync(join(HERE, "..", "..", rel), "utf8");
// Comment lines are stripped where a claim is being asserted: this change's own comments quote the
// problem so the next reader knows what was wrong, and a test that could not tell a quotation from a
// claim would force the record to be deleted along with the defect ('s lesson, same file).
const live = (rel) => src(rel).split("\n").filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*") && !l.trim().startsWith("/*")).join("\n");

test("#612 arm 1 — the family header offers Ungroup, where the family visibly is", () => {
  const t = live("portal-ui/src/screens/Clearances.tsx");
  assert.match(t, /onUngroup\?\s*:/, "the header row takes an ungroup handler");
  assert.match(t, /onUngroup\(family\)/, "…and calls it with the family the row is about");
  assert.match(t, />\s*Ungroup\s*</, "…under a label a user can find without guessing");
  // It hangs off the FamilyRows header, not the multi-select bar: the point is that it is visible
  // BEFORE anything is ticked.
  // Anchored on the FamilyRows body, not on `{family.name}` — that string also appears in the grouping
  // prompt 19,000 characters earlier, and an anchor that matches the wrong occurrence measures nothing.
  const headerAt = t.indexOf("const open = isOpen(family.id)");
  const controlAt = t.indexOf("onUngroup(family)");
  assert.ok(headerAt > 0, "premise: the FamilyRows component is where the header row is built");
  // STRUCTURAL, not a character distance: the control must be inside FamilyRows and BEFORE the member
  // rows render — i.e. on the header row itself, which is the whole point.
  const membersAt = t.indexOf("family.marks.map(");
  assert.ok(membersAt > headerAt, "premise: the member rows render after the header");
  assert.ok(controlAt > headerAt && controlAt < membersAt,
    `the control must sit on the family HEADER row (component at ${headerAt}, control at ${controlAt}, members at ${membersAt})`);
  // …and it is NOT inside the picking bar, which is the thing that made it undiscoverable.
  const pickBarAt = t.indexOf("Group as a family");
  assert.ok(controlAt > pickBarAt + 2000 || controlAt < pickBarAt,
    "the new control is in the multi-select bar again — that is the surface nobody could find");
});

test("#612 arm 2 — it calls the SAME audited capability, over every run in the family", () => {
  const t = live("portal-ui/src/screens/Clearances.tsx");
  assert.match(t, /api\.setFamily\(\{ action: 'ungroup', runIds \}\)/,
    "one capability, one audit trail — a second path to the same effect is a second thing to keep honest");
  // A family is asserted over RUNS, not marks: dissolving one must file every read of every name.
  assert.match(t, /family\.marks\.flatMap\(\(m\) => m\.reads\.map\(\(r\) => r\.runId\)\)/,
    "ungrouping by mark id would leave the other reads of that name still in the family");
});

test("#612 arm 3 — one click cannot dissolve a grouping somebody made deliberately", () => {
  const t = live("portal-ui/src/screens/Clearances.tsx");
  const at = t.indexOf("const ungroupFamily");
  assert.ok(at > 0, "the handler exists");
  const body = t.slice(at, at + 900);
  assert.match(body, /window\.confirm\(/,
    "the multi-select route makes you tick the members first; from the header it is one click, so it asks");
  assert.match(body, /only the family goes/,
    "and the confirm says what is NOT lost — the names stay, which is the thing a user fears");
});

test("#612 arm 4 — the enforcement is untouched: the old button still gates on the selection", () => {
  const t = live("portal-ui/src/screens/Clearances.tsx");
  assert.match(t, /\[\.\.\.picked\]\.some\(\(id\) =>[\s\S]{0,200}?\?\.familyId\) \?/,
    "THE PRINCIPLE STANDS: a control that cannot act is still not on screen. #612 added an invitation, "
    + "it did not delete the guard");
  assert.match(t, />\s*Remove from family\s*</, "…and the per-name route is still there");
});

test("#612 arm 5 — the SERVED BUNDLE carries it; portal-ui/dist is what the browser gets", (ctx) => {
  // The source is not the surface. `portal-ui/dist` is committed on purpose and portal-static serves it
  // verbatim, so a source-only fix leaves the user on the old screen while every other test passes.
  const dir = join(HERE, "..", "..", "portal-ui", "dist", "assets");
  // BUILD OUTPUT, NOT SOURCE. `portal-ui/dist` is withheld from the public cut, so this arm has
  // nothing to read there. A STATED skip, never a silent pass: the defect it guards — a source-only
  // fix leaving the served bundle stale — cannot exist in a tree that commits no bundle, and in a
  // tree that does, this still runs.
  if (!existsSync(dir)) return ctx.skip("portal-ui/dist is build output and absent here — `npm run build:ui` to run this arm");

  const bundles = readdirSync(dir).filter((f) => f.endsWith(".js"));
  assert.ok(bundles.length, "there is a built bundle at all");
  const anyHas = (needle) => bundles.some((b) => readFileSync(join(dir, b), "utf8").includes(needle));
  assert.ok(anyHas("only the family goes"), "the served bundle does not carry the confirm — dist was not rebuilt");
  assert.ok(anyHas("Ungroup"), "…nor the control itself");
});
