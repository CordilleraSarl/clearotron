// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A FOREIGN RECORD LINK IS NAMED ONCE, FOR EVERY FINDING, AND SALVAGE BLANKS IT RATHER THAN FAIL THE RUN.
//
// R2 on 0.4.1-beta.1 (openai-agent × Signa) delivered no report. The synthesis seat copied each office's
// own page, which Signa's records carry, into `source.resolved_link` on eleven findings. Signa publishes no
// page per record, so the findings gate refused every one. It named one finding per refusal, so each
// attempt fixed one and the attempts ran out. Then the salvage lane took the refusal and found nothing it
// could repair. These arms hold both halves:
//   · one refusal carries every offending ordinal in its token, and the gate's own sentence after it;
//   · salvage blanks a foreign link, re-checks with the stage's own gate, and the run delivers.
// The mock run's register is corsearch (scripts/test-run.mjs declares it for every suite), so an office
// page on another host is foreign there exactly as it is on Signa.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseFindingsJson, blankForeignRecordLinks } from "../findings-model.mjs";
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

test("a seat that keeps writing office links into record links still delivers: salvage blanks them", async () => {
  assert.ok(recordOriginsFor(process.env.CLEAROTRON_DATABASE ?? "").length > 0 || process.env.CLEAROTRON_DATABASE,
    "precondition: the suite names a register, so the host gate is live");
  const PL = await import("../pipeline.mjs");
  process.env.MOCK_VERDICT = "CLEAR";
  process.env.MOCK_SKEPTIC = "no flags surfaced";
  process.env.MOCK_FINDINGS_N = "3";
  process.env.MOCK_FOREIGN_LINK = "1";
  try {
    const job = { id: "job-TMPFLINK", msgId: "<tmpflink@x>", forwarder: "jordan", forwarderDomain: "example.com",
      ref: "TMPFLINK", markName: "MARK TMPFLINK", classes: [9], provider: "corsearch" };
    const res = await PL.pipeline(job);
    assert.equal(res.ok, true, `the run did not deliver: ${JSON.stringify(res).slice(0, 400)}`);
    const events = readFileSync(driverDir(res.runDir, "run.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
    const blanked = events.find((e) => e.event === "foreign-record-links-blanked");
    assert.ok(blanked, "no row records that the driver blanked the links");
    assert.deepEqual(blanked.ordinals, [1, 2, 3]);
    assert.ok(!events.some((e) => e.event === "salvage-lane-no-target"), "the salvage lane still admitted a failure it could not repair");
    const delivered = JSON.parse(readFileSync(join(res.runDir, "findings.json"), "utf8"));
    for (const f of delivered.findings) assert.equal(f.source.resolved_link, "", `finding ${f.ordinal} still carries a foreign link`);
    const kept = JSON.parse(readFileSync(driverDir(res.runDir, "foreign-record-links.json"), "utf8"));
    assert.deepEqual(kept.blanked.map((b) => b.was), [OFFICE(1), OFFICE(2), OFFICE(3)], "the originals are not kept beside the run");
    assert.ok(existsSync(join(ROOT, "pool")), "nothing was published");
  } finally {
    for (const k of ["MOCK_VERDICT", "MOCK_SKEPTIC", "MOCK_FINDINGS_N", "MOCK_FOREIGN_LINK"]) delete process.env[k];
  }
});
