// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// buildRunContext freshness: a fresh mint must never land in a run dir another run already owns —
// a collision hands this run the stranger's completed stages via the idempotency skip (the mock-pipeline
// suite's ~35 same-slug runs per process flaked exactly there: a re-minted "umber-bramble" resumed an
// earlier scenario's dir and the MOCK_FAIL_STAGE knob never fired). Overrides stay verbatim — RESUME
// rebuilds the SAME identity on purpose.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildRunContext, genCodename, mintFreshCodename } from "../phase0.mjs";

const JOB = { ref: "TMP1", markName: "X", forwarderDomain: "example.com" };  // slug tmp1-x
const DATE = "2026-07-11";
// genCodename draws rand() twice per mint — feed it a scripted tape.
const tape = (vals) => { let i = 0; return () => vals[Math.min(i++, vals.length - 1)]; };

function roots() {
  const base = mkdtempSync(join(tmpdir(), "codename-"));
  return { studioRoot: join(base, "studio"), archiveRoot: join(base, "archive") };
}

test("fresh mint re-mints past an existing LIVE run dir", () => {
  const { studioRoot, archiveRoot } = roots();
  const taken = genCodename(tape([0, 0]));                                    // cobalt-falcon
  mkdirSync(join(studioRoot, "tmp1-x", `${DATE}-${taken}`), { recursive: true });
  const ctx = buildRunContext(JOB, { studioRoot, archiveRoot, date: DATE, rand: tape([0, 0, 0.5, 0.5]) });
  assert.notEqual(ctx.codename, taken, "the colliding first pick is discarded");
  assert.equal(ctx.codename, genCodename(tape([0.5, 0.5])), "the second pick wins");
});

test("fresh mint re-mints past an ARCHIVED run dir too (the archive move must stay collision-free)", () => {
  const { studioRoot, archiveRoot } = roots();
  const taken = genCodename(tape([0, 0]));
  mkdirSync(join(archiveRoot, DATE.slice(0, 7), "tmp1-x", `${DATE}-${taken}`), { recursive: true });
  const ctx = buildRunContext(JOB, { studioRoot, archiveRoot, date: DATE, rand: tape([0, 0, 0.5, 0.5]) });
  assert.notEqual(ctx.codename, taken);
});

test("20 straight collisions ⇒ a suffixed guaranteed-fresh codename (never an infinite loop)", () => {
  const { studioRoot, archiveRoot } = roots();
  const taken = genCodename(tape([0, 0]));                                    // constant rand ⇒ always this pick
  mkdirSync(join(studioRoot, "tmp1-x", `${DATE}-${taken}`), { recursive: true });
  const ctx = buildRunContext(JOB, { studioRoot, archiveRoot, date: DATE, rand: () => 0 });
  assert.match(ctx.codename, new RegExp(`^${taken}-[0-9a-z]+$`), "base pick + freshness suffix");
});

test("codename OVERRIDE is honoured verbatim even when the dir exists (resume rebuilds the same identity)", () => {
  const { studioRoot, archiveRoot } = roots();
  mkdirSync(join(studioRoot, "tmp1-x", `${DATE}-cobalt-falcon`), { recursive: true });
  const ctx = buildRunContext(JOB, { studioRoot, archiveRoot, date: DATE, codename: "cobalt-falcon", rand: () => 0.9 });
  assert.equal(ctx.codename, "cobalt-falcon");
  assert.ok(ctx.runDir.endsWith(`tmp1-x/${DATE}-cobalt-falcon`));
});

test("no collision ⇒ the first pick stands (vanilla mint unchanged)", () => {
  const { studioRoot, archiveRoot } = roots();
  const ctx = buildRunContext(JOB, { studioRoot, archiveRoot, date: DATE, rand: tape([0, 0]) });
  assert.equal(ctx.codename, genCodename(tape([0, 0])));
});

// THE DEFAULT DRAW IS NOT Math.random. A codename is a label, not a secret, but it is the first part of
// the run identifier, and code scanning traced every key built from it back to Math.random. The default
// now comes from node:crypto; this arm poisons Math.random for the length of three default mints, so a
// default that drifted back to it throws here rather than passing quietly on a well-shaped name.
test("a codename minted with no injected rand does not touch Math.random", () => {
  const real = Math.random;
  Math.random = () => { throw new Error("Math.random was called for a codename"); };
  try {
    assert.match(genCodename(), /^[a-z]+-[a-z]+$/, "the default draw still yields an adjective and a noun");
    // The fresh-mint path too, with the claim injected so this arm writes nothing outside its own
    // directory: the default claim appends to the shared codename registry.
    const dir = mkdtempSync(join(tmpdir(), "codename-crypto-"));
    const c = mintFreshCodename({ slug: "crypto-draw", date: DATE, studioRoot: join(dir, "s"), archiveRoot: join(dir, "a"), claim: () => true });
    assert.match(c, /^[a-z]+-[a-z]+$/, "a fresh mint with the default draw");
  } finally { Math.random = real; }
});
