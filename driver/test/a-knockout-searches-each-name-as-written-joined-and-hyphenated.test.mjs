// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A KNOCKOUT SEARCHES EACH NAME AS WRITTEN, JOINED AND HYPHENATED, WITH THE ORDER'S ONE USE PHRASE (design, 2026-11-24).
//
// The frame chose each name's spellings and use words, so two runs of one order asked the market different questions: one
// dropped the hyphenated form, and the one page only that form had found was lost (measured in testing, 2026-11-23). The
// driver now builds the spellings from the name, and the frame names one use phrase from the brief for the names with the
// order's proposed use, and a name's own only where the client gives it a different use. The phrase is copied from the
// request and checked by plain containment, and nothing here parses a name or a request with a pattern (owner,
// 2026-11-24). A held answer from before keeps what it framed, so a replayed run frames as it ran. Every name here is
// invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dirname, join as joinPath } from "node:path";
import { fileURLToPath } from "node:url";
import { marketSpellings, useOf, validators, USE_PHRASE } from "../verify-knockout.mjs";
import { acceptKnockoutFrame, recordKnockoutFrame, useNotInRequest } from "../knockout-frame-record.mjs";
import { knockoutGridSpec } from "../stages-knockout.mjs";

test("each written form is searched as written, joined and hyphenated, with no repeat", () => {
  assert.deepEqual(marketSpellings("Quillmere Vane"), ["Quillmere Vane", "QuillmereVane", "Quillmere-Vane"]);
  assert.deepEqual(marketSpellings("  Quillmere   Vane "), ["Quillmere Vane", "QuillmereVane", "Quillmere-Vane"], "spacing is not a spelling");
  assert.deepEqual(marketSpellings("SORRELVANE"), ["SORRELVANE"], "a name of one word is its one form");
  assert.deepEqual(marketSpellings("Sorrel-Vane"), ["Sorrel-Vane", "SorrelVane"], "a hyphenated name is already its hyphenated form");
  assert.deepEqual(marketSpellings("Tam’s Quill"), ["Tam’s Quill", "Tam’sQuill", "Tam’s-Quill"]);
  assert.deepEqual(marketSpellings("Fen - Quill"), ["Fen - Quill", "FenQuill", "Fen-Quill"], "a hyphen with spaces round it is one break");
  assert.deepEqual(marketSpellings("FEN MOSS / MOSS FEN"), ["FEN MOSS / MOSS FEN", "FENMOSS/MOSSFEN", "FEN-MOSS-/-MOSS-FEN"],
    "with no written alternatives the row is split at its spaces only, as plainly as any name");
  assert.deepEqual(marketSpellings("FEN MOSS / MOSS FEN", ["FEN MOSS", "MOSS FEN"]),
    ["FEN MOSS", "FENMOSS", "FEN-MOSS", "MOSS FEN", "MOSSFEN", "MOSS-FEN"], "each written alternative, tied to its row");
  assert.deepEqual(marketSpellings("Quill Vane", ["Quill Vane", "QUILL VANE"]), ["Quill Vane", "QuillVane", "Quill-Vane"], "case is not a spelling");
});

const NOTE = "Two invented names, screened.";
const ROW = (name, over = {}) => ({ name, classes: [30], classesPlain: "confectionery (30)", contextFraming: "a product line",
  places: ["web", "shop.example.test"], ...over });
const CALL = (over = {}) => ({ scope_note: NOTE,
  batch: { productContext: "An invented confectionery range.", inUseAs: "a sweet or a snack line", useKind: "sweet flavour",
    executionOrder: ["Quillmere Vane", "SORRELVANE"] },
  marks: [ROW("Quillmere Vane"), ROW("SORRELVANE", { useKind: "seasonal gift box" })], ...over });

test("the plan carries the built spellings, the order's phrase, and a name's own use only where it was given", () => {
  const r = acceptKnockoutFrame(CALL());
  assert.equal(r.ok, true, r.reason);
  const [quill, sorrel] = r.model.marks;
  assert.deepEqual(quill.spellings, ["Quillmere Vane", "QuillmereVane", "Quillmere-Vane"]);
  assert.deepEqual(sorrel.spellings, ["SORRELVANE"]);
  assert.equal(useOf(quill, r.model.batch), "sweet flavour", "a name with the order's use takes its phrase");
  assert.equal(useOf(sorrel, r.model.batch), "seasonal gift box", "a use the client gave this name stands");
  const spec = (m) => knockoutGridSpec(m, r.model.batch, { outputPath: "/r/research/x.md" });
  assert.deepEqual([spec(quill).terms, spec(quill).use], [["Quillmere Vane", "QuillmereVane", "Quillmere-Vane"], "sweet flavour"]);
  assert.equal(spec(sorrel).use, "seasonal gift box");
});

test("spellings a call sends are replaced, so two runs of one order ask the same questions", () => {
  const sent = CALL({ marks: [ROW("Quillmere Vane", { spellings: ["Quillmere Vane", "Quilmere Vane"] }), ROW("SORRELVANE", { spellings: ["SORRELVANE", "SORELVANE"] })] });
  const a = acceptKnockoutFrame(sent), b = acceptKnockoutFrame(CALL());
  assert.equal(a.ok, true, a.reason);
  assert.deepEqual(a.model.marks.map((m) => m.spellings), b.model.marks.map((m) => m.spellings));
});

