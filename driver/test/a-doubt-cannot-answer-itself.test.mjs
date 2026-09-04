// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE PROVENANCE RULE: a doubt may not be ended by quoting the artifact it was minted out of.
//
// The defect these arms pin was not a near-miss. `mintPresenceDoubts` parses the digest's rated rows OUT
// of register-findings.md and mints a doubt for each row the DELIVERED set cannot account for — and that
// same file is one of the three CLOSURE_EVIDENCE_FILES the stitch and the seat may cite. So every
// presence doubt was minted from a row still sitting in the haystack that then answered it, and a
// presence doubt could never ship OPEN. It is a guard that cannot fire.
//
// Measured on the delivered run `674db9c7` (2026-08-19): its single presence doubt was settled
// `code-stitch` against register-findings.md, quoting "- Instructed scope: classes **5, 42, 44**…" — the
// digest's own scope header, which says nothing about the record in doubt.
//
// Every arm below plants the thing it claims to catch. The two that matter most are the NEGATIVE ones:
// the rule must be provenance, not file identity, or it breaks the settlement paths the dictation
// explicitly sanctions and re-creates the shape (a grammar that kills paid work).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { citesOwnSource, stitchDoubts, applyClosure } from "../doubt-ledger.mjs";
import { acceptClosure, CLOSURE_EVIDENCE_FILES } from "../doubt-closure-call.mjs";

const DRIVER_DIR = join(fileURLToPath(new URL(".", import.meta.url)), "..");

// A rated row that reached no delivered surface — the shape mintPresenceDoubts produces.
const presenceDoubt = (over = {}) => ({
  id: "doubt:presence:incumbent-context:1",
  birth: {
    place: "presence-reconciliation",
    artifact: "register-findings.md",
    quote: "| VENTURI | Venturi Labs SA | /mark/ch/switi0001 | H2 on-field |",
  },
  subject: {
    mark: "VENTURI", owner: "Venturi Labs SA", uris: ["/mark/ch/switi0001"],
    terms: ["VENTURI"], text: "rated on-field by the digest, joined to nothing delivered",
  },
  status: "open", ending: null, ...over,
});

// register-findings.md carries the mark in a watchlist line — the exact haystack the stitch searched.
const REGISTER_MD = [
  "## Instructed scope",
  "- Instructed scope: classes **5, 42, 44**; territories **CH, EU, US**",
  "",
  "## Watchlist",
  "- VENTURI — Venturi Labs SA (CH cl.9) — token family, monitor only",
].join("\n");

// ── 1. the predicate ──────────────────────────────────────────────────────────────────────────────

test("citesOwnSource is true only for the doubt's own birth artifact", () => {
  const d = presenceDoubt();
  assert.equal(citesOwnSource(d, "register-findings.md"), true);
  assert.equal(citesOwnSource(d, "findings.json"), false);
  assert.equal(citesOwnSource(d, "register-coverage-ledger.json"), false);
});

test("citesOwnSource compares basenames, so a path-qualified birth still matches", () => {
  const d = presenceDoubt({ birth: { place: "p", artifact: "run/_driver/../register-findings.md", quote: "q" } });
  assert.equal(citesOwnSource(d, "register-findings.md"), true, "a directory prefix must not defeat the rule");
});

test("citesOwnSource is false when the birth artifact is missing — it never guesses", () => {
  assert.equal(citesOwnSource({ birth: {} }, "findings.json"), false);
  assert.equal(citesOwnSource({}, "findings.json"), false);
  assert.equal(citesOwnSource(null, "findings.json"), false);
  assert.equal(citesOwnSource({ birth: { artifact: "" } }, ""), false, "empty must not equal empty");
});

// ── 2. the stitch ─────────────────────────────────────────────────────────────────────────────────

test("THE DEFECT: a presence doubt is no longer settled from the file it was minted out of", () => {
  const [out] = stitchDoubts([presenceDoubt()], { registerFindingsText: REGISTER_MD });
  assert.equal(out.status, "open", "the only available evidence was its own source — it must ship OPEN");
  assert.equal(out.ending, null);
});

