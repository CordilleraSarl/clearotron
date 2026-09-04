// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// recording-agreement.mjs — DO A RECORDING STAGE'S ORDERS AND ITS GRANT AGREE, IN BOTH DIRECTIONS.
//
// E12 (contract-dictation) answers one half of this question and cannot answer the other two. It maps a
// doctrine FILE to the stages that read it through `STAGES.skillReads`, so its population is
// `driver/skills/**` — measured on 1d3cef1d, `doctrineReaders()` returns 18 files and neither
// `driver/stages.mjs` nor `driver/gateway.mjs` is among them. Every order those two compose is therefore
// invisible to it, and they are where a converted stage's orders actually live: the dispatch is the
// attempt-1 prose, and `warmPatchMessage` is what the seat reads on every repair rung after that.
//
// ── WHY A CONVERTED STAGE NEEDS ITS OWN GUARD ────────────────────────────────────────────────────────
//
// A conversion moves an artifact from "the seat writes it" to "the driver writes it, from a typed call".
// That is three separate agreements between the grant and the served text, and each one fails silently in
// its own way:
//
//   (a) GRANTED BUT NEVER ORDERED.  A tool in the grant that no order names is a capability the seat does
//       not know it has. It does not fail — the seat reaches for the thing it was told about, gets a
//       refusal it cannot interpret, and degrades. This direction has never been checked anywhere, and it
//       is the direction the conversions keep moving in: `search_run_artifacts` was granted to skeptic as
//       the sanctioned replacement for its measured Bash reads ( unlock path 1) and named in no
//       served text at all.
//   (b) ORDERED BY HAND, OWNED BY A TOOL.  A surviving hand-write order for an artifact a typed tool now
//       owns. Measured consequence, not a hypothesis: on 2e203b75 a blind-frame seat obeyed the prose and
//       hand-wrote a 17182B model with no call capture beside it, on a box whose grant already carried
//       the tool. The dictation deletes are; this direction is what keeps them deleted.
//   (c) ORDERED BUT NOT GRANTED.  's seed direction. E12 owns it for skill docs; here it reaches the
//       dispatch and the repair ladder too.
//
// ── PURE, AND THAT IS WHAT MAKES THE PLANTS CHEAP ────────────────────────────────────────────────────
//
// Same split as contract-dictation.mjs / contract-dictation-scan.mjs, for the same reason: a checker that
// reads the tree itself can only be tested by writing a file into the tree. This module takes a union and
// computes. Its six negative controls — two stages by three directions — are five-line unit tests handing
// it an invented union, so every green above is known to be a detection rather than a walk over an empty
// set.

/**
 * What a union member IS to the seat, and why the distinction is load-bearing rather than tidy.
 *
 * INSTRUCTION — text that ORDERS. The dispatch, the skill docs it is told to read and follow exactly, the
 *   repair and resume prose. Direction (a) is asked of these ALONE.
 * SURFACE     — text the seat SEES without being ordered by it: the mounted tool's schema and description,
 *   and the answer a tool hands back.
 *
 * DIRECTION (a) MUST NOT READ THE SURFACES, and this is the whole reason the kinds exist. A granted tool
 * is always in the mounted tool list — that is what granting it means — so a direction-(a) check that
 * counted the schema as "named" would pass for every tool in every grant, forever, by construction. It
 * would be the vacuous-guard shape this repo has now shipped three times. Directions (b) and (c) read
 * every member: a refusal string ordering a hand-write, or a schema description naming a sibling tool the
 * seat cannot call, is a real order in the place a seat is most obedient.
 */
export const INSTRUCTION = "instruction";
export const SURFACE = "surface";

/**
 * WHEN an instruction is read, which is a different axis from WHAT it is — and direction (a) is the only
 * one that cares.
 *
 * ATTEMPT_1 — the dispatch and the skill docs it is told to read. What the seat has in front of it the
 *   first time it acts, before anything has gone wrong.
 * REPAIR    — the warm patch, the cold corrective, the resume prose. Read only AFTER a failure.
 *
 *. Direction (a) asks whether the seat was TOLD a capability exists, and a repair rung cannot tell
 * it: a seat that reached for `Write` on attempt 1 has already taken the deleted path, and the repair that
 * would have named the tool is downstream of the failure it was supposed to prevent.
 *
 * The defect was worse than a gap, because the thing that satisfied (a) was a step every conversion
 * performs anyway. Since the warm and cold rungs DERIVE the tool name from `TOOL_WRITTEN_ARTIFACTS`,
 * so adding that row — step 1 of every conversion — makes both rungs name the record tool, and (a) went
 * quiet for it whatever the dispatch said. Measured on conversion 3 before its dispatch was touched: the
 * grant carried `record_prelim_variants`, the dispatch did not mention it, both repair rungs did, and (a)
 * was silent. The guard asked a question the conversion's own bookkeeping answered — the tautology shape
 * `b04d6d58` and the `RECORDING_TOOLS` non-derivation both exist to remove.
 *
 * Directions (b) and (c) keep reading every member regardless of phase: an order to hand-write is a real
 * order wherever it appears, and a repair rung is exactly where a seat is most obedient.
 */
