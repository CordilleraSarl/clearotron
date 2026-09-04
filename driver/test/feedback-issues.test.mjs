// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// feedback-issues.test.mjs — one flag, one issue, nothing decided.
//
// Two properties, and the second matters more than the first:
//   1. A triager can find the exact finding and its run evidence from the issue alone.
//   2. NOTHING is triaged. No status label, no severity, no reading of what the lawyer meant.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { issueForFlag, BASE_LABELS, REQUIRED_LABELS } from "../feedback-issues.mjs";
import { mintPending, isPending } from "../feedback-mint.mjs";
import { appendFlag } from "../feedback-store.mjs";

const FLAG = {
  id: "11111111-2222-3333-4444-555555555555",
  verdict: "bad",
  why: "The citation does not show use of the cited mark on these goods.",
  capturedBy: "lawyer@example.test",
  capturedAt: "2026-08-04T09:00:00.000Z",
  locator: { ordinal: 3, mark: "KURENA", band: "Manageable", disposition: "rebuttable", section: "03 Notable but manageable" },
  excerpt: "Distinguished as wholes on the filed goods.",
  run: {
    runId: "noref000036-petcary-2026-08-04-fixture", account: "petcary", matter: "m",
    markName: "VENZY", product: "global-preliminary-search", issuedAt: "2026-08-04T06:54:58.017Z",
    engineCommit: "cafe1234", runDir: "/pool/noref000036-petcary-2026-08-04-fixture",
  },
};

test("from the issue alone, a person finds the exact finding and its run evidence", () => {
  const { title, body } = issueForFlag(FLAG);
  assert.match(title, /^\[wrong\] KURENA · finding 3 — The citation does not show use/);
  assert.ok(title.length <= 120, "a title long enough to scan, short enough to list");
  // the lawyer's words, VERBATIM and first — a triager should be able to stop reading after this
  assert.ok(body.indexOf(FLAG.why) < body.indexOf("Debug handles"), "what the lawyer said comes first");
  assert.match(body, /lawyer@example\.test, 2026-08-04T09:00:00\.000Z/);
  // pointer PLUS excerpt (owner ruling) — triage must not require opening the VM to read one sentence
  assert.match(body, /> Distinguished as wholes on the filed goods\./);
  // the debug handles names
  assert.match(body, /noref000036-petcary-2026-08-04-fixture/);
  assert.match(body, /`cafe1234`/, "the engine build that produced the finding");
  assert.match(body, /`\/pool\/noref000036-petcary-2026-08-04-fixture`/, "the run directory");
  assert.match(body, /findings\[\]` where `ordinal == 3/, "the finding's row in report-data.json");
  assert.match(body, /11111111-2222-3333-4444-555555555555\.json/, "and the flag record itself");
});

test("NOTHING IS TRIAGED: no status label, no severity, no priority, no reading of the lawyer's words", () => {
  const bad = issueForFlag(FLAG);
  const good = issueForFlag({ ...FLAG, verdict: "good", why: "Exactly right — this is the one that matters." });
  for (const issue of [bad, good]) {
    // A flag is input for human triage in a design session, not buildable work. A status label would let
    // the dev agent pick one up, which is the failure names in as many words.
    assert.ok(!issue.labels.some((l) => l.startsWith("status:")), "no status label at mint");
    assert.ok(!issue.labels.some((l) => /severity|priority|P[0-3]|blocker/i.test(l)), "no severity or priority");
    assert.ok(!/severity|priority|likely cause|suggest|recommend|root cause/i.test(issue.body),
      "the body carries the flag and reads nothing into it");
    assert.match(issue.body, /Nothing here is triaged/, "and it says so, where a triager will see it");
  }
});

