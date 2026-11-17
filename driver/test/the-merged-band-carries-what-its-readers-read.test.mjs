// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE MERGED BAND CARRIES WHAT ITS READERS READ.
//
// Each band record carried the register's whole search row as `raw`. No stage is served it, and the merged band's
// readers read eight of its fields; the rest was size, and a band-reading stage's time limit is derived from the band's
// size. Measured in testing, 2026-11-17: a 3,224-record Signa band of 41,089,294 bytes derived a 5,712 s limit for
// placement against the 5,400 s ceiling, so placement was refused at dispatch and the run delivered no assessment.
// Kept to the fields its readers read, the same band was 25,677,439 bytes, with every class statement whole.
//
// Invented records only. The size case builds a band of the measured make-up from invented text.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mergeNamedBands, rowAsHanded, RAW_FIELDS_READ } from "../named-band.mjs";
import { derivedLimitSec, limitExceedsCeiling, stagesRefusingBand, LIMIT_CEILING_SEC } from "../band-size.mjs";
import { STAGES } from "../stages.mjs";
import { buildBandShape } from "../band-shape.mjs";
import { driverDir } from "../../shared/driver-dir.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const bytesOf = (band) => Buffer.byteLength(JSON.stringify(band, null, 2) + "\n");   // as the band is written
const baseOf = (s) => STAGES[s]?.timeoutSec;

/** One invented Signa-shaped row: the normalised fields, and a raw row of the register's 43-field shape. */
function signaRow(i, { goods = "Coffee, tea and cocoa; beverages based on coffee.", filler = 40, qid = "primary-sweep:exact:velmora" } = {}) {
  const pad = (n) => "x".repeat(n);
  return {
    record_id: `/mark/us/9${String(i).padStart(7, "0")}`, office: "uspto", mark_text: `VELMORA ${i}`, status: "Registered",
    status_class: "live", nice_classes: [30], classes: [30], owner: "Tessarin Foods", owner_name: "Tessarin Foods",
    owner_country: "US", filing_date: "2021-03-01", relevance_score: 0.5, match: "exact", goods_whole: true,
    _qid: qid, _query: `${qid} [cl 30]`,
    raw: {
      id: `tm_${i}`, object: "trademark", grain: "registration", mark_text: `VELMORA ${i}`, mark_feature_type: "word",
      mark_legal_category: "trademark", right_kind: "registration", status: { primary: "active", detail: pad(filler) },
      office_code: "US", jurisdiction_code: "US", scope_kind: "national", filing_route: "national",
      origin_office_code: "US", office_record_id: `9${i}`, office_url: `https://register.example/9${i}`,
      application_number: `9${String(i).padStart(7, "0")}`, registration_number: `6${i}`, ir_number: null,
      designation_date: null, filing_date: "2021-03-01", registration_date: "2022-01-11", expiry_date: "2032-01-11",
      renewal_due_date: null, last_renewal_date: null, publication_date: "2021-08-03", termination_date: null,
      priority_date: null, register: "principal",
      classifications: [{ nice_class: 30, goods_services_text: goods, goods_services_text_truncated: false, goods_services_language: "en", scope: null }],
      nice_classes: [30], filing_bases: [{ basis: "use", detail: pad(filler) }], design_codes: [pad(filler)],
      owners: [{ name: "Tessarin Foods", address: pad(filler), country: "US" }], has_media: false,
      primary_image_url: `https://images.example/${i}.png`, derived: { tokens: pad(filler * 8), phonetic: pad(filler * 4) },
      updated_at: "2026-11-01T00:00:00Z", relevance_score: 0.5, match: { strategy: "exact" }, highlights: [pad(filler)],
      coverage: { territories: [pad(filler)] }, source_records: [pad(filler)], owners_mixed: false,
    },
  };
}

