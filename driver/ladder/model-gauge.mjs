// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// model-gauge.mjs — which model a turn asked for, which one the wire says served it, and which program ran it.
//
// The stage ladder (gateway.mjs runStageLadder) writes these on every attempt row and run event, and fails a turn
// whose model the wire contradicts (turn-failure.mjs nameTheFailure). Both functions read the turn and the
// machine and change nothing.

import { modelFamily, modelSnapshotKind, preflightEngineBinary, olderThanFloor, ENGINE_BINARIES } from "../driver.config.mjs";
import { probeCliVersion } from "../engine/cli-version.mjs";
import { modelIdOf } from "../engine/registry.mjs";

// ── corruption 3 — WHAT WAS ASKED FOR vs WHAT ACTUALLY RAN ─────────────────────────────────
//
// Until this landed, every model figure on every record was a pure function of the REQUESTED alias:
// `resolveModel(model)` / `engine.resolveModelId(model)`, computed here without ever looking at the
// provider's answer. So `--model gemini` logged `google/gemini-3.1-pro-preview` and ran sonnet (the
// engine's alias table substituted, silently), a haiku stage that bounced to sonnet logged haiku,
// and every attribution downstream — the A/B arm's manifest, tokens.mjs' per-model rollup, the
// billing classes — was keyed to a model that had not run. Patching the log would not have fixed
// it; the log was already saying what the code believed.
//
// TWO FIELDS, NEVER COLLAPSED INTO ONE:
//   modelUsed   — the requested resolution, unchanged in meaning and value: run-economics.mjs and
//                 tokens.mjs both read it, and a field that quietly changes meaning is its own corruption.
//   modelActual — the id the WIRE reported (engine tuple `modelWire`), or NULL when the stream never
//                 said: an engine that does not emit one (codex), a turn killed before any event, a
//                 spawn error. It NEVER falls back to the requested alias, and `modelBasis` ("actual" or
//                 "unknown") never dresses a requested value as an observed one. `providerReported` is
//                 the provider word the same stream gave (tuple `providerWire`), null on the same terms.
export function modelGauge(engine, model, turn) {
  const modelRequested = modelIdOf(engine, model);
  const modelActual = (typeof turn.modelWire === "string" && turn.modelWire) ? turn.modelWire : null;
  const modelBasis = modelActual ? "actual" : "unknown";
  const providerReported = (typeof turn.providerWire === "string" && turn.providerWire) ? turn.providerWire : null;
  // WHETHER THE OBSERVED ID NAMES A FIXED BUILD. `modelBasis: "actual"` says the provider answered,
  // not that the answer is pinned: two of the three tiers come back as undated aliases the provider
  // may repoint, and recorded beside a dated one they read identically. null when there is nothing to
  // judge, never collapsed into "alias".
  const modelSnapshot = modelSnapshotKind(modelActual);
  // The comparison is by FAMILY (driver.config modelFamily), because `--model haiku` legitimately comes
  // back as `claude-haiku-4-5-20251001`. THREE-VALUED: null when either side names no family this
  // build recognises — an unknown is recorded as unknown and never as agreement.
  const famRequested = modelFamily(modelRequested), famActual = modelFamily(modelActual);
  const modelMismatch = (famRequested && famActual) ? famRequested !== famActual : null;
  return { modelRequested, modelActual, modelBasis, providerReported, modelSnapshot, famRequested, famActual, modelMismatch };
}

// WHICH BUILD OF THE TOOL SERVED THIS TURN. `modelSnapshot` above answers "did the model move";
// this answers "did the tool move", and the two have one symptom — a run whose judgment differs from
// last week's. Captured at dispatch rather than read back afterwards, because the binary a reader
// could probe later is not necessarily the one that ran.
//
// Written as an object with its own `probe` field, so an unreadable version is a RECORDED state
// rather than a missing one. Omitting it on failure would collapse "asked and could not say" into
// "written before anybody asked", which is the distinction the field exists for. One spawn per
// binary per process; a probe never throws, because taking down a dispatch to record a version
// would be a worse defect than the gap it closes.
// `source` says WHICH copy served (explicit / path / installed), and it is attached here, outside the
// probe's cache: that cache is keyed by the file, and one file can be reached by more than one route.
export function servingProgram() {
  try {
    const pre = preflightEngineBinary(process.env);
    const probed = probeCliVersion(pre?.resolved ?? null);
    // ── THE FLOOR, COMPARED WHERE THE RUN CAN SEE IT ────────────────────────────────────────
    //
    // The build declares a minimum version for each engine's program, and until now nothing
    // compared a running copy against it. The floor was passed to the installer, so a copy this
    // product installs cannot land beneath it — but resolution walks PATH first and takes the
    // first hit, so a copy already on the machine wins and was never measured against anything.
    // That is the common case, not the edge one: most machines have their own copy. A stage then
    // runs on a program below the floor and is served whatever that program serves, silently.
    //
    // RECORDED, NOT REFUSED. Refusing here would stop every run on any machine whose copy is
    // behind — including ones already deployed and working — and that is a decision about those
    // deployments rather than a defect fix. What was missing is the fact, so the fact is what is
    // written: an operator, and anyone reading the run afterwards, can now see it. Whether it
    // should also refuse is a separate question and is not answered here.
    //
    // THREE-VALUED and written unconditionally, like the model fields below: true, false, or null
    // when either side names no version this build can compare — an unknown is an unknown, never
    // an all-clear. The floor itself rides along so the record says what it was measured against
    // rather than leaving a later reader to guess which build's floor applied.
    const floor = ENGINE_BINARIES[pre?.engine]?.floor ?? null;
    const belowFloor = floor ? olderThanFloor(probed?.version ?? null, floor) : null;
    return { ...probed, source: pre?.source ?? null, floor, belowFloor };
  } catch (e) { return { version: null, probe: "unreadable", why: String(e?.message ?? e).slice(0, 160), source: null, floor: null, belowFloor: null }; }
}
