// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// register-coverage-doors.test.mjs — 's top acceptance criterion: the refused products and the
// reason strings are IDENTICAL across doors.
//
// ── WHY THIS IS A SOURCE DERIVATION AND NOT FIVE SERVERS ────────────────────────────────────────────
//
// doors-agree.test.mjs drives five real doors, each with its own temp pool root, and that is right for
// what it checks. It is the wrong instrument here: this rule is decided from a SNAPSHOT FILE, so
// driving it end to end would mean planting a crafted snapshot into five independently-created temp
// directories, and a case that silently failed to plant one would pass by offering everything.
//
// The defect this rule can actually have is narrower and it is structural: a door that does not pass
// `geography` gets `null` from registerCoverageCause and keeps its old behaviour SILENTLY — no error,
// no refusal, just a door that offers what the others refuse. That is the exact asymmetry
// doors-agree.test.mjs was written for, and it is visible in the source.
//
// So: every availability call site in the product is DERIVED from source (never listed), and each must
// either thread coverage or be declared exempt WITH A REASON. Behaviour is pinned beside it, once, on
// the two functions all of them share.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { productAvailability, gateCause, UNAVAILABLE_NOTE, PRODUCT_POLICIES } from "../search-policy.mjs";
import { PRODUCTS } from "../products.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const src = (rel) => readFileSync(join(ROOT, rel), "utf8");