export const ATTEMPT_1 = "attempt-1";
export const REPAIR = "repair";
const PHASES = Object.freeze([ATTEMPT_1, REPAIR]);

/**
 * The write-order markers, as IDENTIFIERS rather than sentences.
 *
 * Every one of these is a token with a consumer on the other end, which is what makes it survive a
 * rephrasing: `ABSOLUTE path` is re-parsed by the harness mock (`/ABSOLUTE path[^:]*:\s*(\/\S+)/`,
 * mock-stage-fixtures.mjs applyStageWrites) and `writeReturn` says in its own comment that it must keep
 * the literal phrasing for that reason; `the Write tool` and `the Edit tool` name claude's built-in tools,
 * which is the level `--allowedTools` is enforced at.
 *
 * DELIBERATELY AN INDEPENDENT EXPECTATION, not an import from `stages.mjs`/`repair-contract.mjs`. Same
 * rule as RECORDING_TOOLS and the census's RECORDING_GRANTS, and for the same reason: a pattern derived
 * from the composer it is meant to detect compares a value with itself. The anti-rot arm is a test, not an
 * import — `recording-agreement.test.mjs` drives live `writeReturn()` and both repair tails through these
 * patterns and fails if any stops matching, so the independence cannot decay into staleness.
 */
/**
 * A PROVIDER-CONDITIONAL CARVE-OUT —. Same shape as WRITE_ORDER_MARKERS below and for
 * the same reason: the corpus declares its intent in prose, so the guard matches declared phrasings and an
 * anti-rot arm keeps them matching rather than trusting them to.
 *
 * WHAT THIS IS FOR. Direction (c) reads "the dispatch names a tool the grant lacks" as a disagreement.
 * That is right when the engine forgot and wrong when the active provider simply cannot serve it AND the
 * dispatch says so in the same breath — which is a correct configuration three layers already agree on.
 * On a clarivate deployment it made register-unit red with a message asserting a BEHAVIOURAL defect,
 * sending the reader hunting in a lane where nothing was wrong.
 *
 * ✕ IT DOES NOT EXCUSE THE TOOL, IT EXCUSES THE ORDER — and the difference is two real defects.
 * Measured on a signa deployment, which withholds THREE register tools: one mention carries the carve-out
 * and two do not. `unit.md:59` tells the seat "your register key also carries register_image_fetch and
 * register_batch_screen" — false on signa, and exactly what direction (c) exists to catch. A rule that
 * excused provider-unavailable TOOLS would have cleared the false alarm and silenced both true ones in
 * the same edit.
 */
