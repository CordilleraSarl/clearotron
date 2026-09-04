// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// engagement-receipt.mjs — R.1 shared reasoning-integrity primitive #3. (Design document retired with
// the subsystem, deleted with the name.) For each Composite≥3 finding in narrative.md, record — as a
// PRESENCE RECEIPT (necessary-not-sufficient, NOT a semantic regex) — whether its reasoning cites ANY
// of its own field anchors (the searched mark's dominant element, a searched class, the owner, the
// sector/jurisdiction). The receipt is written to _driver/reasoning-integrity.json and surfaces as a
// loud banner on the delivered report, read before curation.
//
// GOODHART GUARD (§0(a), §6): this is OBSERVABILITY, never a pass/fail a retry can satisfy. It must NOT
// route through verify.mjs fail() → corrective-retry — once a lexical proxy defines pass/fail the model
// optimises toward sprinkling anchor tokens into boilerplate without genuine engagement. The pipeline
// writes the sidecar and moves on; nothing gates on it.
//
// Same enforcement substrate and block-scan shape as use-check.mjs / own-rights.mjs: PURE over the
// narrative text (no node imports, tests offline); empty/missing input → no receipts, never throws.

const STOP = new Set([
  "the", "and", "for", "inc", "llc", "ltd", "gmbh", "corp", "co", "sa", "ag", "plc", "of",
  "worldwide", "global", "mark", "marks", "your", "n/a", "none", "class", "classes",
]);

// Composite digit from a finding block — same anchor as use-check.mjs.
function parseComposite(block) {
  const m = block.match(/\bComposite\b[^\d\n]{0,14}(\d)/i);
  return m ? Number(m[1]) : null;
}
// A block is a rated FINDING if its heading names a Finding or its body carries the BOLD Composite
// marker — same gate as use-check.mjs, so the "## Actions" / "## Bottom line" paraphrases (which mention
// composite in prose but not as the rated finding) never false-trigger.
// EXPORTED so the write-up check identifies blocks by the same predicate this file already uses.
// Two answers to "which blocks in narrative.md are per-finding write-ups" would drift, and the one that
// drifted would decide whether a run gets sent back for a rewrite.
export function isFinding(heading, block) {
  return /\bfinding\b/i.test(heading) || /\*\*\s*composite\b/i.test(block);
}

// Distinctive word anchors (length ≥4, non-stopword) from the owner / element / goods / sector /
// jurisdiction / mark vocabulary; multi-word anchors contribute their significant words (so a finding
// mentioning "Plesner" anchors against owner "Plesner Advokatpartnerselskab").
function anchorTerms(anchors = {}) {
  const raw = [
    ...(anchors.owners ?? []), ...(anchors.dominantElements ?? []), ...(anchors.goodsServices ?? []),
    ...(anchors.jurisdictions ?? []), ...(anchors.marks ?? []), ...(anchors.sector ? [anchors.sector] : []),
  ];
  const terms = new Set();
  for (const t of raw)
    for (const w of String(t).toLowerCase().split(/[^a-z0-9]+/))
      if (w.length >= 4 && !STOP.has(w)) terms.add(w);
  return [...terms];
}
// Bare class numbers (e.g. "09" → 9) for a "class N" mention test.
function classNumbers(anchors = {}) {
  const nums = new Set();
  for (const c of anchors.classes ?? []) { const m = String(c).match(/\b(\d{1,2})\b/); if (m) nums.add(String(Number(m[1]))); }
  return [...nums];
}
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Build the per-finding engagement receipts. Pure: empty/missing input → [], never throws.
 *
 * @param {string} narrativeMd  the narrative.md text
 * @param {object} anchors      the {owners, classes, goodsServices, sector, jurisdictions, dominantElements, marks}
 *                              shape from anchor-reader.readAnchors
 * @returns {Array<{finding:string, composite:number|null, citesOwnAnchor:boolean, anchorsHit:string[]}>}
 */
export function findEngagementReceipts(narrativeMd, anchors = {}) {
  const lines = (narrativeMd || "").split("\n");
  const blocks = [];
  let cur = null;
  for (const ln of lines) {
    const h = ln.match(/^(#{2,4})\s+(.*)/);
    if (h) { if (cur) blocks.push(cur); cur = { heading: h[2].trim(), body: [] }; }
    else if (cur) cur.body.push(ln);
  }
  if (cur) blocks.push(cur);

  const terms = anchorTerms(anchors);
  const wordRe = terms.length ? new RegExp(`\\b(${terms.map(esc).join("|")})\\b`, "i") : null;
  const classRe = classNumbers(anchors).length
    ? new RegExp(`\\bclass(?:es)?\\.?\\s*0*(?:${classNumbers(anchors).join("|")})\\b`, "i") : null;

  const receipts = [];
  for (const b of blocks) {
    const block = `${b.heading}\n${b.body.join("\n")}`;
    if (!isFinding(b.heading, block)) continue;
    const composite = parseComposite(block);
    const triggers = composite === null ? true : composite >= 3;   // floor-safe on an unparseable Composite
    if (!triggers) continue;
    const hit = new Set();
    if (wordRe) { let m; const g = new RegExp(wordRe.source, "ig"); while ((m = g.exec(block))) hit.add(m[1].toLowerCase()); }
    if (classRe && classRe.test(block)) hit.add("class-mention");
    receipts.push({ finding: b.heading, composite, citesOwnAnchor: hit.size > 0, anchorsHit: [...hit] });
  }
  return receipts;
}
