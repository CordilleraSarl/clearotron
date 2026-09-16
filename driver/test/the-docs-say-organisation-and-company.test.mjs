// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE DOCUMENTATION SAYS ORGANISATION AND COMPANY, AND NO OTHER WORD DOES THEIR WORK.
//
// The product names two things. The ORGANISATION owns an installation or an account; the COMPANY is
// whose names are cleared. Seven older words stood in for one or the other wherever a reader met them —
// account, customer, client, tenant, brand, firm and matter — so a reader who met "the client" on one
// page and "the company" on the next could not tell whether that was one thing or two. The portal's
// screens are held by portal-ui/test/terminology.test.ts. This file holds README.md and every document
// under docs/: each of the seven words still in them is covered by an exception below that says why it
// is not doing the work of either word, and any other use fails.
//
// EXCEPTIONS ARE PHRASES, NEVER BARE WORDS. Most surviving uses name something else entirely: an MCP
// client is software, an installation's brand is a setting, a service account is an operating-system
// user. A phrase lets the next "client door" through and stops the next "our clients"; an exception for
// the bare word would excuse the next misuse along with the use it was written for.
//
// WHOLE-FILE, WHITESPACE-FLEXIBLE MATCHING. Markdown wraps near a hundred characters, so "the client"
// and "door" often sit on two lines. A line-by-line matcher reports green over exactly that shape — the
// terminology map beside the portal records the guard that did.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { trackedFiles, skipReason } from "../../shared/tracked-files.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const GUARD = "the-docs-say-organisation-and-company";

const WORDS = ["account", "customer", "client", "tenant", "brand", "firm", "matter"];
/** Each word in its plural and possessive forms, whole words only: `confirm` holds no `firm`. */
const WORD = new RegExp(`\\b(?:${WORDS.join("|")})(?:s|'s|s'|’s)?\\b`, "gi");

/** The corpus: the README a stranger lands on, and every document under docs/. */
const inCorpus = (f) => f === "README.md" || /^docs\/.+\.md$/.test(f);

const blank = (s) => s.replace(/[^\n]/g, " ");

/**
 * Text a reader does not meet as prose, blanked to spaces before the words are looked for. Blanking
 * rather than deleting keeps every offset, so a hit still names its own line.
 *
 * Each entry is an exception like the phrases below, and carries its reason the same way.
 */
const MASKS = [
  {
    what: "fenced code, except a mermaid diagram",
    reason: "a command, a payload or a unit file spells identifiers, and identifiers keep their names; a "
      + "mermaid block is rendered as a diagram whose labels a reader does meet, so only its fences go",
    apply: (t) => t.replace(/^(```|~~~)([^\n]*)\n[\s\S]*?^\1[^\n]*$/gm, (m, _fence, info) =>
      (/^\s*mermaid\b/.test(info) ? m.replace(/^[^\n]*/, blank).replace(/[^\n]*$/, blank) : blank(m))),
  },
  {
    what: "an inline code span",
    reason: "`CLEAROTRON_CUSTOMERS_DIR`, `tenants`, `account` and `05-customer-profiles.md` are identifiers, "
      + "file names and wire values, which keep their names",
    apply: (t) => t.replace(/(`+)[\s\S]*?\1/g, blank),
  },
  {
    what: "a link target, an image or link attribute, or a bare URL",
    reason: "an address names a file or a page, and a file keeps its name however its link reads",
    apply: (t) => t
      .replace(/\]\([^)\s]*\)/g, blank)
      .replace(/\b(?:href|src|srcset)="[^"]*"/g, blank)
      .replace(/https?:\/\/\S+/g, blank),
  },
  {
    what: "an identifier written without backticks",
    reason: "a token joined by an underscore, a dotted extension or host, or a path of two slashes or more "
      + "is an identifier or a path; a single slash between two words is prose and stays in",
    apply: (t) => t
      .replace(/(?:~|\.{1,2})?\/?[A-Za-z0-9][A-Za-z0-9_-]*(?:[._/][A-Za-z0-9<>*][A-Za-z0-9_<>*-]*)+/g, (m) =>
        (/_/.test(m) || /[A-Za-z0-9]\.[A-Za-z]/.test(m) || /^(?:~|\.{1,2})?\//.test(m) || (m.match(/\//g) ?? []).length >= 2
          ? blank(m) : m))
      .replace(/\b[A-Za-z0-9]+(?:_[A-Za-z0-9]+)+\b/g, blank),
  },
];