export const PROVIDER_CONDITIONAL_MARKERS = Object.freeze([
  { id: "not-offered-by-every-provider", re: /not offered by every provider/i },
  { id: "provider-doc-says-unavailable", re: /where the active provider'?s doc says/i },
  { id: "does-not-exist-on-this-provider", re: /DOES NOT EXIST on this provider/i },
  { id: "deferred-on-this-provider", re: /deferred on this provider/i },
]);

/** The block a mention sits in — paragraphs and list items, split on blank lines. A carve-out three
 *  sections away is not a carve-out for this order, and a whole-document match would excuse anything. */
export function blockAround(text, needle) {
  const blocks = String(text ?? "").split(/\n\s*\n/);
  return blocks.find((b) => b.includes(needle)) ?? null;
}

export const WRITE_ORDER_MARKERS = Object.freeze([
  { id: "writeReturn:absolute-path", re: /ABSOLUTE path/ },
  { id: "writeReturn:you-owe", re: /YOU OWE \d+ FILES/ },
  { id: "repair-tail:write-tool", re: /with the Write tool/ },
  { id: "repair-tail:edit-tool", re: /using the Edit tool/ },
  { id: "corrective:max-tokens-write-tool", re: /CALL THE WRITE TOOL/ },
  // ADDED BY THE THIRD CONVERSION, and the way it was found is the argument for the anti-rot arm below.
  // `warmPatchMessage`'s sibling branch orders "Re-save the COMPLETE corrected JSON at <path>" — a
  // hand-write with no Write/Edit token and no `ABSOLUTE path` in it, so the four markers above were all
  // blind to it. On frame-diff the sibling IS the tool-written artifact, so that branch was ordering a
  // hand-write of a driver-owned file on every `framediff_*` token, and direction (b) reported clean.
  // A marker list is only as good as the composers it has met; this is the fifth composer it has met.
  { id: "warm-sibling:re-save-complete", re: /Re-save the COMPLETE/ },
]);

// THE RESIDUAL GAP, STATED RATHER THAN LEFT FOR SOMEBODY TO DISCOVER. This list is the composers as they
// phrase themselves today, so a REPHRASING is caught (the anti-rot arm drives every live composer through
// these patterns and reddens when one stops matching) and a BRAND-NEW composer's own wording is not. What
// stops that being a hole is where the union comes from: it is built by CALLING `warmPatchMessage` and
// `correctiveMessage`, not by listing their branches, so a new branch inside either one is in the union on
// the commit that adds it — only its marker would be missing. A new composer wired somewhere else entirely
// is the case this cannot see, and it is the same shape names: the answer is that the union is
// discovered from the real dispatch path, never enumerated.

/** A tool identifier is named when it appears as a word — `record_skeptic`, mcp-namespaced or bare. */
const namesTool = (text, tool) => new RegExp(`(?<![A-Za-z0-9_])${tool}(?![A-Za-z0-9_])`).test(text);

/** The bare tool names in a resolved grant string or array: `mcp__k__t` → `t`, built-ins kept as-is. */
export function bareGrant(granted) {
  const list = Array.isArray(granted) ? granted : String(granted ?? "").split(/\s+/);
  const out = new Set();
  for (const t of list) {
    if (!t) continue;
    const m = String(t).match(/^mcp__[a-z0-9-]+__([a-z0-9_]+)$/);
    out.add(m ? m[1] : String(t));
  }
  return out;
}

/**
 * The three agreements, for ONE stage.
 *
 * @param {object} a
 * @param {string} a.stage
 * @param {Set<string>|string[]} a.granted   bare tool names the seat holds (see bareGrant)
 * @param {string[]|Set<string>} a.artifacts  every basename the typed tool now owns. USUALLY one, and it
 *   was exactly one for the two stages this guard shipped with — frame-diff is the first conversion whose
 *   single call writes two files (`frame-diff.json`, plus `frame-diff.md` rendered from the same parsed
 *   model), and it is what showed the singular was a generalisation from n=2 rather than a property. Both
 *   its basenames reach a repair: the stage's `out` is the prose, so a stage-shaped repair names the
 *   prose, while every `framediff_*` token names the JSON. A direction (b) that checked one of them would
 *   be silent on whichever repair path it did not happen to hold.
 * @param {Array<{surface:string, kind:string, text:string}>} a.union
 * @param {string[]} a.toolUniverse          every tool name that exists anywhere, for direction (c)
 * @param {Array<{stage:string, tool:string}>} [a.backlog]  's named, excused members — ONE list, read
 *   from contract-dictation-registry.mjs. A second excuse list here would be authoring number eight, which
 *   is the failure that registry's own header exists to forbid.
 * @param {Set<string>} [a.providerConditionalSurfaces]  surfaces that are provider-conditional BY
 *   CONSTRUCTION — the active provider's own deck, which the dispatch selects by provider name. Derived
 *   from the provider, never a list of documents anyone maintains. See the carve-out in direction (c).
 * @returns {Array<{direction:string, stage:string, tool:string|null, surface:string|null, why:string}>}
 */
export function agreementFindings({ stage, granted, artifacts, union, toolUniverse, backlog = [], providerUnavailable = new Set(), providerConditionalSurfaces = new Set() }) {
  const held = granted instanceof Set ? granted : bareGrant(granted);
  const owned = [...(artifacts instanceof Set ? artifacts : (artifacts ?? []))];
  const out = [];
  const instructions = union.filter((m) => m.kind === INSTRUCTION);

  // AN UNPHASED INSTRUCTION IS REFUSED, NOT DEFAULTED. Either default picks a side silently: assume
  // ATTEMPT_1 and a repair rung re-acquires the power to satisfy (a), which is the defect; assume REPAIR
  // and a real dispatch stops counting, which makes (a) vacuous in the other direction. A union member
  // that does not say when it is read is a caller bug, and it throws rather than joining the findings —
  // findings are claims about the ENGINE, and this is a claim about the harness that called this.
  for (const m of instructions) {
    if (!PHASES.includes(m.phase)) {
      throw new Error(`recording-agreement: instruction member "${m.surface}" carries phase `
        + `${JSON.stringify(m.phase)} — every INSTRUCTION member must declare ${ATTEMPT_1} or ${REPAIR}, `
        + "because direction (a) counts only what the seat reads on attempt 1 (#1190)");
    }
  }
  const attempt1 = instructions.filter((m) => m.phase === ATTEMPT_1);

  // ── (a) every granted tool is ORDERED somewhere the seat reads ──────────────────────────────────────
  //
  // Scoped to the tools this category ADDS. `Read` is seeded unconditionally by `allowedToolsFor` for
  // stage I/O and is not a capability anyone dictates; requiring the word "Read" in the prose would be a
  // vocabulary test, which is the phrasing-chasing rejects.
  // ✕ A BRIDGE WILDCARD IS EXCLUDED, AND THE EXCLUSION IS DELIBERATE RATHER THAN A CONVENIENCE.
  //
  // `bareGrant` strips the namespace off `mcp__server__tool` and leaves `mcp__server__*` whole, because a
  // wildcard has no tool name to strip. Asking direction (a) whether the prose "names" the literal string
  // `mcp__courtlistener__*` is a question with one possible answer: no dictation writes a glob, so every
  // bridge-holding stage would report two permanent findings that no edit could ever clear.
  //
  // Measured before the widening rather than after: running this over all 16 stages produced exactly that
  // — `case-law` reporting `mcp__courtlistener__*` and `mcp__legaldatahunter__*`, forever.
  //
  // `contract-dictation-registry.mjs:80` already filters wildcards out of the tool universe for the same
  // reason. This is the same rule at the other end, and it is stated rather than shared because the two
  // populations are different: that one builds a universe, this one reads a grant.
  //
  // WHAT IT COSTS, stated so nobody reads it as coverage: a bridge's INDIVIDUAL tools are not checked by
  // direction (a) at all. Nothing here can tell whether `courtlistener`'s real tool names are ordered,
  // because the grant never names them — the wildcard is the grant. That is a gap in what a grant can
  // express, not one this check introduces, and closing it means resolving the bridge's served list.
  for (const tool of [...held].filter((t) => t.includes("_") && !t.includes("*")).sort()) {
    if (attempt1.some((m) => namesTool(m.text, tool))) continue;
    out.push({
      direction: "granted-but-never-ordered", stage, tool, surface: null,
      why: `${stage} holds ${tool} and no attempt-1 instruction names it. The seat is not told the `
        + "capability exists, so it reaches for whatever the doctrine DOES name — which after a "
        + "conversion is a tool its grant no longer carries. Name it in the dispatch or in the skill doc, "
        + "or drop it from the grant. A repair rung naming it does NOT count (#1190): the seat that "
        + "needed to know had already acted by the time it read one.",
    });
  }

  // ── (b) nothing orders a hand-write of an artifact a typed tool owns ────────────────────────────────
  //
  // Keyed on the ARTIFACT, not on the grant, and the difference is the point. `TOOL_WRITTEN_ARTIFACTS`'
  // own note says a stage absent from it still gets the write-mode tails correctly, because its seat
  // still holds Write — so "the seat holds no Write" is the wrong question. The right one is whether the
  // FILE has a single writer. Once it does, an order to type it by hand is a second writer whatever the
  // grant says.
  // A FAILURE TOKEN IS A DIAGNOSIS, NOT AN ORDER. A warm patch quotes the token it
  // is repairing — `invalid_file:register-units/<axis>.md:named_band_unparseable` — and that token names
  // the stage's out file by construction, because that is what the validator graded. If the same message
  // then carries a write order for a DIFFERENT artifact (the band's JSON sibling, which the seat does own
  // on the lane that reaches this branch), the naive scan pairs the order with the file the token names
  // and reports a hand-write of an artifact nobody was told to write.
  //
  // Stripping the token span is the narrowest fix that keeps the direction honest: an artifact the message
  // names ANYWHERE ELSE — including in a sentence about the token — still counts, so an order that really
  // does aim at the out file is caught exactly as before. The control below plants one and requires it.
  const withoutTokens = (t) => String(t).replace(/\b(?:invalid_file|missing_file):[^\s)]+/g, " ");
  for (const m of union) {
    const scanned = withoutTokens(m.text);
    for (const artifact of owned) {
      if (!scanned.includes(artifact)) continue;
      for (const marker of WRITE_ORDER_MARKERS) {
        if (!marker.re.test(m.text)) continue;
        out.push({
          direction: "hand-write-ordered", stage, tool: null, surface: m.surface, artifact,
          why: `${m.surface} names ${artifact} and carries a write order (${marker.id}). That artifact's `
            + "only writer is the driver, off the typed call — a surviving hand-write order is the "
            + "superseded path the golden rule bans, and e2e has measured a seat obeying one while holding "
            + "the tool.",
        });
      }
    }
  }

  // ── (c) nothing orders a tool the grant denies ──────────────────────────────────────────────────────
  const excused = new Set(backlog.filter((b) => b.stage === stage).map((b) => b.tool));
  for (const tool of [...toolUniverse].sort()) {
    if (held.has(tool)) continue;
    if (excused.has(tool)) continue;                 // named on 's backlog; the list can only shrink
    for (const m of union) {
      if (!namesTool(m.text, tool)) continue;
      // ── — A PROVIDER CANNOT SERVE IT, AND THIS ORDER SAYS SO ──────────────────
      //
      // Only for a tool the ACTIVE provider deliberately does not serve, and only when THIS order's own
      // block carries the carve-out. Both halves matter: the first keeps the rule off tools the engine
      // merely forgot, and the second keeps it off the orders that assert a capability instead of
      // conditioning on one. On signa that is the difference between one false alarm cleared and two
      // true findings kept.
      if (providerUnavailable.has(tool)) {
        // (i) THE SURFACE IS PROVIDER-CONDITIONAL BY CONSTRUCTION —.
        //
        // The active provider's own deck is chosen BY the provider, so everything in it is already
        // conditioned on the provider being this one. It cannot assert a capability of a deployment it
        // does not describe, which is the property the phrase test below tries to establish by reading
        // prose.
        //
        // WHY THE PHRASE TEST IS NOT ENOUGH, measured rather than argued. Two providers withhold the
        // IDENTICAL tool and hold the IDENTICAL grant, and scored opposite:
        //   one deck  "`register_expand_phoneme` DOES NOT EXIST on this provider"  → matched, excused
        //   the other "**`register_expand_phoneme` is ABSENT**, and so is phonetic search itself"
        //                                                                          → matched nothing
        // Both sentences are true and both are the right thing to write for a human. A discriminator
        // that reads WORDING makes a deck author guess a vocabulary, and it had already drifted across
        // two decks written by the same team. Provenance cannot drift: the file is selected by name.
        //
        // ✕ THIS STILL DOES NOT EXCUSE THE TOOL, only the surface. A mention in provider-INDEPENDENT
        // doctrine asserts a capability every deployment is told it has, and stays a finding — the
        // distinction ruled, and the reason the doctrine-side rows must survive it.
        if (providerConditionalSurfaces.has(m.surface)) continue;
        // (ii) or THIS order's own block says so in words.
        const block = blockAround(m.text, tool);
        if (block && PROVIDER_CONDITIONAL_MARKERS.some((k) => k.re.test(block))) continue;
      }
      out.push({
        direction: "ordered-but-not-granted", stage, tool, surface: m.surface,
        why: `${m.surface} names ${tool} and ${stage}'s grant does not carry it. The call is impossible, `
          + "and the shortfall reads as a model that chose not to. Grant it, drop the order, or scope the "
          + "sentence to the seat that holds it — and if it is a known member, its row on #865's backlog "
          + "is what excuses it here.",
      });
    }
  }

  return out;
}

/**
 * Which backlog rows this guard REPRODUCES — the ratchet arm.
 *
 * An excuse nobody re-derives is an excuse that outlives its defect. `contract-dictation.test.mjs` already
 * asserts every backlog row still reproduces through E12; this is the same assertion for the surfaces E12
 * cannot see, and it is what stops direction (c) going green because its union stopped reaching the file.
 */
export function reproducedBacklog({ stage, granted, union, backlog }) {
  const held = granted instanceof Set ? granted : bareGrant(granted);
  return backlog
    .filter((b) => b.stage === stage && !held.has(b.tool))
    .filter((b) => union.some((m) => namesTool(m.text, b.tool)))
    .map((b) => ({ stage: b.stage, tool: b.tool }));
}
