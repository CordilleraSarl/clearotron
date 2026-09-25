// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// framework-method.mjs — a framework's stated METHOD: the inputs it rates through, and its table from
// those inputs to a band.
//
// A framework is its prose deck plus the vocabulary manifest beside it (framework.mjs). Most frameworks
// rate by reasoning through their band definitions, and the manifest's words are all the engine needs.
// Some state a method on top: a rating is read off a table from named inputs, and the table's ceilings
// are hard. Such a framework used to reach a report as its band words alone — the inputs were reasoned
// in the model's head, if at all, and nothing checked the band against the table.
//
// A framework that states a method declares it in a third file beside the deck,
// `<framework>.method.json`, in the customer's own configuration: its inputs, in its own labels and
// values, and its table. The engine then asks every rated conflict for the inputs, refuses a band the
// table does not give for them, and shows the inputs beside the band. A framework with no method file
// rates exactly as before. The manifest keeps its rule — vocabulary and order only — and today's
// manifest parser refuses a key it does not know, so the method can never ride inside it.
//
// The method is frozen into the run at attach time (`_driver/framework-method.json`) beside the frozen
// manifest, under the same doctrine: minted once, read verbatim on resume, corrupt is loud. A run frozen
// without one — any run from before this file existed — has no method and is judged as it always was.
//
// PURE apart from the two small file helpers at the bottom.

import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { normalizeBand } from "./framework.mjs";

export const METHOD_SCHEMA_VERSION = 1;
/** The frozen copy's name inside a run's `_driver/` directory. */
export const FROZEN_METHOD_FILE = "framework-method.json";

/** skills/clearance-search/risk-framework-x.md → skills/clearance-search/risk-framework-x.method.json.
 *  Derived like the manifest's path: the profile names only the deck. */
export const methodPathFor = (fwPath) => String(fwPath).replace(/\.md$/, ".method.json");

