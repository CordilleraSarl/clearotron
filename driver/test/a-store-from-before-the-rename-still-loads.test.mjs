// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// a-store-from-before-the-rename-still-loads.test.mjs — every name the identifier rename moved that an
// install has already written to disk is read in both spellings, the old one as the new.
//
// THE DEFECT. The internal identifier `prelim` became `clearance`, and the code began asking only for the new
// spelling of names that live OUTSIDE the product: a configuration store's `skills/prelim-search/…` profile
// paths and doctrine folders, the `studio/prelim-search` directory every archived run and queued job sits
// under, the run-locks directory, the flag snapshot, and the session-key prefix a run's fetched records are
// filed by. Nothing migrates any of those. Measured on the test instance: one profile naming the old folder
// refused the whole company list, the portal then offered `generic` alone with no error, and the assistant
// listed 0 past runs where it had listed 50.
//
// No store or workspace is edited by any arm here: each one builds the state an install has TODAY and asks
// the code to read it.
//
// Run:  node --test driver/test/a-store-from-before-the-rename-still-loads.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { pinEnv } from "../../shared/env-aliases.mjs";

import { STUDIO_SEGMENTS, studioSegmentFor, runPrefixSpellings } from "../../shared/pre-rename-spellings.mjs";
import { config, skillSpellings } from "../driver.config.mjs";
import { collectRecordBodies } from "../registry-fidelity.mjs";
import { readFlagSnapshot } from "../flag-snapshot.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const GENERIC = JSON.parse(readFileSync(join(ROOT, "driver", "profiles", "generic.json"), "utf8"));

/** A configuration store as an install holds it before the rename: old folder names throughout. */
function oldStore({ brokenGeneric = false } = {}) {
  const store = mkdtempSync(join(tmpdir(), "pre-rename-store-"));
  mkdirSync(join(store, "profiles"), { recursive: true });
  mkdirSync(join(store, "skills", "prelim-search"), { recursive: true });
  writeFileSync(join(store, "profiles", "generic.json"), JSON.stringify(brokenGeneric ? { ...GENERIC, platforms: [] } : GENERIC));
  writeFileSync(join(store, "profiles", "invented.json"), JSON.stringify({
    ...GENERIC, name: "Invented Company", matchDomains: ["invented.example"],
    frameworkPath: "skills/prelim-search/risk-framework-invented.md",
  }));
  // A second company whose file is wrong for a reason that has nothing to do with the rename.
  writeFileSync(join(store, "profiles", "broken.json"), JSON.stringify({
    ...GENERIC, name: "Broken Company", matchDomains: ["broken.example"], frameworkPath: "elsewhere/x.md",
  }));
  writeFileSync(join(store, "skills", "prelim-search", "risk-framework-invented.md"), "# The company's own framework\n");
  return store;
}

/** Run `body` against a store in a CHILD: the loader captures the store directory at import. */
function inStore(store, body) {
  const src = `Promise.all([import("../../driver/profiles.mjs"), import("../../driver/driver.config.mjs")]).then(([m, c]) => {`
    + `const out = {}; try { ${body} } catch (e) { out.error = e.message; out.code = e.code ?? null; }`
    + `console.log(JSON.stringify(out)); });`;
  const env = { ...process.env };
  pinEnv(env, "CLEAROTRON_CUSTOMERS_DIR", join(store, "profiles"));
  pinEnv(env, "CLEAROTRON_INSTRUCTIONS_DIR", join(store, "skills"));
  const r = spawnSync(process.execPath, ["--input-type=module", "-e", src], { cwd: join(ROOT, "driver", "test"), env, encoding: "utf8" });
  const line = `${r.stdout ?? ""}`.trim().split("\n").filter(Boolean).pop() ?? "";
  try { return JSON.parse(line); } catch { return { error: `unparseable: ${line} ${r.stderr ?? ""}` }; }
}

test("a profile naming the old folder loads, and the company list survives one unreadable company", () => {
  const store = oldStore();
  try {
    const r = inStore(store, `const p = m.loadProfiles({ force: true }); out.keys = [...p.keys()].sort();
      out.unreadable = m.unreadableProfiles(p).map((u) => u.key);`);
    assert.equal(r.error, undefined, r.error);
    assert.deepEqual(r.keys, ["generic", "invented"], "the old-spelling profile loads; the broken one is left out");
    assert.deepEqual(r.unreadable, ["broken"], "and it is named, not dropped in silence");
  } finally { rmSync(store, { recursive: true, force: true }); }
});

