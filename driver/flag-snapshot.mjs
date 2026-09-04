#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The flag snapshot — how the portal learns what the engine can actually run.
//
// ── THE PROBLEM THIS EXISTS FOR ──────────────────────────────────────────────────────────────────────
//
// Some flags change what a search DOES, and they live in the environment of the processes that run
// searches. portal-service is deliberately NOT one of those processes: its systemd unit carries no
// EnvironmentFile — the AUD-shadowing rule, written into the unit itself — because the portal must not
// inherit ambient secrets. The consequence is that every CLEAROTRON_* variable reads as unset inside the
// portal, and "unset" is indistinguishable from "off".
//
// This module is written to be run BY A PROCESS THAT HAS THE ENGINE ENVIRONMENT — the same environment
// the driver runs in — and to write down what it sees. Other services read the file.
//
// ── WHAT CHANGED, 2026-07-27 ────────────────────────────────────────────────────────────────────────
//
// This used to carry three ADMISSION kill switches (CLEAROTRON_KNOCKOUT_MODE, CLEAROTRON_JX_LANES,
// CLEAROTRON_RECIPES_MODE) as well, and `flagsFor` existed to feed them to gateResolvedPolicy so the portal
// would not grey out three depths that were in fact running. Those switches are retired: availability is
// now decided by BUILT and by the wired provider, in every process, with no environment involved. The
// workaround could only ever protect the callers someone remembered to wire — the ops-MCP was not one,
// and told clients three shipped depths were "not switched on".
//
// What remains here is the genuinely useful half, and the more dangerous half: the flags that change the
// OUTPUT of a search without refusing it. Nobody is told when one of those is off, which is exactly why
// a staff screen needs to be able to read them.
//
// ── WHAT IT DELIBERATELY DOES NOT DO ────────────────────────────────────────────────────────────────
//
// It writes an ALLOWLIST. Not "the environment", not "everything starting with CLEAROTRON_". A snapshot is
// a file on disk that a web service reads and may one day render, so its contents are a disclosure
// surface: no credential, no path, no port, no timeout, no gather tuning, no test-only variable. If a
// new switch needs to be visible, it gets added here on purpose.
//
// ── DEGRADATION IS THE POINT ────────────────────────────────────────────────────────────────────────
//
// A missing or stale snapshot must NEVER block the product. Unknown availability reads as AVAILABLE,
// the request falls through to the plan gate and then to run polling, and the user is told there rather
// than being unable to ask. Failing closed here would mean a file-read error takes the whole portal
// down — trading a rare wrong-greyed-out option for a total outage.

import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { BUILT } from "./search-policy.mjs";
import { isEntrypoint } from "../shared/is-entrypoint.mjs";   // — one entry-point test, all spellings

/**
 * How a flag's absence is felt by a user. This field is what stops the staff screen lying.
 *
 * `silent-output-change` — off means the output is different and NOBODY IS TOLD. These are the
 *                          dangerous ones, and the reason the distinction is recorded rather than
 *                          left for a reader to infer from a variable name.
 *
 * There is no longer a `clarify` tier: the three flags that refused a request outright were retired
 * (2026-07-27), so every flag this map ever held was one of the silent kind. The field is KEPT rather
 * than collapsed — it is how the NEXT flag is made to declare itself, and a flag that refuses honestly
 * should have to say so rather than be inferred from its name.
 */
/**
 * item 8 — THIS MAP IS EMPTY, AND THAT IS A CLAIM RATHER THAN AN ABSENCE.
 *
 * It held exactly four names and all four are deleted: the three `CLEAROTRON_JX_*` arms were default-OFF in
 * source and ON in production, and `CLEAROTRON_COMMONLAW_SPLIT` was a rollback switch that had been ON by
 * default since it landed, so its off setting selected a path no deployment ran. So the product
 * currently ships **no declared silent-output flag**, which is the state ADR-0002 was aiming at.
 *
 * THE SINGLE-MEMBER ASSEMBLY IS STILL THERE, and this file must not be read as saying otherwise — an
 * earlier draft of this comment said the path "no longer exists" and that was simply wrong. The SWITCH
 * is gone; two mechanical conditions still reach the assembly (a one-term grid, and a resume of a run
 * whose findings predate the split), each recorded on `ctx.clSplitDecision` and in
 * `_driver/common-law-path.json` with the reason that decided it. See the addendum to ADR-0002.
 *
 * The map is KEPT rather than deleted with its readers, because the readers are what make the next one
 * declare itself: `buildFlagSnapshot` writes `flagsDeclared` so a snapshot can say "tracks nothing" in
 * words, and `postureDelta` refuses to call an empty comparison agreement. An empty map with live
 * readers is a standing question; a deleted module is a question nobody asks again.
 */
