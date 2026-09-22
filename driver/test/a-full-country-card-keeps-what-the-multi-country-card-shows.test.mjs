// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A FULL COUNTRY REPORT SHOWS EVERY PART OF A FINDING THAT A MULTI-COUNTRY REPORT SHOWS.
//
// The full country search is the deeper product. For a finding it adds two blocks to the Full detail
// fold, the goods as registered and the record's dates, and it must drop nothing the multi-country report
// shows for the same finding. The renderer tells the two apart by one flag, read from the run's frozen
// search policy. A later change that gates any part of a finding on that flag the wrong way round takes a
// fact off the deeper report, and the frozen-render hash cannot say so: a hash proves a report did not
// change, not that two reports agree about a finding.
//
// TWO POPULATIONS, BECAUSE A FINDING REACHES THE PAGE IN FOUR SHAPES:
//
//   1. The committed demo runs, each published twice through the ordinary republish path: once under the
//      multi-country focus policy and once under the full country policy, the one input that differs.
//      They carry real fetched records, so the full country blocks actually render. They reach the
//      on-field card and the ruled-out card.
//   2. An invented record rendered directly, for the two shapes no demo run carries: the compact card
//      and the grouped negative, each with its own Full detail fold.
//
// For each finding, every text, class and link the multi-country report shows must be on the full
// country report for the same finding, counted, so a line shown twice must be there twice. The reverse
// is not asserted; the full country report is meant to show more.
//
// THE COMPARISON MUST BE BETWEEN TWO DIFFERENT REPORTS. If the flag stopped being read, both renders
// would be the same document and every finding would pass. So each population also asserts that the full
// country render shows its own blocks and the multi-country render does not.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, cpSync, readFileSync, writeFileSync, readdirSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pinEnv, envFrom } from "../../shared/env-aliases.mjs";

// Pin the deployment config BEFORE the publish import: driver.config reads the environment at module
// load, and its pool-root default is the real archive.
const ROOT = mkdtempSync(join(tmpdir(), "full-keeps-multi-"));
after(() => rmSync(ROOT, { recursive: true, force: true }));
pinEnv(process.env, "CLEAROTRON_WORK_DIR", envFrom(process.env, "CLEAROTRON_WORK_DIR") || join(ROOT, "ws"));
pinEnv(process.env, "CLEAROTRON_REPORTS_DIR", join(ROOT, "pool-default"));
pinEnv(process.env, "CLEAROTRON_REPORTS_URL", envFrom(process.env, "CLEAROTRON_REPORTS_URL") || "https://trademark.test");

const { republishRun } = await import("../publish/report-registry.mjs");
const { renderHtml } = await import("../publish/render.mjs");
const { parseReport } = await import("../publish/parse.mjs");
const { productCoverageNote } = await import("../search-policy.mjs");
const { readRecordArtifacts, REC } = await import("../registry-fidelity.mjs");

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DEMO = join(REPO, "demo");
const MULTI = "multi-country-focus-search";
const FULL = "full-country-search";

// ── reading a finding off the page ───────────────────────────────────────────────────────────────────

// Every block that shows one finding, keyed so the same finding is found on the other report. A card
// carries its ordinal as its id; a ruled-out card carries it as its number; a grouped negative carries
// neither and is keyed by its mark, with a counter for a mark that appears twice.
const OPENER = /<div class="card" id="c(\d+)">|<div class="card compact" id="c(\d+)">|<div class="card ruled">|<details class="rgroup rn">/g;

function blockAt(html, start, tag) {
  const re = new RegExp(`<${tag}\\b|</${tag}>`, "g");
  re.lastIndex = start;
  let depth = 0, m;
  while ((m = re.exec(html))) {
    depth += m[0].startsWith("</") ? -1 : 1;
    if (depth === 0) return html.slice(start, m.index + m[0].length);
  }
  throw new Error(`an unclosed <${tag}> at ${start}; the page cannot be read`);
}

function findingBlocks(html) {
  const out = new Map();
  const seen = new Map();
  const once = (k) => { const n = (seen.get(k) ?? 0) + 1; seen.set(k, n); return n === 1 ? k : `${k} #${n}`; };
  for (const m of html.matchAll(OPENER)) {
    if (m[1] || m[2]) {
      out.set(`${m[1] ? "card" : "compact"} c${m[1] ?? m[2]}`, blockAt(html, m.index, "div"));
    } else if (m[0].startsWith("<div")) {
      const block = blockAt(html, m.index, "div");
      const num = /<span class="fnum">([^<]*)<\/span>/.exec(block)?.[1];
      const mark = /<span class="who mark-first">([^<]*)<\/span>/.exec(block)?.[1] ?? "";
      out.set(once(`ruled ${num ?? mark}`), block);
    } else {
      const block = blockAt(html, m.index, "details");
      const mark = /<span class="rn-mark">([^<]*)<\/span>/.exec(block)?.[1] ?? "";
      out.set(once(`negative ${mark}`), block);
    }
  }
  return out;
}

