// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A FOREIGN RECORD LINK IS NAMED ONCE, FOR EVERY FINDING, AND SALVAGE BLANKS IT RATHER THAN FAIL THE RUN.
//
// R2 on 0.4.1-beta.1 (openai-agent × Signa) delivered no report. The synthesis seat copied each office's
// own page, which Signa's records carry, into `source.resolved_link` on eleven findings. Signa publishes no
// page per record, so the findings gate refused every one. It named one finding per refusal, so each
// attempt fixed one and the attempts ran out. Then the salvage lane took the refusal and found nothing it
// could repair. These arms hold every layer:
//   · one refusal carries every offending ordinal in its token, the gate's own sentence after it, and the
//     corrective message hands the seat every ordinal;
//   · the synthesis call refuses the run's first offending call and accepts a repeat with the links blanked,
//     and the server is handed the run's register under both engines, so the call can gate at all;
//   · salvage blanks a foreign link written without the transport, re-checks with the stage's own gate, and
//     the run delivers.
// The mock run's register is corsearch (scripts/test-run.mjs declares it for every suite), so an office
// page on another host is foreign there exactly as it is on Signa.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseFindingsJson, blankForeignRecordLinks } from "../findings-model.mjs";
import { blankOnRepeat } from "../foreign-record-links.mjs";
import { correctiveMessage, correctionHint } from "../gateway.mjs";
import { buildGatherMcpConfig } from "../engine/mcp/gather-config.mjs";
import { renderCodexConfigToml } from "../engine/mcp/codex-config.mjs";
import { refusalsFor } from "../synthesis-record.mjs";
import { recordOriginsFor } from "../record-origins.mjs";
import { driverDir } from "../../shared/driver-dir.mjs";
import { pinEnv } from "../../shared/env-aliases.mjs";

const OFFICE = (n) => `https://www.swissreg.ch/database-client/register/detail/trademark/${n}`;
const meter = (token, basis = "verified-from-record") => ({ token, basis });
const finding = (ordinal, over = {}) => ({
  ordinal, mark: `QZXV ${ordinal}`,
  owner: { name: `Qzxv Holdings ${ordinal}`, country: "CH", registrations: [{ uri: `/mark/ch/7700${ordinal}`, classes: ["9"] }] },
  composite: 4, level: "B", dispute_type: "register-only",
  meters: { mark_similarity: meter("high"), goods_proximity: meter("medium"), use: meter("confirmed"), enforcer: meter("high") },
  quadrant: { x: 0.5, y: 0.5 },
  source: { source_type: "register-vendor", resolved_link: "" },
  ...over,
});
const doc = (findings) => JSON.stringify({ schema_version: 1, findings, coverage: [{ area: "register / CH", state: "confirmed-clean", note: "" }] });
const NO_PAGES = [];   // a register that publishes no page per record, as Signa declares

