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
// The record holds the two names and nothing else. Each must name an engine this driver ships or a register it
// knows, so no other string (a credential included) can be written into it.
//
// A LEAF: it reads the shipped-engine table, not the engine registry. The jurisdiction lanes' turn runner reads the
// record, tool servers reach that runner, and the registry would bring both engine adapters and every setting they
// read into each tool server's imports. The registry's `engineForRun` serves a run's turns from this record.
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { driverDir, ensureDriverDir } from "../../shared/driver-dir.mjs";
import { ENGINE_BINARIES, PROVIDERS, REGISTER_PROVIDER, activeProvider } from "../driver.config.mjs";

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
  if (!e || !Object.hasOwn(ENGINE_BINARIES, e))
    throw new Error(`run-choices: "${e}" is not an engine this driver ships (${Object.keys(ENGINE_BINARIES).join(", ")})`);
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
 * A resumed run whose recorded engine or register this process cannot serve.
 *
 * It is a PARK, not a failure. It is raised before any check spends anything and before the run's markers are cleared,
 * so the run keeps every stage it finished, and `dependency` names what it waits for. The pipeline holds the run until
 * a process that serves the recorded choice resumes it. There is no deadline, and the run is never moved to the
 * machine's choice. `run` is the run's identity, because this is raised before the pipeline holds one.
 *
 * `kind` is one of:
 *   register        this runner cannot serve the run's register: a credential or a capability it needs is missing here;
 *   engine          this driver has no adapter for the run's engine;
 *   engine-program  the run's engine program is not installed here;
 *   engine-sign-in  the run's engine refused a turn for a configuration fault (signed out, no key).
 */
export const RUN_CHOICE_KINDS = Object.freeze(["register", "engine", "engine-program", "engine-sign-in"]);
export class RunChoiceUnavailable extends Error {
  constructor({ kind, recorded, machine = null, detail = null, run = null }) {
    if (!RUN_CHOICE_KINDS.includes(kind)) throw new Error(`RunChoiceUnavailable: unknown kind "${kind}"`);
    const what = kind === "register" ? `the ${recorded} register` : `the ${recorded} engine`;
    const why = kind === "register" ? "this runner cannot serve it"
      : kind === "engine" ? "this driver has no adapter for it"
      : kind === "engine-program" ? "its program is not installed here"
      : "it cannot take a turn here";
    super(`run ${run?.codename ?? "(unnamed)"} started on ${what}, and ${why}${detail ? ` (${String(detail).slice(0, 300)})` : ""}. It is parked with its work kept, and resumes on ${what}.`);
    this.name = "RunChoiceUnavailable";
    this.dependency = { kind, recorded, machine, detail: detail == null ? null : String(detail).slice(0, 300) };
    this.run = run;
    // For the park's own record, as the rate-limit park writes its two lines: what it waits for, and what ends the wait.
    this.waitingOn = `${what}, which this run started on (${why})`;
    this.resolvedBy = kind === "register"
      ? `${what}'s credentials and capabilities set for this runner, on this build; the run resumes where it stopped`
      : `${what} made available to this runner (installed and signed in), on this build; the run resumes where it stopped`;
  }
}

/**
 * Which recorded choice this process cannot serve, before anything is checked or spent, or null. The engine is
 * unservable here only when no adapter is registered for it; a missing program or sign-in is found by the engine doors.
 * The register is not decided here: a recorded register is served wherever this runner holds what it needs, whatever
 * the machine's default, and the register's own door finds out (`registerEnvFor`, steps/open-run.mjs). PURE.
 */
export function unservedChoice(recorded, { engineRegistered }) {
  if (recorded?.state !== "recorded") return null;
  if (!engineRegistered) return { kind: "engine", recorded: recorded.engine, machine: null };
  return null;
}

/**
 * The environment the register's door checks for this run: a copy of `env` naming the run's recorded register, or `env`
 * itself for a run with no record or one that started with none set. A copy, so one run's register never changes the
 * process environment every concurrent run shares. PURE.
 */
export function registerEnvFor(recorded, env = process.env) {
  return recorded?.state === "recorded" && recorded.register ? { ...env, CLEAROTRON_DATABASE: recorded.register } : env;
}

/**
 * The register door a run meets: null where it skips the door, else `{ env, parks }`. `env` is what the door checks
 * (`registerEnvFor`), and `parks` says a refusal parks the run rather than failing it, which it does only for a
 * recorded register that is not the machine's. A run whose record fetches are injected (an offline replay) skips the
 * door. So does a Knockout on the machine's own register, as it always has; a Knockout recorded on another register
 * meets the door, because its counts and filings are that register's. PURE.
 */
export function registerDoor(recorded, { machineRegister = null, knockout = false, fetchesInjected = false, env = process.env } = {}) {
  if (fetchesInjected) return null;
  const differs = recorded?.state === "recorded" && Boolean(recorded.register) && recorded.register !== (machineRegister ?? null);
  if (knockout && !differs) return null;
  return { env: registerEnvFor(recorded, env), parks: differs };
}

/**
 * The register that serves this run: the one it recorded when it started, or the machine's for a run with no record or
 * one that started with none set, whatever the machine's default is now. It is the one place a run's register is
 * decided. A recorded register this runner cannot serve parks the run at the register's door before any stage. PURE
 * but for reading the record.
 */
export function registerForRun(runDir) {
  const rec = readRunChoices(runDir);
  return rec.state === "recorded" && rec.register ? rec.register : (REGISTER_PROVIDER ?? null);
}

/** The register the run recorded, or null for a run with no record or one that started with none set. PURE but for the read. */
export function recordedRegister(runDir) {
  const rec = readRunChoices(runDir);
  return rec.state === "recorded" && rec.register ? rec.register : null;
}

/**
 * The register adapter for a run's register (`ctx.register`), or the machine's when none is named: the one way a place
 * that reads a register for a run asks for its adapter. A name this driver does not know throws, as `activeProvider` does.
 */
export function registerAdapter(register = null) {
  if (!register) return activeProvider();
  const a = PROVIDERS[register];
  if (!a) throw new Error(`[register-provider] unknown register "${register}". Known: ${Object.keys(PROVIDERS).join(", ")}`);
  return a;
}
