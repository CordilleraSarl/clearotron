// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// unit-state-verdict.test.mjs —.
//
// The "units active" arm failed `prelim-driver` for DOING ITS JOB. It is a `Type=oneshot` fired by a
// 90-second timer, so every drain passes through `activating`, and the arm called anything that was
// neither `active` nor `inactive` a fault. deploy-test.sh gates the hourly test-instance deploy on this
// script's exit code, so the false red took a healthy deploy to exit 1.
//
// The property under test is not "activating is allowed". It is: **the check fails a unit for being
// broken, and for nothing else.** Which means every test below that proves a state is tolerated is
// paired with one that proves `failed` still fails — a fix that is a general loosening passes the first
// half and dies on the second.
//
// The states themselves are not invented here. They are systemd 255's six documented ActiveState values
// (`man 5 org.freedesktop.systemd1`, the version on the test and production boxes), and the completeness
// of that list is itself pinned below: it is what makes `failed` a real discriminator rather than the
// only string somebody happened to remember.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { unitsActiveVerdict, classifyActiveState, ACTIVE_STATE_MEANING } from "../unit-state-verdict.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OK = { ok: true, why: null };
const v = (units, probe = OK) => unitsActiveVerdict({ units, probe });

// The eight units scripts/live-surface-check.mjs enumerates, minus the oneshot, all healthy.
const SERVICES = ["trademark-portal", "trademark-ops-mcp", "client-mcp", "client-mcp-apikey",
  "trademark-artifacts-http", "profile-service", "recipe-service"]
  .map((unit) => ({ unit, active: "active", type: "simple" }));

// ── the regression this issue exists for ─────────────────────────────────────────────────────────────

test("#425: a oneshot caught mid-fire PASSES — the state observed on the test box, not a supposed one", () => {
  // Sampled at 0.2s on the test box, 1233 samples over 4m38s spanning three timer fires. Every fire
  // showed the same two-sample transit and nothing else was ever non-`inactive`:
  //   20:26:14.71 ActiveState=activating SubState=start        20:26:14.93 ... SubState=start-post
  //   20:27:44.80 ActiveState=activating SubState=start        20:27:45.02 ... SubState=start-post
  //   20:29:14.87 ActiveState=activating SubState=start        20:29:15.12 ... SubState=start
  // 90 seconds apart to the second, and under half a second wide — which is why this reads as a rare
  // intermittent red rather than a broken check. Before the fix this arm printed
  //   [ FAIL ] units active / prelim-driver=activating
  const r = v([...SERVICES, { unit: "prelim-driver", active: "activating", type: "oneshot" }]);
  assert.equal(r.state, "pass", `a oneshot mid-fire must not fail the deploy gate: ${r.message}`);
  assert.match(r.message, /prelim-driver=activating/);           // still SAID, never silently swallowed
  assert.match(r.message, /not a fault/);
});

test("#425: `deactivating` has the identical shape and gets the identical answer", () => {
  const r = v([...SERVICES, { unit: "prelim-driver", active: "deactivating", type: "oneshot" }]);
  assert.equal(r.state, "pass", r.message);
  assert.match(r.message, /prelim-driver=deactivating/);
});

test("#425: `reloading` is a running unit re-reading its config, not a fault", () => {
  const r = v([...SERVICES.slice(1), { unit: "trademark-portal", active: "reloading", type: "notify" }]);
  assert.equal(r.state, "pass", r.message);
});

// ── the anti-loosening half: `failed` still fails ────────────────────────────────────────────────────

test("`failed` STILL FAILS — this is the check's whole job and the fix must not have loosened it", () => {
  const r = v([...SERVICES, { unit: "prelim-driver", active: "failed", type: "oneshot" }]);
  assert.equal(r.state, "fail");
  assert.match(r.message, /prelim-driver=failed/);
  assert.match(r.message, /last run did not succeed/);
});

test("a failed unit fails even while another unit is legitimately mid-fire", () => {
  // The tolerance must not become a blanket: one transitional unit does not buy amnesty for a broken one.
  const r = v([...SERVICES.slice(1),
    { unit: "trademark-portal", active: "failed", type: "notify" },
    { unit: "prelim-driver", active: "activating", type: "oneshot" }]);
  assert.equal(r.state, "fail");
  assert.match(r.message, /trademark-portal=failed/);
});

test("a failed LONG-RUNNING service fails — the fix is not scoped to, or excused by, Type=oneshot", () => {
  const r = v([...SERVICES.slice(1), { unit: "trademark-portal", active: "failed", type: "simple" }]);
  assert.equal(r.state, "fail");
});