// ── shape ─────────────────────────────────────────────────────────────────────────────────────────────
// {
//   "schema_version": 1,
//   "framework_key":  "<the manifest's framework_key>",
//   "inputs": [                                          // reasoned in this order
//     { "label": "<the framework's own name for it>", "values": ["…", "…"],
//       "ordered": true,        // optional — the values run from one end of a scale to the other, so a
//                               //   finding may sit between the bands of two neighbouring values
//       "show_label": true }    // optional, default true — "<label> <value>" on the page, else "<value>"
//   ],
//   "table": [                                           // every combination of values meets EXACTLY one row
//     { "band": "<a band word from the manifest>", "when": { "<label>": ["<value>", …] } }
//   ]                                                    // a label a row does not name matches every value
// }
const METHOD_KEYS = ["schema_version", "framework_key", "inputs", "table"];
const INPUT_KEYS = ["label", "values", "ordered", "show_label"];
const ROW_KEYS = ["band", "when"];
const MAX_INPUTS = 4;
const MAX_VALUES = 12;
const LABEL_RE = /^[A-Za-z][A-Za-z '’/-]*$/;

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const short = (v) => { const s = typeof v === "string" ? v : JSON.stringify(v); return s == null ? String(v) : (s.length > 40 ? s.slice(0, 40) + "…" : s); };
const norm = (s) => String(s ?? "").trim().replace(/\s+/g, " ").toLowerCase();
const onlyKeys = (obj, allowed, token) => { for (const k of Object.keys(obj)) if (!allowed.includes(k)) throw new Error(token(k)); };

function* combinations(inputs, i = 0, acc = []) {
  if (i === inputs.length) { yield acc; return; }
  for (const v of inputs[i].values) yield* combinations(inputs, i + 1, [...acc, v]);
}

/**
 * Parse and validate a method against the framework's manifest. Throws token-first (framework_method_*),
 * like parseFrameworkManifest. The table must be complete and unambiguous: every combination of input
 * values meets exactly one row, so the band the table gives is always one word.
 */
export function parseFrameworkMethod(raw, manifest) {
  let m;
  try { m = typeof raw === "string" ? JSON.parse(raw) : raw; }
  catch (e) { throw new Error(`framework_method_unparseable: ${short(e.message)}`); }
  if (!isPlainObject(m)) throw new Error("framework_method_unparseable: top level must be a JSON OBJECT");
  onlyKeys(m, METHOD_KEYS, (k) => `framework_method_key_unknown:${short(k)}`);
  if (m.schema_version !== METHOD_SCHEMA_VERSION) throw new Error(`framework_method_version_invalid:${short(m.schema_version)} (schema_version must be ${METHOD_SCHEMA_VERSION})`);
  if (!manifest || m.framework_key !== manifest.framework_key)
    throw new Error(`framework_method_key_mismatch:${short(m.framework_key)} (a method belongs to the framework whose manifest names the same framework_key${manifest ? `, "${manifest.framework_key}"` : ""})`);

  if (!Array.isArray(m.inputs) || m.inputs.length < 1 || m.inputs.length > MAX_INPUTS)
    throw new Error(`framework_method_inputs_invalid (1-${MAX_INPUTS} inputs, in the order the framework reasons them)`);
  const labels = new Set();
  const inputs = m.inputs.map((inp) => {
    if (!isPlainObject(inp)) throw new Error(`framework_method_input_invalid:${short(inp)} (each input is { label, values })`);
    onlyKeys(inp, INPUT_KEYS, (k) => `framework_method_input_key_unknown:${short(k)}`);
    const label = typeof inp.label === "string" ? inp.label.trim().replace(/\s+/g, " ") : "";
    if (!label || label.length > 40 || !LABEL_RE.test(label))
      throw new Error(`framework_method_input_label_invalid:${short(inp.label)} (the framework's own name for the input — letters, spaces, apostrophes, slashes and hyphens)`);
    if (labels.has(norm(label))) throw new Error(`framework_method_input_label_duplicate:${short(label)}`);
    labels.add(norm(label));
    if (!Array.isArray(inp.values) || inp.values.length < 2 || inp.values.length > MAX_VALUES)
      throw new Error(`framework_method_input_values_invalid:${short(label)} (2-${MAX_VALUES} values, as the framework writes them)`);
    const seen = new Set();
    const values = inp.values.map((v) => {
      const s = typeof v === "string" ? v.trim().replace(/\s+/g, " ") : "";
      if (!s || s.length > 40) throw new Error(`framework_method_input_value_invalid:${short(v)} (a non-empty word or phrase of at most 40 characters)`);
      if (seen.has(norm(s))) throw new Error(`framework_method_input_value_duplicate:${short(s)}`);
      seen.add(norm(s));
      return s;
    });
    for (const k of ["ordered", "show_label"]) if (inp[k] !== undefined && typeof inp[k] !== "boolean")
      throw new Error(`framework_method_input_${k}_invalid:${short(label)} (${k} is true or false)`);
    return { label, values, ordered: inp.ordered === true, show_label: inp.show_label !== false };
  });

  if (!Array.isArray(m.table) || !m.table.length) throw new Error("framework_method_table_missing (a method without a table rates nothing)");
  const byLabel = new Map(inputs.map((i) => [norm(i.label), i]));
  const table = m.table.map((row, r) => {
    if (!isPlainObject(row)) throw new Error(`framework_method_row_invalid:${r + 1} (each row is { band, when })`);
    onlyKeys(row, ROW_KEYS, (k) => `framework_method_row_key_unknown:${short(k)}`);
    const band = normalizeBand(manifest, row.band);
    if (!band) throw new Error(`framework_method_row_band_invalid:${short(row.band)} (row ${r + 1}: the band must be one of the manifest's words: ${manifest.bands.map((b) => b.label).join(" / ")})`);
    if (!isPlainObject(row.when)) throw new Error(`framework_method_row_invalid:${r + 1} (when is { "<input label>": ["<value>", …] })`);
    const when = {};
    for (const [k, vals] of Object.entries(row.when)) {
      const inp = byLabel.get(norm(k));
      if (!inp) throw new Error(`framework_method_row_input_unknown:${short(k)} (row ${r + 1}: not one of the inputs ${inputs.map((i) => i.label).join(" / ")})`);
      if (!Array.isArray(vals) || !vals.length) throw new Error(`framework_method_row_values_invalid:${r + 1} (row ${r + 1}: "${inp.label}" lists at least one value)`);
      when[inp.label] = vals.map((v) => {
        const c = inp.values.find((x) => norm(x) === norm(v));
        if (!c) throw new Error(`framework_method_row_value_unknown:${short(v)} (row ${r + 1}: "${inp.label}" is one of ${inp.values.join(" / ")})`);
        return c;
      });
    }
    return { band, when };
  });

  for (const combo of combinations(inputs)) {
    const hits = table.filter((row) => rowMatches(row, inputs, combo));
    const at = inputs.map((inp, i) => `${inp.label} ${combo[i]}`).join(", ");
    if (!hits.length) throw new Error(`framework_method_table_incomplete: no row gives a band for ${at}`);
    if (hits.length > 1) throw new Error(`framework_method_table_ambiguous: ${hits.length} rows give a band for ${at}`);
  }
  return { schema_version: METHOD_SCHEMA_VERSION, framework_key: m.framework_key, inputs, table };
}

function rowMatches(row, inputs, combo) {
  return inputs.every((inp, i) => !row.when[inp.label] || row.when[inp.label].includes(combo[i]));
}

/** The band the table gives for a complete, canonical combination (values in input order); null if none. */
export function tableBand(method, combo) {
  const row = method.table.find((r) => rowMatches(r, method.inputs, combo));
  return row ? row.band : null;
}

/**
 * The bands a finding may declare itself borderline with: the table's band for each neighbouring
 * combination, where one ORDERED input moves one value along its scale and every other input stays.
 * A framework with no ordered input has no neighbours, so no borderline band is allowed under it.
 */
export function neighbourBands(method, combo) {
  const out = new Set();
  method.inputs.forEach((inp, i) => {
    if (!inp.ordered) return;
    const at = inp.values.indexOf(combo[i]);
    for (const j of [at - 1, at + 1]) {
      if (j < 0 || j >= inp.values.length) continue;
      const next = [...combo]; next[i] = inp.values[j];
      const b = tableBand(method, next);
      if (b) out.add(b);
    }
  });
  return [...out];
}

// ── the check every rating path shares ───────────────────────────────────────────────────────────────
// Returns the first defect as { code, detail } — the caller prefixes the token and names the finding,
// so the clearance record (finding_*) and the knockout record (knockout_finding_*) refuse in their own
// voice with the same words — or, when the rating holds, the inputs in the framework's own casing and
// order. `band` must already be the manifest's canonical word; the caller's band check runs first.
//
// The words in `detail` are read by the model: they are the refusal it corrects from.

const listLabels = (method) => {
  const ls = method.inputs.map((i) => i.label);
  return ls.length <= 1 ? ls.join("") : `${ls.slice(0, -1).join(", ")} and ${ls[ls.length - 1]}`;
};
const recordWord = (method) => (method.inputs.length === 2 ? "both" : method.inputs.length === 1 ? "it" : "each");
export const inputsAt = (method, combo) => method.inputs.map((inp, i) => `${inp.label} ${combo[i]}`).join(" and ");

export function checkRatingInputs(method, { inputs, band, rated = true, borderline = null } = {}) {
  if (!method) {
    if (inputs !== undefined) return { issue: { code: "inputs_forbidden", detail: "this framework states no inputs; drop \"inputs\"" } };
    return { inputs: undefined };
  }
  if (!rated) {
    if (inputs !== undefined) return { issue: { code: "inputs_forbidden", detail: "only a rated conflict records the framework's inputs; drop \"inputs\"" } };
    return { inputs: undefined };
  }
  if (!isPlainObject(inputs))
    return { issue: { code: "inputs_missing", detail: `this framework rates through ${listLabels(method)}; record ${recordWord(method)} under "inputs"` } };
  // Two keys that differ only in case or spacing name one input twice, and a map would keep whichever
  // came last without a word. Refused instead, so the value the band rests on is the one the writer meant.
  const seen = new Set();
  for (const k of Object.keys(inputs)) {
    if (seen.has(norm(k))) {
      const label = method.inputs.find((x) => norm(x.label) === norm(k))?.label ?? short(k);
      return { issue: { code: "inputs_duplicate", detail: `${label} is given twice; record it once` } };
    }
    seen.add(norm(k));
  }
  const given = new Map(Object.entries(inputs).map(([k, v]) => [norm(k), { k, v }]));
  for (const { k } of given.values())
    if (!method.inputs.some((i) => norm(i.label) === norm(k)))
      return { issue: { code: "inputs_unknown", detail: `"${short(k)}" is not one of this framework's inputs: ${method.inputs.map((i) => i.label).join(" / ")}` } };
  const combo = [];
  for (const inp of method.inputs) {
    const g = given.get(norm(inp.label));
    if (!g) return { issue: { code: "inputs_missing", detail: `this framework rates through ${listLabels(method)}; record ${recordWord(method)} under "inputs"` } };
    const c = typeof g.v === "string" ? inp.values.find((x) => norm(x) === norm(g.v)) : null;
    if (!c) return { issue: { code: "inputs_invalid", detail: `${inp.label} must be one of: ${inp.values.join(" / ")}` } };
    combo.push(c);
  }
  const canonical = Object.fromEntries(method.inputs.map((inp, i) => [inp.label, combo[i]]));
  const expected = tableBand(method, combo);
  if (band !== expected)
    return { inputs: canonical, issue: { code: "band_off_table", detail: `the band ${band} is not what this framework's table gives for ${inputsAt(method, combo)}; the table gives ${expected}. Change the band, or reconsider an input` } };
  if (Array.isArray(borderline) && borderline.length === 2) {
    const other = borderline.find((b) => b !== band);
    if (other && !neighbourBands(method, combo).includes(other)) {
      const ordered = method.inputs.filter((i) => i.ordered).map((i) => i.label);
      return { inputs: canonical, issue: { code: "borderline_off_table", detail: ordered.length
        ? `${other} is not a band this framework's table gives for a neighbouring ${ordered.join(" or ")} with the other inputs unchanged; name that band, or omit borderline_between`
        : `this framework's table leaves no band between two others; omit borderline_between` } };
    }
  }
  return { inputs: canonical };
}

// ── the dictation: what the rating seat reads where its framework states a method ─────────────────────
// Every word here is read by the model. Labels and values come from the framework, never from code.

/** "This framework rates through its inputs, in this order: <label> (<v / v>), then <label> (<v / v>). …" */
export function methodDictation(method) {
  const list = method.inputs.map((i) => `${i.label} (${i.values.join(" / ")})`);
  const order = list.length === 1 ? list[0] : `${list.slice(0, -1).join(", then ")}, then ${list[list.length - 1]}`;
  return `This framework rates through its inputs, in this order: ${order}. Record ${recordWord(method)} on every rated finding, in these exact words, and give the band its table yields for them.`;
}

/** The shape of the `inputs` value, for the key list: {"<label>": "<value>", …}. */
export const inputsShape = (method) => `{${method.inputs.map((i) => `"${i.label}": "<value>"`).join(", ")}}`;

/** The inputs as the page shows them, in the framework's order: "Claim Grade R · Harbour"
 *  for a framework that shows the first input with its label and the second without. "" when none. */
export function inputsLine(method, inputs) {
  if (!method || !isPlainObject(inputs)) return "";
  const given = new Map(Object.entries(inputs).map(([k, v]) => [norm(k), v]));
  return method.inputs
    .map((inp) => {
      const v = given.get(norm(inp.label));
      if (typeof v !== "string" || !v.trim()) return null;
      const value = inp.values.find((x) => norm(x) === norm(v)) ?? v.trim();   // the framework's own spelling
      return inp.show_label ? `${inp.label} ${value}` : value;
    })
    .filter(Boolean)
    .join(" · ");
}

// ── freezing: minted once at attach, read verbatim on resume ─────────────────────────────────────────

/** Load the method beside a framework deck, through the same resolver the manifest is loaded with.
 *  null when the framework states no method (no file); throws when the file is there and wrong. */
export function loadFrameworkMethod(resolve, fwPath, manifest) {
  const rel = methodPathFor(fwPath);
  const p = typeof resolve === "function" ? resolve(rel) : `${resolve}/${rel}`;
  if (!p || !existsSync(p)) return null;
  return parseFrameworkMethod(readFileSync(p, "utf8"), manifest);
}

/** Read a run's frozen method. `{ method: null }` when the run froze none; `{ invalid }` when the file
 *  is there and does not parse against the run's frozen manifest (driver-written: a bug, never a pass). */
export function readFrozenMethod(frozenPath, manifest) {
  if (!existsSync(frozenPath)) return { method: null };
  try { return { method: parseFrameworkMethod(readFileSync(frozenPath, "utf8"), manifest) }; }
  catch (e) { return { method: null, invalid: String(e?.message ?? e) }; }
}

/** Write the frozen copy atomically. */
export function freezeFrameworkMethod(frozenPath, method) {
  const tmp = `${frozenPath}.tmp`;
  writeFileSync(tmp, JSON.stringify(method, null, 2) + "\n");
  renameSync(tmp, frozenPath);
}

/**
 * The one attach step both lanes take, right beside the manifest's. A run whose manifest was just minted
 * mints its method too (frozen only when the framework states one). A run whose manifest was already
 * frozen reads its method back and never loads a fresh one: a run frozen with no method keeps none, so
 * a method added to the configuration between run and resume cannot change how a live run is rated.
 */
export function attachFrameworkMethod({ frozenPath, resolve, fwPath, manifest, minted }) {
  if (!minted) {
    const r = readFrozenMethod(frozenPath, manifest);
    if (r.invalid) throw new Error(`_driver/${FROZEN_METHOD_FILE} is corrupt (${r.invalid}) — investigate; the frozen method is never silently re-derived`);
    return r.method;
  }
  const method = loadFrameworkMethod(resolve, fwPath, manifest);
  if (method) freezeFrameworkMethod(frozenPath, method);
  else rmSync(frozenPath, { force: true });   // a copy left by an interrupted earlier mint is not this run's
  return method;
}
