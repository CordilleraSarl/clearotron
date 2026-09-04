// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// contract-dictation.mjs — ONE CONTRACT, ONE AUTHORITATIVE STATEMENT.
//
// PURE and OFFLINE, like contract-audit.mjs: it takes a corpus of {file, text} and a contract registry
// and computes. Nothing here runs on a clearance. The impure edge — building the corpus out of the
// tracked tree — is scripts/contract-dictation-scan.mjs, and the split is not tidiness:
//
//   's hardest acceptance is "plant a divergence in a NEW authoring layer — the check must find it
//   STRUCTURALLY, not because the layer was enumerated". A checker that reads the tree itself can only
//   be tested by writing a file into the working tree, which is dirty, fights the repo-hygiene guards,
//   and — because `git ls-files` is the corpus — may not even be visible to the check being tested.
//   Taking the corpus as an argument makes the planted-layer test a five-line unit test.
//
// ── WHAT THIS EXISTS FOR ─────────────────────────────────────────────────────────────────────────────
//
// Six instances in one day (2026-08-14) of one defect: a line of dictated text with more than one
// author, or with a consumer nobody re-checked. Every fix widened a guard; every widening revealed
// another authoring layer phrasing the same contract a fourth way — dispatch, then SKILL.md, then the
// obligations block, then gateway.mjs's CORRECTIVE HINTS, which is what a seat reads at its moment of
// maximum obedience.: "phrasing-chasing cannot converge."
//
// So this check does not read sentences. IT READS IDENTIFIERS. `receipt_index`, `receipt_id`,
// `ABSOLUTE path`, `perplexity_research` — the field and tool names are the one thing that survives
// every rephrasing, because they are what the consumer on the other end actually parses. A contract
// whose subject is a sentence shape is phrasing-chasing re-entering through the registry.
//
// ── WHAT COUNTS AS SERVED TEXT ───────────────────────────────────────────────────────────────────────
//
// Text a model reads. Two structural sources, neither enumerated:
//
//   *.md under driver/skills/   served whole — the skills tree is RENDERED to the seat
//   *.mjs under driver/         the STRING LITERALS only, never the code lines
//
// The literal restriction is what makes the check usable at all. `disposition-union.mjs` writes the
// form's `receipt_id` key as code; `resolveCandidate` returns one. Those are the driver doing its job
// on the seat's behalf — the exact opposite of ordering a seat to type it. A line-based lint (E3's
// shape) cannot tell them apart and would fire on the fix as loudly as on the defect.
//
// A literal must also be PROSE to count: three words and 24 characters. A bare `"receipt_id"` key is
// not an instruction to anybody. This threshold is structural, not a phrasing test — it asks how long
// the string is, never what it says.

// ── the scanner ──────────────────────────────────────────────────────────────────────────────────────
//
// A small state machine over .mjs source: code · line comment · block comment · '…' · "…" · `…` · /…/.
//
// REGEX STATE IS NOT OPTIONAL IN THIS CODEBASE. `contract-audit.mjs` alone carries patterns like
// /["'`\\][^"'`\n]{0,90}</ — a scanner without a regex state reads that opening `"` as a string and
// desynchronises for the rest of the file, silently dropping every literal after it. A check that goes
// quiet halfway down a file is worse than no check: it reports zero and reads as a pass.
//
// Whether `/` opens a regex or divides is decided by the previous significant character, which is the
// standard heuristic and is exact for everything in this tree (a `/` after a value divides; after
// `( , = : [ ! & | ? { } ; return` it opens a pattern).
const REGEX_PRECEDERS = new Set(["(", ",", "=", ":", "[", "!", "&", "|", "?", "{", "}", ";", "\n", "+", "-", "*", "%", "<", ">", "~", "^"]);

/**
 * The string literals in a .mjs source, with the line each one starts on.
 *
 * Comments are dropped before anything else: a `//` is never dispatched to a model, and E3 learned
 * this the expensive way — its first version counted its own explanatory comments as the violations
 * they described, inflating the committed ceiling by 19 and leaving room for 19 real ones to land.
 *
 * @param {string} source
 * @returns {Array<{line:number, text:string}>} one entry per literal, newlines preserved inside it
 */
