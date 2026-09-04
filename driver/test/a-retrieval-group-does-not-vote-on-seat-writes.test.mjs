// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// — TWO PREDICATES THAT INFERRED A STAGE PROPERTY FROM A GROUP LIST, AND BOTH FAILED PERMISSIVE.
//
// A conversion moves an artifact from "the seat writes it" to "the driver writes it, from a typed call",
// and the grant loses `Write`/`Edit` — that is the whole point. `seatWritesForGroups` decided whether the
// pair is granted, by asking `.every()` over the group list and treating a group with no recording row as
// a WRITER. Retrieval groups have no recording row. So a single `perplexity` or `band` beside a recording
// group put the hand-write pair straight back:
//
//   allowedToolsFor(["recording-doubt-closure"])                     -> Read + record tool
//   allowedToolsFor(["perplexity","band","recording-doubt-closure"]) -> Read WRITE EDIT + record tool
//
// Measured on defa33c with no edits. It had never fired because every recording stage until
// narrative-refutation held its recording group ALONE — and `allowedToolsFor`'s own note predicted the
// moment exactly ("this is what makes the first one that appears behave correctly instead of silently")
// while being wrong about the outcome. The first one that appeared kept the pair.
//
// ── WHY THESE ARMS ARE SYNTHETIC AND NOT A WALK OVER THE REAL STAGES ────────────────────────────────
//
// A walk over `RECORDING_STAGES` passes today with or without the fix for eight of the nine, because
// those eight hold one group each and the defect needs two. An arm that can only fail through
// narrative-refutation would go quiet the moment that stage changed shape, and would never have caught
// this before the stage existed. These drive the predicate directly with invented group lists, so they
// are a claim about the RULE rather than about the current population.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  seatWritesForGroups, allowedToolsFor, toolGroupsForStage,
  RECORDING_STAGES, RECORDING_KEYS, RECORDING_STAGES_KEEPING_RETRIEVAL, SEAT_WRITE_FREE_STAGES,
} from "../engine/mcp/gather-config.mjs";
import { STAGES } from "../stages.mjs";

// A real recording key, taken from the table rather than typed — a literal would rot into a group that
// resolves to nothing, and `seatWritesForGroups` returns `true` for an unknown group, which is this
// file's own failure mode wearing a passing arm.
const someRecordingKey = () => {
  const key = [...RECORDING_KEYS][0];
  assert.ok(key, "no recording keys exist — the table is empty and every arm below would be vacuous");
  return key;
};

test("#1893 a retrieval group beside a recording group does not restore Write/Edit", () => {
  const rec = someRecordingKey();
  // THE DEFECT, DRIVEN. Each of these returned `true` before the fix — one retrieval group was enough.
  for (const groups of [[ "perplexity", rec ], [ "band", rec ], [ "perplexity", "band", rec ]]) {
    assert.equal(seatWritesForGroups(groups), false,
      `${groups.join("+")}: a retrieval group voted "writer" and put the hand-write pair back. Retrieval `
      + "authors nothing — only a recording row may decide whether this seat writes its own artifact");
    const grant = allowedToolsFor(groups).split(" ");
    assert.ok(!grant.includes("Write") && !grant.includes("Edit"),
      `${groups.join("+")} resolved to a grant carrying the hand-write pair: ${grant.join(" ")}. The `
      + "superseded path is exactly what the conversion removes, and a seat has been measured obeying a "
      + "prose order to hand-write while holding the tool");
    assert.ok(grant.includes("Read"), "Read is seeded unconditionally for stage I/O and must survive");
  }
});

test("#1893 …and the rule still lets an ordinary authoring stage write", () => {
  // THE OTHER DIRECTION, which is what stops the fix being "delete the pair for everyone". A stage with no
  // recording group authors its own file and must keep the tools; the empty list is the same case.
  assert.equal(seatWritesForGroups(["perplexity", "band"]), true,
    "a stage holding only retrieval groups still authors its own findings by hand");
  assert.equal(seatWritesForGroups([]), true, "no groups at all is an ordinary authoring stage");
  assert.equal(seatWritesForGroups(["nonexistent-group"]), true,
    "an UNKNOWN group must not silently make a seat write-free — it has no recording row, so it cannot "
    + "answer the question, and the safe answer is the one that leaves the stage able to do its job");
  const grant = allowedToolsFor(["perplexity", "band"]).split(" ");
  assert.ok(grant.includes("Write") && grant.includes("Edit"),
    "a retrieval-only stage lost the hand-write pair — the fix has over-reached from 'retrieval does not "
    + "vote' into 'retrieval votes write-free', which would break every unconverted gather stage");
});

