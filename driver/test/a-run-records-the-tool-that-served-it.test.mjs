// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE VERSION OF THE BINARY THAT SERVED A RUN.
//
// The record already says whether the model id names a pinned build or an alias the provider may
// repoint — "did the model move". Nothing said "did the TOOL move", and the two questions have one
// symptom: a run whose judgment differs from last week's. Three archived runs were walked for every
// spelling of a version field and carried none, so what served them is not recoverable.
//
// THE ARMS BELOW ARE ALMOST ALL ABOUT THE UNREADABLE BRANCH, and that is deliberate. The happy path is
// one spawn and one regex. What the field exists for is telling three states apart — answered, asked and
// could not say, and never asked — and only the middle one is easy to lose.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { parseVersion, probeCliVersion, forgetCliVersions } from "../engine/cli-version.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const fresh = () => new Map();

test("a version is read from whatever shape the binary answers in", () => {
  for (const [out, want] of [
    ["2.1.241", "2.1.241"],
    ["claude 2.1.241 (Claude Code)", "2.1.241"],
    ["codex-cli 0.5.0\n", "0.5.0"],
    ["1.2.3-beta.4", "1.2.3-beta.4"],
    ["  \n  0.9\n", "0.9"],
  ]) assert.equal(parseVersion(out), want, `read wrong from: ${JSON.stringify(out)}`);
});

test("a build that answers in prose is recorded VERBATIM, never dropped", () => {
  // A string somebody can compare between two runs beats a null. The point of the field is comparison,
  // and an unparseable answer still supports it.
  assert.equal(parseVersion("built from source, no version"), "built from source, no version");
  assert.equal(parseVersion(""), null, "…but nothing at all is nothing, not an empty string");
});

// ── THE THREE STATES, WHICH IS THE WHOLE REQUIREMENT ─────────────────────────────────────────────────

test("a binary that answers is recorded as ok", () => {
  const r = probeCliVersion("/bin/thing", { run: () => "2.1.241", cache: fresh() });
  assert.deepEqual(r, { version: "2.1.241", probe: "ok" });
});

test("a binary that CANNOT be run is recorded as unreadable, with the reason", () => {
  const r = probeCliVersion("/bin/gone", {
    run: () => { throw new Error("ENOENT: no such file or directory"); }, cache: fresh(),
  });
  assert.equal(r.probe, "unreadable", "a probe that failed must not look like a probe that never ran");
  assert.equal(r.version, null);
  assert.match(r.why, /ENOENT/, "and the reason travels, or the record cannot be acted on");
});

test("a binary that RUNS and says nothing useful is unreadable too, and says which", () => {
  // Different from failing to run, and a reader chasing a tool change needs to know which happened.
  const r = probeCliVersion("/bin/quiet", { run: () => "", cache: fresh() });
  assert.equal(r.probe, "unreadable");
  assert.match(r.why, /answered with no version-shaped token/);
});

test("no binary at all is unreadable, not a crash and not a silent null", () => {
  const r = probeCliVersion(null, { cache: fresh() });
  assert.equal(r.probe, "unreadable");
  assert.match(r.why, /no engine binary was resolved/);
});

test("the probe NEVER throws — a version is not worth a dispatch", () => {
  // Whatever the spawn does, the caller gets a record back. A probe that could take down a run would be
  // a worse defect than the gap it closes.
  for (const boom of [() => { throw new Error("boom"); }, () => { throw "a string"; }, () => { throw null; }]) {
    const r = probeCliVersion("/bin/x", { run: boom, cache: fresh() });
    assert.equal(r.probe, "unreadable");
    assert.equal(typeof r.why, "string");
  }
});

// ── THE COST NOTE, PINNED ────────────────────────────────────────────────────────────────────────────

test("one spawn per binary, however many stages ask", () => {
  const cache = fresh();
  let spawns = 0;
  const run = () => { spawns++; return "2.1.241"; };
  for (let i = 0; i < 10; i++) probeCliVersion("/bin/thing", { run, cache });
  assert.equal(spawns, 1, "a dispatch is many stages and every one would otherwise pay");
});

test("the cache is keyed by the RESOLVED PATH, not the engine id", () => {
  // Two engines can point at one binary, and one engine can be repointed mid-run. Keyed by id, the
  // second case serves a version for a file that is no longer the one being spawned.
  const cache = fresh();
  const seen = [];
  const run = (b) => { seen.push(b); return b === "/bin/a" ? "1.0.0" : "2.0.0"; };
  assert.equal(probeCliVersion("/bin/a", { run, cache }).version, "1.0.0");
  assert.equal(probeCliVersion("/bin/b", { run, cache }).version, "2.0.0");
  assert.equal(probeCliVersion("/bin/a", { run, cache }).version, "1.0.0");
  assert.deepEqual(seen, ["/bin/a", "/bin/b"], "the second read of the first path must not spawn again");
  forgetCliVersions(cache);
  assert.equal(cache.size, 0, "and a deliberate repoint can clear it");
});

// ── AND THAT THE DISPATCH ACTUALLY WRITES IT ─────────────────────────────────────────────────────────

test("the attempt record carries the version AND its probe state, on both rows", () => {
  // Textual, because the alternative is driving a real dispatch. What it pins is that the probe state
  // travels beside the value: a record with a null version and no probe field cannot be told apart from
  // one written before the gauge existed, which is the distinction the whole field exists for.
  const src = readFileSync(join(ROOT, "driver", "gateway.mjs"), "utf8");
  const rows = [...src.matchAll(/cliVersion: cli\.version, cliVersionProbe: cli\.probe/g)];
  assert.equal(rows.length, 2,
    "both attempt rows must carry it — one carries the row the run record reads, the other the telemetry");
  assert.match(src, /probeCliVersion\(/, "the dispatch does not probe at all");
  assert.match(src, /cliVersionWhy/, "the reason must reach the record, or 'unreadable' names no cause");
});
