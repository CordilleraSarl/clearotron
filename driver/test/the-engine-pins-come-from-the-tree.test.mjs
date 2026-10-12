// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// The engine pins come from the tree, and only from the tree.
//
// scripts/engine-pins.mjs is the one definition of "this change moved a model or an engine program": the
// push workflow, the cut and the saved-case replay all compare trees by it. So it must agree with what the
// engine itself resolves, ignore what a box's settings override, ignore comments, see every real change,
// and refuse to answer rather than answer in part. Each arm below holds one of those.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { canonical } from "../../scripts/engine-pins.mjs";
import { ENGINE_BINARIES } from "../driver.config.mjs";
import { openaiModel } from "../engine/openai-agent.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCRIPT = join(ROOT, "scripts", "engine-pins.mjs");
const MODELS_FILE = join("driver", "engine", "openai-agent.mjs");
const BINARIES_FILE = join("driver", "driver.config.mjs");
const DIR = mkdtempSync(join(tmpdir(), "engine-pins-test-"));
after(() => rmSync(DIR, { recursive: true, force: true }));

const MODEL_SETTINGS = ["CLEAROTRON_OPENAI_MODEL_JUDGMENT", "CLEAROTRON_OPENAI_MODEL_SWEEP", "CLEAROTRON_OPENAI_MODEL_CHEAP"];
const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !MODEL_SETTINGS.includes(k)));

function pins(args = [], env = cleanEnv()) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8", env });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

/** A tree holding only the two files the script reads, each edited by `edit`. */
let trees = 0;
function treeWith(edit = {}) {
  const dir = join(DIR, `tree-${++trees}`);
  for (const rel of [MODELS_FILE, BINARIES_FILE]) {
    mkdirSync(join(dir, dirname(rel)), { recursive: true });
    const text = readFileSync(join(ROOT, rel), "utf8");
    writeFileSync(join(dir, rel), edit[rel] ? edit[rel](text) : text);
  }
  return dir;
}

test("on this tree it prints the pins the engine itself resolves, in one sorted line", () => {
  const r = pins();
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /^\{.*\}\n$/, "one line of JSON");
  const out = JSON.parse(r.stdout);
  assert.equal(r.stdout.trim(), canonical(out), "keys sorted at every level, no whitespace");
  assert.deepEqual(Object.keys(out), ["digest", "pins", "schema"]);
  assert.equal(out.schema, 1);
  for (const engine of ["anthropic-agent", "openai-agent"]) {
    assert.equal(out.pins[engine].package, ENGINE_BINARIES[engine].package, `${engine}'s program`);
    assert.equal(out.pins[engine].floor, ENGINE_BINARIES[engine].floor, `${engine}'s floor`);
  }
  // The engine's own resolution of each tier, in a process with no model setting: the source default.
  assert.deepEqual(out.pins["openai-agent"].models,
    { judgment: openaiModel("opus"), sweep: openaiModel("sonnet"), cheap: openaiModel("haiku") });
});

test("the digest is the sha256 of the pins alone, so the format's version is outside it", () => {
  const out = JSON.parse(pins().stdout);
  const expected = `sha256:${createHash("sha256").update(canonical(out.pins)).digest("hex")}`;
  assert.equal(out.digest, expected);
});

test("--root at the script's own tree prints exactly what the default prints", () => {
  const own = pins(["--root", ROOT]);
  assert.equal(own.code, 0, own.stderr);
  assert.equal(own.stdout, pins().stdout);
});

test("a box's model settings do not change the answer", () => {
  const env = { ...cleanEnv(), CLEAROTRON_OPENAI_MODEL_JUDGMENT: "a-model-set-on-one-box",
    CLEAROTRON_OPENAI_MODEL_SWEEP: "another", CLEAROTRON_OPENAI_MODEL_CHEAP: "a-third" };
  assert.equal(pins([], env).stdout, pins().stdout);
});

test("a comment edit is no change; a model or a floor that moves is one", () => {
  const base = JSON.parse(pins(["--root", treeWith()]).stdout).digest;
  assert.equal(base, JSON.parse(pins().stdout).digest, "the two-file tree reads as this tree does");

  const commented = treeWith({
    [MODELS_FILE]: (t) => t.replace(/^const JUDGMENT /m, "// an edited note above the judgment model\nconst JUDGMENT "),
    [BINARIES_FILE]: (t) => t.replace(/^export const ENGINE_BINARIES = \{\n/m, (m) => `${m}  // a note, with floor: "0.0.1" inside it\n`),
  });
  assert.equal(JSON.parse(pins(["--root", commented]).stdout).digest, base, "comments are not pins");

  const model = treeWith({ [MODELS_FILE]: (t) => t.replace(/(CLEAROTRON_OPENAI_MODEL_CHEAP\s*\|\|\s*")[^"]+"/, '$1gpt-a-new-one"') });
  const movedModel = JSON.parse(pins(["--root", model]).stdout);
  assert.notEqual(movedModel.digest, base, "a model id moved");
  assert.equal(movedModel.pins["openai-agent"].models.cheap, "gpt-a-new-one");

  const floor = treeWith({ [BINARIES_FILE]: (t) => t.replace(/(package: "@anthropic-ai\/claude-code", floor: ")[^"]+"/, '$19.9.999"') });
  const movedFloor = JSON.parse(pins(["--root", floor]).stdout);
  assert.notEqual(movedFloor.digest, base, "a program floor moved");
  assert.equal(movedFloor.pins["anthropic-agent"].floor, "9.9.999");
  assert.deepEqual(movedFloor.pins["openai-agent"], JSON.parse(pins().stdout).pins["openai-agent"],
    "and the other engine's entry is untouched, so the reader can tell which engine moved");
});

test("anything it cannot read exactly once is could-not-look: exit 2, nothing on stdout", () => {
  const cases = {
    "a missing file": () => { const d = join(DIR, "empty"); mkdirSync(d, { recursive: true }); return d; },
    "a model default gone": () => treeWith({ [MODELS_FILE]: (t) => t.replace(/^const SWEEP .*$/m, "") }),
    "a model default doubled": () => treeWith({ [MODELS_FILE]: (t) => t.replace(/^const CHEAP .*$/m, (l) => `${l}\n${l}`) }),
    "a floor gone": () => treeWith({ [BINARIES_FILE]: (t) => t.replace(/floor: "[^"]+",(\s*installMB: 424)/, "$1") }),
    "a commented-out floor": () => treeWith({ [BINARIES_FILE]: (t) => t.replace(/^(\s*)(package: "@openai\/codex", floor: "[^"]+",)/m, "$1// $2") }),
  };
  for (const [name, make] of Object.entries(cases)) {
    const r = pins(["--root", make()]);
    assert.equal(r.code, 2, `${name}: exit ${r.code}`);
    assert.equal(r.stdout, "", `${name}: printed a partial answer`);
    assert.match(r.stderr, /could not look/, `${name}: said why`);
  }
  const usage = pins(["--bogus"]);
  assert.equal(usage.code, 2);
  assert.equal(usage.stdout, "");
});
