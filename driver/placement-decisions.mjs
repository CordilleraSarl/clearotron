// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// placement-decisions.mjs — PLACEMENT'S DECISIONS AS THEY STAND ON A RUN'S FILES, for every reader that is told them.
//
// Placement sets lines aside by name and under its groups' rows, each with a ground, and keeps them out of
// placements.json. One check says which of them still stand (a group's row checked again on the shape now on disk; a
// set-aside by name while the band still holds its record and no placement places its line), and every reader takes
// them through it: the delivered Audit Trail, recall reconciliation, the review's list of floors, and the list the
// reading step and the writer are given. Here rather than in the pipeline so that the MCP server's rebuild of a
// missing audit, which loads no publishing code, delivers the same rows the driver's audit builder does. Reads the
// run's files; never writes them.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createHash } from "node:crypto";
import { buildSelectionIndex, setAsideGrounds, isSetAsideGroupRow, lineKey, groupName, servedLines, FLOOR_GROUND_ON } from "./placement-form.mjs";
import { unionPlacementForm } from "./placement-union.mjs";
import { readPlacementForm, readPlacementFormInput, placementFormStamp, placementFormPaths } from "./placement-form-io.mjs";
import { parsePlacementsJson } from "./placement-model.mjs";

const safeReadJson = (p) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };

/** Every record uri a placements.json names. */
export function placedUriRows(P) {
  try {
    const placements = parsePlacementsJson(readFileSync(P.placementModel, "utf8")).placements;
    const out = [];
    for (const p of Array.isArray(placements) ? placements : []) {
      for (const r of Array.isArray(p?.records) ? p.records : []) out.push({ uri: r, tier: p?.tier ?? null });
    }
    return out;
  } catch { return []; }
}


/**
 * The form's set-aside entries as they stand on the shape now on disk, and on what placement placed. A ground by
 * name stands while the band still holds its record and no placement places its line: a later pass that places
 * the line reverses the set-aside, as the fate count already reads it, and a record the band no longer holds has
 * no decision left to deliver. A group's row is checked again exactly as the union took it, on its count and on
 * every line read, because the shape may have been derived again since: a resumed run derives it afresh, and a
 * record body fetched after placement can move a line out of the list the goods test could not place and into a
 * group. A row taken on the earlier shape then covers no line the later one added. `placedUris` are the records
 * the placements carry, and `rows` the form's own rows, from which the union reads the lines placement placed.
 * Nothing is written back. PURE.
 */
export function standingSetAside(entries, input, { placedUris = [], rows = [] } = {}) {
  const all = Array.isArray(entries) ? entries : [];
  const index = buildSelectionIndex(input);
  const placedLines = new Set([...placedUris].map((u) => lineKey(index.resolve(u))).filter(Boolean));
  const named = all.filter((e) => !isSetAsideGroupRow(e)).filter((e) => {
    const line = lineKey(index.resolve(e?.set_aside));
    return Boolean(line) && !placedLines.has(line);
  }).map((e) => ({ ...e, key: lineKey(index.resolve(e.set_aside)) }));
  const grouped = all.filter(isSetAsideGroupRow);
  if (!grouped.length) return named;
  // A group's row is taken again beside the lines placement placed (`rows`, the form's own) and the ones it named that
  // still stand, so the lines it covers and the floors it leaves are counted as the fate count reads them: neither a
  // placed line nor a named one is the row's, and a placed floor is not one it leaves. Each row carries the keys of
  // the lines it covers (`covered_lines`), which the form itself never says back.
  const { form, covered_lines: covered } = unionPlacementForm({ rows: Array.isArray(rows) ? rows : [], set_aside: [...named, ...grouped] }, null, input,
    { covered: true });
  return [...named, ...form.set_aside_groups.map((e) => ({ ...e, covered_lines: covered?.[e.set_aside_group] ?? [] }))];
}

/** The set-aside grounds the placement form holds, by name and by group, as uri → entry, through the form's own selection index. */
export function placementSetAsideGrounds(P) {   // @internal — driven by its test with a run's own files
  try {
    const form = readPlacementForm(P.runDir);
    if (!form.set_aside?.length) return () => null;
    const input = readPlacementFormInput(P.runDir);
    const placedUris = placedUriRows(P).map((r) => r.uri);
    const index = buildSelectionIndex(input);
    return setAsideGrounds(standingSetAside(form.set_aside, input, { placedUris, rows: form.rows }), index, input.groups, input.floors,
      { placedUris, served: servedLines(input.groups, input.served, index) });
  } catch { return () => null; }
}

