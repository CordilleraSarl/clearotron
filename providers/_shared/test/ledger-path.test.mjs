// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — where the shared register ledger lives.
//
// Every test here drives the REAL resolver through a fake HOME, because `os.homedir()` reads $HOME on
// POSIX. That keeps the homedir derivation itself under test rather than stubbed: two read sites once
// hardcoded a literal /home/operator and split the ledger under every other service account.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveLedger, ledgerPath, ledgerDeprecationNotice, _resetLedgerNotices, LEDGERS }
  from "../ledger-path.mjs";

const ROOT = mkdtempSync(join(tmpdir(), "ledger-path-"));
const HOME_WAS = process.env.HOME;

/**
 * A fresh fake home with BOTH telemetry directories present but empty.
 *
 * moved the default directory from `.openclaw/telemetry` to `trademark/telemetry`, so the resolver
 * now answers a question with four candidates rather than two and every test here has to say WHICH
 * place it is describing. `legacyFiles` is the first argument because it is the upgrade case — the one
 * that costs something to get wrong, and the one production is in.
 *
 * @returns {{legacy: string, neutral: string}} both telemetry dirs.
 */
function home(legacyFiles = {}, neutralFiles = {}) {
  const h = mkdtempSync(join(ROOT, "home-"));
  const legacy = join(h, ".openclaw", "telemetry");
  const neutral = join(h, "trademark", "telemetry");
  mkdirSync(legacy, { recursive: true });
  mkdirSync(neutral, { recursive: true });
  for (const [name, body] of Object.entries(legacyFiles)) writeFileSync(join(legacy, name), body);
  for (const [name, body] of Object.entries(neutralFiles)) writeFileSync(join(neutral, name), body);
  process.env.HOME = h;
  return { legacy, neutral };
}
const restore = () => { if (HOME_WAS === undefined) delete process.env.HOME; else process.env.HOME = HOME_WAS; };

process.on("exit", () => { restore(); try { rmSync(ROOT, { recursive: true, force: true }); } catch { /* teardown */ } });

// ── precedence ──────────────────────────────────────────────────────────────────────────────────────

test("the neutral env var wins outright", () => {
  home({ "corsearch-records.jsonl": "x", "register-records.jsonl": "y" });
  const r = resolveLedger("record", { CLEAROTRON_REGISTER_RECORD_LOG: "/tmp/explicit.jsonl" });
  assert.equal(r.path, "/tmp/explicit.jsonl");
  assert.equal(r.source, "env");
  restore();
});

// — THE ONE-RELEASE ENV ALIAS IS OVER, and this arm is what proves it rather than an absence of
// arms. A vendor-named env var is now ordinary environment noise: it resolves nothing and the ledger
// falls through to its normal resolution.
//
// Measured before removing it: ZERO of the four env files on the test and production boxes set either
// name, and no systemd unit does. It was never load-bearing.
test("#605 a legacy env name resolves NOTHING — the alias is gone, not softened", () => {
  home({});
  const r = resolveLedger("record", { CORSEARCH_RECORD_LOG: "/tmp/old.jsonl" });
  assert.notEqual(r.path, "/tmp/old.jsonl", "the deprecated name must not steer the ledger any more");
  assert.equal(r.source, "default-fresh", "it falls through to the ordinary resolution");
  restore();
});

test("the neutral env var still wins, and a legacy name beside it changes nothing", () => {
  home({});
  const r = resolveLedger("call", { CLEAROTRON_REGISTER_CALL_LOG: "/tmp/new.jsonl", CORSEARCH_CALL_LOG: "/tmp/old.jsonl" });
  assert.equal(r.path, "/tmp/new.jsonl");
  assert.equal(r.source, "env");
  restore();
});

test("an empty or whitespace env value is NOT a setting — it falls through", () => {
  const { legacy } = home({ "corsearch-records.jsonl": "x" });
  const r = resolveLedger("record", { CLEAROTRON_REGISTER_RECORD_LOG: "   ", CLEAROTRON_REGISTER_RECORD_LOG: "" });
  assert.equal(r.path, join(legacy, "corsearch-records.jsonl"),
    "an exported-but-blank var must not point the ledger at the empty string");
  restore();
});

