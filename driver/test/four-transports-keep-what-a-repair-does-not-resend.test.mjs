// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// — THE REMAINING FOUR HOLES, IN THE PATTERN report-overview ESTABLISHED.
//
// ── THE CLASS ───────────────────────────────────────────────────────────────────────────────────────
//
// A transport that writes its artifact WHOLESALE, and whose schema makes a content field OPTIONAL,
// accepts a call carrying only part of the document and silently deletes the rest. Five of the fifteen
// return-path transports were measured with it. report-overview was fixed first and alone, as the
// pattern; these are the other four.
//
// What each one loses, measured before the fix:
//
//   record_prelim_variants   incumbent_classes, watchlist_owners, search_floor
//   record_blind_frame       sources
//   record_matter_frame      scope_jurisdictions, excluded_jurisdictions
//   record_unit_note         null_result, note
//
// ── WHY PRESERVE AND NOT REQUIRE ────────────────────────────────────────────────────────────────────
//
// Requiring the fields would turn a legitimate omission into a REFUSAL on stages that feed what the
// client reads. None of these can tell a first call from a repair, so a partial is indistinguishable
// from a first call — and a product refusal is never a pass, however correct the reason.
//
// ── THE TWO BEHAVIOURS DO NOT CONFLICT ──────────────────────────────────────────────────────────────
//
//   OMITTED key   → PRESERVE. The seat said nothing about it; the stored value stands.
//   MISPLACED key → REFUSE, BY PATH, before the merge — 's measured shape, where a
//                   real field sent into a typed object that does not declare it was accepted and
//                   dropped. A top-level-only check passes on exactly that call.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { recordPrelimVariants, lastAcceptedPrelimVariants, mergePrelimVariantsCall, refuseUndeclared as refuseVariants } from "../prelim-variants-record.mjs";
import { recordBlindFrame, lastAcceptedBlindFrame, mergeBlindFrameCall, refuseUndeclared as refuseBlindFrame } from "../blind-frame-record.mjs";
import { recordMatterFrame, lastAcceptedMatterFrame, mergeMatterFrameCall, refuseUndeclared as refuseMatterFrame } from "../matter-frame-record.mjs";
import { recordUnitNote, lastAcceptedUnitNote, mergeUnitNoteCall, refuseUndeclared as refuseUnitNote, unitPaths } from "../register-unit-record.mjs";

const DRIVER = join(dirname(fileURLToPath(import.meta.url)), "..");
const runDir = () => mkdtempSync(join(tmpdir(), "four-holes-"));

const SCOPE_ROWS = [
  { layer: "variant", item: "phonetic-family", status: "applied", reason: "sound-alike neighbours are in scope", reopen_trigger: "" },
  { layer: "jurisdiction", item: "EU", status: "applied", reason: "instructed territory", reopen_trigger: "" },
  { layer: "jurisdiction", item: "CN", status: "dropped", reason: "not instructed, no signalled market", reopen_trigger: "a CN filing surfaces" },
  { layer: "field", item: "game software", status: "applied", reason: "goods-overlap", reopen_trigger: "" },
  { layer: "source", item: "developer ecosystems", status: "dropped", reason: "off-channel for this product", reopen_trigger: "a listing surfaces" },
];

const VARIANTS_FULL = Object.freeze({
  mark: "PROJECT NOVAPULSE", dominant_element: "NOVAPULSE",
  elements: [{ value: "NOVAPULSE", kind: "distinctive" }, { value: "PROJECT", kind: "common" }],
  variants: [{ value: "NOVAPULSE", category: "core", rationale: "the mark itself" }, { value: "NOVAPULZE", category: "phonetic", rationale: "sound-alike" }],
  incumbent_classes: ["9"], watchlist_owners: ["BigCo Interactive"], search_floor: ["primary-sweep"], scope_ledger: SCOPE_ROWS,
});

const BLIND_FULL = Object.freeze({
  dominant_element: "VELTRIN",
  variants: [{ value: "VELTRI", direction: "drop", rationale: "the element without its terminal N" }],
  fields: [{ goods: "diagnostic software", on_field: true, rationale: "the actual product" }],
  sources: [{ channel: "hospital procurement portals", rationale: "where a buyer meets the mark" }],
  ranking_basis: "goods-overlap",
});

const MATTER_FULL = Object.freeze({
  prose_body: "The matter concerns a coined pharmaceutical mark and the neighbourhood it sits in across the instructed "
    + "territories, searched to completion on the registers named below. The dominant element is distinctive rather than "
    + "descriptive, so the family of marks incorporating it is the collision zone that matters, and the sweep is scoped to "
    + "that family rather than to the full mark alone. The instructed territories are stated by the requester and the "
    + "exclusions are deliberate, each recorded with the reason it was set aside so a reader can see what was not searched.",
  scope_basis: "instructed", scope_jurisdictions: ["EU", "CH"], excluded_jurisdictions: ["CN"],
  search_channels: ["register", "common-law"], meaning_angles: ["none in the target languages"],
  intake_asks: [{ ask: "Confirm the classes", owner: "register" }],
});

