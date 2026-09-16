// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE FIVE CLASSES, DRIVEN — not read.
//
// Every arm below plants a specimen and watches it go red, and every arm that asserts an ABSENCE is
// paired with the same specimen somewhere the class does read, so an absence cannot be the site rule
// being blind rather than the exemption doing its job. That pairing is the whole point: an arm asserting
// "the exempt file is clean" passes just as well when the scanner is broken.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CLASSES, LINE_CLASSES, BLOCK_CLASSES, EXEMPT_PATHS, CAVEATS,
  fileOffences, offendingClasses, isExempt, printedText, withoutInterpolations,
  eyebrowOverHeading, writesItsOwnHeader, restatingLede, drawsScreen, censusOf,
} from "../../shared/writing-standard-classes.mjs";
import { saysSomethingNew } from "../../shared/says-something-new.mjs";
import { addedByFile } from "../../scripts/writing-standard-check.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

const RENDERER = "driver/publish/render-knockout.mjs";
const SCREEN = "portal-ui/src/screens/Specimen.tsx";

const ids = (offences) => offences.map((o) => o.id);

// ── THE TABLE ITSELF ────────────────────────────────────────────────────────────────────────────

test("the table carries the five classes the standard names, and every one has a reason", () => {
  assert.deepEqual(CLASSES.map((c) => c.id), [
    "engineering-identifier", "internal-marker", "known-caveat", "eyebrow-heading", "restating-lede",
  ]);
  // A `why` is what the author reads when the guard refuses them. A class with none refuses without
  // saying what to do instead, which is how a guard becomes a thing people route around.
  for (const c of CLASSES) {
    assert.ok(c.why && c.why.length > 40, `${c.id} has no usable reason`);
    assert.ok(typeof c.paths === "function", `${c.id} does not say where it looks`);
  }
  assert.equal(LINE_CLASSES.length + BLOCK_CLASSES.length, CLASSES.length);
});

// ── ONE SPECIMEN PER CLASS, EACH DRIVEN ─────────────────────────────────────────────────────────

test("engineering-identifier fires on a capitalised token in a renderer's printed text", () => {
  const line = "  return `<p>The CONNECTION_CLOSED limit applied.</p>`;";
  assert.ok(ids(fileOffences(RENDERER, line)).includes("engineering-identifier"));
});

test("engineering-identifier fires on a double-underscore tool name and a backticked identifier", () => {
  // THE OTHER MEMBERS OF THE CLASS. One specimen proves the class is wired; it does not prove the
  // class is the one the table describes, and three of these four shapes would have passed a check
  // built for the first alone.
  assert.ok(ids(fileOffences(RENDERER, "  return `<p>server__operation failed</p>`;")).includes("engineering-identifier"));
  assert.ok(ids(fileOffences(RENDERER, "  return `<p>see \\`lib/scrub.mjs\\` for this</p>`;")).includes("engineering-identifier"));
  assert.ok(ids(fileOffences(RENDERER, "  return `<p>the Japan adapter was unreachable</p>`;")).includes("engineering-identifier"));
});

test("internal-marker fires on a reviewer-only marker that reaches rendered output", () => {
  assert.ok(ids(fileOffences(RENDERER, '  return `<div class="internal">notes</div>`;')).includes("internal-marker"));
  assert.ok(ids(fileOffences(RENDERER, '  return `<span class="rv-tag">x</span>`;')).includes("internal-marker"));
});

test("known-caveat fires on a caveat sentence, and on one BUILT ACROSS SOURCE LINES", () => {
  const oneLine = "  const t = 'A count is not a conflict; the cards above say which filings matter.';";
  assert.ok(ids(fileOffences(RENDERER, oneLine)).includes("known-caveat"));

  // THE CASE A PER-LINE READING LOSES, and the reason `fileOffences` joins the printed text. The
  // knockout's scope block is six lines of concatenation and the forbidden sentence straddles two of
  // them; read line by line this matches nothing, and a silent zero joins the floor, which only falls.
  const split = [
    "  const SCOPE = 'marketplace and web use plus a count of register filings. What it is not. A '",
    "    + 'clearance search. We drew no register conclusions and give no filing advice. A name that '",
    "    + 'passes here is not clear; it goes on to clearance.';",
  ].join("\n");
  const found = fileOffences(RENDERER, split);
  assert.ok(ids(found).includes("known-caveat"), "a caveat split across source lines was not seen");
  assert.ok(found.filter((o) => o.id === "known-caveat").length >= 2,
    "only one of the caveats spanning the concatenation was found");
  // AND IT IS ATTRIBUTED TO A REAL LINE. A hit reported against the wrong line reads as a correct
  // finding and sends the reader somewhere else.
  for (const o of found) assert.ok(o.line >= 1 && o.line <= 3, `line ${o.line} is not in the specimen`);
});

