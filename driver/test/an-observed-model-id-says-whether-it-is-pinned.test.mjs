// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// `modelBasis: "actual"` says the PROVIDER answered. It does not say the answer names a fixed build.
//
// Measured across three archived clearance runs: haiku came back `claude-haiku-4-5-20251001`; opus and
// sonnet came back `claude-opus-5` and `claude-sonnet-5`. All three were recorded identically as
// observed, and two of them name something the provider can repoint underneath us. A snapshot rotation
// behind either alias between two runs leaves EXACTLY that record and is invisible.
//
// Why that matters beyond tidiness: every comparison across time on this product has had to ASSUME the
// seat did not move, and the record could not support the assumption either way. An absence read as a
// negative is how a question acquires a false elimination.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { modelSnapshotKind } from "../driver.config.mjs";

const DRIVER = join(dirname(fileURLToPath(import.meta.url)), "..");

test("the three ids three real runs actually recorded are told apart", () => {
  // Not invented values — these are what the archived attempt rows carry.
  assert.equal(modelSnapshotKind("claude-haiku-4-5-20251001"), "snapshot");
  assert.equal(modelSnapshotKind("claude-opus-5"), "alias");
  assert.equal(modelSnapshotKind("claude-sonnet-5"), "alias");
});

test("both date spellings count as pinned, and a vendor prefix does not hide one", () => {
  assert.equal(modelSnapshotKind("gpt-5-2025-08-07"), "snapshot");
  assert.equal(modelSnapshotKind("claude-opus-5-20260101"), "snapshot");
  assert.equal(modelSnapshotKind("anthropic/claude-sonnet-5"), "alias");
});

test("nothing to judge is NULL, never quietly an alias", () => {
  // `modelActual` is null whenever the stream never said — an engine that emits no id, a turn killed
  // before any event, a spawn error. Recording that as "alias" would state a fact about the provider's
  // answer when there was no answer, which is the shape this whole field exists to stop.
  for (const empty of [null, undefined, "", "   "]) assert.equal(modelSnapshotKind(empty), null);
});

test("the gateway records it on the attempt row beside modelBasis", () => {
  // A derivation nothing writes down answers nobody. Source-level, because the row is built inside the
  // dispatch loop with no seam a unit test reaches — the same reason its neighbours are checked this way.
  const src = readFileSync(join(DRIVER, "gateway.mjs"), "utf8");
  assert.match(src, /const modelSnapshot = modelSnapshotKind\(modelActual\)/,
    "the gateway does not derive it, so no run record can carry it");
  const rows = [...src.matchAll(/modelActual, modelBasis,([^\n]*)/g)].map((m) => m[1]);
  assert.ok(rows.length >= 2, "the attempt rows moved — this guard is reading nothing");
  for (const r of rows) assert.match(r, /modelSnapshot/, `an attempt row records modelBasis without modelSnapshot: ${r.trim()}`);
});