/** A unit-note run needs its axis band on disk — the counts are the driver's, not the seat's. */
function unitRun(axis = "primary-sweep") {
  const d = runDir();
  const band = unitPaths(d, axis).band;
  mkdirSync(dirname(band), { recursive: true });
  writeFileSync(band, JSON.stringify({ records: [{ record_id: "/mark/us/88888888", status: "live" }, { record_id: "/mark/us/99999999", status: "live" }] }));
  return d;
}
const UNIT_FULL = Object.freeze({
  axis: "primary-sweep",
  note: "The band is dominated by one owner's family, which is why the crowd read is narrower than the raw count suggests.",
  null_result: false,
});

test("prelim-variants: a partial keeps the search floor, the watchlist and the incumbent classes", () => {
  const d = runDir();
  const first = recordPrelimVariants(d, VARIANTS_FULL);
  assert.equal(first.refused, null, `the full fixture no longer validates (${first.refused}) — this arm plants nothing`);

  const partial = { ...VARIANTS_FULL };
  delete partial.search_floor; delete partial.watchlist_owners; delete partial.incumbent_classes;
  const r = recordPrelimVariants(d, partial);
  assert.equal(r.refused, null, `the partial was refused (${r.refused}) — preserving must not fail closed`);

  const base = lastAcceptedPrelimVariants(d);
  // `search_floor` is the register-axis floor: it states which searches MUST run. A partial that drops
  // it narrows the run's own definition of coverage, and every completeness read then agrees with the
  // narrowed version — which is why this is the sharpest of the three.
  assert.deepEqual(base.search_floor, ["primary-sweep"], "the register-axis search floor did not survive a partial");
  assert.deepEqual(base.watchlist_owners, ["BigCo Interactive"], "the watchlist owners did not survive a partial");
  assert.deepEqual(base.incumbent_classes, ["9"], "the incumbent classes did not survive a partial");
});

test("blind-frame: a partial keeps the source channels the cold model is compared against", () => {
  const d = runDir();
  assert.equal(recordBlindFrame(d, BLIND_FULL).refused, null);
  const partial = { ...BLIND_FULL }; delete partial.sources;
  const r = recordBlindFrame(d, partial);
  assert.equal(r.refused, null, `the partial was refused (${r.refused})`);
  const model = JSON.parse(readFileSync(join(d, "blind-frame-model.json"), "utf8"));
  assert.equal((model.sources ?? []).length, 1,
    "the source channels did not survive a partial — that is the half frame-diff compares the actual scope against, "
    + "so losing it makes the comparison quietly narrower with nothing saying so");
});

test("matter-frame: a partial keeps the matter's territorial scope, both directions", () => {
  const d = runDir();
  assert.equal(recordMatterFrame(d, MATTER_FULL).refused, null);
  const partial = { ...MATTER_FULL }; delete partial.scope_jurisdictions; delete partial.excluded_jurisdictions;
  const r = recordMatterFrame(d, partial);
  assert.equal(r.refused, null, `the partial was refused (${r.refused})`);
  const base = lastAcceptedMatterFrame(d);
  assert.deepEqual(base.scope_jurisdictions, ["EU", "CH"], "the searched jurisdictions did not survive a partial");
  assert.deepEqual(base.excluded_jurisdictions, ["CN"],
    "the EXCLUDED jurisdictions did not survive a partial — a frame that has stopped saying what was deliberately "
    + "left out reads as a frame that never excluded anything");
});

test("unit-note: a partial keeps the seat's observation and its null-result claim", () => {
  const d = unitRun();
  assert.equal(recordUnitNote(d, UNIT_FULL).refused, null);
  const r = recordUnitNote(d, { axis: "primary-sweep" });          // the repair sends only the address
  assert.equal(r.refused, null, `the partial was refused (${r.refused})`);
  const base = lastAcceptedUnitNote(d, "primary-sweep");
  assert.match(base.note, /dominated by one owner/, "the seat's observation did not survive — the counts render without it and nothing says one was ever made");
  assert.equal(base.null_result, false, "the null-result CLAIM did not survive");

  // AND THE REASON null_result MATTERS MORE THAN A LOST DATUM: dropped, it defaults to false, so "this
  // axis found nothing" becomes "no claim made" — and `unit_null_result_contradicted`, the guard that
  // refuses a null-result claim over a band carrying records, cannot fire on a claim that is not there.
  const d2 = unitRun();
  assert.equal(recordUnitNote(d2, { ...UNIT_FULL, null_result: true, note: "No results on this axis; the band is empty." }).refused,
    null, "a legitimate null-result call was refused — the fixture, not the code");
  assert.equal(recordUnitNote(d2, { axis: "primary-sweep" }).refused, null);
  assert.equal(lastAcceptedUnitNote(d2, "primary-sweep").null_result, true,
    "a TRUE null-result claim was silently dropped to false by a partial — that disarms the contradiction guard built to check it");
});

