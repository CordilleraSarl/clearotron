// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — spawns the real `doctor` command nine times, once with a stand-in engine that answers a turn
//
// DOCTOR OPENS WITH WHETHER A SEARCH CAN RUN, WHAT STOPS IT, AND THE NEXT ACTION.
//
// A newcomer reads `doctor` from the top, and the top was the install's path and its build: on a packaged
// install the answer to "can this install search" was line 52 of 100, a screen away from the command that
// changes it (measured 2026-11-06). The opening now carries that answer, and every section keeps its lines:
//
//   - On a machine with no background units whose search is refused, the first line is the refusal the
//     portal gives the person who runs the install, from the same composer, with the command as doctor
//     names it everywhere else.
//   - In every other state, "Will a search run?" is the first section, and it ends with the sign-in line
//     when the program resolves.
//   - Under --probe-engine on an install that can search, the turn runs before the opening is printed,
//     and its verdict ends "Will a search run?".
//   - "Research provider" comes second in every state.
//
// The register is taken from the table and the expected sentence from the composer, so nothing here
// retypes what the product says. No real engine runs: the suite empties the engines folder, PATH holds no
// AI program, and the one turn below is answered by the suite's stand-in.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, delimiter } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { handRunEnv } from "./drive-env.mjs";
import { doctorRepoRoot } from "./helpers/portal-bundle.mjs";
import { cannotSearchYet, whatIsMissing } from "../run-requirements.mjs";
import { PROVIDERS } from "../../shared/register-selection.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = doctorRepoRoot();
const STAND_IN = join(HERE, "mock-claude.mjs");
const UNITS = (await import(pathToFileURL(join(HERE, "..", "..", "bin", "start.mjs")).href)).BACKGROUND_UNITS;

/** A directory holding only `node`, the interpreter running this suite, so the stand-in's `#!` finds it. */
const NODE_DIR = (() => {
  const d = mkdtempSync(join(tmpdir(), "doctor-opening-node-"));
  symlinkSync(process.execPath, join(d, process.platform === "win32" ? "node.exe" : "node"));
  return d;
})();

// A register with a credential, so "can search" needs every kind of setting the order-time check names.
const REG = PROVIDERS.find((p) => (p.credentials ?? []).length);
/** The settings of an install that can search: a register and its credentials, an AI, and its program. */
const CAN_SEARCH = [`CLEAROTRON_DATABASE=${REG?.id}`, ...(REG?.credentials ?? []).map((k) => `${k}=x`),
  "CLEAROTRON_AI=anthropic-agent", `CLEAROTRON_CLAUDE_PATH=${STAND_IN}`];

/**
 * A scratch home. `file` is the install's own settings file, by its lines. `units` installs the background
 * units: an array is the lines of the `~/.env` they read, and "unreadable" points them at a file that is not
 * there, so their environment cannot be read.
 */
function homeWith({ file = null, units = null } = {}) {
  const home = mkdtempSync(join(tmpdir(), "doctor-opening-"));
  if (file) {
    mkdirSync(join(home, ".config", "clearotron"), { recursive: true });
    writeFileSync(join(home, ".config", "clearotron", ".env"), file.join("\n") + "\n");
  }
  if (units) {
    const unitDir = join(home, ".config", "systemd", "user");
    mkdirSync(unitDir, { recursive: true });
    const from = units === "unreadable" ? "/nonexistent/clearotron.env" : "%h/.env";
    for (const u of UNITS) writeFileSync(join(unitDir, u), `[Service]\nEnvironmentFile=${from}\nExecStart=/bin/true\n`);
    if (Array.isArray(units)) writeFileSync(join(home, ".env"), units.join("\n") + "\n");
  }
  return home;
}

/** The real command over an EMPTY environment (handRunEnv's base), so nothing this suite exports reaches it. */
function doctor(home, args = [], extra = {}) {
  const r = spawnSync(process.execPath, [join(ROOT, "bin", "clearotron.mjs"), "doctor", ...args], {
    cwd: ROOT, encoding: "utf8", timeout: 120_000,
    env: handRunEnv({ PATH: [NODE_DIR, "/usr/bin", "/bin"].join(delimiter), HOME: home, USERPROFILE: home,
      CLEAROTRON_DOCTOR_ASSUME_PINNED: "1", ...extra }, {}),
  });
  if (r.error || r.signal) throw new Error(`doctor did not come back (signal=${r.signal} error=${r.error?.message})`);
  return `${r.stdout ?? ""}${r.stderr ?? ""}`;
}

