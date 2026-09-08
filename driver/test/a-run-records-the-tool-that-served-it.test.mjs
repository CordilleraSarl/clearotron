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
  const stat = () => ({ mtimeMs: 1, size: 1 });
  for (let i = 0; i < 10; i++) probeCliVersion("/bin/thing", { run, cache, stat });
  assert.equal(spawns, 1, "a dispatch is many stages and every one would otherwise pay");
});

// ── THE CACHE MUST NOT OUTLIVE THE BUILD IT DESCRIBES ───────────────────────────────────────────────
//
// The cache lives as long as the process, and the process is not one run: the drainer's watch loop runs
// job after job without exiting. Keyed by path alone, the first version would be reported as fact for
// every later run in that process — including runs served by a binary upgraded in place underneath it.
// That is the silence this field exists to end, reintroduced by the cache meant to make it cheap, and it
// would be invisible: the record would carry a version, confidently, and be wrong.

test("a binary upgraded IN PLACE is probed again — the cache cannot outlive the build", () => {
  const cache = new Map();
  let spawns = 0;
  let st = { mtimeMs: 1000, size: 40 };
  const stat = () => st;
  assert.equal(probeCliVersion("/bin/e", { run: () => (spawns++, "1.0.0"), cache, stat }).version, "1.0.0");
  assert.equal(probeCliVersion("/bin/e", { run: () => (spawns++, "1.0.0"), cache, stat }).version, "1.0.0");
  assert.equal(spawns, 1, "the same build must not be probed twice");

  st = { mtimeMs: 2000, size: 41 };                       // somebody upgraded it under a running drainer
  const after = probeCliVersion("/bin/e", { run: () => (spawns++, "2.0.0"), cache, stat });
  assert.equal(after.version, "2.0.0",
    "the record would have carried 1.0.0 for every run after the upgrade — confidently, and wrong");
  assert.equal(spawns, 2, "a changed build must cost exactly one more spawn, not none and not one per stage");
});

test("a binary the filesystem cannot describe is NOT cached — a failure must not pin itself", () => {
  const cache = new Map();
  const r = probeCliVersion("/bin/gone", {
    run: () => "9.9.9", cache, stat: () => { throw new Error("ENOENT"); },
  });
  assert.equal(r.probe, "ok", "an unstatable path is still probed — stat is for the cache key, not a gate");
  assert.equal(cache.size, 0,
    "caching under a key derived from a failed stat would pin the answer for the life of the process, "
    + "so a binary that appeared a moment later would keep reading as it did before");
});

test("the cache is keyed by the RESOLVED PATH, not the engine id", () => {
  // Two engines can point at one binary, and one engine can be repointed mid-run. Keyed by id, the
  // second case serves a version for a file that is no longer the one being spawned.
  const cache = fresh();
  const seen = [];
  const run = (b) => { seen.push(b); return b === "/bin/a" ? "1.0.0" : "2.0.0"; };
  const stat = () => ({ mtimeMs: 1, size: 1 });          // one build, so only the PATH can separate them
  assert.equal(probeCliVersion("/bin/a", { run, cache, stat }).version, "1.0.0");
  assert.equal(probeCliVersion("/bin/b", { run, cache, stat }).version, "2.0.0");
  assert.equal(probeCliVersion("/bin/a", { run, cache, stat }).version, "1.0.0");
  assert.deepEqual(seen, ["/bin/a", "/bin/b"], "the second read of the first path must not spawn again");
  forgetCliVersions(cache);
  assert.equal(cache.size, 0, "and a deliberate repoint can clear it");
});

// ── AND THAT THE DISPATCH ACTUALLY WRITES IT ─────────────────────────────────────────────────────────

// ── THE CONDITION THE PROBE RESTS ON, RATCHETED ─────────────────────────────────────────────────────
//
// The probe spawns the engine binary, so it depends on `--version` being side-effect-free. That is true
// of every real CLI and cannot be enforced from the probe. It bit on the first run: the stand-ins fell
// through to their stage path, and one counts invocations to decide when to fail, so the probe consumed
// the failure a retry test was measuring. The symptom was an attempt count off by one, three files from
// the cause — which is why this is asserted rather than remembered.
test("every engine stand-in answers --version and exits, like the binary it stands in for", () => {
  for (const mock of ["mock-claude.mjs", "mock-codex.mjs"]) {
    const src = readFileSync(join(ROOT, "driver", "test", mock), "utf8");
    assert.match(src, /argv\.includes\("--version"\)/,
      `${mock} falls through to its stage path on --version: it will block on stdin, log a call, and put `
      + "every attempt count in every arm one out");
    assert.match(src, /process\.exit\(0\)/, `${mock} must EXIT, not continue`);
  }
  // The one test that writes its own stand-in inline needs it too, and forgetting is the same defect.
  const inline = readFileSync(join(ROOT, "driver", "test", "retry-backoff.test.mjs"), "utf8");
  assert.match(inline, /--version/, "the inline stand-in consumes a flake count on the probe without it");
});

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
