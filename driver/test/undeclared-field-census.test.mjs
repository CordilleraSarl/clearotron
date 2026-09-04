// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — THE CENSUS THAT HAS TO COME BEFORE REFUSING AN UNDECLARED FIELD, AND ITS DENOMINATOR.
//
// made the field visible; refusing one is gated on knowing who writes them. The issue's own
// sentence is the whole difficulty: **"A census needs the denominator."** A `grep` for the warning
// returns a numerator over an unknown population, and a zero there is not evidence of absence.
//
// The denominator is the population that CAN exhibit the defect: jobs that did NOT come through an
// assembling door. A door builds the job from its own allow-list, so an undeclared field is gone before
// the manifest is written — and every door stamps `enqueuedVia`. A hand-written `<id>.json` (INTAKE.md)
// goes around all of them and nothing stamps it. So the absence of that stamp is the marker.
//
// These arms are what stop the census reporting a comfortable number. The dangerous failure is not a
// crash — it is a census that prints `0` while silently excluding the only rows that could have been
// non-zero, which reads exactly like "nobody writes undeclared fields".
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CENSUS = join(REPO, "scripts", "undeclared-field-census.mjs");

const DOOR = { id: "a", forwarder: "x", markName: "M", enqueuedVia: "cli/enqueue" };
const HAND = { id: "b", forwarder: "x", markName: "M" };                       // nothing stamped it
const HAND_ODD = { id: "c", forwarder: "x", markName: "M", deliveryRouteX: 1 };  // undeclared, unstamped
const DOOR_ODD = { id: "d", forwarder: "x", markName: "M", enqueuedVia: "mcp/start_run", weirdField: 1 };

function census(files) {
  const q = mkdtempSync(join(tmpdir(), "census-q-"));
  try {
    for (const [name, body] of Object.entries(files))
      writeFileSync(join(q, name), typeof body === "string" ? body : JSON.stringify(body));
    const r = spawnSync("node", [CENSUS, "--queue", q, "--json"], { encoding: "utf8" });
    assert.equal(r.status, 0, `census refused the fixture:\n${r.stderr}`);
    return JSON.parse(r.stdout);
  } finally { rmSync(q, { recursive: true, force: true }); }
}

test("the denominator is the UNSTAMPED route, and door-stamped jobs are excluded with their reason", () => {
  const c = census({ "a.done": DOOR, "b.done": HAND, "c.failed": HAND_ODD });
  assert.equal(c.manifests, 3);
  assert.equal(c.byRoute["(unstamped)"].jobs, 2, "both unstamped manifests are the denominator");
  assert.equal(c.byRoute["(unstamped)"].withUndeclared, 1);
  assert.equal(c.byRoute["cli/enqueue"].jobs, 1, "the door-stamped job is counted, and separately");
});

test("a sidecar is not a job, and an unfamiliar extension is counted rather than dropped", () => {
  // The skip list is an ALLOW-LIST of known sidecars. A census that skips what it does not recognise
  // shrinks its own denominator invisibly, which is the failure mode this whole file is about.
  const c = census({ "a.done": DOOR, "a.done.result": "{}", "a.reason": "x", "a.pid": "1",
    "e.some-new-state": HAND });
  assert.equal(c.manifests, 2, "two jobs: the door one and the unfamiliar-extension one");
  assert.equal(c.byRoute["(unstamped)"].jobs, 1, "an extension nobody listed must still reach the denominator");
});

test("an unparseable manifest is counted, never skipped", () => {
  // A hand-written file with broken JSON is exactly the intake route being sized. Dropping it biases the
  // count in the direction that makes the problem look smaller.
  const c = census({ "a.done": DOOR, "b.done": "{ not json" });
  assert.equal(c.manifests, 2, "the broken file is a manifest that existed");
  assert.equal(c.unreadable, 1, "and it is reported as unreadable rather than silently absent");
});

test("a zero denominator is reported AS a zero denominator, not as a clean census", () => {
  // The finding this produced on the test box: 149 manifests, every one door-stamped, so the corpus
  // cannot answer the question either way. A census that printed "0 undeclared fields" there would be
  // true and completely misleading.
  const c = census({ "a.done": DOOR, "d.done": DOOR_ODD });
  assert.equal((c.byRoute["(unstamped)"]?.jobs ?? 0), 0, "no hand-written manifest in this corpus");
  const r = spawnSync("node", [CENSUS, "--queue", "/nonexistent-queue-path"], { encoding: "utf8" });
  assert.equal(r.status, 2, "an unreadable queue is an error, never an empty census");
});

test("a door-stamped job carrying an undeclared field is still NAMED — #1085's property is kept", () => {
  // Excluding door-stamped jobs from the RATE must not mean hiding them. If an assembler ever stops
  // dropping the field, this is the row that says so.
  const c = census({ "d.done": DOOR_ODD });
  assert.equal(c.byRoute["mcp/start_run"].withUndeclared, 1);
  assert.equal(c.fieldCounts.weirdField, 1, "the field NAME is reported wherever it was seen");
});
