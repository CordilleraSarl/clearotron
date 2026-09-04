// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// numeric-setting.mjs — one resolver for every numeric environment setting, with two faces.
//
//. `Number("two")` is `NaN`, and NaN is the worst possible answer here because
// every comparison against it is FALSE. The measured case: `CLEAROTRON_MAX_CONCURRENT_RUNS=two` made the
// run-slot cap NaN, `live < cap` false forever, and `for (let i = 0; i < cap; i++)` a loop that never
// runs — so no slot was ever granted and no slot file was ever written. The driver accepted work and
// started none of it, with no error, no log line and no timeout. It presents as "the queue is not
// draining", which is the shape that costs a debugging session because nothing in it points at
// configuration.
//
// THE TWO INPUTS ARE DIFFERENT QUESTIONS AND GET DIFFERENT ANSWERS:
//
//   blank / unset / whitespace   "not configured" ('s documented spelling) — take the DEFAULT.
//   a value that is not a number  "configured wrong" — REFUSE, naming the variable and what it holds.
//
// There is no overlap between those inputs, so neither answer weakens the other.
// settled the first half by making `envFrom` answer `undefined` for all three blank shapes; this file
// is the second half, and it exists because the first half left `Number()` still able to produce NaN.
//
// RANGE IS NOT PARSEABILITY, AND THIS FILE DOES NOT TOUCH RANGE. `"0"` and `"-1"` are numbers. Their
// callers floor them (`Math.max(1, …)`, `Math.max(0, …)`) and that behaviour is documented and tested:
// an explicit `CLEAROTRON_MAX_CLAIM_AGE_MS=0` is a CHOICE that must survive. Blurring "cannot be parsed"
// into "outside the range I wanted" would break three passing arms and change behaviour nobody asked
// to change.
//
// WHY A REFUSAL AND NOT A FALLBACK. The precedent is three hundred lines away in driver.config.mjs:
// `preflightFreeSpace` throws by name on a typo'd `CLEAROTRON_MIN_FREE_DISK_MB` rather than silently
// disabling the disk check, because "a typo'd threshold must not silently disable the check — that is
// the failure mode of the guard itself." A typo'd CAP is the same class: falling back to the default
// would run the deployment at a concurrency nobody chose, and say nothing.
//
// WHY TWO FACES. A throw is right where the value is ENFORCED and wrong where it is REPORTED. If the
// status snapshot and the portal's `/me` threw on a bad cap, the misconfiguration would take out the
// two surfaces an operator reads to find it — a different failure from the wedge, and on the
// diagnostic axis a worse one. So enforcement calls `numericSetting()` and refuses; reporting calls
// `resolveNumericSetting()` and renders the absence. Both read the same table, so they cannot disagree
// about what the value IS — only about what to do when there isn't one.

import { envFrom } from "../shared/env-aliases.mjs";

/**
 * THE ONE DEFINITION OF EACH DEFAULT. Every one of these was previously written as a literal at its
 * getter, and `CLEAROTRON_MAX_CONCURRENT_RUNS`'s `2` was written twice more, independently, in
 * `pipeline.mjs` and `portal-service.mjs` — two copies of one number is the shape that drifts. The
 * reasoning for each VALUE stays at its getter in driver.config.mjs, where a reader changing it will
 * be; this table holds only the number itself, so there is exactly one place to change it.
 *
 * A name absent from this table is not a numeric setting, and asking for it throws rather than
 * defaulting to something invented — an unknown name is a typo in the CODE, and the same argument
 * applies: it must not resolve to a plausible number.
 */
export const NUMERIC_SETTING_DEFAULTS = Object.freeze({
  CLEAROTRON_GATHER_CONCURRENCY: 7,
  CLEAROTRON_CARD_CONCURRENCY: 8,
  CLEAROTRON_MAX_CLAIM_AGE_MS: 48 * 3600000,
  CLEAROTRON_MAX_CONCURRENT_RUNS: 2,
  CLEAROTRON_MAX_RETRIES: 2,
  CLEAROTRON_RATE_LIMIT_DEFAULT_BACKOFF_MS: 1200000,
  CLEAROTRON_RATE_LIMIT_PROBE_MS: 600000,
  CLEAROTRON_RATE_LIMIT_PROBE_CEILING_MS: 2400000,
});