test("a row keeps the raw fields its readers read, and nothing else changes", () => {
  const row = signaRow(1);
  const before = structuredClone(row);
  const handed = rowAsHanded(row);
  assert.deepEqual(row, before, "the input row is not changed");
  assert.deepEqual(Object.keys(handed.raw).sort(), RAW_FIELDS_READ.filter((k) => k in row.raw).sort());
  for (const k of Object.keys(handed.raw)) assert.deepEqual(handed.raw[k], row.raw[k], `${k} is kept whole`);
  assert.deepEqual(handed.raw.classifications, row.raw.classifications, "every class statement stays whole");
  const { raw: _a, ...restBefore } = row; const { raw: _b, ...restAfter } = handed;
  assert.deepEqual(restAfter, restBefore, "no other field of the record changes");
  assert.deepEqual(Object.keys(handed), Object.keys(row), "the record keeps its field order");
  // A row with no raw object is handed on as it is.
  for (const r of [{ record_id: "/mark/eu/1" }, { record_id: "/mark/eu/2", raw: ["a list"] }, null]) assert.equal(rowAsHanded(r), r);
});

test("the merge keeps the read fields on every record and crowd sample, and leaves the axis bands whole", () => {
  // Axis bands as the driver parses them (parseNamedBand): records, and crowds with their sample rows.
  const axisA = { enumerated: [signaRow(1), signaRow(2)],
    crowds: [{ qid: "primary-sweep:contains:velm", query: "contains velm [cl 30]", total_hits: 900, fetched: 25, sample: [signaRow(3)], reason: "crowd" }] };
  const axisB = { enumerated: [signaRow(2, { qid: "incumbent-class:owner" }), signaRow(4, { qid: "incumbent-class:owner" })], crowds: [] };
  const copies = structuredClone([axisA, axisB]);
  const band = mergeNamedBands([axisA, axisB]);
  assert.deepEqual([axisA, axisB], copies, "the axis bands are not changed");
  assert.equal(band.enumerated.length, 3, "one record per record id, as before");
  const rows = [...band.enumerated, ...band.crowds.flatMap((c) => c.sample ?? [])];
  assert.ok(rows.length >= 4);
  for (const r of rows) {
    assert.ok(Object.keys(r.raw).every((k) => RAW_FIELDS_READ.includes(k)), `only read fields: ${Object.keys(r.raw)}`);
    assert.equal(r.raw.classifications[0].goods_services_text, signaRow(0).raw.classifications[0].goods_services_text);
  }
  assert.deepEqual(band.enumerated.find((r) => r.record_id.endsWith("0000002"))._qids,
    ["primary-sweep:exact:velmora", "incumbent-class:owner"], "the stamp union is unchanged");
});

test("a band of the measured make-up is refused at dispatch whole, and passes once it carries only what is read", () => {
  // 3,224 records, sized so the band as merged before this change is at least the measured 41,089,294 bytes. The
  // goods text is about a third of each row, as measured; the rest of the raw row is the fields nothing reads.
  const goods = "Coffee, tea, cocoa and artificial coffee; rice, pasta and noodles; tapioca and sago; flour and preparations made from cereals; ".repeat(33);
  const rows = Array.from({ length: 3224 }, (_, i) => signaRow(i, { goods, filler: 420 }));
  const whole = { enumerated: rows.map((r) => ({ ...r, _qids: [r._qid], _queries: [r._query] })), crowds: [] };
  const handed = mergeNamedBands([{ enumerated: rows, crowds: [] }]);
  const before = bytesOf(whole), after = bytesOf(handed);
  assert.ok(before >= 41_089_294, `the invented band is the measured size or more: ${before}`);
  const placementBefore = derivedLimitSec(baseOf("placement-inquiry"), { bytes: before });
  assert.equal(limitExceedsCeiling(placementBefore.sec), true, `whole, placement derives ${placementBefore.sec}s, past ${LIMIT_CEILING_SEC}s`);
  assert.ok(stagesRefusingBand(before, baseOf).includes("placement-inquiry"));
  const placementAfter = derivedLimitSec(baseOf("placement-inquiry"), { bytes: after });
  assert.equal(limitExceedsCeiling(placementAfter.sec), false, `kept to what is read, placement derives ${placementAfter.sec}s`);
  assert.deepEqual(stagesRefusingBand(after, baseOf), [], "no band-reading stage refuses it");
  assert.equal(handed.enumerated[0].raw.classifications[0].goods_services_text, goods, "the class statements are whole");
  // The measured band itself, by its two sizes: refused whole, passing kept.
  assert.equal(limitExceedsCeiling(derivedLimitSec(baseOf("placement-inquiry"), { bytes: 41_089_294 }).sec), true);
  assert.deepEqual(stagesRefusingBand(25_677_439, baseOf), []);
});

