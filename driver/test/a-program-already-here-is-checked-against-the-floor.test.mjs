// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A PROGRAM ALREADY ON THIS MACHINE IS CHECKED AGAINST THE FLOOR, NOT ONLY THE ONE SETUP INSTALLS.
//
// The engine table declares the oldest version of the vendor's program this build asks for, and setup
// passed it to npm — so a program setup installs cannot land under it. A copy already on the machine
// wins over the installed one by design, and nothing compared its version to anything. The unchecked
// route is the one most machines take.
//
// What it costs is not a crash. The program carries its own list of accepted models, so a copy below the
// floor refuses the newest model of a tier and serves the one before it: the search finishes, the report
// is delivered, and the only trace is a model id in the record that nobody chose. Measured 2026-09-22 on
// 2.1.263 — the current top tier's id came back a 400, and the tier alias answered with the generation
// before it.
//
// Driven over version strings rather than programs: the comparison is pure, and the two surfaces that
// report it are given a resolved copy with a version on it. An old string and a current one, both ways.
import test from "node:test";
import assert from "node:assert/strict";
import { olderThanFloor, ENGINE_BINARIES } from "../driver.config.mjs";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { foundWords, cannotRunLine, floorRefusesNewestModel } from "../../bin/onboard.mjs";

const CLAUDE = ENGINE_BINARIES["anthropic-agent"];
const FLOOR = CLAUDE.floor;
// The version the vendor's own refusal named, and the one the box carried when it was measured.
const TOO_OLD = "2.1.263";
const CURRENT = "2.1.280";
const copy = (version, extra = {}) => ({ path: "/somewhere/bin/claude", executable: true, relative: false, source: "path", version, rejected: [], ...extra });

test("an old version sorts below the floor and a current one does not, part by part", () => {
  assert.equal(olderThanFloor(TOO_OLD, FLOOR), true);
  assert.equal(olderThanFloor(CURRENT, FLOOR), false);
  assert.equal(olderThanFloor("2.2.0", FLOOR), false);
  assert.equal(olderThanFloor("3.0.0", FLOOR), false);
  // THE COMPARISON THAT TEXT GETS WRONG. "2.1.99" is two hundred releases behind "2.1.280" and sorts
  // above it as a string, so a machine well under the floor would read as being past it.
  assert.equal(olderThanFloor("2.1.99", "2.1.280"), true);
  assert.equal(olderThanFloor("2.1.9", "2.1.280"), true);
  // A two-part version, and one the vendor prefixes, still place.
  assert.equal(olderThanFloor("2.0", "2.1.280"), true);
  assert.equal(olderThanFloor("v2.1.280", "2.1.280"), false);
});

test("what cannot be compared is not called a pass", () => {
  // Each of these is a real state: no version read from the copy, a program that answered in prose, and
  // an engine with no floor declared. None of them is evidence that the copy is new enough.
  for (const [version, floor] of [[null, FLOOR], [undefined, FLOOR], ["", FLOOR], ["a build from source", FLOOR],
    [CURRENT, null], [CURRENT, undefined], [TOO_OLD, ""]])
    assert.equal(olderThanFloor(version, floor), null, `${JSON.stringify(version)} against ${JSON.stringify(floor)} answered something other than "cannot compare"`);
});

test("setup's row names the version and the floor, and says the same thing when the engine is chosen", () => {
  const row = foundWords(CLAUDE, copy(TOO_OLD));
  assert.match(row, /problem:/, `an old copy still reads as found: "${row}"`);
  assert.ok(row.includes(TOO_OLD) && row.includes(FLOOR), `the row names neither the version it read nor the floor: "${row}"`);

  const said = cannotRunLine(CLAUDE, copy(TOO_OLD));
  assert.ok(said.includes(TOO_OLD) && said.includes(FLOOR), `the explanation names neither version: "${said}"`);
  // IT RUNS, AND THE WORDS MAY NOT SAY OTHERWISE. Every other problem on this path is a copy that cannot
  // start, and describing this one that way sends the reader to look for a broken install they do not have.
  assert.doesNotMatch(said, /incomplete|won't run|cannot run|isn't there/i,
    `an old copy is described as one that cannot run: "${said}"`);
  assert.match(said, /newest Claude models need a newer version/,
    `the explanation does not say what actually goes wrong: "${said}"`);
});

test("the stand-in program the suite spawns claims a version this build supports", () => {
  // NOT HOUSEKEEPING. Every arm that drives a healthy install spawns that mock, doctor now compares what
  // a program says against the floor, and the mock answers `--version` with a literal. When the floor
  // moved past it those arms went red together, all for this one string, and each of them read as a
  // defect in the thing it was actually testing. This says so once, here, and names the line to change.
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "mock-claude.mjs"), "utf8");
  const said = /process\.stdout\.write\("(\d+\.\d+\.\d+)[^"]*"\)/.exec(src);
  assert.ok(said, "mock-claude.mjs no longer answers --version with a plain version string");
  assert.notEqual(olderThanFloor(said[1], FLOOR), true,
    `mock-claude.mjs answers --version with ${said[1]}, older than the ${FLOOR} floor — doctor reports it as too old and every healthy-install arm fails on it. Raise that line.`);
});