test("eyebrow-heading fires on a screen that writes its own heading, and on an eyebrow over one", () => {
  const ownHeader = '<div className="screen"><h1>Planted</h1><PageHeader title="Planted" /></div>';
  assert.equal(writesItsOwnHeader(ownHeader), "opens with a heading of its own, before the shared component");
  assert.ok(ids(fileOffences(SCREEN, ownHeader)).includes("eyebrow-heading"));

  // OVER A WINDOW, NOT ADJACENT LINES. The pair that prompted this rule had a component and a
  // four-line note between the two, and an adjacency check called that screen clean.
  const windowed = ['<span className="eyebrow">People</span>', "  {/* a note */}", "  <Thing />", "", "<h1>People</h1>"].join("\n");
  assert.equal(eyebrowOverHeading(windowed).length, 1);
  assert.equal(eyebrowOverHeading('<span className="eyebrow">x</span>' + "\n".repeat(12) + "<h1>y</h1>").length, 0,
    "an eyebrow twelve lines above a heading is a section label, not a double header");
});

test("restating-lede fires when the lede's content words are all in the title", () => {
  const restates = '<PageHeader title="Company settings" lede="Settings for the company." />';
  assert.equal(restatingLede(restates).length, 1);
  assert.ok(ids(fileOffences(SCREEN, restates)).includes("restating-lede"));

  // THE OTHER SIDE OF THE DISTINCTION. A lede saying something new is the ordinary case and must pass,
  // or the class refuses every header in the product and gets deleted.
  const adds = '<PageHeader title="Company settings" lede="Who may start a search, and how many run at once." />';
  assert.equal(restatingLede(adds).length, 0);
  assert.ok(!ids(fileOffences(SCREEN, adds)).includes("restating-lede"));

  // AND A LEDE WITH NO CONTENT WORDS IS A DIFFERENT FAULT, not this one.
  assert.equal(restatingLede('<PageHeader title="Home" lede="" />').length, 0);
});

// ── THE SITE RULE ───────────────────────────────────────────────────────────────────────────────

test("A COMMENT AND AN INTERPOLATION ARE NOT PRINTED TEXT — the site rule, driven", () => {
  assert.equal(printedText("  // CONNECTION_CLOSED is the code we get").trim(), "");
  assert.deepEqual(ids(fileOffences(RENDERER, "  // CONNECTION_CLOSED is the code we get")), []);

  // THE MID-TEMPLATE LINE. Read on its own it carries no backtick, so its attributes look like plain
  // strings; what saves it is that an interpolation is removed by shape. Four hits in the clearance
  // renderer were exactly this, every one naming an array the reader never sees.
  assert.ok(!withoutInterpolations('left:${STOP_LEFT[i]}').includes("STOP_LEFT"));
  assert.ok(!withoutInterpolations('${fn({ a: 1 })}x').includes("fn"),
    "brace counting failed: a lazy match closes at the first brace and leaves the name behind");
  assert.deepEqual(
    ids(fileOffences("driver/publish/render.mjs", '  <div class="pill" style="background:var(${STOP_VAR[i]})">')),
    []);
});

test("A DIAGNOSTIC IS READ BY AN OPERATOR, NOT A CLIENT — and it spans its whole statement", () => {
  const thrown = [
    "    throw new Error(",
    "      'CLEAROTRON_CUSTOMERS_DIR is unset, so the only roster available is the bundled one at '",
    "      + 'driver/profiles, which shares no keys with the config store.');",
  ].join("\n");
  assert.deepEqual(ids(fileOffences("driver/publish/pool-admin.mjs", thrown)), [],
    "the keyword is on the first line only — a per-line test excuses the throw and refuses its message");

  // THE PAIRED POSITIVE. Without it this arm passes just as well when the scanner reads nothing at all.
  const printed = "    return `<p>CLEAROTRON_CUSTOMERS_DIR is unset</p>`;";
  assert.ok(ids(fileOffences("driver/publish/pool-admin.mjs", printed)).includes("engineering-identifier"),
    "the same token outside a diagnostic is not being seen — the exclusion is swallowing everything");
});

test("A URL IS AN ADDRESS, NOT PROSE, and it is stripped before interpolations are", () => {
  // ORDER MATTERS AND IT IS ASSERTED. Dropping `${m[1]}` first inserts a space that ends the URL early,
  // so the register's own query string survives as prose. Measured: one hit, and it looked real.
  const href = "  ({ href: `https://tsdr.uspto.gov/#caseNumber=${m[1]}&caseType=SERIAL_NO&searchType=statusSearch` })";
  assert.deepEqual(ids(fileOffences("driver/publish/office-record-links.mjs", href)), []);
});

// ── THE TWO EXEMPT PATHS ────────────────────────────────────────────────────────────────────────