const EFFECT = {};

/** The allowlist. Anything not named here is not in the snapshot, whatever it is. */
const EXPOSED = Object.keys(EFFECT);

/**
 * — the EUIPO posture, which is a MODE and a COUNT, never a credential.
 *
 * `EUIPO_ENVIRONMENT` picks sandbox or production, and the two answer about DIFFERENT REGISTERS —
 * separate deployments holding different corpora, not a thin copy and a full one.
 *
 * WHY THIS WAS ADDED (the original defect,): `gather-config.mjs` mapped the `register` tool group
 * to `["register","euipo"]`, so the EU tools were wired into every register stage on every instance,
 * credential-blind. An instance with no credentials could not authenticate them, which is not the same
 * as an instance pointed at the sandbox — and R1 disclosed exactly that, unprompted: "no EUIPO
 * cross-check was available in this run". The difference was invisible in every round report.
 *
 * WHAT CHANGED: the credential-blind attach is gone. EUIPO is a register PROVIDER now, selected
 * by `CLEAROTRON_DATABASE=euipo`, fail-closed on its credentials at preflight. So on a
 * paid-vendor deployment these two variables no longer affect a run at all, and on a EUIPO deployment
 * a missing credential aborts by name instead of degrading silently.
 *
 * THE SNAPSHOT STILL EARNS ITS PLACE, for a narrower reason: `EUIPO_ENVIRONMENT` decides WHICH EU
 * register a euipo-provider run searched, and a sandbox run that reads as a live one is the same class
 * of lie the original defect produced. Keep recording it.
 *
 * NOTE `PRODUCTION_POSTURE` below still describes production as it stands TODAY — the old build, where
 * these credentials fed the side tool. It is a factual record of a machine, so it is not edited ahead
 * of the deploy; re-read it after this ships.
 *
 * THE COUNT, NEVER THE VALUES. `credentials` is how many of the two OAuth variables are non-empty. A
 * snapshot is a file a web service reads and may render, so a credential must never reach it — and
 * "2 of 2 present" is the whole of what a reader needs to tell "pointed elsewhere" from "cannot
 * authenticate at all".
 */
const EUIPO_CREDENTIAL_VARS = ["EUIPO_CLIENT_ID", "EUIPO_CLIENT_SECRET"];

// Flags whose CODE default is ON (driver.config.mjs reads them as `(env || "on") !== "off"`). The
// snapshot must mirror the consumer's idiom or it reports "off" for a feature that is running —
// exactly the lie this file exists to prevent (observed for CLEAROTRON_COMMONLAW_SPLIT, 2026-07-22, which
// is now deleted). Empty today; the rule survives its last member because the next default-ON flag
// declared here needs it and would otherwise report backwards on its first run.
const DEFAULT_ON = new Set();

const truthy = (v) => ["1", "true", "yes", "on"].includes(String(v ?? "").trim().toLowerCase());

/**
 * Build the snapshot from an environment. PURE — pass it any object; it reads nothing else.
 *
 * `capturedAt` is supplied rather than read from the clock so this stays testable and so a caller can
 * stamp it from the same instant it stamps everything else.
 */