test("a LEGITIMATE field in the WRONG object is refused BY PATH, on all four", () => {
  // Each of these is a real field of its own tool, placed in a typed sub-object that does not declare
  // it. That is 's shape, and a top-level-only unknown-key check passes on every one.
  const cases = [
    ["prelim-variants", () => refuseVariants({ ...VARIANTS_FULL, elements: [{ value: "X", kind: "distinctive", search_floor: ["primary-sweep"] }] }), /variantmodel_undeclared_field:elements\.search_floor/],
    ["blind-frame", () => refuseBlindFrame({ ...BLIND_FULL, variants: [{ value: "X", direction: "drop", rationale: "r", ranking_basis: "goods-overlap" }] }), /blindframe_undeclared_field:variants\.ranking_basis/],
    ["matter-frame", () => refuseMatterFrame({ ...MATTER_FULL, intake_asks: [{ ask: "a", owner: "register", scope_basis: "instructed" }] }), /matterframe_undeclared_field:intake_asks\.scope_basis/],
  ];
  for (const [label, run, expected] of cases) {
    const reason = run();
    assert.ok(reason, `${label} ACCEPTED a legitimate field in an object that does not declare it — the value is dropped and nothing fires`);
    assert.match(reason, expected, `${label}'s refusal must name the PATH so the seat learns where the value belongs; got: ${reason}`);
  }

  // unit-note is ABSENT from that list on purpose, and the reason is structural rather than an
  // oversight: its payload is flat — `axis`, `note`, `null_result`, no typed sub-object anywhere — so
  // there is no "wrong object" for a legitimate value to land in. The defect class cannot arise there.
  // Asserted rather than left as a silent omission, because a transport quietly dropping out of a
  // population is exactly how a census reports clean about something it never looked at.
  assert.equal(refuseUnitNote({ ...UNIT_FULL, anything_at_all: 1 }), null,
    "unit-note refused a top-level key — it has no sub-objects, so it should police nothing here");
});

test("a refused call does not become the base a later repair builds on, on all four", () => {
  const checks = [
    ["prelim-variants", runDir(), (d) => recordPrelimVariants(d, VARIANTS_FULL), (d) => recordPrelimVariants(d, { ...VARIANTS_FULL, elements: [{ value: "X", kind: "distinctive", search_floor: ["x"] }] }), (d) => lastAcceptedPrelimVariants(d)],
    ["blind-frame", runDir(), (d) => recordBlindFrame(d, BLIND_FULL), (d) => recordBlindFrame(d, { ...BLIND_FULL, variants: [{ value: "X", direction: "drop", rationale: "r", ranking_basis: "wrong object" }] }), (d) => lastAcceptedBlindFrame(d)],
    ["matter-frame", runDir(), (d) => recordMatterFrame(d, MATTER_FULL), (d) => recordMatterFrame(d, { ...MATTER_FULL, intake_asks: [{ ask: "a", owner: "register", scope_basis: "wrong object" }] }), (d) => lastAcceptedMatterFrame(d)],
    ["unit-note", unitRun(), (d) => recordUnitNote(d, UNIT_FULL), (d) => recordUnitNote(d, { ...UNIT_FULL, note: "two blank lines\n\n\nis not one observation" }), (d) => lastAcceptedUnitNote(d, "primary-sweep")],
  ];
  for (const [label, d, first, bad, read] of checks) {
    assert.equal(first(d).refused, null, `${label}: the full fixture did not pass, so every assertion below is vacuous`);
    const before = read(d);
    assert.ok(before, `${label}: no base was stored after a passing call — this arm is checking nothing`);
    assert.ok(bad(d).refused, `${label}: the undeclared-key plant was ACCEPTED`);
    assert.deepEqual(read(d), before,
      `${label}: a REFUSED call changed the stored base. One bad turn would poison every turn after it, because the `
      + "next repair merges onto whatever is stored.");
  }
});