const ORG_OR_COMPANY = "neither an organisation nor a company";

/**
 * Every use the documentation keeps: the phrases, and the reason they stay. `files`, when present, is the
 * only place those phrases are excused. Matched case-insensitively over the masked text, and `\s+`
 * between words matches a line break.
 *
 * ONE PHRASE PER EXPRESSION. An alternation of two phrases in one expression stays "in use" while either
 * matches, so a phrase the documents stopped using would sit on as an idle excuse — which is exactly what
 * a plant against the first draft of this table showed. Alternation inside a phrase is for its spellings
 * only: a plural, a hyphen, markdown emphasis.
 */
const EXCEPTIONS = [
  {
    phrases: [
      /\bclient[\s-]+connectors?\b/gi,
      /\bclient[\s-]+doors?\b/gi,
      /\bclient[\s-]+faces?\b/gi,
      /\bclient[\s-]+MCP\b/gi,
      /\*\*client\s+HTTP\*\*/gi,
      /\bclient\s+hostname\b/gi,
      /\bclient\s+CF\s+Access\s+AUD\b/gi,
      /\bclient\s+AUD\b/gi,
      /\*\*client\*\*\s+Access\s+app\b/gi,
    ],
    reason: "the client connector, door or face is a component — the access point for people outside the "
      + "operator's staff — and its unit, its variables and its document are spelled with the word "
      + "(`clearotron-client-mcp.service`, `CLIENT_MCP_*`, `docs/CLIENT-MCP.md`); renamed in prose alone, it "
      + "would send an operator looking for a service that does not exist",
  },
  {
    phrases: [/\|\s*\*\*Client\*\*\s*\|/gi, /\bsame\s+as\s+Client\b/gi],
    files: /^docs\/CLIENT-MCP\.md$/,
    reason: "the name of that same face in the table of faces, beside Staff, Ops and API key",
  },
  {
    phrases: [/\bclient[\s-]+gate\b/gi],
    reason: "the client gate is the engine's pre-publication check (`evaluateClientGate`), named in code",
  },
  {
    phrases: [/\bMCP\s+clients?\b/gi, /\bOAuth2?\s+client[\s-]+credentials\b/gi, /\bclient-side\b/gi],
    reason: "software: the program that connects to a server, the OAuth client of a register office, and "
      + "code that runs in the browser",
  },
  {
    phrases: [
      /\bservice\s+accounts?\b/gi,
      /\boperator\s+account\b/gi,
      /\bdevelopment\s+account\b/gi,
      /\bOS\s+accounts\b/gi,
      /\baccount's\s+home\b/gi,
    ],
    reason: "the operating-system user the product runs as, and that user's home directory — " + ORG_OR_COMPANY,
  },
  {
    phrases: [
      /\bfree\s+accounts?\b/gi,
      /\bvendor\s+account\b/gi,
      /\bself-serve\s+accounts\b/gi,
      /\bsign\s+in\s+with\s+a\s+account\b/gi,
    ],
    reason: "an account with a register, research or model vendor, or the sign-in identity a delivery note "
      + "asks for — " + ORG_OR_COMPANY,
  },
  {
    phrases: [/\bneeds\s+an\s+account\b/gi],
    files: /^docs\/decisions\/0001-register-ladder\.md$/,
    reason: "an account with the EUIPO, which a free register needs — " + ORG_OR_COMPANY,
  },
  {
    phrases: [
      /\bbrand\s+colours\b/gi,
      /\bbrand\s+strings\b/gi,
      /\bbrand\s+source\b/gi,
      /\bbrand\s+seam\b/gi,
      /\bsomebody\s+else's\s+brand\b/gi,
      /\boutbox,\s+brand\s+and\s+auth\b/gi,
    ],
    reason: "the brand an installation prints on what it delivers — the `CLEAROTRON_BRAND_*` settings and "
      + "the product's own artwork — " + ORG_OR_COMPANY,
  },
  {
    phrases: [/\blaw[\s-]+firm\b/gi],
    reason: "a law firm names a kind of organisation, the one the law-firm setup is written for — the "
      + "portal's own fold for those fields is \"Law firm options\" — never the organisation itself",
  },
  {
    phrases: [
      /\bmatter\s+frame\b/gi,
      /\bmatter\s+ledger\b/gi,
      /\bmatter\s+numbers\b/gi,
      /\bmatter[\s-]+dedup\b/gi,
      /\bmatter-level\b/gi,
      /\bmatter-scoped\b/gi,
      /\bper\s+\*\*matter\*\*/gi,
    ],
    reason: "the engine's own names for its unit of work — one clearance request for one mark — and the "
      + "machinery keyed on it; " + ORG_OR_COMPANY,
  },
  {
    phrases: [/\bmatter(?:s|'s)?\b/gi],
    files: /^docs\/architecture\//,
    reason: "the architecture pack defines Matter in its vocabulary table as one clearance request for one "
      + "mark, and uses the word for that unit, for YAML front matter and as the verb; " + ORG_OR_COMPANY,
  },
  {
    phrases: [/\baccounts\s+for\b/gi, /\bwhat\s+matters\b/gi, /\bdetail\s+matters\b/gi, /\badjacencies\s+matter\b/gi],
    reason: "the verb — " + ORG_OR_COMPANY,
  },
  {
    phrases: [/\bfiller\*\*:\s+matter\b/gi, /\blost\s+the\s+client\b/gi],
    files: /^docs\/writing-rules\.md$/,
    reason: "the writing rules quote a filler word and an example sentence about a business in general; "
      + "neither is about this product",
  },
];

/**
 * Every use of the seven words in one document that no exception covers.
 *
 * DRIVEN, NOT ONLY RUN OVER THE TREE: the arms below hand it planted text, so the matcher is shown to
 * fire before its silence over the real corpus is believed.
 *
 * @param {string} file  repo-relative path, which decides which scoped exceptions apply
 * @param {string} text  the document
 * @param {Set<RegExp>} [used]  collects every exception phrase that excused something
 * @returns {{file: string, line: number, word: string, context: string}[]}
 */
function offences(file, text, used = new Set()) {
  const masked = MASKS.reduce((t, m) => m.apply(t), text);
  const spans = [];
  for (const ex of EXCEPTIONS) {
    if (ex.files && !ex.files.test(file)) continue;
    for (const phrase of ex.phrases)
      for (const m of masked.matchAll(phrase)) spans.push({ phrase, start: m.index, end: m.index + m[0].length });
  }
  const out = [];
  const lines = text.split("\n");
  for (const m of masked.matchAll(WORD)) {
    const start = m.index;
    const end = start + m[0].length;
    const cover = spans.find((s) => s.start <= start && end <= s.end);
    if (cover) { used.add(cover.phrase); continue; }
    const line = masked.slice(0, start).split("\n").length;
    out.push({ file, line, word: m[0], context: (lines[line - 1] ?? "").trim().slice(0, 140) });
  }
  return out;
}

const corpus = () => {
  const files = trackedFiles(GUARD, { root: ROOT });
  return files && files.filter(inCorpus).sort();
};
const read = (f) => readFileSync(join(ROOT, f), "utf8");

test("the corpus is the README and every document under docs/, and it is not a handful", (ctx) => {
  const files = corpus();
  if (!files) return ctx.skip(skipReason(GUARD));
  // A FLOOR, BECAUSE AN EMPTY CORPUS PASSES EVERY ARM BELOW. 34 documents at the time of writing; a
  // listing that shrank to a few would still report no offence.
  assert.ok(files.length >= 30, `only ${files.length} document(s) were read — the listing is broken, not the docs`);
  ctx.diagnostic(`${files.length} documents read`);
  for (const f of ["README.md", "docs/README.md", "docs/CLIENT-MCP.md", "docs/architecture/05-customer-profiles.md"])
    assert.ok(files.includes(f), `${f} is not in the corpus, so nothing here reads it`);
});

test("no document uses account, customer, client, tenant, brand, firm or matter for an organisation or a company", (ctx) => {
  const files = corpus();
  if (!files) return ctx.skip(skipReason(GUARD));
  const found = files.flatMap((f) => offences(f, read(f)));
  assert.deepEqual(found.map((o) => `${o.file}:${o.line}  [${o.word}]  ${o.context}`), [],
    `${found.length} use(s) of the seven words that no exception covers. The organisation owns an installation `
    + "or an account and the company is whose names are cleared: say organisation or company. If this use "
    + "names something else, add the phrase to EXCEPTIONS with the reason — never the bare word.");
});

test("every exception still excuses something, so none of them is a hole kept open for nothing", (ctx) => {
  const files = corpus();
  if (!files) return ctx.skip(skipReason(GUARD));
  const used = new Set();
  for (const f of files) offences(f, read(f), used);
  const idle = EXCEPTIONS.flatMap((ex) => ex.phrases).filter((p) => !used.has(p)).map(String);
  assert.deepEqual(idle, [], "these exception phrases match no use in the documents any more — delete them, "
    + "because an idle exception excuses the next misuse without anyone deciding it should");
});

test("every exception carries a reason, and none is a bare word", () => {
  assert.ok(EXCEPTIONS.length > 0, "no exceptions parsed — the arms above would be judging an empty table");
  for (const ex of EXCEPTIONS) {
    assert.ok(ex.phrases.length > 0, "an exception with no phrase excuses nothing and explains nothing");
    assert.ok(typeof ex.reason === "string" && ex.reason.length >= 40, `${ex.phrases[0]} has no reason worth the name`);
    for (const phrase of ex.phrases) {
      // THE FLAGS ARE PART OF THE RULE: without `g` matchAll throws, and without `i` a capitalised use at
      // the start of a sentence walks past the exception written for it.
      assert.ok(phrase.flags.includes("g") && phrase.flags.includes("i"), `${phrase} must be global and case-insensitive`);
      // A BARE WORD IS ONE OF THE SEVEN WITH ONLY ITS ENDINGS AND BOUNDARIES AROUND IT. Allowed only when
      // scoped to files, where the reason can be true of every use; anywhere else it would excuse misuse too.
      const core = phrase.source.replace(/\\b/g, "").replace(/\(\?:s\|'s(?:\|s')?\)\?$/, "").toLowerCase();
      assert.ok(!WORDS.includes(core) || ex.files, `${phrase} excuses a bare word everywhere — scope it to the files it is true of`);
    }
  }
});

test("the matcher fires on a planted use in every form, and an exception excuses only its own phrase", () => {
  const planted = [
    "The customer's portal lists each client.",
    "Customers and\nclients alike, across a line break.",
    "Every tenant gets a brand and a firm.",
    "A matter for the account.",
  ].join("\n");
  const hits = offences("docs/planted.md", planted).map((o) => o.word.toLowerCase());
  assert.deepEqual(hits, ["customer's", "client", "customers", "clients", "tenant", "brand", "firm", "matter", "account"]);

  const excused = [
    "Connect an MCP\nclient to the client\ndoor, run as the service account.",
    "Set `CLEAROTRON_CUSTOMERS_DIR` and read [the profiles](architecture/05-customer-profiles.md).",
    "The client gate closed; a law firm runs it.",
  ].join("\n");
  assert.deepEqual(offences("docs/planted.md", excused), [], "an exception or a mask stopped excusing its own phrase");

  // THE PHRASE, NOT THE LINE. The same line holding an excused phrase and a misuse still reports the misuse.
  const mixed = offences("docs/planted.md", "The client door is where our clients sign in.");
  assert.deepEqual(mixed.map((o) => o.word), ["clients"]);

  // A SCOPED EXCEPTION STAYS IN ITS FILES: `matter` is excused in the architecture pack and nowhere else.
  assert.deepEqual(offences("docs/architecture/planted.md", "One matter in."), []);
  assert.deepEqual(offences("docs/planted.md", "One matter in.").map((o) => o.word), ["matter"]);
});

// THE README OPENS WITH A COMPANY CLEARING ITS OWN NAMES, AND REACHES THE LAW FIRM SECOND. Its first section,
// everything above the first `## ` heading, is what a stranger reads to decide who the product is for, so it
// speaks to a company about its own names. A law firm acting for several companies is a second use of the
// same installation, and the README still has to reach it — further down, not in the opening.
const LAW_FIRM = /\blaw[\s-]+firms?\b/i;
const OWN_COMPANY = /\byour\s+compan(?:y|ies)\b/i;

test("the README's first section is a company clearing its own names, and the law firm comes after it", () => {
  const text = read("README.md");
  const end = text.search(/^## /m);
  assert.ok(end > 0, "README.md has no `## ` heading, so there is no first section to judge");
  const first = text.slice(0, end);
  assert.match(first, OWN_COMPANY, "the README's first section does not speak to a company about its own names");
  assert.doesNotMatch(first, LAW_FIRM, "the README's first section describes the law-firm setup, which comes second");
  assert.match(text.slice(end), LAW_FIRM, "the README never reaches the law-firm setup, so a firm acting for several companies cannot find it");
});
