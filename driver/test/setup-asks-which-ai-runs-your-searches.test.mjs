// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// SETUP'S FIRST QUESTION, IN THE WORDS THE OWNER APPROVED ON 2026-09-15.
//
// It asked "Which program does the reasoning?" under a block listing what the machine already had, and a
// row setup could not use said only that it was not usable and that setup would say why. A lawyer reading
// it could not tell which answer worked, which needed an install and which needed a setting changed. The
// approved screen names each AI and its maker, says on its row what setup found, and says after the choice
// what happens next. Every string asserted below is the approved one, word for word: a clause added to any
// of them is a sentence nobody approved.
//
// THE ROWS ARE DRIVEN THROUGH engineMenuState wherever a real file can stand in for the case, so the words
// are tied to what the resolver finds (a vendor's placeholder, a copy without the execute bit, a setting
// naming nothing) and not to a hand-built state that could drift from it.
//
// READ AS A NAMESPACE, so a name this file needs and the module lacks fails its own test rather than the
// whole file at import.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as setup from "../../bin/onboard.mjs";
import { ENGINE_BINARIES } from "../driver.config.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const src = readFileSync(join(REPO, "bin", "onboard.mjs"), "utf8");
const ENGINES = Object.keys(ENGINE_BINARIES);
// The version these arms mean as "fine": the engine's own floor, not a literal — a copy below it is
// now reported as too old, so a written-out version would fail these arms the next time the floor moves.
const CURRENT_PROGRAM = ENGINE_BINARIES["anthropic-agent"].floor;
// An empty directory: a PATH with nothing on it, and an engines folder with nothing installed.
const NOWHERE = mkdtempSync(join(tmpdir(), "which-ai-nowhere-"));
after(() => rmSync(NOWHERE, { recursive: true, force: true }));
const PLACEHOLDER = 'echo "Error: the native binary is not installed." >&2\nexit 1\n';   // no #!, as the vendor ships it

/** A copy of an engine's program installed where setup installs one, its program file holding `content`. */
function installed(engineId, content, { mode = 0o755, version = "9.9.9" } = {}) {
  const spec = ENGINE_BINARIES[engineId];
  const root = mkdtempSync(join(tmpdir(), "which-ai-installed-"));
  const dir = join(root, "node_modules", ...spec.package.split("/"));
  mkdirSync(join(dir, "bin"), { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: spec.package, version, bin: { [spec.fallback]: `bin/${spec.fallback}` } }));
  const program = join(dir, "bin", spec.fallback);
  writeFileSync(program, content, { mode });
  return { root, program };
}

/** One engine's row as setup shows it for what engineMenuState finds, split into who it is and what was found. */
function said(engineId, env = {}, enginesDir = NOWHERE) {
  const state = setup.engineMenuState({ env: { PATH: NOWHERE, ...env }, enginesDir, readVersion: () => null });
  const label = setup.engineOptions(state).find((o) => o.id === engineId)?.label ?? "";
  const [who, what] = label.split(/ {3,}/);
  return { who, what, state: state[engineId] };
}

const PROBLEM_SETTING = (eng) => `problem: this computer is set to use a copy of ${eng.product} that isn't there — choose it to see the fix`;
const PROBLEM_INCOMPLETE = (eng) => `problem: the copy of ${eng.product} here is incomplete and won't run — choose it to see the fix`;

test("setup's first question prints the approved screen, word for word", () => {
  assert.equal(typeof setup.menuScreen, "function", "setup has no menuScreen, so the screen it prints is asserted nowhere");
  const found = {
    "anthropic-agent": { executable: true, relative: false, version: CURRENT_PROGRAM, rejected: [] },
    "openai-agent": { executable: false, relative: false, version: null, rejected: [], explicit: false },
  };
  assert.equal(setup.menuScreen(setup.ENGINE_QUESTION, setup.engineOptions(found), 0, setup.PAY_PREAMBLE).join("\n"), [
    "",
    "  Which AI should run your searches?",
    `    1) Claude, by Anthropic   found on this computer (version ${CURRENT_PROGRAM})   (default)`,
    "    2) Codex, by OpenAI       not on this computer — setup can install it",
    "    3) None for now",
    "",
    "  Next, setup asks how you pay for it: a subscription you sign in with, an API key,",
    "  or, for Claude, your own cloud account.",
  ].join("\n"));
});

