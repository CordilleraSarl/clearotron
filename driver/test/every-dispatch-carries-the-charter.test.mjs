// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — the depth directive rides EVERY dispatch of a graded stage family, not just the fresh one.
//
// THE DELIVERY RULE, and it exists because the delivered file came from the dispatch that did not have
// it. A dispatch with no `sessionKey` is a fresh turn: the driver rebuilds the whole message from
// `STAGES.<name>.message` and the directive is in there. A dispatch WITH a `sessionKey` resumes a
// session and sends only its followup — inheriting nothing the message builder produces. The synthesis
// family has four such warm dispatches, and until this landed all of them re-emitted the narrative
// under the DEFAULT contract while the fresh pass ran under the graded one.
//
// THIS IS A CALL-SITE ARM ON PURPOSE. `stageCharter` returning the right string proves nothing about a
// dispatch that never calls it — which was exactly the state: the composer was correct and the rung
// still never shipped. The arms below read the dispatch sites out of the source.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stageCharter } from "../pipeline.mjs";
import { proseRungDirective, inquiryRungDirective } from "../stages.mjs";
import { depthFor } from "../search-policy.mjs";

const SRC = readFileSync(new URL("../pipeline.mjs", import.meta.url), "utf8");
const WORLDWIDE = "global-preliminary-search", ONE = "full-country-search";
const depth = (p) => depthFor({ product: p });

/**
 * Every `stage("<name>", …)` call in the pipeline, with its options text.
 *
 * DERIVED, NEVER HAND-LISTED. A hand list stops at whoever was looking — the lesson paid for when
 * a hand-found list of ten entries turned out to be a scan's answer, not a person's.
 */
function dispatchesOf(stageName) {
  const out = [];
  const re = new RegExp(`stage\\("${stageName}",\\s*ctx\\s*,`, "g");
  for (const m of SRC.matchAll(re)) {
    // Take the option object by balancing braces from the first `{` after the call.
    const from = SRC.indexOf("{", m.index + m[0].length - 1);
    if (from < 0) { out.push({ index: m.index, opts: "" }); continue; }
    let d = 0, i = from;
    for (; i < SRC.length; i++) { if (SRC[i] === "{") d++; else if (SRC[i] === "}") { d--; if (!d) break; } }
    out.push({ index: m.index, opts: SRC.slice(from, i + 1) });
  }
  return out;
}

test("#1503 the fixture finds the dispatches at all — a zero here is an instrument fault, not a clean repo", () => {
  assert.ok(dispatchesOf("synthesis").length >= 4,
    `found ${dispatchesOf("synthesis").length} synthesis dispatches; the arms below would pass over an empty list`);
  assert.ok(dispatchesOf("placement-inquiry").length >= 1, "found no placement-inquiry dispatch");
});

