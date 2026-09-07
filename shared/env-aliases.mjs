// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// env-aliases.mjs — ONE SPELLING, and the settings that no longer exist at all.
//
// A variable name must mean something to someone who has never read this code. `CLEAROTRON` names nothing
// to anyone — it is the internal codename of the first product this engine shipped — so the names an
// installer types are `CLEAROTRON_*`. Vendor keys are deliberately untouched: `SIGNA_API_KEY` already
// says who you bought it from.
//
// ── WHY THERE IS NO TRANSLATION LAYER, AND WHY THERE IS NOW A CHECK ─────────────────────────────────
//
// This module used to hold both spellings and translate between them, so a box could be upgraded
// without its environment file being touched. The owner ruled that out on 2026-08-26: no migration, no
// legacy support, and — asked directly whether a machine carrying the old names should be told —
// no check for them either. His reasoning was the premise: a machine reaches this code through the
// install, the install writes the names in force, and the two boxes that predate the rename are
// REBUILT rather than deployed onto. There is no population left holding the old lines.
//
// THAT PREMISE STOPPED BEING TRUE WHEN THE PRODUCT MOVED TO THE REGISTRY (tracker issue 168). A
// tarball is replaced whole; a published package is UPGRADED, and an upgrade leaves the operator's
// environment file exactly where it was — so the population the premise says cannot exist is now
// created by `npm install`. Measured rather than predicted: upgrading the production install across
// the rename left THIRTEEN names in its env file with no reader in the new build — the stall timeout,
// both concurrency caps, all three Japan-adapter switches, the report link base, the client connector
// URL, the access-note domain, the agent MCP URL and the explicit-port guard. Every one was
// configured and every one was being ignored, and exactly one announced itself — only because a
// service happens to log its own posture at boot.
//
// WHAT CHANGED IS ONLY THAT WE SAY SO. The ruling was against HONOURING an old name and it stands:
// nothing here translates, falls back to, or applies a retired spelling. Saying a name is dead is not
// the same as obeying it. A box carrying one still boots, because an operator needs the box up to fix
// the file.
//
// The list below is a different thing and survives for a different reason: a setting whose BEHAVIOUR was
// deleted, under the name in force. Nothing can be applied wrongly there — the feature is gone — so
// saying so is the whole of what is owed, and it predates this change.

import { NAMES_IN_FORCE } from "./names-in-force.mjs";

// A name here is DEAD: the behaviour it configured does not exist under any spelling. Saying so is all
// that happens. driver/test's env-idiom arm holds this list to pipeline.mjs's RETIRED_ENV so neither
// can rot alone.
export const RETIRED_NEW_SPELLINGS = Object.freeze({
  CLEAROTRON_DELIVERY:
    "delivery is one behaviour and not a setting since #1014 — every requester-facing event is a "
    + "self-contained outbox packet (docs/DELIVERY.md). If this was set to `stage`, nothing is sending "
    + "your notices: the packets are being written and are waiting for an integrator to consume them.",
});

/** Set and non-empty. An `X=` line in an EnvironmentFile means "not configured", never "empty value". */
const has = (env, name) => env?.[name] != null && String(env[name]) !== "";

/**
 * Set `name` on `env`, or delete it when `value` is undefined.
 *
 * There is one spelling now, so this is a one-key assignment — but it stays a function because the
 * `undefined` means UNSET convention is the part call sites depend on, and because `String(value)`
 * keeps a number or a boolean from reaching a child process as something `process.env` cannot hold.
 *
 * Returns `env`, so it composes into the two shapes that need it:
 *   spawn(..., { env: pinEnv({ ...process.env }, "CLEAROTRON_QUEUE_DIR", q) })
 *   pinEnv(process.env, "CLEAROTRON_AI", "anthropic-agent")
 */
export function pinEnv(env, name, value) {
  if (value === undefined) delete env[name];
  else env[name] = String(value);
  return env;
}

/** `pinEnv` over several names at once. Same rules; the pairs are applied in order. */
export function pinEnvAll(env, pairs) {
  for (const [name, value] of Object.entries(pairs ?? {})) pinEnv(env, name, value);
  return env;
}

/**
 * Read `name` from `env`, treating empty as unset.
 *
 * EMPTY IS UNSET, exactly as `has` treats it: an `X=` line in an EnvironmentFile means "not
 * configured", so a caller's `|| default` must see `undefined` rather than a blank string that
 * shadows the default it was meant to fall through to.
 */
export function envFrom(env, name) {
  const v = String(env?.[name] ?? "").trim();
  return v === "" ? undefined : v;
}

/**
 * Say so when a DELETED setting is still set. Nothing is applied and nothing is translated.
 *
 * Called from `shared/env-local.mjs`, which every CLI entry imports first. It warns and returns; it
 * cannot refuse, because a setting whose behaviour no longer exists cannot send a run anywhere wrong.
 */
export function warnRetiredEnv({ env = process.env, note = defaultNote } = {}) {
  const said = [];
  for (const [name, why] of Object.entries(RETIRED_NEW_SPELLINGS)) {
    if (!has(env, name)) continue;
    note(`[env] ${name} is set but was RETIRED and does nothing — ${why} Delete the line from your `
      + `environment file.\n`);
    said.push(name);
  }
  return said;
}

function defaultNote(line) { try { process.stderr.write(line); } catch { /* a closed stderr must never fail a run */ } }
