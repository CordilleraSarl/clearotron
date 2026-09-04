// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — A MARK NAME CANNOT CARRY A CHARACTER THAT CHANGES HOW IT READS.
//
// Intake stored the mark verbatim and nothing on the path normalized it or filtered display controls.
// morty drove seven cases at the CLI door on 9bd4f8b; every one was accepted with rc=0. Three of them
// were defects and, importantly, four were not.
//
// THE THREE:
//   • U+202E survives `esc()` — which escapes & < > " and is not supposed to touch bidi controls — and
//     reaches the report body, reversing the display of everything after it. That report is a legal
//     deliverable sent to a client.
//   • A zero-width joiner makes a name render as AURORA and compare unequal to it, so
//     `selfExclusionOwners` and dedup both miss a mark a human reads as the account's own.
//   • NFD and NFC of one mark are two matters, two searches, two bills.
//
// THE FOUR THAT ARE NOT, and half of this file exists to keep them that way: a Cyrillic homoglyph, an
// emoji, a LONG name and an accented letter. An over-broad filter that refuses SIRÈNE is a worse defect
// than the one being fixed, because it rejects work a client legitimately ordered.
//
// "Long" was "200-character" until, which applies the product's existing
// per-name budget at the intake. The control is the same one — an ordinary long name must not trip the
// DISPLAY-CONTROL filter — and it is now a long name inside the budget, with the over-budget direction
// asserted separately below.
//
// WHY THE GUARD IS IN validateJob AND NOT AT A DOOR: the same argument the id guard above it makes.
// CLI (enqueue.mjs), portal (portal-service.mjs), ops-MCP (ops.mjs), the dev cockpit and the runner's own
// wall at claim all call it, so one rule reaches every door in the same words. A per-door filter is four
// copies and the fourth is the one that gets forgotten.
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateJob, markDisplayControlsIn } from "../enqueue-schema.mjs";
import { deriveSlug, kebab } from "../phase0.mjs";
import { createHash } from "node:crypto";

const job = (name) => ({ id: "j1", forwarder: "alex", msgId: "<x@y>", classes: [9],
  marks: [{ ref: "TM-1", name, classes: [9] }] });
const nameError = (v) => v.errors.find((e) => /marks\[0\]\.name contains/.test(e));

test("#1913 — a bidi control is refused, and the refusal names the character and where it is", () => {
  const j = job("AURORA‮KS");                 // morty's C1a
  const e = nameError(validateJob(j));
  assert.ok(e, "a RIGHT-TO-LEFT OVERRIDE in a mark name must not be accepted");
  assert.match(e, /U\+202E RIGHT-TO-LEFT OVERRIDE at character 7/);
  // Refused, NOT stripped: the deliverable must name the mark the client asked about, so the name is
  // left exactly as submitted for them to resubmit.
  assert.equal(j.marks[0].name, "AURORA‮KS", "a refused name must not be silently altered");
  assert.match(e, /not stripped for you/);
});

test("#1913 — every bidi and zero-width class in the issue is covered, not just the one that was driven", () => {
  // The issue names U+202A–U+202E and U+2066–U+2069, plus U+200B–U+200D and U+FEFF. A guard that
  // covered only the two morty happened to type would leave the class open.
  for (const cp of [0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069,
                    0x200b, 0x200c, 0x200d, 0xfeff]) {
    const ch = String.fromCodePoint(cp);
    assert.ok(nameError(validateJob(job(`AUR${ch}ORA`))),
      `U+${cp.toString(16).toUpperCase()} is not refused in a mark name`);
  }
});

test("#1913 — a zero-width joiner is refused, because it makes a mark unequal to the one a reader sees", () => {
  const zwj = "AUR‍ORA";                      // morty's C1b
  assert.equal(zwj.replace(/‍/g, ""), "AURORA", "the fixture is the render-alike it claims to be");
  assert.notEqual(zwj, "AURORA", "and it does compare unequal — which is the defect");
  assert.match(nameError(validateJob(job(zwj))), /U\+200D ZERO WIDTH JOINER at character 4/);
});

