// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier fast — the finding's one definition against the parser, the tool, the dispatch and the recorder, on invented records
//
// EACH FINDING KEY IS DEFINED ONCE, AND THE TOOL SERVES IT.
//
// The dispatch said "Each finding object has EXACTLY these keys" and listed fifteen of the twenty-four the parser
// accepts, and the record_synthesis schema described every key as "see findings-model.mjs", a file the model cannot
// read. Now one definition (FINDING_FIELDS) gives each key's type, when it is required, its shape and its values:
//   · its keys are the current version's, and every value it lists is the parser's own;
//   · the tool serves each key with that type and text, on a saved finding and on a patch row alike;
//   · the dispatch names the keys every new finding carries and leaves the rest to the tool;
//   · each presence rule holds where it is enforced: the parser, the record's own check, the lint, the tripwire;
//   · a newly written whole record below the current version is refused at the tool, a fresh file below it is
//     re-asked and a resumed one is kept, and a record of an earlier version still reads.
// Invented values only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FINDING_FIELDS, FINDING_KEYS_CURRENT, FINDING_KEYS_ALWAYS, FINDINGS_SCHEMA_VERSION, DISPOSITIONS, METERS, METER_TOKENS, BASIS_VALUES,
  SOURCE_TYPES, OFF_FIELD_GROUNDS, MANAGEABLE_CATEGORIES, RATING_WITHDRAWN_GROUNDS, USE_SOURCE_QUALITY, parseFindingsJson,
} from "../findings-model.mjs";
import { STAGES, paths } from "../stages.mjs";
import { recordSynthesis, VERSION_STALE_TOKEN } from "../synthesis-record.mjs";
import { versionRecovery } from "../steps/synthesis.mjs";
import { findProbativeGradingViolations } from "../reasoning-tripwires.mjs";
import { contentModelChecks } from "../predelivery-lint.mjs";
import { synthesisFindings } from "./mock-stage-fixtures.mjs";

const DRIVER = join(dirname(fileURLToPath(import.meta.url)), "..");
const doc = () => JSON.parse(synthesisFindings(null));
const NARRATIVE = {
  spine: "Dominant-element analysis. The shared element carries both marks, and a register would weigh it first. "
    + "The conflicting registration covers the same distinctive element in the filed class, and the goods overlap.",
  verdict: "The identical registration in the searched class drives the read, and the position is adverse on the current filing.",
  coverage: { read: "The instructed registers were enumerated to completeness on the named band." },
};

test("the definition's keys are the current version's, and every value it lists is the parser's own", () => {
  assert.deepEqual(Object.keys(FINDING_FIELDS), [...FINDING_KEYS_CURRENT]);
  assert.deepEqual([...FINDING_KEYS_ALWAYS], ["ordinal", "mark", "owner", "disposition", "meters", "quadrant", "source"]);
  for (const [k, f] of Object.entries(FINDING_FIELDS)) {
    assert.ok(["string", "integer", "object", "array", "boolean"].includes(f.type), `${k}: no type`);
    assert.ok(typeof f.about === "string" && f.about.length > 20 && !/findings-model\.mjs/.test(f.about), `${k}: no description the model can use`);
  }
  const has = (k, values) => { for (const v of values) assert.ok(FINDING_FIELDS[k].about.includes(v), `${k} does not list "${v}"`); };
  has("disposition", DISPOSITIONS);
  has("source", SOURCE_TYPES);
  has("off_field_ground", OFF_FIELD_GROUNDS);
  has("manageable", MANAGEABLE_CATEGORIES);
  has("rating_withdrawn_ground", RATING_WITHDRAWN_GROUNDS);
  has("use_check", USE_SOURCE_QUALITY);
  has("meters", [...METERS, ...BASIS_VALUES, ...METERS.map((m) => `${m} is ${METER_TOKENS[m].join(" / ")}`)]);
});

/** The tools the recording server serves, asked as a session asks: tools/list. A timeout fails. */
function servedTools() {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [join(DRIVER, "engine", "mcp", "recording-server.mjs")], {
      stdio: ["pipe", "pipe", "ignore"], env: { ...process.env, CLEAROTRON_BAND_RUN_DIR: join(DRIVER, "..", ".no-such-run") } });
    let buf = "";
    const timer = setTimeout(() => { p.kill(); reject(new Error("the recording server did not answer tools/list")); }, 20000);
    p.stdout.setEncoding("utf8");
    p.stdout.on("data", (d) => {
      buf += d;
      for (const line of buf.split("\n")) {
        let m; try { m = JSON.parse(line); } catch { continue; }
        if (m?.id !== 2) continue;
        clearTimeout(timer); p.kill();
        return resolve(m.result?.tools ?? []);
      }
    });
    const send = (o) => p.stdin.write(JSON.stringify(o) + "\n");
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "fields", version: "0" } } });
    send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  });
}