test("asking for the unreadable company refuses with its reason; an unkeyed job does not fall to generic", () => {
  const store = oldStore();
  try {
    const byKey = inStore(store, `m.resolveProfile({ profileKey: "broken" }, { profiles: m.loadProfiles({ force: true }) });`);
    assert.equal(byKey.code, "profile_unreadable");
    assert.match(byKey.error, /frameworkPath/, "the file's own reason travels with the refusal");
    const unkeyed = inStore(store, `m.resolveProfile({ forwarderDomain: "somewhere.example" }, { profiles: m.loadProfiles({ force: true }) });`);
    assert.equal(unkeyed.code, "profile_roster_incomplete", "the unread company's domains are unknown, so generic would be a guess");
    const healthy = inStore(store, `out.key = m.resolveProfile({ profileKey: "invented" }, { profiles: m.loadProfiles({ force: true }) }).key;`);
    assert.equal(healthy.key, "invented", "a healthy company is unaffected");
  } finally { rmSync(store, { recursive: true, force: true }); }
});

test("a store's own generic profile is never tolerated as unreadable", () => {
  const store = oldStore({ brokenGeneric: true });
  try {
    const r = inStore(store, `m.loadProfiles({ force: true });`);
    assert.match(r.error ?? "", /generic\.json/, "replacing the deployment's fallback with ours would re-rate every unprofiled job");
  } finally { rmSync(store, { recursive: true, force: true }); }
});

test("a skill path resolves in either spelling, the store first and the product under the name it ships", () => {
  const store = oldStore();
  try {
    const r = inStore(store, `
      out.oldName = c.config.resolveSkillPath("skills/prelim-search/risk-framework-invented.md");
      out.newName = c.config.resolveSkillPath("skills/clearance-search/risk-framework-invented.md");
      out.shipped = c.config.resolveSkillPath("skills/prelim-search/synthesis-rules.md");`);
    assert.equal(r.error, undefined, r.error);
    const own = join(store, "skills", "prelim-search", "risk-framework-invented.md");
    assert.equal(r.oldName, own);
    assert.equal(r.newName, own, "a new-spelling read finds the company's file under the folder the store still has");
    assert.ok(r.shipped.endsWith(join("skills", "clearance-search", "synthesis-rules.md")) && existsSync(r.shipped),
      "the product answers under the name it ships");
  } finally { rmSync(store, { recursive: true, force: true }); }
});

test("skillSpellings pairs only the four renamed folders", () => {
  assert.deepEqual(skillSpellings("skills/clearance-register/unit.md"), ["skills/clearance-register/unit.md", "skills/prelim-register/unit.md"]);
  assert.deepEqual(skillSpellings("skills/prelim-variants/SKILL.md"), ["skills/prelim-variants/SKILL.md", "skills/clearance-variants/SKILL.md"]);
  assert.deepEqual(skillSpellings("skills/matter-frame/SKILL.md"), ["skills/matter-frame/SKILL.md", null]);
});

test("an install keeps the studio segment it has; a new install takes the new name", () => {
  const ws = mkdtempSync(join(tmpdir(), "studio-seg-"));
  try {
    assert.equal(studioSegmentFor(ws), "clearance-search", "nothing on disk: the new spelling");
    mkdirSync(join(ws, "studio", "prelim-search", "archive"), { recursive: true });
    assert.equal(studioSegmentFor(ws), "prelim-search", "every archived run is under the old one, so it wins");
    mkdirSync(join(ws, "studio", "clearance-search"), { recursive: true });
    assert.equal(studioSegmentFor(ws), "prelim-search", "and it still wins when both exist");
  } finally { rmSync(ws, { recursive: true, force: true }); }
});

