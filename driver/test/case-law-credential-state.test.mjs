// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// A credential file that exists and cannot work — tracker issue 173.
//
// `existsSync` was the entire enrolment test, so a zero-byte file and a file of pure garbage both read
// `✓ enrolled` at rc 0. The cost is not the operator's screen: `driver/case-law-sources.mjs` hands the
// clearance stage "enrolled on this deployment; if it fails at run time that IS an outage and you
// report it as one", so a broken credential makes a DELIVERED REPORT disclose an infrastructure outage
// that never happened, for a source this deployment does not have.
//
// The arms below drive the three states apart AND follow the consequence one hop further, into the
// sentence the stage is actually handed — because that hop is the whole reason the issue is not a
// cosmetic one, and nothing else in the suite joins those two files.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { credentialState, caseLawInventory } from "../config-inventory.mjs";
import { caseLawSourceLines, caseLawSourceRows } from "../case-law-sources.mjs";

const scratch = () => mkdtempSync(join(tmpdir(), "caselaw-cred-"));

test("tracker issue 173 — the four states are separable", () => {
  const dir = scratch();
  try {
    // THE CONTROL FIRST, so the instrument is known good. An empty directory must read as absent; if
    // it did not, every result below would be meaningless.
    assert.equal(credentialState(join(dir, "nothing.json")).state, "absent");

    const empty = join(dir, "empty.json");
    writeFileSync(empty, "");
    assert.equal(credentialState(empty).state, "unusable", "a zero-byte file read as something else");

    const garbage = join(dir, "garbage.json");
    writeFileSync(garbage, "this is not json at all");
    assert.equal(credentialState(garbage).state, "unusable");

    // Parses, and is still not a credential: this is the shape an interrupted or half-written install
    // leaves behind, and it is the one a JSON-parses-therefore-fine check would wave through.
    const noRefresh = join(dir, "no-refresh.json");
    writeFileSync(noRefresh, JSON.stringify({ tokens: { access_token: "x" } }));
    assert.equal(credentialState(noRefresh).state, "unusable");

    const good = join(dir, "good.json");
    writeFileSync(good, JSON.stringify({ tokens: { access_token: "x", refresh_token: "y" } }));
    assert.equal(credentialState(good).state, "usable");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("tracker issue 173 — an expired access token is NOT unusable", () => {
  // The resting state of a healthy credential. The bridge refreshes on the next call, so treating an
  // expired access token as broken would report every working enrolment as failed — a louder version
  // of the same wrong answer.
  const dir = scratch();
  try {
    const f = join(dir, "expired.json");
    writeFileSync(f, JSON.stringify({
      tokens: { access_token: "x", refresh_token: "y", expires_at: 1 },
    }));
    assert.equal(credentialState(f).state, "usable");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("tracker issue 173 — a credential that cannot be read is a could-not-look, not an answer", () => {
  const dir = scratch();
  try {
    // A directory where a file belongs: present to `existsSync`, unreadable as a file. The point is
    // that it lands in neither "enrolled" nor "not set up" — an absence of evidence is not evidence of
    // absence, and this issue exists because something invisible was read as fine.
    mkdirSync(join(dir, "courtlistener.json"));
    const st = credentialState(join(dir, "courtlistener.json"));
    assert.notEqual(st.state, "usable");
    assert.notEqual(st.state, "absent");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("tracker issue 173 — no byte of a token value leaves the check", () => {
  const dir = scratch();
  try {
    const secret = "SUPER-SECRET-REFRESH-VALUE-0123456789";
    const f = join(dir, "courtlistener.json");
    writeFileSync(f, JSON.stringify({ tokens: { access_token: secret, refresh_token: secret } }));
    const st = credentialState(f);
    // The rule the whole file keeps: NAMES AND STATES, NEVER VALUES.
    assert.ok(!JSON.stringify(st).includes(secret), "the credential check returned a token value");

    const rows = caseLawInventory({ OAUTH_BRIDGE_CREDS_DIR: dir });
    assert.ok(!JSON.stringify(rows).includes(secret), "the inventory carried a token value");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("tracker issue 173 — an unusable credential reaches the STAGE as a source we do not have", () => {
  // THE HOP THAT MATTERS. The defect was never the doctor row on its own: it was that this sentence
  // said "enrolled … that IS an outage and you report it as one" for a deployment with a garbage file,
  // which is how the wrong disclosure reached a client's report.
  const dir = scratch();
  try {
    writeFileSync(join(dir, "courtlistener.json"), "");
    const rows = caseLawInventory({ OAUTH_BRIDGE_CREDS_DIR: dir });
    const cl = rows.find((r) => r.provider === "courtlistener");
    assert.equal(cl.credential.state, "unusable");
    assert.equal(cl.configured, false, "an unusable credential still read as configured");

    // Composed by the FUNCTION the pipeline calls, not by a hand-built copy of it. The copy that used
    // to live here is why this arm kept passing when the real mapping gained a field.
    const sources = caseLawSourceRows(rows);
    const said = caseLawSourceLines(sources).join("\n");
    const line = said.split("\n").find((l) => l.includes("CourtListener"));
    assert.match(line, /NOT SET UP ON THIS DEPLOYMENT/,
      "a broken credential is still described to the stage as enrolled");
    assert.doesNotMatch(line, /IS an outage/,
      "the stage is still being told to report an outage for a source this deployment does not have");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("tracker issue 173 — a usable credential is still reported as enrolled", () => {
  // The direction that keeps the fix from being a refusal machine. Nothing above is worth anything if
  // a real enrolment stopped reading as one.
  const dir = scratch();
  try {
    writeFileSync(join(dir, "courtlistener.json"),
      JSON.stringify({ tokens: { access_token: "x", refresh_token: "y" } }));
    const cl = caseLawInventory({ OAUTH_BRIDGE_CREDS_DIR: dir }).find((r) => r.provider === "courtlistener");
    assert.equal(cl.configured, true);
    assert.equal(cl.remedy, null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("tracker issue 173 — a credential that CANNOT BE READ reaches the stage as a could-not-look", () => {
  // THE OWNER'S RULING, 2026-09-05, driven at the surface it was made about. The four states landed in
  // this issue and `doctor` honoured them; the sentence handed to the stage did not, because the caller
  // flattened them into one boolean first. An unreadable credential was described to the stage as one
  // that "was never enrolled here" — a definite negative asserted from a could-not-look, inside the list
  // case-law-sources.mjs calls "the ground truth". A `chmod 000` could make a delivered report tell a
  // client this deployment does not have US federal case law.
  const dir = scratch();
  const file = join(dir, "courtlistener.json");
  try {
    writeFileSync(file, JSON.stringify({ tokens: { access_token: "x", refresh_token: "y" } }));
    chmodSync(file, 0o000);
    const rows = caseLawInventory({ OAUTH_BRIDGE_CREDS_DIR: dir });
    const cl = rows.find((r) => r.provider === "courtlistener");
    // THE INSTRUMENT FIRST. Running as root reads a 000 file happily, and this arm would then be
    // driving `usable` while claiming to drive `unreadable` — a pass that measured the wrong state.
    if (cl.credential.state !== "unreadable") {
      assert.equal(cl.credential.state, "usable", "an unexpected state — this arm no longer knows what it drove");
      return;   // root, or a filesystem that ignores the mode: not a result either way
    }

    const line = caseLawSourceLines(caseLawSourceRows(rows)).join("\n")
      .split("\n").find((l) => l.includes("CourtListener"));

    assert.match(line, /COULD NOT BE CHECKED ON THIS DEPLOYMENT/,
      "an unreadable credential is still described to the stage as an answer");
    assert.doesNotMatch(line, /NOT SET UP ON THIS DEPLOYMENT/,
      "the stage is still told this deployment does not have a source nobody could check");
    assert.doesNotMatch(line, /IS an outage/,
      "the stage is being told to report an outage for a source nobody could check");
    // The ruling's two prohibitions, in its own terms, asserted as text the stage receives.
    assert.match(line, /could not be confirmed/, "the reader is not told what to report instead");
  } finally { try { chmodSync(file, 0o600); } catch { /* already gone */ } rmSync(dir, { recursive: true, force: true }); }
});

test("tracker issue 173 — the composer's three states stay three, and none borrows another's sentence", () => {
  // THE CLASS, not the one state. Driven on rows built by hand so every branch is exercised on this box
  // regardless of what its filesystem permits, and asserted as three DISTINCT sentences: a shared
  // sentence is exactly how the defect arrived, and a future edit that collapses two would pass an arm
  // that only checked the one state it was written for.
  const rows = [
    { label: "Enrolled", enrolment: "oauth", available: true, checked: true },
    { label: "Broken", enrolment: "oauth", available: false, checked: true },
    { label: "Unknown", enrolment: "oauth", available: false, checked: false },
  ];
  const said = caseLawSourceLines(rows).join("\n").split("\n");
  const of = (name) => said.find((l) => l.includes(name));

  assert.match(of("Enrolled"), /IS an outage/);
  assert.match(of("Broken"), /NOT SET UP ON THIS DEPLOYMENT/);
  assert.match(of("Unknown"), /COULD NOT BE CHECKED/);

  const three = new Set([of("Enrolled"), of("Broken"), of("Unknown")]);
  assert.equal(three.size, 3, "two states share a sentence, which is the defect this issue is about");

  // The residue the test lane named: "it was never enrolled here" is false about a credential somebody
  // DID enrol, and `unusable` is exactly that case.
  assert.doesNotMatch(of("Broken"), /never enrolled here/,
    "a credential somebody enrolled is still described as one that was never enrolled");
});