const TITLE = "  Trademark clearance engine — configuration check";
// Every section heading doctor prints, so the order is read off the output rather than guessed from it.
const HEADINGS = new Set(["Will a search run?", "Research provider", "Deployment", "Node", "Engine", "How to run this",
  ".env", "Configuration store", "Custom instructions", "Register provider", "Case law and other capabilities",
  "Portal bundle", "Portal trigger key", "Portal sign-in", "Where files are stored", "Start-button path", "Client connector"]);
const CLOSING = "  This install cannot do everything yet:";
const isHeading = (l) => HEADINGS.has(l.trim()) && /^ {2}\S/.test(l);

/** The section headings, in the order doctor printed them. */
const headings = (out) => out.split("\n").filter(isHeading).map((l) => l.trim());
/** The lines between the title and the first heading, blank lines dropped: the opening's own words. */
function openingOf(out) {
  const lines = out.split("\n");
  const from = lines.indexOf(TITLE);
  assert.ok(from >= 0, `doctor printed no title:\n${out}`);
  const to = lines.findIndex((l, i) => i > from && isHeading(l));
  return lines.slice(from + 1, to < 0 ? undefined : to).filter((l) => l.trim());
}
/** One section's lines, from its heading to the next heading or the closing lines. */
function sectionOf(out, heading) {
  const lines = out.split("\n");
  const at = lines.findIndex((l) => isHeading(l) && l.trim() === heading);
  assert.ok(at >= 0, `doctor printed no "${heading}" section:\n${out}`);
  const end = lines.findIndex((l, i) => i > at && (isHeading(l) || l === CLOSING));
  return lines.slice(at + 1, end < 0 ? undefined : end).join("\n");
}
/** The command doctor names for setting up, as the Register provider section prints it. */
function installCommandOf(out) {
  const m = sectionOf(out, "Register provider").match(/re-run `([^`]+)` to set it/);
  assert.ok(m, `the register section names no command to set it up:\n${out}`);
  return m[1];
}
const SIGN_IN = /The engine program is installed\. Whether it is signed in cannot be read from disk: run `[^`]+doctor --probe-engine` to find out\./;

test("with no units and no search possible, doctor opens with the refusal's own words and the command that sets it up", () => {
  const home = homeWith();
  try {
    const out = doctor(home);
    // The sentence is the composer's, with nothing chosen: no AI and no register. The command is the one doctor
    // names in its register section, so the opening and the detail cannot name two different commands.
    const expected = cannotSearchYet(whatIsMissing([{ about: "register" }, { about: "ai" }]), installCommandOf(out));
    assert.deepEqual(openingOf(out), [`  ${expected}`], out);
    // The detail behind that sentence keeps its place, after Register provider, with the names to set.
    const order = headings(out);
    assert.equal(order.indexOf("Will a search run?"), order.indexOf("Register provider") + 1, order.join(" / "));
    assert.match(sectionOf(out, "Will a search run?"),
      /a search is refused until these are set in your environment file: CLEAROTRON_DATABASE, CLEAROTRON_AI/, out);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("in every other state the refusal's sentence is not printed, and \"Will a search run?\" is the first section", () => {
  assert.ok(REG, "no register declares a credential, so the install that can search below would be vacuous");
  const states = [
    { name: "an install with no units that can search", home: { file: CAN_SEARCH },
      first: /^ {2}✓ nothing a search is refused for at order time is missing from your environment file$/m },
    // Units read `~/.env`, which setup does not write, so "run setup" would not reach them: no sentence.
    { name: "units installed, and a search refused", home: { units: [] },
      first: /^ {2}! a search is refused until these are set in the units' environment: /m },
    { name: "units installed, and their environment unreadable", home: { units: "unreadable" },
      first: /the units' environment could not be read, so what a search would be refused for is NOT checked here/ },
  ];
  for (const s of states) {
    const home = homeWith(s.home);
    try {
      const out = doctor(home);
      assert.deepEqual(openingOf(out), [], `${s.name}: the opening printed words of its own:\n${out}`);
      assert.equal(headings(out)[0], "Will a search run?", `${s.name}: ${headings(out).join(" / ")}`);
      assert.match(sectionOf(out, "Will a search run?"), s.first, `${s.name}:\n${out}`);
      assert.equal(headings(out).filter((h) => h === "Will a search run?").length, 1, `${s.name}: printed twice`);
    } finally { rmSync(home, { recursive: true, force: true }); }
  }
});

test("when \"Will a search run?\" leads, it ends with the sign-in line, which the Engine section no longer prints", () => {
  const home = homeWith({ file: CAN_SEARCH });
  try {
    const out = doctor(home);
    const lead = sectionOf(out, "Will a search run?").split("\n").filter((l) => l.trim());
    assert.match(lead.at(-1), SIGN_IN, out);
    assert.doesNotMatch(sectionOf(out, "Engine"), SIGN_IN, out);
    assert.equal(out.split("\n").filter((l) => SIGN_IN.test(l)).length, 1, `the sign-in line is printed once:\n${out}`);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("under --probe-engine on an install that can search, the turn runs first and its verdict ends \"Will a search run?\"", () => {
  const home = homeWith({ file: CAN_SEARCH });
  const calls = join(home, "turns.jsonl");
  try {
    const out = doctor(home, ["--probe-engine"], { MOCK_CLAUDE_CALL_LOG: calls });
    const lines = out.split("\n");
    const probing = lines.findIndex((l) => /^ {2}Probing anthropic-agent with one turn on its cheapest model \(this SPENDS; /.test(l));
    assert.ok(probing > lines.indexOf(TITLE), `the turn was not announced:\n${out}`);
    // Announced before the heading: a line starting a section there would end it for any reader of headings.
    assert.ok(probing < lines.findIndex((l) => isHeading(l) && l.trim() === "Will a search run?"), out);
    const lead = sectionOf(out, "Will a search run?");
    assert.match(lead, /^ {2}✓ nothing a search is refused for at order time is missing from your environment file$/m, out);
    assert.match(lead, /^ {2}✓ anthropic-agent completed a turn — binary, credential and model access all work$/m, out);
    assert.match(lead, /^ {2}✓ MODE: engine ready — proven by the turn just spent/m, out);
    assert.doesNotMatch(sectionOf(out, "Engine"), /completed a turn|Probing /, out);
    assert.ok(existsSync(calls), "the stand-in engine was never started, so no turn ran");
    assert.equal(readFileSync(calls, "utf8").trim().split("\n").length, 1, "one turn, wherever it is printed");
  } finally { rmSync(home, { recursive: true, force: true }); }

  // On an install that cannot search yet, the opening is the refusal, and the turn stays in the Engine section.
  const refused = homeWith({ file: ["CLEAROTRON_AI=anthropic-agent", `CLEAROTRON_CLAUDE_PATH=${STAND_IN}`] });
  try {
    const out = doctor(refused, ["--probe-engine"], { MOCK_CLAUDE_CALL_LOG: join(refused, "turns.jsonl") });
    assert.match(openingOf(out)[0] ?? "", /^ {2}This install cannot run a search yet: no register is chosen\./, out);
    assert.match(sectionOf(out, "Engine"), /Probing anthropic-agent with one turn[\s\S]*completed a turn/, out);
    assert.doesNotMatch(sectionOf(out, "Will a search run?"), /completed a turn/, out);
  } finally { rmSync(refused, { recursive: true, force: true }); }
});

test("\"Research provider\" is the second thing doctor says, whichever way it opens", () => {
  const refused = homeWith();
  const canSearch = homeWith({ file: CAN_SEARCH });
  try {
    // Opened by the refusal's sentence, which is not a section: Research provider is the first section.
    const a = doctor(refused);
    assert.equal(headings(a)[0], "Research provider", headings(a).join(" / "));
    assert.match(sectionOf(a, "Research provider"), /PERPLEXITY_API_KEY is not set — the three clearance searches/, a);
    // Opened by "Will a search run?": Research provider follows it.
    const b = doctor(canSearch);
    assert.deepEqual(headings(b).slice(0, 2), ["Will a search run?", "Research provider"], headings(b).join(" / "));
    for (const out of [a, b]) assert.equal(headings(out).filter((h) => h === "Research provider").length, 1, out);
  } finally {
    rmSync(refused, { recursive: true, force: true });
    rmSync(canSearch, { recursive: true, force: true });
  }
});
