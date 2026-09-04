// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// CRITERION 3 — "Every other provider's ceiling behaviour is byte-identical — ASSERT IT, DO NOT
// ASSUME IT."
//
// ── WHY THIS FILE EXISTS AT ALL ─────────────────────────────────────────────────────────────────────
//
// The criterion was certified by an ad-hoc direct-call script that ran 7/7 and was never committed. That
// was honest point-in-time evidence and nobody is calling the measurement wrong — but a script that ran
// once asserts nothing GOING FORWARD, which is the distinction the criterion's own wording draws. Ruled
// by overwatch 2026-08-17: parity claims of this class get committed pins here, on the b04d6d58
// byte-level-argv precedent. stays open until this is on main.
//
// ── WHAT "BYTE-IDENTICAL" HAS TO MEAN TO BE TESTABLE ────────────────────────────────────────────────
//
// Not "the code looks the same". The kernel is SHARED — `makeEnumerate` — and added exactly one
// seam to it: an optional `ceilingFor(params)` that narrows the tuned ceiling by a window the query
// SHAPE imposes. So parity is provable as a differential over that seam:
//
//   · a provider that passes NO `ceilingFor` (every one but signa) must behave exactly as it did;
//   · a provider that passes one which DECLINES this shape (returns null) must be indistinguishable
//     from the first — that is the load-bearing half, because signa itself is in that state on every
//     shape but the owner-scoped one;
//   · and a `ceilingFor` that DOES fire must behave differently, or the two arms above are measuring
//     nothing.
//
// The third arm is what stops this file passing on a seam that was silently removed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const { makeEnumerate } = await import("../enumerate.mjs");
const { ownerWindowCeiling, OWNER_SCOPED_WINDOW } = await import("../../signa/src/core.js")
  .then((m) => import("../../signa/src/capabilities.js").then((c) => ({ ...m, OWNER_SCOPED_WINDOW: c.OWNER_SCOPED_WINDOW })));

const PROVIDERS = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ok = (obj) => ({ type: "text", text: JSON.stringify(obj) });
const parse = (r) => JSON.parse(r.text);
const rows = (n, tag) => Array.from({ length: n }, (_, i) => ({ record_id: `/mark/ch/${tag}-${i}` }));

// ── 1. THE POPULATION, DISCOVERED ───────────────────────────────────────────────────────────────────

