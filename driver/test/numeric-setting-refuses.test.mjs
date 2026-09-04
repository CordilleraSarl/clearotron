// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// — A NUMERIC SETTING NEVER RESOLVES TO NaN.
//
// `Number("two")` is `NaN`, and NaN is the worst answer available because every comparison against it
// is FALSE. Measured: `CLEAROTRON_MAX_CONCURRENT_RUNS=two` made the run-slot cap NaN, `live < cap` false
// forever, and the grant loop `for (let i = 0; i < cap; i++)` a loop that never ran. No slot was
// granted, no slot file was written, and the acquirer waited with no error, no log line and no timeout.
// The driver accepted work and started none of it.
//
// The two blank-vs-broken answers are the whole design and they are asserted separately below:
//   blank / unset / whitespace   "not configured"  — take the default. Settled by; these
//                                arms exist so converting the read cannot quietly undo it.
//   not a number                 "configured wrong" — refuse, naming the variable.
//
// RANGE IS NOT PARSEABILITY. `"0"` and `"-1"` are numbers and keep their documented floors. An explicit
// `CLEAROTRON_MAX_CLAIM_AGE_MS=0` is a CHOICE and must survive; blurring "cannot be parsed" into "outside
// the range I wanted" would change behaviour nobody asked to change.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

import { config } from "../driver.config.mjs";
import { NUMERIC_SETTING_DEFAULTS, numericSetting, resolveNumericSetting, fallbackNoteFor } from "../numeric-setting.mjs";
import { acquireSlot, freeSlots } from "../slot-lock.mjs";
import { statusSnapshot } from "../status-snapshot.mjs";
import { concurrentRunsCap } from "../portal-service.mjs";

const DRIVER = join(dirname(fileURLToPath(import.meta.url)), "..");

/** accessor → the variable it reads. The pairing is the thing under test: a getter reading the wrong
 *  name would still return a number, and every value assertion below would still pass. */
const ACCESSORS = {
  gatherConcurrency: "CLEAROTRON_GATHER_CONCURRENCY",
  cardConcurrency: "CLEAROTRON_CARD_CONCURRENCY",
  maxClaimAgeMs: "CLEAROTRON_MAX_CLAIM_AGE_MS",
  maxConcurrentRuns: "CLEAROTRON_MAX_CONCURRENT_RUNS",
  maxRetries: "CLEAROTRON_MAX_RETRIES",
  rateLimitDefaultBackoffMs: "CLEAROTRON_RATE_LIMIT_DEFAULT_BACKOFF_MS",
  rateLimitProbeMs: "CLEAROTRON_RATE_LIMIT_PROBE_MS",
  rateLimitProbeCeilingMs: "CLEAROTRON_RATE_LIMIT_PROBE_CEILING_MS",
};

/** The one declared exemption, named here so it is a decision in the test rather than a hole in it. */
const EXEMPT_FROM_REFUSAL = new Set(["cardConcurrency"]);