test("an omitted key is 'unchanged'; a deliberately EMPTY one is 'there is none'", () => {
  // The distinction every one of these merges turns on. Collapsing it makes a preserve-merge silently
  // become a replace-merge for any seat that sends an empty value, and the reverse for one that means
  // to clear a field.
  assert.deepEqual(mergePrelimVariantsCall({ search_floor: ["primary-sweep"] }, { mark: "M" }).search_floor, ["primary-sweep"], "an OMITTED list must be kept");
  assert.deepEqual(mergePrelimVariantsCall({ search_floor: ["primary-sweep"] }, { mark: "M", search_floor: [] }).search_floor, [], "a deliberately EMPTY list must be honoured");
  assert.deepEqual(mergeBlindFrameCall({ sources: [{ channel: "c" }] }, {}).sources, [{ channel: "c" }]);
  assert.deepEqual(mergeBlindFrameCall({ sources: [{ channel: "c" }] }, { sources: [] }).sources, []);
  assert.deepEqual(mergeMatterFrameCall({ excluded_jurisdictions: ["CN"] }, {}).excluded_jurisdictions, ["CN"]);
  assert.equal(mergeUnitNoteCall({ null_result: true }, { axis: "a" }).null_result, true, "an omitted null_result must keep the stored claim");
  assert.equal(mergeUnitNoteCall({ null_result: true }, { axis: "a", null_result: false }).null_result, false, "an explicit false must overwrite a stored true");
  // With no base at all, a first call is itself.
  assert.equal(mergeBlindFrameCall(null, { dominant_element: "VELTRIN" }).dominant_element, "VELTRIN");
});

test("each acceptor polices the shape its server actually serves", async () => {
  // ANTI-VACUITY: each DECLARED table is stated in its module, because the server cannot be imported
  // without starting it. A hand-stated shape drifts, and a drifted one refuses a field the seat is
  // entitled to send — worse than the hole it replaced.
  const script = join(DRIVER, "engine", "mcp", "recording-server.mjs");
  const tools = await new Promise((resolve, reject) => {
    const p = spawn("node", [script], { stdio: ["pipe", "pipe", "ignore"], env: { ...process.env, CLEAROTRON_BAND_RUN_DIR: join(DRIVER, "..", ".no-such-run") } });
    let buf = "";
    const timer = setTimeout(() => { p.kill(); reject(new Error("recording-server did not answer tools/list — could not look")); }, 20000);
    p.on("error", (e) => { clearTimeout(timer); reject(e); });
    p.stdout.on("data", (d) => {
      buf += d;
      for (const line of buf.split("\n")) {
        let m; try { m = JSON.parse(line); } catch { continue; }
        if (m?.id !== 2) continue;
        clearTimeout(timer); p.kill();
        return Array.isArray(m.result?.tools) && m.result.tools.length ? resolve(m.result.tools)
          : reject(new Error("recording-server served no tools — a scan that finds nothing is not a pass"));
      }
    });
    const send = (o) => p.stdin.write(JSON.stringify(o) + "\n");
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "four-holes", version: "0" } } });
    send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  });

  const CHECKS = [
    ["record_prelim_variants", refuseVariants],
    ["record_blind_frame", refuseBlindFrame],
    ["record_matter_frame", refuseMatterFrame],
  ];
  for (const [name, refuse] of CHECKS) {
    const tool = tools.find((t) => t.name === name);
    assert.ok(tool, `${name} is not served — its acceptor is policing a shape nobody offers`);
    const props = Object.keys(tool.inputSchema?.properties ?? {});
    assert.ok(props.length > 0, `${name} served a schema with no properties — this comparison would be vacuous`);
    for (const field of props) {
      const probe = tool.inputSchema.properties[field]?.type === "array" ? [] : "x";
      assert.equal(refuse({ [field]: probe }), null,
        `the server declares '${field}' on ${name} and its acceptor refuses it — a drifted shape refuses a field the seat may send`);
    }
  }
});

test("an unknown TOP-LEVEL key is TOLERATED on all four — the regression CI caught and these arms did not", () => {
  // The first cut refused any undeclared key at ANY depth, and that killed the prelim-variants stage on
  // a long-standing mock: the fixture spreads the parsed MODEL into the CALL, so it carries
  // `schema_version`, which acceptPrelimVariants ignores because it writes its own. Inert for as long
  // as it has existed — and strict, it became fatal. 63 arms went red in CI; every arm here was green,
  // because they checked that DECLARED fields are accepted and never that an undeclared one survives.
  assert.equal(refuseVariants({ ...VARIANTS_FULL, schema_version: 5 }), null, "prelim-variants refused an inert envelope key");
  assert.equal(refuseBlindFrame({ ...BLIND_FULL, schema_version: 5 }), null, "blind-frame refused an inert envelope key");
  assert.equal(refuseMatterFrame({ ...MATTER_FULL, schema_version: 5 }), null, "matter-frame refused an inert envelope key");
  assert.equal(refuseUnitNote({ ...UNIT_FULL, schema_version: 5 }), null, "unit-note refused an inert envelope key");

  // …and the sub-object defect is still caught, or the loosening went too far.
  assert.ok(refuseVariants({ ...VARIANTS_FULL, elements: [{ value: "X", kind: "distinctive", search_floor: ["x"] }] }),
    "the loosening went too far — a legitimate key in the WRONG typed object is the defect this refusal exists for");
});