test("the tool serves each key with its type and text, on a saved finding and on a patch row alike", async () => {
  const tool = (await servedTools()).find((t) => t.name === "record_synthesis");
  assert.ok(tool, "record_synthesis was not served");
  const saved = tool.inputSchema.properties.save_findings.items;
  const row = tool.inputSchema.properties.findings_patch.items;
  assert.equal(saved.description, "One complete finding object, as the findings record carries it. It takes the keys below and no others.");
  for (const [k, f] of Object.entries(FINDING_FIELDS)) {
    assert.deepEqual(saved.properties[k], { type: f.type, description: f.about }, `save_findings.${k}`);
    if (k !== "ordinal") assert.deepEqual(row.properties[k], { type: f.type, description: f.about }, `findings_patch.${k}`);
  }
  assert.match(row.properties.ordinal.description, /^For an existing finding, use its current ordinal\./, "the patch row lost its own ordinal");
  assert.equal(saved.required, undefined, "a finding key is refused at the schema, where no call file is kept");
});

test("the dispatch names the keys every new finding carries and leaves the rest to the tool", () => {
  const msg = STAGES.synthesis.message({ paths: paths("/r"), job: {}, profile: null,
    framework: { title: "T", framework_key: "invented-framework", entity_label: "the company", bands: [{ label: "Serious" }, { label: "Low" }] } });
  assert.ok(msg.includes("Each finding object takes only the keys the `record_synthesis` schema lists, each with its shape and the findings it is required on. "
    + "Every newly written finding carries: ordinal, mark, owner, disposition, meters, quadrant, source. The retired composite/level/dispute_type keys are FORBIDDEN"));
  assert.doesNotMatch(msg, /Each finding object has EXACTLY these keys/);
});

// ── EACH PRESENCE RULE WHERE IT IS ENFORCED ─────────────────────────────────────────────────────────────

/** The fixture's one finding, an adversarial one, changed; parsed as the record the parser reads. */
const parsing = (change) => { const d = doc(); change(d.findings[0]); return () => parseFindingsJson(JSON.stringify(d)); };
const accepted = (change, what) => assert.doesNotThrow(parsing(change), what);
const refused = (change, re, what) => assert.throws(parsing(change), re, what);

test("the parser's rules: each accepted where the definition says, and refused where it says not", () => {
  accepted(() => {}, "the fixture");
  refused((f) => { delete f.band; }, /finding_band_missing:1/, "band on an adversarial finding");
  refused((f) => { f.disposition = "off-field"; f.off_field_ground = "no-material-risk"; }, /finding_band_forbidden:1/, "band on off-field");
  accepted((f) => { f.disposition = "off-field"; f.off_field_ground = "no-material-risk"; delete f.band; }, "off-field with its ground and no band");
  refused((f) => { f.disposition = "off-field"; delete f.band; }, /finding_off_field_ground_missing:1/, "off-field with no ground");
  refused((f) => { f.off_field_ground = "no-material-risk"; }, /finding_off_field_ground_orphan:1/, "an off-field ground on another disposition");
  refused((f) => { delete f.net; }, /finding_net_missing:1/, "net");
  refused((f) => { delete f.legal_position; }, /finding_legal_position_missing:1/, "legal_position");
  refused((f) => { delete f.practical_position; }, /finding_practical_position_missing:1/, "practical_position");
  accepted((f) => { f.ruled_out = true; f.ruled_out_reason = "It shares no word or sound with the invented mark."; delete f.net; delete f.legal_position; delete f.practical_position; },
    "a ruled-out finding with its reason needs no net or positions");
  refused((f) => { f.ruled_out = true; }, /finding_ruled_out_reason_missing:1/, "ruled_out with no reason");
  accepted((f) => { f.disposition = "withdrawn"; f.withdrawn_reason = "The review rejected it."; f.rating_withdrawn_ground = RATING_WITHDRAWN_GROUNDS[0]; delete f.net; },
    "a withdrawn finding with its reason and ground");
  refused((f) => { f.disposition = "withdrawn"; }, /finding_withdrawn_reason_missing:1/, "withdrawn with no reason");
  refused((f) => { f.withdrawn_reason = "A stray reason."; }, /finding_withdrawn_reason_orphan:1/, "a withdrawn reason on a live finding");
  refused((f) => { f.rating_withdrawn_ground = RATING_WITHDRAWN_GROUNDS[0]; }, /finding_rating_withdrawn_ground_orphan:1/, "a rating ground on a live finding");
  refused((f) => { f.manageable = { category: MANAGEABLE_CATEGORIES[0], reason: "An invented reason." }; }, /finding_manageable_on_unmanageable:1/, "manageable on adversarial");
  accepted((f) => { f.disposition = "distinguished"; f.manageable = { category: MANAGEABLE_CATEGORIES[0], reason: "An invented reason." }; }, "manageable on distinguished");
  refused((f) => { f.borderline_between = ["High", "High"]; }, /finding_borderline_between_invalid:1/, "a band borderline with itself");
  refused((f) => { f.owner = { country: "US" }; }, /finding_owner_invalid:1/, "an owner with no name");
  accepted((f) => { f.owner = { name: "Invented Owner Co", registrations: [] }; }, "an owner with no country and no registration");
  refused((f) => { f.deadline = { kind: "opposition" }; }, /finding_deadline_date_missing:1/, "a deadline with no date");
  accepted((f) => { f.deadline = { date: "2027-01-31" }; }, "a deadline with a date alone");
  refused((f) => { f.composite = 3; }, /finding_legacy_scale_forbidden:composite/, "a retired key");
});