export function buildFlagSnapshot(env, { capturedAt, registerProvider = null, registerCanCount = null, registerTerritories = undefined, engine = undefined, providers = undefined }) {
  const flags = {};
  // Written unconditionally, true or false to a count: a reader must be able to tell "this snapshot
  // tracks no flags" from "this snapshot lost its flags", and `flags: {}` alone cannot say which.
  const flagsDeclared = EXPOSED.length;
  for (const name of EXPOSED) {
    const raw = env?.[name];
    flags[name] = {
      on: DEFAULT_ON.has(name)
        ? String(raw ?? "on").trim().toLowerCase() !== "off"
        : truthy(raw),
      // `set` distinguishes "explicitly off" from "never configured". They behave identically and read
      // very differently to a human deciding whether something is broken or just not switched on.
      set: raw != null && String(raw).trim() !== "",
      effect: EFFECT[name],
    };
  }
  // ── the one BUILT entry that is not a property of the build alone ─────────────────────────────────
  // Depth 2 is a count, and not every register provider can count (capabilities.countProbe "none" —
  // signa). BUILT says the machinery exists; it cannot say the ACTIVE provider will answer. Left
  // alone, the portal would offer the level from `built` and the engine would refuse it at the lane's
  // preflight — enforcement with no matching control over what OFFERS the option.
  //
  // The snapshot is the right place to reconcile them: it is written by a process that has the engine
  // environment AND knows which provider is wired, which is exactly the knowledge search-policy.mjs (a
  // pure leaf) cannot have. Passed IN rather than imported so this function stays pure.
  // `null` = the caller did not say ⇒ leave BUILT untouched (the degradation rule: unknown reads as
  // available, and the request falls through to the gate rather than being hidden).
  const built = { ...BUILT };
  if (built.registerProbe && registerCanCount === false) built.registerProbe = false;

  return {
    capturedAt,
    // The build map. Env is meaningless without it: a level can be switched ON and still not exist,
    // and the two produce completely different conversations with a user.
    built,
    // WHICH register is wired, and whether it can count at all. Recorded because `built.registerProbe`
    // above is derived from it: a staff screen showing "Depth 2: not available" needs to be able to
    // say why, and "the register in use cannot count" is a different fix from "not built yet".
    //
    // `territories` is the composer display names this register can actually search — `null` for a
    // provider with no declared restriction, an array for one that enumerates, and ABSENT when the
    // writer could not work it out. Those three are different answers and the wire keeps them apart
    // all the way to the browser: absent must fail OPEN, because a snapshot written before says
    // nothing about coverage and must not grey out the territories a deployment has always offered.
    //
    // Display names, never office codes: `covered` is in each provider's own vocabulary (signa keys,
    // compumark codes) and `offices.translate` is a FUNCTION, so the office half cannot ride JSON.
    // register-coverage.mjs holds that argument in full.
    register: registerProvider
      ? {
        provider: registerProvider,
        canCount: registerCanCount,
        ...(registerTerritories === undefined ? {} : { territories: registerTerritories }),
      }
      : undefined,
    // — WHAT THIS INSTANCE SEARCHES WITH. Built by config-inventory.mjs, which reads the driver's
    // own engine and provider tables; passed IN for the same reason `register` above is, so this stays
    // pure and the portal never imports driver.config through this file.
    //
    // OMITTED WHEN THE WRITER DID NOT SAY, and that third state is the one that ships the lie if it is
    // collapsed. Every snapshot written before has no `engine` and no `providers` key at all, and
    // every deployment is in that state until its driver next drains. Absent means THIS SNAPSHOT CANNOT
    // ANSWER; it must never render as "no providers are configured", which is what an empty array would
    // say and is the exact inversion of the fact. `registerTerritoriesFor` holds the same argument for
    // the same reason ("Never read as 'covers nothing'") and the readers here mirror it.
    ...(engine === undefined ? {} : { engine }),
    ...(providers === undefined ? {} : { providers }),
    // Which of the exposed flags the admission gate consults: NONE, since the kill switches were retired
    // (2026-07-27). The field is kept and emitted empty rather than dropped — readers already branch on
    // it (portal-config-view marks a row as a kill switch from this list), and `[]` is the truthful
    // answer. If a flag that refuses honestly is ever added back, it belongs in here.
    killSwitches: [],
    flags, flagsDeclared,
    // — mode and count only; see EUIPO_CREDENTIAL_VARS. `environment` mirrors the server's own
    // default so the snapshot says what the server WILL do, not what the variable happens to hold.
    euipo: {
      environment: String(env?.EUIPO_ENVIRONMENT ?? "").trim() || "sandbox",
      set: env?.EUIPO_ENVIRONMENT != null && String(env.EUIPO_ENVIRONMENT).trim() !== "",
      credentials: EUIPO_CREDENTIAL_VARS.filter((n) => String(env?.[n] ?? "").trim() !== "").length,
      of: EUIPO_CREDENTIAL_VARS.length,
    },
  };
}