test("the run root, the queue list and the queue-dir parser all read the install's own segment", () => {
  const root = mkdtempSync(join(tmpdir(), "studio-root-"));
  const prev = process.env.CLEAROTRON_WORK_DIR;
  try {
    pinEnv(process.env, "CLEAROTRON_WORK_DIR", root);
    const ws = join(root, config.workspaceDirName("clawdi"));
    for (const seg of STUDIO_SEGMENTS) mkdirSync(join(ws, "studio", seg, "queue"), { recursive: true });
    assert.equal(config.studioRootForAgent("clawdi"), join(ws, "studio", "prelim-search"));
    const queues = config.queueDirs;
    for (const seg of STUDIO_SEGMENTS)
      assert.ok(queues.includes(join(ws, "studio", seg, "queue")), `a job queued under ${seg} is drained`);
    assert.equal(config.agentIdFromQueueDir(join(ws, "studio", "prelim-search", "queue")), "clawdi");
    assert.equal(config.agentIdFromQueueDir(join(ws, "studio", "clearance-search", "queue")), "clawdi");
  } finally {
    if (prev === undefined) delete process.env.CLEAROTRON_WORK_DIR; else pinEnv(process.env, "CLEAROTRON_WORK_DIR", prev);
    rmSync(root, { recursive: true, force: true });
  }
});

test("a run resumed across the rename keeps the records it fetched under the old session prefix", () => {
  assert.deepEqual(runPrefixSpellings("clearance-acme-copper-anvil-"), ["clearance-acme-copper-anvil-", "prelim-acme-copper-anvil-"]);
  const dir = mkdtempSync(join(tmpdir(), "prefix-ledger-"));
  try {
    const log = join(dir, "register-record-bodies.jsonl");
    writeFileSync(log, [
      { ts: "2026-09-17T10:00:00Z", sessionKey: "prelim-acme-copper-anvil-register-unit-primary-sweep", target: "/mark/us/1", body: { id: "1" } },
      { ts: "2026-09-18T10:00:00Z", sessionKey: "clearance-acme-copper-anvil-screen-gate-refetch", target: "/mark/us/2", body: { id: "2" } },
      { ts: "2026-09-18T10:00:00Z", sessionKey: "clearance-other-run-x-register-unit-primary-sweep", target: "/mark/us/3", body: { id: "3" } },
    ].map((r) => JSON.stringify(r)).join("\n") + "\n");
    const got = collectRecordBodies(log, "clearance-acme-copper-anvil-");
    assert.deepEqual([...got.keys()].sort(), ["/mark/us/1", "/mark/us/2"], "both spellings of this run; never another run's");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the flag snapshot is read under its old name until the new one is written", () => {
  const pool = mkdtempSync(join(tmpdir(), "flag-snap-"));
  try {
    mkdirSync(join(pool, "_state"), { recursive: true });
    writeFileSync(join(pool, "_state", "prelim-flag-snapshot.json"), JSON.stringify({ flags: { a: "1" }, which: "old" }));
    assert.equal(readFlagSnapshot(pool)?.which, "old");
    writeFileSync(join(pool, "_state", "clearance-flag-snapshot.json"), JSON.stringify({ flags: { a: "1" }, which: "new" }));
    assert.equal(readFlagSnapshot(pool)?.which, "new", "the new file wins once it exists");
  } finally { rmSync(pool, { recursive: true, force: true }); }
});

test("a retired product key recorded before the rename still names its product", async () => {
  const { policyFor, productKeyAsRenamed } = await import("../search-policy.mjs");
  const { productRow } = await import("../product-rows.mjs");
  for (const [before, now] of [["prelim", "clearance"], ["prelim-register-only", "clearance-register-only"], ["prelim-jx", "clearance-jx"]]) {
    assert.equal(productKeyAsRenamed(before), now);
    assert.equal(policyFor(before), policyFor(now), `an archived ${before} run re-renders under its own identity`);
    assert.ok(productRow(before)?.name, `${before} still has a name`);
  }
});

test("a run stamped before the variants stage was renamed keeps its manifest floors on resume", async () => {
  // The stage-contract marker is keyed by stage name, and the stage was `prelim-variants` when a run
  // dispatched on an earlier build stamped it. Read under the new name alone, the romanisation,
  // completeness and term-shape floors read as never armed and a resumed run skips all three.
  const { variantsStageContract } = await import("../verify.mjs");
  const floors = { romanization: 1, completeness: 1, term_shape: 1 };
  assert.deepEqual(variantsStageContract({ "prelim-variants": floors }), floors, "the old key arms the same floors");
  assert.deepEqual(variantsStageContract({ "clearance-variants": floors }), floors);
  const fresh = { term_shape: 1 };
  assert.equal(variantsStageContract({ "prelim-variants": floors, "clearance-variants": fresh }), fresh,
    "a fresh dispatch's own stamp wins where both exist");
  assert.equal(variantsStageContract({ "matter-frame": floors }), null, "no stamp for this stage is still no stamp");
});
