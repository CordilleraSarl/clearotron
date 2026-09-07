// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// / — THE REGISTER GRANT SENTENCE, AND THE CARVE-OUT THAT EXCUSES
// A DECK BUT NOT A DOCTRINE.
//
// ── THE BLIND SPOT THIS FILE EXISTS TO CLOSE ────────────────────────────────────────────────────────
//
// The agreement check reads the AMBIENT provider, and `scripts/test-run.mjs` sets one when nothing else
// does. So CI has only ever evaluated one row of a six-row table, and every finding that depends on
// which provider is mounted has been invisible to it. Measured on the base of this change: two providers
// were clean and four were not, and no run of the suite could say so.
//
// `REGISTER_PROVIDER` is an IIFE evaluated at module load, so the provider CANNOT be swapped in-process
// — mutating `process.env` after the import changes nothing. The per-provider arm therefore spawns, and
// that is not a workaround: spawning is what makes it exercise the real composition path under a real
// environment, which is the thing CI was never doing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { REGISTER_SERVERS } from "../engine/mcp/gather-config.mjs";
import { agreementFindings, INSTRUCTION, ATTEMPT_1 } from "../recording-agreement.mjs";
import { grantVocabularySentence, HELD_BUT_NOT_CALLED } from "../register-grant-vocabulary.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PROVIDERS = Object.keys(REGISTER_SERVERS);

test("the population is every provider the engine can mount — not the one the runner happens to set", () => {
  assert.ok(PROVIDERS.length >= 4,
    `only ${PROVIDERS.length} register providers — this file asserts about a table that lost its members, not a pass`);
});

// ── THE CARVE-OUT, PLANTED IN BOTH DIRECTIONS ───────────────────────────────────────────────────────

/** One synthetic subject: a withheld tool named once, on a surface the caller chooses. */
const subjectOn = (surface) => ({
  stage: "register-unit",
  granted: new Set(["Read"]),                       // deliberately does NOT hold the tool
  artifacts: [],
  union: [{ surface, kind: INSTRUCTION, phase: ATTEMPT_1,
    text: "Your register key also carries `register_image_fetch`, which you do not call." }],
  toolUniverse: ["register_image_fetch"],
  providerUnavailable: new Set(["register_image_fetch"]),
  providerConditionalSurfaces: new Set(["pointer:driver/skills/prelim-register/providers/acmereg.md"]),
});

test("⭐ PLANT: the ACTIVE PROVIDER'S OWN DECK is a carve-out by construction — no phrase required", () => {
  // The sentence carries none of PROVIDER_CONDITIONAL_MARKERS' four phrases on purpose: if this passes
  // only because the text happens to match one, the arm is measuring the old mechanism.
  const f = agreementFindings(subjectOn("pointer:driver/skills/prelim-register/providers/acmereg.md"));
  assert.deepEqual(f, [],
    "a withheld tool named in the ACTIVE provider's own deck is still reported. That deck is selected BY "
    + "the provider, so it cannot assert a capability of a deployment it does not describe — this is the "
    + "carve-out, and without it the excuse falls back to matching prose, which had already drifted.");
});

test("⭐ PLANT: the SAME sentence in provider-independent doctrine is NOT excused", () => {
  // The other half, and the reason the carve-out is on the surface and never on the tool: identical text,
  // identical withheld set, different provenance. Excusing the TOOL would silence this too.
  const f = agreementFindings(subjectOn("skill:driver/skills/prelim-register/unit.md"));
  assert.deepEqual(f.map((x) => [x.direction, x.tool]), [["ordered-but-not-granted", "register_image_fetch"]],
    "shared doctrine asserting a capability the active provider lacks is a real finding, and it went "
    + "quiet. Every deployment reads that sentence, including the ones it is false for.");
});

// ── THE COMPOSED SENTENCE ───────────────────────────────────────────────────────────────────────────