// What a block shows: each piece of text, each element's class, each link.
function shown(block) {
  const items = [];
  for (const m of block.matchAll(/<([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g)) {
    const cls = /\bclass="([^"]*)"/.exec(m[2]);
    if (cls) items.push(`element ${m[1].toLowerCase()}.${cls[1]}`);
    const href = /\bhref="([^"]*)"/.exec(m[2]);
    if (href) items.push(`link ${href[1]}`);
  }
  for (const piece of block.replace(/<[^>]*>/g, "\u0000").split("\u0000")) {
    const t = piece.replace(/\s+/g, " ").trim();
    if (t) items.push(`text ${t}`);
  }
  return items;
}

// What `a` shows that `b` does not, counted.
function missingFrom(a, b) {
  const left = new Map();
  for (const x of b) left.set(x, (left.get(x) ?? 0) + 1);
  const missing = [];
  for (const x of a) {
    const n = left.get(x) ?? 0;
    if (n) left.set(x, n - 1); else missing.push(x);
  }
  return missing;
}

function assertFullKeepsMulti(multiHtml, fullHtml, label) {
  const multi = findingBlocks(multiHtml), full = findingBlocks(fullHtml);
  for (const [key, block] of multi) {
    assert.ok(full.has(key), `${label}: ${key} is on the multi-country report and nowhere on the full country report`);
    const missing = missingFrom(shown(block), shown(full.get(key)));
    assert.deepEqual(missing, [],
      `${label}: ${key} shows ${missing.length} thing(s) on the multi-country report that the full country report drops`);
  }
  return { multi, full };
}

const FULL_ONLY = ["text As registered", "text Dates"];
const countOf = (blocks, item) => [...blocks.values()].reduce((n, b) => n + shown(b).filter((x) => x === item).length, 0);

// ── 1. the committed demo runs, through the ordinary publisher ──────────────────────────────────────

const policyOf = (product) => readFileSync(join(DEMO, product, "run", "_driver", "search-policy.json"), "utf8");

// Every committed clearance demo, found rather than listed, so a demo added later is compared too.
const CLEARANCE_DEMOS = readdirSync(DEMO, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(DEMO, d.name, "run", "report.md")))
  .map((d) => d.name)
  .sort();

async function publishAs(demo, product) {
  const runDir = join(ROOT, `${demo}--as--${product}`);
  cpSync(join(DEMO, demo, "run"), runDir, { recursive: true });
  writeFileSync(join(runDir, "_driver", "search-policy.json"), policyOf(product));
  const pool = join(ROOT, `pool--${demo}--as--${product}`);
  const runId = `compare-${demo}`;
  const out = await republishRun({ runId, meta: { codename: "compare", template: "clearance" },
    pool, poolUrl: "https://trademark.test", runDir, skipRegen: true });
  return readFileSync(join(out.poolRunDir, "report.html"), "utf8");
}

test("on every committed demo run, the full country report keeps every part of each finding", async () => {
  assert.ok(CLEARANCE_DEMOS.length >= 3,
    `found ${CLEARANCE_DEMOS.length} clearance demo run(s) under demo/; the comparison needs the three products' runs`);
  assert.ok(CLEARANCE_DEMOS.includes(MULTI) && CLEARANCE_DEMOS.includes(FULL),
    "the two policies this compares are read from the multi-country and full country demo runs, and one is missing");

  const shapes = new Map();
  let fullOnlyOnFull = 0, fullOnlyOnMulti = 0;
  for (const demo of CLEARANCE_DEMOS) {
    const { multi, full } = assertFullKeepsMulti(await publishAs(demo, MULTI), await publishAs(demo, FULL), demo);
    for (const key of multi.keys()) { const s = key.split(" ")[0]; shapes.set(s, (shapes.get(s) ?? 0) + 1); }
    for (const item of FULL_ONLY) { fullOnlyOnFull += countOf(full, item); fullOnlyOnMulti += countOf(multi, item); }
  }

  // A floor on what was compared: a page whose cards stopped matching the opener would otherwise pass.
  assert.ok((shapes.get("card") ?? 0) >= 10, `only ${shapes.get("card") ?? 0} on-field card(s) compared across the demo runs`);
  assert.ok((shapes.get("ruled") ?? 0) >= 3, `only ${shapes.get("ruled") ?? 0} ruled-out card(s) compared across the demo runs`);
  assert.ok(fullOnlyOnFull > 0, "the full country render shows neither 'As registered' nor 'Dates', so the two renders were one report");
  assert.equal(fullOnlyOnMulti, 0, "the multi-country render shows a full country block, so the two renders were one report");
});