test("THE PLANT: the same doubt born elsewhere still settles from register-findings.md", () => {
  // The rule is PROVENANCE, not file identity. Flip only the birth artifact and the identical join,
  // over the identical text, must still end the doubt — otherwise this is a file blacklist wearing a
  // provenance name, and it would silently strip the register surface from every other family.
  const born = presenceDoubt({ birth: { place: "record-carry", artifact: "register-named-band.json", quote: "q" } });
  const [out] = stitchDoubts([born], { registerFindingsText: REGISTER_MD });
  assert.equal(out.status, "checked-and-settled", "a doubt from another artifact keeps this evidence");
  assert.equal(out.ending.evidence.file, "register-findings.md");
});

test("the 19 measured record-carry settlements on run 674db9c7 are untouched", () => {
  // record-carry is born of register-named-band.json, so its question ("did ANY step record a ground?")
  // is legitimately answered by an internal file. Sweeping those in would have been scope this issue
  // did not ask for, and they are asserted here so a later widening has to argue with a test.
  const rc = {
    id: "doubt:record-carry:unreasoned:1",
    birth: { place: "record-carry", artifact: "register-named-band.json", quote: "/mark/ch/switi0001 — VENTURI" },
    subject: { mark: "VENTURI", owner: "Venturi Labs SA", uris: ["/mark/ch/switi0001"], terms: ["VENTURI"], text: "stopped at the synthesis seam" },
    status: "open", ending: null,
  };
  const [out] = stitchDoubts([rc], { registerFindingsText: REGISTER_MD });
  assert.equal(out.status, "checked-and-settled");
  assert.equal(out.ending.evidence.file, "register-findings.md");
});

test("a presence doubt still settles from findings.json — the delivered surface always ends it", () => {
  const findings = { findings: [{ mark: "VENTURI", owner: { name: "Venturi Labs SA", registrations: [{ uri: "/mark/ch/switi0001" }] } }], actions: [] };
  const [out] = stitchDoubts([presenceDoubt()], { findings, registerFindingsText: REGISTER_MD });
  assert.equal(out.status, "checked-and-settled");
  assert.equal(out.ending.evidence.file, "findings.json");
});

test("a presence doubt still settles from the coverage ledger — the dictation's sanctioned path", () => {
  // stages.mjs dictates that a presence doubt MAY be settled "by citing a delivered crowd/coverage
  // disclosure that prices that row's family in". A file-identity rule would have broken exactly this.
  const coverageRows = [{
    unit: "saturation-probe", axis: "register", scope: "dominant-element crowd",
    status: "confirmed-clean", reason: "130 live members including VENTURI, all outside the client's trade",
  }];
  const [out] = stitchDoubts([presenceDoubt()], { coverageRows, registerFindingsText: REGISTER_MD });
  assert.equal(out.status, "checked-and-settled");
  assert.equal(out.ending.evidence.file, "register-coverage-ledger.json");
});

// ── 3. the seat, which is the half that makes the stitch half worth anything ──────────────────────

test("applyClosure refuses the seat's circular citation and says WHY it refused", () => {
  // Without this the fix is cosmetic: the stitch runs first, so a doubt it now leaves open is handed
  // straight to a seat that could end it the same way one stage later.
  const doubts = [presenceDoubt()];
  const lines = [{ verdict: "SETTLED", id: doubts[0].id, file: "register-findings.md", quote: "VENTURI — Venturi Labs SA (CH cl.9)", reason: "it is on the watchlist" }];
  const r = applyClosure(doubts, lines, { "register-findings.md": REGISTER_MD });

  assert.equal(r.doubts[0].status, "open", "a verbatim quote from its own source must NOT settle it");
  assert.equal(r.settledByStage, 0);
  assert.equal(r.unverified.length, 1);
  assert.match(r.unverified[0].why, /own birth artifact/,
    "the run log must distinguish a circular citation from an invented one — they are different seat errors");
});

test("applyClosure still settles a seat citation from any other allowed file", () => {
  // RE-POINTED at a NON-presence doubt. This arm exists to prove the provenance guard is NARROW —
  // that it refuses the circular citation and nothing else. It used to drive a presence doubt, and the
  // presence rule below now holds those open for a second, unrelated reason; leaving it there would have
  // left it green while proving nothing about the guard it is named for.
  const doubts = [presenceDoubt({ id: "doubt:crosscheck:common-law:1",
    birth: { place: "gather-crosscheck", artifact: "common-law-findings.md", quote: "CROSS-CHECK REQUIRED: VENTURI" } })];
  const lines = [{ verdict: "SETTLED", id: doubts[0].id, file: "findings.json", quote: "VENTURI is carried as finding #4", reason: "delivered" }];
  const r = applyClosure(doubts, lines, { "findings.json": "VENTURI is carried as finding #4." });
  assert.equal(r.doubts[0].status, "checked-and-settled");
  assert.equal(r.settledByStage, 1);
});

