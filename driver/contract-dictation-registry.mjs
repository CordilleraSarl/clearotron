// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// contract-dictation-registry.mjs — THE contracts E12 enforces, and where each one's single
// authoritative statement lives.
//
// Separate from contract-dictation.mjs because this file is the only one that needs to reach into
// STAGES and the grant table, and the checker itself must stay pure enough to be handed an invented
// corpus in a unit test. Both files are out of the scanned corpus, by a NAMED rule with its reason in
// words (SCOPE_RULES) — they state the retired text in order to ban it, and a check that fires on its
// own statement of a contract cannot be kept green honestly.
//
// ── WHY THE AUTHORITY IS ALWAYS COMPUTED, NEVER PASTED ───────────────────────────────────────────────
//
// Every `authority` below is a call, not a string.: "no hand-maintained pair list — the check
// reads the real served doctrine and the real authoritative statements, or it rots exactly the way the
// instances did." A registry that pasted the authoritative sentence would be authoring number eight.

import { STAGES, resolveSkillReads } from "./stages.mjs";
import { toolGroupsForStage, allowedToolsFor, TOOL_FREE_STAGES, REGISTER_SERVERS } from "./engine/mcp/gather-config.mjs";
import { fieldContract, toolOrderContract, soleAuthorContract } from "./contract-dictation.mjs";

// ── which stages are served which doctrine file ──────────────────────────────────────────────────────
//
// Read out of STAGES, never listed here. `skillReadsFor` stages resolve through the same helper the
// dispatch uses, with an empty context: they vary by matter profile, and the UNION over a bare context
// is the part every matter gets. A stage whose doctrine depends on the matter still contributes its
// base files, which is where every dictated contract in this family lives.
export function doctrineReaders() {
  const map = new Map();
  for (const [stage, def] of Object.entries(STAGES)) {
    let reads = [];
    try { reads = resolveSkillReads(stage, {}) ?? []; } catch { reads = def?.skillReads ?? []; }
    for (const rel of reads) {
      const file = `driver/${rel}`;
      if (!map.has(file)) map.set(file, []);
      if (!map.get(file).includes(stage)) map.get(file).push(stage);
    }
  }
  return map;
}

// ── reading the grant table without an environment ───────────────────────────────────────────────────
//
// `register` is the one DYNAMIC group: gather-config resolves it through registerEntry(), which calls
// requireRegisterProvider() and THROWS when CLEAROTRON_DATABASE is unset — deliberately, since
// removed a default that named a vendor this deployment did not choose. CI has no deploy
// environment, so this check cannot go through that door and must not open a second one.
//
// It reads REGISTER_SERVERS directly instead, and combines the providers in two OPPOSITE directions:
//
//   the tool UNIVERSE is the UNION        — the widest set of names a doctrine file could order
//   what a stage HOLDS is the INTERSECTION — granted under EVERY provider, or it is not granted
//
// Intersection is the fail-closed leg, and the table shows why it is not theoretical: corsearch grants
// eight register tools, clarivate and euipo seven, signa two. A doctrine line ordering
// `register_expand_phoneme` is correct on one deploy and an ungranted order on three others.
//
// SETTING process.env AND RE-ASKING DOES NOT WORK, and the first version of this file did exactly that
// — silently. `REGISTER_PROVIDER` is captured at module load, so every provider answered "not set", the
// throw was caught, and the tool universe came back EMPTY: the whole tool-order contract inert while
// reporting a clean pass. Caught by the live-authority test below, which is why that test asserts a
// name it knows must be there rather than asserting the set is non-empty.
const bareTools = (allowed) => {
  const out = new Set();
  for (const t of String(allowed).split(/\s+/)) {
    if (!t) continue;
    const m = t.match(/^mcp__[a-z0-9-]+__([a-z0-9_]+)$/);
    out.add(m ? m[1] : t);
  }
  return out;
};

const registerToolSets = () => Object.values(REGISTER_SERVERS).map((e) => new Set(e.tools ?? []));