test("a good flag and a bad flag each produce a correctly labelled issue", () => {
  const bad = issueForFlag(FLAG);
  const good = issueForFlag({ ...FLAG, verdict: "good" });
  assert.deepEqual(bad.labels, [...BASE_LABELS, "feedback:bad"]);
  assert.deepEqual(good.labels, [...BASE_LABELS, "feedback:good"]);
  assert.match(bad.title, /^\[wrong\]/);
  assert.match(good.title, /^\[right\]/, "good flags are not framed as defects");
  assert.deepEqual(
    REQUIRED_LABELS.map((l) => l.name).sort(),
    ["area:report", "feedback:bad", "feedback:good", "source:report-feedback"],
    "the four labels this feature needs, declared in one place so --ensure-labels cannot drift from the minter",
  );
  // Every label the minter applies must be one the label creator knows how to create — both directions,
  // so a new label cannot ship half-wired.
  const declared = new Set(REQUIRED_LABELS.map((l) => l.name));
  for (const l of [...bad.labels, ...good.labels]) assert.ok(declared.has(l), `${l} is applied but never declared`);
});

test("the area label is CONSTANT, because choosing a narrower one per flag would be triage", () => {
  const shipping = issueForFlag({ ...FLAG, why: "The register link 404s." });
  const reasoning = issueForFlag({ ...FLAG, why: "The band is wrong — this should be Severe." });
  assert.deepEqual(shipping.labels, reasoning.labels,
    "two flags describing different kinds of defect get identical labels: the machine does not read them");
  assert.ok(shipping.labels.includes("area:report"));
});

test("the locator table warns that the ordinal moves — a triager must not trust it silently", () => {
  const { body } = issueForFlag(FLAG);
  assert.match(body, /\| Finding \| 3 \|/);
  assert.match(body, /\| Mark \| KURENA \|/);
  assert.match(body, /\| Band \| Manageable \|/);
  assert.match(body, /\| Disposition \| rebuttable \|/);
  assert.match(body, /renumbered on every republish/, "and says why the other three rows are there");
});

test("a flag with no excerpt or no engine build says so rather than rendering a blank row", () => {
  const thin = issueForFlag({ id: "x", verdict: "bad", why: "wrong", runId: "r", locator: {}, run: {} });
  assert.match(thin.body, /_The run carried no excerpt/);
  assert.match(thin.body, /published before the build stamp/);
  assert.match(thin.body, /\| Finding \| — \|/);
  assert.match(thin.title, /^\[wrong\] unknown mark · the report/);
});

test("a why containing a code fence cannot break out of its own block", () => {
  const { body } = issueForFlag({ ...FLAG, why: "```\nnot my markdown\n```" });
  assert.match(body, /````/, "the fence grows past the content rather than being closed by it");
});

// ── the drain ────────────────────────────────────────────────────────────────────────────────────────

test("EXACTLY ONCE: a minted flag is stamped and never minted again", async () => {
  const d = mkdtempSync(join(tmpdir(), "mint-"));
  appendFlag(d, { runId: "r1", verdict: "bad", why: "first" });
  appendFlag(d, { runId: "r2", verdict: "good", why: "second" });
  let n = 100;
  const createIssue = async () => ({ number: ++n, url: `https://x/issues/${n}` });

  const first = await mintPending({ dir: d, createIssue, now: () => "2026-08-04T10:00:00Z" });
  assert.equal(first.minted.length, 2);
  assert.equal(first.skipped, 0);
  const stamped = readdirSync(d).map((f) => JSON.parse(readFileSync(join(d, f), "utf8")));
  assert.deepEqual(stamped.map((f) => f.issue.number).sort(), [101, 102]);
  assert.equal(stamped[0].issue.mintedAt, "2026-08-04T10:00:00Z");
  assert.ok(!stamped.some(isPending));

  // The property, stated as the second run: nothing new, nothing duplicated.
  const second = await mintPending({ dir: d, createIssue });
  assert.equal(second.minted.length, 0, "a second drain mints nothing");
  assert.equal(second.skipped, 2);
  assert.equal(n, 102, "and calls GitHub not once more");
  rmSync(d, { recursive: true, force: true });
});

