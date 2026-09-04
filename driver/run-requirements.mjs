// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// run-requirements.mjs — what a clearance needs from its environment, in ONE place.
//
// ── THE OUTCOME THIS EXISTS TO STOP ─────────────────────────────────────────────────────────────────
//
// A lawyer ordered a Knockout search on a fully configured install that had delivered a real report an
// hour earlier. It failed at the first stage with `CLEAROTRON_DATABASE is not set`, and what reached the
// client was: "stopped before it finished, and nothing was delivered. Clearotron has been notified and
// will follow up." Nobody had been notified — the box has no outbox.
//
// The only difference between that run and the delivered one was HOW THE PRODUCT WAS STARTED.
// `clearotron start` hands its children the supervisor's own environment by inheritance.
// `clearotron start --background` installs user units that read `%h/.env` with
// `CLEAROTRON_NO_ENV_FILE=1`, which severs that inheritance — so only what the supervisor WRITES
// survives. It wrote the paths and the door secrets. It did not write the register, its credential, the
// research key, the engine or the engine path: everything that makes a clearance possible.
//
// ── ONE AUTHORITY, TWO USES, AND THAT IS THE WHOLE DESIGN ───────────────────────────────────────────
//
// The same list composes the unit environment and guards it. A composer and a checker written
// separately are two opinions about what a run needs, and they drift in the direction that hurts: the
// checker passes because it asks for less than the composer forgot.
//
// ── DERIVED, NEVER RE-LISTED — AND THE TABLES ARE HANDED IN ─────────────────────────────────────────
//
// Which credential a register needs is the wizard's register table (`bin/onboard.mjs` PROVIDERS, the
// SELECTION table an operator picks from — not `driver.config.mjs`'s adapter table of the same name,
// which is keyed differently and carries a different field). Which binary an engine needs is
// `ENGINE_BINARIES[…].env`. Both already exist and are already what the wizard and the doctor read; a
// hand-written copy here would be a third opinion that goes stale the first time a provider gains a
// credential — silently, because a shorter list passes.
//
// They are PARAMETERS rather than imports, and that is deliberate: this module lives under `driver/`
// and the register table lives in a CLI entry point, so importing it would point the driver at `bin/`.
// The caller already holds both tables legitimately. Same shape, and the same reason, as
// `liveRunDirs(studioRoots)` taking its roots rather than reading config.
//
// ── AND THE LINE BETWEEN "REFUSE" AND "SAY SO", WHICH IS A PRODUCT DECISION AND NOT A TIDY ONE ──────
//
// A guard that refuses on everything a run COULD want turns working installs into dead ones. Measured
// against the product's own behaviour rather than assumed:
//
//   BLOCKING — without these nothing runs at all, in any product. The register and its credential (the
//     driver throws by name at the first stage), the engine and the binary it drives, and the pool the
//     report is written into. This is the set whose absence produced the outcome at the top of this file.
//
//   NARROWING — `PERPLEXITY_API_KEY`. Its absence does NOT crash a run and does not deliver a false
//     notice: the three clearance searches carry the common-law grid and cannot switch it off, so they
//     refuse AT PREFLIGHT, honestly, before anything is spent — and a Knockout search still runs and
//     discloses the half it skipped. Refusing to start over it would take a box that can legitimately
//     serve Knockout searches and stop it serving anything, which is a worse client outcome than the one
//     this module was written to fix. It is carried into the environment like everything else and named
//     to the operator; it is not a reason to refuse.
//
// The split is about what the CLIENT receives, not about how important a value feels.

/** The pool a report is written into. Named once; the supervisor already writes it. */
export const POOL_ENV = "CLEAROTRON_REPORTS_DIR";
/** The register selection, and the engine selection. */
export const REGISTER_ENV = "CLEAROTRON_DATABASE";
export const ENGINE_ENV = "CLEAROTRON_AI";
/** Narrowing, never blocking — see the header. */
export const RESEARCH_ENV = "PERPLEXITY_API_KEY";

const val = (env, name) => String(env?.[name] ?? "").trim();

/**
 * Every environment name this box's configuration says a clearance needs, with the reason each one is
 * there and whether its absence blocks or narrows.
 *
 * Takes the environment rather than reading `process.env`, because both callers have a DIFFERENT
 * environment in hand: the composer has the supervisor's, and the guard has the one it just wrote into
 * the unit file. A function that read the ambient environment would answer about neither.
 *
 * PURE.
 */
export function runRequirements(env = {}, { registers = [], engines = {}, defaultEngine = null } = {}) {
  const out = [];
  const push = (name, blocking, why) => out.push({ name, blocking, why, present: Boolean(val(env, name)) });

  push(POOL_ENV, true, "the directory a finished report is written into — without it a run has nowhere to deliver");

  // ── THE REGISTER, AND ITS CREDENTIALS FROM THE PROVIDER'S OWN ROW ────────────────────────────────
  const register = val(env, REGISTER_ENV);
  push(REGISTER_ENV, true, "the register a search reads — the driver refuses by name at the first stage when it is unset, and there is no default");
  const spec = (registers ?? []).find((p) => p.id === register);
  if (spec) {
    for (const k of spec.credentials ?? [])
      push(k, true, `required by the ${spec.id} register — a run cannot verify a registry citation without it`);
    // OPTIONAL ON THE PROVIDER'S OWN TERMS: an absent one narrows the offices searched and the run
    // DISCLOSES what it could not reach. Carried, named, never blocking.
    for (const k of spec.optionalCredentials ?? [])
      push(k, false, `${spec.id} runs without it and discloses the offices it cannot reach as deferred coverage`);
  }
  // A register naming no adapter is not this module's refusal to make — `requireRegisterProvider` owns
  // that sentence and says it better. What is reported here is only that the NAME is set.

  // ── THE ENGINE, AND THE BINARY IT DRIVES ─────────────────────────────────────────────────────────
  push(ENGINE_ENV, true, "which reasoning engine runs the stages");
  const engine = (engines ?? {})[val(env, ENGINE_ENV) || defaultEngine || ""];
  if (engine?.env)
    push(engine.env, true, `the path to the ${engine.vendor} CLI this engine drives — a stage cannot dispatch without it`);
  if (engine?.authEnv)
    push(engine.authEnv, false, "how the engine bills — subscription or key; the adapter refuses before spending if the sign-in it names is absent");

  push(RESEARCH_ENV, false, "the three clearance searches carry the common-law grid and refuse at preflight without it; a Knockout search still runs and discloses the half it skipped");

  return out;
}

/**
 * The names a composer must carry into a unit environment: everything above, blocking or not.
 *
 * NARROWING VALUES TRAVEL TOO. The split in the header is about what may REFUSE A START, never about
 * what may be dropped on the floor — a research key left behind turns three of the four products off on
 * a box whose operator configured them, which is the same shape of defect one size down.
 */
export function runRequiredNames(env = {}, tables = {}) {
  return runRequirements(env, tables).map((r) => r.name);
}

/**
 * What is missing, split the way the header splits it.
 *
 * `blocking` is what a start may refuse over. `narrowing` is what an operator must be TOLD and never
 * refused over. A caller that treats the two the same has re-made the decision this module exists to
 * hold in one place.
 */
export function missingRequirements(env = {}, tables = {}) {
  const rows = runRequirements(env, tables).filter((r) => !r.present);
  return { blocking: rows.filter((r) => r.blocking), narrowing: rows.filter((r) => !r.blocking) };
}
