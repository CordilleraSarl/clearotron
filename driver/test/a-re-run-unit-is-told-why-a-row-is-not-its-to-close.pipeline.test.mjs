// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A RE-RUN UNIT IS TOLD WHY A ROW IS NOT ITS TO CLOSE, IN THE REVIEW'S OWN WORDS.
//
// A unit the review re-runs, or the envelope re-opens, is handed the rows on its axis that a re-run cannot close, and
// told to leave them as they are. It was told the provider cannot express those slices, which was the only reason a row
// was held. A row is now also held when no question is left to send, and a unit the review re-ran for a flagged row was
// handed such a row under the provider's reason. Both follow-ups now name the same kinds as the review's table and its
// manual. Driven through the mock pipeline for the review's re-run; every mark is invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, chmodSync, readFileSync, readdirSync, mkdirSync, writeFileSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { driverDir } from "../../shared/driver-dir.mjs";
import { pinEnv, envFrom } from "../../shared/env-aliases.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLAUDE = join(HERE, "mock-claude.mjs");
chmodSync(CLAUDE, 0o755);
pinEnv(process.env, "CLEAROTRON_REPORTS_URL", envFrom(process.env, "CLEAROTRON_REPORTS_URL") || "https://trademark.test");
process.env.CORSEARCH_SESSION_KEY ||= "test-offline";
process.env.CLEAROTRON_PLAN_DISPATCH ||= "off";
process.env.CLEAROTRON_BAND_TRUTH_GATE ||= "0";
process.env.CLEAROTRON_REGISTER_GAP_CLAMP ||= "0";
process.env.CLEAROTRON_SATPROBE_CODESIDE ||= "0";
const PROFILES = mkdtempSync(join(tmpdir(), "clearotron-profiles-"));
cpSync(join(HERE, "..", "profiles"), PROFILES, { recursive: true });
mkdirSync(join(PROFILES, "projects", "demo-brand-owner"), { recursive: true });
writeFileSync(join(PROFILES, "projects", "demo-brand-owner", "japan-and-korea-app-launch.json"),
  JSON.stringify({ projectName: "Japan and Korea app launch", platforms: ["store.steampowered.com"] }, null, 2) + "\n");
pinEnv(process.env, "CLEAROTRON_CUSTOMERS_DIR", PROFILES);

const JOB = { id: "test-job", msgId: "<test@x>", forwarder: "jordan", forwarderDomain: "example.com",
  ref: "TMP-2207", markName: "NOVAPULSE", classes: [9, 41], provider: "corsearch" };

const { NOT_CLOSEABLE_KINDS, escalationHeldNote, envelopeHeldNote } = await import("../pipeline.mjs");
const ROWS = [{ unit: "primary-sweep / owner reading", reason: "not run" }];

async function run(env) {
  const root = mkdtempSync(join(tmpdir(), "clearotron-mock-"));
  for (const [k, v] of Object.entries({ CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE, CLEAROTRON_WORK_DIR: root,
    CLEAROTRON_REPORTS_DIR: join(root, "pool"), CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0", ...env }))
    pinEnv(process.env, k, v);
  const { pipeline } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  const res = await pipeline({ ...JOB }, {});
  const events = readFileSync(driverDir(res.runDir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  return { res, events };
}

test("both re-run follow-ups and the review's manual name the kinds the review's table names", () => {
  for (const [note, lead] of [[escalationHeldNote, "NOT YOURS TO CLOSE — a re-run cannot close these: "],
    [envelopeHeldNote, "These rows on this axis are NOT yours to close and must stay exactly as they are — a re-run cannot close them: "]]) {
    const text = note(ROWS);
    assert.ok(text.includes(lead + NOT_CLOSEABLE_KINDS + "."), `a follow-up gives another reason: ${text}`);
    assert.ok(text.includes("| primary-sweep / owner reading | deferred | not run |"), "the row is not listed");
    assert.doesNotMatch(text, /cannot express (these|those) slices at all/, "a follow-up still gives the provider as the only reason");
    assert.equal(note([]), "", "a follow-up names rows when there are none");
  }
  // The manual names the provider's kind with its examples in brackets, then the rest in the same words.
  const manual = readFileSync(join(HERE, "..", "skills", "clearance-search", "phase2-execution.md"), "utf8").replace(/\s+/g, " ");
  const [provider, rest] = NOT_CLOSEABLE_KINDS.split(", the envelope close");
  assert.ok(manual.includes(provider.replace(/^the provider/, "the active provider")) && manual.includes("the envelope close" + rest),
    "the review's manual names other kinds");
});

test("a unit the review re-runs for a flagged row is told a row with nothing left to send is not its to close, and why", async () => {
  // primary-sweep holds a confirmed-clean row the review flags, and the seat's own deferred row (MOCK_SEAT_DEFERS): the
  // run's plan-execution receipt covers the axis with no question missing, so a re-run has nothing to send for that row.
  try {
    const { res } = await run({ MOCK_VERDICT: "CLEAR", MOCK_SEAT_DEFERS: "primary-sweep",
      MOCK_SKEPTIC: "- primary-sweep worldwide sweep looks thin\n\n## Escalation decisions\nESCALATE: primary-sweep — re-check the worldwide sweep" });
    assert.equal(res.ok, true, JSON.stringify(res));
    const prompts = readdirSync(driverDir(res.runDir)).filter((f) => /\.dispatch\.txt(\.prev-[0-9a-f]+)?$/.test(f))
      .map((f) => readFileSync(driverDir(res.runDir, f), "utf8")).filter((t) => t.includes("NOT YOURS TO CLOSE"));
    assert.equal(prompts.length, 1, "the review's re-run was not dispatched with the rows it must leave");
    assert.ok(prompts[0].includes("NOT YOURS TO CLOSE — a re-run cannot close these: " + NOT_CLOSEABLE_KINDS),
      "the re-run unit was given another reason");
    assert.match(prompts[0], /\| primary-sweep \/ owner reading \| deferred \| not run \|/, "the row with nothing left to send was not named");
  } finally { delete process.env.MOCK_SEAT_DEFERS; }
});
