// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The CODE-authored failure packet: terminalKind-keyed honest copy, the
// machine's reason quoted VERBATIM in a <pre>, the repairs-attempted list, and the reply-lane fields
// (conversationId beside msgId). teal-causeway is the reference defect: its notice claimed a "systemic
// (credentials/provider/config)" cause for a deterministic 414 and never quoted the provider error.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { trackedFiles, skipReason } from "../../shared/tracked-files.mjs";   // — the guard scans the product tree
import { join } from "node:path";
import { buildFailurePacket } from "../pipeline.mjs";

const BASE = {
  runId: "tmp8729-open-country-teal-causeway", agent: "clawdi",
  job: { markName: "Open Country", forwarder: "requester", forwarderEmail: "r@example.com", msgId: "AAMkAGI2=", conversationId: "AAQkConv=" },
  failedStage: "fan-in", shortReason: "register plan unexecuted after direct dispatch + followup — 2 dictated qid(s) own no band block",
  reasonVerbatim: "register plan unexecuted after direct dispatch + followup — 2 dictated qid(s) own no band block: primary-sweep:exact:ailderness+form ← provider error: corsearch_search HTTP 414 <URI Too Long>",
  sig: "fan-in|abc123def456", priorAttempts: 0,
};

test("deterministic kind: says retry will not help, quotes the reason verbatim (escaped), lists repairs — never a systemic claim", () => {
  const p = buildFailurePacket({ ...BASE, failClass: "deterministic", terminalKind: "deterministic",
    repairs: [{ repair: "plan-direct-execute", target: "primary-sweep", outcome: "failed: HTTP 414 URI Too Long" }] });
  assert.match(p.emailBodyHtml, /retrying will not help/);
  assert.doesNotMatch(p.emailBodyHtml, /cause is systemic/);
  assert.match(p.emailBodyHtml, /The driver reported, verbatim:/);
  assert.match(p.emailBodyHtml, /HTTP 414 &lt;URI Too Long>/, "verbatim reason, HTML-escaped (< and & suffice for safety)");
  assert.match(p.emailBodyHtml, /What the machine already attempted:/);
  assert.match(p.emailBodyHtml, /plan-direct-execute → failed: HTTP 414/);
  assert.match(p.whatsappText, /\[deterministic\]/);
  assert.match(p.whatsappText, /retrying will not help/);
  assert.equal(p.conversationId, "AAQkConv=");
  assert.equal(p.failureSignature, "fan-in|abc123def456");
  assert.equal(p.terminalKind, "deterministic");
});

test("repeat-signature and factual kinds carry their own honest sentences", () => {
  const rep = buildFailurePacket({ ...BASE, terminalKind: "repeat-signature", priorAttempts: 1 });
  assert.match(rep.emailBodyHtml, /failed IDENTICALLY to the first attempt/);
  assert.match(rep.emailBodyHtml, /after <b>1 automatic recovery attempt<\/b>/, "singular, not 'attempts'");
  const fact = buildFailurePacket({ ...BASE, terminalKind: "factual" });
  assert.match(fact.emailBodyHtml, /a human decision, not a retry/);
  assert.match(fact.whatsappText, /needs human attention/);
});

test("exhausted kind keeps the systemic hypothesis but scoped honestly; unknown kind stays generic", () => {
  const ex = buildFailurePacket({ ...BASE, terminalKind: "exhausted", priorAttempts: 3 });
  assert.match(ex.emailBodyHtml, /Automatic recovery is exhausted after 3 attempts/);
  assert.match(ex.emailBodyHtml, /looks systemic \(provider\/environment\)/);
  const generic = buildFailurePacket({ ...BASE, terminalKind: undefined });
  assert.match(generic.emailBodyHtml, /stopped on a technical failure/);
  assert.ok(!generic.emailBodyHtml.includes("What the machine already attempted"), "no empty repairs section");
});

