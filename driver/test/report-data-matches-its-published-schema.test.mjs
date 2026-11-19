// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// @tier full — publishes the four demo reports through the demo's own publisher
//
// EACH report-data.json MATCHES THE SCHEMA ITS OWN STRING NAMES. The clearance and the Knockout write two
// different shapes, and both used to stamp `report-data/1`, with no schema anywhere. A firm building its
// own screens on the file had to reverse-engineer both, and learned of a renamed field when its screen
// broke. Each shape now names itself (`report-data/clearance-1`, `report-data/knockout-1`) and has one
// schema under docs/report-data/.
//
// What this holds:
//   - every keyword the two schemas use is one the checker below implements, so no part of a schema is
//     skipped in silence;
//   - every closed list a schema spells out is the list the code keeps, so the two cannot drift;
//   - the four demo reports, published as a reader receives them, each match the schema their string names;
//   - a file with a key the schema does not know, a missing key, or a value outside a closed list fails,
//     so the passes above are not a checker that accepts everything.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SCOPE_BASES,
} from "../matter-frame-record.mjs";
import {
  COVERAGE_AREA_STATES, CONTEXT_NOTE_TYPES, CONDITION_KINDS, ADVISORY_KINDS, MANAGEABLE_CATEGORIES, OFF_FIELD_GROUNDS,
  SOURCE_TYPES, LEVELS, METER_TOKENS, BASIS_VALUES, FOUR_ANSWER_TOKENS, DISPOSITION_GROUP,
} from "../findings-model.mjs";
import { BAND_TONES } from "../framework.mjs";
import { KNOCKOUT_RATING_QUALIFIERS } from "../verify-knockout.mjs";
import { nonEmpty } from "../../shared/vacuous-pass.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const schemaFile = (name) => JSON.parse(readFileSync(join(ROOT, "docs", "report-data", `${name}.schema.json`), "utf8"));
const SCHEMAS = { "report-data/clearance-1": schemaFile("clearance-1"), "report-data/knockout-1": schemaFile("knockout-1") };

// ── the checker: the part of JSON Schema 2020-12 these two files use, and nothing else ─────────────────

const ANNOTATIONS = new Set(["$schema", "$id", "title", "description"]);
const KEYWORDS = new Set(["type", "const", "enum", "properties", "required", "additionalProperties", "items", "minimum", "maximum", "maxItems", "anyOf", "$ref", "$defs"]);

const typeOf = (v) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v);
const isType = (v, t) => (t === "integer" ? Number.isInteger(v) : t === "number" ? typeof v === "number" && Number.isFinite(v) : typeOf(v) === t);

