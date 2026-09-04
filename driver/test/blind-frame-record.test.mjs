// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// The blind-frame recording transport. The property that carries the most weight is the LAST one: a
// model that is valid but cannot be STORED must not be reported as a rejected model. Those two have
// opposite repairs — one is "fix your reasoning", the other is "fix the disk" — and collapsing them is
// tonight's disease statement (a broad catch substituting a domain outcome for an infrastructure
// failure) running in reverse.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, existsSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //

import { acceptBlindFrame, recordBlindFrame, readRecordedModel, blindFrameCallPaths, MODEL_FILE } from "../blind-frame-record.mjs";
import { parseBlindFrameModel, VARIANT_DIRECTIONS } from "../blind-frame-model.mjs";

const runDir = () => mkdtempSync(join(tmpdir(), "bfr-"));

const GOOD = {
  dominant_element: "VELTRIN",
  variants: [
    { value: "VELTRI", direction: "drop", rationale: "the element without its terminal N" },
    { value: "VELTRYN", direction: "phonetic", rationale: "same sound, Latin-script respelling" },
  ],
  fields: [{ goods: "diagnostic software", on_field: true, rationale: "the actual product" }],
  sources: [{ channel: "hospital procurement portals", rationale: "where a buyer meets the mark" }],
  ranking_basis: "goods-overlap",
};

test("a well-formed call is stored, and what lands on disk round-trips through the SHIPPED parser", () => {
  const d = runDir();
  const answer = recordBlindFrame(d, GOOD);

  assert.equal(answer.refused, null);
  assert.equal(answer.written, join(d, MODEL_FILE));
  assert.equal(answer.variants, 2);

  // Not "the file exists" — the file PARSES, through the same function verify.mjs runs against it.
  const reread = parseBlindFrameModel(readFileSync(answer.written, "utf8"));
  assert.equal(reread.dominant_element, "VELTRIN");
  assert.equal(reread.ranking_basis, "goods-overlap");
  assert.deepEqual(readRecordedModel(d).variants.map((v) => v.value), ["VELTRI", "VELTRYN"]);
});

test("⭐ the tool and the VALIDATOR cannot drift — it calls parseBlindFrameModel rather than re-checking", () => {
  // Driven both ways. Without the second leg this is satisfied by a transport that accepts everything
  // and a parser that happens to agree on the one case tried.
  const bad = { ...GOOD, variants: [{ value: "X", direction: "sideways", rationale: "r" }] };

  const refused = acceptBlindFrame(bad);
  assert.equal(refused.ok, false);
  assert.match(refused.reason, /blindframe_direction_invalid:sideways/,
    "the seat is handed the parser's OWN token — the same one the corrective ladder would show it an attempt later");

  // …and the parser agrees, on the identical object.
  assert.throws(() => parseBlindFrameModel(JSON.stringify({ schema_version: 1, ...bad })), /blindframe_direction_invalid/);
  // The complement: what this layer accepts, the parser accepts.
  assert.equal(acceptBlindFrame(GOOD).ok, true);
  assert.ok(parseBlindFrameModel(JSON.stringify(acceptBlindFrame(GOOD).model)));
});

test("every declared direction is actually accepted — the enum and the parser name the same set", () => {
  // The schema advertises VARIANT_DIRECTIONS to the seat. If the parser rejected one of them, the tool
  // would be inviting a call it must then refuse.
  for (const direction of VARIANT_DIRECTIONS) {
    const r = acceptBlindFrame({ ...GOOD, variants: [{ value: "X", direction, rationale: "r" }] });
    assert.equal(r.ok, true, `the schema offers "${direction}" but the parser refuses it: ${r.reason}`);
  }
});

test("an empty variant set is refused — a model with no neighbourhood is not a model", () => {
  const r = acceptBlindFrame({ ...GOOD, variants: [] });
  assert.equal(r.ok, false);
  assert.match(r.reason, /blindframe_variants_empty/);
});

test("the payload is captured BEFORE the decision, so a REFUSED call still leaves its evidence", () => {
  const d = runDir();
  const answer = recordBlindFrame(d, { ...GOOD, ranking_basis: "vibes" });

  assert.ok(answer.refused, "refused, and it says why");
  assert.equal(answer.written, null, "…and nothing was written");
  assert.ok(answer.captured, "…but the call it refused is on the record");
  const payload = JSON.parse(readFileSync(blindFrameCallPaths(d).payload, "utf8"));
  assert.equal(payload.params.ranking_basis, "vibes", "captured AS RECEIVED, including the value that lost");
});

// SKIPPED under root, here and in the test below, rather than returned early: root ignores a directory's
// write bit, so the 0o500 refuses nothing, the write lands and the answer correctly reports success — the
// red is a defect in this harness, not in the transport. An early `return` would be the same lie facing
// the other way, reporting `ok` for a test that asserted nothing, so the reason is declared on the line.
test("⛔ a VALID model that cannot be WRITTEN is a write failure, never a refusal",
  { skip: process.getuid?.() === 0 && "root writes through a 0o500 directory — the fault injection is a no-op" }, () => {
  // The two have opposite repairs. Reporting an unwritable disk as a rejected model would send the seat
  // to re-reason a model that was already correct — and, worse, would land in the corrective ladder as a
  // reasoning defect, which is the substitution that bought two months in the other direction.
  const d = runDir();
  chmodSync(d, 0o500);
  try {
    const answer = recordBlindFrame(d, GOOD);
    assert.equal(answer.refused, null, "the MODEL was fine and the answer must not say otherwise");
    assert.ok(answer.write_failed, "the infrastructure failure is named, in its own field");
    assert.equal(answer.written, null);
    assert.equal(existsSync(join(d, MODEL_FILE)), false);
  } finally { chmodSync(d, 0o700); }
});

test("a capture that cannot be written does not cost a valid call its model",
  { skip: process.getuid?.() === 0 && "root writes through a 0o500 directory — the fault injection is a no-op" }, () => {
  // Capture is evidence, not a gate. But "captured" and "capture failed" are different facts and the
  // answer says which — an answer reporting only success makes a lost payload invisible.
  const d = runDir();
  mkdirSync(driverDir(d), { recursive: true });
  chmodSync(driverDir(d), 0o500);
  try {
    const answer = recordBlindFrame(d, GOOD);
    assert.equal(answer.captured, null);
    assert.ok(answer.capture_failed, "named, not swallowed");
    assert.ok(answer.written, "…and the valid model was still stored");
  } finally { chmodSync(driverDir(d), 0o700); }
});