function withEnv(vars, fn) {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  try {
    for (const [k, v] of Object.entries(vars)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    return fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

test("the population is the whole table, so a setting added without a test cannot hide", () => {
  // The growth property. Without this, a ninth setting added to NUMERIC_SETTING_DEFAULTS gets none of
  // the arms below and nothing says so — every one of them iterates ACCESSORS, not the table.
  assert.deepEqual(
    Object.values(ACCESSORS).slice().sort(),
    Object.keys(NUMERIC_SETTING_DEFAULTS).slice().sort(),
    "every numeric setting must be reachable from an accessor this file drives. Add the new one to "
    + "ACCESSORS (and decide, in writing, whether it refuses or is exempt).");
});

test("NO accessor can answer NaN for ANY input — the property the wedge violated", () => {
  // The class assertion. Refusing and defaulting are both acceptable answers; NaN is not, and it is the
  // only answer that fails silently, because every comparison against it is false.
  const NONSENSE = ["two", "banana", "3x", "1,5", "--", "e", "Infinity!"];
  let checked = 0;
  for (const [accessor, name] of Object.entries(ACCESSORS)) {
    for (const raw of NONSENSE) {
      withEnv({ [name]: raw }, () => {
        checked++;
        let value;
        try { value = config[accessor]; } catch { return; }   // a named refusal is a valid answer
        assert.ok(!Number.isNaN(value),
          `config.${accessor} answered NaN for ${name}="${raw}". NaN makes every comparison false, so `
          + `the caller neither errors nor works — it waits, or loops, or treats everything as stale.`);
      });
    }
  }
  assert.equal(checked, Object.keys(ACCESSORS).length * NONSENSE.length,
    "the loop must actually have driven every accessor against every value");
});

test("a non-numeric value is REFUSED by name, and the message says what to do about it", () => {
  for (const [accessor, name] of Object.entries(ACCESSORS)) {
    if (EXEMPT_FROM_REFUSAL.has(accessor)) continue;
    withEnv({ [name]: "two" }, () => {
      assert.throws(() => config[accessor], (e) => {
        assert.match(e.message, new RegExp(name),
          `the refusal must NAME the variable — an operator reading "not a number" learns nothing about `
          + `which of nine lines in their .env to look at`);
        assert.match(e.message, /"two"/, "and quote what it actually holds, so a stray space is visible");
        assert.match(e.message, new RegExp(String(NUMERIC_SETTING_DEFAULTS[name])),
          "and state the default, so the operator knows what removing the line would give them");
        return true;
      }, `config.${accessor} accepted a non-numeric ${name}`);
    });
  }
});

test("the ONE exemption is deliberate, and it still cannot answer NaN", () => {
  // cardConcurrency falls back rather than refusing, by RULE: a configuration typo discovered mid-run
  // must never turn a delivering search into a refusal, and this knob is not grade-moving. The fallback
  // is loud — see the arm above. This arm fails the day someone converts it without moving the
  // exemption, which is the point.
  withEnv({ CLEAROTRON_CARD_CONCURRENCY: "banana" }, () => {
    assert.equal(config.cardConcurrency, 8,
      "the documented fallback stands until the ruling says otherwise — but it is now a DECLARED "
      + "exemption routed through the same resolver, not an accident of which guard this getter used");
  });
});

test("the ONE fallback is LOUD — it says so by name, in the run's own record", () => {
  // The owner's rule, and the reason the exemption is allowed at all: a configuration typo discovered
  // mid-run must never turn a delivering search into a refusal — but a fallback nobody can see is how a
  // deployment ends up running on a number nobody chose, which is this issue's own defect one register
  // quieter. Continuing silently is not one of the two options.
  const line = fallbackNoteFor("CLEAROTRON_CARD_CONCURRENCY", { env: { CLEAROTRON_CARD_CONCURRENCY: "eihgt" } });
  assert.match(line, /CLEAROTRON_CARD_CONCURRENCY/, "it must NAME the variable — the operator has nine to choose from");
  assert.match(line, /"eihgt"/, "and quote what it holds, so a stray character is visible");
  assert.match(line, /\b8\b/, "and state the number the run actually used, not just that something went wrong");

  // And it is SILENT when there is nothing to disclose, so the line means something when it appears.
  assert.equal(fallbackNoteFor("CLEAROTRON_CARD_CONCURRENCY", { env: { CLEAROTRON_CARD_CONCURRENCY: "12" } }), null);
  assert.equal(fallbackNoteFor("CLEAROTRON_CARD_CONCURRENCY", { env: {} }), null,
    "an unset value took the default by design, which is not a misconfiguration and must not read as one");
});

test("the pipeline actually EMITS that line — the note is wired, not merely available", () => {
  // A helper nothing calls discloses nothing. The one consumer is the card fan-out, so the assertion is
  // against the source that calls it: an exported sentence with no caller is the shape that passes its
  // own unit test and ships silence.
  const src = readFileSync(join(DRIVER, "pipeline.mjs"), "utf8");
  assert.match(src, /fallbackNoteFor\("CLEAROTRON_CARD_CONCURRENCY"\)/,
    "the card fan-out must ask for the disclosure");
  assert.match(src, /if \(cardCapNote\) note\(/,
    "and write it to the run record when there is one");
});

test("#1340's contract survives the conversion — blank, unset and whitespace still take the default", () => {
  // Not a re-test of for its own sake: this conversion moved every one of those reads, and a
  // resolver that treated "" as 0 would reintroduce the exact defect fixed, silently.
  for (const blank of [undefined, "", "   ", "\t", "\n"]) {
    const env = Object.fromEntries(Object.values(ACCESSORS).map((v) => [v, blank]));
    withEnv(env, () => {
      for (const [accessor, name] of Object.entries(ACCESSORS)) {
        assert.equal(config[accessor], NUMERIC_SETTING_DEFAULTS[name],
          `${accessor} with every numeric variable ${JSON.stringify(blank)} — a blank is "not `
          + `configured", and Number("") is 0 rather than NaN, which is how it used to pass for one`);
      }
    });
  }
});

test("range is untouched — an explicit zero is a CHOICE, not a misconfiguration", () => {
  withEnv({ CLEAROTRON_MAX_CLAIM_AGE_MS: "0" }, () => assert.equal(config.maxClaimAgeMs, 0));
  withEnv({ CLEAROTRON_MAX_RETRIES: "0" }, () => assert.equal(config.maxRetries, 0));
  withEnv({ CLEAROTRON_GATHER_CONCURRENCY: "1" }, () => assert.equal(config.gatherConcurrency, 1));
  // A value below a floor is floored, exactly as before — refusing it would be a range judgement this
  // change deliberately does not make.
  withEnv({ CLEAROTRON_MAX_CONCURRENT_RUNS: "0" }, () => assert.equal(config.maxConcurrentRuns, 1));
  withEnv({ CLEAROTRON_MAX_CONCURRENT_RUNS: "-1" }, () => assert.equal(config.maxConcurrentRuns, 1));
});

test("an unknown name refuses rather than inventing a default", () => {
  assert.throws(() => numericSetting("CLEAROTRON_NOT_A_SETTING"), /not a known numeric setting/,
    "a name absent from the table is a typo in the CODE, and it must not resolve to a plausible number");
});

test("ONE definition of each default — no read site carries its own copy any more", () => {
  // The literal 2 was written three times for one variable: the getter, pipeline.acquireRunSlot and
  // portal-service. Two independent copies of one number is the shape that drifts; three is the shape
  // that already had.
  const OFFENDERS = [];
  const FILES = ["driver.config.mjs", "pipeline.mjs", "portal-service.mjs", "status-snapshot.mjs", "runner.mjs"];
  const NAMES = Object.keys(NUMERIC_SETTING_DEFAULTS);
  for (const f of FILES) {
    const src = readFileSync(join(DRIVER, f), "utf8");
    src.split("\n").forEach((line, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;                       // the docblocks discuss the old shape
      for (const name of NAMES) {
        if (new RegExp(`Number\\s*\\(\\s*(process\\.env\\.|this\\.envValue\\()\\s*"?${name}`).test(line)
          || new RegExp(`process\\.env\\.${name}\\s*\\|\\|`).test(line))
          OFFENDERS.push(`${f}:${i + 1}: ${line.trim()}`);
      }
    });
  }
  assert.deepEqual(OFFENDERS, [],
    "these resolve a numeric setting themselves instead of going through numeric-setting.mjs, so they "
    + "carry their own copy of the default and can produce NaN:\n  " + OFFENDERS.join("\n  "));
});

test("the guard above can SEE the two files the issue was about — control", () => {
  // The arm this one replaces scanned driver.config.mjs ALONE, so both actual offenders — pipeline.mjs
  // and portal-service.mjs — were invisible to it by construction. A guard that cannot see the sites the
  // issue is about is the defect, not the evidence. This drives the guard's own matcher against the
  // exact text those two lines used to carry.
  const WAS = [
    'const cap = Math.max(1, Number(process.env.CLEAROTRON_MAX_CONCURRENT_RUNS || config.maxConcurrentRuns || 1));',
    'const concurrentRunsCap = () => Math.max(1, Number(process.env.CLEAROTRON_MAX_CONCURRENT_RUNS || 2));',
    '  get maxRetries() { return Number(this.envValue("CLEAROTRON_MAX_RETRIES") || 2); },',
  ];
  for (const line of WAS) {
    const hit = Object.keys(NUMERIC_SETTING_DEFAULTS).some((name) =>
      new RegExp(`Number\\s*\\(\\s*(process\\.env\\.|this\\.envValue\\()\\s*"?${name}`).test(line)
      || new RegExp(`process\\.env\\.${name}\\s*\\|\\|`).test(line));
    assert.ok(hit, `the guard would not have caught this line, so its green means nothing:\n  ${line}`);
  }
});

test("acquireSlot refuses a cap that can never admit anyone, instead of waiting on it forever", async () => {
  const dir = mkdtempSync(join(tmpdir(), "slotcap-"));
  try {
    for (const cap of [NaN, 0, -1, "2", null, undefined, 1.5]) {
      await assert.rejects(() => acquireSlot({ dir, cap, pollMs: 1 }), /cap must be a positive integer/,
        `acquireSlot(cap=${JSON.stringify(cap)}) must refuse — waiting on it is indistinguishable from `
        + `ordinary contention and never ends`);
    }
    // The positive control: the guard must not have made the module refuse everything.
    const h = await acquireSlot({ dir, cap: 1, pollMs: 1 });
    assert.ok(h.slot, "a real cap still grants a slot");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("freeSlots refuses the same cap — it fails in the OPPOSITE direction, which is worse", () => {
  // acquireSlot with a NaN cap admits NOBODY. freeSlots with a NaN cap admits EVERYONE:
  // Math.max(0, NaN - live) is NaN, `NaN <= 0` is false, and the runner's admission loop breaks on
  // `budget <= 0` — so the budget never runs out and every queued job is claimed at once. Both come
  // from one typo, and the two arms are written separately because passing one proves nothing about
  // the other.
  const dir = mkdtempSync(join(tmpdir(), "freecap-"));
  try {
    for (const cap of [NaN, 0, -1, "2", null, undefined]) {
      assert.throws(() => freeSlots({ dir, cap }), /cap must be a positive integer/,
        `freeSlots(cap=${JSON.stringify(cap)}) must refuse`);
    }
    assert.equal(freeSlots({ dir, cap: 2 }), 2, "a real cap still counts — the control");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the REPORTING surfaces render the misconfiguration instead of dying of it", () => {
  // The engine refuses a non-numeric cap. These two must not: they are what an operator opens to find
  // out why nothing is draining, and a misconfiguration that took them out would be a worse failure
  // than the wedge being fixed.
  withEnv({ CLEAROTRON_MAX_CONCURRENT_RUNS: "two" }, () => {
    assert.equal(concurrentRunsCap(), null,
      "the portal states the cap it has or says nothing — never a number nobody chose. slotNote already "
      + "draws no line for a null cap, so the screen degrades to silence rather than to a wrong promise");

    const snap = statusSnapshot({ now: "2026-08-26T00:00:00Z", queueDirs: [], runLockDir: "/no/locks", enumerate: () => [] });
    assert.equal(snap.slots.run.cap, null, "an unresolvable cap is reported as absent, not as a number");
    assert.match(snap.slots.run.capProblem, /CLEAROTRON_MAX_CONCURRENT_RUNS/,
      "and the snapshot carries the reason, naming the variable — this is the surface that has to say WHY");
  });

  // Control: with a good value both surfaces state the number, so the arms above are not passing on a
  // surface that reports null unconditionally.
  withEnv({ CLEAROTRON_MAX_CONCURRENT_RUNS: "3" }, () => {
    assert.equal(concurrentRunsCap(), 3);
    const snap = statusSnapshot({ now: "2026-08-26T00:00:00Z", queueDirs: [], runLockDir: "/no/locks", enumerate: () => [] });
    assert.equal(snap.slots.run.cap, 3);
    assert.equal(snap.slots.run.capProblem, undefined,
      "no problem field when there is no problem — an always-present field reads as a permanent fault");
  });
});

test("statusSnapshot still takes an injected number, which is what every caller passes", () => {
  const snap = statusSnapshot({ now: "2026-08-26T00:00:00Z", queueDirs: [], runLockDir: "/no/locks", runCap: 3, enumerate: () => [] });
  assert.equal(snap.slots.run.cap, 3);
});