export function stringLiterals(source) {
  const src = String(source ?? "");
  const out = [];
  let i = 0, line = 1, prev = "\n", chainOpen = false;
  const N = src.length;

  const readString = (quote) => {
    const startLine = line;
    let buf = "";
    i += 1;
    while (i < N) {
      const c = src[i];
      if (c === "\\") { buf += src[i + 1] ?? ""; if (src[i + 1] === "\n") line++; i += 2; continue; }
      if (c === quote) { i += 1; break; }
      if (c === "\n") line++;
      // `${…}` inside a template is CODE, not served text: skip to the matching brace so an
      // interpolated expression cannot masquerade as dictation (and so its own quotes do not confuse
      // the scan). Nesting is counted because these expressions do carry object literals.
      if (quote === "`" && c === "$" && src[i + 1] === "{") {
        let depth = 1; i += 2;
        while (i < N && depth > 0) {
          if (src[i] === "{") depth++;
          else if (src[i] === "}") depth--;
          else if (src[i] === "\n") line++;
          i += 1;
        }
        buf += " ";       // the interpolation is a word boundary, never a joiner
        continue;
      }
      buf += c;
      i += 1;
    }
    out.push({ line: startLine, text: buf });
  };

  while (i < N) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "/") { while (i < N && src[i] !== "\n") i += 1; continue; }
    if (c === "/" && src[i + 1] === "*") {
      i += 2;
      while (i < N && !(src[i] === "*" && src[i + 1] === "/")) { if (src[i] === "\n") line++; i += 1; }
      i += 2; continue;
    }
    if (c === "/" && REGEX_PRECEDERS.has(prev)) {
      i += 1;
      let cls = false;
      while (i < N) {
        const r = src[i];
        if (r === "\\") { i += 2; continue; }
        if (r === "[") cls = true;
        else if (r === "]") cls = false;
        else if (r === "/" && !cls) { i += 1; break; }
        else if (r === "\n") { line++; break; }   // an unterminated pattern is a syntax error, not our problem
        i += 1;
      }
      prev = "/";
      continue;
    }
    if (c === "'" || c === '"' || c === "`") {
      // A `+` CHAIN IS ONE STATEMENT. gateway.mjs wraps its hints across five string fragments joined
      // by `+`, and the wrap lands mid-sentence: `…On each named row set ` + `\`receipt_id\` to one of
      // the ids…`. Treating each fragment as a unit puts the order in one and the field in the next,
      // and the check reads both as innocent — measured, not feared: it silently missed the live
      // cite_absent hint on the first run. Merge while the only code between two literals is `+`.
      const beforeIdx = out.length;
      readString(c);
      if (beforeIdx > 0 && chainOpen) {
        const tail = out.pop();
        out[out.length - 1].text += " " + tail.text;
      }
      chainOpen = false;
      prev = c;
      continue;
    }
    if (c === "+") { chainOpen = true; prev = c; i += 1; continue; }
    if (c === "\n") { line++; prev = "\n"; i += 1; continue; }
    if (!/\s/.test(c)) { prev = c; chainOpen = false; }
    i += 1;
  }
  return out;
}

/** Three words and 24 characters — an instruction, not a key name. */
export const PROSE_MIN_CHARS = 24;
export const PROSE_MIN_WORDS = 3;
export const isProse = (s) => String(s ?? "").trim().length >= PROSE_MIN_CHARS
  && String(s ?? "").trim().split(/\s+/).length >= PROSE_MIN_WORDS;

/**
 * The served UNITS of one file — a unit being one whole statement, not one line.
 *
 * THE UNIT IS THE WHOLE STATEMENT AND THAT IS THE DESIGN, not a convenience. Every one of these
 * instructions spans several source lines, and half of them read as the opposite of their meaning when
 * cut at a line boundary: `leave its \`receipt_id\`` / `alone and give it only your \`ruling\`` is a
 * carve-out on one line and an order on the next. A per-line check would fire on the carve-out and miss
 * the order — the precise inversion of what it is for.
 *
 *   .mjs   one string literal (concatenated `+` fragments are separate literals; they are also
 *          separate sentences in every instance in this tree)
 *   .md    one blank-line-separated paragraph, which is how a seat reads a skill file
 *
 * @param {string} file  path, used to decide .md vs .mjs
 * @param {string} text
 * @returns {Array<{line:number, text:string}>}
 */
export function servedUnits(file, text) {
  const f = String(file ?? "");
  if (f.endsWith(".md")) {
    const out = [];
    let n = 0, start = 1, buf = [];
    for (const line of String(text ?? "").split("\n")) {
      n += 1;
      if (line.trim()) { if (!buf.length) start = n; buf.push(line); }
      else if (buf.length) { out.push({ line: start, text: buf.join("\n") }); buf = []; }
    }
    if (buf.length) out.push({ line: start, text: buf.join("\n") });
    return out;
  }
  if (!f.endsWith(".mjs")) return [];
  return stringLiterals(stripDeclarationBlocks(text)).filter((l) => isProse(l.text));
}

