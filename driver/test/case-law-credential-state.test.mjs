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
import { caseLawSourceLines } from "../case-law-sources.mjs";

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

    // Composed exactly as driver/pipeline.mjs composes it before handing it to the case-law stage.
    const sources = rows
      .filter((r) => r?.key === "caselaw")
      .map((r) => ({ label: r.providerLabel ?? r.provider, enrolment: r.enrolment ?? null, available: r.configured === true }));
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
