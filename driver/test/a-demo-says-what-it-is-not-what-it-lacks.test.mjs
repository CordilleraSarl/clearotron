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
import { loadProfiles } from "../profiles.mjs";

const poolWith = (n) => {
  const pool = mkdtempSync(join(tmpdir(), "demo-pool-"));
  for (let i = 0; i < n; i += 1) {
    mkdirSync(join(pool, `run-${i}`), { recursive: true });
    writeFileSync(join(pool, `run-${i}`, "meta.json"), JSON.stringify({ runId: `run-${i}` }));
  }
  return pool;
};

test("arm 1 — outside a demo there is no line, so the warning stands unchanged", () => {
  assert.equal(demoPostureLine({}), null);
  assert.equal(demoPostureLine({ CLEAROTRON_REPORTS_DIR: poolWith(4) }), null,
    "a real deployment with reports in its pool is being told it is a demo");
  assert.equal(isDemo({}), false);
});

test("arm 2 — the literal 1, and nothing else, is a demo", () => {
  // A real deployment greeting its operator with the demo sentence would suppress the one warning that
  // says a page may show synthetic data as a customer's own. The safe answer is the one everything but
  // the literal reaches.
  for (const v of ["1"]) assert.equal(isDemo({ CLEAROTRON_DEMO: v }), true, `${v} should be a demo`);
  for (const v of [1, true, "true", "yes", "0", "", " 1", "1 ", undefined, null])
    assert.equal(isDemo({ CLEAROTRON_DEMO: v }), false, `${JSON.stringify(v)} was read as a demo`);
});

test("arm 3 — the report count is READ, and an unreadable pool is not zero", () => {
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
  //
  // READ OFF THE DEMO'S OWN ROSTER, which is the bundled demo account and Generic — not the suite's,
  // which carries the test fixtures too. And "generic default" must NOT appear: the demo account rates
  // under a framework of its own, and the constant this line replaced said it did not.
  const demoRoster = loadProfiles({ dir: null, force: true, includeDemo: true, includeTestFixtures: false });
  const line = demoPostureLine({ CLEAROTRON_DEMO: "1", CLEAROTRON_REPORTS_DIR: poolWith(4) }, { roster: demoRoster });
  assert.match(line, /Demo Brand Owner, rating under its own framework, with 1 project,/);
  assert.doesNotMatch(line, /generic default/, "the demo account is said to rate under the house framework, which it does not");
  assert.doesNotMatch(line, /example customers|five/i, "the withdrawn wording is back");
  // And it names no variable and no config store at a reader who has never heard of either.
  assert.doesNotMatch(line, /CLEAROTRON_[A-Z_]+|PROFILE_REPO_ROOT|config store/,
    "the demo line names our plumbing at a first-time visitor");
});

// ── THE LINE IS A READ OF THE ROSTER, NEVER A CONSTANT ────────────────────────────────────────────
//
// 0.3.0-beta.1's demo took a real install's settings, served that install's roster, and still announced
// Demo Brand Owner, because the sentence was a literal. Each arm below plants a DIFFERENT roster and
// requires the sentence to follow it.
test("arm 5 — the line names what the roster holds, and nothing it does not", () => {
  const env = { CLEAROTRON_DEMO: "1", CLEAROTRON_REPORTS_DIR: poolWith(1) };
  const rosterOf = (...companies) => new Map([{ key: "generic", name: "Generic default" }, ...companies].map((p) => [p.key, p]));
  const none = new Map();

  const planted = demoPostureLine(env, { roster: rosterOf({ key: "planted-co", name: "Planted Company", demoData: true }), projects: none });
  assert.match(planted, /it carries Planted Company, rating under the generic default framework, and 1 finished/);
  assert.doesNotMatch(planted, /Demo Brand Owner/, "the line names a company the roster does not hold");

  // Its framework and its projects are read as well, and another company's projects are not counted.
  const own = demoPostureLine(env, {
    roster: rosterOf({ key: "planted-co", name: "Planted Company", frameworkPath: "skills/x.md", demoData: true }),
    projects: new Map([["planted-co/a", {}], ["planted-co/b", {}], ["someone-else/c", {}]]) });
  assert.match(own, /Planted Company, rating under its own framework, with 2 projects,/);

  // THE 0.3.0-beta.1 SHAPE: a roster holding no demo company. The line says so rather than naming one.
  const bare = demoPostureLine(env, { roster: rosterOf(), projects: none });
  assert.match(bare, /its roster holds no company but the generic default/);
  assert.doesNotMatch(bare, /Demo Brand Owner|Nothing here is configured/);

  // THE CLOSING SENTENCE IS EARNED: one company not marked demo data, and it is not said.
  const mixed = demoPostureLine(env, {
    roster: rosterOf({ key: "planted-co", name: "Planted Company", demoData: true }, { key: "acme", name: "Acme" }), projects: none });
  assert.match(mixed, /it carries Acme, rating under the generic default framework; and Planted Company,/);
  assert.doesNotMatch(mixed, /Nothing here is configured against a real customer/,
    "a company that is not marked demo data was vouched for as not a real customer");
  const vouched = demoPostureLine(env, { roster: rosterOf({ key: "planted-co", name: "Planted Company", demoData: true }), projects: none });
  assert.match(vouched, /Nothing here is configured against a real customer/, "anti-vacuity: the sentence exists to be withheld");

  // AN UNREADABLE ROSTER IS NOT AN EMPTY ONE, for the reason an unreadable pool is not zero.
  const unreadable = demoPostureLine(env, { roster: { values() { throw new Error("EACCES"); } } });
  assert.match(unreadable, /its roster could not be read/);
  assert.doesNotMatch(unreadable, /holds no company/, "a roster nobody could read is reported as empty");
});

test("arm 4 — both processes answer from ONE composer, in different processes", () => {
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
