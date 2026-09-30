// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A PAYLOAD IS REDACTED AS A STRUCTURE, NOT AS ITS SERIALISATION.
//
// `--json` used to be built, stringified, and sent through the boundary like any other line. That
// redacts a document with no prose in it: every string in it is either a field NAME this repository
// wrote or a VALUE out of the data, and the two need opposite treatment. On one real score the keys
// `owner` and `additional` came back as tokens, because both are distinctive words of multi-word parties
// in that reference — two fields a consumer could neither address nor discover the new name of.
//
// KEYS ARE AUTHORED AND VALUES ARE DATA. A key gets the authored instrument, which drops the derived
// layer; a value keeps every layer, including the derived one that closed the leak where a two-word
// proprietor's first word survived in prose.
//
// EVERY ARM THAT ASSERTS A KEY SURVIVED IS PAIRED WITH ONE ASSERTING A VALUE DID NOT. A payload that
// stopped redacting and a payload that redacts correctly look identical from the key side alone.
import { test } from "node:test";
import assert from "node:assert/strict";
import { protectedStrings, redactor, authoredRedactor, redactDeep, printPreRedacted, installRedaction } from "../score-redaction.mjs";

// A party whose distinctive word IS an ordinary field name, which is the whole case. `owner` is a real
// key in the scored payload, and "Owner" here is a word of a two-word party — exactly the collision
// measured on a live reference.
const REFERENCE = {
  mark: "Wrenlow",
  register: [
    { mark: "Wrenlow Owner Group", owner: "Additional Brands AG", note: "A live registration the lawyer raised.", classes: ["9"] },
  ],
};

function instruments() {
  const { names, prose, derived } = protectedStrings({ reference: REFERENCE });
  return { redactValue: redactor({ names, prose }), redactKey: authoredRedactor({ names, prose, derived }), names, derived };
}

// ── the asymmetry ────────────────────────────────────────────────────────────────────────────────────

test("a key that is a party's ORDINARY word survives, and the same word in a value does not", () => {
  const { redactValue, redactKey, derived } = instruments();
  assert.ok([...derived].some((w) => w.toLowerCase() === "owner"),
    "the fixture is not exercising the case: `owner` must be a derived word of a multi-word party");

  const out = redactDeep({ owner: "Owner", additional: 2 }, { redactValue, redactKey });
  assert.ok("owner" in out, `the key was eaten: ${JSON.stringify(out)}`);
  assert.equal(out.additional, 2, "a number is returned as it is");
  // THE PAIR. The key survived; the value with the same word did not, because a value is data.
  assert.notEqual(out.owner, "Owner", `the value kept a party's word: ${JSON.stringify(out)}`);
});

test("a key that is a party's WHOLE name is still redacted — this is not a bypass", () => {
  const { redactValue, redactKey } = instruments();
  const out = redactDeep({ "Wrenlow Owner Group": 1 }, { redactValue, redactKey });
  assert.ok(!Object.keys(out).some((k) => k.includes("Wrenlow")),
    `a whole party name survived as a key: ${JSON.stringify(out)}`);
});

test("a value carrying a whole party name is withheld", () => {
  const { redactValue, redactKey } = instruments();
  const out = redactDeep({ field: "Additional Brands AG holds it" }, { redactValue, redactKey });
  assert.ok(!out.field.includes("Additional Brands AG"), `a name reached a value: ${out.field}`);
  assert.match(out.field, /«name \d+»/);
});

test("a value that is a reference SENTENCE is withheld whole, not tokenised in place", () => {
  // Redacting in isolation lets the prose layer match a whole sentence. Serialising first hid that:
  // the sentence stayed, with tokens punched through it, which shows its shape.
  const { redactValue, redactKey } = instruments();
  const out = redactDeep({ note: "A live registration the lawyer raised." }, { redactValue, redactKey });
  assert.ok(!out.note.includes("lawyer raised"), `the sentence survived: ${out.note}`);
  assert.match(out.note, /withheld/);
});