// Comments are stripped first, so a mention in prose is never read as a call site — the arm-3 lesson
//: a source assertion that matches its own documentation proves nothing.
const codeOf = (rel) => src(rel).split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l.trim())).join("\n");
const CALLS = /\b(productAvailability|gateCause|gateResolvedPolicy)\(/g;

/**
 * The ARGUMENT LIST of the call starting at `open`, by counting brackets to the matching close.
 *
 * Not a regex, and not the whole file — both were tried and both pin nothing. A regex bounded by the
 * first `)` truncates a call whose arguments span an object literal, which is every wired call here. A
 * whole-file search is worse: it matches the surviving `import { registerTerritoriesFor }` line, so
 * deleting the argument from the call leaves the test green. That break went SILENT until this existed.
 */
function argsAt(code, open) {
  let depth = 0;
  for (let i = open; i < code.length; i += 1) {
    const c = code[i];
    if (c === "(" || c === "{" || c === "[") depth += 1;
    else if (c === ")" || c === "}" || c === "]") {
      depth -= 1;
      if (depth === 0) return code.slice(open + 1, i);
    }
  }
  return code.slice(open);   // unbalanced ⇒ hand back the rest rather than silently matching nothing
}

/**
 * Every module that decides whether a product can be ordered. DERIVED, so a sixth surface cannot be
 * added without this test having an opinion about it.
 */
function availabilitySites() {
  const files = [
    "driver/portal-service.mjs", "driver/door-gates.mjs", "driver/dev-portal.mjs",
    "driver/runner.mjs", "driver/pipeline.mjs", "driver/search-policy.mjs",
    "mcp-server/lib/options.mjs", "mcp-server/lib/plan.mjs",
  ];
  const out = [];
  for (const f of files) {
    const code = codeOf(f);
    for (const m of code.matchAll(CALLS)) {
      out.push({ file: f, fn: m[1], args: argsAt(code, m.index + m[0].length - 1) });
    }
  }
  return out;
}

/**
 * The doors, as doors-agree.test.mjs itself defines them. READ FROM THAT FILE rather than restated:
 * it derives its list from every module calling validateJob( and declares the exceptions with reasons,
 * and a second hand-kept copy here would be one more list to fall behind.
 */
function declaredDoorSources() {
  const t = src("driver/test/doors-agree.test.mjs");
  const block = t.slice(t.indexOf("const DOOR_ADAPTERS"), t.indexOf("const DOORS"));
  return [...block.matchAll(/"((?:driver|mcp-server)\/[^"]+)"/g)].map((m) => m[1]);
}

// ── the exemptions, each with the reason it is one ──────────────────────────────────────────────────
//
// NOT a convenience list. Anything here is a place a client can be told a product is available when it
// is not, and the reason has to survive being read out loud.
const EXEMPT = {
  // THE WALL, not a door. A job already queued whose register cannot reach its territories still RUNS,
  // and the run discloses each unreachable territory as a deferred coverage row — which is the engine's
  // correct, documented answer. Refusing here would convert a disclosed gap into a dead run, and it
  // would do so to jobs that were legitimately ordered before the provider changed. The offer-side
  // refusal belongs at intake, where the requester can still choose differently.
  "driver/runner.mjs": "the admission wall — an unreachable territory is a DISCLOSED deferred row, not a refusal",
  "driver/pipeline.mjs": "in-run gate, same argument as the runner",
};

test("EVERY availability call site threads register coverage, or is exempt with a reason", () => {
  const unwired = [];
  for (const site of availabilitySites()) {
    if (EXEMPT[site.file]) continue;
    // search-policy.mjs is where the arm LIVES — its internal call is the implementation, not a door.
    if (site.file === "driver/search-policy.mjs") continue;
    if (!/registerTerritories/.test(site.args)) unwired.push(`${site.file} → ${site.fn}(…)`);
  }
  assert.deepEqual(unwired, [],
    "a door that omits registerTerritories keeps its OLD answer silently — it offers what the other "
    + "doors refuse, and nothing errors. Thread it, or add it to EXEMPT with the reason.");
});

test("a call site that threads coverage also states the product's GEOGRAPHY", () => {
  // registerCoverageCause needs both. `registerTerritories` without `geography` is the shape that reads
  // as wired and does nothing — the arm cannot fire, so the door silently keeps its old answer. Only
  // productAvailability takes geography directly; gateCause/gateResolvedPolicy derive it themselves.
  const half = availabilitySites().filter((s) =>
    s.fn === "productAvailability" && /registerTerritories/.test(s.args) && !/geography/.test(s.args));
  assert.deepEqual(half.map((s) => s.file), [], "coverage threaded but geography not — the arm cannot fire");
});

test("the exemption list names only the wall, never a door", () => {
  // If a module doors-agree.test.mjs drives as a DOOR ever appears in EXEMPT, an intake surface has
  // been quietly excused from this rule — which is how came to exist in the first place.
  const doors = declaredDoorSources();
  assert.ok(doors.length >= 5, `expected doors-agree's adapter list, got ${JSON.stringify(doors)}`);
  for (const f of Object.keys(EXEMPT)) {
    assert.ok(!doors.includes(f), `${f} is driven as a DOOR by doors-agree.test.mjs and may not be exempt`);
  }
  // And the converse: every door doors-agree drives must be a file this test actually inspected, or the
  // derivation above has a hole and a door could be added without either file noticing.
  const inspected = new Set(availabilitySites().map((s) => s.file));
  // enqueue.mjs (the CLI) and ops.mjs (start_run) reach the rule through door-gates.mjs rather than
  // calling it themselves — that shared module IS inspected above, so they are covered, not skipped.
  const VIA_DOOR_GATES = ["driver/enqueue.mjs", "mcp-server/lib/ops.mjs"];
  for (const f of VIA_DOOR_GATES) {
    assert.match(codeOf(f), /doorGates\(|gateResolvedRequest\(/, `${f} no longer routes through door-gates.mjs`);
  }
  const blind = doors.filter((d) => !inspected.has(d) && !VIA_DOOR_GATES.includes(d));
  assert.deepEqual(blind, [], "a door doors-agree drives that no availability site here covers");
});

// ── one behaviour, so the doors have nothing to disagree about ──────────────────────────────────────

test("productAvailability and gateCause give the SAME cause and the SAME sentence", () => {
  // Every door reaches one of these two. If they agree for all products over all coverage shapes, then
  // "identical across doors" reduces to the structural check above.
  const shapes = [undefined, null, [], ["European Union"], ["United States"], ["European Union", "United States"]];
  for (const t of shapes) {
    for (const p of PRODUCTS) {
      const policy = PRODUCT_POLICIES[p.id];
      const direct = productAvailability(policy, { registerTerritories: t, geography: p.geography });
      const viaGate = gateCause({ ...policy, product: p.id, stageLabel: p.name }, { registerTerritories: t });
      assert.equal(direct, viaGate?.cause ?? null,
        `${p.name} @ ${JSON.stringify(t)} — the menu and the gate disagree`);
      if (direct) assert.ok(UNAVAILABLE_NOTE[direct], `${direct} has no client-facing sentence`);
    }
  }
});
