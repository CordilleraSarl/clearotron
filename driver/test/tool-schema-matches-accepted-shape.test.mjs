// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// tool-schema-matches-accepted-shape.test.mjs —: what the tool ADVERTISES and what it ACCEPTS
// are two claims, and nothing compared them.
//
// ── WHAT THIS CAUGHT ────────────────────────────────────────────────────────────────────────────────
//
// `record_dispositions` advertised `anchor` and did not advertise `segment_index` or `fragment`.
// `anchor` is pointer-era: disposition-call.mjs marks its refusal tokens "No live path emits these",
// because it was SPLIT into the two fields above ("the two duties it conflated"). So a seat that read
// the tool's own schema sent the one field the validator ignores and omitted the two it refuses for,
// and could only learn the real shape from refusal text — one round trip per discovery.
//
// That is 's class one level over: there, a tool was SERVED and not GRANTED; here, a shape is
// REFUSED and not ADVERTISED. Both are a surface disagreeing with itself, and both are invisible to
// every test that exercises one side alone.
//
// ── WHAT IT DOES NOT CLAIM ──────────────────────────────────────────────────────────────────────────
//
// This is NOT 's fix and must not be read as one. 's ratified criterion is that the seat
// names a location and CODE extracts the text — no transcription at all. The obligation to copy
// characters is dictated in gateway.mjs's corrective hints, which this lane does not own. An
// advertisement that matches the refusal removes a round trip; it does not remove the tax.
//
// ── WHY A SOURCE SCAN AND NOT AN IMPORT ─────────────────────────────────────────────────────────────
//
// Importing the server runs `serve()`, which starts a stdio server. So the schema is read out of the
// source, and every step that could silently match nothing FAILS instead — a scan that finds no
// properties would otherwise assert set-equality between two empty sets and pass forever.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { CALL_ROW_FIELDS } from "../disposition-call.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
// — the tool moved to its OWN server module, off the shared `perplexity` key that four stages
// held and one lane's doctrine ever ordered. This scan follows the DECLARATION, which is the only
// thing it was ever about; the assertion below still fails loudly if it is not found where it looks.
const SERVER = join(ROOT, "driver", "engine", "mcp", "dispositions-server.mjs");

/** The property names the `record_dispositions` row schema declares. Throws rather than returning []. */
function declaredRowProperties() {
  const src = readFileSync(SERVER, "utf8");
  const toolAt = src.indexOf('name: "record_dispositions"');
  assert.ok(toolAt > 0, "record_dispositions is no longer declared in dispositions-server.mjs");
  const handlerAt = src.indexOf("handler: record_dispositions", toolAt);
  assert.ok(handlerAt > toolAt, "could not find the end of the record_dispositions tool block");
  const block = src.slice(toolAt, handlerAt);

  const itemsAt = block.indexOf("items: { type: \"object\"");
  assert.ok(itemsAt > 0, "the rows array no longer declares an object item schema");
  const items = block.slice(itemsAt);

  // Property keys are the `name: {` entries inside the item schema, one per line.
  const names = [...items.matchAll(/^\s+([a-z_]+): \{ type: "/gm)].map((m) => m[1]);
  assert.ok(names.length, "found NO declared row properties — this scan is measuring nothing, fix the scan");
  return names;
}

test("#1172 the tool advertises exactly the row shape the validator accepts", () => {
  const declared = declaredRowProperties();
  const accepted = [...CALL_ROW_FIELDS];

  const notAdvertised = accepted.filter((f) => !declared.includes(f));
  assert.deepEqual(notAdvertised, [],
    `the validator accepts ${notAdvertised.join(", ")} and the tool does not advertise ${notAdvertised.length === 1 ? "it" : "them"} — `
    + "a seat can only discover a field it is refused for from the refusal, which costs a round trip per row");

  const notAccepted = declared.filter((f) => !accepted.includes(f));
  assert.deepEqual(notAccepted, [],
    `the tool advertises ${notAccepted.join(", ")} and the validator does not read ${notAccepted.length === 1 ? "it" : "them"} — `
    + "a seat that fills an advertised field and is refused anyway has been told to do the wrong thing");
});

test("#1172 the retired pointer-era field is not advertised", () => {
  // `anchor` was split into segment_index + fragment. Its refusal tokens are declared in
  // disposition-call.mjs with the note "No live path emits these" — advertising it invites exactly the
  // shape that gets refused, which is what this test exists to stop coming back.
  assert.ok(!declaredRowProperties().includes("anchor"),
    "`anchor` is advertised again. It is pointer-era: it was split into `segment_index` + `fragment`, "
    + "no live path emits its refusals, and a seat that sends it is refused for the two fields it "
    + "replaced. Read the token block in disposition-call.mjs before re-adding it.");
});

test("#1172 the advertisement and the refusal use the same words for the same duty", () => {
  // The schema text and the refusal text are two descriptions of one obligation, written in two files.
  // When they drift, the seat is corrected toward wording it was never given — so the shared nouns are
  // pinned rather than left to chance.
  const schema = readFileSync(SERVER, "utf8");
  const at = schema.indexOf('name: "record_dispositions"');
  const block = schema.slice(at, schema.indexOf("handler: record_dispositions", at));
  assert.match(block, /segment_index[^\n]*NUMBER of the numbered passage/,
    "the segment_index description no longer says what a segment index IS, in the refusal's words");
  // — the fragment is no longer a duty, so the schema must not advertise one. The property worth
  // pinning flipped with it: previously "the advertisement matches the refusal", now "the advertisement
  // says it is optional", because a seat that reads `fragment` as required pays the cost this change
  // removed even though nothing refuses it any more.
  assert.match(block, /fragment[^\n]*OPTIONAL/,
    "the fragment description no longer tells the seat the field is optional");
  assert.doesNotMatch(block, /fragment[^\n]*Required alongside/,
    "the schema still advertises the fragment as required");

  const validator = readFileSync(join(ROOT, "driver", "disposition-call.mjs"), "utf8");
  assert.match(validator, /the NUMBER of the numbered passage you relied on/,
    "the refusal wording moved — re-read the schema descriptions, they quote it");
});