/** Every MCP tool name the pipeline can grant, under any provider. The UNION. */
export function knownToolNames() {
  const all = new Set();
  for (const stage of Object.keys(STAGES)) {
    const groups = toolGroupsForStage(stage).filter((g) => g !== "register");
    for (const t of bareTools(allowedToolsFor(groups))) if (t.includes("_") && !t.includes("*")) all.add(t);
  }
  for (const s of registerToolSets()) for (const t of s) all.add(t);
  return [...all].sort();
}

/**
 * What a stage holds, as bare tool names. The authority, read live.
 *
 * THE REGISTER GROUP IS UNIONED, NOT INTERSECTED, and that is a correction made against measurement.
 * The intersection is fail-closed on the PROVIDER axis — signa exposes two register tools where
 * corsearch exposes eight — and it duly produced 19 hits saying the register doctrine orders
 * `register_enumerate`, which signa does not carry. Every one of those is true and none of them is
 *: they are findings about a vendor's capability envelope, which 's deferral contract already
 * owns and states on the coverage form. Folding them in here would bury the grant/doctrine mismatch
 * this contract exists for under a vendor-capability report nobody asked E12 for.
 */
export function grantedToolsFor(stage) {
  const groups = toolGroupsForStage(stage);
  const out = bareTools(allowedToolsFor(groups.filter((g) => g !== "register")));
  if (groups.includes("register")) for (const s of registerToolSets()) for (const t of s) out.add(t);
  return out;
}