test("#1913 — NFD collapses to NFC in place, so one mark ordered twice is one matter", () => {
  const nfd = "SIRÈNE".normalize("NFD");     // morty's C1d
  const nfc = "SIRÈNE".normalize("NFC");
  assert.notEqual(nfd, nfc, "the fixture is genuinely decomposed, or this arm proves nothing");
  const j = job(nfd);
  assert.equal(nameError(validateJob(j)), undefined, "normalizing is not refusing");
  assert.equal(j.marks[0].name, nfc, "the stored name is the composed form");
  assert.equal([...j.marks[0].name].length, 6);

  // The same for a mark submitted as a bare string: it is written back in place as a string, not
  // promoted to an object. Before the fix this stored the DECOMPOSED form, which is the two-matters-
  // for-one-order defect surviving at the one door this guard is the backstop for.
  const bareJob = { id: "j1", forwarder: "a", msgId: "<x@y>", classes: [9], marks: [nfd] };
  assert.equal(nameError(validateJob(bareJob)), undefined, "normalizing is not refusing");
  assert.equal(bareJob.marks[0], nfc, "a bare-string name is composed in place");
  assert.equal(typeof bareJob.marks[0], "string", "the shape it arrived in is the shape it keeps");
});

test("#1913 — the four measured-but-not-defective cases stay accepted and UNTOUCHED", () => {
  // This is the half that stops the fix becoming a worse defect. Each of these is a mark somebody may
  // legitimately want cleared, and each was measured by morty and explicitly not claimed.
  for (const [what, name] of [
    ["a Cyrillic homoglyph", "СOLA"],         // C1c — legitimate in some markets
    ["an emoji", "AURORA \u{1F680}"],              // C1f
    // C1g WAS a 200-character name, asserting "no cap fired, and none is claimed". A cap fires now and
    // one IS claimed: applies PLAN_MAX_NAME_LENGTH at the intake, because the
    // owner typed a product description into this field and the product ran on it. The control this
    // case exists for is unchanged and still needed — an ordinary LONG name must not trip the
    // display-control filter — so it is a long name WITHIN the budget. The over-budget direction is
    // asserted in its own arm below; leaving 200 here would have kept a sentence this file can no
    // longer honour, passing only because `nameError` reads one message.
    ["a long name within the budget", "A".repeat(120)],
    ["an accented letter", "SIRÈNE".normalize("NFC")],
    ["Arabic letters", "علامة"],                   // right-to-left LETTERS carry no U+202x at all
    ["Hebrew letters", "סימן"],
  ]) {
    const j = job(name);
    assert.equal(nameError(validateJob(j)), undefined, `${what} must not be refused`);
    assert.equal(j.marks[0].name, name, `${what} must not be altered`);
  }
});

test("#1913 — every field a job can carry a mark name in is covered, not only marks[]", () => {
  for (const shape of [
    { id: "j1", forwarder: "a", msgId: "<x@y>", classes: [9], markName: "AURORA‮KS" },
    { id: "j1", forwarder: "a", msgId: "<x@y>", classes: [9], name: "AURORA‮KS" },
  ]) {
    const field = shape.markName !== undefined ? "markName" : "name";
    const e = validateJob(shape).errors.find((x) => x.startsWith(`${field} contains`));
    assert.ok(e, `${field} is a mark-name field and is not checked`);
  }
  // Two marks, the second bad: the refusal must name the INDEX, or a batch submitter cannot find it.
  const batch = { id: "j1", forwarder: "a", msgId: "<x@y>", classes: [9],
    marks: [{ ref: "T1", name: "AURORA", classes: [9] }, { ref: "T2", name: "AUR‍ORA", classes: [9] }] };
  assert.ok(validateJob(batch).errors.some((e) => e.startsWith("marks[1].name contains")));

  // A BARE STRING IS THE FOURTH SHAPE, and it was the one this arm did not hold. The title claimed every
  // field while the population carried only object-shaped marks, so the arm passed with the shape
  // uncovered — measured before the fix, `marks: ["AURORA<U+202E>KS"]` came back ACCEPTED with no error.
  // `assembleFromFlags` converts strings to `{ name }`, so every assembling door was already covered;
  // the runner's wall validates the MANIFEST AS IT SITS ON DISK, which nothing re-assembles.
  const bare = { id: "j1", forwarder: "a", msgId: "<x@y>", classes: [9], marks: ["AURORA\u202EKS"] };
  assert.ok(validateJob(bare).errors.some((e) => e.startsWith("marks[0] contains")),
    "a mark submitted as a bare string is still a mark name");
  assert.equal(bare.marks[0], "AURORA\u202EKS", "a refused bare-string name must not be silently altered");
});