test("exactly one documented ActiveState means broken, and it is `failed`", () => {
  // Stated as a property so that widening the tolerated set later cannot quietly widen it to include a
  // real fault. If this number ever goes to 0, the arm has stopped being a check.
  const broken = Object.entries(ACTIVE_STATE_MEANING).filter(([, m]) => m === "broken").map(([s]) => s);
  assert.deepEqual(broken, ["failed"]);
});

// ── the vocabulary is systemd's, not this file's ─────────────────────────────────────────────────────

test("every one of systemd 255's six documented ActiveState values is mapped", () => {
  // `man 5 org.freedesktop.systemd1`, systemd 255.4-1ubuntu8.16:
  //   "The following states are currently defined: active, reloading, inactive, failed, activating,
  //    and deactivating."
  // Inverse enumeration over an INCOMPLETE list is the bug itself, so the list is pinned here.
  const documented = ["active", "reloading", "inactive", "failed", "activating", "deactivating"].sort();
  assert.deepEqual(Object.keys(ACTIVE_STATE_MEANING).sort(), documented);
  for (const s of documented) assert.notEqual(classifyActiveState(s), "unrecognised", `${s} is undocumented here`);
});

test("classifyActiveState maps each state to what the check must do about it", () => {
  assert.equal(classifyActiveState("active"), "running");
  assert.equal(classifyActiveState("reloading"), "running");
  assert.equal(classifyActiveState("activating"), "transitional");
  assert.equal(classifyActiveState("deactivating"), "transitional");
  assert.equal(classifyActiveState("inactive"), "at-rest");
  assert.equal(classifyActiveState("failed"), "broken");
  assert.equal(classifyActiveState(null), "absent");
  assert.equal(classifyActiveState("refreshing"), "unrecognised");   // a state a later systemd may add
});

test("a state this check does not know is a WARN — named, not failed, and not passed either", () => {
  // The shape, generalised: an unrecognised-but-benign state must never turn the deploy gate red,
  // and must never be waved through in silence.
  const r = v([...SERVICES, { unit: "prelim-driver", active: "refreshing", type: "oneshot" }]);
  assert.equal(r.state, "warn");
  assert.match(r.message, /prelim-driver=refreshing/);
  assert.match(r.message, /does not recognise/);
});

test("a broken unit outranks an unrecognised one — fail is not downgraded to warn", () => {
  const r = v([{ unit: "prelim-driver", active: "failed" }, { unit: "trademark-portal", active: "refreshing" }]);
  assert.equal(r.state, "fail");
});

// ── the zero-check, which this issue does NOT touch ─────────────────────────────────────────────
//
// A draft of this fix widened the count one branch below the fault branch — `running + transitional` —
// so that a lone oneshot mid-fire would read as "1 running" instead of "0 active". It made the message
// nicer and it destroyed the guard: with transitional counted as up, a box with NOTHING running passed.
// The three cases below are the exact inputs that proved it. They are pinned as tests because the
// argument for widening the count is genuinely tempting, and it will be made again.

test("#395 GUARD: {5 services activating, 3 inactive} is a SKIP — nothing is running on that box", () => {
  // deploy-test.sh restarts the long-running services immediately before running this check, so this is
  // the ORDINARY shape of the box mid-deploy, not a corner. Counting the 5 as up returned `pass` with a
  // message beginning "0 active" — the deploy's final gate going green having confirmed zero services up.
  const units = [...SERVICES.slice(0, 5).map((u) => ({ ...u, active: "activating" })),
    ...SERVICES.slice(5).map((u) => ({ ...u, active: "inactive" })),
    { unit: "prelim-driver", active: "inactive", type: "oneshot" }];
  const r = v(units);
  assert.equal(r.state, "skip", r.message);
  assert.match(r.message, /0 active units/);
  assert.match(r.message, /not the same as nothing being wrong/);
  assert.match(r.message, /5 starting or stopping/);   // still NAMED, just never counted as up
});

test("#395 GUARD: {7 services inactive, oneshot activating} is a SKIP, not a pass", () => {
  const r = v([...SERVICES.map((u) => ({ ...u, active: "inactive" })),
    { unit: "prelim-driver", active: "activating", type: "oneshot" }]);
  assert.equal(r.state, "skip", r.message);
  assert.match(r.message, /0 active units/);
});

test("#395 GUARD: every unit on the box deactivating is a SKIP — a shutdown is not a healthy deploy", () => {
  // profile-service and recipe-service are probed by no other arm, so if this one goes green on a box
  // that is shutting down, nothing else catches it.
  const r = v(SERVICES.map((u) => ({ ...u, active: "deactivating" })));
  assert.equal(r.state, "skip", r.message);
  assert.match(r.message, /0 active units/);
  assert.match(r.message, /7 starting or stopping/);
});