// ── the filename fallback: acceptance criterion 2 ───────────────────────────────────────────────────

test("a box carrying ONLY the legacy-named file keeps reading it, with no env var and no migration", () => {
  const { legacy } = home({ "corsearch-records.jsonl": "rows", "corsearch-calls.jsonl": "rows" });
  const rec = resolveLedger("record", {});
  const call = resolveLedger("call", {});
  assert.equal(rec.path, join(legacy, "corsearch-records.jsonl"));
  assert.equal(rec.source, "legacy-default");
  assert.equal(call.path, join(legacy, "corsearch-calls.jsonl"));
  assert.equal(call.source, "legacy-default");
  restore();
});

test("a fresh install gets the neutral name AND the neutral directory — nothing to inherit", () => {
  const { neutral } = home({});
  const r = resolveLedger("record", {});
  assert.equal(r.path, join(neutral, "register-records.jsonl"));
  assert.equal(r.source, "default-fresh");
  assert.equal(r.legacy, null);
  restore();
});

test("the two ledgers resolve INDEPENDENTLY — a box can straddle both naming generations", () => {
  // Exactly the test box on 2026-08-10: its records ledger was archived aside, its call ledger was not.
  const { legacy, neutral } = home({ "corsearch-calls.jsonl": "rows" });
  assert.equal(resolveLedger("call", {}).path, join(legacy, "corsearch-calls.jsonl"));
  assert.equal(resolveLedger("record", {}).path, join(neutral, "register-records.jsonl"));
  restore();
});

// ── both present: the case that must not be silent ──────────────────────────────────────────────────

test("both files present: the neutral one is used AND the unread legacy one is reported with its size", () => {
  const { legacy } = home({ "register-records.jsonl": "new", "corsearch-records.jsonl": "a".repeat(4096) });
  const r = resolveLedger("record", {});
  assert.equal(r.path, join(legacy, "register-records.jsonl"));
  // — the neutral NAME in the legacy DIRECTORY is still a legacy resolution: the box has not moved,
  // it has only renamed. `default` is reserved for the current home, or the notice would go quiet on a
  // box that still has work to do.
  assert.equal(r.source, "legacy-default");
  assert.ok(r.legacy, "a legacy ledger holding rows nobody reads is an absence, and must be reported");
  assert.equal(r.legacy.path, join(legacy, "corsearch-records.jsonl"));
  assert.equal(r.legacy.bytes, 4096, "the size is what tells an operator whether it matters");
  restore();
});

// — WITH TWO DIRECTORIES THERE CAN BE THREE UNREAD FILES, and the one worth naming is the biggest.
// Production is the shape this protects: a 432 MB vendor-named ledger in the old directory, and whatever
// a fresh write created in the new one. Reporting the smallest would say "3 bytes are not being read"
// while the history sat unread — this file's own failure mode wearing the fix's clothes.
test("the unread ledger reported is the LARGEST, not the next one in preference order", () => {
  const { legacy, neutral } = home(
    { "corsearch-records.jsonl": "a".repeat(9000), "register-records.jsonl": "b".repeat(20) },
    { "register-records.jsonl": "chosen" },
  );
  const r = resolveLedger("record", {});
  assert.equal(r.path, join(neutral, "register-records.jsonl"), "the current home wins when it exists");
  assert.equal(r.source, "default");
  assert.equal(r.legacy.path, join(legacy, "corsearch-records.jsonl"));
  assert.equal(r.legacy.bytes, 9000);
  restore();
});

test("only the neutral file, in the neutral directory: nothing to report", () => {
  home({}, { "register-records.jsonl": "new" });
  const r = resolveLedger("record", {});
  assert.equal(r.source, "default");
  assert.equal(r.legacy, null);
  restore();
});

// ── the notice ──────────────────────────────────────────────────────────────────────────────────────