test("#1913 — the reader counts by codepoint, so a position past an emoji is the one a human would point at", () => {
  // Naive .split("") would count a surrogate pair as two and report the wrong character position, which
  // is exactly the kind of "correct but unusable" message a submitter cannot act on.
  const hits = markDisplayControlsIn("A\u{1F680}B‮C");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].at, 4, "the emoji is ONE character to the reader being asked to fix this");
  assert.equal(hits[0].name, "RIGHT-TO-LEFT OVERRIDE");
});


test("2078 a mark name that is a paragraph is refused, in the words the reader needs, and never truncated", () => {
  // The owner's own input, shortened: he typed a product description into the mark-name field, and the
  // product accepted it, priced it, ran it, and built the run's identity from it — `deriveSlug` kebabs
  // the mark with no bound, so it became the runId, the run directory and part of every report link.
  const paragraph = "i have a new product for bouncy bricks made of a composite from recycled material "
    + "it makes bricks that can be used to build a house that is bouncy so that it can flex in the wind";
  assert.ok(paragraph.length > 120, "the fixture stopped being over the budget it is here to exercise");

  const v = validateJob(job(paragraph));
  const errs = (v.errors ?? []).join("\n");
  assert.match(errs, /at most 120/, "the refusal does not state the budget the reader has to meet");
  assert.match(errs, /short string/, "the refusal does not say WHY a mark cannot carry a description");
  assert.match(errs, /not shortened for you/,
    "the refusal must say it did not truncate — a silently shortened mark is a search for something "
    + "the client did not ask for, which is worse than the paragraph");

  // EVERY FIELD A NAME CAN ARRIVE IN, not the one the fixture happens to use: the rule lives in
  // validateJob precisely so every door inherits it, and a per-field cap would be the fourth copy this
  // file's header warns about.
  for (const shape of [
    { id: "j1", forwarder: "a", msgId: "<x@y>", classes: [9], markName: paragraph },
    { id: "j1", forwarder: "a", msgId: "<x@y>", classes: [9], name: paragraph },
    { id: "j1", forwarder: "a", msgId: "<x@y>", classes: [9], marks: [{ name: paragraph, classes: [9] }] },
  ]) {
    assert.match((validateJob(shape).errors ?? []).join("\n"), /at most 120/,
      "a name field the budget does not reach is a door that still accepts a paragraph");
  }

  // AND IT IS NOT ALTERED. The deliverable must name the mark that was asked about.
  const j = job(paragraph);
  validateJob(j);
  assert.equal(j.marks[0].name, paragraph, "the refused name was rewritten instead of refused");
});