/**
 * THE FLOORS PLACEMENT SET ASIDE, AS THE REVIEW IS TOLD THEM: one line per standing decision on the shape now on disk,
 * with placement's ground once. A set-aside by name, on its status, territory, goods or mark, covers one floor and names it. A
 * crowd's row names its ground once and then every floor it covers, by record: the ground is the group's, so it was
 * never the floors' to repeat, and on a test run of a crowded matter repeating it on each of 1,177 floors made the
 * review's opening message 866 KB of its 899. Only decisions that stand on the current shape are listed
 * (`placementSetAsideGrounds`, which checks a group's row again); a floor with no standing decision is not listed, so
 * the review flags it as before. [] when nothing stands or nothing can be read. IMPURE (reads the run).
 */
export function placementFloorDecisionLines(P) {   // @internal — driven by its test with a run's own files
  try {
    const floors = safeReadJson(P.bandShape)?.floors?.in_class_identical_or_near;
    if (!Array.isArray(floors) || !floors.length) return [];
    const groundOf = placementSetAsideGrounds(P);
    const out = [];
    const rows = new Map();   // a crowd's row, by its group and ground: listed where its first floor falls
    for (const f of floors) {
      const g = f?.record_id ? groundOf(f.record_id) : null;
      if (!g?.ground) continue;
      if (g.by === "group") {
        const key = `${g.group}\u0000${g.ground}`;
        if (!rows.has(key)) { rows.set(key, { group: g.group, ground: g.ground, ids: [] }); out.push(rows.get(key)); }
        rows.get(key).ids.push(f.record_id);
      } else if (FLOOR_GROUND_ON.includes(g.on)) {
        out.push(`- ${f.mark_text ?? "(unnamed)"}${f.owner_name ? ` — ${f.owner_name}` : ""} (${f.record_id}): set aside on its ${g.on}: ${g.ground}`);
      }
    }
    return out.map((e) => (typeof e === "string" ? e : `- covered by group (${e.group})'s row: ${e.ground} (${e.ids.join(", ")})`));
  } catch { return []; }
}

/**
 * PLACEMENT'S ACCEPTED SET-ASIDES THAT STAND ON THE RUN'S FILES, as data: one entry per decision (`standingSetAside`: a
 * group's row checked again on the shape beside what placement placed and named, a set-aside by name only while the
 * band holds its record and no placement places its line). A name's entry gives the record the record tools open, its
 * mark and owner, its ground and, for a floor, what the ground is on; a group's row its name, the records in the group,
 * the lines it covers (the group's lines placement neither placed nor named) and its ground, with every floor it leaves
 * to be placed or named. A group's row also carries a hash of the keys of the lines it covers, so a row that comes to
 * cover other lines at the same count is a changed decision to every stage that reads it, while the file stays small
 * enough for a stage to open. [] when nothing stands or nothing can be read. IMPURE (reads the run).
 */
