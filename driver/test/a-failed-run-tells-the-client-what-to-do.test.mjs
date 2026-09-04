// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// — the owner's failed-run ruling, 2026-09-04, in session and verbatim:
// *"It should just say something like clearotron failed, notify the admin kind of thing."*
//
// What shipped was "<BRAND> has been notified and will follow up. Nothing is needed from your side."
// Nobody had been notified — the box has no outbox — so the sentence was false twice: about the
// notification, and about there being nothing for the reader to do, since telling their operator was
// the only thing that would move it. A client told someone is already handling it does not tell anyone,
// so the sentence did not merely overclaim; it stopped the one action that would have helped.
//
// THREE client-facing copies, two of them the same sentence written out twice. A reword that fixes two
// of three is how a retired claim survives in whichever surface the next reader is not looking at.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { clientFailureNote, RETIRED_CLAIMS } from "../../shared/client-failure-note.mjs";
import { CLIENT_FAILURE_NOTE as MCP_NOTE } from "../../mcp-server/lib/audit-view.mjs";
import { nonEmpty } from "../../shared/vacuous-pass.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");

/** The trees a client-facing sentence can ship from. A parameter below, so an EMPTY one can be handed in. */
const SOURCE_ROOTS = ["driver", "mcp-server", "shared", "portal-ui/src", "bin"];

/**
 * Every client-facing source file, as ONE walk shared by the arms below.
 *
 *, and the guard sits on the AGGREGATE rather than the recursion step. An empty directory
 * part-way down a source tree is normal — `driver/profiles/` is a tracked tree the product also writes
 * into — so refusing at each read turns one empty leaf on a deployed box into a throw before a single
 * file has been read. What must not be empty is what the walk came back with, and that is what
 * `nonEmpty` wraps here, once, for every arm that calls this. Registered in GUARDED_AT_THE_WALK.
 *
 * `base` and `roots` are parameters so the empty-walk direction is DRIVEN by the arm named in that
 * entry, not argued for in a comment.
 *
 * Declared above the tests deliberately: the registry anchors a site by its enclosing test title, and
 * an entry hostage to test ordering is a worse artefact than the duplication this replaced.
 */
function clientFacingSources(base = ROOT, roots = SOURCE_ROOTS) {
  const out = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (["node_modules", "dist", ".git", "test"].includes(e.name)) continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(mjs|tsx?)$/.test(e.name)) out.push(p);
    }
  };
  for (const d of roots) walk(join(base, d));
  return nonEmpty(out, `the client-facing source walk under ${base} (${roots.join(", ")})`);
}

test("2179 the sentence states the failure and names who to tell, and claims nothing about who knows", () => {
  const said = clientFailureNote();
  assert.match(said, /stopped before it finished/, "the client must learn their search did not complete");
  assert.match(said, /nothing was delivered/, "and that they are not waiting on a report that is coming");
  assert.match(said, /tell whoever administers this installation/,
    "the ruling's own instruction: direct the reader to notify their administrator");
  for (const claim of RETIRED_CLAIMS)
    assert.doesNotMatch(said, new RegExp(claim, "i"), `the retired claim "${claim}" is back`);
});

test("2179 a run that never STARTED is not described as having stopped part-way", () => {
  // A client told their search "stopped before it finished" when it never began has been told something
  // false about their own order. The surfaces that know the difference already branched on it, so the
  // shared sentence has to keep that distinction rather than flatten it.
  const refused = clientFailureNote({ refused: true });
  assert.match(refused, /was not started/, refused);
  assert.doesNotMatch(refused, /stopped before it finished/, refused);
  assert.match(refused, /tell whoever administers this installation/,
    "the action is the same whichever way it failed");
});

test("2179 the MCP surface returns the shared sentence, not its own copy of it", () => {
  // Driven, not read: this export used to build the sentence itself from a brand name, and the point of
  // the change is that it no longer can.
  assert.equal(MCP_NOTE("Anything"), clientFailureNote(),
    "the MCP client surface must say exactly what the one authority says");
  for (const claim of RETIRED_CLAIMS)
    assert.doesNotMatch(MCP_NOTE("Anything"), new RegExp(claim, "i"), claim);
});

