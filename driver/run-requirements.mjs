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
//
// ── AND WHEN EACH ONE IS ASKED FOR, WHICH IS A SECOND AXIS AND NOT THE SAME ONE ─────────────────────
//
// Ruling 2026-09-06, in session: "someone can install and select key later so it should still
// start." So a hosted install comes up with no register configured — the doors answer, the portal
// answers, and the box is a working install waiting for one value.
//
// THE PROTECTION MOVES; IT DOES NOT GO AWAY. What F41 cost was never the refusal, it was a run that
// died at its first stage and told a client "Clearotron has been notified" on a box that notified
// nobody. That outcome is impossible whether the refusal lands at start or at order time, and only one
// of the two also bricks an install somebody is halfway through configuring.
//
//   at:"start"   the value START ITSELF WRITES. Absent, this process failed to do its own job, and the
//     units it is about to place would read a file missing something no operator was ever asked for.
//     Refusing here is refusing over OUR bug, and there is nothing for a reader to go and set.
//
//   at:"order"   the value an OPERATOR supplies — the register, its credential, the engine and the
//     binary it drives. Absent, the install is not finished. The doors come up and every run is refused
//     AT ORDER TIME, before a stage dispatches and before anything is spent, naming what is missing.
//
// The axis is on the ROW, not in the caller, for the reason the whole module exists: a start that
// decides for itself which names are its own and a runner that decides separately are two opinions
// about one list, and they drift in the direction where the second asks for less.

/** The pool a report is written into. Named once; the supervisor already writes it. */
export const POOL_ENV = "CLEAROTRON_REPORTS_DIR";
/** The register selection, and the engine selection. */
export const REGISTER_ENV = "CLEAROTRON_DATABASE";
export const ENGINE_ENV = "CLEAROTRON_AI";
/** Narrowing, never blocking — see the header. */
export const RESEARCH_ENV = "PERPLEXITY_API_KEY";

/** WHEN a blocking value is asked for. `START` is what `clearotron start` writes itself; `ORDER` is what
 *  an operator configures, and its absence refuses a RUN rather than an install. See the header. */
export const START = "start";
export const ORDER = "order";

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
  const push = (name, blocking, why, at = ORDER) =>
    out.push({ name, blocking, why, at, present: Boolean(val(env, name)) });

  // WRITTEN BY START ITSELF, so its absence is this product's fault and not a reader's — see the header.
  push(POOL_ENV, true, "the directory a finished report is written into — without it a run has nowhere to deliver", START);

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
  const blocking = rows.filter((r) => r.blocking);
  return {
    blocking,
    narrowing: rows.filter((r) => !r.blocking),
    // THE TWO HALVES OF `blocking`, SPLIT HERE AND NOWHERE ELSE. A caller that filtered on `at` itself
    // would be the second opinion this module exists to prevent — and the failure mode is the quiet one:
    // a start that decides fewer names are its own than the runner thinks, so neither refuses.
    /** What a START may refuse over: only what start itself writes. */
    atStart: blocking.filter((r) => r.at === START),
    /** What an ORDER must refuse over, before a stage dispatches and before anything is spent. */
    atOrder: blocking.filter((r) => r.at === ORDER),
  };
}

/**
 * The order-time refusal, in two vocabularies, from ONE list.
 *
 * `operator` NAMES THE VARIABLES AND THE FILE, because the person reading it can go and set them.
 * `client` NAMES NEITHER, and that is not tidiness: `driver/test/portal-service.test.mjs` refuses any
 * `CLEAROTRON_*` or variable-shaped name in a body a browser renders, and it is right to — a client
 * cannot act on an environment variable and should never be shown one.
 *
 * BOTH ARE HONEST REFUSALS. Neither says the run was accepted, neither promises a report, and neither
 * says anybody has been notified — which is the sentence F41 delivered while nobody had been.
 *
 * Returns null when nothing blocks, so a caller cannot mistake "configured" for "could not look".
 */
export function orderTimeRefusal(env = {}, tables = {}, { envFile = null, readFile = null, startFile = null } = {}) {
  const missing = missingRequirements(env, tables).atOrder;
  if (!missing.length) return null;
  const names = missing.map((r) => r.name);
  // EVERY FILE THAT REACHES THIS RUN, EACH NAMED BY WHAT READS IT — the rule `bin/start.mjs` already
  // follows, for the reason it gives: two copies of this sentence is how one of them comes to name a file
  // the reader cannot use. This copy named only `envFile`, the file background units read. A runner
  // started from a terminal on a box with no units reads the install's own file instead, so its operator
  // was told to create a file nothing on that box reads — and the one actually read went unnamed.
  // `readFile` is the file THIS process loaded at start; it is null under a unit, where the unit's own
  // EnvironmentFile is the only configuration and `envFile` alone is the true answer.
  //
  // AND A RUNNER THAT `clearotron start` STARTED READ NO FILE EITHER. The supervisor read the install's own
  // file and handed its values down with CLEAROTRON_NO_ENV_FILE=1, so `readFile` is null there exactly as
  // it is under a unit, and this sentence named the units' file: on a box with no units, a file that does
  // not exist, while the file the values came from went unnamed. Measured on a fresh install, 2026-09-10.
  // `startFile` is the file that supervisor read. It reaches the runner as a command-line flag that a unit's
  // fixed ExecStart never carries, so it is set exactly when `clearotron start` is the parent.
  const cmd = "`clearotron install` in a terminal, which writes them for you";
  const both = readFile && envFile && readFile !== envFile;
  const one = readFile || envFile;
  const where = both
    ? ` Set them in either of these — both reach a run:\n      ${readFile} — the file this runner read when it started\n`
      + `      ${envFile} — the file background units read\n  then restart, or run ${cmd}.`
    : !readFile && startFile
      ? ` Set them in ${startFile} — the file \`clearotron start\` read when it started this runner — then restart it, or run ${cmd}.`
    : one
      ? ` Set them in ${one} and restart, or run ${cmd}.`
      : " Run `clearotron install` in a terminal to configure them, or set them in the file this install's units read.";
  return {
    names,
    operator: `this installation cannot run a search yet — it is installed but not configured:\n`
      + missing.map((r) => `    ${r.name} — ${r.why}`).join("\n")
      + `\n\n  Nothing has been searched and nothing has been spent.${where}`,
    // ONE SENTENCE, NO NAMES, AND NO PROMISE. "Contact" rather than "we have been notified": this
    // product has no outbox on a box in this state, so a notice would be the F41 lie one level up.
    client: "This installation is not configured to run searches yet. Nothing has been searched and "
      + "nothing has been charged. Please contact whoever administers it.",
  };
}

// THE ENV FILE `clearotron start` READ, when it started this runner: the one file a refusal can honestly
// name for a runner that read none itself (`startFile` above). A command-line flag rather than a variable,
// for two reasons. A unit's ExecStart is fixed at `--watch` and never carries it, so a runner holding it
// was started by that command. And a variable read by product code belongs in the environment catalogue,
// which describes settings an operator makes, and this is not one. `bin/start.mjs` puts it on the
// worker's command line, and `driver/runner.mjs` reads it off its own.
export const START_ENV_FILE_FLAG = "--start-env-file=";

/** The path `argv` carries in `--start-env-file=<path>`, or null when it carries none or an empty one. PURE. */
export function startEnvFileOf(argv = []) {
  const flag = argv.find((t) => String(t).startsWith(START_ENV_FILE_FLAG));
  return flag ? flag.slice(START_ENV_FILE_FLAG.length) || null : null;
}
