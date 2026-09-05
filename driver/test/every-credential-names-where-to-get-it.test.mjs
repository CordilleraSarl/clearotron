// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// F16, the case-law half — the last tier the owner's ruling named.
//
// The owner, about the register that had this defect: "I should not have to google for signa and find
// it (and they are hard to find)." His scope was every credential the wizard asks for — EUIPO, USPTO,
// Signa, SerpAPI, Perplexity AND THE CASE-LAW SOURCES. Five of six landed; case law did not, because it
// is not a key the wizard prompts for (ADR-0003: it is a one-time OAuth sign-in) and so it fell outside
// the pass that fixed the others. The reader's position is identical either way: they are told to get
// an account somewhere and not told where.
//
// The remedy DID name `providers/oauth-mcp-bridge/README.md`, and that document does carry
// CourtListener's endpoints — in a shell transcript, five screens down. Reachable is not told.
//
// AND ONE ROW HAS NO URL ON PURPOSE. Legal Data Hunter's site is in no file in this repository, so the
// table holds `null` for it and the sentence says this build does not record one. An invented domain
// would be followed by a reader and seen by nobody, which is strictly worse than the silence. The arm
// below pins BOTH halves, because a table that quietly grew a plausible URL would otherwise pass.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { caseLawInventory } from "../../driver/config-inventory.mjs";
import { trackedFiles, skipReason } from "../../shared/tracked-files.mjs";
import { nonEmpty } from "../../shared/vacuous-pass.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
// A directory that cannot exist, so every enrollable row reads as NOT set up and carries its remedy.
const UNENROLLED = { OAUTH_BRIDGE_CREDS_DIR: "/nonexistent/k2so-2175-f16" };
const URL_RE = /https?:\/\/[^\s,)]+/;
const GUARD = "every credential names where to get it";

const enrollable = () => caseLawInventory(UNENROLLED).filter((r) => r.key === "caselaw" && r.enrolment === "oauth");

test("2175-F16 the rows this arm is about exist and are unenrolled — or everything below is vacuous", () => {
  const rows = enrollable();
  assert.ok(rows.length >= 2, `expected the OAuth case-law bridges; got ${rows.length}`);
  for (const r of rows) {
    assert.equal(r.configured, false, `${r.provider} read as configured against a directory that cannot exist`);
    assert.ok(r.remedy, `${r.provider} has no remedy to inspect`);
  }
});

test("2175-F16 a source whose site this build KNOWS names it, in the remedy itself", () => {
  // Not "see the README". The finding is that the URL must be where the reader is standing when they
  // are asked, which is the sentence doctor prints.
  const cl = enrollable().find((r) => r.provider === "courtlistener");
  assert.ok(cl, "courtlistener is no longer a bridge; this arm needs repointing");
  assert.match(cl.remedy, URL_RE, `no URL in the remedy a reader is given:\n${cl.remedy}`);
  assert.match(cl.remedy, /courtlistener\.com/, "the URL is not the source's own site");
  // And it still says the enrolment is a sign-in rather than a variable — ADR-0003's line, which the
  // URL must not quietly replace.
  assert.match(cl.remedy, /OAuth sign-in rather than a variable/i);
  assert.match(cl.remedy, /oauth-mcp-bridge\/README\.md/, "the document that completes the enrolment is no longer named");
});

test("2175-F16 a source whose site this build does NOT know says so, and invents nothing", () => {
  // The half that is a finding rather than a fix. If somebody later writes a URL here it must come from
  // a measurement, not from this arm going quiet — so the arm asserts the absence AND the sentence.
  const ldh = enrollable().find((r) => r.provider === "legaldatahunter");
  assert.ok(ldh, "legaldatahunter is no longer a bridge; this arm needs repointing");
  assert.doesNotMatch(ldh.remedy, URL_RE, `a URL appeared for a source this repository records no site for:\n${ldh.remedy}`);
  assert.match(ldh.remedy, /records no site/i, "the row does not say the site is unknown; it just omits it");
  assert.match(ldh.remedy, /ask whoever provisioned the bridge/i, "the reader is not told who to ask instead of searching");
});