/** Every way `value` fails `schema`, as `path: reason` lines. Empty means it matches. */
function check(schema, value, root, path = "$") {
  const out = [];
  if (schema.$ref) {
    const def = root.$defs?.[schema.$ref.replace(/^#\/\$defs\//, "")];
    if (!def) return [`${path}: unresolved ${schema.$ref}`];
    out.push(...check(def, value, root, path));
  }
  if (schema.type) {
    const types = [].concat(schema.type);
    if (!types.some((t) => isType(value, t))) return [...out, `${path}: is ${typeOf(value)}, expected ${types.join(" or ")}`];
  }
  if ("const" in schema && value !== schema.const) out.push(`${path}: is ${JSON.stringify(value)}, expected ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.includes(value)) out.push(`${path}: ${JSON.stringify(value)} is not one of ${JSON.stringify(schema.enum)}`);
  if (typeof value === "number") {
    if (schema.minimum != null && value < schema.minimum) out.push(`${path}: ${value} is below ${schema.minimum}`);
    if (schema.maximum != null && value > schema.maximum) out.push(`${path}: ${value} is above ${schema.maximum}`);
  }
  if (schema.anyOf && !schema.anyOf.some((s) => check(s, value, root, path).length === 0))
    out.push(`${path}: matches none of its ${schema.anyOf.length} forms`);
  if (Array.isArray(value)) {
    if (schema.maxItems != null && value.length > schema.maxItems) out.push(`${path}: ${value.length} items, at most ${schema.maxItems}`);
    if (schema.items) value.forEach((v, i) => out.push(...check(schema.items, v, root, `${path}[${i}]`)));
  }
  if (typeOf(value) === "object") {
    for (const k of schema.required ?? []) if (!(k in value)) out.push(`${path}: missing ${k}`);
    for (const [k, v] of Object.entries(value)) {
      if (schema.properties && k in schema.properties) out.push(...check(schema.properties[k], v, root, `${path}.${k}`));
      // A property a $ref'd schema declares is declared: its own additionalProperties judged it above.
      else if (schema.additionalProperties === false && !schema.$ref) out.push(`${path}: ${k} is not in the schema`);
      else if (typeOf(schema.additionalProperties) === "object") out.push(...check(schema.additionalProperties, v, root, `${path}.${k}`));
    }
  }
  return out;
}

/** Every keyword a schema uses, with where. */
function keywordsIn(schema, path = "#", out = []) {
  for (const [k, v] of Object.entries(schema)) {
    out.push([k, path]);
    if (k === "properties" || k === "$defs") for (const [name, sub] of Object.entries(v)) keywordsIn(sub, `${path}/${k}/${name}`, out);
    else if (k === "items" || (k === "additionalProperties" && typeOf(v) === "object")) keywordsIn(v, `${path}/${k}`, out);
    else if (k === "anyOf") v.forEach((sub, i) => keywordsIn(sub, `${path}/anyOf/${i}`, out));
  }
  return out;
}

/** The value a closed list in a schema spells out, by JSON pointer, without its null. */
function enumAt(schema, pointer) {
  const node = pointer.split("/").slice(1).reduce((n, p) => n?.[p], schema);
  assert.ok(node, `${pointer} is not in the schema`);
  const list = node.enum ?? (node.const !== undefined ? [node.const] : null);
  assert.ok(Array.isArray(list), `${pointer} carries no closed list`);
  return list.filter((v) => v !== null);
}

test("every keyword the two schemas use is one the checker implements", () => {
  for (const [name, schema] of Object.entries(SCHEMAS)) {
    const unknown = keywordsIn(schema).filter(([k]) => !KEYWORDS.has(k) && !ANNOTATIONS.has(k));
    assert.deepEqual(unknown, [], `${name} uses a keyword this checker would skip`);
  }
});

test("every closed list a schema spells out is the one the code keeps", () => {
  const c = SCHEMAS["report-data/clearance-1"];
  const k = SCHEMAS["report-data/knockout-1"];
  const same = (got, want, what) => assert.deepEqual([...got].sort(), [...want].sort(), `${what}: the schema and the code disagree`);
  same(enumAt(c, "#/$defs/band/properties/tone"), BAND_TONES, "a band's tone");
  same(enumAt(k, "#/properties/framework/properties/bands/items/properties/tone"), BAND_TONES, "a Knockout band's tone");
  same(enumAt(c, "#/properties/scopeBasis"), SCOPE_BASES, "the scope basis");
  same(enumAt(c, "#/properties/coverage/items/properties/state"), COVERAGE_AREA_STATES, "a coverage row's state");
  same(enumAt(c, "#/properties/contextNotes/items/properties/type"), CONTEXT_NOTE_TYPES, "a context note's type");
  same(enumAt(c, "#/properties/actions/properties/conditions/items/properties/kind"), CONDITION_KINDS, "a condition's kind");
  same(enumAt(c, "#/properties/actions/properties/advisories/items/properties/kind"), ADVISORY_KINDS, "an advisory's kind");
  same(enumAt(c, "#/$defs/finding/properties/manageable/properties/category"), MANAGEABLE_CATEGORIES, "a manageable finding's category");
  same(enumAt(c, "#/$defs/finding/properties/off_field_ground"), OFF_FIELD_GROUNDS, "an off-field ground");
  same(enumAt(c, "#/$defs/finding/properties/source/properties/source_type"), SOURCE_TYPES, "a source type");
  same(enumAt(c, "#/$defs/finding/properties/level"), LEVELS, "a legacy level");
  same(enumAt(c, "#/$defs/finding/properties/group"), new Set(Object.values(DISPOSITION_GROUP)), "a finding's group");
  same(enumAt(c, "#/$defs/meter/properties/basis"), BASIS_VALUES, "a meter's basis");
  for (const [meter, tokens] of Object.entries(METER_TOKENS))
    same(enumAt(c, `#/$defs/finding/properties/meters/properties/${meter}/properties/token`), tokens, `the ${meter} meter's token`);
  same(Object.keys(c.$defs.finding.properties.meters.properties), Object.keys(METER_TOKENS), "the meters");
  for (const [answer, tokens] of Object.entries(FOUR_ANSWER_TOKENS))
    same(enumAt(c, `#/properties/fourAnswers/properties/${answer}/properties/token`), tokens, `the ${answer} answer's token`);
  same(Object.keys(c.properties.fourAnswers.properties), Object.keys(FOUR_ANSWER_TOKENS), "the four answers");
  same(enumAt(k, "#/$defs/mark/properties/qualifier"), KNOCKOUT_RATING_QUALIFIERS, "a Knockout rating's qualifier");
});

// ── the four demo reports, as a reader receives them ───────────────────────────────────────────────────

function publishDemo() {
  const pool = mkdtempSync(join(tmpdir(), "report-data-schema-pool-"));
  const r = spawnSync(process.execPath, [join(ROOT, "bin", "example.mjs"), "--once", "--pool", pool], { encoding: "utf8", timeout: 240_000 });
  assert.equal(r.status, 0, `the demo publisher failed:\n${r.stderr || r.stdout}`);
  return nonEmpty(readdirSync(pool, { recursive: true }).map(String).filter((n) => /(^|[\\/])report-data[^\\/]*\.json$/.test(n))
    .map((n) => ({ name: n, data: JSON.parse(readFileSync(join(pool, n), "utf8")) })), "the data files the demo published");
}

test("each demo report's data file matches the schema its string names", () => {
  const files = publishDemo();
  const shapes = files.map((f) => f.data.schema).sort();
  // The four products: three clearance shapes and one Knockout, so both schemas are exercised.
  assert.deepEqual(shapes, ["report-data/clearance-1", "report-data/clearance-1", "report-data/clearance-1", "report-data/knockout-1"],
    `the demo published ${shapes.join(", ")}`);
  for (const { name, data } of files) {
    assert.deepEqual(check(SCHEMAS[data.schema], data, SCHEMAS[data.schema]), [], `${name} does not match ${data.schema}`);
  }

  // THE CONTROLS: the checker refuses what each schema forbids, so the passes above are not vacuous.
  const one = (shape) => structuredClone(files.find((f) => f.data.schema === shape).data);
  for (const shape of Object.keys(SCHEMAS)) {
    const schema = SCHEMAS[shape];
    const extra = one(shape); extra.unexpected = 1;
    assert.match(check(schema, extra, schema).join("\n"), /unexpected is not in the schema/, `${shape}: an unknown key passed`);
    const missing = one(shape); delete missing.runId;
    assert.match(check(schema, missing, schema).join("\n"), /missing runId/, `${shape}: a missing key passed`);
    const tone = one(shape); tone.framework.bands[0].tone = "crimson";
    assert.match(check(schema, tone, schema).join("\n"), /"crimson" is not one of/, `${shape}: a value outside a closed list passed`);
  }
});
