// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// TWO DIFFERENT NAMES IN ONE BATCH ARE NEVER DUPLICATES BECAUSE OF THE LETTERS THEY ARE WRITTEN IN.
//
// The per-name key keeps only `a-z0-9` and falls back to `mark`, so every name written wholly in Greek,
// Cyrillic or Han keyed as `mark`, and the collision rule refused any two of them as "duplicates or differ
// only in spacing/punctuation/case" — at intake, before any spend, on a batch of two different names. The
// same rule merged two Latin names that differ only in an accented letter. Every name below is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { kebab, kebabCollisions } from "../search-policy.mjs";
import { validateJob } from "../enqueue-schema.mjs";

const ROUTE_SEGMENT = /^[a-z0-9][a-z0-9-]*$/;
const JOB = { id: "msg-1", msgId: "<msg-1@x>", forwarder: "staff-a", ref: "TMP9001", markName: "QUEUE PROBE", classes: [9] };
const batch = (...names) => validateJob({ ...JOB, product: "knockout-search", marks: names.map((name) => ({ name })) });

test("two different names written wholly in another script are not duplicates, at the key and at the door", () => {
  for (const [a, b] of [["维尔特林", "佐伦迪克"], ["ΒΕΛΤΡΙΝ", "ЗОРЕНДИК"], ["ВЕЛТРИН", "ЗОРЕНДИК"]]) {
    assert.notEqual(kebab(a), kebab(b), `"${a}" and "${b}" share the key ${kebab(a)} — one research payload for two names`);
    assert.deepEqual(kebabCollisions([a, b]), [], `"${a}" and "${b}" read as duplicates`);
    const v = batch(a, b);
    assert.equal(v.ok, true, `the batch of "${a}" and "${b}" was refused: ${v.errors?.join(" ")}`);
  }
});

test("two Latin names that differ only in an accented letter are not duplicates either — the same class", () => {
  assert.deepEqual(kebabCollisions(["Lumèvo", "Lumévo"]), []);
  assert.notEqual(kebab("Lumèvo"), kebab("Lumévo"));
});

test("a true duplicate still collides, whatever its script: spacing, punctuation and case are not a new name", () => {
  for (const [a, b] of [["维尔特林", "维尔 特林"], ["ΒΕΛΤΡΙΝ", "βελτριν"], ["ВЕЛТРИН", "ВЕЛ-ТРИН"], ["Lumèvo", "LUMÈVO"], ["MOTO X", "MOTO-X"]]) {
    assert.equal(kebab(a), kebab(b), `"${a}" and "${b}" differ only in spacing, punctuation or case and must share one key`);
    assert.equal(kebabCollisions([a, b]).length, 1, `"${a}" and "${b}" were let through as two names`);
    assert.equal(batch(a, b).classify, "clarify", `the batch of "${a}" and "${b}" was not sent back`);
  }
});

test("every key is a route segment the per-name report link accepts", () => {
  for (const name of ["维尔特林", "ΒΕΛΤΡΙΝ", "ВЕЛТРИН", "Lumèvo", "VELTRIN 维尔", "Βέλτριν Café", "MOTO X", "½ moon™"])
    assert.match(kebab(name), ROUTE_SEGMENT, `"${name}" keys as ${kebab(name)}`);
});

test("a name the key already read in full keeps its key byte for byte", () => {
  // THE CONTROL. Research payloads, published report files and per-name links were keyed on the old
  // derivation, so every name it read without dropping a letter must key exactly as it did.
  const before = (s) => String(s ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "mark";
  const long = "THE LONGEST INVENTED NAME THIS TEST CAN THINK OF FOR A KEY THAT IS CUT AT SIXTY";
  for (const name of ["QUEUE PROBE", "MOTO-X 3000", "Project Novapulse", "alpha & beta", "  spaced  ", long, ""])
    assert.equal(kebab(name), before(name), `"${name}" moved from ${before(name)} to ${kebab(name)}`);
});