test("the question, the rows' names, the last row and the line after the menu are the approved words", () => {
  assert.equal(setup.ENGINE_QUESTION, "Which AI should run your searches?");
  const rows = setup.engineOptions();
  assert.deepEqual(rows.at(-1), { id: null, label: "None for now" });
  // With nothing looked for, a row is the AI and its maker alone.
  for (const [id, eng] of Object.entries(ENGINE_BINARIES))
    assert.equal(rows.find((o) => o.id === id)?.label, `${eng.product}, by ${eng.vendor}`);
  assert.deepEqual(rows.filter((o) => o.id).map((o) => o.label), ["Claude, by Anthropic", "Codex, by OpenAI"]);
  assert.equal(setup.PAY_PREAMBLE.map((l) => l.trim()).join(" "),
    "Next, setup asks how you pay for it: a subscription you sign in with, an API key, or, for Claude, your own cloud account.");
});

test("setup asks that question on that screen, and prints nothing above it", () => {
  const start = src.indexOf("engine: for (;;) {");
  const ask = src.indexOf("const pick = await choose(", start);
  assert.notEqual(start, -1, "anchor missing: the engine loop");
  assert.ok(ask > start, "anchor missing: the engine question inside the engine loop");
  assert.match(src.slice(ask, src.indexOf("\n", ask)), /choose\(ENGINE_QUESTION, engineOptions\(found\), 0, PAY_PREAMBLE\);$/,
    "the engine question is not asked with the approved words and the line after the menu");
  // THE BLOCK ABOVE THE QUESTION IS GONE: the rows now say what it said.
  const above = src.slice(start, ask).split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
  assert.doesNotMatch(above, /\b(say|info|warn|ok|problem)\(/, `something is still printed above the engine question:\n${above}`);
  assert.doesNotMatch(src, /What this box already has/);
  // The shared chooser prints its screen from menuScreen, so the screen asserted above is the one a reader sees.
  assert.match(src, /const choose = async \(q, options, def = 0, after = \[\]\) => \{\n\s*for \(const line of menuScreen\(q, options, def, after\)\) say\(line\);/);
});

test("a row found says so, with the version when the program gives one and without when it does not", () => {
  for (const id of ENGINES) {
    const eng = ENGINE_BINARIES[id];
    const copy = installed(id, "#!/bin/sh\nexit 1\n", { version: CURRENT_PROGRAM });
    const onPath = mkdtempSync(join(tmpdir(), "which-ai-path-"));
    writeFileSync(join(onPath, eng.fallback), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
    try {
      assert.deepEqual((({ who, what }) => ({ who, what }))(said(id, {}, copy.root)),
        { who: `${eng.product}, by ${eng.vendor}`, what: `found on this computer (version ${CURRENT_PROGRAM})` });
      const quiet = said(id, { PATH: onPath });
      assert.equal(quiet.state.version, null, "fixture precondition: the copy on PATH gave no version");
      assert.equal(quiet.what, "found on this computer");
    } finally { for (const d of [copy.root, onPath]) rmSync(d, { recursive: true, force: true }); }
  }
});

test("a row with nothing found says setup can install it, and only where there is a package to install", () => {
  assert.equal(typeof setup.foundWords, "function", "foundWords is not reachable, so the no-package row is asserted nowhere");
  for (const id of ENGINES) {
    const eng = ENGINE_BINARIES[id];
    assert.ok(eng.package, `fixture precondition: ${id} ships a package setup can install`);
    assert.equal(said(id).what, "not on this computer — setup can install it");
    // THE HONEST FORM: with no package there is nothing for setup to install, and the row must not offer it.
    assert.equal(setup.foundWords({ ...eng, package: null }, { executable: false, relative: false, rejected: [] }), "not on this computer");
    // A SETTING OF SPACES, OR THE DEFAULT WORD WITH A SPACE AFTER IT, IS UNSET to the resolver and to the
    // line after the pick, so the row says nothing was found, and that line agrees with it.
    for (const blank of [" ", `${eng.fallback} `]) {
      const row = said(id, { [eng.env]: blank });
      assert.equal(row.state.explicit, false, `${JSON.stringify(blank)} is read as a setting in force`);
      assert.equal(row.what, "not on this computer — setup can install it", JSON.stringify(blank));
      assert.equal(setup.cannotRunLine(eng, row.state, blank), `${setup.unusableEngineWords(eng, row.state, "")}.`, JSON.stringify(blank));
    }
  }
});

test("a setting naming a copy that is not there or cannot run is a problem row, for each engine", () => {
  const other = mkdtempSync(join(tmpdir(), "which-ai-set-"));
  try {
    for (const id of ENGINES) {
      const eng = ENGINE_BINARIES[id];
      const flat = join(other, `flat-${eng.fallback}`);
      writeFileSync(flat, "#!/bin/sh\nexit 0\n", { mode: 0o644 });   // there, and without the execute bit
      for (const setting of [join(other, `absent-${eng.fallback}`), `./no-such-${eng.fallback}`, `no-such-${eng.fallback}`, flat]) {
        const row = said(id, { [eng.env]: setting });
        assert.equal(row.state.explicit, true, `fixture precondition: ${setting} is a setting`);
        assert.equal(row.what, PROBLEM_SETTING(eng), setting);
      }
    }
  } finally { rmSync(other, { recursive: true, force: true }); }
});

test("a copy refused as the vendor's incomplete placeholder is its own problem row, even where a setting names it", () => {
  for (const id of ENGINES) {
    const eng = ENGINE_BINARIES[id];
    const { root, program } = installed(id, PLACEHOLDER);
    try {
      const row = said(id, {}, root);
      assert.match(row.state.rejected?.[0]?.why ?? "", /placeholder/, `fixture precondition: the resolver refused ${program} as the placeholder`);
      assert.equal(row.what, PROBLEM_INCOMPLETE(eng));
      // The setting names a copy that IS there, so the setting row's "isn't there" would be false.
      assert.equal(said(id, { [eng.env]: program }, root).what, PROBLEM_INCOMPLETE(eng));
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});

test("any other copy refused is a problem row that says it won't run", () => {
  for (const id of ENGINES) {
    const eng = ENGINE_BINARIES[id];
    const { root } = installed(id, "#!/bin/sh\nexit 0\n", { mode: 0o644 });
    try {
      const row = said(id, {}, root);
      assert.match(row.state.rejected?.[0]?.why ?? "", /not an executable file/, "fixture precondition: the copy was refused as not executable");
      assert.equal(row.what, `problem: the copy of ${eng.product} here won't run — choose it to see the fix`);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});

test("after a problem row is chosen, setup says what is wrong in the approved words, naming no setting", () => {
  assert.equal(typeof setup.cannotRunLine, "function", "setup has no cannotRunLine, so what it says after the choice is asserted nowhere");
  // The approved example, exactly.
  assert.equal(setup.cannotRunLine(ENGINE_BINARIES["anthropic-agent"], { executable: false, relative: false, rejected: [] }, "/opt/tools/claude"),
    "This computer is set to use Claude at /opt/tools/claude, and nothing there can run. Setup can install Claude and use that instead.");
  for (const id of ENGINES) {
    const eng = ENGINE_BINARIES[id];
    const resolved = (setting, enginesDir = NOWHERE) => setup.resolveEngineBin(setting, { engine: id, env: { PATH: NOWHERE }, enginesDir });
    const settingLine = (path) => `This computer is set to use ${eng.product} at ${path}, and nothing there can run. Setup can install ${eng.product} and use that instead.`;
    // The path is the one the setting names, as it names it: a relative setting is not rewritten.
    for (const setting of [join(NOWHERE, `gone-${eng.fallback}`), `./no-such-${eng.fallback}`]) {
      const line = setup.cannotRunLine(eng, resolved(setting), setting);
      assert.equal(line, settingLine(setting));
      assert.ok(!line.includes(eng.env), `the line names the setting: ${line}`);
    }
    const { root, program } = installed(id, PLACEHOLDER);
    try {
      const incomplete = `The copy of ${eng.product} at ${program} is incomplete: its installation stopped before the program was added. Setup can install a working copy.`;
      const b = resolved(eng.fallback, root);
      assert.equal(b.executable, false, "fixture precondition: the placeholder does not resolve");
      assert.equal(setup.cannotRunLine(eng, b, ""), incomplete);
      assert.equal(setup.cannotRunLine(eng, resolved(program, root), program), incomplete, "a setting naming the placeholder is the incomplete copy");
    } finally { rmSync(root, { recursive: true, force: true }); }
    // THE CONTROL: with nothing found and nothing named there is no approved sentence, and the line is the one it was.
    assert.equal(setup.cannotRunLine(eng, { executable: false, relative: false, rejected: [] }, ""),
      `${setup.unusableEngineWords(eng, { rejected: [] }, "")}.`);
  }
});

test("setup says those words where the copy cannot run, and declining the install names the setting once", () => {
  assert.equal(typeof setup.ownCopyLine, "function", "setup has no ownCopyLine, so the declined-install line is asserted nowhere");
  for (const id of ENGINES) {
    const eng = ENGINE_BINARIES[id];
    assert.equal(setup.ownCopyLine(eng), `To use your own copy of ${eng.product} instead, change ${eng.env} to its full path, or give that path at the next question.`);
  }
  const say = src.indexOf("warn(cannotRunLine(eng, bin, process.env[eng.env]));");
  const offer = src.indexOf("if (await confirm(`Run \\`${engineInstallCommand(eng, dir)}\\` now?`, false)) {");
  assert.notEqual(say, -1, "the engine step does not say the approved words when the chosen copy cannot run");
  assert.ok(offer > say, "anchor missing: the install offer after those words");
  assert.doesNotMatch(src.slice(say, offer), /eng\.env\}|unusableEngineWords/, "a setting's name is printed between the plain words and the install offer");
  // The declined branch of that offer, and only it, says how to use one's own copy.
  const declined = src.slice(offer, src.indexOf("if (!(bin.executable && !bin.relative)) {", offer));
  assert.match(declined, /\} else if \(namedSetting\(eng, process\.env\[eng\.env\]\)\) info\(ownCopyLine\(eng\)\);\n\s*\}\s*$/,
    "declining the install with a setting in force does not say how to use one's own copy");
  assert.equal([...src.matchAll(/(?<!function )ownCopyLine\(/g)].length, 1, "the declined-install line is said in more than one place");
});

test("accepting the install with a setting in force uses the copy setup installed, and names no setting", () => {
  // "Setup can install Claude and use that instead" is said only when a setting is in force, and a setting
  // naming a program never falls through to the copy setup installed. So the look after the install is
  // made with the engine's default word, which finds that copy, and which is what setup then writes.
  const other = mkdtempSync(join(tmpdir(), "which-ai-set-"));
  try {
    for (const id of ENGINES) {
      const eng = ENGINE_BINARIES[id];
      const copy = installed(id, "#!/bin/sh\nexit 0\n");   // what the install put in the engines folder
      const elsewhere = installed(id, PLACEHOLDER);          // a placeholder the setting names, outside it
      try {
        for (const setting of [join(other, `absent-${eng.fallback}`), `./no-such-${eng.fallback}`, elsewhere.program]) {
          const env = { PATH: NOWHERE, [eng.env]: setting };
          const before = setup.resolveEngineBin(setting, { engine: id, env, enginesDir: copy.root });
          assert.equal(before.executable, false, `fixture precondition: ${setting} names nothing that can run`);
          assert.match(setup.cannotRunLine(eng, before, setting), /Setup can install/, `fixture precondition: setup offered the install for ${setting}`);
          const bin = setup.resolveEngineBin(eng.fallback, { engine: id, env, enginesDir: copy.root });
          assert.deepEqual({ executable: bin.executable, source: bin.source, path: bin.path },
            { executable: true, source: "installed", path: copy.program }, `after the install, with ${setting} in force`);
          assert.equal(setup.engineProgramSetting(eng, bin), eng.fallback, "the setting written for that copy is not the default word, so the one that failed would stay");
        }
      } finally { for (const d of [copy.root, elsewhere.root]) rmSync(d, { recursive: true, force: true }); }
    }
  } finally { rmSync(other, { recursive: true, force: true }); }

  // The install block makes that look: from the install it runs to the branch taken when it is declined.
  // The anchor is joined from two pieces so that this file, which only READS onboard.mjs and runs no
  // package manager, does not read as one to the offline guard (a-test-never-reaches-a-network-...).
  const spawn = src.indexOf(["spawnSync(", '"npm", engineInstallArgs(eng, dir)'].join(""));
  const declined = src.indexOf("} else if (namedSetting(eng, process.env[eng.env])) info(ownCopyLine(eng));", spawn);
  assert.notEqual(spawn, -1, "anchor missing: the install setup runs");
  assert.ok(declined > spawn, "anchor missing: the declined branch after the install");
  const accepted = src.slice(spawn, declined).split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
  assert.match(accepted, /\n\s*bin = resolveEngineBin\(eng\.fallback, \{ engine: pick\.id \}\);\n/,
    "after the install, setup looks for the program under the setting in force, which never finds the copy it installed");
  assert.doesNotMatch(accepted, /process\.env\[eng\.env\]|unusableEngineWords|eng\.env\}/,
    "after an accepted install, setup reads or names the setting in force");
  assert.match(accepted, /else warn\(cannotRunLine\(eng, bin, ""\)\);/, "an install that left nothing that can run is not said in the approved words");
  assert.match(accepted, /if \(bin\.source === "installed"\) ok\(`installed: \$\{bin\.path\}`\);/,
    "setup says it installed a copy that may be the machine's own");
});

test("choosing None for now says the approved line, through the one helper every route uses", () => {
  assert.equal(setup.NO_AI_CHOSEN, "No AI chosen. The demo works without one; a real search needs one, so run setup again when you're ready.");
  const helper = src.slice(src.indexOf("const sayNoEngine = () => {"), src.indexOf("const choose = async"));
  assert.equal(helper.trim(), "const sayNoEngine = () => {\n  info(NO_AI_CHOSEN);\n};", "the no-engine ending says more, or other, than the approved line");
  assert.doesNotMatch(src, /No engine configured, and nothing engine-related will be written/);
});
