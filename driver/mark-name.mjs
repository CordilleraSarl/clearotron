// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// THE NAME(S) A RUN IS ABOUT, in one sentence, for every surface that has to say them.
//
// One mark is the mark; several are the first plus a count. Never the run type — a list of run types is
// not a list of names.
//
// ── why this is its own module ───────────────────────────────────────────────────────────────────────
//
// Because five callers need it and they do not share a layer: the status writer (progress.mjs), the
// knockout pipeline, the failure packet (pipeline.mjs), the publisher (publish/knockout.mjs) and the
// portal's run listing. The listing is the constraint — portal-service.mjs deliberately does NOT import
// driver.config.mjs, which freezes workspaceRoot and poolRoot at import time, and pulling that in behind
// a four-line string helper is how a test ends up reading a production root. So the rule lives with no
// dependencies at all.
//
// ── the defect that made it one rule ─────────────────────────────────────────────────────────────────
//
// There were two spellings. pipeline-knockout.mjs wrote "IRONWHISK (+2 marks)" onto status.json while
// publish/knockout.mjs wrote "IRONWHISK +2 more" onto meta.json, so a batch CHANGED ITS NAME the moment
// it crossed from live to delivered. The browser groups reads on `markKey(displayName(run))`
// (portal-ui contract/reads.ts), which normalises case and nothing else — measured on a real published
// batch: `readsFor` returned ONE read while the list held two rows for it, its own live face and its own
// delivered face, sitting there as two different marks. portal-service.mjs's own comment says a run must
// not change identity when it crosses that line; this is what makes that true.
//
// "+N more" and not "(+N marks)" because the browser composes the identical string when it derives a
// name from `marks[]` — two producers of one string, and this is the one they already agreed on. The
// live spelling also carried an unguarded plural, so every TWO-mark batch read "(+1 marks)".

/**
 * @param names   marks as `[{ name }]` or as bare strings; anything blank is not a name.
 * @param fallback the caller's own answer for a SINGLE mark.
 *
 * THE FALLBACK WINS FOR ONE NAME, and that is the point of the signature: a caller's answer for a single
 * mark is the name the requester TYPED, which this list does not carry, and every existing call site
 * already preferred it. This function only speaks when there are several — so wiring it in changes
 * nothing on the clearance lane, which admits one name and refuses two at the run door.
 */
export function batchMarkName(names, fallback = undefined) {
  const list = (Array.isArray(names) ? names : [])
    .map((n) => (typeof n === "string" ? n : n?.name))
    .filter((n) => typeof n === "string" && n.trim())
    .map((n) => n.trim());
  if (list.length > 1) return `${list[0]} +${list.length - 1} more`;
  return fallback ?? list[0] ?? null;
}
