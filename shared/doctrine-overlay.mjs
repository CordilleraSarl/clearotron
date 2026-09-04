// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Which doctrine files this install overrides, and whether the upstream copy has moved since.
//
//. Doctrine files are prompt payload served to the model at runtime — `driver/skills/README.md`
// is explicit that an edit for brevity changes what a clearance concludes. So an override that has
// silently gone stale is a run answering from old doctrine with nothing to say so.
//
// WE RAN THIS EXPERIMENT ON OURSELVES. `driver/driver.config.mjs:170` records the repo split forking
// the whole tree: **30 of 37 shared files had silently drifted apart, in BOTH directions**. The
// overlay fixed the mechanism for us and fixes nothing for a self-hoster, whose copies win and whose
// upstream moves underneath them with nothing comparing the two.
//
// AN OVERRIDDEN FILE THAT IS MERELY OUT OF DATE DOES NOT FAIL A TEST. That is the whole difficulty:
// there is no red to notice, so the only way anyone finds out is a report that goes looking.
//
// ⚠ THIS REPORT'S OUTPUT IS THE USER'S OWN MATERIAL. It names files from THEIR overlay, and on a real
// deployment those names are customer-derived — measured on this repo's own config store, several
// overlay files are named after the customer whose doctrine they hold. That is correct and expected
// for a report a user runs on their own install, and it means the output must never be pasted into an
// issue, a PR or a bug report. Quote the COUNTS, never the file list.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, relative, sep } from "node:path";

export const PROVENANCE_FILE = ".doctrine-provenance.json";

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

/** Every file under `root`, as paths relative to it, sorted. Missing root ⇒ null, never []. */
export function treeFiles(root) {
  if (!root || !existsSync(root)) return null;          // ABSENCE, not emptiness — the caller must
  const out = [];                                       // be able to tell "no such tree" from "no files".
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const p = join(dir, name);
      let st;
      try { st = statSync(p); } catch { continue; }     // a file that vanished mid-walk is not a finding
      if (st.isDirectory()) walk(p);
      else if (st.isFile() && name !== PROVENANCE_FILE) out.push(relative(root, p).split(sep).join("/"));
    }
  };
  walk(root);
  return out.sort();
}

/**
 * The recorded point an override was taken from, if one was ever taken.
 *
 * `{ "<rel>": { sha256, upstream_rev, taken_at } }`. ABSENT IS THE NORMAL CASE TODAY and must read as
 * "we cannot tell you", never as "unchanged" — inferring a baseline nobody recorded is the failure this
 * repo keeps writing down.
 */
export function readProvenance(overlayRoot) {
  if (!overlayRoot) return { present: false, why: "no overlay is configured", entries: {} };
  const p = join(overlayRoot, PROVENANCE_FILE);
  if (!existsSync(p)) return { present: false, why: `no ${PROVENANCE_FILE} in the overlay — nothing recorded when these files were taken`, entries: {} };
  try {
    const doc = JSON.parse(readFileSync(p, "utf8"));
    const entries = doc && typeof doc === "object" ? (doc.files ?? doc) : {};
    return { present: true, why: null, entries: entries && typeof entries === "object" ? entries : {} };
  } catch (e) {
    // UNREADABLE IS NOT ABSENT. A parse failure here would otherwise read as "nothing was recorded",
    // which is the one thing this file exists to distinguish.
    return { present: false, unreadable: true, why: `${PROVENANCE_FILE} is present but unreadable: ${String(e.message).slice(0, 120)}`, entries: {} };
  }
}

/** CHANGED / UNCHANGED / UNKNOWN — and UNKNOWN is a first-class answer, not a fallback to UNCHANGED. */
function driftOf(rel, baseRoot, prov) {
  const rec = prov.entries?.[rel];
  const recorded = rec && typeof rec === "object" ? String(rec.sha256 ?? "") : "";
  if (!recorded) return { state: "unknown", why: "no recorded point for this file — it was overridden before provenance was kept, or the record was lost" };
  const basePath = join(baseRoot, rel);
  if (!existsSync(basePath)) return { state: "upstream-gone", why: "upstream no longer ships this file" };
  let now;
  try { now = sha256(readFileSync(basePath)); }
  catch (e) { return { state: "unknown", why: `the upstream copy could not be read: ${String(e.message).slice(0, 90)}` }; }
  return now === recorded
    ? { state: "unchanged", why: null }
    : { state: "changed", why: `upstream has moved since this copy was taken${rec.taken_at ? ` (${rec.taken_at})` : ""}` };
}