test("the count is origin/main's predicate: `active` literally, and nothing else", () => {
  // Stated against the classifier so that widening `running` or `transitional` later cannot widen the
  // count as a side effect. Only the literal string may be counted as up.
  const counted = Object.entries(ACTIVE_STATE_MEANING)
    .filter(([s]) => v([{ unit: "u", active: s }]).state === "pass").map(([s]) => s);
  assert.deepEqual(counted, ["active"]);
});

test("a transitional unit beside running ones is named in the message but not added to the count", () => {
  const r = v([...SERVICES, { unit: "prelim-driver", active: "activating", type: "oneshot" }]);
  assert.equal(r.state, "pass", r.message);
  assert.match(r.message, /^7 active/);                       // 7, not 8 — the oneshot is not counted
  assert.match(r.message, /1 starting or stopping/);
  assert.match(r.message, /not a fault/);
});

// ── what established, still standing ────────────────────────────────────────────────────────────

test("a reachable bus that enumerated no units at all is a skip, not a crash", () => {
  // `units` undefined is not a shape the script produces, but the module is exported and this branch
  // dereferences it. A TypeError here throws on the deploy's final gate, after every door has been probed.
  assert.equal(unitsActiveVerdict({ units: undefined, probe: OK }).state, "skip");
  assert.equal(v([]).state, "skip");
});

test("#395 survives: a failure to LOOK is a skip naming the error, never a finding about the box", () => {
  const r = v(SERVICES, { ok: false, why: "Failed to connect to bus: No such file or directory" });
  assert.equal(r.state, "skip");
  assert.match(r.message, /Failed to connect to bus/);
});

test("#395 survives: nothing running is a SKIP, not a green tick", () => {
  const r = v(SERVICES.map((u) => ({ ...u, active: "inactive" })));
  assert.equal(r.state, "skip");
  assert.match(r.message, /0 active units/);              // origin/main's wording, unchanged
  assert.match(r.message, /not the same as nothing being wrong/);
});

test("a oneshot AT REST is still tolerated — the behaviour the old filter got right is unchanged", () => {
  const r = v([...SERVICES, { unit: "prelim-driver", active: "inactive", type: "oneshot" }]);
  assert.equal(r.state, "pass", r.message);
  assert.match(r.message, /1 at rest/);
});

test("a unit that reported no ActiveState at all is a WARN — an absence is a finding", () => {
  // The bus answered (probe.ok), so this is a per-unit SILENCE, not a failure to look. It used to
  // return `pass`: silence graded better than a string the check does not recognise, which is backwards.
  const r = v([...SERVICES, { unit: "prelim-driver", active: null, type: null }]);
  assert.equal(r.state, "warn", r.message);
  assert.match(r.message, /reported no ActiveState at all/);
  assert.match(r.message, /prelim-driver/);
});

test("an absence is a warn even when everything else on the box is healthy", () => {
  // The seven services are `active`, so the count is non-zero and the arm would otherwise pass. The one
  // silent unit must still be surfaced rather than averaged away by its healthy neighbours.
  const r = v([...SERVICES, { unit: "profile-service", active: null }]);
  assert.equal(r.state, "warn", r.message);
  assert.match(r.message, /NOT being counted as healthy/);
});

test("a failure to LOOK still outranks a per-unit silence — #395's skip is not downgraded to a warn", () => {
  // With the bus unreachable no unit answers, so every unit classifies as `absent`. That must report the
  // bus error, not eight silences: the distinction exists for.
  const r = v(SERVICES.map((u) => ({ ...u, active: null })), { ok: false, why: "Failed to connect to bus" });
  assert.equal(r.state, "skip", r.message);
  assert.match(r.message, /Failed to connect to bus/);
});

// ── the caller must be able to DISPATCH what this returns ────────────────────────────────────────────

test("the arm is dispatched through record(), because ({pass,fail,skip})[state] has no `warn` key", () => {
  // A unit test of a pure module cannot see this: `warn` returned into the shorthand at line ~307 is
  // `undefined(...)` — a TypeError on the deploy's final gate, thrown AFTER every door has been probed
  // and BEFORE the report prints. So the wiring is asserted at source level.
  const src = readFileSync(join(HERE, "..", "..", "scripts", "live-surface-check.mjs"), "utf8");
  const arm = src.slice(src.indexOf("unitsActiveVerdict({"));
  assert.match(arm, /record\("units active", v\.state, v\.message\)/,
    "the units-active arm must go through record(), which handles every state including warn");
});

test("the inverse-enumeration filter is gone from the script", () => {
  // By shape rather than by line number. This is the one comparison changes; the count that lives
  // one branch below it is unchanged and merely moved, which is why only this shape is asserted absent.
  const src = readFileSync(join(HERE, "..", "..", "scripts", "live-surface-check.mjs"), "utf8");
  assert.doesNotMatch(src, /c\.active !== "active" && c\.active !== "inactive"/,
    "the inverse-enumeration filter is #425 itself");
});