export function standingPlacementDecisions(P) {   // @internal — driven by its test with a run's own files
  // A FORM THAT IS NOT THERE IS NOT "NOTHING SET ASIDE". Every failure here used to read as an empty list, so a writer in
  // the experiment sandbox, which held no form, was told of no set-aside at all on a run whose placement had set 178
  // aside. Where this run's placement records its decisions on a form (the era stamp), a missing or unreadable form is
  // refused by name, and so is a failure reading what stands. A run from before the form had none, and its empty list
  // is true.
  const form = readPlacementForm(P.runDir);
  if (form.error) throw new Error(`placement_form_unreadable: ${form.error} — placement's set-asides cannot be read, and an unread form is not "none set aside"`);
  if (!form.present) {
    if (placementFormStamp(P.runDir).required)
      throw new Error(`placement_form_missing: this run's placement records its decisions on a form, and ${placementFormPaths(P.runDir).sidecar} is not there — refusing to read its absence as "none set aside"`);
    return [];
  }
  if (!form.set_aside?.length) return [];
  try {
    const input = readPlacementFormInput(P.runDir);
    const index = buildSelectionIndex(input);
    return standingSetAside(form.set_aside, input, { placedUris: placedUriRows(P).map((r) => r.uri), rows: form.rows }).flatMap((e) => {
      if (!e?.ground) return [];
      if (isSetAsideGroupRow(e)) return [{ kind: "group", group: groupName(e.set_aside_group), records: Number(e.count ?? 0),
        covers_lines: Number(e.covers_lines ?? 0), ground: e.ground, floors_not_covered: Array.isArray(e.floors_not_covered) ? e.floors_not_covered : [],
        covered_lines_hash: createHash("sha256").update((e.covered_lines ?? []).join("\n")).digest("hex").slice(0, 16) }];
      const c = index.resolve(e.set_aside);
      return [{ kind: "name", record: e.set_aside, mark: c?.mark ?? null, owner: c?.owner ?? null, ground: e.ground,
        ...(FLOOR_GROUND_ON.includes(e.on) ? { on: e.on } : {}) }];
    });
  } catch (e) { throw new Error(`placement_decisions_unreadable: ${String(e?.message ?? e).slice(0, 200)} — what placement set aside could not be worked out from its form`); }
}

/**
 * WHERE EACH RECORD STANDS IN PLACEMENT'S ACCOUNT: a placed record by its tier, a record set aside by name by its ground,
 * and each group's row as one entry with the records it holds, which it does not name. Read before and after a repeated
 * placement pass, it says how many records the pass re-ranked. IMPURE (reads the run).
 */
export function rankingNow(P) {   // @internal — driven by its test with a run's own files
  const records = new Map();
  for (const r of placedUriRows(P)) records.set(String(r.uri).toLowerCase(), `placed:${r.tier ?? ""}`);
  const groups = new Map();
  // The re-rank count runs inside the delivery loop, and a run always delivers: here a refusal counts no decision, and
  // the writer's own message, which reads the same decisions, is where it is refused.
  let decisions = [];
  try { decisions = standingPlacementDecisions(P); } catch { decisions = []; }
  for (const d of decisions) {
    if (d.kind === "group") groups.set(d.group, { key: `${d.ground}|${d.covers_lines}|${d.covered_lines_hash}`, records: d.records });
    else records.set(String(d.record).toLowerCase(), `set aside${d.on ? ` on its ${d.on}` : ""}: ${d.ground}`);
  }
  return { records, groups };
}

/** A ranking as it is kept on disk: its two maps as plain objects. PURE. */
export function rankingToJson(ranking) {
  return { records: Object.fromEntries(ranking?.records ?? []), groups: Object.fromEntries(ranking?.groups ?? []) };
}

/** A ranking kept on disk, read back into its two maps; null when there is none to read. PURE. */
export function rankingFromJson(json) {
  if (!json || typeof json !== "object" || typeof json.records !== "object" || typeof json.groups !== "object") return null;
  return { records: new Map(Object.entries(json.records ?? {})), groups: new Map(Object.entries(json.groups ?? {})) };
}

/** How many records a ranking accounts for: each named record once, and every record a group's row holds. PURE. */
export function rankedRecords(ranking) {
  return (ranking?.records?.size ?? 0) + [...(ranking?.groups?.values() ?? [])].reduce((n, g) => n + (Number(g?.records) || 0), 0);
}

/**
 * How many records stand differently in `after` than in `before`: a named record that moved, appeared or went counts
 * once, and a group's row that changed counts every record it holds, as it names none of them. PURE.
 */
export function recordsReRanked(before, after) {
  let n = 0;
  for (const id of new Set([...(before?.records?.keys() ?? []), ...(after?.records?.keys() ?? [])]))
    if (before?.records?.get(id) !== after?.records?.get(id)) n++;
  for (const g of new Set([...(before?.groups?.keys() ?? []), ...(after?.groups?.keys() ?? [])])) {
    const a = before?.groups?.get(g), b = after?.groups?.get(g);
    if (a?.key !== b?.key || a?.records !== b?.records) n += Math.max(Number(a?.records) || 0, Number(b?.records) || 0);
  }
  return n;
}