/**
 * @param {{baseRoot: string, overlayRoot: string|null}} roots
 * @returns a report, never a throw — a doctor that dies tells the user less than one that says why.
 */
export function overlayReport({ baseRoot, overlayRoot }) {
  const base = treeFiles(baseRoot);
  if (base === null) {
    return { ok: false, reason: `the base doctrine tree is missing at ${baseRoot} — this install cannot serve doctrine at all`,
      overlayConfigured: Boolean(overlayRoot), overridden: [], added: [], baseOnly: [], provenance: null };
  }
  if (!overlayRoot) {
    return { ok: true, reason: null, overlayConfigured: false, base, overridden: [], added: [], baseOnly: base, provenance: null };
  }
  const over = treeFiles(overlayRoot);
  if (over === null) {
    // Configured but absent is a DEPLOY DEFECT, the same judgement resolveSkillPath makes when it throws
    // on an unreadable overlay: every file would silently fall back to the repo default.
    return { ok: false, reason: `an overlay is configured at ${overlayRoot} but it does not exist — every doctrine file is silently falling back to the repo copy`,
      overlayConfigured: true, base, overridden: [], added: [], baseOnly: base, provenance: null };
  }
  const baseSet = new Set(base), overSet = new Set(over);
  const prov = readProvenance(overlayRoot);
  const overridden = over.filter((f) => baseSet.has(f)).map((rel) => ({ rel, drift: driftOf(rel, baseRoot, prov) }));
  return {
    ok: true, reason: null, overlayConfigured: true, base,
    overridden,
    added: over.filter((f) => !baseSet.has(f)),        // overlay-only: this install's own material
    baseOnly: base.filter((f) => !overSet.has(f)),     // not overridden — upstream is what runs
    provenance: prov,
  };
}

/** One renderer, so a `doctor` and an `update` tail cannot describe the same install differently. */
export function renderOverlayReport(r, { indent = "" } = {}) {
  const out = [];
  const p = (s = "") => out.push(s ? indent + s : "");
  if (!r.ok) { p(`doctrine overlay: CANNOT REPORT — ${r.reason}`); return out; }
  if (!r.overlayConfigured) {
    p(`doctrine overlay: none configured — this install overrides nothing, and all ${r.base.length} doctrine file(s) come from the product.`);
    p("That is a normal, supported state; upgrading moves them with the code.");
    return out;
  }
  p(`doctrine overlay: ${r.overridden.length} overridden · ${r.added.length} added by this install · ${r.baseOnly.length} taken from the product`);
  if (!r.overridden.length && !r.added.length) {
    p("The overlay is configured but overrides nothing — every doctrine file comes from the product.");
    return out;
  }
  const by = (s) => r.overridden.filter((o) => o.drift.state === s);
  const changed = by("changed"), unknown = by("unknown"), gone = by("upstream-gone");
  if (!r.provenance?.present) {
    p();
    p(`CANNOT SAY WHETHER UPSTREAM HAS MOVED — ${r.provenance?.why}.`);
    p("Every override below is reported as UNKNOWN rather than unchanged: a baseline nobody recorded");
    p("cannot be inferred after the fact. New overrides record their point from now on.");
  }
  for (const [label, rows] of [["CHANGED UPSTREAM since you took it", changed],
                               ["NO LONGER SHIPPED upstream", gone],
                               ["UNKNOWN — no recorded point", unknown]]) {
    if (!rows.length) continue;
    p();
    p(`${label} (${rows.length})`);
    // A reason repeated identically on every row buries the list it is meant to explain — on a real
    // install this group is EVERY doctrine file. State a shared reason once, per-file only when it
    // differs, so the names stay readable.
    const reasons = new Set(rows.map((o) => o.drift.why ?? ""));
    const shared = reasons.size === 1 ? [...reasons][0] : null;
    if (shared) p(`  (${shared})`);
    for (const o of rows) p(`  · ${o.rel}${!shared && o.drift.why ? `  — ${o.drift.why}` : ""}`);
  }
  if (r.added.length) {
    p();
    p(`ADDED BY THIS INSTALL — no upstream counterpart (${r.added.length})`);
    for (const f of r.added) p(`  · ${f}`);
  }
  p();
  p("Nothing here is merged for you. This says what diverged; what to do about it is yours.");
  return out;
}
