// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// run-choices.mjs — the engine and the register a run started on, frozen in the run so a resume keeps them.
//
// Both used to be read from the environment at every activation and recorded nowhere. A run parked on one engine
// and resumed after the machine's setting changed carried on under the other, and nothing in its record said so.
// The choice is now written once, when the run starts, and belongs to the run from then on:
//
//   - a later change to the machine's setting applies to new runs only;
//   - a resumed run keeps its recorded engine, and one this driver cannot serve is refused by name rather than
//     swapped for the machine's default;
//   - a run with no record is left without one. Nothing here writes a record for a run that has already started,
//     because that would date today's setting back to a start nobody recorded.
//
// The record holds the two names and nothing else. Each must name an engine this driver has registered or a
// register it knows, so no other string (a credential included) can be written into it.
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { driverDir, ensureDriverDir } from "../../shared/driver-dir.mjs";
import { PROVIDERS } from "../driver.config.mjs";
import { DEFAULT_ENGINE, engineNamed, registeredEngines, selectEngine } from "./registry.mjs";

export const RUN_CHOICES_FILE = "run-choices.json";

const nameOf = (v) => (v == null ? null : String(v).trim().toLowerCase() || null);

/**
 * Write the run's engine and register, once. A record already on disk is never rewritten: the call answers
 * with what is there and `written: false`, so a cold start that is retried keeps its first choice.
 * `register` is null when the machine has none set; that is recorded as it was, not guessed.
 */
export function recordRunChoices(runDir, { engine, register }) {
  const held = readRunChoices(runDir);
  if (held.state !== "none") return { written: false, ...held };
  const e = nameOf(engine), r = nameOf(register);
  if (!e || !registeredEngines().includes(e))
    throw new Error(`run-choices: "${e}" is not an engine this driver has registered (${registeredEngines().join(", ")})`);
  if (r !== null && !Object.hasOwn(PROVIDERS, r))
    throw new Error(`run-choices: "${r}" is not a register this driver knows (${Object.keys(PROVIDERS).join(", ")})`);
  ensureDriverDir(runDir);
  const p = driverDir(runDir, RUN_CHOICES_FILE);
  writeFileSync(`${p}.tmp`, JSON.stringify({ schema: 1, engine: e, register: r }, null, 2) + "\n");
  renameSync(`${p}.tmp`, p);
  return { written: true, state: "recorded", engine: e, register: r };
}

/**
 * What the run recorded: `{ state: "recorded", engine, register }`, `{ state: "none" }` for a run that has no
 * record, or `{ state: "unreadable", detail }` for one whose record does not read back as the two names.
 */
export function readRunChoices(runDir) {
  if (!runDir) return { state: "none" };
  const p = driverDir(runDir, RUN_CHOICES_FILE);
  if (!existsSync(p)) return { state: "none" };
  let o;
  try { o = JSON.parse(readFileSync(p, "utf8")); }
  catch (err) { return { state: "unreadable", detail: `does not parse: ${String(err?.message ?? err).slice(0, 200)}` }; }
  const engine = nameOf(o?.engine), register = nameOf(o?.register);
  if (!engine) return { state: "unreadable", detail: "names no engine" };
  if (o?.register != null && typeof o.register !== "string") return { state: "unreadable", detail: "its register is not a name" };
  return { state: "recorded", engine, register };
}

/**
 * The engine that serves this run's turns. A run with a record gets its recorded engine whatever the machine's
 * setting now says; a run with none gets the machine's engine, as every run did before the record existed.
 * A recorded engine this driver cannot serve, or a record that does not read back, throws by name: the run's
 * turns never fall through to a different engine.
 */
export function engineForRun(runDir) {
  const rec = readRunChoices(runDir);
  if (rec.state === "none") return selectEngine();
  if (rec.state === "unreadable")
    throw new Error(`this run's engine record (_driver/${RUN_CHOICES_FILE}) ${rec.detail}, so its turns are not run on the machine's engine in its place`);
  const engine = engineNamed(rec.engine);
  if (!engine)
    throw new Error(`this run started on the "${rec.engine}" engine, which this driver does not have registered (${registeredEngines().join(", ")}); it keeps that engine rather than switch to ${nameOf(process.env.CLEAROTRON_AI) ?? DEFAULT_ENGINE}`);
  return engine;
}
