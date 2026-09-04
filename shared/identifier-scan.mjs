// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The identifier matcher and the operator-identity battery, as ONE implementation.
//
// WHY THIS FILE EXISTS. Three callers need to agree on what "this line names a retired identity"
// means: the corpus sweep in driver/test/no-client-identifiers.test.mjs, that file's own construction
// assertions and planted canary, and the publication scan that reads every blob in the history
// (scripts/publication-scan.mjs). They have already drifted once — the test's own comment records that
// when three places each rebuilt the regex, a fix to one was not a fix to the others, and the retired
// publication gate was a fourth copy with its own spelling of the same rules. A matcher with four
// spellings has four answers, and the one that matters is whichever the reader did not run.
//
// So the rules live here and nowhere else. Anything that wants to know whether a line is clean imports
// from this file.
//
// THE TABLE IS NOT HERE. shared/identifier-blocklist.mjs owns the names (sentinels, or sentinels ∪ the
// private roster). This file owns only the matching — it names no identity of its own beyond the
// platform tokens ALLOWED_CONTEXT has to spell out, which is why it declares itself in
// DECLARATION_SOURCES.

// ── the platform and public-register exemption ────────────────────────────────────────────────────
//
// Two classes of legitimate look-alike must survive, and they are why this cannot be a bare grep:
//   PLATFORMS — "Microsoft Store", apps.microsoft.com, Xbox: the storefronts the common-law lane
//     actually searches. Renaming them breaks real searches.
//   PUBLIC REGISTER OWNERS — Apple/Amazon/Microsoft/Google as third-party trademark holders, and real
//     public products (AMAZON SILK, Iron Galaxy Studios). Public register data is not client data.
// — THE EXEMPTION IS TWO RULES, AND THEY WERE ONE CONSTANT.
//
// It skipped the whole LINE. The reason it exists is token-level — `Microsoft Store` is a storefront the
// common-law lane genuinely searches, so the platform word must survive — but applying it per line made
// every OTHER roster name on that line exempt too. In a marketplace-search doctrine file the rows are
// `| <mark> | <platform> | <result> |`, so the platform column was exempting the mark column on every
// row, and five occurrences of a ruled-real mark were invisible. Not reported, not counted, not listed
// as skipped: the file simply read clean.
//
// Separated because they are genuinely different rules and the constant said nothing about which was
// which:
//
//   TOKEN-SCOPED — a phrase that is a legitimate name in its own right. It exempts ITSELF and nothing
//   else on the line. A roster name elsewhere on the same line is still a hit.
//
//   LINE-SCOPED — a phrase describing what the LINE IS. `owner-bound` and `watchlist owner` mark a line
//   as being about an owner relationship, where a name is the subject matter rather than a leak. Those
//   keep the old whole-line behaviour, which is correct FOR THEM.
//
// The split is itself the improvement the finding asked for: an author adding an alternative now has to
// decide which kind it is, and the two lists say what that decision means.
// — A SEPARATOR IS A BOUNDARY IN THE TEXT, and the matcher only ever knew about escapes.
//
// A space in a multi-word entry rendered as `\s*&?\s*`, so the matcher fired on `Foo Bar`, `FooBar`
// and `Foo&Bar` — and missed `foo-bar`, `foo_bar` and `foo.bar`, which is exactly how a mark is written
// once it becomes a slug, a filename, a run ref or a kebab identifier. 86 occurrences read clean on the
// tracked tree, the heaviest of them a real matter's run slug in captured fixtures.
//
// THIS IS ONE STEP OVER. That fix taught the matcher that an escape is not a letter: `\n` before a
// name is a boundary in the text though it is the letter `n` in the source. A hyphen between the words
// of a multi-word mark is the same fact — a boundary in the text the matcher read as a non-match. The
// lesson landed for the encoding case and never for the punctuation case.
//
// `/` IS INCLUDED, and it closes an inconsistency rather than opening a question: `unescapeBoundaries`
// already turns `%2f` into a space, so the percent-encoded form fired while the literal slash form did
// not. Two spellings of one thing, and the guard disagreed with itself about them.
//
// THE COST IS REAL AND IT WAS MEASURED, not assumed. A hyphen-tolerant match on an entry that is an
// ordinary word pair can pull in prose, so this was run against the whole tracked tree with the live
// roster armed before it landed. See the PR for the counts.
const SEPARATOR_CLASS = "[\\s._/-]*&?[\\s._/-]*";

