// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// ── — CASE LAW WAS NEVER MENTIONED UNTIL THE REPORT SAID IT WAS MISSING ──────
//
// The owner ran a Full country search on his own install. The finished report, after ~2.5 hours and real
// spend: "Coverage gaps: Legal Data Hunter MCP unreachable (CONNECTION_CLOSED); WebSearch unavailable
// this session; no EUIPO Boards-of-Appeal source; no lead to fetch on EUR-Lex." Then: "Legal data hunter
// MCP was NOWHERE in setup - and it was NOWHERE in the global config (showing connection) neither was it
// flagged when selecting the report in the new clearance screen." All three were true.
//
// THE DISCLOSURE IS THE PRODUCT WORKING. No report claims "no adverse case law" off a sweep that never
// dispatched. The defect is that the disclosure was the FIRST mention.
//
// THE CLASS, NOT THE INSTANCE, is what this file pins: the issue rules that whatever the fix is, it must
// be "derived from the set of capabilities a product declares it needs, not from a hand-kept list of the
// two we remembered".
//
// BREAK MATRIX:
//   · the sources come from the list that decides what is spawned  → break: retype them, arm 1 red
//   · readiness is a file read, never a probe                      → break: fetch, arm 2 red
//   · a built-in lane is not evidence the enrolled ones are set up → break: read `configured` alone, arm 3 red
//   · the composer warns off the PRODUCT'S declaration             → break: key on an id, arm 4 red
//   · a snapshot that cannot say produces no warning               → break: read null as false, arm 4 red
//   · the other three gaps from the same report are listed too     → break: drop them, arm 5 red
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { caseLawInventory } from "../config-inventory.mjs";
import { caseLawReadyFor } from "../flag-snapshot.mjs";
import { CASELAW_BRIDGES } from "../engine/mcp/gather-config.mjs";
import { PRODUCTS } from "../products.mjs";

const withCreds = (enrolled) => {
  const dir = mkdtempSync(join(tmpdir(), "caselaw-creds-"));
  // A CREDENTIAL, NOT AN EMPTY FILE. This wrote `"{}"`, which modelled enrolment as "a file exists" —
  // the very test tracker issue 173 replaced, because a zero-byte or contentless file read as an
  // enrolled source and made a delivered report disclose an outage that never happened. What a
  // one-time OAuth exchange actually writes is a token pair, and `tokens.refresh_token` is the part
  // that makes the credential usable, so that is what a fixture standing in for one has to carry.
  for (const id of enrolled) {
    writeFileSync(join(dir, `${id}.json`), JSON.stringify({ tokens: { access_token: "fixture", refresh_token: "fixture" } }));
  }
  return { OAUTH_BRIDGE_CREDS_DIR: dir };
};

test("2087 arm 1 — the sources are the ones the engine actually spawns, not a list typed here", () => {
  const rows = caseLawInventory(withCreds([]));
  const enrollable = rows.filter((r) => r.enrolment === "oauth").map((r) => r.provider);
  assert.deepEqual([...enrollable].sort(), [...CASELAW_BRIDGES].sort(),
    "the case-law census and the list that decides what gets spawned have drifted — which is the "
    + "hand-kept census this issue is about");
  // Every row a person reads names the source in words, never the bridge key alone.
  for (const r of rows) {
    assert.ok(r.providerLabel && r.providerLabel !== r.provider, `${r.provider} has no reader-facing label`);
    assert.ok(r.label, `${r.provider} has no group label, so the config page has nothing to head it with`);
  }
});