test("one refusal names EVERY finding with a foreign record link, and keeps the gate's own sentence", () => {
  const findings = [
    finding(1, { source: { source_type: "register-vendor", resolved_link: OFFICE(1) } }),
    finding(2, { source: { source_type: "common-law-marketplace", resolved_link: "https://shop.example/item/2" } }),
    finding(3, { source: { source_type: "register-vendor", resolved_link: OFFICE(3) } }),
    finding(4),
    finding(5, { owner: { name: "Qzxv Holdings 5", country: "CH", registrations: [{ uri: "https://tsdr.uspto.gov/#caseNumber=77005", classes: ["9"] }] } }),
  ];
  let message = null;
  try { parseFindingsJson(doc(findings), { recordOrigins: NO_PAGES }); } catch (e) { message = e.message; }
  assert.ok(message, "a record set with foreign links passed the gate");
  assert.match(message, /^finding_record_url_foreign_host:1,3,5 \(/, `one refusal for 1, 3 and 5, never one per attempt: ${message}`);
  assert.ok(message.includes(`source.resolved_link points at https://www.swissreg.ch, which is not a register this run searched — `
    + "this provider publishes no per-record page at all — cite the office register in the text and leave the URL as the record's own uri path.)"),
  `the sentence after the token is not the gate's own: ${message}`);
});

test("a single foreign link reads exactly as it did before", () => {
  let message = null;
  try { parseFindingsJson(doc([finding(1, { source: { source_type: "register-vendor", resolved_link: OFFICE(1) } })]), { recordOrigins: NO_PAGES }); }
  catch (e) { message = e.message; }
  assert.match(message, /^finding_record_url_foreign_host:1 \(source\.resolved_link points at https:\/\/www\.swissreg\.ch, /);
});

test("salvage blanks a foreign link, keeps the record's identity, and the result passes the same gate", () => {
  const findings = [
    finding(1, { source: { source_type: "register-vendor", resolved_link: OFFICE(1) } }),
    finding(2, { source: { source_type: "common-law-marketplace", resolved_link: "https://shop.example/item/2" } }),
    finding(3, { owner: { name: "Qzxv Holdings 3", country: "CH", registrations: [{ uri: "https://www.swissreg.ch/mark/ch/77003", classes: ["9"] }] } }),
  ];
  const before = JSON.parse(doc(findings));
  const { doc: after, blanked, kept } = blankForeignRecordLinks(before, NO_PAGES);
  assert.deepEqual(blanked.map((b) => [b.ordinal, b.field, b.now]), [[1, "source.resolved_link", ""], [3, "registration.uri", "/mark/ch/77003"]]);
  assert.deepEqual(kept, []);
  assert.equal(after.findings[1].source.resolved_link, "https://shop.example/item/2", "a common-law link is not a record link and is never touched");
  assert.equal(before.findings[0].source.resolved_link, OFFICE(1), "the document it was handed was edited in place");
  assert.doesNotThrow(() => parseFindingsJson(JSON.stringify(after), { recordOrigins: NO_PAGES }));
  assert.deepEqual(blankForeignRecordLinks(before, null).blanked, [], "with no register named, the gate is off and so is the salvage");
  const opaque = blankForeignRecordLinks(JSON.parse(doc([finding(1, { owner: { name: "Q", country: "CH", registrations: [{ uri: "https://tsdr.uspto.gov/#caseNumber=1", classes: ["9"] }] } })])), NO_PAGES);
  assert.equal(opaque.kept.length, 1, "a foreign uri with no record path in it is reported, never guessed at");
});

test("the seat's corrective message carries every ordinal, after the verifier's cut", () => {
  const eleven = Array.from({ length: 11 }, (_, i) => finding(i + 1, { source: { source_type: "register-vendor", resolved_link: OFFICE(i + 1) } }));
  let reason = null;
  try { parseFindingsJson(doc(eleven), { recordOrigins: NO_PAGES }); } catch (e) { reason = String(e.message).replace(/\s+/g, " ").slice(0, 160); }
  const lastFail = `invalid_file:clearance-search/tmpqzxv/2026-10-10-quiet-lark/findings.json:${reason}`;
  const all = "finding_record_url_foreign_host:1,2,3,4,5,6,7,8,9,10,11";
  assert.ok(correctionHint(lastFail).includes(all), "the hint keeps the token whole");
  assert.ok(correctiveMessage("BASE", 2, lastFail, "/run/narrative.md").includes(all), "the seat is told every finding, not the first");
});

test("the call refuses the run's first offending call, and accepts a repeat with the links blanked", () => {
  const call = { findings: JSON.parse(doc([finding(1, { source: { source_type: "register-vendor", resolved_link: OFFICE(1) } })])), narrative: {} };
  const first = blankOnRepeat(call, NO_PAGES, false);
  assert.equal(first.call, call, "the first offending call is passed through untouched, for the gate to refuse");
  assert.deepEqual(first.blanked, []);
  const repeat = blankOnRepeat(call, NO_PAGES, true);
  assert.equal(repeat.call.findings.findings[0].source.resolved_link, "");
  assert.equal(call.findings.findings[0].source.resolved_link, OFFICE(1), "the seat's own call was edited in place");
  assert.deepEqual(blankOnRepeat(call, null, true).blanked, [], "with no register named there is nothing to gate");
});

test("every local server is handed the run's register, under Claude and under Codex", () => {
  const was = process.env.CLEAROTRON_DATABASE;
  process.env.CLEAROTRON_DATABASE = "signa";
  try {
    const cfg = buildGatherMcpConfig(["recording-synthesis"], { sessionKey: "k", agent: "a", runDir: "/tmp/qzxv-run" });
    assert.equal(cfg.mcpServers["recording-synthesis"].env.CLEAROTRON_DATABASE, "signa", "the recording server cannot gate a record link");
    const toml = renderCodexConfigToml({ mcpConfig: JSON.stringify(cfg), allowedTools: ["mcp__recording-synthesis__record_synthesis"] });
    const block = toml.slice(toml.indexOf("recording-synthesis"));
    assert.match(block, /CLEAROTRON_DATABASE = "signa"/, "a Codex recording server never sees the register");
  } finally {
    if (was === undefined) delete process.env.CLEAROTRON_DATABASE; else process.env.CLEAROTRON_DATABASE = was;
  }
});

// ── THE RUN ─────────────────────────────────────────────────────────────────────────────────────────
const HERE = dirname(fileURLToPath(import.meta.url));
const CLAUDE = join(HERE, "mock-claude.mjs");
chmodSync(CLAUDE, 0o755);
process.env.CORSEARCH_SESSION_KEY ||= "test-offline";
process.env.CLEAROTRON_BAND_TRUTH_GATE ||= "0";
const ROOT = mkdtempSync(join(tmpdir(), "clearotron-foreign-link-"));
process.env.CLEAROTRON_AI = "anthropic-agent";
pinEnv(process.env, "CLEAROTRON_CLAUDE_PATH", CLAUDE);
pinEnv(process.env, "CLEAROTRON_WORK_DIR", ROOT);
pinEnv(process.env, "CLEAROTRON_REPORTS_DIR", join(ROOT, "pool"));
process.env.CLEAROTRON_MAX_RETRIES = "0";
process.env.CLEAROTRON_RECOVERY_MAX = "0";
process.env.CLEAROTRON_SATPROBE_CODESIDE ||= "0";

const runWith = async (knob, ref) => {
  const PL = await import("../pipeline.mjs");
  process.env.MOCK_VERDICT = "CLEAR";
  process.env.MOCK_SKEPTIC = "no flags surfaced";
  process.env.MOCK_FINDINGS_N = "3";
  process.env.MOCK_FOREIGN_LINK = knob;
  try {
    const job = { id: `job-${ref}`, msgId: `<${ref.toLowerCase()}@x>`, forwarder: "jordan", forwarderDomain: "example.com",
      ref, markName: `MARK ${ref}`, classes: [9], provider: "corsearch" };
    const res = await PL.pipeline(job);
    const events = existsSync(driverDir(res.runDir ?? "/nonexistent", "run.jsonl"))
      ? readFileSync(driverDir(res.runDir, "run.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
    return { res, events };
  } finally {
    for (const k of ["MOCK_VERDICT", "MOCK_SKEPTIC", "MOCK_FINDINGS_N", "MOCK_FOREIGN_LINK"]) delete process.env[k];
  }
};

test("a seat that keeps sending office links is refused once, naming every finding, then delivers blanked", async () => {
  assert.ok(process.env.CLEAROTRON_DATABASE, "precondition: the suite names a register, so the host gate is live");
  const { res, events } = await runWith("call", "TMPFLCALL");
  assert.equal(res.ok, true, `the run did not deliver: ${JSON.stringify(res).slice(0, 400)}`);
  const refused = refusalsFor(res.runDir).map((r) => String(r.reason));
  assert.ok(refused.some((r) => r.includes("finding_record_url_foreign_host:1,2,3")), `the first call was not refused naming every finding: ${refused}`);
  const blanked = events.filter((e) => e.event === "foreign-record-links-blanked");
  assert.deepEqual(blanked.map((e) => [e.layer, e.ordinals]), [["call", [1, 2, 3]]], "the repeat was not accepted blanked at the call");
  assert.ok(!events.some((e) => e.event === "salvage-lane-no-target"));
  const delivered = JSON.parse(readFileSync(join(res.runDir, "findings.json"), "utf8"));
  for (const f of delivered.findings) assert.equal(f.source.resolved_link, "", `finding ${f.ordinal} still carries a foreign link`);
  const kept = JSON.parse(readFileSync(driverDir(res.runDir, "foreign-record-links.json"), "utf8"));
  assert.deepEqual(kept.blanked.map((b) => b.was), [OFFICE(1), OFFICE(2), OFFICE(3)], "the originals are not kept beside the run");
});

test("links written to the file without the transport are blanked by salvage, and the run delivers", async () => {
  const { res, events } = await runWith("file", "TMPFLFILE");
  assert.equal(res.ok, true, `the run did not deliver: ${JSON.stringify(res).slice(0, 400)}`);
  const blanked = events.filter((e) => e.event === "foreign-record-links-blanked");
  assert.deepEqual(blanked.map((e) => e.layer), ["salvage"], "salvage did not blank the links the file carried");
  assert.ok(!events.some((e) => e.event === "salvage-lane-no-target"), "the salvage lane still admitted a failure it could not repair");
  const delivered = JSON.parse(readFileSync(join(res.runDir, "findings.json"), "utf8"));
  for (const f of delivered.findings) assert.equal(f.source.resolved_link, "", `finding ${f.ordinal} still carries a foreign link`);
});