/**
 * WHAT PRODUCTION RUNS. Read from the production unit's environment on 2026-08-04 with the owner's
 * authorisation, named variables only, and recorded.
 *
 * This is here so a check on ANY instance can say plainly how that instance differs from production
 * without reading production.
 *
 * THE FLAG HALF IS RETIRED, AND THIS RECORDS WHY, because the reason is the whole argument for
 * item 8. Three units shipped dark in the source, ran live in production, and — when this was first
 * written — had never once executed under test. `CLEAROTRON_JX_CONSUME=1` was the sharpest of them:
 * production's synthesis took an input no test run had ever produced. That is not a delta worth
 * reporting on every instance forever, it is a defect — and the fix was to delete the switches so the
 * source ships what production runs. `flags: {}` below is that fix having landed, not an omission.
 *
 * UPDATE THIS WHEN PRODUCTION CHANGES, and say on what it was read from. A stale expectation here
 * reports a delta that does not exist, which is the same class of lie as reporting none.
 */
export const PRODUCTION_POSTURE = {
  source: "production unit environment, read 2026-08-04 with owner authorisation (#372); the flag half "
    + "retired 2026-08-20 when #1149 item 8 deleted every switch it named",
  // The three it named are gone — deleted BECAUSE production ran them on while the source shipped them
  // off, which is the delta this block existed to expose. There is nothing left to differ about, and
  // saying that in an empty object beats leaving three names that no code reads.
  flags: {},
  euipo: { environment: "production", credentials: 2, of: 2 },
};

/**
 * How this snapshot differs from production. Returns one row per difference, `[]` when they agree, and
 * `null` when there is no snapshot to compare — which is NOT agreement and must not read as it. PURE.
 */
export function postureDelta(snapshot, expected = PRODUCTION_POSTURE) {
  if (!snapshot || typeof snapshot.flags !== "object") return null;
  const rows = [];
  // item 8 — AN EMPTY FLAG COMPARISON IS NOT AGREEMENT. With no flag declared on either side the
  // loop below runs zero times, and a caller reading `[]` would hear "this instance matches production"
  // when what happened is that nothing was checked. The EUIPO rows below are still real, so the answer
  // is a row rather than a null: the delta stays computable and says which half of it was vacuous.
  if (!Object.keys(expected.flags ?? {}).length) {
    rows.push({ what: "flags", here: Object.keys(snapshot.flags ?? {}).length, production: 0,
      effect: "no flag is declared on either side — the flag half of this comparison checked nothing, "
        + "which is not the same as finding no difference (#1149 item 8 deleted all four)" });
  }
  for (const [name, want] of Object.entries(expected.flags ?? {})) {
    const here = snapshot.flags?.[name]?.on === true;
    if (here !== want) rows.push({ what: name, here, production: want, effect: snapshot.flags?.[name]?.effect ?? EFFECT[name] ?? null });
  }
  const e = snapshot.euipo ?? null;
  if (!e) rows.push({ what: "EUIPO_ENVIRONMENT", here: null, production: expected.euipo?.environment ?? null, effect: "snapshot predates the EUIPO block" });
  else {
    if (e.environment !== expected.euipo?.environment) rows.push({ what: "EUIPO_ENVIRONMENT", here: e.environment, production: expected.euipo.environment, effect: "silent-output-change" });
    if (e.credentials !== expected.euipo?.credentials) rows.push({ what: "EUIPO credentials", here: `${e.credentials} of ${e.of}`, production: `${expected.euipo.credentials} of ${expected.euipo.of}`, effect: "the EUIPO tools are wired either way and cannot authenticate without these" });
  }
  return rows;
}

/** Where the snapshot lives. Beside the pool, so it shares the pool's lifecycle and backup. */
export function snapshotPath(poolRoot) {
  return join(poolRoot, "_state", "prelim-flag-snapshot.json");
}

/**
 * Read a snapshot. Returns null for missing, unreadable or malformed — every failure is the same
 * answer, because the caller's response to all of them is identical: degrade to available.
 */
export function readFlagSnapshot(poolRoot) {
  // — an empty/null pool root is `config.poolRootOrNull` saying "no pool is configured on this
  // machine", and it gets the same answer as a missing file: null. It is stated rather than left to
  // `join()` throwing into the catch below, because the two are the same fact and only one of them
  // reads as intentional.
  if (!poolRoot) return null;
  try {
    const raw = JSON.parse(readFileSync(snapshotPath(poolRoot), "utf8"));
    if (!raw || typeof raw !== "object" || typeof raw.flags !== "object") return null;
    return raw;
  } catch {
    return null;
  }
}