test("2175-F16 that absence is a MEASUREMENT of this tree, not a habit — it holds only while it is true", (ctx) => {
  // The control for the arm above. It asserts nothing about wording: it reads the tracked tree the way
  // the finding did for `signa.so`, so the day somebody records the domain anywhere, this reds and the
  // table is required to catch up. Without this, "we do not know it" survives knowing it.
  //
  // THROUGH `trackedFiles`, not a `git grep` of my own — which is what I reached for first, and the
  // corpus rule caught it. The helper is what turns a missing checkout into a stated skip instead of a
  // wall of failures that mean nothing, and a second enumeration is a second answer to "what is the
  // corpus" that can disagree with the first.
  const tracked = trackedFiles(GUARD, { root: ROOT });
  if (tracked === null) return ctx.skip(skipReason(GUARD));
  // THIS FILE ONLY, not `driver/test/`. Excluding the whole directory would have been the easy spelling
  // and it would have put a hole straight through the claim: a domain landing in any fixture, snapshot
  // or later arm would be invisible to the one measurement that says this tree records none. The only
  // file that must be skipped is the one whose fixtures are the needle.
  //
  // NON-EMPTY AFTER THE FILTER, not before it. `nonEmpty` on the raw corpus proves the helper found a
  // tree; the loop walks what is LEFT, and a filter that removed everything would leave a loop that
  // reads the whole tree and asserts nothing.
  const SELF = "driver/test/every-credential-names-where-to-get-it.test.mjs";
  const raw = nonEmpty(tracked, "trackedFiles(GUARD, { root: ROOT })");
  assert.ok(raw.includes(SELF), `${SELF} is not in the tracked corpus, so the exclusion below is excluding nothing`);
  const files = nonEmpty(raw.filter((p) => p !== SELF), "the tracked tree beside this file");

  const DOMAIN = /legaldatahunter[a-z0-9.-]*\.(?:com|io|ai|org|net|co|eu)|legal-data-hunter[a-z0-9.-]*\.[a-z]{2,}/i;
  const unreadable = [];
  const hits = [];
  for (const rel of files) {
    let text;
    try { text = readFileSync(join(ROOT, rel), "utf8"); } catch { unreadable.push(rel); continue; }
    if (DOMAIN.test(text)) hits.push(rel);
  }
  // A file that could not be read is not a file without the domain in it.
  assert.deepEqual(unreadable, [], `could not read ${unreadable.length} tracked file(s), so this arm did not look at them`);
  assert.deepEqual(hits, [],
    `this repository now records a Legal Data Hunter domain, in:\n  ${hits.join("\n  ")}\n\n`
    + "Put it in CASELAW_SITES in driver/config-inventory.mjs and let the remedy name it — the `null` "
    + "there is only correct while the product genuinely does not know where to send a reader.");
});

test("2175-F16 EUR-Lex names its site too, though it needs no enrolment", () => {
  // It is listed precisely so a reader counting gaps can find all four. A source they can open is worth
  // a URL even when there is nothing to configure.
  const eur = caseLawInventory(UNENROLLED).find((r) => r.provider === "eur-lex");
  assert.ok(eur, "eur-lex is no longer listed");
  assert.match(eur.providerLabel, /eur-lex\.europa\.eu/, "the built-in source names no site");
  assert.equal(eur.remedy, null, "a source with nothing to configure must not grow a remedy");
});

test("2175-F16 a source that is not part of the build gets NO url — there is nowhere to send anyone", () => {
  // The control against "put a link on every row". The Boards of Appeal have no adapter; a signup URL
  // there would invite a reader to enrol with something this build cannot use.
  const boards = caseLawInventory(UNENROLLED).find((r) => r.provider === "euipo-boards-of-appeal");
  assert.ok(boards, "the Boards-of-Appeal row is gone; it is what tells a reader the gap is ours");
  assert.doesNotMatch(boards.remedy, URL_RE, `an unbuilt source offers a URL:\n${boards.remedy}`);
  assert.match(boards.remedy, /Nothing to fix on this box/);
});
