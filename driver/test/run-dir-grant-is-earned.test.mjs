// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — THE RUN-DIR READ GRANT IS EARNED BY THE DISPATCH, NOT HANDED TO EVERY SEAT.
//
// `--add-dir runDir` was pushed unconditionally, so report-card — one dispatch per finding, the highest-
// traffic stage in the engine — held Read over findings.json and every other rendered card while its own
// prompt told it "you have NO other finding's data". That sentence described an intention with nothing
// holding it. is the precedent quoted five lines below the grant, and its lesson is that the
// mechanism has to sit at the moment of the action.
//
// PRICED AS PREVENTION, not as a leak: 358 report-card attempts across the delivered corpus, 0 reads of
// another card, of findings.json, or of any named run artifact, against a control of 364 attempts naming
// their own card. Nothing observed. A mechanism still beats an intention.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { runDirGrant, buildClaudeArgs } from "../engine/anthropic-agent.mjs";
import { SEAT_WRITE_FREE_STAGES, seatWritesForGroups } from "../engine/mcp/gather-config.mjs";

const RUN = mkdtempSync(join(tmpdir(), "rdg-run-"));
const SKILLS = mkdtempSync(join(tmpdir(), "rdg-skills-"));
const args = (o) => buildClaudeArgs({ model: "sonnet", skillsDir: SKILLS, skillsGrantRoots: [SKILLS], runDir: RUN, ...o });
const granted = (a) => { const i = a.indexOf(RUN); return i > 0 && a[i - 1] === "--add-dir"; };
// THE BOUNDARY IS DECODED, NOT GREPPED. `writeBoundarySettings` base64-encodes the tree list into the
// deny-hook's command line, so a substring search for the path finds nothing and would pass whatever the
// policy said. This reads the policy the hook will actually enforce.
const boundaryTrees = (a) => {
  const i = a.indexOf("--settings");
  if (i < 0) return [];
  const cmd = JSON.parse(a[i + 1])?.hooks?.PreToolUse?.[0]?.hooks?.[0]?.command ?? "";
  const b64 = (cmd.trim().split(/\s+/).pop() ?? "").replace(/'/g, "");
  try { return JSON.parse(Buffer.from(b64, "base64").toString("utf8")).trees ?? []; } catch { return []; }
};
const boundaryCovers = (a, root) => boundaryTrees(a).some((t) => String(t.path).startsWith(root));

// ── PROOF 1 — red-before-green, in both directions ──────────────────────────────────────────────────

test("#1022 a dispatch that NAMES a path under the run dir KEEPS the grant", () => {
  const { args: a } = args({ message: `Write your output to ${driverDir(RUN, "report-card-3.json")}.`, seatWrites: true });
  assert.ok(granted(a), "a stage told where to write lost the root it writes into");
  assert.ok(boundaryCovers(a, RUN), "the deny-hook boundary stopped covering a root that WAS granted");
});

test("#1022 a dispatch that names NONE drops it — and the boundary drops with it", () => {
  const { args: a } = args({ message: "Render this one card from the record inlined below. Write nothing.", seatWrites: false });
  assert.ok(!granted(a), "the run-dir root is still granted to a seat that names no path and writes nothing");
  // THE HALF THAT MATTERS MOST. The comment at the grant says the boundary is "derived HERE from the same
  // two variables as the grant — one site, so the boundary cannot drift from what was granted". A policy
  // still describing a root nobody handed out is the sibling defect, created by the fix for this one.
  assert.ok(!boundaryCovers(a, RUN),
    "the deny-hook boundary still names the run dir after the grant was dropped — the two have drifted, "
    + "which is precisely what the one-site rule at the grant exists to prevent");
});

test("#1022 the skills roots are untouched in both directions — only the run dir is at stake", () => {
  for (const m of [`out: ${join(RUN, "x.json")}`, "no paths here"]) {
    const { args: a } = args({ message: m, seatWrites: false });
    const i = a.indexOf(SKILLS);
    assert.ok(i > 0 && a[i - 1] === "--add-dir", `the skills tree lost its grant for message: ${m}`);
  }
});

// ── PROOF 2 — the cross-check must be SEEN firing ───────────────────────────────────────────────────

test("#1022/2084 DECLARED write-free and the dispatch ORDERS a write — the loud row fires, grant kept", () => {
  // The ruling's third plant, RE-AIMED by: the old fixture here was a READ hand-over
  // ("See <path> for context.") asserted loud — and measured across the write-free stages that exact
  // shape fired SEVEN times on every healthy run, because handing a path over to read is what the
  // grant exists for and is perfectly consistent with seatWrites:false. The disagreement worth a row
  // is an ORDER TO WRITE under a driver-authors declaration, and that is what fires now.
  const { args: a, grantNote } = args({ message: `Save your findings as JSON to ${driverDir(RUN, "findings.json")}.`, seatWrites: false });
  assert.ok(grantNote, "the declaration and the dispatch disagree and NOTHING was said");
  assert.match(grantNote, /seatWrites:false is ORDERED to write/);
  assert.match(grantNote, /declaration and the prompt disagree/);
  // The dispatch WINS. Dropping a root a prompt is actively pointing at would break the stage to satisfy
  // a stale declaration — the measurement is the operative test precisely so this direction is safe.
  assert.ok(granted(a), "the grant was dropped out from under a dispatch that names the directory");
  assert.ok(boundaryCovers(a, RUN), "boundary and grant disagree");

  // And the 2084 shape that must stay SILENT while keeping the grant: a path handed over to read.
  const read = args({ message: `See ${driverDir(RUN, "findings.json")} for context.`, seatWrites: false });
  assert.equal(read.grantNote ?? null, null,
    "a read hand-over fired the disagreement row — the seven-false-alarms-per-run shape is back");
  assert.ok(granted(read.args), "the read hand-over lost the grant it exists to earn");
});

test("#1022 DECLARED to author a file but the dispatch names nowhere — also loud, also kept", () => {
  const { args: a, grantNote } = args({ message: "Write your findings. (no path)", seatWrites: true });
  assert.ok(grantNote, "a writing stage with no output path in its dispatch passed in silence");
  assert.match(grantNote, /names NO path/);
  assert.ok(granted(a), "a stage declared to author a file lost the root it authors into");
});

test("#1022 agreement is SILENT — the row is a disagreement signal, not a per-turn log line", () => {
  for (const [message, seatWrites] of [[`out ${join(RUN, "a.json")}`, true], ["nothing", false]]) {
    assert.equal(args({ message, seatWrites }).grantNote, null, `agreement produced a row: ${message}`);
  }
});

test("#1022 an UNKNOWN declaration keeps the grant — this can only narrow stages we established", () => {
  // A stage with no recording row declares nothing, and the gateway passes null. Unknown must behave
  // exactly as today, or the change reaches stages nobody measured.
  const { args: a, grantNote } = args({ message: "no paths at all", seatWrites: null });
  assert.ok(granted(a), "a stage with no declaration lost its run-dir root");
  assert.equal(grantNote, null);
});

test("#1022 no run dir at all is not a grant and not a disagreement", () => {
  const r = runDirGrant({ runDir: null, dispatch: "anything", seatWrites: false });
  assert.deepEqual(r, { grant: false, names: false, note: null });
});

// ── PROOF 3 — the population, derived so nobody re-derives ten ──────────────────────────────────────

test("#1022 the seat-write-free population is THIRTEEN, read from the frozen table", () => {
  // A naive grep for `seatWrites: false` returns more hits than the population: some are comment text,
  // one in blind-frame's FIRST OCCUPANT note and one in allowedToolsFor's own paragraph. A fix
  // sized from the grep widens itself by stages that were never in the set — which is why this is
  // enumerated here.
  //
  // — narrative-refutation joins as the ninth, and it is the first member whose grant does NOT
  // consist of its record tool alone: it keeps `perplexity` and `band`, because verifying a record
  // against a live source is what makes it a check. That is why the predicate had to stop reading
  // retrieval groups as writers before this row could be added — until it did, this stage declared
  // `seatWrites: false` here and still resolved to a grant carrying Write and Edit.
  // — synthesis joins as the TENTH, on the same predicate change: it keeps
  // `perplexity`, `band` and `declination`, because the writer still reads live sources to reach a
  // judgment. It is the SECOND mixed member, so `narrative-refutation` above is no longer the sole
  // witness that a retrieval group does not vote on seat writes — a single-member population is exactly
  // what makes a predicate look like a law.
  // Conversion 11 — register-digest joins as the ELEVENTH, and it is the THIRD mixed member: it keeps
  // `band` (judging frozen material is what it reads with) AND `coverage` (a separate typed transport on
  // its own key). Three members now hold retrieval alongside their record tool, so the predicate this
  // pair guards is no longer resting on one or two witnesses — which is the whole reason the note above
  // gives for wanting a second.
  // — knockout-assess joins as the TWELFTH, and it is the first member from
  // OUTSIDE the clearance lane. Its grant is its record tool alone, so it says nothing new about the
  // mixed-grant predicate above; what it adds is that the population is no longer a property of one
  // stage table. A member here whose lane the enumeration cannot reach would be a stage declaring
  // `seatWrites: false` that no arm in this file ever resolves.
  // item C — knockout-frame joins as the THIRTEENTH and closes its lane: both
  // knockout stages now declare it. It is the first member whose ONE call writes TWO artifacts, so
  // "the seat writes nothing here" is a statement about a plan AND a client-facing scope note rather
  // than a single file. That is what makes the declaration load-bearing for it: the note had no
  // validator of its own — the stage's `out` is the plan — so before this conversion a seat could skip
  // the document entirely and pass.
  assert.deepEqual([...SEAT_WRITE_FREE_STAGES], [
    "blind-frame", "doubt-closure", "frame-diff", "knockout-assess", "knockout-frame", "matter-frame",
    "narrative-refutation", "prelim-variants", "register-digest", "report-card", "report-overview",
    "skeptic", "synthesis",
  ]);
});

test("#1022 the declaration the adapter cross-checks is the SAME derivation allowedToolsFor uses", () => {
  // Two readers of "does this seat write" that can disagree is the shape of defect this repo keeps
  // finding, so the predicate is exported and shared rather than copied into the adapter's caller.
  assert.equal(seatWritesForGroups([]), true, "no recording group ⇒ an ordinary authoring stage");
  const src = readFileSync(new URL("../engine/mcp/gather-config.mjs", import.meta.url), "utf8");
  assert.match(src, /const tools = seatWritesForGroups\(groups\)/,
    "allowedToolsFor stopped using the shared predicate — the grant's cross-check and the tool grant can "
    + "now disagree about the same stage");
});
