// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The Knockout rating's tools take what its validator takes. A degraded mark is flagged `degraded: true`, the value
// the report's left-open list reads, and the manual says so; the explanation is the required manual-verification
// note, not a field on the flag. The assessment and the correction share one validator for a finding's `type` and a
// rating's qualifier, so both tools offer the same values, from the validator's own lists. Pure, $0.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { KNOCKOUT_FINDING_TYPES } from "../findings-model.mjs";
import { KNOCKOUT_RATING_QUALIFIERS, validateMergedFindings } from "../verify-knockout.mjs";
import { driverDir } from "../../shared/driver-dir.mjs";
import { ASSESS_SENTENCES } from "./ruled-sentences-knockout-assess.mjs";

const DRIVER = join(dirname(fileURLToPath(import.meta.url)), "..");

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
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "knockout", version: "0" } } });
    send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  });
}

/** Every `type` and `ratingQualifier` property anywhere under a schema. */
function propsNamed(schema, key, out = []) {
  if (!schema || typeof schema !== "object") return out;
  if (schema.properties?.[key]) out.push(schema.properties[key]);
  for (const v of Object.values(schema)) if (v && typeof v === "object") propsNamed(v, key, out);
  return out;
}

test("the assessment and the correction offer the validator's finding types and qualifier values", async () => {
  const tools = await servedTools();
  for (const name of ["record_knockout_assess", "record_knockout_correction"]) {
    const tool = tools.find((t) => t.name === name);
    assert.ok(tool, `${name} was not served`);
    const types = propsNamed(tool.inputSchema, "type").filter((p) => p.type === "string");
    assert.ok(types.length >= 1, `${name}: no finding type`);
    for (const p of types) assert.deepEqual(p.enum, [...KNOCKOUT_FINDING_TYPES], `${name}: a finding type offers other values`);
    const qualifiers = propsNamed(tool.inputSchema, "ratingQualifier");
    assert.ok(qualifiers.length >= 1, `${name}: no qualifier`);
    for (const p of qualifiers)
      for (const q of KNOCKOUT_RATING_QUALIFIERS) assert.ok(p.description.includes(`null or "${q}"`), `${name}: a qualifier does not name "${q}": ${p.description}`);
  }
});

test("a mark with no research payload is degraded only as true, the value the report reads", (t) => {
  const run = mkdtempSync(join(tmpdir(), "knockout-degraded-"));
  t.after(() => rmSync(run, { recursive: true, force: true }));
  mkdirSync(driverDir(run), { recursive: true });
  const plan = { marks: [{ name: "LANTERNWICK" }] };
  const merged = (degraded) => ({ schema_version: 1, batch: { executiveSummary: "One invented name, not researched.", standardCaveats: [] },
    marks: [{ name: "LANTERNWICK", degraded, purpleNotes: ["Manual verification recommended"], findings: [] }] });
  const unflagged = (v) => validateMergedFindings(run, merged(v), plan).failures.some((f) => /is not flagged degraded/.test(f));
  assert.equal(unflagged(true), false, "degraded: true was not accepted as the flag");
  for (const v of [{ reason: "no-payload" }, "true", 1, null, false])
    assert.equal(unflagged(v), true, `degraded: ${JSON.stringify(v)} passed for a mark with no research payload`);
});

test("the manual sets the flag the tool takes", () => {
  const manual = readFileSync(join(DRIVER, "skills", "knockout-assess", "SKILL.md"), "utf8").replace(/\s+/g, " ");
  assert.doesNotMatch(manual, /degraded: \{ "reason"/);
  assert.ok(manual.includes(ASSESS_SENTENCES.degradedMarkMustCarryTrue), "the manual does not set degraded: true");
});