test("a flag whose mint FAILS stays unstamped and is retried — a lost flag is worse than a duplicate", async () => {
  const d = mkdtempSync(join(tmpdir(), "mint2-"));
  appendFlag(d, { runId: "r1", verdict: "bad", why: "will fail once" });
  const logs = [];
  let attempt = 0;
  const flaky = async () => { if (++attempt === 1) throw new Error("502 from GitHub"); return { number: 7, url: "u" }; };

  const first = await mintPending({ dir: d, createIssue: flaky, log: (m) => logs.push(m) });
  assert.equal(first.minted.length, 0);
  assert.equal(first.failed.length, 1);
  assert.match(logs.join("\n"), /FAILED .*502 from GitHub/, "and it says which flag and why");
  assert.ok(isPending(JSON.parse(readFileSync(join(d, readdirSync(d)[0]), "utf8"))), "unstamped, so it comes back");

  const second = await mintPending({ dir: d, createIssue: flaky });
  assert.equal(second.minted.length, 1);
  assert.equal(second.minted[0].issue.number, 7);
  rmSync(d, { recursive: true, force: true });
});

test("a creator that returns no issue number is a FAILURE, not a silent success", async () => {
  const d = mkdtempSync(join(tmpdir(), "mint3-"));
  appendFlag(d, { runId: "r1", verdict: "bad", why: "x" });
  const res = await mintPending({ dir: d, createIssue: async () => ({ url: "https://x/issues/?" }) });
  assert.equal(res.minted.length, 0);
  assert.equal(res.failed.length, 1);
  assert.ok(isPending(JSON.parse(readFileSync(join(d, readdirSync(d)[0]), "utf8"))), "it will be retried");
  rmSync(d, { recursive: true, force: true });
});

test("a corrupt file in the store does not stop the drain", async () => {
  const d = mkdtempSync(join(tmpdir(), "mint4-"));
  writeFileSync(join(d, "aaa.json"), "{ half a fi");
  appendFlag(d, { runId: "r1", verdict: "bad", why: "still minted" });
  const res = await mintPending({ dir: d, createIssue: async () => ({ number: 9, url: "u" }) });
  assert.equal(res.minted.length, 1, "the readable flag is still carried");
  assert.equal(res.skipped, 1);
  rmSync(d, { recursive: true, force: true });
});

test("an empty or missing store is a clean no-op, never a throw", async () => {
  const d = mkdtempSync(join(tmpdir(), "mint5-"));
  assert.deepEqual(await mintPending({ dir: d, createIssue: async () => ({ number: 1 }) }), { minted: [], failed: [], skipped: 0 });
  assert.deepEqual(await mintPending({ dir: join(d, "nope"), createIssue: async () => ({ number: 1 }) }), { minted: [], failed: [], skipped: 0 });
  rmSync(d, { recursive: true, force: true });
});

// ── — the row-finding instruction has to name a path this run actually has ─────────────────────
test("#487 a knockout flag points at marks[].findings[] by its printed key, not at a flat findings[]", () => {
  const koFlag = {
    ...FLAG,
    locator: { ordinal: 1, ref: "AURORA BLUE #1", searchedMark: "AURORA BLUE", mark: "BLUE AURORA", band: "Manageable", disposition: null, section: null },
  };
  const body = issueForFlag(koFlag).body;
  assert.match(body, /\| Finding row \| `AURORA BLUE #1` — `report-data\.json` → `marks\[\]\.findings\[\]` \|/,
    "the key the report page and the workbook both print, and the shape this lane actually writes");
  assert.doesNotMatch(body, /findings\[\]` where `ordinal ==/,
    "the clearance instruction would send a triager to a key that is not in a knockout file — and on a batch, to several rows");

  // The clearance lane keeps the instruction it always had.
  const clBody = issueForFlag(FLAG).body;
  assert.match(clBody, /\| Finding row \| `report-data\.json` → `findings\[\]` where `ordinal == 3` \|/);
});