// ── the shape is not changed ─────────────────────────────────────────────────────────────────────────

test("numbers, booleans and null keep their type, so the payload's shape is unchanged", () => {
  const { redactValue, redactKey } = instruments();
  const out = redactDeep({ n: 7, t: true, f: false, z: null }, { redactValue, redactKey });
  assert.deepEqual(out, { n: 7, t: true, f: false, z: null });
});

test("arrays and nesting are walked, and an array stays an array", () => {
  const { redactValue, redactKey } = instruments();
  const out = redactDeep({ rows: [{ owner: "Additional Brands AG" }, { owner: "someone else" }] },
    { redactValue, redactKey });
  assert.ok(Array.isArray(out.rows), "an array must not become an object");
  assert.equal(out.rows.length, 2);
  assert.ok("owner" in out.rows[0], "the nested key was eaten");
  assert.ok(!out.rows[0].owner.includes("Additional Brands"), "the nested value leaked");
  assert.equal(out.rows[1].owner, "someone else", "an ordinary value is untouched");
});

test("an empty object and an empty array come back as themselves", () => {
  const { redactValue, redactKey } = instruments();
  assert.deepEqual(redactDeep({ a: {}, b: [] }, { redactValue, redactKey }), { a: {}, b: [] });
});

// ── identity, which is the --names path ──────────────────────────────────────────────────────────────

test("CONTROL: with identity instruments nothing is withheld — the arms above are not testing a no-op", () => {
  const id = (x) => x;
  const payload = { owner: "Additional Brands AG", rows: [{ mark: "Wrenlow Owner Group" }] };
  assert.deepEqual(redactDeep(payload, { redactValue: id, redactKey: id }), payload);
});

// ── the raw writer ───────────────────────────────────────────────────────────────────────────────────

test("printPreRedacted writes through the install without redacting again", () => {
  // The point of the raw path: text already redacted part by part must not go round a second time, or
  // the derived layer is re-applied to keys and the defect comes straight back.
  const { redactValue, redactKey } = instruments();
  const written = [];
  const io = {
    console: { log() {}, error() {}, warn() {}, info() {}, debug() {} },
    process: { stdout: { write: (t) => { written.push(t); return true; } },
      stderr: { write: () => true }, on() {}, off() {}, exit() {} },
  };
  const uninstall = installRedaction(redactValue, io, redactKey);
  try {
    printPreRedacted('{"owner":"«name 1»"}\n');
  } finally { uninstall(); }
  assert.equal(written.length, 1);
  assert.match(written[0], /"owner"/, `the raw write was redacted again: ${written[0]}`);
});

test("CONTROL: an ordinary log through the same install IS redacted — the install was live", () => {
  // Without this, the arm above passes just as well when nothing is installed at all.
  const { redactValue, redactKey } = instruments();
  const logged = [];
  const io = {
    console: { log: (...a) => logged.push(a.join(" ")), error() {}, warn() {}, info() {}, debug() {} },
    process: { stdout: { write: () => true }, stderr: { write: () => true }, on() {}, off() {}, exit() {} },
  };
  const uninstall = installRedaction(redactValue, io, redactKey);
  try { io.console.log("Additional Brands AG"); } finally { uninstall(); }
  assert.equal(logged.length, 1);
  assert.ok(!logged[0].includes("Additional Brands AG"), `the install was not live: ${logged[0]}`);
});

test("after uninstall the raw printer is not left armed on a dead stream", () => {
  const { redactValue, redactKey } = instruments();
  const io = {
    console: { log() {}, error() {}, warn() {}, info() {}, debug() {} },
    process: { stdout: { write: () => true }, stderr: { write: () => true }, on() {}, off() {}, exit() {} },
  };
  installRedaction(redactValue, io, redactKey)();
  // With nothing installed it falls back to the real stdout rather than the captured one, which is the
  // documented no-redaction case. It must not throw, and it must not write to the uninstalled io.
  let leaked = false;
  io.process.stdout.write = () => { leaked = true; return true; };
  printPreRedacted("");
  assert.equal(leaked, false, "the raw printer still held a reference to the uninstalled stream");
});