// ── the band tools serve the same answers from the whole band and the kept band ─────────────────────────────────────
async function mcpSession(runDir, requests) {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(HERE, "..", "engine", "mcp", "band-server.mjs")], { stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, CLEAROTRON_BAND_RUN_DIR: runDir, CLEAROTRON_GATHER_SESSION_KEY: "clearotron-x-y-placement-inquiry", CLEAROTRON_GATHER_AGENT: "mailagent" } });
    child.stdout.setEncoding("utf8");
    const responses = {}; let buf = "";
    const want = new Set(requests.filter((r) => r.id != null).map((r) => r.id));
    const done = () => { try { child.kill("SIGKILL"); } catch { /* gone */ } resolve(responses); };
    const timer = setTimeout(done, 15000);
    child.stdout.on("data", (d) => {
      buf += d; let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
        if (!line) continue;
        try { const m = JSON.parse(line); if (m.id != null) { responses[m.id] = m; want.delete(m.id); } } catch { /* not a message */ }
      }
      if (want.size === 0) { clearTimeout(timer); done(); }
    });
    child.on("error", reject);
    for (const r of requests) child.stdin.write(JSON.stringify(r) + "\n");
  });
}

function seed(band) {
  const runDir = mkdtempSync(join(tmpdir(), "band-kept-"));
  mkdirSync(driverDir(runDir), { recursive: true });
  writeFileSync(join(runDir, "register-named-band.json"), JSON.stringify(band, null, 2) + "\n");
  const { shape, md } = buildBandShape(band, { targets: ["VELMORA"], inScopeClasses: ["30"] });
  writeFileSync(driverDir(runDir, "band-shape.json"), JSON.stringify(shape, null, 2));
  writeFileSync(join(runDir, "band-shape.md"), md);
  return { runDir, shape };
}

test("the band tools serve the same records and goods, and the band shape is the same, from the whole and the kept band", async () => {
  const rows = [signaRow(1), signaRow(2, { goods: "Restaurant services; cafe services; catering." }), signaRow(3)];
  rows[2].raw.classifications.push({ nice_class: 43, goods_services_text: "Provision of food and drink.", goods_services_text_truncated: true, goods_services_language: "en", scope: null });
  const whole = { enumerated: rows.map((r) => ({ ...r, _qids: [r._qid], _queries: [r._query] })), crowds: [] };
  const kept = mergeNamedBands([{ enumerated: rows, crowds: [] }]);
  assert.ok(bytesOf(kept) < bytesOf(whole));
  const a = seed(whole), b = seed(kept);
  try {
    assert.deepEqual(b.shape, a.shape, "the band shape is the same");
    const INIT = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } };
    const call = (id, name, args = {}) => ({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });
    const requests = [INIT, call(2, "band_lookup", { limit: 50 }), call(3, "band_lookup", { goods: ["coffee"] }),
      call(4, "band_lookup", { record_id: rows[2].record_id }), call(5, "band_shape", { format: "json" })];
    const [ra, rb] = [await mcpSession(a.runDir, requests), await mcpSession(b.runDir, requests)];
    const text = (r, id, dir) => String(r[id]?.result?.content?.[0]?.text ?? "").split(dir).join("<run>");
    for (const id of [2, 3, 4, 5]) {
      assert.ok(text(ra, id, a.runDir).length > 0, `tool call ${id} answered`);
      assert.equal(text(rb, id, b.runDir), text(ra, id, a.runDir), `tool call ${id} serves the same answer`);
    }
    // The goods are still read from the kept rows: the cut flag on one statement, and a goods filter over the statements.
    assert.match(text(rb, 4, b.runDir), /"goods_from": "search answer, cut by the register"/, "the row's statements, cut flag and all, are read");
    assert.match(text(rb, 3, b.runDir), /"matched": [1-9]/, "a goods filter finds rows by their class statements");
  } finally {
    rmSync(a.runDir, { recursive: true, force: true });
    rmSync(b.runDir, { recursive: true, force: true });
  }
});