// `flagsFor(snapshot)` lived here until 2026-07-27. It shaped the snapshot into the `flags` object
// `gateResolvedPolicy` wanted, and its missing-snapshot answer was a Proxy that said "1" to everything —
// fail-open, so a portal could never be unable to start a search because a file was absent. It is gone
// because no gate reads flags any more. The staff config screen reads `snapshot.flags` directly.

/**
 * The build map shaped for `productAvailability({ built })`.
 *
 * A missing snapshot degrades to the module's own BUILT: unknown availability reads as AVAILABLE, and
 * the request falls through to the gate. The snapshot's map is preferred when present because it is the
 * only one that knows whether the deployment's register can count (see buildFlagSnapshot) — a service
 * outside the engine environment cannot work that out from its own import.
 */
/** Whether the register wired to THIS deployment can take a filing count. Null = unknown, and unknown
 *  must not be read as "cannot": productAvailability only splits the cause on an explicit false. */
export function registerCanCountFor(snapshot) {
  const v = snapshot?.register?.canCount;
  return typeof v === "boolean" ? v : null;
}

/**
 * Which composer territories the wired register can search. THREE answers, and a caller that
 * collapses any two of them has the bug this function exists to prevent:
 *
 *   `null`      — no declared restriction. Every territory stays offerable.
 *   `[...]`     — exactly these, in composer display names.
 *   `undefined` — the snapshot does not say. FAIL OPEN: an older writer, or a provider whose
 *                 capabilities threw. Never read as "covers nothing".
 *
 * The trap is `covered ?? []`, which turns both "unrestricted" and "unknown" into "nothing" and offers
 * a client zero territories on a production deployment. It is written down at
 * providers/corsearch/src/capabilities.js:66-68 as well: "Never read as 'covers nothing'".
 */
export function registerTerritoriesFor(snapshot) {
  if (!snapshot?.register || !("territories" in snapshot.register)) return undefined;
  const v = snapshot.register.territories;
  if (v === null) return null;
  return Array.isArray(v) ? v.filter((n) => typeof n === "string") : undefined;
}

/**
 * What this instance searches. THREE answers, exactly as `registerTerritoriesFor` above:
 *
 *   an object   — the writer said, and this is what it said.
 *   `null`      — THE SNAPSHOT DOES NOT SAY. A snapshot written before, or none at all.
 *
 * There is no "nothing is configured" answer here, and that is the point: a fully unconfigured instance
 * still produces a `providers` ARRAY, every row of it saying `configured: false`. Null is not that. A
 * reader that renders null as an empty list tells a staff member the instance has no providers when what
 * happened is that nobody asked — the failure this whole file exists to prevent, one field over.
 */
export function engineFor(snapshot) {
  const e = snapshot?.engine;
  return (e && typeof e === "object" && !Array.isArray(e)) ? e : null;
}

export function providersFor(snapshot) {
  return Array.isArray(snapshot?.providers) ? snapshot.providers : null;
}

/**
 * ── — CAN THIS DEPLOYMENT READ CASE LAW AT ALL? ─────────────────────────────
 *
 * The owner ordered the one product that declares it needs case law, and first heard of the lane in the
 * finished report: "it was NOWHERE in setup … neither was it flagged when selecting the report in the
 * new clearance screen."
 *
 * A READER, in the file every snapshot reader already imports, so the portal can answer it without an
 * engine environment — the same split `registerCanCountFor` and `registerTerritoriesFor` are here for.
 *
 * THREE ANSWERS AND THEY ARE NOT TWO. `null` is "the snapshot does not say", which is every snapshot
 * written before this shipped and every box whose writer has not run since; it must NOT render as "no
 * case-law source", which would put a warning on a working deployment. `true` means at least one source
 * is enrolled. `false` means the snapshot listed the sources and none of them is.
 *
 * ENROLLED IS NOT REACHABLE. The owner's own report says `CONNECTION_CLOSED` on a source that was set
 * up. Nothing readable from a snapshot can promise a live server, and the sentence this feeds says only
 * what a `false` here justifies: that the lane is dark on this box.
 */