export const ALLOWED_TOKEN_CONTEXT =
  /apps\.microsoft\.com|microsoft store|store\.steampowered|xbox|itch\.io|amazon\.com\/silk|amazon silk|iron galaxy|ironwhisk|iron-whisk|of (?:Apple|Amazon|Microsoft|Google)'s|\bMicrosoft \d+\/\d+/i;

export const ALLOWED_LINE_CONTEXT = /owner-bound|watchlist owner/i;

/**
 * Kept as the union so nothing that merely ASKS "is this line exempt at all" has to learn the split.
 * Callers deciding whether to REPORT a hit must use the two above — this one cannot tell you which
 * token earned the exemption, which is the whole defect names.
 */
export const ALLOWED_CONTEXT =
  new RegExp(`${ALLOWED_LINE_CONTEXT.source}|${ALLOWED_TOKEN_CONTEXT.source}`, "i");

/**
 * A SOURCE-LEVEL ESCAPE IS NOT A LETTER.
 *
 * A retired real customer sat in the repo verbatim and the guard declined it. The line had the shape
 * the `Lumeris` sentinel now stands in for:
 *
 *   ownNames:'Marlowe Holdings\nLumeris', ...
 *
 * The character before the name is the `n` of an escaped `\n` inside a JavaScript string, so the
 * leading `(?<![A-Za-z0-9])` saw `nLumeris` and refused. The name was sitting in the same string as its
 * own demo twin.
 *
 * Escapes become spaces before matching, which fixes the class rather than that one line: `\n`, `\t`,
 * `\r` and `\\` in any quoted source, HTML numeric and named entities, and `%20`-style percent escapes.
 * A boundary in the SOURCE is a boundary in the TEXT, whatever the encoding.
 */