// ── client-started runs (2026-07-29 hardening) ──────────────────────────────────────────────────────
// The email lane routes to job.forwarderEmail; on a clientPrincipal run that address IS the client.
// Every client-facing LISTING already redacts the machine reason (sanitizeRunForClient /
// CLIENT_FAILURE_NOTE) — the failure email was the one client surface still quoting stack traces,
// absolute paths and provider error text verbatim.
test("clientPrincipal: the email carries a neutral notice — no stage, no verbatim reason, no repairs", () => {
  const p = buildFailurePacket({ ...BASE, job: { ...BASE.job, clientPrincipal: true },
    failClass: "deterministic", terminalKind: "deterministic",
    repairs: [{ repair: "plan-direct-execute", target: "primary-sweep", outcome: "failed: HTTP 414 URI Too Long" }] });
  assert.match(p.emailBodyHtml, /stopped before it finished/);
  assert.match(p.emailBodyHtml, /nothing was delivered/i);
  assert.doesNotMatch(p.emailBodyHtml, /fan-in|414|corsearch|FAILED at stage|verbatim|retrying/i,
    "machine internals never reach the client email");
  assert.doesNotMatch(p.subject, /FAILED/, "the subject stays factual, not alarming");
  // the packet FIELDS keep the full truth — status listings, telemetry and WhatsApp are staff surfaces
  assert.equal(p.reasonVerbatim, BASE.reasonVerbatim);
  assert.match(p.whatsappText, /FAILED at fan-in/);
  assert.equal(p.failed, true);
});

test("staff runs (no clientPrincipal) keep the verbatim machine-reason email exactly as before", () => {
  const p = buildFailurePacket({ ...BASE, failClass: "deterministic", terminalKind: "deterministic" });
  assert.match(p.emailBodyHtml, /The driver reported, verbatim/);
  assert.match(p.emailBodyHtml, /414/);
  assert.match(p.subject, /run FAILED, nothing delivered/);
});

// ---- the weather lane's own terminal (2026-07-29) ----------------------------------------------------

test("weather-exhausted: the notice says the PROVIDER stayed down, not that the run broke", () => {
  // A run that spends its whole weather ladder against an overloaded provider has failed no check of
  // its own. Sending it the generic "the cause looks systemic … not a bad sample" line, or anything
  // that reads as a defect, sends the reader hunting through artifacts that are fine.
  const p = buildFailurePacket({ ...BASE, failClass: "transient", terminalKind: "weather-exhausted",
    shortReason: "status_overloaded", reasonVerbatim: "status_overloaded", priorAttempts: 9 });
  assert.match(p.emailBodyHtml, /upstream provider stayed overloaded or unreachable/);
  assert.match(p.emailBodyHtml, /nothing in the run itself failed a check/);
  assert.match(p.emailBodyHtml, /Re-trigger once the provider is healthy/);
  assert.doesNotMatch(p.emailBodyHtml, /looks systemic/, "the generic exhaustion sentence is the wrong diagnosis here");
  assert.doesNotMatch(p.emailBodyHtml, /retrying will not help/, "waiting IS the remedy for weather — never tell the reader it is futile");
  // The lane split must not come apart in the copy: priorAttempts is the TOTAL across BOTH lanes, so
  // the weather sentence quotes no count of its own rather than passing 9 off as waiting attempts.
  assert.doesNotMatch(p.emailBodyHtml, /9 (in total|waiting)/);
  assert.match(p.emailBodyHtml, /after <b>9 automatic recovery attempts<\/b>/, "the honest total still appears, under its own name");
  assert.match(p.whatsappText, /\[weather-exhausted\]/, "the terminal kind is greppable on every lane");
  assert.match(p.whatsappText, /needs human attention/);
  assert.equal(p.terminalKind, "weather-exhausted");
});

// ---- (read side): a failed BATCH names every name that failed with it -----------------------------

test("#472 a multi-name knockout failure names all its names, in the run's own spelling", () => {
  // A 3-name knockout is ONE job, one run and one price. When it died, the only artifact the requester
  // received named one of the three and said NOTHING was delivered. Both honest readings cost money:
  // "IRONWHISK failed, so the other two came through" (they did not — nothing was published), or
  // "re-order IRONWHISK" (which re-runs one name and silently drops two).
  //
  // The asymmetry is what made it a defect rather than a house style: the SUCCESS packet from the same
  // lane has always said "(3 marks)", and the run's own status.json says "IRONWHISK +2 more". Only the
  // failure notice collapsed.
  const job = {
    markName: "IRONWHISK", forwarder: "requester", forwarderEmail: "r@example.com", msgId: "AAMk=",
    product: "knockout-search", ref: "TMP9100",
    marks: [{ name: "IRONWHISK" }, { name: "CLUVENDRA" }, { name: "SUNDAY ROAST CLUB" }],
  };
  const p = buildFailurePacket({ ...BASE, job, failedStage: "knockout-assess#0", terminalKind: "deterministic" });
  assert.equal(p.subject, "Knockout search — IRONWHISK +2 more — run FAILED, nothing delivered");
  // Every sentence a human reads, not only the subject — the WhatsApp line and the email body each
  // stated one name of three.
  assert.match(p.whatsappText, /Prelim search for IRONWHISK \+2 more FAILED/);
  assert.match(p.emailBodyHtml, /for <b>IRONWHISK \+2 more<\/b> FAILED/);
  // The client-facing wording carries it too — that lane is the one a requester reads.
  const client = buildFailurePacket({ ...BASE, job: { ...job, clientPrincipal: true }, terminalKind: "deterministic" });
  assert.match(client.emailBodyHtml, /for <b>IRONWHISK \+2 more<\/b> stopped before it finished/);
});