export function caseLawReadyFor(snapshot) {
  const rows = providersFor(snapshot);
  if (!rows) return null;
  // ── ONLY THE ROWS THAT ARE AN ANSWER TO THE QUESTION ───────────────────────────────────────────
  //
  // `enrolment: "oauth"` are the sources somebody has to sign in to. EUR-Lex reads through the engine's
  // own fetch tool and is therefore always `configured: true`, so a plain "any configured case-law row"
  // would report EVERY deployment as ready and the warning this feeds would never fire — on the exact
  // box it was written for. Measured before it shipped, not after.
  const caseLaw = rows.filter((r) => r?.key === "caselaw" && r?.enrolment === "oauth");
  // An older snapshot carries provider rows and no case-law ones at all. That is "does not say", not
  // "none configured" — the distinction the three-state rule above exists for.
  if (!caseLaw.length) return null;
  return caseLaw.some((r) => r.configured === true);
}

export function builtFor(snapshot) {
  const b = snapshot?.built;
  return (b && typeof b === "object" && !Array.isArray(b)) ? { ...BUILT, ...b } : { ...BUILT };
}

/** True when the snapshot is older than `maxAgeMs`. Staleness is shown, never acted on. */
export function isStale(snapshot, { now, maxAgeMs = 24 * 60 * 60 * 1000 }) {
  if (!snapshot?.capturedAt) return true;
  const t = Date.parse(snapshot.capturedAt);
  return !Number.isFinite(t) || now - t > maxAgeMs;
}

// ── the writer ───────────────────────────────────────────────────────────────────────────────────────
// Run as a oneshot from a unit that DOES have the engine environment:
//     node driver/flag-snapshot.mjs
// Wire it into the restart step. A snapshot that only refreshes when somebody remembers is a snapshot
// that will one day describe a configuration nobody is running any more.
/**
 * Write the snapshot for THIS process's environment, and answer where it went.
 *
 * — EXPORTED, because `bin/start.mjs` is the one first-run entry that can write one. The portal
 * deliberately has no engine environment (it says so three times in its own header), so it can only
 * READ a snapshot; and until this was callable, nothing on a fresh install wrote one at all — no
 * runtime caller outside this module and its tests, and neither `bin/start.mjs` nor `bin/example.mjs`
 * touched it. So the install where naming the mode matters most was the one where the portal's only
 * channel answered `engine: null`.
 *
 * `quiet` suppresses the operator lines below; a launcher prints its own one-liner instead of four.
 */
