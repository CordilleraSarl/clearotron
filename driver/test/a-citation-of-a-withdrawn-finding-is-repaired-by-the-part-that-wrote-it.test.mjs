// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// @tier full — drives the pre-delivery repair end to end on the mock pipeline, on both engines, with invented names
//
// A CITATION OF A WITHDRAWN FINDING IS REPAIRED BY THE PART THAT WROTE IT.
//
// Measured in testing, 2026-10-28: the review withdrew two findings, and the delivered report still cited both. All three
// answers of the summary panel cited one of them, and the overview's methodology named the other by its number. Neither
// has a card, so each citation led the reader nowhere. The delivery check found both and its repair sent neither
// anywhere: the panel's check was marked structural, because a report re-emit cannot change the record, and the
// reference check was marked structural, because it read the overview's methodology as code-built action lines. The
// writer's repair, which can change the record, had run for another fault.
//
// Now the panel's citation of a withdrawn finding goes to the writer's repair, in the writer's numbering, and a citation
// of a withdrawn or absent finding in the overview's own prose goes to the overview's. Each repair is handed its ruled
// line, and the findings neither repair was asked to change stay as they were.
//
// The scenarios, from mock knobs: three findings, the third withdrawn on every save (MOCK_RECORD_WITHDRAWS). The four
// answers cite it on every whole save, and the writer's delivery-check repair sends one patch carrying the corrected
// answers alone, as its repair message orders (MOCK_ANSWERS_CITE). The overview's first
// rendering cites it by number, and a later rendering is clean (MOCK_OVERVIEW_CITES). On that run the actions carry one
// condition, so the report has the section the reference check reads, and the run is conditional.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, chmodSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pinEnv, envFrom } from "../../shared/env-aliases.mjs";
import { driverDir } from "../../shared/driver-dir.mjs";
import { overviewCitationFault, writersCitationFaults } from "../repair-targets.mjs";
import { foldRecord, keptModelOrdinal } from "../record-fold.mjs";
import { fourAnswersCoherenceChecks } from "../predelivery-lint.mjs";
import { synthesisFindings } from "./mock-stage-fixtures.mjs";

const TEMP_DIRS = [];
const tempDir = (prefix) => { const d = mkdtempSync(join(tmpdir(), prefix)); TEMP_DIRS.push(d); return d; };
after(() => { for (const d of TEMP_DIRS) rmSync(d, { recursive: true, force: true }); });

const HERE = dirname(fileURLToPath(import.meta.url));
const CLAUDE = join(HERE, "mock-claude.mjs");
const CODEX = join(HERE, "mock-codex.mjs");
chmodSync(CLAUDE, 0o755);
chmodSync(CODEX, 0o755);
pinEnv(process.env, "CLEAROTRON_REPORTS_URL", envFrom(process.env, "CLEAROTRON_REPORTS_URL") || "https://trademark.test");
process.env.CORSEARCH_SESSION_KEY ||= "test-offline";
process.env.CLEAROTRON_PLAN_DISPATCH ||= "off";
process.env.CLEAROTRON_BAND_TRUTH_GATE ||= "0";
process.env.CLEAROTRON_REGISTER_GAP_CLAMP ||= "0";
process.env.CLEAROTRON_SATPROBE_CODESIDE ||= "0";

const JOB = {
  id: "test-job", msgId: "<test@x>", forwarder: "requester", forwarderDomain: "example.com",
  ref: "TMP8441", markName: "PROJECT NOVAPULSE", classes: [9, 41], provider: "corsearch",
};
const ENGINES = {
  claude: { CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: CLAUDE },
  codex: { CLEAROTRON_AI: "openai-agent", CLEAROTRON_CODEX_PATH: CODEX, CLEAROTRON_AI_BILLING: "api-key", CODEX_API_KEY: "sk-codex-dummy" },
};
const ENGINE_KEYS = ["CLEAROTRON_CLAUDE_PATH", "CLEAROTRON_CODEX_PATH", "CLEAROTRON_AI_BILLING", "CODEX_API_KEY"];
const MOCK_KNOBS = ["MOCK_VERDICT", "MOCK_SKEPTIC", "MOCK_FINDINGS_N", "MOCK_ACTIONS", "MOCK_RECORD_WITHDRAWS", "MOCK_ANSWERS_CITE", "MOCK_OVERVIEW_CITES"];
const SCENARIO = { MOCK_VERDICT: "CLEAR", MOCK_SKEPTIC: "no flags surfaced", MOCK_FINDINGS_N: "3", MOCK_RECORD_WITHDRAWS: "3" };