test("2179 NO client-facing source states a retired claim outside a comment", () => {
  // The class arm. Naming the three sites that existed would pass while a fourth is written tomorrow.
  //
  // LINE-BASED, and its limit is stated rather than hidden: a line carrying a retired phrase must be a
  // COMMENT line, because the phrases legitimately appear in the comments that explain why they were
  // retired — including in this file. A phrase inside a template literal begins on a line that is not a
  // comment, which is the shape that actually ships, so that is the shape this catches.
  const files = clientFacingSources();

  // THE DECLARING MODULE EXCLUDES ITSELF, BY NAME. RETIRED_CLAIMS lists the phrases, so the file that
  // holds the list contains every one of them as data — a guard that forbids a shape fires on its own
  // vocabulary unless it says so out loud. Named rather than pattern-matched away, and the arm below
  // asserts the exclusion still covers something, so it cannot rot into a silent hole.
  const SELF = join(ROOT, "shared", "client-failure-note.mjs");
  assert.ok(files.includes(SELF), "the declaring module left the walk — this exclusion now covers nothing");

  const offenders = [];
  for (const p of files) {
    if (p === SELF) continue;
    readFileSync(p, "utf8").split("\n").forEach((line, i) => {
      const t = line.trim();
      const isComment = t.startsWith("//") || t.startsWith("*") || t.startsWith("/*");
      if (isComment) return;
      for (const claim of RETIRED_CLAIMS)
        if (line.includes(claim)) offenders.push(`${p.slice(ROOT.length + 1)}:${i + 1}  ${t.slice(0, 80)}`);
    });
  }
  assert.deepEqual(offenders, [],
    `these state a claim the owner retired — nobody is notified, and a client told otherwise does not `
    + `tell their operator:\n${offenders.join("\n")}`);
});

test("2179 the walked population is real, and the arm can still SEE an offender", () => {
  //, and the instrument check with it. An empty offenders list from an empty walk is not a pass,
  // and neither is one from a matcher that cannot match.
  const n = clientFacingSources().length;
  assert.ok(n > 300, `expected the client-facing source tree, found ${n} file(s)`);

  // The matcher, driven against a line that IS the defect and one that is prose about it.
  const shipped = '  const note = `${BRAND.name} has been notified and will follow up.`;';
  const prose = '// What shipped was "<BRAND> has been notified and will follow up." Nobody had been.';
  assert.ok(RETIRED_CLAIMS.some((c) => shipped.includes(c)), "the matcher cannot see the shipping shape");
  assert.ok(prose.trim().startsWith("//"), "the comment exemption is what lets this file explain itself");
});

test("2179 the source walk refuses an empty corpus, and an empty leaf is not one", () => {
  // The proof GUARDED_AT_THE_WALK's entry for this file points at. The recursion step is deliberately
  // unguarded, so the only thing standing between an empty tree and a green class arm above is the
  // aggregate — and a table that merely CLAIMS that reads identically whether the guard is still there
  // or was rescoped away last month. This drives both directions against a real tree on disk.
  const tmp = mkdtempSync(join(tmpdir(), "clearotron-2179-walk-"));
  try {
    mkdirSync(join(tmp, "src", "leaf"), { recursive: true });

    // Direction 1 — nothing found is a REFUSAL, not a clean sweep with no offenders.
    assert.throws(() => clientFacingSources(tmp, ["src"]), /1010 VACUOUS/,
      "an empty tree must fail loudly here, or the class arm above passes having read nothing");

    // Direction 2 — an empty leaf beside real files does not take the files with it, which is why the
    // guard is on the aggregate and not on each read.
    writeFileSync(join(tmp, "src", "surface.mjs"), "export const x = 1;\n");
    assert.deepEqual(clientFacingSources(tmp, ["src"]), [join(tmp, "src", "surface.mjs")],
      "an empty directory part-way down must be walked past, not refused");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
