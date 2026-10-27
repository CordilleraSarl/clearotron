// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE WRITER IS TOLD PLACEMENT'S SET-ASIDES, OR ITS MESSAGE IS REFUSED — NEVER TOLD THERE ARE NONE.
//
// The reading step and the writer are told what placement set aside, read from placement's form. Every failure to
// read it used to come back as an empty list. The experiment sandbox held no form, so a writer replayed offline was
// told of no set-aside at all on a beta.3 test run whose placement had set 173 records aside by name and five
// groups by row. The sandbox now carries the form and what it is judged against, and where this run's placement
// records a form, a missing or unreadable one is refused by name, in the sandbox and in a run alike. A run from
// before the form had none, and is told so truthfully. Every mark and owner below is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";
import { paths } from "../stages.mjs";
import { standingPlacementDecisions } from "../placement-decisions.mjs";
import { messageCtxFor } from "../pipeline.mjs";
import { sandboxManifest } from "../stage-context.mjs";

function run(t, { stamped }) {
  const dir = mkdtempSync(join(tmpdir(), "set-asides-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(driverDir(dir), { recursive: true });
  writeFileSync(join(dir, "placements.json"), JSON.stringify({ schema_version: 1, placements: [
    { mark: "QZORVAN", owner: "Ardent Ltd", jurisdiction: "EU", tier: "headline-candidate", records: ["/mark/eu/h1"], reason: "identical, live" }] }) + "\n");
  if (stamped) writeFileSync(driverDir(dir, "stage-contracts.json"), JSON.stringify({ "placement-inquiry": { placementForm: 1 } }) + "\n");
  return paths(dir);
}

test("a run whose placement records a form, with the form missing, is refused by name, not read as none set aside", (t) => {
  const P = run(t, { stamped: true });
  assert.throws(() => standingPlacementDecisions(P), /^Error: placement_form_missing: .*refusing to read its absence as "none set aside"/);
});

test("an unreadable form is refused too", (t) => {
  const P = run(t, { stamped: true });
  writeFileSync(driverDir(P.runDir, "placement-form.form.json"), "{ torn");
  assert.throws(() => standingPlacementDecisions(P), /placement_form_(unreadable|missing)|placement_decisions_unreadable/);
});

test("THE CONTROL: a run from before the form, which had none, is told of no set-aside truthfully", (t) => {
  const P = run(t, { stamped: false });
  assert.deepEqual(standingPlacementDecisions(P), []);
});

test("the writer's and the reading step's messages are refused on a missing form, in a run as in the sandbox", (t) => {
  const P = run(t, { stamped: true });
  const ctx = { paths: P, run: null };
  for (const stage of ["synthesis", "register-digest"])
    assert.throws(() => messageCtxFor(stage, ctx), /placement_form_missing/, `${stage}'s message was built with no set-asides`);
});

test("the sandbox of the writer and the reading step carries placement's form and what it is judged against", () => {
  const P = paths("/run");
  for (const stage of ["synthesis", "register-digest"]) {
    const held = new Set(sandboxManifest(stage, P).map((e) => e.path));
    for (const f of ["placement-form.form.json", "stage-contracts.json", "band-shape.json", "register-positions.json", "instructed-scope.json", "reading-log.jsonl", "goods-evidence.json"])
      assert.ok(held.has(driverDir("/run", f)), `${stage}'s sandbox does not carry _driver/${f}`);
    assert.ok(held.has(P.placementModel), `${stage}'s sandbox does not carry placements.json`);
  }
});