// ── two sibling keys that reduce to one token ────────────────────────────────────────────────────────

test("THE PAYLOAD KEEPS ITS KEY COUNT, at every level", () => {
  // The arm that was missing: every other arm here asserts what a VALUE became, and none asserted that
  // the object still has as many fields as it started with.
  //
  // WHAT IT DOES AND DOES NOT CATCH, because the distinction matters and the obvious reading is wrong.
  // Before the collision guard existed, this arm on a COLLIDING payload was what would have caught the
  // defect — a lost field showed only as a smaller count. It cannot catch it now: a collision refuses,
  // and a refusal is not a short object. So this arm guards the OTHER way of losing a key — a walk that
  // drops one for any reason that is not a collision — and the two arms below guard the collision. Saying
  // so because "the payload keeps its key count" reads like the collision guard and is not.
  const { redactValue, redactKey } = instruments();
  const payload = { owner: "Additional Brands AG", additional: 2, rows: [{ mark: "Wrenlow Owner Group", note: "x" }] };
  const countKeys = (v) => Array.isArray(v) ? v.reduce((n, x) => n + countKeys(x), 0)
    : v && typeof v === "object" ? Object.keys(v).length + Object.values(v).reduce((n, x) => n + countKeys(x), 0)
    : 0;
  assert.equal(countKeys(redactDeep(payload, { redactValue, redactKey })), countKeys(payload),
    "the walk must not lose a field; a collision is refused separately and cannot be seen here");
});

test("a collision REFUSES rather than dropping the field that loses", () => {
  // The matcher tolerates a trailing plural, so a protected name and that name plus `s` both match and
  // both become one token. Rebuilding key by key, the second write wins and the first field is gone.
  const { names, prose, derived } = protectedStrings({ reference: REFERENCE });
  const redactValue = redactor({ names, prose });
  // `Quillion` is a protected mark in the fixture, so `Quillion` and `Quillions` collide as siblings.
  const redactKey = authoredRedactor({ names: new Set(["Quillion"]), prose, derived });
  assert.throws(
    () => redactDeep({ Quillion: 1, Quillions: 2 }, { redactValue, redactKey }),
    (e) => e.code === "REDACTED_KEY_COLLISION" && /same token/.test(e.message),
    "a payload that cannot be rendered addressably must refuse, not be written short");
});

test("the refusal names the TOKEN and the PATH, never the keys — they are the protected name", () => {
  // Saying which keys collided would print the very name being withheld: the keys ARE the protected
  // string, which is why they collided. A reader who needs them asks with --names, where nothing is
  // withheld and the collision cannot arise.
  const { prose, derived } = protectedStrings({ reference: REFERENCE });
  const redactKey = authoredRedactor({ names: new Set(["Quillion"]), prose, derived });
  let err = null;
  try { redactDeep({ nested: { Quillion: 1, Quillions: 2 } }, { redactValue: (x) => x, redactKey }); }
  catch (e) { err = e; }
  assert.ok(err, "it must throw");
  assert.ok(!err.message.includes("Quillion"), `the refusal printed the protected name: ${err.message}`);
  assert.match(err.message, /«name \d+»/, "it names the token instead");
  assert.match(err.message, /nested/, "and where it happened, so the field is findable");
  assert.match(err.message, /--names/, "and how to see the keys, which is safe because nothing is withheld there");
});

test("CONTROL: identity instruments cannot collide, so --names never refuses", () => {
  // The flag's whole point is that nothing is withheld; if it could refuse, a reader would lose the one
  // path that shows them the payload.
  const id = (x) => x;
  const payload = { Quillion: 1, Quillions: 2 };
  assert.deepEqual(redactDeep(payload, { redactValue: id, redactKey: id }), payload);
});
