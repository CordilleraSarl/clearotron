// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Shared, presentation-agnostic parser for the report.md contract.
// Both the HTML renderer and the Excel renderer build from this one parse.
import { readFileSync } from 'node:fs';
// — the disposition enum, for the client cut of the audit block's cross-reference lines (below).
// findings-model.mjs owns it and depends only on framework.mjs (node:fs + node:path), so this stays a
// leaf-weight import: mcp-server/lib/driver.mjs's "dependency-free driver modules only" discipline holds.
import { DISPOSITIONS } from '../findings-model.mjs';

export function parseFront(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?/);
  const fm = {}; let body = text;
  if (m) {
    for (const line of m[1].split('\n')) {
      const i = line.indexOf(':');
      if (i > 0) fm[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
    body = text.slice(m[0].length);
  }
  return { fm, body };
}

export function parseSections(body) {
  const parts = body.split(/^# /m).filter(p => p.trim());
  const secs = {};
  for (const p of parts) {
    const nl = p.indexOf('\n');
    secs[p.slice(0, nl).trim()] = p.slice(nl + 1).trim();
  }
  return secs;
}

export function parseCards(text) {
  const parts = (text || '').split(/^## /m).filter(s => s.trim());
  return parts.map(p => {
    const lines = p.split('\n');
    const who = lines[0].trim();
    const meta = {}, blocks = []; let cur = null, i = 1;
    for (; i < lines.length; i++) {
      if (lines[i].startsWith('### ')) break;
      const mm = lines[i].trim().match(/^- (\w+):\s*(.*)$/);
      if (mm) meta[mm[1]] = mm[2];
    }
    for (; i < lines.length; i++) {
      if (lines[i].startsWith('### ')) { cur = { label: lines[i].slice(4).trim(), body: [] }; blocks.push(cur); }
      else if (cur) cur.body.push(lines[i]);
    }
    blocks.forEach(b => b.body = b.body.join('\n').trim());
    return { who, meta, blocks };
  });
}

export function parseReport(path) {
  const raw = readFileSync(path, 'utf8');
  const { fm, body } = parseFront(raw);
  const secs = parseSections(body);
  const cards = parseCards(secs['Marks']);
  return { fm, secs, cards, raw };
}

// Generic labelled-block parser: `## title` + `- key: value` lines -> [{ _title, key:value }].
// Forgiving: a malformed line is simply skipped; it never breaks the rest of the file (unlike JSON).
export function parseBlocks(text) {
  return (text || '').split(/^## /m).filter(s => s.trim()).map(p => {
    const lines = p.split('\n');
    const o = { _title: lines[0].trim() };
    for (let i = 1; i < lines.length; i++) {
      const mm = lines[i].trim().match(/^- (\w+):\s*(.*)$/);
      if (mm) o[mm[1]] = mm[2];
    }
    return o;
  });
}

// Parse the audit markdown (# Findings / # Negative Results / # Audit Trail), each a list of blocks.
export function parseAudit(path) {
  const { body } = parseFront(readFileSync(path, 'utf8'));
  const secs = parseSections(body);
  return {
    findings: parseBlocks(secs['Findings']),
    negatives: parseBlocks(secs['Negative Results']),
    audit: parseBlocks(secs['Audit Trail']),
  };
}

// T6 (H7) — THE one internal-note choke point. `::p::` marks the internal tail of a line
// (model contract: first token of its own `- ` bullet). copper-spire leaked raw tokens because each
// surface had its own partial handling: the HTML inline() cut only the FIRST occurrence, the client
// line-strip missed bold-wrapped `- **::p:: …**` bullets, and the pool report.md / email blocks never
// stripped at all. Every prose surface now routes through here.
//   client:true  → the internal tail is DROPPED (marker to end of line); a bullet that is entirely
//                  internal disappears; nothing internal survives.
//   client:false → markers are CONSUMED and each internal tail is labelled `[internal] ` once —
//                  readable on the internal surfaces, never a raw token.
// Handles: multiple occurrences (global), bold/italic-wrapped markers, mid-line markers.
export function stripInternal(s, { client = false } = {}) {
  const lines = String(s ?? '').split('\n');
  const out = [];
  for (let line of lines) {
    // normalize wrapped markers ("**::p:: x**", "*::p:: x*") so the marker is match-stable
    line = line.replace(/(\*{1,2})\s*::p::\s*([\s\S]*?)\1/g, '::p:: $2');
    if (!line.includes('::p::')) { out.push(line); continue; }
    if (client) {
      const head = line.slice(0, line.indexOf('::p::')).replace(/[\s*_]+$/, '').trim();
      // a bullet/line that was ENTIRELY internal disappears; a mixed line keeps its public head
      if (head && !/^[-*]$/.test(head)) out.push(head);
    } else {
      out.push(line.replace(/::p::\s*/g, '[internal] '));
    }
  }
  return out.join('\n');
}

// Strip markdown to plain text (for spreadsheet cells) — internal tails keep their label via stripInternal.
export function plain(s) {
  return stripInternal(String(s || ''), { client: false })
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

// The LABELLED internal form. By the time report.md is on disk it has ALREADY been through
// stripInternal({client:false}) (publish/index.mjs writes it through that choke point), so the raw `::p::`
// marker is gone and each internal tail wears a `[internal] ` label instead. A client surface reading that
// FILE therefore sees no marker at all — running stripInternal({client:true}) over it is a no-op and the
// internal reasoning survives wearing its label. That is the exact shape of the R1 leak. Same
// semantics as stripInternal's client branch: a public head survives, a wholly-internal bullet disappears.
export function dropLabelledInternals(s) {
  const out = [];
  for (const line of String(s ?? '').split('\n')) {
    const i = line.search(/\[internal\]/i);
    if (i < 0) { out.push(line); continue; }
    const head = line.slice(0, i).replace(/[\s*_]+$/, '').trim();
    if (head && !/^[-*]$/.test(head)) out.push(head);
  }
  return out.join('\n');
}

// ---- CLIENT-SAFETY transforms (shared with the MCP client surface) -------------------------------
// These two sentence-level filters live HERE, beside stripInternal, because they are the same question
// stripInternal answers — "what may a client see?" — and they now have TWO callers: publish/render.mjs
// (the client HTML export) and the MCP client surface (mcp-server/lib/scrub.mjs, via lib/driver.mjs).
// ONE definition on purpose: the leak they exist to prevent ( R1) was caused by the client-safety
// rule being implemented twice and drifting. Add a rule here and every client surface gets it.
//
// doc-55 A3 backstop — a client legal deliverable must never carry raw retrieval-ENGINE internals. Model-
// authored prose can narrate them ("MCP server did not connect", tool namespaces like courtlistener__*,
// HTTP status codes, "not wired", a named retrieval vendor). On the CLIENT only, drop any SENTENCE of
// prose carrying an UNAMBIGUOUS engine-internal token — legal sentences (which never carry one) and plain-
// English coverage caveats stay untouched; the INTERNAL surfaces keep everything. This is a deterministic
// guarantee, not a general engine-speak hunt: the token set is a small, explicit list.
// SAFETY — never delete legitimate legal prose. Tokens that could occur alone in real trademark/goods
// prose are BOUND to an engine context, so a conflict mark "MCP" or class-9 goods "wireless, not wired"
// survive: "MCP" only matches followed by a server/connection/wiring word (not "MCP Corp"), and bare
// "not wired" / a lone "429" are NOT tokens. The rest (double-underscore tool namespaces, ToolSearch,
// "still connecting", "did not connect", "never reachable", "not a transient", HTTP 4xx/5xx, the vendor
// name) never appear in real trademark prose, so they are safe standalone.
//
// METHODOLOGY VOCABULARY (added 2026-07-20). The tokens above are about retrieval INFRASTRUCTURE. These are
// about HOW THE WORK IS DONE — the reviewer lanes, the agent orchestration, the models. The distinction the
// owner drew: the OUTPUT of the methodology is client product (what we covered, what the register said, and
// the Methodology section itself, which the client report renders on purpose) — the MACHINERY that produced
// it is not. Nothing in the corpus narrates it today; this keeps it that way if a future model volunteers
// "our skeptic pass flagged…". The tool gate is what actually seals the machinery (get_telemetry, trace and
// decision_timeline are not clientSafe); this is the backstop for model-authored PROSE, which no gate sees.
//
// THE TRAP THAT SHAPES THIS LIST: model names are ordinary words and plausible MARKS. A clearance report
// can legitimately be about SONNET, HAIKU, OPUS or CLAUDE — those are real brand names in the classes we
// search, and a bare token would delete the sentence describing the client's own conflict. So every model
// name is BOUND to a vendor prefix or a version number, exactly the way "MCP" is bound above: "claude-4",
// "anthropic/…", "gpt-5", "Opus 4" match; "SONNET, US Reg 123" and "the HAIKU mark" survive untouched.
const METHODOLOGY_INTERNAL_RE = /senior[- ]eye|\bskeptic\w*\s+(?:pass|review|flag\w*|lane|check|agent|reviewer)\b|\b(?:the|our|a)\s+skeptic\b|refutation\s+(?:pass|review\w*|lane)|sub-?agent|orchestrat\w+|\bfan-?out\b|\bLLM\b|token budget|context window|prompt\s+(?:chain|template|engineering)|\banthropic\/|\bclaude[-\s]?\d|\bgpt-\d|\bdeepseek\b|\b(?:opus|sonnet|haiku)\s*\d/i;

export const ENGINE_INTERNAL_RE = new RegExp(
  /\bmcp\s+(?:server|serve|bridge|endpoint|tool|connect\w*|wir\w*|status|unavailable|down|(?:is |was |did )?not)\b|\w+__|\btoolsearch\b|\bstill connecting\b|\bdid not connect\b|\bnever reachable\b|\bnot a transient\b|\bhttp\s*[45]\d\d\b|legal ?data ?hunter|\bcourtlistener\b|\bdedicated adapter\b/.source
  + "|" + METHODOLOGY_INTERNAL_RE.source, "i");
// Filtering is per SENTENCE, and a sentence is only whole once soft-wrapped lines are rejoined.
//
// The old implementation split each LINE into sentences. Model prose wraps mid-sentence, so a
// sentence carrying an internal token was cut in two: the half holding the token was dropped and the
// other half survived — leaking the internal fact AND leaving a stump. On the delivered ION client
// report that produced "…was located before the Legal Data Hunter daily quota was exhausted;
// CourtListener itself was unavailable this session (server not" followed by "the dedicated
// adapter." — both the leak this filter exists to prevent and a garbled legal sentence.
//
// Units, not raw lines: a heading / list item / quote / table row starts a new unit and following
// unprefixed lines continue it, so list structure survives. Fenced code is passed through untouched.
// A unit with nothing to remove is re-emitted VERBATIM (byte-identical output for all clean content,
// which keeps the render freeze honest); only a unit that actually loses a sentence is rejoined.
export function stripEngineInternals(md) {
  const STRUCT = /^\s*(?:#{1,6}\s|[-*+]\s|\d+[.)]\s|>\s?|\|)/;
  const FENCE = /^\s*(?:```|~~~)/;
  const out = [];
  let unit = null, inFence = false;
  const flush = () => {
    if (!unit) return;
    const joined = unit.map((l, i) => (i ? l.trim() : l)).join(' ');
    const sentences = joined.split(/(?<=[.;])\s+/);
    const kept = sentences.filter((s) => !ENGINE_INTERNAL_RE.test(s));
    if (kept.length === sentences.length) out.push(...unit);   // nothing removed → untouched
    else out.push(kept.join(' '));                             // '' when the whole unit goes
    unit = null;
  };
  for (const line of String(md ?? '').split('\n')) {
    if (FENCE.test(line)) { flush(); inFence = !inFence; out.push(line); continue; }
    if (inFence || !line.trim()) { if (!inFence) flush(); out.push(line); continue; }
    if (STRUCT.test(line)) { flush(); unit = [line]; continue; }
    if (unit) unit.push(line); else unit = [line];
  }
  flush();
  return out.join('\n');
}

// doc-52 CHANGE-1 — process telemetry (search/fetch/batch counts, saturation baseline, cell-matrix,
// has_more) is exhaust, not legal product: it never renders to a client. A genuine plain-English scope
// note (jurisdictions/layers searched) DOES. Drops the telemetry clauses, keeps the descriptive prose;
// an all-telemetry note reduces to ''.
export const TELEMETRY_RE = /saturation|cell-matrix|has_more|record fetch|\bfetches\b|\bbatches\b|\d+\s+searches\b|storefront(s)? searched|remainder clean/i;
export function stripTelemetry(md) {
  return String(md ?? '').split('\n')
    .map((line) => line.split(/(?<=[.;])\s+/).map((s) => s.trim()).filter((s) => s && !TELEMETRY_RE.test(s)).join(' '))
    .join('\n');
}

// ── #831 — THE CLIENT CUT OF THE AUDIT BLOCK'S CROSS-REFERENCE LINES ────────────────────────────────
//
// `disposition` is a PLACEMENT key. stages.mjs dictates it as the posture that sets only WHERE a card is
// placed and never the band; findings-model's DISPOSITION_GROUP maps it to the section heading the report
// already prints. #762 D5 took it off the report's risk chip and #833 added the `disposition` KEY to
// scrubCards' strip list — and the word still reached client principals, because audit-from-spine.mjs
// re-encodes it into two OTHER keys that survive an allowlist keyed on names:
//
//   - resolution: adversarial / MEDIUM — see finding #3
//   - contradiction_resolution: findings.json (finding #3, adversarial) supports "…"
//
// THAT IS THE SEAM, and it is why this lives here rather than in mcp-server/lib/scrub.mjs: a reader of a
// per-key allowlist cannot see that a builder three files away composes a stripped field into a surviving
// one. scrub.mjs's own header forbids restating client-safety rules locally — it COMPOSES the driver's
// transforms — so the rule is written once, beside stripTelemetry and stripEngineInternals, and both the
// packaged MCP and any future consumer get it from one definition.
//
// WHY NOT RE-WORD THE BUILDER. The audit workbook and the internal surfaces keep the engine's vocabulary
// by ruling (#831 "Out of scope"), and `resolution` is the audit trail's own record of which finding a
// claim resolved to. Changing what buildAuditMd stamps would take the word off an internal surface that is
// entitled to it. The boundary is where the audience changes, so the boundary is where the cut belongs —
// the same shape as scrubCards' `rated_under` → ratedUnderForClient, which is the precedent in that file.
//
// WHY NOT STRIP THE KEYS. Both carry a client-meaningful cross-reference — which finding this block
// resolved to, and which fragment of a contradicted pair the record supports. Deleting the key deletes the
// pointer along with the word.
//
// THIS IS NOT THE SUBSTITUTION #669 FORBIDS. Nothing here reads arbitrary client prose for a vocabulary.
// Each rule is ANCHORED to one position in a grammar THIS ENGINE writes: the disposition token at the head
// of `resolution`, and the disposition token inside the `(finding #N, …)` parenthetical the contradiction
// line builds. A mark named ADVERSARIAL survives both — it is not at position 0 of a resolution line, and
// it is not inside a finding-reference parenthetical. That is the #656 lesson applied: match a POSITION in
// a grammar we own, never a word anywhere in a string we do not.
//
// The enum is IMPORTED (top of file), never retyped: a sixth disposition added to findings-model must not
// quietly walk past a copy of the list that lives here.
const DISPOSITION_ALT = DISPOSITIONS.map((d) => d.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')).join('|');
// `<disposition>` then EITHER the band separator (` / `) or the pointer separator (` — `), at position 0.
const RESOLUTION_LEAD_RE = new RegExp(`^(?:${DISPOSITION_ALT})(?:\\s*\\/\\s*|\\s+—\\s+|\\s*$)`, 'i');
// `(finding #12, adversarial)` → `(finding #12)`. The ordinal is what a reader navigates by; the posture
// is the heading they are already reading under.
const CONTRADICTION_DISPOSITION_RE = new RegExp(`(\\(finding #\\d+),\\s*(?:${DISPOSITION_ALT})\\)`, 'gi');

/**
 * The client view of one audit-block `resolution` value. Drops a LEADING placement word and its
 * separator; everything else — the band, the em-dash, the finding pointer — is untouched.
 * A value that does not open with a disposition is returned byte-identical.
 */
export function resolutionForClient(v) {
  if (v == null) return v;
  const s = String(v);
  const cut = s.replace(RESOLUTION_LEAD_RE, '').trim();
  return cut || s;   // a value that is ONLY the placement word keeps its bytes rather than becoming ''
}

/**
 * The client view of one audit-block `contradiction_resolution` value: the same posture word, removed
 * from inside the finding reference it annotates. Which fragment the record supports is unchanged — that
 * is the sentence's point, and it is the client's answer, not the engine's spelling of it.
 */
export function contradictionResolutionForClient(v) {
  if (v == null) return v;
  return String(v).replace(CONTRADICTION_DISPOSITION_RE, '$1)');
}

// ── #669 — ENGINE_PLAIN AND plainify ARE DELETED ────────────────────────────────────────────────────
//
// doc-52 put nineteen find-and-replace rules on the rendered client surface. #656 is what that cost:
// `axis` -> `group` turned "AXIS Bank filed in class 36" into "group Bank filed in class 36" — a report
// naming a mark that does not exist, inside the report that clears it. AXIS and SLICE are both live
// trademarks. The ban list and the trademark register overlap, and this engine exists to search the
// trademark register, so there is no ban list that is safe to run over a client-facing string.
//
// Case-sensitivity was not a fix, it was a trade: it bought safety on an uppercase mark and gave up the
// guarantee in the other direction (a sentence-initial "Axis coverage was limited" leaked, and a mark
// filed in lowercase was still eaten).
//
// WHAT REPLACED EACH HALF, at its source:
//   · the row's `area` is DRIVER-derived — coverage-ledger.coverageUnitLabel emits `areaLabel` beside
//     the identifier, rewriting one structural position in a grammar the driver itself minted. The page
//     prints the label; every gate still joins on `area`.
//   · the row's `reason` is the SEAT's prose — verify.coverageFormFail REFUSES the engine tokens where
//     the seat writes them, and coverage-form.mjs teaches the rule in the same commit. A refusal names
//     the problem to the thing that can fix it; a substitution hides it.
//
// THE ELEVEN LEGACY doc-52 RULES WENT WITH THEM, and this is the measurement rather than an assumption:
// across the twelve delivered runs in the test pool, every one of `crossed into the band`,
// `null class/owner/status`, `enumerated-empty`, `unadjudicable`, `dominant-element omission`,
// `reopen pass`, `in-scope subset`, `unchanged-after-resume` and the two `… exact slice` compounds
// appears ZERO times in the SOURCE artifacts (report.md, findings.json). This block's own comment said
// the synthesis contract had stopped emitting them and that it was belt-and-braces for archived data;
// the pool says the contract holds. What is lost is the fixup on an archived re-render, and nothing
// that a run produces today.

// The SESSION-WIDE preamble of case-law-findings.md (everything before the first 'Grounded profile'
// heading, minus the document's own title line): per-finding strands say 'Coverage gaps: as § Session-
// wide notice above' — the notice carries material source-outage info (e.g. CourtListener/EUR-Lex down)
// and must render ONCE on the page those refs point at. Returns '' when there is no substantive preamble.
export function parseCaseLawPreamble(mdText) {
  const t = String(mdText ?? '');
  const idx = t.search(/^#{2,3}\s+Grounded profile\s+—\s+/m);
  let pre = (idx < 0 ? t : t.slice(0, idx)).trim();
  pre = pre.replace(/^#\s+[^\n]*\n?/, '').trim();          // drop the doc title line
  pre = pre.replace(/^#{2,4}\s+Session-wide notice\s*\n?/im, '').trim();  // the renderer supplies the heading
  return pre;
}

// spec-49 T7 (E5) — parse the case-law stage's grounded profiles (case-law-findings.md) into joinable
// records. Tolerates ##/### heads and the "vs." / "vs" forms; the optional "- ord: <N>" first body
// line (dictated to fresh runs) gives an EXACT join; mark/owner fall back for archived files. The
// honest "No on-point precedent found" state is preserved — an explicit negative is a result, not a gap.
export function parseCaseLawProfiles(mdText) {
  const parts = String(mdText ?? '').split(/^#{2,3}\s+Grounded profile\s+—\s+/m).slice(1);
  return parts.map((p) => {
    const nl = p.indexOf('\n');
    const head = (nl < 0 ? p : p.slice(0, nl)).trim();
    let body = (nl < 0 ? '' : p.slice(nl + 1)).trim();
    // Cut the body at the next NON-profile ##/### heading: the split above only removes 'Grounded
    // profile' heads, so a trailing session-level section (e.g. '## Recommended follow-on actions'
    // + its pipe-table) stayed glued to the LAST profile and rendered raw into its finding card.
    body = body.split(/\n#{2,3}\s+[^\n]*/)[0].trim();
    const ord = Number((body.match(/^-\s*ord:\s*(\d+)\s*$/m) || [])[1]) || null;
    body = body.replace(/^-\s*ord:\s*\d+\s*$/m, '').trim();
    const m = head.match(/\bvs\.?\s+(.+?)(?:\s*\/\s*([^/()]+?))?\s*(?:\(([^)]*)\))?\s*$/i);
    return {
      ord,
      mark: (m?.[1] ?? head).trim(),
      owner: m?.[2]?.trim() || null,
      jurisdiction: m?.[3]?.trim() || null,
      none: /no on-point precedent found/i.test(body),
      // doc-55 A3 — was case-law SOURCE coverage limited this run (a source unavailable / not searched /
      // not wired / quota / connection failure)? Derived deterministically here so the client's code-owned
      // case-law line is honest — "no precedent, coverage limited" vs a genuinely exhaustive "no precedent"
      // — without the render layer ever touching the raw operational prose.
      coverageLimited: /\bcoverage gaps?\b|\bnot (?:searched|wired|reachable|connected|available)\b|\bunavailable\b|\bquota\b|\bstill connecting\b|\bmcp\s+(?:server|not|connect|wir|bridge|endpoint|tool|status|unavailable)\b|\bhttp\s*[45]\d\d\b/i.test(body),
      body,
    };
  });
}

// Join parsed profiles to findings: exact ordinal first, then normalized mark+owner containment.
export function joinCaseLawProfiles(profiles, findings) {
  const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const byOrdinal = new Map();
  const unclaimed = [...(profiles ?? [])];
  for (const f of (findings ?? [])) {
    let ix = unclaimed.findIndex((p) => p.ord != null && p.ord === f.ordinal);
    if (ix < 0) ix = unclaimed.findIndex((p) => {
      const pm = norm(p.mark), fm2 = norm(f.mark), po = norm(p.owner), fo = norm(f.owner?.name);
      const markHit = pm && fm2 && (pm.includes(fm2) || fm2.includes(pm));
      const ownerHit = po && fo && (po.includes(fo) || fo.includes(po));
      return markHit || ownerHit;
    });
    if (ix >= 0) byOrdinal.set(f.ordinal, unclaimed.splice(ix, 1)[0]);
  }
  return byOrdinal;
}