async function runPipeline(engine, knobs) {
  const root = tempDir("clearotron-withdrawn-cite-");
  for (const k of [...MOCK_KNOBS, ...ENGINE_KEYS]) delete process.env[k];
  for (const [k, v] of Object.entries({ ...ENGINES[engine], CLEAROTRON_WORK_DIR: root, CLEAROTRON_REPORTS_DIR: join(root, "pool"),
    CLEAROTRON_MAX_RETRIES: "0", CLEAROTRON_RECOVERY_MAX: "0", ...knobs })) pinEnv(process.env, k, v);
  const { pipeline } = await import(`../pipeline.mjs?bust=${Math.random()}`);
  const res = await pipeline({ ...JOB });
  const events = readFileSync(driverDir(res.runDir, "run.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  return { res, events, root };
}

// The two ruled lines, with this scenario's finding filled in.
const WRITER_LINE = "Your text cites finding 3, which the review withdrew. Remove that citation. Check the affected statement against the surviving assessment, and correct or remove it if unsupported. Keep unaffected text unchanged.";
const OVERVIEW_LINE = "References: finding 3 (withdrawn). The listed references point to findings that have been withdrawn or are absent. Reassess the affected answers, actions, and conclusions against the surviving findings. Cite a surviving finding only where its evidence supports the statement; otherwise correct the statement. Preserve unaffected work and record the corrections through the existing correction tool.";
const saved = (runDir, name) => JSON.parse(readFileSync(driverDir(runDir, "synthesis-calls", name), "utf8")).params.findings;

const dispatches = (runDir, stage) => readdirSync(driverDir(runDir)).filter((f) => f.startsWith(`${stage}.attempt`) && f.includes(".dispatch.txt"))
  .map((f) => readFileSync(driverDir(runDir, f), "utf8"));
const repairsAfter = (events, at) => events.slice(at).filter((e) => e.event === "stage" && e.trigger === "lint-repair").map((e) => e.stage);

for (const engine of Object.keys(ENGINES)) {
  test(`${engine}: the summary panel citing a withdrawn finding goes to the writer's repair, which re-cites it`, async () => {
    const { res, events, root } = await runPipeline(engine, { ...SCENARIO, MOCK_ANSWERS_CITE: "1,3" });
    // CONTROLS — the scenario is the one described.
    const lintFailed = events.findIndex((e) => e.event === "predelivery-lint-failed");
    assert.ok(lintFailed >= 0 && events[lintFailed].failures.includes("four-answers-ordinals"),
      "the delivery check did not find the panel citing the withdrawn finding");
    // THE CLAIMS.
    const targets = events.find((e) => e.event === "report-repair-targets");
    assert.deepEqual([targets?.record, targets?.overview], [["four-answers-ordinals"], []],
      "the panel's fault was not placed in the writer's record alone");
    assert.deepEqual(repairsAfter(events, lintFailed), ["synthesis"], "the repair did not go to the writer alone");
    const msg = dispatches(res.runDir, "synthesis").find((m) => m.includes("The deterministic pre-delivery checks found these faults"));
    assert.ok(msg, "the writer's repair was not sent its own opening");
    assert.ok(msg.split("\n").includes(`- ${WRITER_LINE}`), "the writer was not handed its ruled line for the withdrawn finding");
    const receipt = JSON.parse(readFileSync(driverDir(res.runDir, "predelivery-lint.json"), "utf8"));
    assert.ok(!receipt.failures.includes("four-answers-ordinals"), "the delivery check still finds the panel citing the withdrawn finding");
    const before = saved(res.runDir, "accepted-before-repair.json"), after = saved(res.runDir, "accepted.json");
    assert.deepEqual(after.findings, before.findings, "the writer's correction of the panel changed findings it was not asked to change");
    assert.deepEqual([before.four_answers.third_party_rights.ordinals, after.four_answers.third_party_rights.ordinals], [[1, 3], [1]]);
    const { runId } = JSON.parse(readFileSync(join(res.runDir, "status.json"), "utf8"));
    const data = JSON.parse(readFileSync(join(root, "pool", runId, "report-data.json"), "utf8"));
    assert.deepEqual(data.fourAnswers?.third_party_rights?.ordinals, [1], "the delivered panel still cites the withdrawn finding: the writer's patch was refused or never sent");
    assert.equal(res.ok, true, JSON.stringify(res));
  });

  test(`${engine}: the overview citing a withdrawn finding by its number goes to the overview's repair, which removes it`, async () => {
    const { res, events } = await runPipeline(engine, { ...SCENARIO, MOCK_VERDICT: "CONDITIONAL", MOCK_ACTIONS: "condition", MOCK_OVERVIEW_CITES: "3" });
    const lintFailed = events.findIndex((e) => e.event === "predelivery-lint-failed");
    assert.ok(lintFailed >= 0 && events[lintFailed].failures.includes("reference-integrity"),
      "the delivery check did not find the overview's citation");
    const targets = events.find((e) => e.event === "report-repair-targets");
    assert.deepEqual([targets?.overview, targets?.record], [["reference-integrity"], []], "the citation was not placed in the overview");
    assert.deepEqual(repairsAfter(events, lintFailed), ["report-overview"], "the repair did not go to the overview alone");
    const msg = dispatches(res.runDir, "report-overview").find((m) => m.includes("the deterministic pre-delivery lint failed these checks"));
    assert.ok(msg, "the overview's repair was not sent");
    assert.ok(msg.split("\n").includes(`- ${OVERVIEW_LINE}`), "the overview was not handed its ruled line for the citation");
    assert.ok(!/\bFinding 3\b/.test(readFileSync(join(res.runDir, "report.md"), "utf8")), "the delivered report still cites the withdrawn finding");
    assert.deepEqual(JSON.parse(readFileSync(join(res.runDir, "findings.json"), "utf8")).findings, saved(res.runDir, "accepted.json").findings,
      "the overview's correction reached the findings record");
    // The email's check also reads the condition's party, which only the cards introduce: an older fault, and not this one.
    const receipt = JSON.parse(readFileSync(driverDir(res.runDir, "predelivery-lint.json"), "utf8"));
    assert.ok(!receipt.failures.includes("reference-integrity"), "the delivery check still finds the citation");
    assert.ok(!receipt.checks.some((c) => /^reference-integrity/.test(c.id) && /\bFinding 3\b/.test(c.detail ?? "")), "a check still names the citation");
    assert.equal(res.ok, true, JSON.stringify(res));
  });
}

// What the overview is handed, and what it is not.
const FINDINGS = [{ ordinal: 1, disposition: "adversarial" }, { ordinal: 2, disposition: "adversarial" }, { ordinal: 3, disposition: "withdrawn" }];
const OVERVIEW = "# Methodology\n\nFinding 3 remains open. Finding 2 is the main obstacle. Finding 9 was not searched.";
const failure = (id, orphans) => ({ id, family: "reference", surface: id.endsWith(":email") ? "email" : "report", pass: false, structural: true, orphans });

test("a citation of a withdrawn or absent finding is the overview's, once; a live finding's and a party's are not", () => {
  const got = overviewCitationFault([
    failure("reference-integrity", ["Finding 3", "Finding 2", "Finding 9", "Brannick Tooling"]),
    failure("reference-integrity:email", ["Finding 3"]),
  ], { overview: OVERVIEW, findings: FINDINGS });
  assert.deepEqual(got?.cites, [{ ordinal: 3, withdrawn: true }, { ordinal: 9, withdrawn: false }]);
  assert.equal(got.detail, OVERVIEW_LINE.replace("finding 3 (withdrawn).", "finding 3 (withdrawn); finding 9 (absent)."));
});

test("a citation the overview's own prose does not hold is not the overview's", () => {
  assert.equal(overviewCitationFault([failure("reference-integrity", ["Finding 3"])], { overview: "# Methodology\n\nNothing cited.", findings: FINDINGS }), null);
  assert.equal(overviewCitationFault([failure("reference-integrity", ["Finding 3"])], { overview: null, findings: FINDINGS }), null);
});

test("the writer is handed one ruled line per withdrawn finding, in its own numbering, and none for a finding the run lacks", () => {
  const fault = { id: "four-answers-ordinals", register: "four_answers", detail: "delivered numbering", cites: [
    { answer: "registrability", ordinal: 2, withdrawn: true }, { answer: "third_party_rights", ordinal: 2, withdrawn: true },
    { answer: "registrability", ordinal: 7, withdrawn: false }] };
  const got = writersCitationFaults(fault, (o) => ({ 2: 3 })[o] ?? null);
  assert.deepEqual(got.map((f) => f.detail), [WRITER_LINE], "one line for the withdrawn finding, in the writer's number, and none for the absent one");
  assert.equal(got[0].finding, undefined, "the line is not named by a finding as well, which would repeat the number");
  const plain = { id: "scope-numbers-in-prose", detail: "x" };
  assert.deepEqual(writersCitationFaults(plain, () => 1), [plain], "a fault no register holds is left as it is");
});

test("a panel citing only findings the run lacks stays a flag: the writer's line is for a withdrawn one", () => {
  const c = fourAnswersCoherenceChecks({ fourAnswers: { third_party_rights: { token: "moderate", ordinals: [1, 9] } },
    findings: [{ ordinal: 1, disposition: "adversarial", band: "High" }], verdictDoc: null }).find((x) => x.id === "four-answers-ordinals");
  assert.deepEqual([c.pass, c.structural, c.register], [false, true, undefined]);
});

test("a withdrawn finding the fold renumbered is named to the writer by the number its record carries", () => {
  // The first two findings are two filings of one conflict, so the fold keeps three: 1 and 2 become 1, the withdrawn 3
  // becomes 2, and 4 becomes 3.
  const doc = JSON.parse(synthesisFindings(null));
  const base = doc.findings[0];
  const rows = [["Qorvalen Holdings", "VELTRIN"], ["Qorvalen Holdings", "VELTRIN"], ["Brannick Tooling", "ORVANTE"], ["Selmora Labs", "KESTRIN"]];
  doc.findings = rows.map(([owner, mark], i) => {
    const f = structuredClone(base);
    f.ordinal = i + 1;
    f.mark = mark;
    f.owner.name = owner;
    f.owner.registrations[0].uri = `/mark/us/9400000${i + 1}`;
    if (f.meters?.mark_similarity) f.meters.mark_similarity.source = f.owner.registrations[0].uri;
    return f;
  });
  Object.assign(doc.findings[2], { disposition: "withdrawn", withdrawn_reason: "The review flag on this invented finding withdrew it." });
  doc.four_answers = { third_party_rights: { token: "moderate", ordinals: [3, 4] } };
  const { doc: folded, map, merges } = foldRecord(doc);
  const fault = fourAnswersCoherenceChecks({ fourAnswers: folded.four_answers, findings: folded.findings, verdictDoc: null })
    .find((c) => c.id === "four-answers-ordinals");
  assert.deepEqual(fault.cites, [{ answer: "third_party_rights", ordinal: 2, withdrawn: true }], "the check did not judge the delivered numbering");
  assert.deepEqual(writersCitationFaults(fault, (o) => keptModelOrdinal({ map, merges }, o)).map((f) => f.detail), [WRITER_LINE]);
});