// ── 2. the shapes no demo run carries ────────────────────────────────────────────────────────────────

// Invented findings. The records are the full country demo's own, so the Full detail fold has real goods
// and dates to show, and only records the renderer would draw both blocks from are used.
const RECORDS = readRecordArtifacts(join(DEMO, FULL, "run"));
const [URI_A, URI_B, URI_C] = [...RECORDS].filter(([, r]) => REC.goods(r) && REC.dates(r)).map(([uri]) => uri);

const REPORT_MD = [
  "---", "type: clearance-clearance", "matter: invented-matter", "title: THIS IS MY MATCHDAY",
  "overall_label: MEDIUM", "overall_badge: l3", "overall_caption: medium overall.",
  "classes: 9 · 41", "jurisdiction: Japan", "run: 2026-09-18", "---", "",
  "# Marks", "## Matchday, Inc.", "- one: The dominant MATCHDAY holder in the filed class.",
].join("\n");

const meter = (token, basis = "verified-from-record") => ({ token, basis });
const METERS = { mark_similarity: meter("high"), goods_proximity: meter("medium"), use: meter("confirmed"), enforcer: meter("low", "inferred-from-signal") };
const reg = (uri, cls) => ({ registrations: [{ uri, classes: [cls], jurisdiction: "JP" }] });
const FINDINGS = [
  { ordinal: 1, mark: "MATCHDAY", disposition: "adversarial", band: "High",
    legal_position: "Near-identical mark over overlapping software goods.",
    practical_position: "The owner files widely in the class.",
    owner: { name: "Matchday, Inc.", country: "JP", ...reg(URI_A, "9") },
    meters: METERS, quadrant: { x: 0.7, y: 0.6 }, source: { source_type: "register-vendor" } },
  { ordinal: 2, mark: "MATCH DAY", disposition: "distinguished", band: "Manageable",
    net: "Argued apart on the mark: the added word changes the whole.",
    legal_position: "The shared element is weak in the class and the added word dominates.",
    practical_position: "No enforcement on record.",
    manageable: { category: "large-competitor", reason: "a live competitor, but the added word carries it apart" },
    owner: { name: "Match Day KK", country: "JP", ...reg(URI_B, "41") },
    meters: METERS, quadrant: { x: 0.5, y: 0.3 }, source: { source_type: "register-vendor" } },
  { ordinal: 3, mark: "MATCHDAY MOTORS", disposition: "off-field", off_field_ground: "different-field",
    net: "Vehicle servicing; the specification stops short of any software or training service.",
    legal_position: "The registration covers vehicle maintenance only.",
    practical_position: "A regional garage chain.",
    owner: { name: "Matchday Motors KK", country: "JP", ...reg(URI_C, "12") },
    meters: METERS, quadrant: { x: 0.8, y: 0.1 }, source: { source_type: "register-vendor" } },
];

function parsed() {
  const dir = mkdtempSync(join(ROOT, "report-md-"));
  writeFileSync(join(dir, "report.md"), REPORT_MD);
  return parseReport(join(dir, "report.md"));
}
const render = (product, extra) => renderHtml(parsed(), FINDINGS, [], {
  runId: "invented-matter", depthNote: productCoverageNote(product), recordsByUri: RECORDS, ...extra });

test("the compact card and the grouped negative keep every part of a finding on the full country report", () => {
  assert.ok(URI_A && URI_B && URI_C,
    "the full country demo run no longer holds three records with goods and dates, so this fixture has nothing to show");

  for (const [label, extra, shape] of [
    ["compact cards", {}, "compact"],
    ["grouped negatives", { findingsSchemaVersion: 6 }, "negative"],
  ]) {
    const { multi, full } = assertFullKeepsMulti(render(MULTI, extra), render(FULL, extra), label);
    const ofShape = (blocks) => new Map([...blocks].filter(([k]) => k.startsWith(`${shape} `)));
    assert.ok(ofShape(multi).size >= 1, `${label}: the invented findings rendered no ${shape} block, so nothing of this shape was compared`);
    const fullOnly = FULL_ONLY.reduce((n, item) => n + countOf(ofShape(full), item), 0);
    assert.ok(fullOnly > 0, `${label}: the full country render shows neither full country block on a ${shape} block, so the two renders were one report`);
    assert.equal(FULL_ONLY.reduce((n, item) => n + countOf(ofShape(multi), item), 0), 0,
      `${label}: the multi-country render shows a full country block`);
  }
});
