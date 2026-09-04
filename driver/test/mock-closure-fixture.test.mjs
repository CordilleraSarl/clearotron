// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// PR-11 — the mock engine's doubt-closure fixture. The mock used to fall through to "# mock output",
// so every mock e2e failed the closure stage's validator and NEITHER applyClosure nor applyAskClosure
// ran. This proves the fixture speaks the dictated grammar AND that its citations verify
// against the real files, so a mock run now exercises the guard for real.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { doubtClosureFixture } from "./mock-stage-fixtures.mjs";
import { parseClosureLines, applyClosure } from "../doubt-ledger.mjs";
import { parseAskClosureLines, applyAskClosure } from "../ask-ledger.mjs";

const SPINE = "# Register findings — Mark: NOVAPULSE\n\n### Risk-relevant findings\nThe primary sweep enumerated the in-class band to has_more false with no identical live mark.\n";

function seed() {
  const d = mkdtempSync(join(tmpdir(), "mock-closure-"));
  mkdirSync(driverDir(d), { recursive: true });
  writeFileSync(join(d, "register-findings.md"), SPINE);
  writeFileSync(join(d, "findings.json"), JSON.stringify({ schema_version: 5, findings: [] }, null, 2));
  writeFileSync(driverDir(d, "register-coverage-ledger.json"), JSON.stringify({ rows: [] }, null, 2));
  return d;
}
const msgFor = (d, doubtIds, askIds) => [
  "A finished trademark clearance run recorded open questions.",
  "Evidence files — the ONLY files you may cite (read them):",
  `- findings.json: ${join(d, "findings.json")}`,
  `- register-findings.md: ${join(d, "register-findings.md")}`,
  `- register-coverage-ledger.json: ${driverDir(d, "register-coverage-ledger.json")}`,
  ...(doubtIds.length ? ["THE OPEN DOUBTS:", ...doubtIds.map((id) => `- ${id} — subject: NOVAPULSE — born in register-findings.md: "a quote"`)] : []),
  ...(askIds.length ? ["THE OPEN ASKS (machine questions):", ...askIds.map((id) => `- ${id} — [frame-diff] sweep it or say why not`)] : []),
].join("\n");

const openDoubt = (id) => ({ id, birth: { place: "gather-crosscheck", artifact: "common-law-findings.md", quote: "q" }, subject: { terms: ["NOVAPULSE"] }, status: "open", ending: null });
const openAsk = (id) => ({ ask_id: id, born: { place: "frame-diff", artifact: "_driver/frame-reopen.json", ref: "r", ts: null }, ask: { text: "sweep it or say why not", owner: "register", structured: null }, qids: [], ending: null, handoff: null });

test("mock doubt-closure fixture: emits the dictated grammar and its citations VERIFY against the real files", () => {
  const d = seed();
  const doubts = ["doubt:crosscheck:a:1", "doubt:crosscheck:b:2"].map(openDoubt);
  const asks = ["ask:frame:one", "ask:frame:two"].map(openAsk);
  // DRIVEN DIRECTLY at conversion 6. `fixture()` no longer has a doubt-closure.md branch — the driver
  // renders that artifact off the record call — so routing through it would fall to a later branch and
  // fail on a null dir. This test is the ARCHIVE witness now: an archived run's doubt-closure.md is a
  // hand-typed artifact, and the retired grammar must still parse for it to stay readable.
  const out = doubtClosureFixture(msgFor(d, doubts.map((x) => x.id), asks.map((x) => x.ask_id)));
  assert.match(out, /^(?:SETTLED|IMMATERIAL|OPEN)\s+\S+:/m, "speaks the shape the stage validator insists on");

  const fileTexts = { "register-findings.md": SPINE };
  const applied = applyClosure(doubts, parseClosureLines(out), fileTexts);
  assert.equal(applied.settledByStage, 1, "the first doubt settles on a verbatim quote");
  assert.equal(applied.unverified.length, 0, "and nothing is rejected — the fixture cites REAL text");
  assert.equal(applied.doubts.filter((x) => x.status === "open").length, 1, "the last row is left OPEN on purpose — an open row ships");

  const askOut = applyAskClosure(asks, parseAskClosureLines(out), fileTexts, { ts: "t" });
  assert.equal(askOut.immaterialByStage, 1);
  assert.equal(askOut.unverified.length, 0);
  assert.ok(askOut.asks.some((a) => a.ending === null), "the last ask ships OPEN with its handoff");
});

test("mock doubt-closure fixture: MOCK_CLOSURE_MODE=fabricate is REJECTED by the guard (rows stay open)", () => {
  const d = seed();
  const doubts = ["doubt:crosscheck:a:1"].map(openDoubt);
  process.env.MOCK_CLOSURE_MODE = "fabricate";
  try {
    const out = doubtClosureFixture(msgFor(d, ["doubt:crosscheck:a:1"], []));
    const applied = applyClosure(doubts, parseClosureLines(out), { "register-findings.md": SPINE });
    assert.equal(applied.settledByStage, 0, "an invented citation settles NOTHING");
    assert.equal(applied.unverified.length, 1, "and lands in unverified, loudly");
    assert.equal(applied.doubts[0].status, "open");
  } finally { delete process.env.MOCK_CLOSURE_MODE; }
});