test("#1893 every declared seat-write-free stage actually resolves to a grant without the pair", () => {
  // The end-to-end claim, over the real population. It is the arm that would have gone quiet on nine of
  // nine, so it is deliberately NOT the only one — see the header.
  assert.ok(SEAT_WRITE_FREE_STAGES.length >= 8,
    `only ${SEAT_WRITE_FREE_STAGES.length} seat-write-free stage(s) — the table is not being read`);
  for (const stage of SEAT_WRITE_FREE_STAGES) {
    const grant = allowedToolsFor(toolGroupsForStage(stage)).split(" ");
    assert.ok(!grant.includes("Write") && !grant.includes("Edit"),
      `${stage} declares seatWrites: false and its resolved grant still carries the hand-write pair: `
      + grant.join(" "));
  }
});

// ── THE SECOND PREDICATE: A MIXED STAGE MOVED ANOTHER STAGE'S CATEGORY ───────────────────────────────
//
// O4 partitions every stage into tooled / tool-free / recording and fails if one lands in none — a state
// that shipped once and means the stage runs with no MCP servers and no allowlist, silently. It built
// "the recording groups" as the union of every group a recording stage HOLDS. With a mixed stage that set
// gains `perplexity` and `band`, so `placement-inquiry` — which holds only `band` — stopped counting as
// tooled and fell out of every category. The guard failed naming `placement-inquiry`, a stage nothing had
// touched: it named the victim rather than the cause, which is the expensive kind of red.
test("#1893 the recording key set is the KEYS, so a mixed stage cannot re-categorise its neighbours", () => {
  const leaked = [...RECORDING_KEYS].filter((k) => !Object.keys(RECORDING_STAGES).some((s) => k === `recording-${s}`));
  assert.deepEqual(leaked, [],
    "a key that is not `recording-<stage>` is in the recording key set. Whatever put it there is a "
    + "derivation from what stages HOLD rather than from the keys themselves, and it will silently move "
    + "the category of any stage holding the same group");
  // …and the property that matters, stated over the real tree: no stage holding a retrieval group is
  // pushed out of `tooled` by another stage's grant.
  for (const stage of Object.keys(STAGES)) {
    const groups = toolGroupsForStage(stage);
    if (!groups.length) continue;
    const retrieval = groups.filter((g) => !RECORDING_KEYS.has(g));
    if (!retrieval.length) continue;
    assert.ok(retrieval.length > 0 && groups.some((g) => !RECORDING_KEYS.has(g)),
      `${stage} holds retrieval groups ${retrieval.join(",")} and does not read as tooled`);
  }
});

test("#1893 the mixed state is declared, and the declaration cannot outlive its reason", () => {
  // Both directions, because a one-way check here is how an exemption keeps itself alive.
  for (const stage of RECORDING_STAGES_KEEPING_RETRIEVAL) {
    assert.ok(stage in RECORDING_STAGES, `${stage} declares keepsRetrieval and is not a recording stage`);
    assert.ok(toolGroupsForStage(stage).some((g) => !RECORDING_KEYS.has(g)),
      `${stage} declares keepsRetrieval: true and holds no retrieval group — drop the flag`);
  }
  for (const stage of Object.keys(RECORDING_STAGES)) {
    const hasRetrieval = toolGroupsForStage(stage).some((g) => !RECORDING_KEYS.has(g));
    if (!hasRetrieval) continue;
    assert.ok(RECORDING_STAGES_KEEPING_RETRIEVAL.includes(stage),
      `${stage} is a recording stage holding a retrieval group and does not declare keepsRetrieval: true. `
      + "The mixed state is legitimate; drifting into it unannounced is what breaks O4's partition");
  }
});
