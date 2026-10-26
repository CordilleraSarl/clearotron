// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE UNIT'S CROWD LINE, once per register answer that carries a crowd.
//
// A crowd's recorded reason is data every later stage reads — the write-up, placement and the writer, none of which has
// the unit's manual — so it carries facts only. How the unit decides on a crowd belongs where the unit reads its
// results: a register server adds this line, as a block of its own beside the answer, to an answer that carries one.

export const CROWD_NOTE = "A crowd is decided with the narrowing steps in unit.md, only as far as reading it would change what you "
  + "tell the client; what stays a crowd is recorded with its count.";

/**
 * Whether a register answer carries a crowd: a block in the `incomplete` state that is neither an error nor a planned
 * search that never ran, wherever the answer holds it (the answer itself, its per-question results), or an `incomplete`
 * entry in the per-question `states` the plan tool returns. False for an answer that is not JSON. PURE.
 */
export function carriesCrowd(text) {
  let doc;
  try { doc = JSON.parse(String(text ?? "")); } catch { return false; }
  const seen = new Set();
  const walk = (v) => {
    if (!v || typeof v !== "object" || seen.has(v)) return false;
    seen.add(v);
    if (Array.isArray(v)) return v.some(walk);
    if (v.state === "incomplete" && v.error !== true && v.deferred !== true) return true;
    if (v.states && typeof v.states === "object" && Object.values(v.states).includes("incomplete")) return true;
    return Object.values(v).some(walk);
  };
  return walk(doc);
}

/** The line a register server adds to one answer, or null when the answer carries no crowd. PURE. */
export const crowdNoteFor = (_tool, text) => (carriesCrowd(text) ? CROWD_NOTE : null);
