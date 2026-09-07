// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// — `project add`, and the failure that is not about the project.
//
// ── WHY THE TREE, NOT THE PROJECT ─────────────────────────────────────────────────────────────────
//
// `loadProjects` throws from inside its loop over customer directories. A project naming a brand owner
// the roster does not have, an unparseable file, or one that fails the shape check does not fail THAT
// project — it aborts the whole tree, so every other engagement on the deployment stops resolving too,
// at the next process start. So the refusals here are not politeness: writing first and validating later
// would take the deployment down with one typo.
//
// ── DRIVEN AS THE COMMAND FROM THE START ──────────────────────────────────────────────────────────
//
// shipped twenty arms that covered every part of its verb and never called it, so the
// order its refusals fire in, its output sentences and its receipt were unasserted until five more arms
// were added. These drive `add()` from the first line: the ordering IS the property — nothing may reach
// disk before the tree has agreed to accept it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { add, parseArgs, buildOverlay, assertOverlayable } from "../../bin/project.mjs";
import { Refusal } from "../../shared/onboarding-store.mjs";
import { loadProfiles, loadProjects, PROJECT_KEYS } from "../profiles.mjs";

const tmp = () => mkdtempSync(join(tmpdir(), "project-add-"));

/** A real customers store. The loader requires `generic` by name, so every fixture has one. */
function store(owners = { northwind: { name: "Northwind Trading SA", platforms: ["amazon.com"] } }) {
  const dir = tmp();
  writeFileSync(join(dir, "generic.json"), JSON.stringify({ name: "House default", platforms: ["amazon.com"] }));
  for (const [k, p] of Object.entries(owners)) writeFileSync(join(dir, `${k}.json`), JSON.stringify(p));
  return dir;
}
const overlayOn = (dir) => ({ situation: "overlay", inForce: dir, store: dir, configured: dir });
const run = (dir, argv, said = []) =>
  add(argv, { resolution: overlayOn(dir), loadProfiles, loadProjects, out: (l) => said.push(l) });

// `assert.throws` returns UNDEFINED, so `const e = assert.throws(...)` reads `.message` off nothing.
// The `assert.fail` below is unreachable while the command is correct — which the coverage census is
// right to call indistinguishable from an arm that stopped asserting, so it is DRIVEN by its own arm.
async function refusalFrom(fn) {
  try { await fn(); } catch (e) {
    assert.ok(e instanceof Refusal, `expected a Refusal, got ${e?.name}: ${e?.message}`);
    return e;
  }
  assert.fail("expected a Refusal, nothing was thrown");
}

test("1911 the refusal helper fails when nothing throws — its own guard rail, driven", async () => {
  await assert.rejects(() => refusalFrom(async () => {}), /nothing was thrown/);
});

// ── THE TREE REFUSES BEFORE ANYTHING REACHES DISK ─────────────────────────────────────────────────

test("1911 A PROJECT UNDER AN UNKNOWN BRAND OWNER IS REFUSED, and says it would stop the whole tree", async () => {
  const dir = store();
  const e = await refusalFrom(() => run(dir, ["nosuchowner", "japan-launch", "--platforms", "amazon.co.jp"]));
  assert.match(e.message, /no brand owner "nosuchowner"/, "names the owner that is missing");
  assert.match(e.message, /WHOLE project tree/, "and the blast radius — this is why it refuses before writing");
  assert.match(e.message, /brandowner add nosuchowner/, "and the command that fixes it");
  assert.equal(existsSync(join(dir, "projects", "nosuchowner")), false, "and nothing was created on the way");
});

test("1911 an overlay the loader would reject is refused, in the loader's own words", async () => {
  const dir = store();
  // `defaultProduct` is a project field, and a value outside the offering hard-fails at load. Borrowed
  // rather than restated: whatever the tree refuses must be refused here, in the same words.
  const e = await refusalFrom(() => run(dir, ["northwind", "japan-launch", "--product", "not-a-real-product"]));
  assert.match(e.message, /not valid/);
  assert.match(e.message, /not-a-real-product/, "the offending value, from the validator that owns the rule");
  assert.equal(existsSync(join(dir, "projects", "northwind", "japan-launch.json")), false);
});

test("1911 a project that already exists is refused — this command creates, it never overwrites", async () => {
  const dir = store();
  await run(dir, ["northwind", "japan-launch", "--platforms", "amazon.co.jp"]);
  const e = await refusalFrom(() => run(dir, ["northwind", "japan-launch", "--platforms", "amazon.com"]));
  assert.match(e.message, /already exists/);
  // AND THE FIRST ONE IS UNTOUCHED. A refusal that half-wrote would be worse than an overwrite.
  const onDisk = JSON.parse(readFileSync(join(dir, "projects", "northwind", "japan-launch.json"), "utf8"));
  assert.deepEqual(onDisk.platforms, ["amazon.co.jp"], "the existing project still says what it said");
});

// ── THE FIELD SET IS THE CONTRACT ─────────────────────────────────────────────────────────────────