test("the dispatch's required manageable and bears_on are flagged before delivery, and the parser leaves them to archived records", () => {
  const d = doc();
  const bare = { ...d.findings[0], ordinal: 2, disposition: "distinguished" };
  accepted(() => {}, "premise");
  const lint = Object.fromEntries(contentModelChecks({ findings: [d.findings[0], bare], fourAnswers: null, expected: true }).map((c) => [c.id, c]));
  assert.equal(lint["manageable-category"].pass, false);
  assert.match(lint["manageable-category"].detail, /ordinal 2/);
  const high = { ...d.findings[0], meters: { ...d.findings[0].meters, enforcer: { token: "high", basis: "inferred-from-signal" } } };
  delete high.bears_on;
  assert.deepEqual(findProbativeGradingViolations({ schemaVersion: FINDINGS_SCHEMA_VERSION, findings: [high] }).map((v) => v.ordinal), [1]);
  assert.deepEqual(findProbativeGradingViolations({ schemaVersion: FINDINGS_SCHEMA_VERSION, findings: [{ ...high, bears_on: "The owner opposed an invented mark on this element." }] }), []);
});

// ── THE VERSION ─────────────────────────────────────────────────────────────────────────────────────────

test("a newly written whole record below the current version is refused at the tool and nothing is written; at the current one it is kept", () => {
  for (const version of [3, 4, 6]) {
    const dir = mkdtempSync(join(tmpdir(), "finding-version-"));
    try {
      const d = { ...doc(), schema_version: version };
      const r = recordSynthesis(dir, { narrative: NARRATIVE, findings: d });
      assert.match(String(r.refused), new RegExp(`^${VERSION_STALE_TOKEN}:${version} — a newly written findings record is "schema_version": ${FINDINGS_SCHEMA_VERSION}\\. `
        + `Send the whole record again at ${FINDINGS_SCHEMA_VERSION}, with the fields that version requires\\. A correction to a record already accepted is sent as a patch and keeps that record's version\\.$`));
      assert.equal(existsSync(join(dir, "findings.json")), false, `version ${version}: a refused record was written`);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
  const dir = mkdtempSync(join(tmpdir(), "finding-version-"));
  try {
    const r = recordSynthesis(dir, { narrative: NARRATIVE, findings: doc() });
    assert.equal(r.refused, null, r.refused);
    assert.equal(JSON.parse(readFileSync(join(dir, "findings.json"), "utf8")).schema_version, FINDINGS_SCHEMA_VERSION);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("a fresh file below the current version is re-asked, a resumed one is kept, and records of earlier versions still read", () => {
  for (const v of [3, 4, 6]) assert.equal(versionRecovery(v, false), "reask", `fresh ${v}`);
  assert.equal(versionRecovery(FINDINGS_SCHEMA_VERSION, false), null);
  for (const v of [4, 6]) assert.equal(versionRecovery(v, true), "keep", `resumed ${v}`);
  assert.equal(versionRecovery(null, false), null, "an unreadable file was re-asked");
  const v6 = { ...doc(), schema_version: 6 };
  assert.equal(parseFindingsJson(JSON.stringify(v6)).schemaVersion, 6);
  const v4 = { ...doc(), schema_version: 4, findings: doc().findings.map(({ net: _n, legal_position: _l, practical_position: _p, ...f }) => f) };
  delete v4.four_answers; delete v4.ask_answers;
  assert.equal(parseFindingsJson(JSON.stringify(v4)).schemaVersion, 4, "a version-4 record with no net or positions no longer reads");
});
