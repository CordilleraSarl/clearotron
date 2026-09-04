// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// order-probe.mjs — the ORDER-EFFECT seam (item 11), and the guarantee that it does nothing.
//
// THE QUESTION. Every judgment stage reads the register band through a shape that is sorted
// deterministically (band-shape.mjs sorts records by record_id, positions by size-then-id, floors by
// tier-then-id). That determinism is correct and stays. But it means we have never been able to ask the
// one cheap question that separates judgment from artefact: **if the same records arrived in a different
// order, would the read change?** Two runs that disagree about a clearly-decided record are a quality
// problem; two runs that disagree because the list was sorted differently are a different problem with a
// different fix, and today we cannot tell them apart.
//
// THE CONSTRAINT, and it is the whole design (owner ruling, 2026-08-01): the seam must be PROVABLY INERT
// by default. Production ordering is byte-identical unless someone sets an explicit environment variable
// to a positive integer, and a test pins that. An order probe that could fire by accident during the
// round it exists to make readable would be worse than not having one.
//
// So: `probeSeed()` returns null unless CLEAROTRON_ORDER_PROBE_SEED names a positive integer, and
// `probeOrder(list)` returns the SAME ARRAY REFERENCE when it does. There is no partial state, no
// "shuffle a bit", no per-call sampling — the seam is either off (identity) or on (a full seeded
// permutation), because anything in between is unfalsifiable.
//
// PURE: no IO, no config import, no clock, no Math.random. The permutation is a seeded Fisher-Yates over
// a mulberry32 PRNG, so `CLEAROTRON_ORDER_PROBE_SEED=7` produces the same permutation on every machine and
// every re-run — an arm you cannot reproduce is not an arm.

/** The probe seed, or null when the probe is OFF (the only state production ever sees). */
export function probeSeed(env = process.env) {
  const raw = env?.CLEAROTRON_ORDER_PROBE_SEED;
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  // Fail CLOSED on anything that is not a positive integer. A typo'd seed must leave production ordering
  // alone rather than silently pick some default arm — the same reason CLEAROTRON_STAGE_THINKING fails loud
  // on a bad spec, arrived at from the other side: here the safe direction is OFF.
  return /^\d+$/.test(String(raw).trim()) && Number.isInteger(n) && n > 0 ? n : null;
}

/** mulberry32 — small, seeded, and identical everywhere. */
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The seam. Returns `list` UNCHANGED (same reference) when the probe is off — which is always, in
 * production. When a seed is set, returns a new array holding a seeded permutation of the same members.
 *
 * `label` distinguishes the call sites so two lists in one run do not receive the same permutation (a
 * probe where every list is shuffled identically is testing one thing while appearing to test three).
 */
export function probeOrder(list, label = "", env = process.env) {
  const seed = probeSeed(env);
  if (seed == null || !Array.isArray(list) || list.length < 2) return list;
  let s = seed;
  for (let i = 0; i < label.length; i++) s = (Math.imul(s, 31) + label.charCodeAt(i)) >>> 0;
  const rnd = prng(s || seed);
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** True when this process is running a probe arm — for the one run.jsonl row that records which arm ran. */
export const probeActive = (env = process.env) => probeSeed(env) != null;
