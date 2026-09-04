// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// anchor-reader.mjs — R.1 shared reasoning-integrity primitive #2. (Its design document named a
// subsystem retired in and was deleted with the name; the instrument itself is live and
// self-describing from here down.) ONE place that reads a run's field-anchoring vocabulary — the
// owners/classes/goods of the register findings, the sector/jurisdictions of the matter, and the mark's
// dominant elements — so the engagement-receipt detector (#3) can ask, per finding, "does the reasoning
// cite any of its own anchors?" without each consumer re-implementing the scrape.
//
// PURE (no node imports, tests offline) and TOLERANT: empty/garbled input yields empty fields, never
// throws — a malformed manifest must degrade the observability sidecar to empty, never crash synthesis.
//
// The markdown-table scanner is a small local copy of publish/audit-from-spine.mjs's parseTables (the
// house pattern — coverage-ledger.mjs likewise re-implements its own scan rather than couple two
// modules over a 20-line helper). G&S note: register-findings.md carries Classes but NO goods/services
// column (digest.md table header), so the G&S anchor is derived from the searched Classes + the
// manifest's Product-description / Industry line — documented, not faked.

const splitRow = (line) => line.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((s) => s.trim());
const isSep = (line) => /^\s*\|[\s:|-]+\|\s*$/.test(line || "");

// [{ heading, columns:[...], rows:[{col:val}] }] for every markdown table, tagged with its nearest heading.
function parseTables(md) {
  const lines = (md || "").split("\n");
  const tables = [];
  let heading = "";
  for (let i = 0; i < lines.length; i++) {
    const h = lines[i].match(/^#{2,4}\s+(.*)/);
    if (h) { heading = h[1].trim(); continue; }
    if (lines[i].trimStart().startsWith("|") && isSep(lines[i + 1])) {
      const columns = splitRow(lines[i]);
      const rows = [];
      let j = i + 2;
      for (; j < lines.length && lines[j].trimStart().startsWith("|") && !isSep(lines[j]); j++) {
        const cells = splitRow(lines[j]);
        if (cells.every((c) => !c)) continue;
        rows.push(Object.fromEntries(columns.map((c, k) => [c, cells[k] ?? ""])));
      }
      tables.push({ heading, columns, rows });
      i = j - 1;
    }
  }
  return tables;
}

// Value after a `- **Key:** value` request bullet (the variant-manifest / matter-context shape), tolerant
// of bold/spacing. Returns "" when absent.
function bulletVal(md, keyRe) {
  for (const ln of (md || "").split("\n")) {
    const m = ln.match(/^\s*[-*]\s*\*{0,2}\s*([^:*]+?)\s*\*{0,2}\s*:\s*\*{0,2}\s*(.+?)\s*$/);
    if (m && keyRe.test(m[1])) return m[2].replace(/\*+/g, "").trim();
  }
  return "";
}

// Split a free-text list on commas / slashes / semicolons / " and ", drop empties + parentheticals noise.
function splitList(s) {
  return String(s || "")
    .split(/[,;/]|\band\b/i)
    .map((x) => x.replace(/\(.*?\)/g, "").trim())
    .filter(Boolean);
}

const dedupe = (arr) => [...new Set(arr.filter(Boolean))];
const lower = (arr) => dedupe(arr.map((x) => String(x).toLowerCase().trim()));

// Column lookup tolerant of header variants.
const col = (row, ...names) => { for (const n of names) if (row[n] != null && row[n] !== "") return row[n]; return ""; };

/**
 * Read the run's anchors from the three source files. Every field is best-effort and degrades to empty.
 *
 * @param {{registerFindingsMd?:string, matterContextMd?:string, variantManifestMd?:string}} sources
 * @returns {{owners:string[], classes:string[], goodsServices:string[], sector:string,
 *            jurisdictions:string[], dominantElements:string[], marks:string[]}}
 */
export function readAnchors({ registerFindingsMd = "", matterContextMd = "", variantManifestMd = "" } = {}) {
  const reg = parseTables(registerFindingsMd);
  const man = parseTables(variantManifestMd);

  // owners from the register findings tables (the rows the lawyer reads).
  const owners = lower(reg.flatMap((t) => t.rows.map((r) => col(r, "Owner"))));
  // classes from the register tables AND the manifest / matter request bullet (the searched scope);
  // normalised so "09" / "9" / "class 9" all anchor the same finding.
  const classesFromBullets = splitList(bulletVal(variantManifestMd, /class/i) || bulletVal(matterContextMd, /class/i));
  const classes = dedupe([...regClasses(reg), ...classesFromBullets].flatMap(normClass).map((s) => s.toLowerCase()));

  // sector / industry + jurisdictions — from the request bullets first, then a tolerant matter-context scan.
  const sector = (bulletVal(variantManifestMd, /industr|sector/i) || bulletVal(matterContextMd, /industr|sector/i)
    || scanLine(matterContextMd, /\b(sector|industry)\b/i)).toLowerCase();
  const jurisdictions = lower(splitList(
    bulletVal(variantManifestMd, /jurisdic/i) || bulletVal(matterContextMd, /jurisdic|materially[- ]matters/i)
    || scanLine(matterContextMd, /jurisdic|materially[- ]matters/i)));

  // G&S anchor: there is no G&S column — derive from the product-description / manner-of-use prose + the
  // searched classes (so a finding "cites its goods" if it names the product context or a class).
  const productDesc = bulletVal(variantManifestMd, /product desc|goods|manner of use|description/i)
    || bulletVal(matterContextMd, /product desc|goods|description/i);
  const goodsServices = lower([...splitList(productDesc), ...(sector ? [sector] : []), ...classes]);

  // dominant elements: distinctive (non function-word) Element rows + the exact-phrase/exact-element
  // variant values + the searched mark(s).
  const marks = dedupe(splitList(bulletVal(variantManifestMd, /^marks?$/i) || bulletVal(matterContextMd, /^marks?$/i)));
  const elementTokens = man.flatMap((t) =>
    t.columns.some((c) => /element/i.test(c))
      ? t.rows.filter((r) => !/function[- ]word|^n\/a$/i.test(col(r, "Role"))).map((r) => col(r, "Element"))
      : []);
  const variantTokens = man.flatMap((t) =>
    t.rows.filter((r) => /exact-(phrase|element)/i.test(col(r, "Category", "Type"))).map((r) => col(r, "Value", "Variant")));
  const dominantElements = lower([...elementTokens, ...variantTokens, ...marks]);

  return { owners, classes, goodsServices, sector, jurisdictions, dominantElements, marks: lower(marks) };
}

// ---- small helpers -------------------------------------------------------------------------------
// (kept tiny + pure; the goal is tolerance, not perfect coverage)
function regClasses(tables) {
  return tables.flatMap((t) => t.rows.flatMap((r) => splitList(col(r, "Classes", "Class"))));
}
function normClass(tok) {
  const t = String(tok).trim();
  const n = t.match(/\b(\d{1,2})\b/);
  // keep the raw token AND a bare class number (and its no-leading-zero form) so "09"/"9"/"class 9" all anchor.
  return n ? dedupe([t, n[1], String(Number(n[1]))]) : [t];
}
function scanLine(md, re) {
  for (const ln of (md || "").split("\n")) if (re.test(ln)) return ln.replace(/^[#>\-*\s]+/, "").replace(/\*+/g, "").trim();
  return "";
}