test("#472 a single-name job still says the name the requester TYPED, never a derived one", () => {
  // The composer's fallback rule, and the reason it is a fallback: `marks[]` carries the parsed name and
  // `markName` carries the typed one. A clearance admits one name (refused at the run door above one),
  // so this path must read byte-identically to what it did before.
  const p = buildFailurePacket({ ...BASE, terminalKind: "deterministic",
    job: { ...BASE.job, product: "global-preliminary-search", marks: [{ name: "OPEN COUNTRY" }] } });
  assert.match(p.subject, /^Global preliminary search — Open Country — run FAILED/);
  assert.doesNotMatch(p.subject, /\+\d+ more/);
  // And a job carrying no marks at all is unchanged — this is every clearance run in the archive.
  // BASE's job names no product either, so the subject leads with the mark alone, exactly as before.
  const bare = buildFailurePacket({ ...BASE, terminalKind: "deterministic" });
  assert.equal(bare.subject, "Open Country — run FAILED, nothing delivered");
  assert.match(bare.whatsappText, /Prelim search for Open Country FAILED/);
});

// ---- (enforcement check E11 in the family): the payload reaches the notice ------------------
// The common-law merge gate computes WHICH dictated connotation query dropped and hands it over as
// StageFailure.detail with the count as `quantity`. On E2E's preserved R1 run of 2026-08-13,
// `_driver/failure.json` carried reason / reasonVerbatim / failClass / terminalKind and no payload at
// all: the operator was told one query had dropped and never which one, and E2E had to replay
// findDroppedConnotationQueries against the run's own artifacts to name it.

const DROP_DETAIL = 'never executed, and a count-based connotation gate cannot see it (Project Sable" video game controversy)';

