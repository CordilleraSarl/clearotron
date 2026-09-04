// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// / / — SHIPPED TEXT DESCRIBING A MACHINE THE INSTALL DOES NOT PRODUCE.
//
// Three findings from one stranger install, and they are one class: prose that was true of the box the
// authors were sitting at. The same class as the units that hardcoded the authors' own checkout name
// (,) and the wizard that named five retired variables.
//
// The dangerous one is, and it is the reason this file exists rather than three review comments:
// §7 told a reader the HTTP MCP face is read-only and cannot spend, and then told them to publish it.
// A reader who believes the first does the second with a threat model built for a read-only endpoint —
// weaker auth, broader audience — and the surface can start a billable clearance.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { trackedFiles, skipReason } from "../../shared/tracked-files.mjs";
import { nonEmpty } from "../../shared/vacuous-pass.mjs";

const ROOT = join(dirname(dirname(fileURLToPath(import.meta.url))), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

// ── — a surface people are told to expose says what it actually serves ──────────────────────
//
// DERIVED, never a hand list: every shipping document that describes this server. A doc added tomorrow
// that calls it read-only is caught without anyone remembering to come here.
//
// THE CORPUS IS WIDER THAN THE FILENAME, and that was measured rather than assumed. The first cut
// selected documents naming `http-server.mjs` — and `README.md`, which describes the two faces in prose
// and named no file, was never examined. Reverting README's sentence to the false one did not red this
// arm. An empty result over a corpus that never contained the subject is not evidence.
//
// The check itself is narrow because nothing can read a paragraph and judge it: a document that
// characterises this server as READ-ONLY must also name the write half. Three spellings count —
// `start_run`, "write verbs", "write tools" — because each is a phrasing a shipping document already
// uses, and a guard demanding one wording would be a style rule wearing a correctness rule's clothes.
const DESCRIBES_THE_HTTP_FACE = (text) =>
  /http-server\.mjs/.test(text)
  || /\b18790\b/.test(text)
  // The separator class is not a plain space: README writes "**HTTP** face", and a pattern demanding
  // one space misses the exact document this corpus was widened to reach. Markdown emphasis is
  // punctuation between two words a reader sees as adjacent.
  || (/stdio/i.test(text) && /http[^A-Za-z0-9]{0,4}(face|server|mcp)|mcp[^.\n]*http/i.test(text));
const NAMES_THE_WRITE_HALF = (text) => /start_run|write verbs?|write tools?/i.test(text);

const GUARD = "install-doc-describes-this-machine (#1866)";

test("#1866 no shipping doc calls the HTTP MCP face read-only without naming the half that spends", (ctx) => {
  // Through the shared helper, never `git ls-files` directly — it is what turns a missing checkout into
  // a stated skip instead of a wall of meaningless failures, and enumerating the corpus behind its back
  // is its own guarded house rule. This arm tripped that guard on its first CI run.
  const tracked = trackedFiles(GUARD, { root: ROOT });
  if (!tracked) return ctx.skip(skipReason(GUARD));
  const docs = tracked.filter((rel) => rel.endsWith(".md")).filter((rel) => DESCRIBES_THE_HTTP_FACE(read(rel)));
  nonEmpty(docs, "no document describes the HTTP MCP face — the sweep stopped selecting and would pass forever");
  assert.ok(docs.includes("README.md"),
    "README.md describes the two faces and names no file — if the corpus cannot see it, the arm is "
    + "answering an easier question than the one #1866 asks");

  const offenders = [];
  for (const rel of docs) {
    const text = read(rel);
    if (!/read[- ]only/i.test(text)) continue;                  // never characterises anything that way
    if (NAMES_THE_WRITE_HALF(text)) continue;                   // and names the other half somewhere
    // — name the sentence that characterises it, not only the document. In a
    // long document "it says read-only somewhere" is the start of the search, not the end of it.
    const hit = text.split("\n").find((l) => /read[- ]only/i.test(l))?.trim().slice(0, 110) ?? "";
    offenders.push(`${rel}  ${hit}`);
  }
  assert.deepEqual(offenders, [],
    "these call the MCP HTTP surface read-only and never mention the write half. `start_run` bills a "
    + "real search, and these documents also tell the reader to put this face on the internet:\n  "
    + offenders.join("\n  "));
});

test("#1866 INSTALL.md's ingress advice comes AFTER what the surface serves, not before", () => {
  const s = read("INSTALL.md");
  const serves = s.indexOf("`start_run` bills a real search");
  const ingress = s.indexOf("put it behind **your own** reverse proxy");
  assert.ok(serves > 0 && ingress > 0, "both sentences must exist in §7");
  assert.ok(serves < ingress,
    "\"put it behind your own proxy\" must be read with the right threat model — the spend has to be on "
    + "the page before the instruction to publish it, not after");
});

// ── — the ports are named where a reader CHOOSES them ───────────────────────────────────────
//
// A documented install on a box already running this product FATALs at §6, and the section explaining
// why was ~150 lines later under a heading about a different subject. The error text itself is good —
// it names the port, the variable and why it will not self-heal — which is why this is an ordering fix
// and not a rewrite.
test("#1867 the port variables are named BEFORE the first `clearotron start`, not only after it", () => {
  const s = read("INSTALL.md");
  const firstStart = s.indexOf("npx clearotron start\n```");
  assert.ok(firstStart > 0, "the first bare start command must exist in §6");
  const before = s.slice(0, firstStart);
  for (const name of ["PORTAL_SERVICE_PORT", "TRADEMARK_MCP_HTTP_PORT"]) {
    assert.ok(before.includes(name),
      `${name} is named only after the command that fails without it — a reader choosing ports must meet `
      + "them where the choice is made");
  }
  assert.match(before, /fixed defaults shared by every checkout/i,
    "and the reason must be stated: these are host-wide fixed defaults, not per-install values, which is "
    + "why a second checkout collides");
});

// ── — a remedy that exists wherever the harness runs ────────────────────────────────────────
//
// The stale-code guard refuses a PAID run against a checkout that is behind, and its reasoning is the
// good kind. It then handed the operator `systemctl --user start trademark-test-deploy.service` — a
// unit of one box, wiped, never recreated, produced by no documented install. `Unit not found`, in
// answer to a correct refusal.
test("#1868 the stale-code remedy names no unit the documented install does not produce", () => {
  const s = read("scripts/e2e.mjs");
  // WHAT THE OPERATOR IS SHOWN, not what the file contains. A whole-file substring check fires on the
  // comment EXPLAINING the fix — measured, on the first run of this arm — and a guard that cannot tell
  // prose from an emitted remedy teaches the next person to delete the explanation. A general string
  // extractor was the second wrong answer: an apostrophe in prose closes a quote and swallows the
  // comment. The PRINTING LINES are the precise subject, and a comment is never one.
  const printed = s.split("\n").filter((l) => /console\.(log|error|warn)\s*\(/.test(l));
  nonEmpty(printed, "no print lines found in the harness — the extractor stopped selecting");
  const offenders = printed.filter((l) => /trademark-test-deploy/.test(l)).map((l) => l.trim());
  assert.deepEqual(offenders, [],
    "the remedy names a deploy unit of a machine that no longer exists — text that encodes the box it "
    + "was written on, the same class as the units that hardcoded the authors' checkout name");
  assert.match(s, /git pull --ff-only/,
    "it must name something true on any checkout this harness can run from; --ff-only on purpose, "
    + "because a merge or rebase here would rewrite the very thing the guard measures");
});

test("#1868 the guard's refusal and its reasoning are untouched", () => {
  const s = read("scripts/e2e.mjs");
  // The fix must not soften the guard. Refusing a PAID run against stale code is exactly right, and
  // this sentence is the whole argument for it.
  assert.match(s, /A green run here means "main as of then was fine", which is not what anyone will hear/,
    "the reasoning is the point of the guard and this change does not touch it");
  assert.match(s, /Refusing to start a PAID run against stale code/, "nor the refusal itself");
});

// A documented install produces no systemd unit at all before §8, so a remedy naming one by name is
// unreachable advice at the moment it is given. Stated as a check rather than a comment because the
// next remedy written on a developer's box will reach for the same shape.
test("#1866-8 no harness refusal hands the operator a unit name as its FIRST remedy", () => {
  const s = read("scripts/e2e.mjs");
  const first = /Refusing to start a PAID run against stale code[^\n]*\n[^\n]*console\.log\("(.*?)"\)/s.exec(s);
  assert.ok(first, "the refusal's first remedy line must be findable");
  assert.ok(!/systemctl/.test(first[1]),
    `the first thing offered was ${JSON.stringify(first[1])} — a host-specific service call. The `
    + "deployment-agnostic remedy goes first; a deploy timer is named conditionally and second.");
});

test("#1866-8 the install document this family is about is still the one being checked", () => {
  assert.ok(existsSync(join(ROOT, "INSTALL.md")) && existsSync(join(ROOT, "scripts/e2e.mjs")),
    "both subjects must exist — a renamed file would make every arm above vacuous");
});