// ── — the belt behind the door's braces ──────────────────────────────────────
//
// 2078 closed the doors. This is the other half its fourth criterion asked for: `deriveSlug` bounds the
// name at the point of construction, "so a long or awkward name can never produce an unusable path even
// if one gets through". Nothing reaches it through a door today; the failures it guards are the ones
// that arrive without a door in front of them — a caller composing a runId without `validateJob`, or a
// filesystem with a stricter component limit than this one.
//
// THE TWO REQUIREMENTS ONLY LOOK LIKE THEY FIGHT. The bound must fire on a name well over the budget AND
// must leave every legal name byte-identical, because the slug is already on disk: every run directory,
// archive directory, pool directory and report link was computed from one. Both hold because the bound
// is on the NAME rather than on the kebab — a legal name is sliced by nothing.
test("2114 the slug is bounded at construction, and no legal name's slug moves a byte", () => {
  // THE PLANT IS THE FUNCTION AS IT SHIPPED, so byte-equality is measured against the old behaviour
  // rather than against today's output agreeing with itself.
  const asItShipped = (job) => {
    const raw = String(job.ref ?? job.tmp ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const mark = kebab(job.markName ?? job.name ?? job.marks?.[0]?.name ?? "mark");
    if (!raw) {
      const h = createHash("sha256").update(String(job.id ?? mark)).digest("hex").slice(0, 6);
      return `noref${h}-${mark}`;
    }
    return `${raw.startsWith("tmp") ? raw : `tmp${raw}`}-${mark}`;
  };

  // EVERY NAME HERE IS INSIDE THE DOOR'S BUDGET, including one exactly at it and three whose kebab is
  // not their own characters — an accent that decomposes, a symbol that decomposes to two letters, and
  // a script that survives kebab whole. Those are the cases a bound on the KEBAB would have moved.
  const legal = [
    "AQUAPLUS",
    "Sirène",
    "ACME™",
    "アクアプラス",
    "a name with spaces, punctuation & symbols!",
    "x".repeat(120),
    "Ω".repeat(120),
  ];
  for (const name of legal) {
    assert.ok(name.length <= 120, `${name.slice(0, 20)}… is not inside the budget this arm is about`);
    for (const ref of ["TMP1234", "", "tmp-99/b"]) {
      const j = { id: "j1", ref, marks: [{ name, classes: [9] }] };
      assert.equal(deriveSlug(j), asItShipped(j),
        `the slug of a legal name moved — every run directory and report link computed from it is now `
        + `unreachable (name ${JSON.stringify(name.slice(0, 20))}, ref ${JSON.stringify(ref)})`);
    }
  }

  // AND THE BOUND FIRES on the shape that has no door in front of it.
  const paragraph = "i have a new product for bouncy bricks made of a composite from recycled material "
    + "it makes bricks that can be used to build a house that is bouncy so that it can flex in the wind";
  assert.ok(paragraph.length > 120, "the fixture stopped being over the budget it is here to exercise");
  const slug = deriveSlug({ id: "j1", ref: "TMP1234", marks: [{ name: paragraph, classes: [9] }] });
  assert.ok(slug.length < paragraph.length, "the unbounded name reached the slug whole");
  assert.equal(slug, `tmp1234-${kebab(paragraph.slice(0, 120))}`,
    "the bound is the door's budget applied to the name, not some other number");

  // A USABLE PATH COMPONENT is the property the issue names, so it is asserted in bytes rather than in
  // characters — 255 is the limit on every filesystem this ships to, and a name is not necessarily
  // ASCII. Both halves of the slug are bounded, because bounding only the mark leaves the same defect
  // reachable through the reference.
  const worst = deriveSlug({ id: "j1", ref: "Ω".repeat(5000), marks: [{ name: "Ω".repeat(5000), classes: [9] }] });
  assert.ok(Buffer.byteLength(worst, "utf8") <= 255,
    `a 5000-character name and reference still compose a ${Buffer.byteLength(worst, "utf8")}-byte path component`);
  const noRef = deriveSlug({ id: "j1", marks: [{ name: "x".repeat(5000), classes: [9] }] });
  assert.ok(Buffer.byteLength(noRef, "utf8") <= 255,
    "the refless branch composes an unusable path component");
});