// RE-POINTED. This drove the env-alias notice, which no longer exists — a legacy env name is
// ordinary environment noise now. The ONCE-PER-PROCESS property it was really testing is unchanged, so
// it is asserted on the notice that survives: the legacy FILENAME, which is a live resolution on
// production today.
test("the deprecation notice fires ONCE per process, and names what to do", () => {
  home({ "corsearch-records.jsonl": "rows" });
  _resetLedgerNotices();
  const first = ledgerDeprecationNotice("record", {});
  assert.match(first, /legacy record ledger/);
  assert.match(first, /register-records\.jsonl/, "a notice that does not say the new name teaches nothing");
  assert.match(first, /it is read either way/, "…and it must not read as a fault: production is on this name");
  assert.equal(ledgerDeprecationNotice("record", {}), null, "twice is noise");
  // and a legacy ENV name says nothing at all — there is nothing left to deprecate
  _resetLedgerNotices();
  home({});
  assert.equal(ledgerDeprecationNotice("record", { CORSEARCH_RECORD_LOG: "/tmp/old.jsonl" }), null,
    "#605: the env alias is gone, so it is neither honoured nor announced");
  restore();
});

test("the unread-legacy notice names the byte count, not just the fact", () => {
  home({ "register-records.jsonl": "new", "corsearch-records.jsonl": "a".repeat(1234) });
  _resetLedgerNotices();
  const msg = ledgerDeprecationNotice("record", {});
  assert.match(msg, /1234 bytes/);
  assert.match(msg, /NOT being read/);
  restore();
});

test("a neutral resolution is silent", () => {
  home({}, { "register-records.jsonl": "new" });
  _resetLedgerNotices();
  assert.equal(ledgerDeprecationNotice("record", {}), null);
  restore();
});

test("the call and record ledgers announce independently", () => {
  home({ "corsearch-calls.jsonl": "rows", "corsearch-records.jsonl": "rows" });
  _resetLedgerNotices();
  assert.ok(ledgerDeprecationNotice("call", {}), "call ledger announces");
  assert.ok(ledgerDeprecationNotice("record", {}), "and the record ledger's own notice is not swallowed by it");
  restore();
});

// ── shape ───────────────────────────────────────────────────────────────────────────────────────────

test("an unknown ledger name throws rather than resolving to something plausible", () => {
  assert.throws(() => resolveLedger("records"), /unknown ledger "records"/);
  assert.throws(() => ledgerPath("Call"), /unknown ledger "Call"/);
});

test("every ledger declares its names, and no neutral name carries a vendor", () => {
  for (const [which, spec] of Object.entries(LEDGERS)) {
    // — THREE names, not four: `legacyEnv` is deleted. `legacyFile` STAYS, and the distinction is
    // the whole care in that issue — production's ledgers are still corsearch-calls.jsonl (7.2 MB) and
    // corsearch-records.jsonl (432.6 MB), so `legacy-default` is a live resolution there right now.
    assert.equal(spec.legacyEnv, undefined, "the env alias expired with #605");
    for (const k of ["env", "file", "legacyFile"]) {
      assert.equal(typeof spec[k], "string", `${which}.${k}`);
      assert.ok(spec[k].length, `${which}.${k} is empty`);
    }
    assert.doesNotMatch(spec.env, /corsearch|clarivate|signa|euipo|uspto/i,
      `${which}.env still names a vendor — the whole point of #594`);
    assert.doesNotMatch(spec.file, /corsearch|clarivate|signa|euipo|uspto/i,
      `${which}.file still names a vendor — the whole point of #594`);
  }
});

test("homedir is re-derived per call, never captured", () => {
  const a = home({});
  const first = ledgerPath("record", {});
  const b = home({});
  const second = ledgerPath("record", {});
  assert.notEqual(first, second, "a captured homedir splits the ledger under any other service account");
  assert.equal(first, join(a.neutral, "register-records.jsonl"));
  assert.equal(second, join(b.neutral, "register-records.jsonl"));
  restore();
});
