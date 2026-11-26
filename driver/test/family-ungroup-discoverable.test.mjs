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
// claim would force the record to be deleted along with the defect (the lesson, same file).
const live = (rel) => src(rel).split("\n").filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*") && !l.trim().startsWith("/*")).join("\n");

test("arm 1 — the family header offers Ungroup, where the family visibly is", () => {
  const t = live("portal-ui/src/screens/Clearances.tsx");
  assert.match(t, /onUngroup\?\s*:/, "the header row takes an ungroup handler");
  assert.match(t, /onUngroup\(family\)/, "…and calls it with the family the row is about");
  assert.match(t, />\s*Ungroup family…\s*</, "…under a label a user can find without guessing");
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
  // …and there is no multi-select bar for it to hide in: grouping is a dialog now (board Clearances,
  // approved 2026-11-25), and the family's own menu is where a family is undone.
  assert.ok(!/className="selection-bar"/.test(t), "the multi-select bar is back — that is the surface nobody could find");
});

test("arm 2 — it calls the SAME audited capability, over every run in the family", () => {
  const t = live("portal-ui/src/screens/Clearances.tsx");
  assert.match(t, /api\.setFamily\(\{ action: 'ungroup', runIds \}\)/,
    "one capability, one audit trail — a second path to the same effect is a second thing to keep honest");
  // A family is asserted over RUNS, not marks: dissolving one must file every read of every name.
  assert.match(t, /family\.marks\.flatMap\(\(m\) => m\.reads\.map\(\(r\) => r\.runId\)\)/,
    "ungrouping by mark id would leave the other reads of that name still in the family");
});

test("arm 3 — one click cannot dissolve a grouping somebody made deliberately", () => {
  const t = live("portal-ui/src/screens/Clearances.tsx");
  const at = t.indexOf("const ungroupFamily");
  assert.ok(at > 0, "the handler exists");
  const body = t.slice(at, at + 900);
  // It asks in the product's own dialog (board Clearances, approved 2026-11-25), naming where the names go.
  assert.match(body, /setAsk\(\{/,
    "from the family's menu it is one press, so it asks");
  assert.match(body, /and their searches will appear directly under/,
    "and the question says what is NOT lost — the names and their searches stay, which is the thing a user fears");
});

test("arm 4 — a name leaves its family on its own, and asks first", () => {
  const t = live("portal-ui/src/screens/Clearances.tsx");
  // THE PRINCIPLE STANDS: a control that cannot act is not on screen. "Remove from family…" is offered only
  // on a name that sits in a family (board Clearances, approved 2026-11-25).
  assert.match(t, /\{onRemoveFromFamily && familyName \? <MenuItem/, "the per-name route shows only where it can act");
  assert.match(t, />\s*Remove from family…\s*</, "…and the per-name route is still there");
});

test("arm 5 — the SERVED BUNDLE carries it; portal-ui/dist is what the browser gets", (ctx) => {
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
  assert.ok(anyHas("and their searches will appear directly under"), "the served bundle does not carry the question — dist was not rebuilt");
  assert.ok(anyHas("Ungroup family"), "…nor the control itself");
});