test("a current copy reads as found, and one whose version was never read is not accused", () => {
  const row = foundWords(CLAUDE, copy(CURRENT));
  assert.equal(row, `found on this computer (version ${CURRENT})`);
  assert.doesNotMatch(row, /problem/, "a copy at the floor is reported as a problem");
  // A copy installed by a route that leaves no version to read: unknown, and unknown is not old.
  const unread = foundWords(CLAUDE, copy(null));
  assert.equal(unread, "found on this computer");
  assert.doesNotMatch(unread, /problem|older/, `a copy whose version could not be read is accused of being old: "${unread}"`);
});

test("an old Codex is named by its version, the floor and the fix, and nothing is claimed about its models", () => {
  // The model sentence was measured on Claude alone. Codex below its floor gets the same facts and the same
  // fix, and no sentence about which model it runs.
  const CODEX = ENGINE_BINARIES["openai-agent"];
  const old = "0.150.1";
  assert.equal(olderThanFloor(old, CODEX.floor), true, `${old} no longer sorts below Codex's floor ${CODEX.floor}`);
  assert.equal(floorRefusesNewestModel(CLAUDE), true);
  assert.equal(floorRefusesNewestModel({ ...CLAUDE }), true, "a copy of Claude's table entry is not read as Claude");
  assert.equal(floorRefusesNewestModel(CODEX), false);
  assert.equal(floorRefusesNewestModel(null), false);
  assert.equal(cannotRunLine(CODEX, copy(old, { path: "/somewhere/bin/codex" })),
    `Codex on this computer is version ${old}. Clearotron needs ${CODEX.floor} or newer. Update it, or set ${CODEX.env} to a newer copy.`);
  assert.equal(cannotRunLine(CLAUDE, copy(TOO_OLD)),
    `Claude on this computer is version ${TOO_OLD}. Clearotron needs ${FLOOR} or newer. `
    + `The newest Claude models need a newer version. Searches run on an older model instead, or stop at the first step if they name the newest one exactly. Update it, or set ${CLAUDE.env} to a newer copy.`);
  // A copy Clearotron installed moves with `update`; any other copy is used before one setup installs, so
  // installing another is never offered as its fix.
  assert.match(cannotRunLine(CLAUDE, copy(TOO_OLD, { source: "installed" })), /Update it with `[^`]*update`\.$/);
  for (const eng of [CLAUDE, CODEX]) assert.doesNotMatch(cannotRunLine(eng, copy("0.0.1")), /install/i);
});

// ── THE REAL PATHS, NOT THE FUNCTIONS ─────────────────────────────────────────────────────────────────
//
// The arms above call the sentence builders directly, and that is how setup came to promise "choose it to
// see the fix" on a menu row while the path behind the choice never showed it: an old copy runs, so it
// skipped both branches that print the paragraph. These drive doctor and setup as a person does, with a
// stand-in program on PATH that answers `--version` with a version below the floor and does nothing else.
const ONBOARD = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "bin", "onboard.mjs");
const plain = (s) => String(s).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").replace(/\r/g, "");
function standIn(name, answer) {
  const dir = mkdtempSync(join(tmpdir(), "floor-standin-"));
  writeFileSync(join(dir, name), answer === null ? "#!/bin/sh\nexit 1\n" : `#!/bin/sh\necho "${answer}"\n`, { mode: 0o755 });
  return dir;
}
function isolated(dir, extra = {}) {
  const home = mkdtempSync(join(tmpdir(), "floor-home-"));
  return { home, env: { PATH: `${dir}:${dirname(process.execPath)}:/usr/bin:/bin`, HOME: home, XDG_CONFIG_HOME: join(home, ".config"),
    CLEAROTRON_ENGINES_DIR: join(home, "engines"), NO_COLOR: "1", TERM: "dumb", ...extra } };
}

test("doctor, run as a person runs it, names an old copy by version and fix, and claims nothing about Codex's models", () => {
  const CODEX = ENGINE_BINARIES["openai-agent"];
  const cases = [
    { eng: CLAUDE, id: "anthropic-agent", name: "claude", answer: `${TOO_OLD} (Claude Code)`, version: TOO_OLD,
      line: (bin) => `✗ ${bin} — on PATH, version ${TOO_OLD}. Clearotron needs ${FLOOR} or newer. `
        + `The newest Claude models need a newer version. Searches run on an older model instead, or stop at the first step if they name the newest one exactly. Update it, or set ${CLAUDE.env} to a newer copy.` },
    { eng: CODEX, id: "openai-agent", name: "codex", answer: "codex-cli 0.150.1", version: "0.150.1",
      line: (bin) => `✗ ${bin} — on PATH, version 0.150.1. Clearotron needs ${CODEX.floor} or newer. Update it, or set ${CODEX.env} to a newer copy.` },
  ];
  for (const c of cases) {
    const dir = standIn(c.name, c.answer);
    const { home, env } = isolated(dir, { CLEAROTRON_AI: c.id });
    try {
      assert.equal(olderThanFloor(c.version, c.eng.floor), true, `fixture precondition: ${c.version} is not below ${c.eng.floor}`);
      const r = spawnSync(process.execPath, [ONBOARD, "--check"], { env, encoding: "utf8", timeout: 60000 });
      const out = plain(r.stdout);
      assert.equal(r.status, 1, `doctor did not fail on an old ${c.eng.product}: exit ${r.status}\n${out.slice(-1500)}`);
      const want = c.line(join(dir, c.name));
      assert.ok(out.split("\n").some((l) => l.trim() === want), `doctor did not print\n  ${want}\n${out.slice(-2500)}`);
      if (c.eng === CODEX) assert.doesNotMatch(out, /newest Codex models|older model|refuses the newest model/, "doctor claims something about Codex's models");
    } finally { for (const d of [dir, home]) rmSync(d, { recursive: true, force: true }); }
  }
});

test("doctor says when it could not check a copy's version, in one sentence true for either engine", () => {
  // Two ways to get here: the program gives no answer, or answers in prose, which is kept as said.
  for (const [id, name, answer, shown] of [["anthropic-agent", "claude", null, "version not read"], ["openai-agent", "codex", null, "version not read"],
    ["anthropic-agent", "claude", "a build from source", "version a build from source"]]) {
    const eng = ENGINE_BINARIES[id];
    const dir = standIn(name, answer);
    const { home, env } = isolated(dir, { CLEAROTRON_AI: id });
    try {
      const r = spawnSync(process.execPath, [ONBOARD, "--check"], { env, encoding: "utf8", timeout: 60000 });
      const lines = plain(r.stdout).split("\n").map((l) => l.trim().replace(/\s+/g, " "));
      assert.ok(lines.includes(`✓ ${join(dir, name)} — on PATH, ${shown}`), `doctor did not report the copy as found:\n${lines.join("\n").slice(0, 3000)}`);
      const want = `· Its version could not be checked against the ${eng.floor} Clearotron needs.`;
      assert.ok(lines.includes(want), `doctor did not print\n  ${want}\n${lines.join("\n").slice(0, 3000)}`);
    } finally { for (const d of [dir, home]) rmSync(d, { recursive: true, force: true }); }
  }
});

// `script` gives setup the terminal it insists on. It is util-linux's, which CI's runners carry; where it is
// missing or is another `script`, the arm says so as a skip, never as a pass.
const hasScript = spawnSync("script", ["--version"], { encoding: "utf8" }).stdout?.includes("util-linux");

test("setup, driven in a terminal, shows the fix for an old copy when that engine is picked, then carries on", { skip: hasScript ? false : "no util-linux `script` here to give setup a terminal" }, async () => {
  const dir = standIn("claude", `${TOO_OLD} (Claude Code)`);
  const { home, env } = isolated(dir);
  const child = spawn("script", ["-qfec", `${JSON.stringify(process.execPath)} ${JSON.stringify(ONBOARD)}`, "/dev/null"],
    { env, stdio: ["pipe", "pipe", "pipe"] });
  let out = "";
  child.stdout.on("data", (d) => { out += d; });
  const until = (re, ms = 30000) => new Promise((resolve, reject) => {
    const t0 = Date.now();
    const tick = () => (re.test(plain(out)) ? resolve() : Date.now() - t0 > ms
      ? reject(new Error(`setup never printed ${re}:\n${plain(out).slice(-2500)}`)) : setTimeout(tick, 50));
    tick();
  });
  const paragraph = `Claude on this computer is version ${TOO_OLD}. Clearotron needs ${FLOOR} or newer. `
    + `The newest Claude models need a newer version. Searches run on an older model instead, or stop at the first step if they name the newest one exactly. Update it, or set ${CLAUDE.env} to a newer copy.`;
  try {
    await until(/1-\d+ \[1\] $/);
    const menu = plain(out);
    assert.ok(menu.includes(`Claude, by Anthropic   problem: the copy of Claude here is version ${TOO_OLD}; Clearotron needs ${FLOOR} or newer — choose it to see the fix`),
      `the menu row does not name the old copy:\n${menu.slice(-1500)}`);
    const before = menu.length;
    child.stdin.write("1\r");
    // It carries on: the next question arrives after the fix is shown.
    await until(new RegExp(`${paragraph.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*(\\[[Yy]/[Nn]\\]|1-\\d+ \\[\\d+\\]) $`));
    const after = plain(out).slice(before);
    assert.ok(after.includes(`found ${join(dir, "claude")}`), `setup did not take the copy it found:\n${after}`);
    assert.ok(after.split("\n").some((l) => l.trim() === `! ${paragraph}`), `setup did not show the fix as its own line:\n${after}`);
  } finally {
    child.stdin.end();
    child.kill("SIGTERM");
    await new Promise((r) => (child.exitCode !== null || child.signalCode !== null ? r() : child.once("close", r)));
    for (const d of [dir, home]) rmSync(d, { recursive: true, force: true });
  }
});
