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
import { buildSelectionIndex, setAsideGrounds, isSetAsideGroupRow, lineKey, groupName } from "./placement-form.mjs";
import { unionPlacementForm } from "./placement-union.mjs";
import { readPlacementForm, readPlacementFormInput } from "./placement-form-io.mjs";
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
  // placed line nor a named one is the row's, and a placed floor is not one it leaves.
  const { form } = unionPlacementForm({ rows: Array.isArray(rows) ? rows : [], set_aside: [...named, ...grouped] }, null, input);
  return [...named, ...form.set_aside_groups];
}

/** The set-aside grounds the placement form holds, by name and by group, as uri → entry, through the form's own selection index. */
export function placementSetAsideGrounds(P) {   // @internal — driven by its test with a run's own files
  try {
    const form = readPlacementForm(P.runDir);
    if (!form.set_aside?.length) return () => null;
    const input = readPlacementFormInput(P.runDir);
    const placedUris = placedUriRows(P).map((r) => r.uri);
    return setAsideGrounds(standingSetAside(form.set_aside, input, { placedUris, rows: form.rows }), buildSelectionIndex(input), input.groups, input.floors,
      { placedUris });
  } catch { return () => null; }
}

/**
 * THE FLOORS PLACEMENT SET ASIDE, AS THE REVIEW IS TOLD THEM: one line per floor of the shape now on disk whose
 * set-aside stands, by name on its status or its territory, or under a crowd's row, with placement's ground. Only
 * decisions that stand on the current shape are listed (`placementSetAsideGrounds`, which checks a group's row
 * again); a floor with no standing decision is not listed, so the review flags it as before. [] when nothing stands
 * or nothing can be read. IMPURE (reads the run).
 */
export function placementFloorDecisionLines(P) {   // @internal — driven by its test with a run's own files
  try {
    const floors = safeReadJson(P.bandShape)?.floors?.in_class_identical_or_near;
    if (!Array.isArray(floors) || !floors.length) return [];
    const groundOf = placementSetAsideGrounds(P);
    const out = [];
    for (const f of floors) {
      const g = f?.record_id ? groundOf(f.record_id) : null;
      if (!g?.ground) continue;
      const who = `${f.mark_text ?? "(unnamed)"}${f.owner_name ? ` — ${f.owner_name}` : ""} (${f.record_id})`;
      if (g.by === "group") out.push(`- ${who}: covered by group (${g.group})'s row: ${g.ground}`);
      else if (g.on === "status" || g.on === "territory") out.push(`- ${who}: set aside on its ${g.on}: ${g.ground}`);
    }
    return out;
  } catch { return []; }
}

/**
 * PLACEMENT'S ACCEPTED SET-ASIDES THAT STAND ON THE RUN'S FILES, as data: one entry per decision (`standingSetAside`: a
 * group's row checked again on the shape beside what placement placed and named, a set-aside by name only while the
 * band holds its record and no placement places its line). A name's entry gives the record the record tools open, its
 * mark and owner, its ground and, for a floor, what the ground is on; a group's row its name, the records in the group,
 * the lines it covers (the group's lines placement neither placed nor named) and its ground, with every floor it leaves
 * to be placed or named. [] when nothing stands or nothing can be read. IMPURE (reads the run).
 */
export function standingPlacementDecisions(P) {   // @internal — driven by its test with a run's own files
  try {
    const form = readPlacementForm(P.runDir);
    if (!form.set_aside?.length) return [];
    const input = readPlacementFormInput(P.runDir);
    const index = buildSelectionIndex(input);
    return standingSetAside(form.set_aside, input, { placedUris: placedUriRows(P).map((r) => r.uri), rows: form.rows }).flatMap((e) => {
      if (!e?.ground) return [];
      if (isSetAsideGroupRow(e)) return [{ kind: "group", group: groupName(e.set_aside_group), records: Number(e.count ?? 0),
        covers_lines: Number(e.covers_lines ?? 0), ground: e.ground, floors_not_covered: Array.isArray(e.floors_not_covered) ? e.floors_not_covered : [] }];
      const c = index.resolve(e.set_aside);
      return [{ kind: "name", record: e.set_aside, mark: c?.mark ?? null, owner: c?.owner ?? null, ground: e.ground,
        ...(e.on === "status" || e.on === "territory" ? { on: e.on } : {}) }];
    });
  } catch { return []; }
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
