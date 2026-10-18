// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// PLACEMENT'S DECISIONS REACH THE AUDIT, AND END A RECALL POSITION.
//
// Placement sets lines aside by name and under its groups' rows, each with a ground. Those decisions reached no
// delivered file: the run's own ledger held them, and the recall check went on asking the reading step to end, one
// by one, positions placement had already decided. Ruled 2026-10-18: a validated decision is delivered in the
// existing Audit Trail, in its own fields, with its reference, its ground and a group row's count, and recall
// reconciliation then accepts it. A set-aside by name is an individual ending, for any position; a group's row ends
// only a residual position, for the members it validly covers, as a ruled crowd does, never a top-slice position
// that must end individually. A decision the shape no longer supports is neither delivered nor accepted. Every
// mark and owner is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { paths } from "../stages.mjs";
import { buildBandShape, deriveRegisterPositions } from "../band-shape.mjs";
import { setAsideKeysOf, renderPlacementsJson } from "../placement-form.mjs";
import { unionPlacementForm } from "../placement-union.mjs";
import { writePlacementForm } from "../placement-form-io.mjs";
import { goodsWordCounter, goodsWordsMatched } from "../record-goods.mjs";
import { placementAuditRows, placementRecallEndings } from "../pipeline.mjs";
import { buildAuditMd } from "../publish/audit-from-spine.mjs";
import { reconcileRecall, RECALL_EVENT_FIELDS } from "../recall-reconciliation.mjs";
import { driverDir } from "../../shared/driver-dir.mjs";

const rec = (id, mark, owner) => ({ record_id: `/mark/eu/${id}`, mark_text: mark, owner_name: owner, classes: ["9"], status: "registered", jurisdictions: ["EU"] });
const BAND = [rec("a1", "QZORVAK", "Alpha Ltd"), rec("a2", "Plimbo", "Alpha Ltd"), rec("r1", "Drellux", "Delta AG"), rec("r2", "Vorrin", "Eta Kft")];
const GOODS = { a1: "joysticks", a2: "joysticks", r1: "printers", r2: "printers" };

function seedRun(t) {
  const runDir = mkdtempSync(join(tmpdir(), "placement-audit-"));
  t.after(() => rmSync(runDir, { recursive: true, force: true }));
  mkdirSync(driverDir(runDir), { recursive: true });
  const positions = deriveRegisterPositions(BAND);
  const goods = { of: (r) => [{ classes: ["9"], text: GOODS[r.record_id.split("/").pop()] }], hits: goodsWordCounter(["joysticks"]), matched: goodsWordsMatched(["joysticks"]) };
  const { shape } = buildBandShape({ enumerated: BAND }, { targets: ["Qzorvak"], inScopeClasses: ["9"], positions, goods, keysOf: setAsideKeysOf(positions.positions) });
  const read = ["a", "b", "c", "d", "rest", "no_goods"].flatMap((g) => shape.groups[g].list.map((l) => l.key));
  const input = { floors: shape.floors.in_class_identical_or_near, positions: positions.positions, groups: shape.groups, served: { lines: new Set(read), records: new Set() } };
  const u = unionPlacementForm(null, { rows: [
    { select: "/mark/eu/a1", tier: "headline-candidate", reason: "identical, live, for the client's own goods" },
    { set_aside: "/mark/eu/a2", ground: "a different product, sold only to farmers" },
    { set_aside_group: "rest", count: shape.groups.rest.records, ground: "similar to none of the mark's forms" },
  ] }, input);
  const P = paths(runDir);
  writeFileSync(P.registerNamedBand, JSON.stringify({ enumerated: BAND, crowds: [] }));
  writeFileSync(P.bandShape, JSON.stringify(shape));
  writeFileSync(P.registerPositions, JSON.stringify(positions));
  writePlacementForm(runDir, u.form);
  writeFileSync(driverDir(runDir, "reading-log.jsonl"), JSON.stringify({ ts: "2026-10-18T00:00:00Z", tool: "band_shape", args: { format: "md" },
    ok: true, part: 1, parts: 1, served_lines: read, session: "clearance-x-y-placement-inquiry" }) + "\n");
  writeFileSync(P.placementModel, JSON.stringify(renderPlacementsJson(u.form.rows)));
  return { P, shape };
}

test("each standing decision is an Audit Trail row: its reference, its ground and a group's count, in the trail's own fields", (t) => {
  const { P, shape } = seedRun(t);
  assert.equal(shape.groups.rest.records, 2, "guard: two records in the rest");
  const rows = placementAuditRows(P);
  assert.deepEqual(rows, [
    { source_layer: "Register", step: "placement", query: "Plimbo — Alpha Ltd (/mark/eu/a2)", rationale: "a different product, sold only to farmers" },
    { source_layer: "Register", step: "placement", query: "group (rest)", rationale: "similar to none of the mark's forms", result_summary: "2 records" },
  ]);
  const { md, counts } = buildAuditMd("# Register findings\n", "", { placementRows: rows });
  const trail = md.slice(md.indexOf("# Audit Trail"));
  assert.ok(trail.includes("## AT1\n- source_layer: Register\n- step: placement\n- query: Plimbo — Alpha Ltd (/mark/eu/a2)\n- rationale: a different product, sold only to farmers\n"));
  assert.ok(trail.includes("## AT2\n- source_layer: Register\n- step: placement\n- query: group (rest)\n- rationale: similar to none of the mark's forms\n- result_summary: 2 records\n"));
  assert.equal(counts.audit, 2);
  assert.ok(!/Set aside at placement/.test(md), "no new section or heading");
});

test("recall reconciliation accepts placement's decisions: by name for any position, a group's row for the residual only", (t) => {
  const { P } = seedRun(t);
  const placement = placementRecallEndings(P, BAND.map((r) => r.record_id));
  assert.deepEqual([[...placement.byName].sort(), [...placement.byGroup].sort()], [["/mark/eu/a2"], ["/mark/eu/r1", "/mark/eu/r2"]]);
  const cand = (r) => ({ record_id: r.record_id, mark_text: r.mark_text, basis: "concatenation", classes: ["9"], status: "registered", registry: "EU" });
  const recon = (topSlice) => reconcileRecall({ candidates: BAND.slice(1).map(cand), endings: { carried: new Set(), dropRows: new Set() }, topSlice, placement });
  const all = recon(3);
  const endingOf = (a, id) => [...a.top_slice, ...a.unended].find((r) => r.record_id === `/mark/eu/${id}`)?.ending ?? null;
  assert.equal(endingOf(all, "a2"), "placement-set-aside", "a set-aside by name ends a top-slice position");
  assert.equal(endingOf(all, "r1"), null, "a group's row ended a top-slice position, which must end individually");
  assert.equal(all.totals.unended, 2);
  const residual = recon(0);
  assert.equal(residual.totals.unended, 0, "a group's row ends the residual positions it validly covers");
  assert.equal(residual.totals.ended_placement, 3);
  assert.ok(RECALL_EVENT_FIELDS.includes("ended_placement"));
});

test("with no standing decision, nothing is delivered and nothing ends by placement", (t) => {
  const { P } = seedRun(t);
  writePlacementForm(P.runDir, { rows: [], set_aside: [], set_aside_groups: [] });
  assert.deepEqual(placementAuditRows(P), []);
  const placement = placementRecallEndings(P, BAND.map((r) => r.record_id));
  assert.equal(placement.byName.size + placement.byGroup.size, 0);
});
