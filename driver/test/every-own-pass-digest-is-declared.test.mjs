// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The digest-trigger funnel's invariant, enforced over the POPULATION of dispatch sites (tracker issue 116).
//
// WHY THIS ARM EXISTS. pipeline.mjs's funnel header said the queue is "the ONLY path to a non-fresh
// re-digest" while `enforceRecallReconciliation` had always fired its own pass. Prose cannot hold an
// invariant: the sentence went stale silently and stayed wrong for months. So the exemptions are a
// DECLARED list in digest-queue.mjs and this arm censuses the tree against it, in both directions —
// an undeclared site fails, and a declared site that no longer exists fails too. A stale exemption is
// the same silence pointing the other way.
//
// WHY IT CENSUSES RATHER THAN ASSERTS ONE FUNCTION. Issue 116 named one violation, found by grepping
// `stage("register-digest"`. That grep cannot see a forced pass dispatched through the `runDigest`
// wrapper, and two more were sitting behind it — `checkLateBind` and the `UPSTREAM_STALE_REPAIR` map
// entry. An arm that asserted "enforceRecallReconciliation is the exemption" would have been green
// through both. The class is "a forced digest pass outside the funnel", so the arm walks the class.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { DIGEST_OWN_PASS_EXEMPTIONS } from "../digest-queue.mjs";

const PIPELINE = join(dirname(fileURLToPath(import.meta.url)), "..", "pipeline.mjs");

// The funnel's own two functions: the dispatcher every pass goes through, and the settlement flush.
// A site inside either IS the funnel, so it needs no exemption.
const FUNNEL_INTERNAL = new Set(["runDigest", "flushDigestQueue"]);

// A declaration this resolver must recognise, or a real site hides behind an unresolved name:
//   async function f(            const f = async (            const f = (
//   const MAP = {                (the UPSTREAM_STALE_REPAIR shape — a dispatch inside an object literal)
const DECL = /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(|^\s*(?:const|let)\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s*)?[({]/;
const DISPATCH = /\brunDigest\s*\(|stage\s*\(\s*"register-digest"/;

/**
 * Every register-digest dispatch site in pipeline.mjs, with the function that encloses it.
 * Comment and jsdoc lines are excluded — the header prose names both symbols repeatedly.
 */
function dispatchSites() {
  const lines = readFileSync(PIPELINE, "utf8").split("\n");
  const sites = [];
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i];
    const bare = text.trim();
    if (!DISPATCH.test(text)) continue;
    if (bare.startsWith("//") || bare.startsWith("*") || bare.startsWith("/*")) continue;
    if (/^\s*(?:export\s+)?async function runDigest\s*\(/.test(text)) continue;   // the declaration itself
    let fn = "<top-level>";
    for (let j = i; j >= 0; j--) {
      const m = DECL.exec(lines[j]);
      if (m) { fn = m[1] || m[2]; break; }
    }
    sites.push({ line: i + 1, fn, text: bare });
  }
  return sites;
}

// A pass is NON-FRESH when it forces the stage to run again. The bare `await runDigest(ctx)` in
// reopenSections is the run's ONE fresh dispatch — it is the digest, not a re-digest — so keying on
// `force: true` rather than on a hand-listed set of function names means a `force: true` added there
// tomorrow fails this arm instead of slipping through an allowlist written today.
const isNonFresh = (site) => /force:\s*true/.test(site.text);

test("the resolver actually finds the dispatch sites it is asked to police", () => {
  const sites = dispatchSites();
  assert.ok(sites.length >= 6, `expected the known dispatch population, found ${sites.length} — the resolver or the file moved`);
  const fns = new Set(sites.map((s) => s.fn));
  // Positive control: an arm that silently resolves nothing would pass every assertion below.
  assert.ok(fns.has("runDigest"), "runDigest's own inner stage() call must be found, or the walker is not reading the file");
  assert.ok(fns.has("flushDigestQueue"), "the settlement flush must be found, or the arrow-function resolver is broken");
  assert.ok(!fns.has("<top-level>"), `every site must resolve to a named function; unresolved: ${JSON.stringify(sites.filter((s) => s.fn === "<top-level>"))}`);
});

test("every forced digest pass outside the funnel is a DECLARED exemption", () => {
  const declared = new Set(DIGEST_OWN_PASS_EXEMPTIONS.map((e) => e.fn));
  const undeclared = dispatchSites()
    .filter((s) => !FUNNEL_INTERNAL.has(s.fn) && isNonFresh(s) && !declared.has(s.fn));
  assert.deepEqual(undeclared, [],
    "a forced re-digest outside the queue with no entry in DIGEST_OWN_PASS_EXEMPTIONS — either mint "
    + "through the queue, or declare it with the reason it cannot: "
    + JSON.stringify(undeclared.map((s) => `${s.fn} @ pipeline.mjs:${s.line}`)));
});

test("every declared exemption still names a real forced pass — a stale entry is the same silence", () => {
  const live = new Set(dispatchSites().filter(isNonFresh).map((s) => s.fn));
  const stale = DIGEST_OWN_PASS_EXEMPTIONS.map((e) => e.fn).filter((fn) => !live.has(fn));
  assert.deepEqual(stale, [],
    `declared exemption(s) with no forced dispatch site left in pipeline.mjs: ${JSON.stringify(stale)} — `
    + "the site moved to the queue or was deleted; drop the entry so the list keeps meaning what it says");
});

test("each exemption carries a reason someone can act on, not a label", () => {
  for (const e of DIGEST_OWN_PASS_EXEMPTIONS) {
    assert.equal(typeof e.fn, "string");
    assert.ok(e.fn.length > 0, "an exemption must name its function");
    assert.ok(typeof e.reason === "string" && e.reason.length >= 60,
      `${e.fn}'s reason must say WHY the queue cannot carry it (>=60 chars), got: ${JSON.stringify(e.reason)}`);
  }
});

// The ordering fact that makes enforceRecallReconciliation's exemption true rather than merely
// asserted. If a later change adds a flush after digestSettled closes the queue, the reason recorded
// in DIGEST_OWN_PASS_EXEMPTIONS stops being true and this arm says so — the ruling and its mechanism
// stay joined instead of drifting apart the way the funnel header did.
test("no settlement flush survives digestSettled — the fact the recall-reconcile exemption rests on", () => {
  const src = readFileSync(PIPELINE, "utf8");
  // The queue closes on TWO paths and both must be past: the frame-reopen block flushes and settles
  // inline, and the standalone seam flushes only `if (!ctx.digestSettled)`. So the seam this arm is
  // about is the LAST assignment, not the first — reading the first calls the standalone flush a
  // post-close flush and reds on a tree that is correct. (Measured: sites at :10618 and :11490.)
  const settled = src.lastIndexOf("ctx.digestSettled = true;");
  assert.ok(settled > 0, "ctx.digestSettled = true must exist — the queue's closing seam moved");
  const after = src.slice(settled);
  assert.ok(!/\bawait\s+flushDigestQueue\s*\(/.test(after),
    "a flush now runs AFTER the queue is closed: recall-reconcile's mint would no longer be orphaned, "
    + "so re-decide whether it should mint through the queue and update DIGEST_OWN_PASS_EXEMPTIONS");
});