/**
 * THE SAME DECISIONS, AS THE READING STEP AND THE WRITER ARE TOLD THEM: one line each, under the approved introduction.
 * A group's floors are listed up to twenty; beyond that the line says how many more there are and names the file that
 * holds every one of them (`writePlacementDecisions`), so a shortened list never stands in for the whole. IMPURE.
 */
export function placementSetAsideLines(P, decisions = standingPlacementDecisions(P)) {   // @internal — driven by its test with a run's own files
  const n = (x) => Number(x ?? 0).toLocaleString("en-US");
  const listed = (ids) => (ids.length > 20 ? `${ids.slice(0, 20).join(", ")}, and ${n(ids.length - 20)} more, all listed in ${P.placementDecisions}` : ids.join(", "));
  return decisions.map((d) => (d.kind === "group"
    ? `- group (${d.group})'s row, ${n(d.records)} records in the group, covering ${n(d.covers_lines)} lines: ${d.ground}`
      + (d.floors_not_covered.length ? `; the floors it does not cover: ${listed(d.floors_not_covered)}` : "")
    : `- ${d.mark ?? d.record}${d.owner ? ` — ${d.owner}` : ""} (${d.record}): set aside${d.on ? ` on its ${d.on}` : ""}: ${d.ground}`));
}

/**
 * The standing decisions, written where the reading step and the writer declare them as an input, so a change to a
 * decision alone (a reason, a group's membership) makes a reader that already ran stale, and the delivery loop repeats
 * it, as it does when the placements change. No clock: the file changes only when a decision does. Returns the
 * decisions written. IMPURE (writes `_driver/placement-decisions.json`).
 */
export function writePlacementDecisions(P) {   // @internal — driven by its test with a run's own files
  const decisions = standingPlacementDecisions(P);
  mkdirSync(dirname(P.placementDecisions), { recursive: true });
  writeFileSync(P.placementDecisions, JSON.stringify({ schema_version: 1, decisions }, null, 2) + "\n");
  return decisions;
}

/**
 * PLACEMENT'S DECISIONS IN THE DELIVERED AUDIT TRAIL (ruled 2026-10-18): one row per set-aside that stands on the shape
 * now on disk, in the Audit Trail's own fields, carrying the decision's reference, its ground and, for a group's row,
 * its count. A set-aside the shape no longer supports is not delivered. [] when there is none or nothing can be read.
 * IMPURE (reads the run).
 */
export function placementAuditRows(P) {   // @internal — driven by its test with a run's own files
  try {
    const form = readPlacementForm(P.runDir);
    if (!form.set_aside?.length) return [];
    const input = readPlacementFormInput(P.runDir);
    const index = buildSelectionIndex(input);
    return standingSetAside(form.set_aside, input, { placedUris: placedUriRows(P).map((r) => r.uri), rows: form.rows }).flatMap((e) => {
      if (!e?.ground) return [];
      if (isSetAsideGroupRow(e)) return [{ source_layer: "Register", step: "placement", query: `group (${groupName(e.set_aside_group)})`,
        rationale: e.ground, result_summary: `${Number(e.count ?? 0).toLocaleString("en-US")} records` }];
      const c = index.resolve(e.set_aside);
      return [{ source_layer: "Register", step: "placement",
        query: `${c?.mark ?? e.set_aside}${c?.owner ? ` — ${c.owner}` : ""} (${e.set_aside})`, rationale: e.ground }];
    });
  } catch { return []; }
}

/**
 * The records placement set aside, as recall reconciliation accepts them now that the audit delivers them: by name,
 * an individual ending for any position; under a group's row, the members that row validly covers, which end only a
 * residual position, as a ruled crowd does. Lower-cased uris. Empty when nothing stands. IMPURE (reads the run).
 */
export function placementRecallEndings(P, uris) {   // @internal — driven by its test with a run's own files
  const byName = new Set(), byGroup = new Set();
  try {
    const groundOf = placementSetAsideGrounds(P);
    for (const u of uris ?? []) {
      const g = u ? groundOf(u) : null;
      if (!g?.ground) continue;
      (g.by === "group" ? byGroup : byName).add(String(u).toLowerCase());
    }
  } catch { /* nothing stands */ }
  return { byName, byGroup };
}