test("a call with no use phrase is asked for the order's, never for spellings, and a null use is no use", () => {
  const noPhrase = { productContext: "An invented confectionery range.", inUseAs: "a sweet" };
  const r = acceptKnockoutFrame(CALL({ batch: noPhrase }));
  assert.equal(r.ok, false);
  assert.match(r.reason, /^knockoutframe_use_kind: batch\.useKind is required/);
  assert.doesNotMatch(r.reason, /Quillmere Vane|spellings/, "the name and its spellings are not the defect");
  // Every name with its own use and none on the batch is still a call, not a held answer: it sends no spellings.
  const ownOnly = acceptKnockoutFrame(CALL({ batch: noPhrase, marks: [ROW("Quillmere Vane", { useKind: "sweet" }), ROW("SORRELVANE", { useKind: "gift box" })] }));
  assert.match(ownOnly.reason ?? "", /^knockoutframe_use_kind: batch\.useKind is required/);
  assert.doesNotMatch(ownOnly.reason ?? "", /spellings/);
  const nulls = acceptKnockoutFrame(CALL({ marks: [ROW("Quillmere Vane", { useKind: null }), ROW("SORRELVANE", { useKind: null })] }));
  assert.equal(nulls.ok, true, nulls.reason);
  assert.equal(useOf(nulls.model.marks[0], nulls.model.batch), "sweet flavour", "a null use takes the order's phrase");
});

test("the use phrase is a run of the request's own words, checked by plain containment", () => {
  const text = "Please screen these names for a sweet flavour range. The second is a seasonal gift box.";
  const plan = (batchUse, own = null) => ({ batch: { useKind: batchUse }, marks: [{ name: "Quillmere Vane" }, { name: "SORRELVANE", ...(own ? { useKind: own } : {}) }] });
  assert.deepEqual(useNotInRequest(plan("sweet flavour", "seasonal gift box"), text), []);
  assert.deepEqual(useNotInRequest(plan("sweet  flavour"), text), [], "spacing is not a word");
  assert.equal(useNotInRequest(plan("candy flavour"), text).length, 1, "a paraphrase is not a copy");
  assert.equal(useNotInRequest(plan("Sweet flavour"), text).length, 1, "a copy keeps the request's letters as written");
  assert.match(useNotInRequest(plan("sweet flavour", "holiday box"), text)[0], /^knockoutframe_use_kind:SORRELVANE — useKind "holiday box" is not in the request/);
  assert.deepEqual(useNotInRequest(plan("candy flavour"), ""), [], "a run with no request on file has nothing to copy from");
  assert.deepEqual(useNotInRequest({ batch: {}, marks: [{ name: "Quillmere Vane", useKind: "sweet" }] }, text), [], "a held answer is not checked");
});

test("the use phrase has one definition: the manual, the tool's field note and the refusal say it in the same words", () => {
  const manual = readFileSync(joinPath(dirname(fileURLToPath(import.meta.url)), "..", "skills", "knockout-frame", "SKILL.md"), "utf8");
  assert.ok(manual.includes(USE_PHRASE), "the manual's task 2c is not the one definition");
  const refusal = acceptKnockoutFrame(CALL({ batch: { productContext: "An invented range.", inUseAs: "a sweet" } })).reason;
  assert.ok(refusal.includes(USE_PHRASE), "the refusal does not say the definition");
});

test("a held answer framed before this keeps its own spellings and uses, so a replayed run frames as it ran", () => {
  const held = { scope_note: NOTE, batch: { productContext: "An invented confectionery range.", inUseAs: "a sweet" },
    marks: [ROW("Quillmere Vane", { useKind: "sweet", spellings: ["Quillmere Vane", "QuillmereVane"] })] };
  const r = acceptKnockoutFrame(held);
  assert.equal(r.ok, true, r.reason);
  assert.deepEqual(r.model.marks[0].spellings, ["Quillmere Vane", "QuillmereVane"]);
  assert.equal(useOf(r.model.marks[0], r.model.batch), "sweet");
  assert.match(acceptKnockoutFrame({ ...held, marks: [{ ...held.marks[0], spellings: ["Quillmere Vane"] }] }).reason ?? "",
    /spellings is required/, "and is checked under the rule it was written to");
});

test("the written plan passes the stage's check, and a plan whose spellings are not the driver's does not", () => {
  const dir = mkdtempSync(join(tmpdir(), "ko-terms-"));
  writeFileSync(join(dir, "instructed-scope.json"), JSON.stringify({ marks: ["Quillmere Vane", "SORRELVANE"] }));
  writeFileSync(join(dir, "inbound-request.txt"), "Two names, please: a sweet flavour line,\nand a seasonal gift box.");
  assert.match(recordKnockoutFrame(dir, CALL({ batch: { ...CALL().batch, useKind: "candy flavour" } })).refused ?? "",
    /batch\.useKind "candy flavour" is not in the request/, "the record refuses a phrase the request does not hold");
  const out = recordKnockoutFrame(dir, CALL());
  assert.ok(out.written, out.refused ?? out.write_failed);
  const text = readFileSync(out.written, "utf8");
  assert.equal(validators.knockoutPlan(out.written, text).ok, true, validators.knockoutPlan(out.written, text).reason);
  const plan = JSON.parse(text);
  plan.marks[0].spellings = ["Quillmere Vane", "Quilmere Vane"];
  assert.match(validators.knockoutPlan(out.written, JSON.stringify(plan)).reason ?? "", /spellings are the driver's forms of the name/);
});
