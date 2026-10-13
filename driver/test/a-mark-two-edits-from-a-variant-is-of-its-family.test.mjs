// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A MARK TWO EDITS FROM A VARIANT IS OF ITS FAMILY (ruled 2026-10-13).
//
// The band's classifier read a target's family as one edit, a whole matching word, the consonant skeleton or the
// sound code. On a measured run a register entry a reviewing lawyer listed was the client's word in another
// language, two edits from a meaning form the variants stage had made, and it read as "other": it sat among the
// other live marks for the client's goods, never with the mark's family. A record within two edits of a target of
// six letters or more now reads as the same family. Every mark and owner here is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyRecord, prepareTargets, buildBandShape, deriveRegisterPositions, EDIT2_MIN_LEN } from "../band-shape.mjs";
import { setAsideKeysOf } from "../placement-form.mjs";
import { goodsWordCounter, goodsWordsMatched } from "../record-goods.mjs";

const tier = (mark, targets) => { const c = classifyRecord(mark, prepareTargets(targets)); return [c.tier, c.basis]; };

test("a mark two edits from a target of six letters or more reads as the same family", () => {
  assert.equal(EDIT2_MIN_LEN, 6);
  assert.deepEqual(tier("Belamtro", ["Velantro"]), ["same-family", "edit-2"], "two substitutions read as no match");
  assert.deepEqual(tier("Velantrix", ["Velantro"]), ["same-family", "edit-2"], "another ending read as no match");
});

test("three edits, or a target shorter than six letters, stay outside the family; the rungs above keep their tiers", () => {
  assert.deepEqual(tier("Velandrigo", ["Velantro"]), ["other", "no-mechanical-match"], "three edits away");
  assert.deepEqual(tier("Belam", ["Velan"]), ["other", "no-mechanical-match"], "two edits from a five-letter target");
  assert.deepEqual(tier("Velentro", ["Velantro"]), ["near-identical", "edit-1"]);
  assert.deepEqual(tier("Velintrio", ["Velantro"]), ["same-family", "consonant-skeleton"]);
});

test("in the band, such a mark for the client's goods is listed with the mark's family, (c), and is no floor", () => {
  const rec = (id, mark, owner) => ({ record_id: `/mark/eu/${id}`, mark_text: mark, owner_name: owner, classes: ["9"], status: "registered", jurisdictions: ["EU"] });
  const band = [rec("m1", "Belamtro", "Mira Ltd"), rec("o1", "Plimbo", "Orla Ltd")];
  const positions = deriveRegisterPositions(band);
  const goods = { of: () => [{ classes: ["9"], text: "joysticks" }], hits: goodsWordCounter(["joysticks"]), matched: goodsWordsMatched(["joysticks"]) };
  const { shape } = buildBandShape({ enumerated: band, crowds: [] }, { targets: ["Velantro"], inScopeClasses: ["9"], positions, goods, goodsWordCount: 1,
    keysOf: setAsideKeysOf(positions.positions), markets: ["EU"] });
  assert.deepEqual(shape.groups.c.list.map((l) => l.record_id), ["/mark/eu/m1"], "the mark two edits away sat with the other live marks, not the family");
  assert.deepEqual(shape.groups.d.list.map((l) => l.record_id), ["/mark/eu/o1"], "guard: a mark like nothing stays in (d)");
  assert.equal(shape.floors.in_class_identical_or_near.length, 0, "the family rung made a floor");
});