/**
 * Resolve one numeric setting WITHOUT throwing. For surfaces that must keep rendering when the value
 * is unusable — they report the absence and the reason rather than a number nobody chose.
 *
 * @returns {{ok: true, value: number, raw: string|undefined, configured: boolean, reason: null}
 *         | {ok: false, value: null, raw: string, configured: true, reason: string}}
 *
 * `configured` distinguishes "took the default" from "read a value", which is the sibling field that
 * makes the number readable: a bare `2` cannot tell you whether anyone chose it.
 */
export function resolveNumericSetting(name, { env = process.env } = {}) {
  if (!Object.hasOwn(NUMERIC_SETTING_DEFAULTS, name))
    throw new Error(`[config] "${name}" is not a known numeric setting. Add it to NUMERIC_SETTING_DEFAULTS `
      + `in driver/numeric-setting.mjs (with its default) before reading it — an unknown name must not `
      + `resolve to an invented number.`);

  // envFrom walks the alias table current-spelling-first and treats blank and whitespace as unset, so
  // an operator who set only the CLEAROTRON_* spelling resolves here even in a process that never ran
  // the translation. That is the same read every other setting in driver.config.mjs gets.
  const raw = envFrom(env, name);
  const fallback = NUMERIC_SETTING_DEFAULTS[name];
  if (raw === undefined) return { ok: true, value: fallback, raw: undefined, configured: false, reason: null };

  const n = Number(raw);
  if (!Number.isFinite(n))
    return {
      ok: false, value: null, raw, configured: true,
      reason: `${name}="${raw}" is not a number. Set a number, or remove the line to take the default `
        + `(${fallback}). It is not being treated as unset: a value nobody can parse is a `
        + `misconfiguration, and defaulting past it would run this deployment on a number nobody chose.`,
    };
  return { ok: true, value: n, raw, configured: true, reason: null };
}

/**
 * Resolve one numeric setting, or REFUSE by name. For every site that ENFORCES the value.
 *
 * The refusal lands at the resolution site, deliberately, and not in a start-up validator over a list
 * of entry points: the owner ruled that seat on 2026-08-24, because coverage by entry point is only
 * ever as complete as the list, and an incomplete list is the failure this whole family is about. A
 * getter is reached by every caller however the process was started, including ones nobody has
 * written yet.
 *
 * @throws {Error} naming the variable, what it holds, and what to do — never a NaN, never a guess.
 */
export function numericSetting(name, { env = process.env } = {}) {
  const r = resolveNumericSetting(name, { env });
  if (!r.ok) throw new Error(`[config] ${r.reason}`);
  return r.value;
}

/**
 * The sentence a LOUD FALLBACK says, for the one setting that is allowed to have one.
 *
 * A fallback that says nothing is how a deployment ends up running on a number nobody chose — the
 * defect at the other end of this file, in a quieter register. The rule the owner set: a configuration
 * typo discovered MID-RUN must never turn a delivering search into a refusal, so the run continues on
 * the default AND says so, by name, in the run's own record. Silence is not one of the two options.
 *
 * @returns {string|null} the line to disclose, or null when the setting resolved and there is nothing
 *   to say — never an empty string, so a caller cannot log a blank line and call it a disclosure.
 */
export function fallbackNoteFor(name, { env = process.env } = {}) {
  const r = resolveNumericSetting(name, { env });
  if (r.ok) return null;
  return `${name}="${r.raw}" is not a number — this run used the default `
    + `(${NUMERIC_SETTING_DEFAULTS[name]}) rather than refusing. Nothing about what this search `
    + `concludes depends on it; how long the phase takes does. Fix the line in the deployment's .env.`;
}