// ──, owner-ruled: a PRESENCE doubt closes only on a delivered finding ───────────────────────

test("#1503 a corrections NOTE does not settle a presence doubt, however well it verifies", () => {
  // The plant: a SETTLED line whose quote is verbatim in a file that is NOT the doubt's birth artifact.
  // Everything the stage checks passes — the id is open, the citation is not circular, the quote is
  // present byte-for-byte — and it must still not settle, because a note is not a delivered finding.
  const doubts = [presenceDoubt()];
  const note = "The register layer re-checked VENTURI and recorded no live CH registration.";
  const lines = [{ verdict: "SETTLED", id: doubts[0].id, file: "findings.json", quote: note, reason: "the note answers it" }];

  const r = applyClosure(doubts, lines, { "findings.json": note });
  assert.equal(r.doubts[0].status, "open", "a verified quote from an allowed non-birth file settled a "
    + "presence doubt. The ruling is that only a delivered finding closes one — the note is the thing it "
    + "explicitly does not accept");
  assert.equal(r.settledByStage, 0);
  assert.equal(r.unverified.length, 1, "and it is REPORTED open, not dropped silently");
  assert.match(r.unverified[0].why, /only on a delivered finding/,
    "the run log must say why this was refused, or the seat cannot tell it from an invented quote");
});

test("#1503 CONTROL — that exact plant DOES settle a non-presence doubt", () => {
  // Without this the arm above passes if applyClosure simply stopped settling anything.
  const note = "The register layer re-checked VENTURI and recorded no live CH registration.";
  const d = presenceDoubt({ id: "doubt:crosscheck:common-law:2",
    birth: { place: "gather-crosscheck", artifact: "common-law-findings.md", quote: "CROSS-CHECK REQUIRED: VENTURI" } });
  const r = applyClosure([d], [{ verdict: "SETTLED", id: d.id, file: "findings.json", quote: note, reason: "answered" }],
    { "findings.json": note });
  assert.equal(r.doubts[0].status, "checked-and-settled",
    "the same line, the same file, the same quote — so the arm above is discriminating on the FAMILY and "
    + "not on something the fixture got wrong");
});

test("#1503 the family is named ONCE — the mint and the closure rule cannot drift apart", async () => {
  const { PRESENCE_BIRTH_PLACE } = await import("../doubt-ledger.mjs");
  const { mintPresenceDoubts } = await import("../presence-reconciliation.mjs");
  // A RATED SHEET ROW, which is what the mint parses — REGISTER_MD's watchlist line is not one, and
  // driving this arm with it minted nothing and failed the control rather than passing emptily.
  const rated = [
    "## Risk-relevant (CH, cl.9)",
    "",
    "| Mark | Owner | Record | Rating |",
    "| --- | --- | --- | --- |",
    "| VENTURI | Venturi Labs SA | /mark/ch/switi0001 | H2 on-field |",
  ].join("\n");
  const minted = mintPresenceDoubts(rated, { findings: [], coverageRows: [] });
  assert.ok(minted.length > 0, "the presence mint produced nothing from the fixture, so the arm below "
    + "would agree with itself over an empty list");
  for (const d of minted)
    assert.equal(d.birth.place, PRESENCE_BIRTH_PLACE,
      "the mint stamps a birth place the closure rule does not recognise — the rule would then be dead "
      + "code and every presence doubt settleable by a note again");
});

// ── 4. the call-time courtesy, and the direction it fails in ──────────────────────────────────────

const CALL_CTX = {
  openIds: new Set(["doubt:presence:incumbent-context:1"]),
  allowedFiles: CLOSURE_EVIDENCE_FILES,
  fileTexts: { "findings.json": "nothing", "register-findings.md": REGISTER_MD, "register-coverage-ledger.json": "{}" },
};
const circularRow = {
  kind: "doubt", doubt_id: "doubt:presence:incumbent-context:1", verdict: "settled",
  file_index: CLOSURE_EVIDENCE_FILES.indexOf("register-findings.md"),
  quote: "VENTURI — Venturi Labs SA (CH cl.9)", reason: "on the watchlist",
};