export const unescapeBoundaries = (line) =>
  line
    .replace(/\\[nrtfv0]/g, " ")
    .replace(/\\\\/g, " ")
    .replace(/\\u[0-9a-fA-F]{4}|\\x[0-9a-fA-F]{2}/g, " ")
    .replace(/&(?:#\d+|#x[0-9a-fA-F]+|[a-zA-Z]+);/g, " ")
    .replace(/%[0-9a-fA-F]{2}/g, " ");

/**
 * Does this entry fire on this line?
 *
 * The trailing guard is dropped for a name distinctive enough that a longer token containing it is the
 * same name wearing a suffix ( — `Arden` must also catch `ARDENT`). The LEADING guard always stays,
 * which keeps this a word-boundary family rather than bare containment: `Arden` still cannot fire
 * inside `warden`.
 *
 * @param {string} name       the entry, spelled as the table spells it
 * @param {string} line       a line of source, already through unescapeBoundaries
 * @param {Set<string>} suffixable  entries whose trailing guard is dropped
 */
export function firesOn(name, line, suffixable) {
  return matchSpans(name, line, suffixable).length > 0;
}

/**
 * WHERE the name matched, not merely whether.
 *
 * The exemption used to skip the whole line, so a storefront in one table column exempted a real mark
 * in another. Deciding that per hit needs the hit's position, which `firesOn` threw away — so the regex
 * work lives here and `firesOn` is the boolean view of it. One matcher, two questions, and no second
 * pattern that can disagree with the first.
 *
 * @returns {{start: number, end: number}[]}
 */
export function matchSpans(name, line, suffixable) {
  const body = name.replace(/[&]/g, "\\&").replace(/ /g, SEPARATOR_CLASS);
  const tail = suffixable.has(name) ? "" : "(?![A-Za-z0-9])";
  const re = new RegExp(`(?<![A-Za-z0-9])${body}${tail}`, "gi");
  const out = [];
  for (const m of String(line).matchAll(re)) out.push({ start: m.index, end: m.index + m[0].length });
  return out;
}

/**
 * Does an exempting phrase actually COVER this hit, or merely share its line?
 *
 * A token-scoped exemption earns its keep only where it OVERLAPS the match: `Microsoft Store` exempts
 * the word Microsoft inside itself, and exempts nothing in the next column of the same table row.
 */
/**
 * Is this name REPORTABLE on this raw line — the one question every caller actually has.
 *
 * Exported because the declaration-liveness test asked it a second way and got a different answer: it
 * skipped lines on the union constant, so a storefront token made a declaration look dead when the
 * scanner was reporting the very hit it covers. Two answers to one question, which is the shape that
 * has cost this file three defects. There is now one implementation and both callers use it.
 *
 * Takes the RAW line and does its own unescaping, so no caller can forget that step.
 */
export function reportableOnLine(name, rawLine, suffixable) {
  if (ALLOWED_LINE_CONTEXT.test(rawLine)) return false;
  const text = unescapeBoundaries(rawLine);
  return matchSpans(name, text, suffixable).some((sp) => !tokenExemptionCovers(text, sp));
}

function tokenExemptionCovers(line, span) {
  for (const m of String(line).matchAll(new RegExp(ALLOWED_TOKEN_CONTEXT.source, "gi"))) {
    const s = m.index, e = m.index + m[0].length;
    if (span.start < e && s < span.end) return true;   // overlap, in either direction
  }
  return false;
}

// ── CAPTURED PUBLIC-REGISTER DATA ─────────────────────────────────────────────────────────
//
// `providers/*/test/fixtures/` holds vendor responses captured live from public trademark registers.
// They carry real registrants, attorneys and mark texts — third parties, surfaced by a search for
// something else entirely — and the roster retires ordinary English words. So the two collide by
// construction, and the collision arrives ASYNCHRONOUSLY: the private roster gains an entry and `main`
// goes red under a tree that nobody touched. That happened on 2026-08-16.
//
// WHAT IS NOT DONE ABOUT IT, and why. No path here is exempt, and none will be: captured data is the
// ONE place a genuine client identifier could hide in a fixture, so a sweep that stops looking there
// stops being a sweep. The one-line exemption is the tempting fix and it is the wrong one.
//
// What is done is the cheap half — the hit says what kind of file it landed in, so the reader is not
// diagnosing a mystery, and `scripts/check-capture.mjs` lets whoever captures a fixture check it
// against the current roster before writing rather than finding out from CI.
const CAPTURED_REGISTER_RE = /(?:^|\/)providers\/[^/]+\/test\/fixtures\//;

/** Is this path captured vendor data — full of third-party names by construction? */
export const isCapturedRegisterData = (file) => CAPTURED_REGISTER_RE.test(String(file ?? ""));

/**
 * What a reader needs after a hit lands in captured data. Printed ONCE per report rather than per hit,
 * and it names no identity.
 */
export const CAPTURED_DATA_GUIDANCE =
  "One or more hits are in CAPTURED PUBLIC-REGISTER DATA (providers/*/test/fixtures/). Those files hold "
  + "real third-party registrants by construction, and the roster is a PRIVATE file that moves "
  + "independently of this tree — so a red run with no diff means the roster gained an entry, not that "
  + "anything here changed. Two possibilities and no third: (a) an unrelated third party whose name "
  + "contains the entry — RE-CAPTURE the fixture from a different term and check it with "
  + "`node scripts/check-capture.mjs <file>` before writing; or (b) a genuine identifier of ours — remove "
  + "it. Do NOT exempt the path: captured data is the one place a real identifier could hide unseen.";

/**
 * Sweep a corpus for retired identities.
 *
 * The file list and the reader are injected so the same code path serves three corpora: the tracked
 * tree (`git ls-files` + readFileSync), a planted canary (a Map), and every blob in the history
 * (`git cat-file --batch`). A canary that fires therefore proves THIS sweep fires, not that a
 * freshly-built regex would.
 *
 * @param {string[]} files
 * @param {(f: string) => string|null} readFn  null for a blob that cannot be read as text
 * @param {{retired: [string,string][], suffixable: Set<string>, vetted?: (f: string, name: string) => unknown}} opts
 *   `vetted` returns truthy when a declaration covers this hit — see shared/vetted-identities.mjs.
 * @returns {string[]} `path:line: name → use twin`
 */
export function scanCorpus(files, readFn, { retired, suffixable, vetted = () => null }) {
  const hits = [];
  for (const f of files) {
    const t = readFn(f);
    if (!t) continue;
    // In captured register data the hit is reported by ENTRY NUMBER, never by value. The
    // ordinary format prints the retired name and its twin, which is right where the fix is "delete
    // this" — but a fixture collision is expected to fire on a tree nobody changed, and printing the
    // entry would write a retired identity into a CI log on a schedule. The number is a pointer, and
    // anyone running the guard armed has the roster to resolve it against.
    const captured = isCapturedRegisterData(f);
    t.split("\n").forEach((line, i) => {
      let entry = 0;
      for (const [name, twin] of retired) {
        entry += 1;
        // A LINE-scoped exemption skips the line; a TOKEN-scoped one must OVERLAP the match it excuses.
        // Both live in reportableOnLine, so the declaration test cannot answer this differently.
        if (!reportableOnLine(name, line, suffixable)) continue;
        if (vetted(f, name)) continue;
        hits.push(captured
          ? `${f}:${i + 1}: match table entry #${entry} of ${retired.length} (sentinels first, then the roster) `
            + "matched inside captured public-register data"
          : `${f}:${i + 1}: ${name} → use ${twin}`);
      }
    });
  }
  return hits;
}

// ── the operator-identity battery ─────────────────────────────────────────────────────────────────
//
// Four fixed patterns, three salvaged from the retired publication gate and one added by. They
// catch identity that is not a customer name: who runs this, on which box, which documents were never
// meant to leave, and who the product addresses as its own.
//
// THE ALLOWLISTS BELOW ARE NOT SOFTENING. Each mirrors a rule this repo already enforces elsewhere; a
// battery that re-litigates them produces a wall of hits nobody reads, and a gate nobody reads is a
// gate nobody runs.

// driver/test/deployment-hostnames.test.mjs states the rule inline: "Comments are fine (they explain
// the rule); only executable fallbacks are the bug." So this looks for the FALLBACK, not the path.
const EXECUTABLE_FALLBACK = /(\|\||\?\?)\s*["'`]\/home\/(azureuser|devuser|testuser)/;
const COMMENT_LINE = /^\s*(\/\/|#|\*|<!--)/;

// The staff domain is retained deployment identity. What must not ship is a PERSON-shaped local part:
// a dotted forename.surname, or one that is not a role.
//
// TWO DOMAINS, and the second is the product's own. `clearotron.ai` is a deliberately public
// brand asset — the commercial page, and the two mailboxes the launch docs are about to print, the
// `interested` and `security` ones. The rule that matters there is the rule that already matters at
// the staff domain: a role mailbox is what a public document should carry, and a named person's
// address is a leak whichever domain it sits at. Before this, the guard could not see the domain
// this repository is about to start printing addresses at — an allowlist for those mailboxes would
// have been inert, because nothing ever examined them.
//
// WHY THE RULED MAILBOXES JOIN ROLE_LOCALPART RATHER THAN THE DOMAIN GETTING AN EXEMPTION. 's
// ruling says `security` joins ROLE_LOCALPART "in the same PR, never a bypass", and that is the
// right shape: exempting the whole domain would also pass a named person's address at it, which is
// exactly the thing nobody should paste into a public README. Measured before widening rather than
// after — the tracked tree held zero addresses at this domain — so the widening reports nothing that
// already ships, and the first thing it can ever report is a new one.
//
// The label says "house domain" rather than "staff": a hit at the brand domain is not a staff
// address, and a reader sent looking for one would be looking in the wrong place.
// `contact` joins on the owner's ruling of 2026-08-24: the launch documents collapsed to ONE public
// mailbox, and counsel's pack (ADDITIONAL-TERMS.md, NOTICES.md, TRADEMARKS.md) prints it. Added here in
// the same PR that introduced it, per 's rule above — a ruled mailbox joins this list, it never gets
// a domain exemption. `interested` and `security` stay: they are no longer printed by any shipping
// document, but removing a localpart from an allowlist is how a future document that uses one again
// fails for a reason nobody expects.
const ROLE_LOCALPART = /^(owner|reviewer|staff|lawyer|admin|test|security|interested|contact|p\d+|[a-z])$/;
const ADDRESS = /([A-Za-z0-9._%+-]+)@(?:cordillera\.(?:ch|test)|clearotron\.ai)\b/i;

// A DOCUMENT MARKER, not the English phrase. "internal only — the report states the position reached"
// is a sentence about the product; "INTERNAL ONLY" stamped on a page is a classification that should
// never have reached a public tree. Matching the phrase caught the first and called it a leak, which is
// how a battery trains its reader to skim. Case-SENSITIVE on the stamped form.
const INTERNAL_MARKER = /\bINTERNAL[ -]ONLY\b/;
const INTERNAL_PHRASE = /\bfor internal use only\b/i;

// THE SECOND STAMPED FORM, and is why it exists. `driver/skills/prelim-search/worked-examples.md`
// opened with `INTERNAL — Gold-standard worked examples for prelim-search SYNTHESIS.` and shipped: the
// marker above requires the word ONLY, and a document stamped `INTERNAL —` carries the identical
// classification without it.
//
// Anchored to the START of the line, and to the punctuation a stamp uses, for exactly the reason the
// note above gives. Measured before widening rather than after: 992 lines across 222 files in this tree
// use "internal" as ordinary English, and a pattern matching the bare word would report all of them.
// This one reports none of them — prose does not open a line with `INTERNAL —` or `INTERNAL:`; a
// classification header is the only thing that does.
//
// It carries the same comment exemption as its siblings, so a stamp written as a one-line `<!-- INTERNAL
// — x -->` is still passed over. That is the battery's standing division of labour, not an oversight:
// commentary naming the operator is /'s sweep. The header was caught because the stamp
// sat on its own line INSIDE the block rather than on the `<!--` line — which is how a classification
// header is actually written, and why anchoring to line-start is the right narrowing.
const INTERNAL_STAMP = /^\s*INTERNAL\s*[—–:-]/;

// THE OPERATOR NAMED AS THE AUDIENCE. The class the other three could not see: not who runs
// this and not what is classified, but WHO THE PRODUCT THINKS IT IS TALKING TO. The remote runbook's
// title addressed this company's own colleagues; three READMEs called the HTTP face a staff surface a
// colleague adds to their chat app; the portal's staff role label carried the operator's name as a
// literal. Each reads as product documentation and is a statement about one deployment.
//
// NOTE FOR ANYONE EDITING THIS BLOCK: do not quote the offending strings verbatim. The sweep reads
// this file like any other and this comment would become a hit -- the same trap the assembled plant
// in the canary avoids.
//
// WHY IT IS THE OPERATOR NAME NEXT TO A STAFF NOUN, and not either half alone. "colleague" on its own
// is ordinary product vocabulary here -- a colleague in the CUSTOMER's organisation is a real thing
// the portal models, and thirteen legitimate uses say so. "Cordillera" on its own is the brand seam,
// which is meant to appear. It is the pair that means "the reader of this is one of us", and the pair
// is what shipped wrong every time.
//
// The optional parenthetical carries the form the runbook actually used: "your Cordillera (Entra)
// work email".
//
// NOT COMMENT-EXEMPT, on the same standard as ADDRESS above: an identity that ships inside a comment
// still ships. The systemd unit that survived the runbook rewrite proves it -- its offending line is
// a `#` comment on line 1, and a comment-exempt pattern would have called that file clean.
const OPERATOR_AUDIENCE = /\b(cordillera|our)\s*(\([^)]*\)\s*)?(colleagues?|staff|team|employees?)\b/i;

// The file that PLANTS one line per pattern, so the battery is proven to fire rather than assumed to.
// It therefore carries all three shapes in the clear and exempts itself, on the same standard as
// DECLARATION_SOURCES in shared/vetted-identities.mjs: declared once, here, so every caller agrees and
// nobody adds a fourth sweep that reports the canary as a leak. Callers filter on it — the corpus key
// is a path in one caller and a path-plus-object-id in the other, and only the caller knows which.
export const BATTERY_SOURCES = new Set(["driver/test/publication-scrub.test.mjs"]);

/**
 * Sweep a corpus for operator identity. Same injection shape as scanCorpus, for the same reason.
 *
 * @returns {string[]} `path:line  label`
 */
export function scanOperatorIdentity(files, readFn, { withheld = () => false } = {}) {
  const hits = [];
  for (const f of files) {
    const t = readFn(f);
    if (!t) continue;
    // A WITHHELD PATH DOES NOT SHIP, and pattern 4 is about what a shipped surface says to its reader.
    // The withheld design tree holds twenty-one hits of exactly this shape and every one is correct in
    // place: working notes, withheld wholesale by the list in shared/withheld-paths.mjs, and rewriting
    // them would be churn against files no installer ever sees. The predicate comes from the CALLER
    // because only the caller knows its key shape — a path here, a path-plus-object-id in the history
    // scan — the same reason BATTERY_SOURCES is filtered caller-side.
    //
    // This is not an escape hatch. The publication route makes the cut prove separately that every
    // withheld path was actually removed, so a file excused here is a file independently verified gone.
    // The first three patterns are deliberately NOT given this exemption — their behaviour is unchanged.
    const isWithheldFile = withheld(f);
    t.split("\n").forEach((line, i) => {
      const at = (label) => hits.push(`${f}:${i + 1}  ${label}`);
      const addr = ADDRESS.exec(line);
      if (addr && !ROLE_LOCALPART.test(addr[1].toLowerCase().split("+")[0])) at("person-shaped address at a house domain");
      if (EXECUTABLE_FALLBACK.test(line) && !COMMENT_LINE.test(line)) at("executable operator-home fallback");
      if ((INTERNAL_MARKER.test(line) || INTERNAL_PHRASE.test(line) || INTERNAL_STAMP.test(line))
        && !COMMENT_LINE.test(line)) {
        at("internal-only classification marker");
      }
      if (!isWithheldFile && OPERATOR_AUDIENCE.test(line)) at("operator named as the audience");
    });
  }
  return hits;
}

// ──: THE RETIRED PLATFORM ───────────────────────────────────────────────────────────────────
//
// The sixth pattern, and the narrowest: one token, matched case-insensitively, anywhere in a tracked
// file. It is here rather than in a one-off script because 's last scope line asks for exactly
// this — "extend the battery so this class cannot return" — and because the class it guards is the
// one the other five provably could not see. An integrator platform's name is not a person, not a
// home path, not a classification stamp, not an audience, and not a vendor standing where a category
// belongs. It is a product this repo used to be coupled to, and every one of the 159 files that
// carried its name on 2026-08-19 was green under all five.
//
// THE TOKEN IS ASSEMBLED, NOT WRITTEN. The sweep reads every tracked file, and this file is one of
// them — a literal here would make the guard its own first hit. The operator-identity canary solves
// the same problem the same way, and the note above its BATTERY_SOURCES set says so. The consequence
// worth knowing: `git grep` for the token will not find this module, so the way in is the test that
// calls it (driver/test/retired-platform-leaves-no-trace.test.mjs).
const RETIRED_PLATFORM = new RegExp(["open", "claw"].join(""), "i");

/**
 * Sweep a corpus for the retired platform's name. Same injection shape as the sweeps above.
 *
 * `declared` is a caller-supplied predicate over the corpus key. Unlike the vendor sweep's table this
 * one is expected to hold DIRECTORIES as well as files — a deployment's systemd units are one artifact
 * spread over several — so the caller owns the matching as well as the reasons.
 *
 * @returns {string[]} `path:line  the offending line, trimmed`
 */
export function scanRetiredPlatform(files, readFn, { declared = () => false } = {}) {
  const hits = [];
  for (const f of files) {
    if (declared(f)) continue;
    const t = readFn(f);
    if (!t) continue;
    t.split("\n").forEach((line, i) => {
      if (RETIRED_PLATFORM.test(line)) hits.push(`${f}:${i + 1}  ${line.trim().slice(0, 110)}`);
    });
  }
  return hits;
}

/** Does this text name the retired platform at all? The both-directions half of a declaration. */
export const namesRetiredPlatform = (text) => RETIRED_PLATFORM.test(String(text ?? ""));

// ──: ONE DEPLOYMENT'S TOPOLOGY, WRITTEN AS THE PRODUCT'S ────────────────────────────────────
//
// A different axis from the four above, and the reason it needed its own: those look for identity —
// a person, a home directory, an internal stamp. This looks for a CLAIM. The mechanism here has been
// generic since it was written (the origin re-validates the proxy's JWT whichever proxy is in front,
// and the seam is TRADEMARK_MCP_OIDC_ISSUER / _JWKS_URL / _EMAIL_CLAIM); only the framing said
// otherwise. A stranger installing this reads "Cloudflare edge" in an architecture diagram and
// reasonably concludes they need a Cloudflare account.
//
// WHY A QUALIFIER RATHER THAN A BAN. The vendor name must keep appearing — a runbook worked through
// one real proxy end to end is worth more to an installer than an abstract one, and 's rewrite
// deliberately kept it. What must not happen is the name standing where the CATEGORY belongs. So the
// rule is: name the vendor as much as you like, provided the line (or the one either side of it) says
// it is an example, a reference, or what THIS deployment happens to use.
//
// THE WINDOW IS ±1 LINE, and that is a real limitation rather than an oversight: a paragraph that
// qualifies itself in its first sentence and names the vendor in its fifth reads as unqualified here.
// Widening it would let a qualifier three paragraphs up excuse anything below, which is how a scan
// stops asserting. Where the window is genuinely too narrow the answer is a declaration with a reason,
// not a looser regex.
const VENDOR_AS_ARCHITECTURE = /\b(Cloudflare|cloudflared|Caddy|Entra)\b/;
const VENDOR_QUALIFIED =
  /\b(this deployment|worked example|worked through|reference deployment|reference:|reference one|for example|e\.g\.|here,|one such tool|if fronting|adapt|your own|is a choice|any (?:other )?(?:OIDC|JWT))/i;

/**
 * Sweep a corpus for a vendor named where the category belongs. Same injection shape as the sweeps
 * above, for the same reason.
 *
 * `declared` is a caller-supplied predicate over the corpus key: a file that legitimately names one
 * vendor throughout — a runbook worked through it, a deployment note about one box — says so once
 * rather than qualifying every line. The caller owns the table because the caller owns the reasons.
 *
 * @returns {string[]} `path:line  the offending line, trimmed`
 */
export function scanVendorAsArchitecture(files, readFn, { declared = () => false } = {}) {
  const hits = [];
  for (const f of files) {
    if (declared(f)) continue;
    const t = readFn(f);
    if (!t) continue;
    const lines = t.split("\n");
    lines.forEach((line, i) => {
      if (!VENDOR_AS_ARCHITECTURE.test(line)) return;
      const window = `${lines[i - 1] ?? ""} ${line} ${lines[i + 1] ?? ""}`;
      if (VENDOR_QUALIFIED.test(window)) return;
      hits.push(`${f}:${i + 1}  ${line.trim().slice(0, 110)}`);
    });
  }
  return hits;
}

/** Does this file name a vendor at all? The stale-declaration arm needs it; nothing else should. */
export function namesAVendor(text) { return VENDOR_AS_ARCHITECTURE.test(String(text ?? "")); }
