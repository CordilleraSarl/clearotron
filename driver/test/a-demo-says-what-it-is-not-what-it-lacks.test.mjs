// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// ── — TWO WARNINGS AIMED AT THE WRONG READER ────────────────────────────────
//
// `clearotron demo` printed two lines written for an operator of a real deployment, at a visitor who is
// neither: one about the customer roster, one about the risk-framework overlay. Both are correct about a
// real install, both are meaningless in a demo, and this output is what gets captured for the website.
//
// NEITHER IS SILENCED. Both are load-bearing on a real deployment — the second says a page may show
// synthetic data as though it were a customer's own, which is exactly the class of thing that must stay
// loud. The defect is the audience, not the content.
//
// THE COUNT IS DERIVED, and that is the half the ruling could not state. It describes the demo as
// carrying "four completed clearance reports"; it carries one today, and a sentence that says four while
// showing one would be read aloud on the capture. So the number comes off the pool the demo is actually
// serving: true at one, true at four, and it cannot drift from what the visitor can open.
//
// BREAK MATRIX:
//   · outside a demo, both warnings are unchanged      → break: return a line always, arm 1 red
//   · the literal `1`, never a truthy value            → break: coerce, arm 2 red
//   · the count is read off the pool                   → break: hardcode four, arm 3 red
//   · an unreadable pool is not "no reports"           → break: default to 0, arm 3 red
//   · both processes answer from ONE composer          → break: a second copy, arm 4 red
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { isDemo, demoReportCount, demoPostureLine } from "../demo-posture.mjs";

const poolWith = (n) => {
  const pool = mkdtempSync(join(tmpdir(), "demo-pool-"));
  for (let i = 0; i < n; i += 1) {
    mkdirSync(join(pool, `run-${i}`), { recursive: true });
    writeFileSync(join(pool, `run-${i}`, "meta.json"), JSON.stringify({ runId: `run-${i}` }));
  }
  return pool;
};

test("2106 arm 1 — outside a demo there is no line, so the warning stands unchanged", () => {
  assert.equal(demoPostureLine({}), null);
  assert.equal(demoPostureLine({ CLEAROTRON_REPORTS_DIR: poolWith(4) }), null,
    "a real deployment with reports in its pool is being told it is a demo");
  assert.equal(isDemo({}), false);
});

test("2106 arm 2 — the literal 1, and nothing else, is a demo", () => {
  // A real deployment greeting its operator with the demo sentence would suppress the one warning that
  // says a page may show synthetic data as a customer's own. The safe answer is the one everything but
  // the literal reaches.
  for (const v of ["1"]) assert.equal(isDemo({ CLEAROTRON_DEMO: v }), true, `${v} should be a demo`);
  for (const v of [1, true, "true", "yes", "0", "", " 1", "1 ", undefined, null])
    assert.equal(isDemo({ CLEAROTRON_DEMO: v }), false, `${JSON.stringify(v)} was read as a demo`);
});

test("2106 arm 3 — the report count is READ, and an unreadable pool is not zero", () => {
  for (const n of [1, 2, 4, 7]) {
    assert.equal(demoReportCount({ CLEAROTRON_REPORTS_DIR: poolWith(n) }), n);
  }
  // THE SENTENCE MOVES WITH IT, singular and plural, because the ruled wording is read aloud.
  assert.match(demoPostureLine({ CLEAROTRON_DEMO: "1", CLEAROTRON_REPORTS_DIR: poolWith(1) }),
    /1 finished clearance report ready/, "one report is announced in the plural");
  assert.match(demoPostureLine({ CLEAROTRON_DEMO: "1", CLEAROTRON_REPORTS_DIR: poolWith(4) }),
    /4 finished clearance reports ready/, "the count is not read off the pool — it is stated");

  // AN ABSENCE IS A FINDING. A pool that cannot be read is not a pool with nothing in it, and a line
  // saying "0 finished clearance reports" about a directory nobody could open is wrong in the one
  // direction that matters on a first impression.
  assert.equal(demoReportCount({}), null);
  assert.equal(demoReportCount({ CLEAROTRON_REPORTS_DIR: join(tmpdir(), "no-such-pool-2106") }), null);
  const blind = demoPostureLine({ CLEAROTRON_DEMO: "1" });
  assert.doesNotMatch(blind, /\b0 finished|\bno finished/, "an unreadable pool is being reported as empty");
  assert.match(blind, /its finished clearance reports/, "and it says nothing about them at all");

  // THE RULED SHAPE, in the words the ruling sets: Demo Brand Owner, the generic default framework, its
  // project. The withdrawn line — "five example customers and example risk frameworks" — describes the
  // retired shape and must never appear.
  const line = demoPostureLine({ CLEAROTRON_DEMO: "1", CLEAROTRON_REPORTS_DIR: poolWith(4) });
  assert.match(line, /Demo Brand Owner/);
  assert.match(line, /generic default/);
  assert.match(line, /demo project/);
  assert.doesNotMatch(line, /example customers|five/i, "the withdrawn wording is back");
  // And it names no variable and no config store at a reader who has never heard of either.
  assert.doesNotMatch(line, /CLEAROTRON_[A-Z_]+|PROFILE_REPO_ROOT|config store/,
    "the demo line names our plumbing at a first-time visitor");
});

test("2106 arm 4 — both processes answer from ONE composer, in different processes", () => {
  // The catch that made this a module rather than a boolean: the roster warning is the MCP door's and
  // the overlay warning is the portal service's. "Decide once, where the message is composed" needed the
  // fact plumbed into a second process before either sentence could be written.
  const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
  for (const [name, rel] of [["the MCP door", "../../mcp-server/http-server.mjs"],
    ["the portal service", "../portal-service.mjs"]]) {
    const src = read(rel);
    assert.match(src, /demoPostureLine\(/, `${name} composes its own answer instead of asking the one composer`);
    assert.match(src, /demo-posture\.mjs/, `${name} does not import the composer`);
  }
  // AND THE WARNINGS SURVIVE for the reader they were written for. An arm that only checked the demo
  // branch would pass on a tree that deleted them.
  assert.match(read("../../mcp-server/http-server.mjs"), /Every real customer will be refused/,
    "the roster warning was silenced rather than re-aimed");
  assert.match(read("../portal-service.mjs"), /SYNTHETIC framework as though it were the customer's own/,
    "the overlay warning was silenced rather than re-aimed — it is the one that must stay loud");

  // ONE NAME. `PORTAL_DEMO` is retired, not joined: two names for one fact is how two subsystems come to
  // disagree about it, and the old one was already wrong for a process that is not the portal.
  //
  // CODE ONLY. The first shape of this arm read the whole file and failed on the comments that RECORD
  // the retirement — a guard that forbids naming the thing you retired makes the retirement unexplainable
  // to the next reader, which is the opposite of what it is for.
  const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n").map((l) => l.replace(/(^|[^:])\/\/.*$/, "$1")).join("\n");
  for (const rel of ["../portal-service.mjs", "../../bin/start.mjs", "../../scripts/env-classify.mjs"]) {
    assert.doesNotMatch(code(read(rel)), /PORTAL_DEMO/, `${rel} still reads or writes the retired name`);
  }
  // Anti-vacuity: the stripper must not be eating the file. The live name is in the same sources.
  assert.match(code(read("../../bin/start.mjs")), /CLEAROTRON_DEMO/,
    "the comment stripper removed the code too — this arm is passing over nothing");
});