test("#862 the packet carries reasonDetail + reasonQuantity, and the staff email names the query", () => {
  const p = buildFailurePacket({ ...BASE, failedStage: "common-law", failClass: "deterministic",
    terminalKind: "deterministic", shortReason: "merged half-grids dropped 1 dictated connotation query",
    reasonVerbatim: "merged half-grids dropped 1 dictated connotation query",
    reasonDetail: DROP_DETAIL, reasonQuantity: 1 });
  assert.equal(p.reasonDetail, DROP_DETAIL, "the payload is a packet FIELD, readable without an artifact replay");
  assert.equal(p.reasonQuantity, 1);
  assert.match(p.emailBodyHtml, /Which one \(1\):/);
  assert.match(p.emailBodyHtml, /Project Sable" video game controversy/, "the staff body names the query");
  // — the payload rides BESIDE the sentence, never inside it. The ping and the short fallback line
  // are what a phone renders; a validator enum and a raw search query on them is the defect fixed.
  assert.doesNotMatch(p.whatsappText, /Project Sable/);
  assert.equal(p.reason, "merged half-grids dropped 1 dictated connotation query", "the sentence is unchanged");
});

test("#862 a clientPrincipal run gets the payload on the FIELDS only — never in the client's email", () => {
  const p = buildFailurePacket({ ...BASE, job: { ...BASE.job, clientPrincipal: true },
    failedStage: "common-law", terminalKind: "deterministic", reasonDetail: DROP_DETAIL, reasonQuantity: 1 });
  assert.equal(p.reasonDetail, DROP_DETAIL, "staff surfaces keep the full truth");
  assert.doesNotMatch(p.emailBodyHtml, /Which one|Project Sable|connotation/i,
    "the client redaction is the same one that already hides the verbatim reason");
});

test("#862 ABSENT IS NOT ZERO: a failure carrying no payload writes both keys as null, never omits them", () => {
  const p = buildFailurePacket({ ...BASE, terminalKind: "deterministic" });
  assert.ok("reasonDetail" in p && "reasonQuantity" in p,
    "a missing key and 'this failure carries no payload' must be distinguishable — the reasonTruncated discipline");
  assert.equal(p.reasonDetail, null);
  assert.equal(p.reasonQuantity, null);
  assert.doesNotMatch(p.emailBodyHtml, /Which one/, "no heading over nothing");
  // 0 would read as 'nothing left' — the shape of a pass. Only a finite count is carried.
  assert.equal(buildFailurePacket({ ...BASE, reasonQuantity: 0 }).reasonQuantity, 0, "a real 0 from a throw site still rides");
  assert.equal(buildFailurePacket({ ...BASE, reasonQuantity: "3" }).reasonQuantity, null, "a non-number is absence, not a count");
  assert.equal(buildFailurePacket({ ...BASE, reasonDetail: "   " }).reasonDetail, null, "blank is absence");
});

// The wiring itself, asserted on the source: a packet field nobody passes is the hole this closes, and
// it would come back silently — the packet still builds, the fields still exist, they are just null on
// every run. Both notice lanes (handoff primary + sendPending backstop) and the terminal status write
// must each pass the payload.
test("#862 both notice lanes and the terminal status write pass the payload — the E11 wiring", () => {
  const src = readFileSync(new URL("../pipeline.mjs", import.meta.url), "utf8");
  const passes = src.match(/reasonDetail: reasonDetailField, reasonQuantity: quantity/g) ?? [];
  assert.equal(passes.length, 3,
    "expected 3 sites: writeRunStatus(state:'failed'), the handoff buildFailurePacket, the backstop buildFailurePacket");
  const statusWrite = src.slice(src.indexOf('writeRunStatus(ctx, { state: "failed", failedStage'));
  assert.match(statusWrite.slice(0, 700), /reasonDetail: reasonDetailField, reasonQuantity: quantity/,
    "status.json is the file the failure taxonomy sends a diagnosing agent to");
});

// ── — AN OPTIONS BAG ONE POSITION EARLY IS SILENT, AND IT INVERTS THE TERMINAL ──────────────────
//
// `StageFailure(stage, reason, resetsAt, opts = {})`. A three-argument call puts the bag into `resetsAt`
// and leaves `opts` as `{}`, so `failClass` and `detail` are DROPPED — no error, no warning. The
// run-level catch then falls through to `classifyFailureReason`, reads the prose as `unknown`, and
// `decideRecovery` grants `recoverable: true` with a park budget to a site that asked for neither: a
// factual terminal, which no retry can answer, gets retried.
//
// introduced exactly that at the verdict ratchet, by copying a sibling call and losing its
// `undefined,`. Dropping one argument from a four-argument call is not a mistake a reader catches, which
// is why this is an arm and not a comment: every site is counted FROM THE SOURCE, never from a list here.
test("#1708 no StageFailure site passes its options bag one position early", (t) => {
  const root = new URL("../../", import.meta.url).pathname;
  // The corpus comes from the shared helper, never from a `git ls-files` of this guard's own: outside a
  // checkout that call exits 128 and the guard fails as a wall of noise instead of saying it could not
  // look. `test-tiers.test.mjs` enforces this, and caught this arm doing it by hand.
  const GUARD = "#1708 StageFailure arity";
  const tracked = trackedFiles(GUARD, { root, pathspec: ["*.mjs"] });
  if (!tracked) return t.skip(skipReason(GUARD));
  const files = tracked.filter((f) => !f.includes("/test/"));
  assert.ok(files.length > 100, `expected the product tree, found ${files.length} file(s)`);

  const offenders = [];
  let withOpts = 0;
  for (const f of files) {
    const src = readFileSync(join(root, f), "utf8");
    for (let i = src.indexOf("new StageFailure("); i !== -1; i = src.indexOf("new StageFailure(", i + 1)) {
      const start = i + "new StageFailure(".length;
      let j = start, d = 0, q = null, args = 1, lastComma = -1;
      for (; j < src.length; j++) {
        const c = src[j];
        if (q) { if (c === "\\") j++; else if (c === q) q = null; continue; }
        if (c === '"' || c === "'" || c === "`") { q = c; continue; }
        if ("([{".includes(c)) d++;
        else if (")]}".includes(c)) { if (d === 0) break; d--; }
        else if (c === "," && d === 0) { args++; lastComma = j; }
      }
      const lastArg = (lastComma >= 0 ? src.slice(lastComma + 1, j) : src.slice(start, j)).trim();
      // Only a call that actually carries an options bag can exhibit this.
      if (!/^\{/.test(lastArg) || !/failClass|repairs|reasonCodes|quantity|detail/.test(lastArg)) continue;
      withOpts++;
      if (args === 3) offenders.push(`${f}:${src.slice(0, i).split("\n").length}`);
    }
  }
  assert.ok(withOpts >= 10, `expected the options-carrying sites, found ${withOpts} — the scan stopped selecting`);
  assert.deepEqual(offenders, [],
    `${offenders.length} site(s) pass the options bag as argument 3, so it lands in resetsAt and every stamp `
    + `is dropped — add the missing \`undefined,\`:\n  ${offenders.join("\n  ")}`);
});
