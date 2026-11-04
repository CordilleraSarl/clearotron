// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE ENGINE LINE AGREES WITH WHAT REFUSES A SEARCH.
//
// With no AI chosen, doctor said "CLEAROTRON_AI is not set — the code default is anthropic-agent", and a
// few lines further down listed CLEAROTRON_AI among the settings a search is refused until they are set
// (measured on a fresh install of a beta, 2026-11-04). Both cannot be true. The code decides: the check
// every search passes at order time names CLEAROTRON_AI whenever it is unset, default or no default, so
// the engine line was the false one. It now says what that check says.
//
// The first arm pins the code's answer, so the sentence is checked against behaviour and not against
// itself. The controls are the same machine with an AI chosen, where the line names it and nothing is
// refused over it, and a machine whose background services hold the AI that this command's own file does
// not, where no search is refused either, so the engine line must not say one is.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { handRunEnv } from "./drive-env.mjs";
import { orderTimeRefusal, ENGINE_ENV } from "../run-requirements.mjs";
import { ENGINE_BINARIES, DEFAULT_ENGINE_ID } from "../driver.config.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ONBOARD = join(HERE, "..", "..", "bin", "onboard.mjs");
const { BACKGROUND_UNITS } = await import(pathToFileURL(join(HERE, "..", "..", "bin", "start.mjs")).href);

const NODE_BIN = (() => {
  const d = mkdtempSync(join(tmpdir(), "engine-line-node-"));
  symlinkSync(process.execPath, join(d, "node"));
  return d;
})();

/** `clearotron doctor` in a home whose environment file holds `envText`, from an empty shell. With
 *  `unitsEnv`, the background units are installed too, reading `<home>/.env`, which holds it. */
function doctor(envText, unitsEnv = null) {
  const home = mkdtempSync(join(tmpdir(), "engine-line-"));
  try {
    mkdirSync(join(home, ".config", "clearotron"), { recursive: true });
    writeFileSync(join(home, ".config", "clearotron", ".env"), envText);
    if (unitsEnv !== null) {
      const unitDir = join(home, ".config", "systemd", "user");
      mkdirSync(unitDir, { recursive: true });
      for (const u of BACKGROUND_UNITS) writeFileSync(join(unitDir, u), "[Service]\nEnvironmentFile=%h/.env\nExecStart=/bin/true\n");
      writeFileSync(join(home, ".env"), unitsEnv);
    }
    try {
      return execFileSync(process.execPath, [ONBOARD, "--check"], {
        encoding: "utf8", stdio: "pipe", timeout: 120_000,
        env: handRunEnv({ HOME: home, USERPROFILE: home, PATH: [NODE_BIN, "/usr/bin", "/bin"].join(":"), CLEAROTRON_DOCTOR_ASSUME_PINNED: "1" }, {}),
      });
    } catch (e) { return `${e.stdout ?? ""}${e.stderr ?? ""}`; }
  } finally { rmSync(home, { recursive: true, force: true }); }
}

const section = (out, heading) => {
  const lines = out.split("\n");
  const at = lines.findIndex((l) => l.trim() === heading);
  assert.ok(at >= 0, `doctor printed no "${heading}" section:\n${out}`);
  const end = lines.findIndex((l, i) => i > at && /^ {2}\S/.test(l) && !/^ {2}[·!✓✗]/.test(l));
  return lines.slice(at + 1, end < 0 ? undefined : end).join("\n");
};

test("the code's answer: a search is refused while no AI is chosen, though the code has a default", () => {
  assert.ok(DEFAULT_ENGINE_ID, "the code has no default AI any more, so this arm's premise is gone");
  const refusal = orderTimeRefusal({ CLEAROTRON_DATABASE: "free-tier", CLEAROTRON_REPORTS_DIR: "/srv/pool" },
    { engines: ENGINE_BINARIES, defaultEngine: DEFAULT_ENGINE_ID });
  assert.ok(refusal?.names.includes(ENGINE_ENV), `a search is not refused over an unset ${ENGINE_ENV}; the engine line may need the old sentence back`);
});

test("with no AI chosen, the engine line says a search is refused, as the search check does", () => {
  const out = doctor("CLEAROTRON_REPORTS_DIR=/srv/pool\n");
  const engine = section(out, "Engine");
  const line = engine.split("\n").find((l) => l.includes(`${ENGINE_ENV} is not set`));
  assert.ok(line, `the engine section no longer says ${ENGINE_ENV} is unset:\n${engine}`);
  assert.doesNotMatch(line, /default/i, `the engine line offers a default that no search would use:\n${line}`);
  assert.match(line, /a search is refused until one is/, `the engine line does not say a search is refused:\n${line}`);
  assert.doesNotMatch(line, /\bbox\b/i, `the engine line uses an internal word:\n${line}`);
  assert.match(section(out, "Will a search run?"), new RegExp(`refused until .*\\b${ENGINE_ENV}\\b`),
    "the search check no longer lists the unset AI, so the two lines are no longer about the same thing");
});

test("the control: with an AI chosen, the line names it and no search is refused over it", () => {
  const out = doctor(`CLEAROTRON_REPORTS_DIR=/srv/pool\n${ENGINE_ENV}=${DEFAULT_ENGINE_ID}\n`);
  const engine = section(out, "Engine");
  assert.match(engine, new RegExp(`✓ ${DEFAULT_ENGINE_ID} \\(`), engine);
  assert.doesNotMatch(engine, new RegExp(`${ENGINE_ENV} is not set`));
  assert.doesNotMatch(section(out, "Will a search run?"), new RegExp(`refused until .*\\b${ENGINE_ENV}\\b`));
});

test("the control: services that hold the AI this command's file lacks are not said to refuse a search", () => {
  assert.ok(BACKGROUND_UNITS.length > 0, "no background units to install, so this arm would measure a machine without them");
  const out = doctor("", `CLEAROTRON_REPORTS_DIR=/srv/pool\n${ENGINE_ENV}=${DEFAULT_ENGINE_ID}\n`);
  assert.doesNotMatch(section(out, "Will a search run?"), new RegExp(`refused until .*\\b${ENGINE_ENV}\\b`),
    "the services' own AI was not read, so this arm is not about what it claims");
  assert.doesNotMatch(section(out, "Engine"), /a search is refused/, "the engine line refuses a search the services would run");
});