test("1911 a CUSTOMER-ONLY key is refused BY NAME, not as a typo", async () => {
  // The generic deny-unknown message would send the reader hunting for a misspelling in a key they
  // spelled correctly. These keys are not misspelled; they are not overlayable, and that is a different
  // sentence.
  const e = await refusalFrom(async () => assertOverlayable({ frameworkPath: "skills/prelim-search/x.md" }));
  assert.match(e.message, /belongs to the brand owner/);
  assert.match(e.message, /never who it is or what rates its matters/,
    "the reason, because rating authority not being overlayable is the point rather than a rule");
  for (const k of PROJECT_KEYS) assert.ok(e.message.includes(k), `the refusal lists what IS settable (${k})`);
});

test("1911 a key that is neither project nor customer is refused as the typo it is", async () => {
  const e = await refusalFrom(async () => assertOverlayable({ platfroms: ["amazon.com"] }));
  assert.match(e.message, /not a project field/);
  assert.doesNotMatch(e.message, /belongs to the brand owner/, "a typo is not a governance refusal");
});

test("1911 projectName is META and passes the field gate — the loader lifts it out before the field set", () => {
  assert.doesNotThrow(() => assertOverlayable({ projectName: "Japan launch", platforms: ["amazon.co.jp"] }));
});

test("1911 a project that sets NOTHING is refused — it would change nothing about how the engagement searches", async () => {
  const dir = store();
  const e = await refusalFrom(() => run(dir, ["northwind", "empty-project"]));
  assert.match(e.message, /sets nothing/);
  assert.equal(existsSync(join(dir, "projects", "northwind", "empty-project.json")), false);
});

// ── WHAT IT WRITES, AND WHAT IT TELLS THE OPERATOR ────────────────────────────────────────────────

test("1911 a real add writes a SPARSE overlay and names what the project inherits", async () => {
  const dir = store();
  const said = [];
  const r = await run(dir, ["northwind", "japan-launch", "--platforms", "amazon.co.jp", "--jurisdictions", "jp,kr"], said);
  assert.equal(r.written, true);
  const onDisk = JSON.parse(readFileSync(join(dir, "projects", "northwind", "japan-launch.json"), "utf8"));
  assert.deepEqual(onDisk, { platforms: ["amazon.co.jp"], defaultJurisdictions: ["JP", "KR"] },
    "SPARSE: a field the operator did not name is one the project inherits, and must not be written");
  assert.ok(said.some((l) => /inherits from northwind/.test(l)),
    "an overlay is defined as much by what it does not set — the operator is told which those are");
  assert.ok(said.some((l) => /doctor will now list northwind\/japan-launch/.test(l)),
    "and how to confirm it, which doctor can now actually answer");
});

test("1911 --dry-run writes nothing and still answers the question the operator has", async () => {
  const dir = store();
  const said = [];
  const r = await run(dir, ["northwind", "japan-launch", "--platforms", "amazon.co.jp", "--dry-run"], said);
  assert.equal(r.written, false);
  assert.equal(existsSync(join(dir, "projects", "northwind", "japan-launch.json")), false);
  assert.ok(said.some((l) => /nothing was written/.test(l)));
  assert.ok(said.some((l) => /inherits from northwind/.test(l)), "the inheritance line is the point of a dry run");
});

test("1911 the project the command wrote is one the loader accepts", async () => {
  // THE ROUND TRIP, and the only arm that proves the write and the reader agree. Everything above
  // asserts against the validator; this reads the tree back through the loader the deployment uses.
  const dir = store();
  await run(dir, ["northwind", "japan-launch", "--platforms", "amazon.co.jp", "--name", "Japan launch"]);
  const roster = loadProfiles({ dir, force: true });
  const projects = loadProjects({ dir, profiles: roster, force: true });
  const p = projects.get("northwind/japan-launch");
  assert.ok(p, "the loader found it");
  assert.equal(p.customerKey, "northwind");
  assert.equal(p.projectName, "Japan launch");
  assert.deepEqual(p.platforms, ["amazon.co.jp"]);
});

// ── THE PARSER ────────────────────────────────────────────────────────────────────────────────────

test("1911 an unknown option is refused rather than ignored", async () => {
  const e = await refusalFrom(async () => parseArgs(["northwind", "japan-launch", "--platfroms", "amazon.com"]));
  assert.match(e.message, /--platfroms/, "names what was typed");
  assert.match(e.message, /--platforms/, "and what exists");
});

test("1911 lists are split and normalised the way the validators expect them", () => {
  const a = parseArgs(["c", "p", "--platforms", " Amazon.COM , gnc.com ", "--jurisdictions", "jp, kr"]);
  assert.deepEqual(a.platforms, ["amazon.com", "gnc.com"], "platforms are hostnames — lower-cased");
  assert.deepEqual(a.jurisdictions, ["JP", "KR"], "jurisdictions are codes — upper-cased");
  assert.deepEqual(buildOverlay(a).defaultJurisdictions, ["JP", "KR"]);
});