test("2087 arm 2 — readiness is enrolment, read off the filesystem, and says it is not reachability", () => {
  const none = caseLawInventory(withCreds([]));
  assert.deepEqual(none.filter((r) => r.enrolment === "oauth").map((r) => r.configured), [false, false]);

  const one = caseLawInventory(withCreds([CASELAW_BRIDGES[0]]));
  const byId = new Map(one.map((r) => [r.provider, r]));
  assert.equal(byId.get(CASELAW_BRIDGES[0]).configured, true, "a stored token is not read as enrolment");
  assert.equal(byId.get(CASELAW_BRIDGES[0]).remedy, null, "an enrolled source still carries a remedy");
  assert.equal(byId.get(CASELAW_BRIDGES[1]).configured, false);

  // THE REMEDY NAMES SOMETHING THAT EXISTS. There is no login command in this repo — the enrolment is
  // the documented OAuth exchange — and a printed command that does not exist is its own defect.
  const remedy = byId.get(CASELAW_BRIDGES[1]).remedy;
  assert.match(remedy, /providers\/oauth-mcp-bridge\/README\.md/, "the remedy does not name the enrolment");
  assert.doesNotMatch(remedy, /login\.mjs|clearotron login/, "the remedy names a command this repo does not ship");
  assert.doesNotMatch(remedy, /set [A-Z_]{4,}/, "ADR-0003: setup is an OAuth flow, not a variable to set");
  // NAMES AND STATES, NEVER VALUES — the rest of config-inventory's rule, applied here.
  for (const r of one) assert.equal(JSON.stringify(r).includes("BEGIN"), false);

  // A DOCTOR THAT REACHES THE NETWORK HANGS ON A BOX WITH NO ROUTE. Asserted over the source, because
  // the failure is a call somebody adds later and nothing offline can observe.
  const src = readFileSync(fileURLToPath(new URL("../config-inventory.mjs", import.meta.url)), "utf8");
  const body = src.slice(src.indexOf("export function caseLawInventory"));
  assert.doesNotMatch(body, /\bfetch\(|https?:\/\/[a-z]/i, "the inventory reaches the network");
});

test("2087 arm 3 — a lane that is part of the build is not evidence an enrolled one is set up", () => {
  // EUR-Lex reads through the engine's own fetch tool, so it is always `configured: true`. Reading
  // "any configured case-law row" would report EVERY deployment as ready and the composer's warning
  // would never fire — on the exact box it was written for.
  const rows = caseLawInventory(withCreds([]));
  assert.ok(rows.some((r) => r.key === "caselaw" && r.enrolment === "built-in" && r.configured),
    "premise: a built-in case-law row reads as configured");
  assert.equal(caseLawReadyFor({ providers: rows }), false,
    "a built-in lane is being counted as an enrolled case-law source");
  assert.equal(caseLawReadyFor({ providers: caseLawInventory(withCreds([CASELAW_BRIDGES[0]])) }), true);

  // THE THIRD STATE. An older snapshot has provider rows and no case-law ones, which is "does not say".
  assert.equal(caseLawReadyFor({ providers: [{ key: "register", configured: true }] }), null,
    "a snapshot that predates this reads as a dark lane, so every old box gets a false warning");
  assert.equal(caseLawReadyFor({}), null, "a snapshot with no providers at all reads as an answer");
  assert.equal(caseLawReadyFor(null), null);
});

test("2087 arm 4 — the composer warns off the PRODUCT'S declaration, and only on a measured absence", () => {
  // The product that needs case law is whichever one says so. A warning keyed on an id would go stale
  // the day the offering changes, silently, on the screen that spends money.
  const needs = PRODUCTS.filter((p) => p.caseLaw);
  assert.equal(needs.length, 1, "the offering changed shape — check the arms below still ask the right question");

  const src = readFileSync(fileURLToPath(new URL("../portal-service.mjs", import.meta.url)), "utf8");
  const line = src.split("\n").find((l) => l.includes("capabilityNote:"));
  assert.ok(line, "the level rows carry no capability note");
  assert.match(line, /l\.caseLaw/, "the warning is keyed on something other than the product's own declaration");
  assert.match(line, /caseLawReady === false/,
    "the warning fires on anything but an explicit false — a snapshot that cannot say would warn every reader");
  // The sentence a client reads names no vendor and no variable: the enrolment is an operator's job on
  // the box, and this is a client-facing screen.
  const note = src.slice(src.indexOf("const CASE_LAW_DARK_NOTE"), src.indexOf(";", src.indexOf("const CASE_LAW_DARK_NOTE")));
  assert.doesNotMatch(note, /courtlistener|legaldatahunter|OAUTH|README/i,
    "the client-facing sentence names our plumbing");
  assert.match(note, /report states the gap/, "it does not say what the reader gets instead");
});

test("2087 arm 5 — the other three gaps from the same report get the same treatment", () => {
  // "WebSearch unavailable this session", "no EUIPO Boards-of-Appeal source", "no lead to fetch on
  // EUR-Lex" were the rest of that coverage-gaps line. Each is a capability the deployment either has
  // or does not, and each was first mentioned in the output.
  const rows = caseLawInventory(withCreds([]));
  const providers = rows.map((r) => r.provider);
  for (const expected of ["eur-lex", "euipo-boards-of-appeal", "engine-websearch"]) {
    assert.ok(providers.includes(expected), `${expected} was named in the report and is listed nowhere before it`);
  }
  // AND EACH SAYS WHAT IS TRUE OF IT rather than inventing a switch. The Boards of Appeal have no
  // adapter: that is a release fact an operator can do nothing about, and saying so is the point.
  const boa = rows.find((r) => r.provider === "euipo-boards-of-appeal");
  assert.equal(boa.known, false, "a capability this build does not ship is listed as one it does");
  assert.match(boa.remedy, /Nothing to fix on this box/, "the row implies a setting that does not exist");
  // WebSearch is the engine's, and can be gone for one session — so no deployment check may promise it.
  const web = rows.find((r) => r.provider === "engine-websearch");
  assert.match(web.remedy, /unavailable for a single session/, "the row promises a lane it cannot promise");
});

test("2087 arm 6 — doctor and install both name it, and install still collects nothing", () => {
  const onboard = readFileSync(fileURLToPath(new URL("../../bin/onboard.mjs", import.meta.url)), "utf8");
  assert.match(onboard, /say\("\\n {2}Case law and other capabilities"\)/, "doctor has no case-law section");
  assert.match(onboard, /say\("\\n {2}Case law"\)/, "install never names the lane");
  // BOTH surfaces call it, and neither restates its contents: two import lines and two calls, plus the
  // one comment naming it. A hand-kept second list on either screen is the defect this issue is about.
  assert.equal((onboard.match(/caseLawInventory\(/g) ?? []).length, 2,
    "the two surfaces do not both read the one inventory");
  for (const label of ["CourtListener", "Legal Data Hunter", "trademark-oauth-mcp"]) {
    assert.ok(!onboard.includes(label), `${label} is restated in onboard.mjs — it belongs to the inventory alone`);
  }

  // ADR-0003 IS KEPT. The wizard must not offer to adopt an ambient case-law key — that taught a new
  // install to set something that configures nothing. A sentence is not an adoption, and the arm below
  // is what keeps the difference: the case-law names stay out of the ambient key list.
  const ambient = onboard.slice(onboard.indexOf("export const AMBIENT_KEYS"), onboard.indexOf("];", onboard.indexOf("export const AMBIENT_KEYS")));
  for (const id of CASELAW_BRIDGES) {
    assert.ok(!ambient.toLowerCase().includes(id), `${id} reached the ambient key list — ADR-0003 refuses exactly that`);
  }
  assert.doesNotMatch(ambient, /OAUTH_BRIDGE_CREDS_DIR/, "the wizard is looking for a case-law credential to adopt");

  // ── AN ABSENCE IS NOT A MISCONFIGURATION, and the doctor's exit code is the difference ────────────
  //
  // `--check` exits 0 on a fresh machine with nothing set up and non-zero on a configuration that will
  // fail at run time. A case-law source nobody has signed in to yet is the first of those: it is the
  // normal state of a new install, every other search is unaffected, and there is no variable to have
  // got wrong. Using `problem()` here reds `--check` on every unconfigured box — eight arms in
  // onboard-wizard.test.mjs, and the first symptom is a doctor that fails rather than reports.
  const section = onboard.slice(onboard.indexOf('say("\\n  Case law and other capabilities")'));
  const body = section.slice(0, section.indexOf("issue 1891"));
  // THE PROPERTY, DRIVEN — not "does the word `problem(` appear in this slice".
  //
  // That grep was the arm until tracker issue 173, and it was a proxy: it protected the exit contract
  // by forbidding a CALL, and the contract is about a STATE. 173 added a third case the original two
  // could not express — a credential that is PRESENT and cannot work — which is a misconfiguration and
  // must exit non-zero, while an absence must still exit 0. Under the old grep those two are the same
  // fact, so keeping it would have meant either losing the new state or lying about the old one.
  //
  // So the absence is driven through the real inventory instead. A fresh machine reaches `problem()`
  // only if a row comes back `unusable`, and on an empty credentials directory none can.
  const fresh = mkdtempSync(join(tmpdir(), "caselaw-fresh-"));
  const freshRows = caseLawInventory({ OAUTH_BRIDGE_CREDS_DIR: fresh }).filter((r) => r.enrolment === "oauth");
  assert.ok(freshRows.length >= 2, "the fresh-machine case is not being driven");
  for (const r of freshRows) {
    assert.equal(r.credential?.state, "absent",
      `${r.providerLabel} reads as ${r.credential?.state} on a machine that has enrolled nothing — `
      + "which would take doctor to rc 1 for being fresh");
    assert.notEqual(r.credential?.state, "unusable");
  }
  // And the ONLY problem() the section may carry is the one that new state gates. A second, ungated
  // call is the regression this arm has always been about.
  const problemCalls = body.match(/\bproblem\(/g) ?? [];
  assert.equal(problemCalls.length, 1,
    "the case-law section has a problem() call that is not the unusable-credential one");
  assert.match(body, /credential\?\.state === "unusable"\) problem\(/,
    "the section's problem() is not gated on an unusable credential, so an absence can reach it");
  assert.match(body, /\bwarn\(/, "and it must still say it out loud rather than passing in silence");
  // Anti-vacuity: the slice must actually be the section, not an empty string that passes both above.
  assert.ok(body.length > 400 && body.includes("caseLawInventory"),
    "the section slice did not find the doctor's case-law block — the arm has broken, not the tree");
});