test("#1104: exactly ONE provider declares a shape ceiling, and the list is discovered not recited", () => {
  // Read off the cores rather than naming them: a tenth provider that quietly starts passing
  // `ceilingFor` has changed the parity claim this file makes, and it must fail here on the commit that
  // does it rather than at some later round. The same reason 's sweep greps the servers.
  const cores = readdirSync(PROVIDERS, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== "_shared" && d.name !== "oauth-mcp-bridge")
    .map((d) => ({ name: d.name, path: join(PROVIDERS, d.name, "src", "core.js") }))
    .filter((c) => { try { readFileSync(c.path, "utf8"); return true; } catch { return false; } });

  assert.ok(cores.length >= 8, `only ${cores.length} provider core(s) found — the walk itself has gone stale`);

  const kernelUsers = cores.filter((c) => /makeEnumerate\(/.test(readFileSync(c.path, "utf8")));
  assert.ok(kernelUsers.length >= 2, "fewer than two providers build on the shared enumerate kernel — the walk is dead");

  const declaring = kernelUsers
    .filter((c) => /^\s*ceilingFor:/m.test(readFileSync(c.path, "utf8")))
    .map((c) => c.name);
  assert.deepEqual(declaring, ["signa"],
    "the set of providers declaring a query-shape ceiling changed. #1104's parity claim is that signa is "
    + "the only one; a new declarer means every OTHER provider's behaviour is no longer trivially the old "
    + "line, and the differential below has to be re-run against it.");
});

// ── 2. THE PARITY, AS A DIFFERENTIAL OVER THE SEAM ──────────────────────────────────────────────────

// One stub, driven three ways. `total_hits` sits ABOVE signa's owner window and BELOW the tuned ceiling,
// which is the only band where the seam can express itself at all — outside it the three configurations
// agree trivially and the test would prove nothing.
const TOTAL = OWNER_SCOPED_WINDOW + 205;
const CEILING_DEFAULT = OWNER_SCOPED_WINDOW * 4;

function harness(ceilingFor) {
  const calls = [];
  const { enumerate } = makeEnumerate({
    search: async (_auth, params) => {
      calls.push({ ...params });
      return ok({ total_hits: TOTAL, results: rows(Math.min(50, TOTAL), "p"), has_more: false });
    },
    count: async () => ({ ok: true, total: TOTAL }),
    screen: async (_a, p) => ok({ rows: (p.uris ?? []).map((u) => ({ uri: u, live_status: "live" })) }),
    capabilities: { countProbe: "endpoint", screenSource: "billed-record-fetch", ceilingDefault: CEILING_DEFAULT },
    ...(ceilingFor ? { ceilingFor } : {}),
  });
  return { enumerate, calls };
}

// An OWNER-SCOPED band — the one shape signa's window applies to — so the three configurations are
// compared on the input where they are allowed to differ.
const OWNER_BAND = Object.freeze({ owner: "Mystery Owner LLC", nice_classes: [9, 41], in_scope_classes: [9, 41] });

const run = async (ceilingFor) => {
  const h = harness(ceilingFor);
  const out = parse(await h.enumerate({ apiKey: "k" }, { ...OWNER_BAND }, {}));
  return { out, calls: h.calls };
};

test("#1104: NO ceilingFor and a ceilingFor that DECLINES this shape are byte-identical", async () => {
  const none = await run(null);              // every provider but signa
  const declines = await run(() => null);    // signa on every shape but the owner-scoped one

  assert.deepEqual(JSON.parse(JSON.stringify(declines.out)), JSON.parse(JSON.stringify(none.out)),
    "a provider whose ceilingFor declines this shape produced a DIFFERENT descriptor from one that has no "
    + "ceilingFor at all. #1104's whole safety argument is that the seam is inert unless a window fires.");
  assert.deepEqual(declines.calls, none.calls,
    "…and it issued different requests. Parity has to hold on the wire, not only in the answer: an extra "
    + "or narrower page is a behaviour change no descriptor comparison would show.");
});

test("#1104 NEGATIVE CONTROL: a ceilingFor that FIRES is not identical — the seam is real", async () => {
  // Without this, both arms above would pass just as happily against a build where `ceilingFor` had been
  // deleted from the kernel and the parameter silently ignored — the vacuous-guard shape.
  const none = await run(null);
  const fires = await run(ownerWindowCeiling);   // signa's REAL declaration, on the shape it applies to

  assert.notDeepEqual(fires.out, none.out,
    "signa's owner window did not change the outcome on an owner-scoped band above it — either the seam "
    + "is gone or this fixture no longer straddles the window, and both arms above are then vacuous");
  assert.equal(fires.out.state, "incomplete", "an owner band over the window is an honest incomplete, never a clean");
  assert.match(String(fires.out.reason), new RegExp(`exceeds the enumerate ceiling ${OWNER_SCOPED_WINDOW}`),
    "the descriptor must name the WINDOW that stopped it, not the provider's tuned ceiling — a reader has "
    + "to be able to tell a vendor result-window from a resource crowd");
});

// ── 3. SIGNA'S OWN DECLARATION, TESTED DIRECTLY ─────────────────────────────────────────────────────

test("#1104: ownerWindowCeiling returns the window for owner-scoped shapes and NULL for every other", () => {
  // Its doc block says it is exported so the declaration can be tested directly instead of inferred from
  // a band. Taking that at its word: the `null` half is the load-bearing one, because returning 400
  // across the board would turn every tractable band over 400 into a sanctioned crowd — an UNDER-SEARCH
  // wearing a crowd descriptor's clothes.
  assert.equal(ownerWindowCeiling({ owner: "Mystery Owner LLC" }), OWNER_SCOPED_WINDOW);
  assert.equal(ownerWindowCeiling({ owner: "Mystery Owner LLC", names: ["NOVAPULSE"] }), OWNER_SCOPED_WINDOW,
    "an owner×term slice is owner-scoped too — the window is the vendor's, not the query's simplicity");

  for (const shape of [{ query: "NOVAPULSE" }, { names: ["NOVAPULSE", "NOVAPULSA"] }, { query: "NOVAPULSE", nice_classes: [9] }, {}])
    assert.equal(ownerWindowCeiling(shape), null,
      `a non-owner-scoped shape must decline the window: ${JSON.stringify(shape)}`);
});

test("#1104: the window is a MINIMUM against the tuned ceiling, never a maximum", async () => {
  // `Math.min`, asserted through the kernel rather than read off the source. A shape window is a vendor
  // limit: a band that pages past it does not return more records, it returns an HTTP 400. If this ever
  // became a max, a tuned-down ceiling would be silently widened by a vendor constraint.
  const h = harness(() => OWNER_SCOPED_WINDOW);
  const { enumerate } = makeEnumerate({
    search: async () => ok({ total_hits: TOTAL, results: rows(10, "p"), has_more: false }),
    count: async () => ({ ok: true, total: TOTAL }),
    screen: async (_a, p) => ok({ rows: (p.uris ?? []).map((u) => ({ uri: u, live_status: "live" })) }),
    capabilities: { countProbe: "endpoint", screenSource: "billed-record-fetch", ceilingDefault: 10 },
    ceilingFor: () => OWNER_SCOPED_WINDOW,
  });
  const out = parse(await enumerate({ apiKey: "k" }, { ...OWNER_BAND }, {}));
  assert.match(String(out.reason), /exceeds the enumerate ceiling 10\b/,
    "the TUNED ceiling (10) is lower than the shape window and must win — min, never max");
  assert.ok(h, "harness constructed");
});