test("acceptClosure refuses the circular row in the seat's own turn, naming the file", () => {
  const r = acceptClosure(circularRow, { ...CALL_CTX, bornIn: { "doubt:presence:incumbent-context:1": "register-findings.md" } });
  assert.equal(r.ok, false);
  assert.match(r.reason, /register-findings\.md/, "the seat is told WHICH file, not just that it failed");
  assert.match(r.reason, /verdict:"open"/, "and what to do instead");
});

test("with no bornIn entry the call is accepted — and applyClosure still refuses it", () => {
  // The layering, asserted rather than assumed: the tool is a courtesy and the ledger is the authority.
  // A spec written by an older driver costs the seat a turn; it never costs the guard.
  const accepted = acceptClosure(circularRow, { ...CALL_CTX, bornIn: {} });
  assert.equal(accepted.ok, true, "the courtesy has nothing to say without the map");

  const r = applyClosure([presenceDoubt()], [{ verdict: "SETTLED", id: circularRow.doubt_id, file: accepted.row.file, quote: accepted.row.quote, reason: "x" }], { "register-findings.md": REGISTER_MD });
  assert.equal(r.doubts[0].status, "open", "the authority holds regardless of what the tool let through");
  assert.equal(r.unverified.length, 1);
});

test("acceptClosure leaves a non-circular citation alone", () => {
  const ok = acceptClosure({ ...circularRow, file_index: CLOSURE_EVIDENCE_FILES.indexOf("findings.json"), quote: "nothing" },
    { ...CALL_CTX, bornIn: { "doubt:presence:incumbent-context:1": "register-findings.md" } });
  assert.equal(ok.ok, true, ok.reason);
});

// ── 5. the growth tripwire — today's population is ONE, and that is the risk ──────────────────────

test("every doubt-minting module is accounted for against the citable set", () => {
  // Exactly one family is bound by this rule today: presence, born of register-findings.md. A
  // single-member population exercises no interaction and hides the next gap, so this arm fails when a
  // module starts minting doubts and nobody has decided whether its birth artifact is citable.
  const DECLARED = {
    "doubt-ledger.mjs": "gather-crosscheck (the search files) + audit-contradiction (audit.md) — neither citable",
    "presence-reconciliation.mjs": "register-findings.md — CITABLE, and the reason this rule exists",
    "record-carry.mjs": "register-named-band.json — not citable",
    "placement-carry.mjs": "placements.json — not citable",
    "commonlaw-carry.mjs": "common-law-grid.json — not citable",
    "remedy-accounting.mjs": "_driver/frame-reopen.json — not citable",
  };
  // Keyed on the doubt-record SHAPE — a `birth` block that names its `place` — not on the substring
  // "birth: {". The looser form matched doubt-closure-call.mjs, where the same words appear in a call
  // that constructs no doubt at all, and a tripwire that cries wolf gets an excuse row added to it
  // rather than a fix. The tolerance spans the multi-line form placement-carry and remedy-accounting use.
  const MINTS = /birth:\s*\{[\s\S]{0,80}?place:/;
  // RECURSES. A one-level scan would have been a guard that cannot fire — the exact defect this file
  // is about — because a minter added under `engine/` would never be looked at. `test/` and
  // `fixtures/` are skipped: this very file constructs doubt records, and a scanner that flags its own
  // fixtures gets an excuse row instead of a fix.
  const SKIP = new Set(["test", "fixtures", "node_modules", "skills"]);
  const walk = (dir, prefix = "") => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.isDirectory()) return SKIP.has(e.name) ? [] : walk(join(dir, e.name), `${prefix}${e.name}/`);
    return e.name.endsWith(".mjs") ? [`${prefix}${e.name}`] : [];
  });
  const minters = walk(DRIVER_DIR).filter((rel) => MINTS.test(readFileSync(join(DRIVER_DIR, rel), "utf8")));

  const undeclared = minters.filter((f) => !(f in DECLARED));
  assert.deepEqual(undeclared, [],
    `these modules mint doubts and are not declared against the citable set — decide whether the birth artifact is one of ${CLOSURE_EVIDENCE_FILES.join(", ")} and add it here`);

  const gone = Object.keys(DECLARED).filter((f) => !minters.includes(f));
  assert.deepEqual(gone, [], "declared minters that no longer mint — drop them from the table rather than leaving it lying");
});