// ── 's members: two were known, TEN are real ────────────────────────────────────────────────────
//
// E3's precedent, and 's rule under it: "a lint that greenlights every existing hole certifies the
// problem" — so the lint holds the line and the BACKLOG names what is already there, each entry saying
// which move removes it. rejects "a whitelist of the two known members as the route to green", and
// this is not that: it is the measured population, which is FIVE TIMES the two members was filed
// on, and every entry is a live divergence a reader can go and see.
//
// SIX OF THE TEN ARE ONE SUB-CLASS NOBODY HAD NAMED: SHARED DOCTRINE, DIVERGENT GRANTS. A skill file is
// served whole to several stages whose grants differ, so the same sentence is a correct instruction to
// one seat and an order for a tool the next seat does not hold. `prelim-register/SKILL.md` goes to
// register-unit and register-digest; `prelim-search/phase2-execution.md` goes to skeptic;
// `prelim-search/synthesis-rules.md` goes to synthesis AND report-overview. report-overview and
// prelim-variants are tool-free BY DESIGN, each with its reason written out in TOOL_FREE_STAGES;
// skeptic has since CONVERTED to the RECORDING category (its reason moved to RECORDING_STAGES) and
// holds exactly its own record tool — still no retrieval tool, so its entries below reproduce
// unchanged. Each of the three is currently served a document telling it to run a lookup.
//
// Resolution is per pair and is doctrine judgment: grant the tool, drop the order, or scope the
// sentence to the seat that holds it. owns that call and says so; E12's job is that the list can
// only shrink. The test asserts every entry still reproduces, so a pair fixed in fails CI here
// until its line is deleted.
export const TOOL_ORDER_BACKLOG = [
  { stage: "register-digest", tool: "register_enumerate", site: "driver/skills/prelim-register/SKILL.md",
    closes: "#865 — shared doctrine: SKILL.md is served to register-unit (holds register) and register-digest "
      + "(holds band only, since the plan freeze retired live search from the judgment seat)." },
  { stage: "register-digest", tool: "register_execute_plan", site: "driver/skills/prelim-register/SKILL.md",
    closes: "#865 — same shared file, same split grant." },
  { stage: "register-digest", tool: "register_batch_screen", site: "driver/skills/prelim-register/digest.md",
    closes: "#865 — the digest's OWN doctrine, not a shared file: this one is the stage being told to "
      + "batch-screen with a tool its grant does not carry. gather-config.mjs:196 already records that "
      + "this stage's prompt once ordered live register checks; the order outlived the note." },
  { stage: "register-unit", tool: "band_record", site: "driver/skills/prelim-register/SKILL.md",
    closes: "#865 — same shared file, same split grant." },
  { stage: "register-unit", tool: "band_shape", site: "driver/skills/prelim-register/SKILL.md",
    closes: "#865 — same shared file, same split grant." },
  { stage: "report-overview", tool: "band_record", site: "driver/skills/prelim-search/synthesis-rules.md",
    closes: "#865 — same shared file, same split grant." },
  { stage: "register-unit", tool: "band_lookup", site: "driver/skills/prelim-register/SKILL.md",
    closes: "#865 — the mirror image: the band tools are the judgment stages', and the unit lane holds "
      + "register instead." },
  { stage: "register-unit", tool: "record_coverage", site: "driver/skills/prelim-register/SKILL.md",
    closes: "#865 — same shared-spine split as the band tools above, minted by the typed coverage "
      + "transport: the spine's Coverage-ledger section (mode-scoped to DIGEST in its own words) orders "
      + "`record_coverage`, which only register-digest's grant carries — the unit lane must never hold a "
      + "writer into judgment's coverage record. Resolved the day the spine's coverage doctrine moves "
      + "wholly into digest.md, or #865 scopes shared-spine text per seat." },
  { stage: "register-unit", tool: "record_register_digest", site: "driver/skills/prelim-register/SKILL.md",
    closes: "#865 — the SAME shared-spine split as record_coverage above, minted by conversion 11's typed "
      + "findings transport. The spine's mode list names the tool inside its **Digest mode (judgment — "
      + "Layer B)** bullet, which is the sentence that already names record_coverage and the band tools; "
      + "register-unit reads the spine and is dispatched as the FUNNEL, so it is ordered a tool only the "
      + "digest grant carries. It resolves on the same condition as record_coverage's row — the day the "
      + "spine's digest doctrine moves wholly into digest.md, or #865 scopes shared-spine text per seat — "
      + "and NOT by granting it: the funnel must never hold a writer into judgment's findings document, "
      + "which is the same rule that keeps record_coverage off its grant." },
  { stage: "skeptic", tool: "perplexity_research", site: "driver/skills/prelim-search/phase2-execution.md",
    closes: "#865 — skeptic holds NO retrieval tool ('new search work enters via the escalation lane, never "
      + "from this seat' — it converted to the RECORDING category, gaining record_skeptic plus the "
      + "read-only, run-dir-scoped search_run_artifacts, and no retrieval tool) "
      + "and is served a document ordering a live query." },
  { stage: "skeptic", tool: "register_propose_supplemental", site: "driver/skills/prelim-search/phase2-execution.md",
    closes: "#865 — same seat, same file, the supplemental mint it cannot call." },
  { stage: "report-overview", tool: "perplexity_research", site: "driver/skills/prelim-search/synthesis-rules.md",
    closes: "#865 — synthesis-rules.md is served to synthesis (holds perplexity + band) and to "
      + "report-overview (TOOL-FREE: 'renders the shell from the settled narrative + findings')." },
  { stage: "report-overview", tool: "band_lookup", site: "driver/skills/prelim-search/synthesis-rules.md",
    closes: "#865 — same shared file, same split grant." },
  { stage: "prelim-variants", tool: "perplexity_research", site: "driver/skills/prelim-variants/SKILL.md",
    closes: "#865 — prelim-variants is TOOL-FREE by design ('pure reasoning over material already on "
      + "disk') and its own doctrine names a research call." },
];

// ── the contracts ────────────────────────────────────────────────────────────────────────────────────

