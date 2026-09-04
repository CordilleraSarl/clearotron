// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// — A RETRY ASKS ONLY FOR WHAT IS STILL UNANSWERED, AND EVERY OTHER STAGE IS UNTOUCHED.
//
// A killed attempt's accepted answers did not carry into the retry: attempt 2 was re-presented all 80
// doubts byte-identically and re-answered 68 to the same verdict. That generation is the wall-clock —
// the receiver's idempotent serve stops the re-JUDGING, not the re-composing, because the seat
// writes every row before the tool sees any of it.
//
// THE RISK THIS FILE EXISTS FOR IS NOT THE FEATURE, IT IS THE BLAST RADIUS. The hook sits at the one
// per-attempt composition point BOTH pipelines pass through, so the load-bearing assertion is that a
// stage which declares nothing sends the same bytes on attempt 2 that it sent on attempt 1.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { driverDir } from "../../shared/driver-dir.mjs";
import { STAGES } from "../stages.mjs";
import { closureCallPaths } from "../doubt-closure-tool.mjs";

const def = STAGES["doubt-closure"];

function runDirWithAccepted(lines) {
  const d = mkdtempSync(join(tmpdir(), "carry-"));
  mkdirSync(driverDir(d), { recursive: true });
  const { dir } = closureCallPaths(d, 0);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "accepted-001.json"), JSON.stringify({ at: "now", seq: 1, lines }) + "\n");
  return d;
}
const ctxFor = (runDir, doubts, asks = []) => ({
  paths: { runDir, doubtClosure: join(runDir, "doubt-closure.md") },
  openDoubts: doubts, openAsks: asks,
});
const doubt = (id) => ({ id, birth: { artifact: "findings.json", quote: `q ${id}` }, subject: { mark: `M-${id}` } });

test("#1239 refreshCtx drops the doubts a prior attempt already had accepted", () => {
  const d = runDirWithAccepted({ doubt: [{ verdict: "SETTLED", id: "d1" }], ask: [] });
  const ctx = ctxFor(d, [doubt("d1"), doubt("d2"), doubt("d3")]);
  const out = def.refreshCtx(ctx);
  assert.deepEqual(out.openDoubts.map((x) => x.id), ["d2", "d3"], "an answered doubt was asked for again");
  assert.deepEqual(ctx.openDoubts.map((x) => x.id), ["d1", "d2", "d3"], "refreshCtx mutated its input");
});

test("#1239 an OPEN verdict counts as answered — the seat already spent the turn on it", () => {
  // The point is not "is it settled", it is "has this seat already been asked and replied". An OPEN
  // reply is a reply; re-presenting it buys the same answer for the same money.
  const d = runDirWithAccepted({ doubt: [{ verdict: "OPEN", id: "d2" }], ask: [] });
  const out = def.refreshCtx(ctxFor(d, [doubt("d1"), doubt("d2")]));
  assert.deepEqual(out.openDoubts.map((x) => x.id), ["d1"]);
});

test("#1239 with nothing accepted the ctx comes back UNCHANGED, not merely equal", () => {
  // Attempt 1 must present everything. Returning the same object identity is the cheapest proof that
  // the first attempt cannot be narrowed by an empty ledger.
  const d = mkdtempSync(join(tmpdir(), "carry-empty-"));
  mkdirSync(driverDir(d), { recursive: true });
  const ctx = ctxFor(d, [doubt("d1"), doubt("d2")]);
  assert.equal(def.refreshCtx(ctx), ctx, "an empty ledger narrowed the first attempt");
});

test("#1239 a ctx with no runDir asks for everything rather than throwing", () => {
  const ctx = { openDoubts: [doubt("d1")], openAsks: [] };
  assert.equal(def.refreshCtx(ctx), ctx);
});

test("#1239 the narrowed ctx composes a SHORTER message that still names what is left", () => {
  // The ctx change is only worth anything if the composed dispatch shrinks. Driven through the stage's
  // real `message()`, not a stand-in.
  const d = runDirWithAccepted({ doubt: [{ verdict: "SETTLED", id: "d1" }], ask: [] });
  const ctx = ctxFor(d, [doubt("d1"), doubt("d2")]);
  const full = def.message(ctx);
  const narrowed = def.message(def.refreshCtx(ctx));
  assert.ok(narrowed.length < full.length, "the narrowed dispatch is not shorter than the full one");
  assert.match(full, /d1/);
  assert.doesNotMatch(narrowed, /\bd1\b/, "an answered doubt is still named in the retry's dispatch");
  assert.match(narrowed, /\bd2\b/, "the retry stopped naming a doubt that is still open");
});

// ── the blast radius, which is what this hook has to be safe about ───────────────────────────────────

test("#1239 EXACTLY ONE stage declares refreshCtx", () => {
  // A second declarer is not forbidden — it is a decision, and it should be made deliberately rather
  // than discovered. This fails when one arrives, and the reader is sent to the premises above.
  const declaring = Object.entries(STAGES).filter(([, d]) => typeof d?.refreshCtx === "function").map(([n]) => n);
  assert.deepEqual(declaring, ["doubt-closure"],
    `${declaring.length} stage(s) recompose their dispatch per attempt. Each one needs its own answer to `
    + `"do this stage's ids mean the same thing on attempt 2" — see doubt-closure's two premises.`);
});

test("#1239 every OTHER stage composes the same bytes however many attempts it takes", () => {
  // THE CONTROL THE HOOK IS FOR. `refreshCtx` is absent on every other stage, so `refreshMessage` is
  // never passed and the gateway's base stays `message` — byte for byte, on attempt 1 and attempt 3
  // alike. Asserted on the declaration rather than by dispatching, because the property IS the absence:
  // there is no configuration that turns this on for a stage that did not ask for it.
  const offenders = [];
  for (const [name, d] of Object.entries(STAGES)) {
    if (name === "doubt-closure") continue;
    if (typeof d?.refreshCtx !== "undefined") offenders.push(`${name} declares refreshCtx: ${typeof d.refreshCtx}`);
  }
  assert.deepEqual(offenders, [], offenders.join("\n  "));
  // And the hook is genuinely opt-in at the read site: no default, no env, no wildcard.
  const src = readFileSync(new URL("../pipeline.mjs", import.meta.url), "utf8");
  assert.match(src, /typeof def\.refreshCtx === "function"/,
    "the pipeline no longer gates the refresh on the stage having declared it");
  assert.match(src, /patch == null &&/,
    "the refresh is no longer suppressed when a followup patch composed the message");
});