// `env` and `poolRoot` are seams, not configuration. A SUPERVISOR knows the install it just created;
// this writer otherwise learns it only from `process.env`, which is true for `clearotron start` because
// it writes and reads a `.env` — and FALSE for the demo, which deliberately writes no secrets and no
// paths anywhere. The demo's children were handed the install through `childEnv`
// while this call, in the parent, still read an environment nothing had set: `config.poolRoot` threw by
// name, no snapshot was written, and the portal's configuration page answered "cannot be read from
// here" for exactly the first-time visitor the paragraph below names. Defaults keep every existing
// caller reading `process.env` and `config.poolRoot` as before.
export async function writeFlagSnapshot({ quiet = false, env = process.env, poolRoot = null } = {}) {
  // ── — THE NAMES AN INSTALLER ACTUALLY TYPES, TRANSLATED BEFORE ANYTHING CAPTURES THEM ────────
  //
  // MEASURED, not inferred. On 2026-08-20, with `.env.example`'s own spellings and nothing else set:
  //
  //     CLEAROTRON_REPORTS_DIR=… CLEAROTRON_DATABASE=corsearch node driver/flag-snapshot.mjs
  //     Error: CLEAROTRON_REPORTS_DIR is not set, and it has NO default.
  //
  // No snapshot was written at all. The same environment spelled `CLEAROTRON_*` wrote one naming corsearch.
  //
  // The cause is a gap in `shared/env-local.mjs`'s entry list, not in the translation: `applyEnvAliases`
  // runs ungated, but only inside processes that IMPORT env-local, and env-local is imported by the
  // declared CLI entries alone. This file is started directly by `prelim-driver.service` ExecStartPost
  // and was never declared one — so on a deployment that followed `.env.example`, every variable this
  // writer and driver.config read was invisible to it.
  //
  // IT FAILED SILENTLY, which is why it survived: that ExecStartPost carries a `-` prefix ("a snapshot
  // failure must never fail the drain"), so the crash was swallowed on every drain and the only symptom
  // was a staff config page reading "Configuration cannot be read from here" forever.
  //
  // FIXED HERE RATHER THAN BY DECLARING THIS A CLI ENTRY, deliberately. env-local is imported for its
  // side effect at module top, and this file is a LIBRARY to portal-service, door-gates, dev-portal and
  // the MCP server — so that import would apply the translation, and env-local's `.env` read, inside
  // five processes that neither want it nor were measured for it. Applying the aliases inside the isMain
  // block reaches exactly the process that needs them and no other.
  //
  // THREE MORE PROGRAMS ARE STILL BLIND, and this fixes only its own: profile-service, the client MCP
  // http server and the oauth bridge's warm server are all unit-started and undeclared too.
  // carries them, with the measurement — profile-service silently reads the BUNDLED demo profile store
  // instead of the customer one — and the missing guard that would stop a fifth appearing.
  //
  // BEFORE driver.config, and that ordering is load-bearing: `REGISTER_PROVIDER` is a module-top capture
  // (REGISTER_PROVIDER declared in driver.config.mjs), so a translation applied after this import
  // would report success and change nothing — the failure env-local's own header measures.
  const { warnRetiredEnv } = await import("../shared/env-aliases.mjs");
  warnRetiredEnv();
  const { config, REGISTER_PROVIDER } = await import("./driver.config.mjs");
  const { capabilitiesFor } = await import("./register-capabilities.mjs");
  // An unknown provider id throws loudly in capabilitiesFor — here that would take down the snapshot
  // writer over a question that is not its business, so it degrades to "unknown" (= leave BUILT alone).
  const canCount = (() => { try { return capabilitiesFor(REGISTER_PROVIDER).countProbe !== "none"; } catch { return null; } })();
  // Same degradation as canCount and for the same reason: an unknown provider id throws loudly in
  // capabilitiesFor, and taking down the snapshot writer over that would be a bigger outage than the
  // question is worth. `undefined` here means the field is OMITTED, which every reader fails open on.
  const { coveredTerritoryNames } = await import("./register-coverage.mjs");
  const territories = await (async () => { try { return await coveredTerritoryNames(capabilitiesFor(REGISTER_PROVIDER)); } catch { return undefined; } })();
  // — engine identity and the provider inventory. UNCAUGHT, unlike the two degradations above,
  // and for the opposite reason: those answer a question that is not the snapshot's business, whereas a
  // throw here would write a snapshot MISSING these blocks, which every reader is required to render as
  // "this snapshot predates provider reporting". That would be false — it did not predate it, the
  // derivation failed — and a false explanation is worse than no snapshot, which reads honestly as
  // "configuration cannot be read from here".
  const { engineInventory, providerInventory } = await import("./config-inventory.mjs");
  const snap = buildFlagSnapshot(env, {
    capturedAt: new Date().toISOString(), registerProvider: REGISTER_PROVIDER, registerCanCount: canCount,
    registerTerritories: territories,
    engine: engineInventory(env), providers: providerInventory(env),
  });
  // `??` and not `||`: `config.poolRoot` THROWS by name when unset, so the short-circuit is what
  // keeps a caller that supplied its own pool from paying for the getter's refusal.
  const path = snapshotPath(poolRoot ?? config.poolRoot);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(snap, null, 2));
  if (quiet) return { path, snapshot: snap };
  const on = Object.entries(snap.flags).filter(([, f]) => f.on).map(([n]) => n);
  // The provider line names what is MISSING rather than what is present: the drain's journal is where
  // an operator looks after a run came out thin, and "perplexity: PERPLEXITY_API_KEY" is the answer.
  const gaps = snap.providers.filter((p) => !p.configured)
    .map((p) => `${p.provider ?? p.key}: ${p.missing.join(" + ") || "not selected"}`);
  process.stderr.write(
    `[flag-snapshot] wrote ${path}\n`
    + `[flag-snapshot] on: ${on.length ? on.join(", ") : "(none)"}\n`
    + `[flag-snapshot] built: ${Object.entries(snap.built).map(([k, v]) => `${k}=${v}`).join(" ")}\n`
    + `[flag-snapshot] engine: ${snap.engine.id}${snap.engine.known ? "" : " (UNKNOWN to this build)"}`
    + ` · billing ${snap.engine.billing.mode}${snap.engine.binaryPresent ? "" : " · BINARY NOT FOUND"}\n`
    + `[flag-snapshot] providers missing: ${gaps.length ? gaps.join(", ") : "(none)"}\n`,
  );
  return { path, snapshot: snap };
}

const isMain = isEntrypoint(import.meta.url);
if (isMain) await writeFlagSnapshot();