export function contracts() {
  const readers = doctrineReaders();
  const tools = knownToolNames();
  return [
    fieldContract({
      id: "receipt-binding",
      what: "which field a meaning-sweep seat writes to name the candidate it ruled on",
      authority: "connotation-search.mjs meaningSweepReceiptsInstruction()",
      orders: /\breceipt_index\b/,
      retired: /\breceipt_id\b/,
      retiredWhy: "#850 M1 (1c91ffa, finished 5b989e0) moved this element from an ID the seat copies to "
        + "the candidate's POSITION in its own row. A seat ordered to set `receipt_id` is being asked for "
        + "a field the driver now fills, from a list it can only mistype.",
    }),
    // ── THE ELEMENT WITH TWO RETIREMENTS, AND THE SECOND ONE WAS MISSING FROM HERE ────────────────
    //
    // This element has had three forms: `quote` (M2 retired it), `anchor` ( retired it), and now
    // `segment_index` + `fragment`. Until the row read `orders: /\banchor\b/i` — the middle form —
    // because changed the code and the served text and never came back here.
    //
    // THAT DID NOT MERELY LEAVE THE RETIREMENT UNENFORCED. `orders` is the co-mention rule's SUPPRESSION
    // pattern, so while it named the retired middle form, writing `anchor` EXEMPTED a statement from the
    // `quote` half of this same contract. Measured on b04d6d58, through the pure checker:
    //
    //   "copy the matching `quote` from the receipt"            FIRES
    //   "give the `anchor` — do not copy the `quote` itself"    silent   <- suppressed BY the stale order
    //   "give `anchor` — eight characters copied out"           silent   <- nothing retired it
    //
    // So a retirement that does not reach this registry hands the retired token the power to excuse its
    // own replacement's predecessor. The row is part of what "retired" means, not a follow-up to it.
    //
    // SCOPED TO THE BACKTICKED FIELD NAME, and the loose form was measured before choosing: `/\banchor\b/`
    // fires 52 times across the served corpus against 10 for this pattern, because `anchor` is also a link
    // anchor ('s subject) and a variant anchor. A pattern whose extra 42 hits would have to be
    // excused is a pattern kept green by exemptions rather than by fixes — the whitelist route
    // forbids, arriving as a regex instead of a path filter. `anchor-owed` is in because the corrective
    // ladder ORDERS it in exactly that spelling.
    fieldContract({
      id: "proof-of-reading",
      what: "which field carries a spot-checked row's proof of reading",
      authority: "connotation-search.mjs segmentBinding() — the seat names the passage and copies a few "
        + "characters out of it; the driver extracts the rest",
      orders: /`segment_index`|`fragment`/,
      retired: /`quote`|\bquote_required\b.{0,80}\bquote\b|`anchor`|\banchor-owed\b|\banchor_(?:absent|unbound|foreign)\b/,
      retiredWhy: "#850 M2 (6379fb0) moved this element off a verbatim passage the seat retypes, and "
        + "#1098 (1aae473c, eb959e72) moved it off the anchor: an anchor had to be long enough to pin an "
        + "extraction span by exact match, which is unsatisfiable on text a seat cannot retype — 33 of 34 "
        + "CJK runs failed against 0 of 47 Latin-only. The seat now gives `segment_index`, the NUMBER of "
        + "the passage it relied on, and copies a short `fragment` out of that same passage. A seat "
        + "ordered to produce a `quote` or an `anchor` is being set the transcription task those two "
        + "retirements removed, and the tool refuses the row (`segment_absent`) whatever it sends.",
    }),
    soleAuthorContract({
      id: "closing-line",
      what: "which file a seat dispatch names as the thing that gets checked",
      phrase: /Write your output to this ABSOLUTE path|YOU OWE \d+ FILES/,
      author: /(^|\/)stages\.mjs$/,
      authority: "stages.mjs writeReturn()",
      why: "#921 — the closing line is composed by writeReturn() and is re-parsed by TWO consumers: the "
        + "seat, which reads the last instruction as the definition of its task, and the harness mock, "
        + "which locates a stage's output with /ABSOLUTE path[^:]*:\\s*(\\/\\S+)/. A second authoring does "
        + "not have to be wrong to be a defect — only one of the two copies gets fixed next time either "
        + "consumer moves, and neither failure says a word.",
    }),
    toolOrderContract({
      toolNames: tools,
      grantedFor: grantedToolsFor,
      stagesOf: (f) => readers.get(f) ?? [],
      backlog: TOOL_ORDER_BACKLOG,
    }),
  ];
}

export { TOOL_FREE_STAGES };