/**
 * Remove `contractElements: { … }` — E1's declaration ABOUT the contract, which is never dispatched.
 *
 * THE SAME LESSON E3 LEARNED TWICE, AND IT COSTS MORE HERE. That block classifies each element by
 * quoting it, so it necessarily contains lines like "disposition form `receipt_id` — copy one of that
 * row's own candidate ids": a perfect, verbatim statement of the retired contract, sitting in a `why:`
 * string that no seat has ever read. Left in, this check fires on the audit that describes the defect
 * instead of the defect — and the only way to keep it green would be to stop describing it.
 *
 * Blank-line-preserving so the literal line numbers this returns still point at the real source lines.
 * Anchored on indentation rather than a brace count, because the element values contain braces.
 */
export function stripDeclarationBlocks(text) {
  const lines = String(text ?? "").split("\n");
  const out = [];
  let depth = null;
  for (const line of lines) {
    if (depth === null && /^(\s*)contractElements: \{$/.test(line)) { depth = line.match(/^(\s*)/)[1].length; out.push(""); continue; }
    if (depth !== null) { if (line === `${" ".repeat(depth)}},`) depth = null; out.push(""); continue; }
    out.push(line);
  }
  return out.join("\n");
}

// ── scope ────────────────────────────────────────────────────────────────────────────────────────────
//
// TWO exclusions, both named, both carrying the reason in words, and both covered by the
// no-redundant-rule test below. A silent path filter here is the whitelist forbids, wearing a
// different coat: "the check reads the real served doctrine … or it rots exactly the way the
// instances did".
export const SCOPE_RULES = [
  {
    match: (f) => /(^|\/)contract-dictation(-registry)?\.mjs$/.test(f),
    why: "the checker and its registry state the retired identifiers VERBATIM in order to ban them. E3 hit this twice — "
      + "skipping comments was not enough, because the patterns are code lines — and each miss raised the "
      + "ceiling it was supposed to hold. A check that fires on its own statement of the contract is a "
      + "check nobody can keep green honestly.",
  },
  {
    match: (f) => f.startsWith("driver/test/") || f.includes("/test/fixtures/"),
    why: "tests PIN the retired text on purpose. write-return-names-the-form.test.mjs pastes the pre-#921 "
      + "closing line as a literal called OLD, precisely so the no-form path cannot drift into agreement "
      + "with the implementation. Scanning it would make the pin unwritable. Test files are not served: "
      + "no seat reads driver/test/.",
  },
  // ── THE contract-e3-backlog.mjs EXCLUSION WAS DELETED 2026-08-16, and this note is why ──────────
  //
  // It read: "the E3 backlog INVENTORIES dispatch text by quoting it verbatim … including two full pre-M1
  // meaning-sweep dispatches. An inventory of a defect is not an instance of it." That was true when it was
  // written and it is no longer true of the file.
  //
  // MEASURED, not assumed: every one of the backlog's 9 violations under this checker came from the FOUR
  // receipt_id / R-XXXXXXXX rows — 6 `receipt-binding` and 3 `quote-anchor`, all of them the retired
  // vocabulary M1 and M2 removed from the tree. Re-scoping those rows to the dictation that actually
  // survives took the last verbatim retired text out of the file: the backlog now fires ZERO.
  //
  // So the rule protected nothing, and this file's own test says what to do about that in its own words —
  // "a rule that has stopped excluding anything is a rule nobody may keep, because the next reader cannot
  // tell it from a whitelist", with rejecting the whitelist route to green by name. Deleted rather
  // than carried.
  //
  // IF A FUTURE ROW QUOTES RETIRED DICTATION VERBATIM AGAIN, this checker will fire on the backlog — and
  // that is the correct behaviour to arrive at deliberately. Re-add the exclusion then, with a witness
  // that exists, rather than keeping one now against a file that no longer needs it.
];

/** Is this file part of the served corpus? @returns {{in:boolean, why:string|null}} */
export function scopeOf(file) {
  const rule = SCOPE_RULES.find((r) => r.match(String(file ?? "")));
  return rule ? { in: false, why: rule.why } : { in: true, why: null };
}

/**
 * Every divergence between the served corpus and the registry.
 *
 * THE RULE IS CO-MENTION, AND IT CARRIES NO LEXICON OF VERBS. A served statement that names a retired
 * field must name the field that replaced it, in the same statement. That is the whole test.
 *
 * The first draft tried to separate ORDERING a field from DESCRIBING one, with a shared verb list.
 * Measured against the tree it did both jobs badly: it fired on "leave its `receipt_id` alone" (a
 * carve-out) and on "the driver has already filled in" (a description), and it MISSED "Do not stop
 * until every quote-required row's `quote` is one continuous run", which is an order with no verb in
 * any list. That is phrasing-chasing wearing a lint's clothes, and exists because it cannot
 * converge.
 *
 * Co-mention needs no verb because it asks a question about the STATEMENT rather than the sentence: if
 * this text is worth telling a seat about the old field, it is worth telling it which field replaced
 * it. Every legitimate mention passes by adding four words; every stale order fails until someone
 * reads it. The remedy is the same in both cases, which is what makes the check honest.
 *
 * @param {Array<{file:string, text:string}>} corpus
 * @param {Array<object>} contracts
 * @returns {Array<{contract:string, file:string, line:number, text:string, why:string}>}
 */
export function dictationViolations(corpus, contracts) {
  const out = [];
  for (const { file, text } of corpus ?? []) {
    if (!scopeOf(file).in) continue;
    const units = servedUnits(file, text);
    for (const c of contracts ?? []) {
      if (c.appliesTo && !c.appliesTo(file)) continue;
      for (const u of units) {
        const v = c.violation(u, file);
        if (v) out.push({ contract: c.id, file, line: u.line, text: u.text.replace(/\s+/g, " ").trim(), why: v });
      }
    }
  }
  return out;
}

/**
 * A FIELD contract: exactly one field name is the one a seat is ordered to write, and the field it
 * replaced must never be ordered again.
 *
 * `authority` is the site that composes the one authoritative statement — recorded so a violation tells
 * its reader where the right sentence lives, which is the only thing that makes the failure actionable.
 */
export function fieldContract({ id, what, authority, orders, retired, retiredWhy }) {
  return {
    id, what, authority, orders, retired,
    violation(unit) {
      if (!retired.test(unit.text)) return null;
      if (orders.test(unit.text)) return null;
      return `${retiredWhy} The one authoritative statement is ${authority}.`;
    },
  };
}

/**
 * A SOLE-AUTHOR contract: a distinctive dictated phrase may appear in served text in exactly one place.
 *
 * The shape for a contract whose text is COMPOSED — `writeReturn`'s closing line, which found
 * naming the prose write-up as "your output" while the gated deliverable was the driver-written form,
 * and which `mock-stage-fixtures.mjs` separately re-parses with /ABSOLUTE path[^:]*:\s*(\/\S+)/. Two
 * consumers, one sentence: a second authoring of it does not have to be WRONG to be a defect, because
 * only one of the two copies will be fixed the next time either consumer changes.
 *
 * `author` matches the file allowed to compose it. Everything else is a second author.
 */
export function soleAuthorContract({ id, what, phrase, author, authority, why }) {
  return {
    id, what, authority,
    violation(unit, file) {
      if (!phrase.test(unit.text)) return null;
      if (author.test(file)) return null;
      return `${why} The one authoritative statement is ${authority}.`;
    },
  };
}

/**
 * A TOOL-ORDER contract: served doctrine must not order a tool the seat does not hold.
 *
 * The authority is the GRANT TABLE, read live — `toolGroupsForStage()` → `allowedToolsFor()` — never a
 * transcription of it.: "the check must read the real doctrine files the driver serves and the
 * real grant table — not a hand-maintained list of pairs, which rots the same way the mismatch did."
 *
 * `stagesOf` maps a corpus file to EVERY stage served it, and it comes from STAGES' own `skillReads`,
 * so a stage that gains a doctrine file is covered without anyone remembering to say so. Every reader
 * is checked, not just the first: a shared doctrine file is served whole to each of them, and the seat
 * that holds fewest tools is the one the order misleads.
 */
export function toolOrderContract({ toolNames, grantedFor, stagesOf, backlog = [] }) {
  const excused = new Set(backlog.map((b) => `${b.stage}:${b.tool}`));
  return {
    id: "tool-order",
    what: "a stage's served doctrine orders a tool the seat is not granted",
    authority: "gather-config.mjs toolGroupsForStage() + allowedToolsFor()",
    appliesTo: (f) => stagesOf(f).length > 0,
    violation(unit, file) {
      for (const stage of stagesOf(file)) {
        const held = grantedFor(stage);
        for (const tool of toolNames) {
          if (!new RegExp(`\\b${tool}\\b`).test(unit.text)) continue;
          if (held.has(tool)) continue;
          if (excused.has(`${stage}:${tool}`)) continue;
          return `stage \`${stage}\` is served doctrine ordering \`${tool}\`, and its grant `
            + `(${[...held].filter((t) => t.includes("_")).join(", ") || "no MCP tools"}) does not carry it. `
            + `Either the grant is wrong or the order is — gather-config.mjs is the authority for which.`;
        }
      }
      return null;
    },
  };
}

/** Group violations by contract, for a report a human reads. */
export function byContract(violations) {
  const m = new Map();
  for (const v of violations ?? []) {
    if (!m.has(v.contract)) m.set(v.contract, []);
    m.get(v.contract).push(v);
  }
  return m;
}