test("#1503 every WARM synthesis dispatch carries the charter", () => {
  // Warm = resumes a session, so it sends only its followup. Fresh dispatches rebuild the message and
  // get the directive from the builder; they are not required to say so twice.
  const missing = dispatchesOf("synthesis")
    .filter((d) => /sessionKey\s*:/.test(d.opts))
    .filter((d) => !/stageCharter\(/.test(d.opts) && !/correctionsExtra\(/.test(d.opts));
  assert.deepEqual(missing.map((d) => d.opts.slice(0, 90)), [],
    "a synthesis dispatch resumes a session without the charter. It re-emits under the DEFAULT contract "
    + "while the fresh pass ran under the graded one — which is how prose for rung-excluded findings "
    + "reached a client.");
});

test("#1503 every warm PLACEMENT-INQUIRY dispatch carries it too — the family rule has no exceptions list", () => {
  // Today the inquiry family has no warm dispatch, so this passes vacuously — and it is written anyway,
  // because the next one added would otherwise inherit the exact defect this issue is about. An
  // exceptions list is where the next one comes from.
  const missing = dispatchesOf("placement-inquiry")
    .filter((d) => /sessionKey\s*:/.test(d.opts))
    .filter((d) => !/stageCharter\(/.test(d.opts));
  assert.deepEqual(missing.map((d) => d.opts.slice(0, 90)), []);
});

test("#1503 the charter IS the fresh dispatch's directive — one string, not two that agree today", () => {
  assert.equal(stageCharter("synthesis", depth(WORLDWIDE)).trim(), proseRungDirective(depth(WORLDWIDE)).trim());
  assert.equal(stageCharter("placement-inquiry", depth(WORLDWIDE)).trim(), inquiryRungDirective(depth(WORLDWIDE)).trim());
  assert.ok(stageCharter("synthesis", depth(WORLDWIDE)).length > 100, "the fixture composed nothing to compare");
});

test("#1503 the UNGRADED product adds nothing, and an unknown stage adds nothing", () => {
  // Byte-identical by construction on P4: the charter is empty, so a warm dispatch there sends exactly
  // what it sent before this landed.
  assert.equal(stageCharter("synthesis", depth(ONE)), "");
  assert.equal(stageCharter("placement-inquiry", depth(ONE)), "");
  assert.equal(stageCharter("register-digest", depth(WORLDWIDE)), "",
    "a stage with no graded directive grew one — the charter must not invent prose for a stage the "
    + "architecture table does not grade");
  assert.equal(stageCharter("synthesis", null), "");
});

// ── round 2: the site list was derived by a shape, and the shape was hand-typed ───────────────
//
// The header above says DERIVED, NEVER HAND-LISTED. It was — by `stage("synthesis",\s*ctx\s*,`, which is
// itself a hand-typed shape, and it missed every dispatch that passes the stage name in a VARIABLE:
//
//   pipeline.mjs  finding-reemit / action-reemit / ask-answer-reemit   stage(name,  ctx, …)
//   pipeline.mjs  lint-repair                                          stage(label, ctx, …)
//
// R2 on 44654e02 delivered a narrative without DEPTH OF WRITING. No retry was involved: three successive
// synthesis dispatches, all ok — fresh (charter), corrective (charter), then lint-repair (none). The
// lint-repair was triggered by `narrative-write-ups:over-cap:1`, 362 words against the 330 cap. **The
// dispatch sent to fix a charter violation was the one dispatched without the charter.** Found by
// role-e2e scruffy in the run dir; the population by eggie and this arm.
//
// Walking the tree does not fix a hand-typed shape, it moves the blind spot into the regex. So this
// scan balances braces instead of matching a call shape, reads shorthand properties (`followup,` as well
// as `followup:`), and does not require the second argument to be bare `ctx` — seven warm dispatches
// pass `{ ...ctx, axis }` and a `,\s*ctx\s*,` rule cannot see any of them.

/** Property present in an options object, shorthand (`{ followup }`) or not (`{ followup: x }`). */
const hasProp = (opts, key) => new RegExp(`(^|[{,\\s])${key}\\s*[:,}]`).test(opts);

/** Every `stage(…)` call in a file, with its stage-name expression and brace-balanced options text. */
function dispatchSites(src) {
  const out = [];
  for (const m of src.matchAll(/\bstage\(/g)) {
    let d = 0, i = m.index + "stage(".length;
    const commas = [];
    for (; i < src.length; i++) {
      const c = src[i];
      if (c === "(" || c === "{" || c === "[") d++;
      else if (c === ")" && d === 0) break;
      else if (c === ")" || c === "}" || c === "]") d--;
      else if (c === "," && d === 0) commas.push(i);
    }
    if (commas.length < 2) continue;
    const opts = src.slice(commas[commas.length - 1] + 1, i).trim();
    if (!opts.startsWith("{")) continue;
    out.push({ name: src.slice(m.index + "stage(".length, commas[0]).trim(), opts,
      line: src.slice(0, m.index).split("\n").length });
  }
  return out;
}

// A dispatch the charter rule can bite on: it resumes a session AND sends a followup, and its stage is
// one `stageCharter` serves — or is named by a VARIABLE, in which case it may be at run time.
const GRADED_LITERAL = /^"(synthesis|placement-inquiry)"$/;
const chartered = (o) => /stageCharter\(|correctionsExtra\(/.test(o);
const bitesHere = (s) => hasProp(s.opts, "sessionKey") && hasProp(s.opts, "followup")
  && (!s.name.startsWith('"') || GRADED_LITERAL.test(s.name));

test("#1603 every warm dispatch that could carry a charter does — counted, not merely non-empty", () => {
  const sites = dispatchSites(SRC);
  // CONTROL 1 — the scanner found dispatches at all. A balanced-brace walk that matched nothing would
  // agree with every assertion below over an empty list.
  assert.ok(sites.length >= 20, `the scan found ${sites.length} stage() call(s) — instrument fault`);

  const bite = sites.filter(bitesHere);
  // CONTROL 2 — and the CLASSIFIER selects. 's shape: assert the COUNT, because "none missing" is
  // satisfied forever by a filter that stopped selecting. If this number moves, a dispatch was added or
  // removed and somebody decides deliberately which it was — it is not a free update.
  assert.equal(bite.length, 8,
    `${bite.length} warm charter-relevant dispatch site(s), expected 8. Adding or removing one is a `
    + "decision: say which dispatch, and whether it resumes a session. Sites:\n  "
    + bite.map((s) => `:${s.line} ${s.name}`).join("\n  "));

  assert.deepEqual(bite.filter((s) => !chartered(s.opts)).map((s) => `:${s.line} ${s.name}`), [],
    "these warm dispatches send a followup into a resumed session without the depth charter, so the seat "
    + "re-emits under the DEFAULT contract while the fresh pass ran under the graded one");
});

test("#1603 the charter is safe at a site whose stage is only known at run time", () => {
  // Why appending it unconditionally at the variable-name sites is correct rather than merely convenient:
  // stageCharter returns "" for every stage it does not serve, so a re-emit of common-law or
  // register-unit is byte-identical to before.
  for (const notGraded of ["common-law", "register-unit", "common-law-half", "report-card", "narrative-refutation"])
    assert.equal(stageCharter(notGraded, depth(WORLDWIDE)), "",
      `${notGraded} is not a charter-bearing stage, so appending the charter must be a no-op there`);
  // CONTROL — and it is NOT a no-op where it counts, or the loop above proves nothing.
  assert.ok(stageCharter("synthesis", depth(WORLDWIDE)).length > 100,
    "the charter is empty for synthesis too, so the arm above cannot tell a no-op from a broken composer");
});