test("THE TWO EXEMPT PATHS ARE NAMED, AND A SPECIMEN INSIDE THEM DOES NOT FIRE", () => {
  assert.deepEqual(EXEMPT_PATHS, ["docs/writing-standard.md", "docs/enforcement.md"]);
  assert.equal(EXEMPT_PATHS.length, 2, "a third exemption is a change somebody has to argue for");
  for (const p of EXEMPT_PATHS) assert.ok(isExempt(p), `${p} is listed and not exempt`);

  const specimen = '  return `<div class="internal">The CONNECTION_CLOSED limit. What it is not. A clearance search.</div>`;';
  for (const p of EXEMPT_PATHS) assert.deepEqual(fileOffences(p, specimen), [], `${p} is not exempt in practice`);

  // THE PAIR THAT MAKES THE ABSENCE MEAN SOMETHING. The identical text, somewhere the classes do read,
  // must fire — otherwise the four assertions above are satisfied by a scanner that sees nothing.
  const elsewhere = ids(fileOffences(RENDERER, specimen));
  assert.ok(elsewhere.includes("engineering-identifier") && elsewhere.includes("internal-marker")
    && elsewhere.includes("known-caveat"),
    "the exempt-path arms are passing because nothing is being scanned, not because of the exemption");
});

// ── ONE DEFINITION OF THE SHARED RULE ───────────────────────────────────────────────────────────

test("restating-lede AND THE KNOCKOUT'S CAVEAT FILTER CALL ONE FUNCTION — no second copy exists", () => {
  // The rule: "does this sentence assert anything its reference does not". Two definitions of it is one
  // definition and one imitation, and the imitation is whichever the reader did not run.
  const renderer = read(RENDERER);
  const classes = read("shared/writing-standard-classes.mjs");

  assert.match(renderer, /from ['"]\.\.\/\.\.\/shared\/says-something-new\.mjs['"]/,
    "the knockout renderer no longer imports the shared predicate");
  assert.match(classes, /from ['"]\.\/says-something-new\.mjs['"]/,
    "the class table no longer imports the shared predicate");

  // AND NEITHER HAS ITS OWN COPY. Asserted on the definition, not on a mention: a comment naming the
  // function must not satisfy this, and a re-implementation under a new name is what this is for.
  for (const [name, src] of [["the knockout renderer", renderer], ["the class table", classes]]) {
    assert.doesNotMatch(src, /function\s+saysSomethingNew\s*\(/, `${name} has its own copy of the predicate`);
    assert.doesNotMatch(src, /const\s+STOPWORDS\s*=/, `${name} has its own stopword set`);
    assert.doesNotMatch(src, /const\s+contentWords\s*=/, `${name} has its own content-word split`);
  }

  // THE PREDICATE ITSELF, driven — including the stem defect it was repaired for, so a future edit
  // that reintroduces it is caught here rather than by every caveat reading as new.
  assert.equal(saysSomethingNew("Settings for the company.", "Company settings"), false);
  assert.equal(saysSomethingNew("Who may start a search.", "Company settings"), true);
  assert.equal(saysSomethingNew("conclusions", "conclusion"), false, "singular and plural are not folded");
  assert.equal(saysSomethingNew("gives", "give"), false, "the stem is not idempotent on the singular again");
  assert.equal(saysSomethingNew("", "anything"), false, "an empty line asserts nothing");
});

// ── THE DIFF READER ─────────────────────────────────────────────────────────────────────────────

test("the diff reader maps an added line to its number in the file at HEAD", () => {
  const diff = [
    "--- a/x.mjs", "+++ b/x.mjs",
    "@@ -10,0 +11,2 @@", "+one", "+two",
    "--- a/y.mjs", "+++ b/y.mjs",
    "@@ -1,1 +1,1 @@", "-gone", "+here",
  ].join("\n");
  const by = addedByFile(diff);
  assert.deepEqual([...by.get("x.mjs")].sort((a, b) => a - b), [11, 12]);
  assert.deepEqual([...by.get("y.mjs")], [1]);
});

// ── THE POPULATION IS REAL ──────────────────────────────────────────────────────────────────────

test("THE CENSUS READS A PLAUSIBLY LARGE TREE, so every absence above is over a real corpus", () => {
  // A FLOOR FIRST. The arms above are mostly absences over specimens; this is the one that catches a
  // scanner reading nothing at all — a moved directory, a renamed extension, a path rule that stopped
  // matching. Without it the whole file certifies itself.
  const renderer = read(RENDERER);
  assert.ok(renderer.length > 50_000, "the knockout renderer is not the file this suite thinks it is");
  assert.ok(CAVEATS.length >= 5, `only ${CAVEATS.length} caveat sentence(s) — the fixture did not load`);
  assert.ok(drawsScreen('<div className="screen">x</div>'), "the screen derivation stopped recognising a screen");

  const live = fileOffences(RENDERER, renderer);
  assert.ok(live.length >= 5,
    `the knockout renderer yields ${live.length} hits — it carries the scope block and the marker, so this is the scanner failing, not the tree being clean`);

  const c = censusOf([RENDERER], (p) => read(p));
  assert.ok(c.total >= 5, "the census disagrees with the direct read of the same file");
});
