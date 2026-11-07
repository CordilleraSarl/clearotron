// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — spawns the real `doctor` command four times, with stand-in engine programs only
//
// DOCTOR READS ONLY THE AI THAT IS CHOSEN.
//
// With no AI chosen, every search is refused until one is, and doctor's Engine section says so in its first
// line. Everything after that line was read off the code's default AI, which nobody chose. Measured on a
// fresh install of 0.5.1-beta.0, 2026-11-07:
//   - with the default's program on the machine, the billing line was ticked for its subscription;
//   - `--probe-engine` spent a turn on that program and called the install ready;
//   - a machine with only Codex was told no `claude` was on its PATH, and that nothing could be probed.
// Now the section says no AI is chosen and that the machine is in demo mode, and it starts no program at all.
// With an AI chosen, it reads that AI, as it did.
//
// DRIVEN AS A READER MEETS IT: the real command, in a home of its own, on a PATH holding nothing but a
// stand-in program and the system's tools. Each stand-in writes down every time it is started, `--version`
// included, so "doctor started nothing" is read off the program itself and not off what doctor says.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { handRunEnv } from "./drive-env.mjs";
import { doctorRepoRoot } from "./helpers/portal-bundle.mjs";
import { ENGINE_BINARIES } from "../driver.config.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const DOCTOR_ROOT = doctorRepoRoot();
// A program this stand-in answers `--version` with: the engine's own floor, so no floor line is printed.
const versionOf = (engine) => ENGINE_BINARIES[engine].floor;
const NO_AI = "CLEAROTRON_AI is not set, so no AI is chosen, and a search is refused until one is.";
const SKIP = process.platform === "win32" && "the stand-ins are shell scripts, and Windows starts none";

/**
 * A machine of its own: a home holding the install's settings file with `settings` in it, and one stand-in
 * engine program, `name`, on a PATH of its own. The stand-in logs each start to a file, then answers
 * `--version` or runs the suite's mock of that engine.
 */
function machine({ name, engine, mock, settings = [] }) {
  const home = mkdtempSync(join(tmpdir(), "doctor-chosen-ai-"));
  const bin = join(home, "programs");
  mkdirSync(bin, { recursive: true });
  mkdirSync(join(home, ".config", "clearotron"), { recursive: true });
  writeFileSync(join(home, ".config", "clearotron", ".env"), settings.length ? `${settings.join("\n")}\n` : "");
  const calls = join(home, `${name}-started.log`);
  const program = join(bin, name);
  writeFileSync(program, [
    "#!/bin/sh",
    `echo "$*" >> "${calls}"`,
    `case " $* " in *" --version "*) echo "${versionOf(engine)} (stand-in)"; exit 0;; esac`,
    `exec "${process.execPath}" "${join(HERE, mock)}" "$@"`,
  ].join("\n") + "\n");
  chmodSync(program, 0o755);
  const engines = join(home, "no-engines-installed");
  mkdirSync(engines);
  return {
    home, program,
    started: () => (existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n").filter(Boolean) : []),
    doctor: (...args) => {
      const r = spawnSync(process.execPath, [join(DOCTOR_ROOT, "bin", "clearotron.mjs"), "doctor", ...args], {
        cwd: DOCTOR_ROOT, encoding: "utf8", timeout: 120000,
        env: handRunEnv({ PATH: `${bin}:/usr/bin:/bin`, HOME: home, USERPROFILE: home,
          CLEAROTRON_DOCTOR_ASSUME_PINNED: "1", CLEAROTRON_ENGINES_DIR: engines }, {}),
      });
      if (r.error || r.signal) throw new Error(`doctor did not come back (signal=${r.signal} error=${r.error?.message}) — a could-not-look, not a verdict`);
      return `${r.stdout ?? ""}${r.stderr ?? ""}`;
    },
    done: () => rmSync(home, { recursive: true, force: true }),
  };
}

/** The Engine section of a doctor run: from its heading to the next one. */
const engineSection = (out) => {
  const lines = out.split("\n");
  const at = lines.findIndex((l) => l === "  Engine");
  assert.ok(at >= 0, `doctor printed no Engine section:\n${out.slice(0, 800)}`);
  const end = lines.findIndex((l, i) => i > at && /^ {2}\S/.test(l) && !/^ {2}[·✓✗⚠]/.test(l));
  return lines.slice(at, end < 0 ? undefined : end).join("\n");
};

test("with no AI chosen and Claude's program on the machine, doctor ticks no billing, starts no program and spends no turn", { skip: SKIP }, () => {
  const m = machine({ name: "claude", engine: "anthropic-agent", mock: "mock-claude.mjs" });
  try {
    const plain = m.doctor();
    const probed = m.doctor("--probe-engine");
    for (const [what, out] of [["doctor", plain], ["doctor --probe-engine", probed]]) {
      const section = engineSection(out);
      assert.doesNotMatch(section, /billing:/, `${what} described the default AI's billing:\n${section}`);
      assert.doesNotMatch(out, /Probing |completed a turn|MODE: engine ready/, `${what} proved an AI nobody chose:\n${out}`);
      assert.doesNotMatch(out, /The engine program is installed/, `${what} sent the reader to prove an AI nobody chose:\n${out}`);
      assert.ok(section.includes(NO_AI), `${what} no longer says no AI is chosen:\n${section}`);
      assert.match(section, /MODE: demo — everything works except starting a NEW search\./, `${what} named no mode:\n${section}`);
    }
    // THE WITNESS: the program itself was never started, not even to say its version.
    assert.deepEqual(m.started(), [], "doctor started the program of an AI nobody chose");
    // Nothing was spent, so the closing line still says nothing was written.
    assert.match(probed, /Nothing was written\./, probed);
  } finally { m.done(); }
});

test("on a machine with only Codex and no AI chosen, doctor names no `claude`; with Codex chosen, it reads Codex", { skip: SKIP }, () => {
  const none = machine({ name: "codex", engine: "openai-agent", mock: "mock-codex.mjs" });
  const chosen = machine({ name: "codex", engine: "openai-agent", mock: "mock-codex.mjs", settings: ["CLEAROTRON_AI=openai-agent"] });
  try {
    const out = none.doctor("--probe-engine");
    const section = engineSection(out);
    assert.doesNotMatch(section, /`claude`/, `a machine with no AI chosen was told about a program it never chose:\n${section}`);
    assert.doesNotMatch(section, /not probed — there is no usable binary to probe/, `it was told its Codex is not a usable program:\n${section}`);
    assert.doesNotMatch(section, /billing:/, section);
    assert.deepEqual(none.started(), [], "doctor started a program with no AI chosen");
    // THE CONTROL, so the arms above can fail: with Codex chosen, the section names Codex's program, says how
    // it is paid for, and starts it to read its version, which the witness above would have seen.
    const read = engineSection(chosen.doctor());
    assert.ok(read.includes(`✓ openai-agent (.env) — ${ENGINE_BINARIES["openai-agent"].label}`), read);
    assert.ok(read.includes(`✓ ${chosen.program} — on PATH, version ${versionOf("openai-agent")}`), read);
    assert.match(read, /✓ billing: /, read);
    assert.doesNotMatch(read, /`claude`|anthropic-agent/, read);
    assert.ok(chosen.started().length > 0, "the witness never saw doctor start the program it reads, so its silence above proves nothing");
  } finally { none.done(); chosen.done(); }
});
