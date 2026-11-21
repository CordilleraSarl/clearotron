// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// run-dir-lookup.mjs — where a codename's run lives on disk. Read by the runner, which claims and reclaims runs, and by the
// pipeline, which rebuilds a run's job from its codename; it imports neither, so both import it.
import { readdirSync } from "node:fs";
import { join } from "node:path";

// B1 — where (if anywhere) a codename's run already lives on disk. The live leaf is "<date>-<codename>";
// when the dispatch dateISO is known (persisted in the meta BEFORE any spend, and equal to the run dir's
// own date prefix — buildRunContext built it with that date), match the EXACT `${dateISO}-${codename}`
// leaf. A date-agnostic `endsWith(-codename)` (the only option when dateISO is genuinely absent — legacy
// meta) would ALSO match a lingering same-slug run dir from an EARLIER date that happens to share today's
// random codename, and mis-route the reclaim: resume that stranger's stale dir, or consume a brand-new job
// as its `.done` "already-delivered" without ever running the client search (A2). The archive nests the
// same leaf under <YYYY-MM>/, keyed off the meta's dateISO month when present, else every month is scanned
// (one readdir per month — the archive is shallow). Pure read; exported for the crash-identity tests.
export function findRunDirFor({ codename, slug, dateISO = null, studioRoot, archiveRoot }) {
  const leaf = dateISO
    ? (n) => n === `${dateISO}-${codename}`
    : (n) => /^\d{4}-\d\d-\d\d-/.test(n) && n.endsWith(`-${codename}`);
  try {
    const hit = readdirSync(join(studioRoot, slug)).find(leaf);
    if (hit) return { kind: "live", dir: join(studioRoot, slug, hit) };
  } catch { /* no slug dir yet */ }
  let months = [];
  if (dateISO) months = [String(dateISO).slice(0, 7)];
  else { try { months = readdirSync(archiveRoot); } catch { /* no archive yet */ } }
  for (const m of months) {
    try {
      const hit = readdirSync(join(archiveRoot, m, slug)).find(leaf);
      if (hit) return { kind: "archived", dir: join(archiveRoot, m, slug, hit) };
    } catch { /* month/slug absent */ }
  }
  return null;
}