test("the grant sentence names only what THIS provider serves, for every provider", () => {
  for (const p of PROVIDERS) {
    const served = new Set(REGISTER_SERVERS[p].tools ?? []);
    const sentence = grantVocabularySentence(p) ?? "";
    for (const tool of HELD_BUT_NOT_CALLED) {
      assert.equal(sentence.includes(tool), served.has(tool),
        `${p}: the grant sentence ${sentence.includes(tool) ? "names" : "omits"} ${tool}, and the provider `
        + `${served.has(tool) ? "serves" : "does not serve"} it. A sentence that asserts a capability the `
        + "deployment lacks is what tracker issue 2034 is; one that omits a tool the seat holds is what "
        + "tracker issue 1930's other direction is.");
    }
  }
});

test("⭐ PLANT: an UNRESOLVED provider omits the sentence — it never composes an empty one", () => {
  // The trap this arm exists for: `providerUnavailableRegisterTools` answers an unresolved provider with
  // an EMPTY withheld set, deliberately, because it must never throw. Composed into this sentence an
  // empty withheld set reads as "your grant carries all of them" — 's defect restored
  // silently, on exactly the `--experiment` single-stage path a diagnosis reaches for.
  assert.equal(grantVocabularySentence("nonsuch-provider"), null,
    "an unknown provider composed a sentence. Omission is the only honest output when the deployment is "
    + "unknown — an empty list rendered into this sentence asserts a capability set nobody resolved.");
  for (const tool of HELD_BUT_NOT_CALLED) {
    assert.equal((grantVocabularySentence("nonsuch-provider") ?? "").includes(tool), false,
      `${tool} appears in a sentence composed for an unresolved provider`);
  }
});

// ── THE WHOLE CHECK, UNDER EVERY PROVIDER ───────────────────────────────────────────────────────────

test("the agreement check passes under EVERY register provider, not only the runner's default", () => {
  const red = [];
  for (const p of PROVIDERS) {
    // ✕ THE CHILD'S EXIT CODE IS NOT THE VERDICT HERE, and this arm was a FALSE GREEN until it was.
    //
    // Measured: a nested `node --test` that INHERITS `NODE_TEST_CONTEXT` from the runner spawning it
    // exits 0 on a failing run.
    //     CLEAROTRON_DATABASE=<p> node scripts/test-run.mjs node --test <file>   -> exit 1
    //     NODE_TEST_CONTEXT=child-v8 <the same command>                          -> exit 0
    // Spreading `process.env` carries that variable in, so every provider reported success while one of
    // them genuinely failed — this arm asserted a six-provider class and could not fail for any member.
    //
    // So: strip the inherited test context, AND read the child's own summary line rather than its
    // status. Two channels, because the one that was trusted is the one that lied.
    //
    // The trap is already known here and cost someone an hour when it was found:
    // driver/test/unexecuted-asserts.test.mjs deletes the same variable, for the same reason, and its
    // note says a child that inherits it "configures no reporters at all". Two arms now, one lesson —
    // cited rather than re-derived.
    const env = { ...process.env, CLEAROTRON_DATABASE: p };
    for (const k of Object.keys(env)) if (k.startsWith("NODE_TEST_")) delete env[k];
    let out = "", status = 0;
    try {
      out = execFileSync(process.execPath, ["scripts/test-run.mjs", "node", "--test", "driver/test/recording-agreement.test.mjs"],
        { cwd: REPO, env, stdio: "pipe", encoding: "utf8" });
    } catch (e) {
      out = `${e.stdout ?? ""}${e.stderr ?? ""}`;
      status = e.status ?? 1;
    }
    const failed = /^# fail (\d+)/m.exec(out);
    if (!failed) { red.push(`${p}: the child printed no '# fail' summary — could not look, which is never a pass`); continue; }
    if (status !== 0 || failed[1] !== "0") {
      const rows = [...out.matchAll(/'(ordered-but-not-granted|granted-but-never-ordered|hand-write-ordered) · [^']+'/g)].map((m) => m[0]);
      red.push(`${p}: exit ${status}, ${failed[1]} failing — ${rows.length ? rows.join(", ") : "read the child's output"}`);
    }
  }
  assert.deepEqual(red, [],
    "a register provider's orders and its grant disagree. This is the axis CI could not see: the runner "
    + "sets one provider, so five of these rows have never been evaluated by any run of the suite.\n  "
    + red.join("\n  "));
});
