// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// stages-knockout.mjs — the KNOCKOUT (Depth 1) lane's stage table, paths, sweep prompt and status steps.
// Same def shape as stages.mjs STAGES ({model, thinking, timeoutSec, stallSec, out, validate, message}),
// kept in its OWN table: the knockout lane is a different product shape (a 5–15 mark triage batch), and
// its stages must never leak into the clearance STAGE_ORDER. New-named stages get [] MCP tool groups
// automatically (gather-config prefix map — the matter-frame precedent), so frame/assess run lean.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { driverDir } from "../shared/driver-dir.mjs";   //
import { validators as koValidators } from "./verify-knockout.mjs";
import { kebab } from "./search-policy.mjs";
// — the door owns "did the request name any classes?"; this builder reads it rather than
// re-deriving it. A third copy is what put the knockout frame a class behind the intake.
import { requestNamesClasses } from "./enqueue-schema.mjs";
import { knockoutAssessChunkFile } from "./knockout-assess-record.mjs";
export { kebab };   // one definition (search-policy) — re-exported for the lane's existing imports

const lines = (...xs) => xs.filter(Boolean).join("\n");
const reads = (skillReads) => `First, read and follow exactly: ${skillReads.join(", ")}.`;

// ── Paths (knockout-own; beside the standard _driver sidecars) ───────────────────────────────────────
export function koPaths(runDir) {
  return {
    runDir,
    frame: join(runDir, "knockout-frame.md"),
    plan: join(runDir, "knockout-plan.json"),
    findings: join(runDir, "knockout-findings.json"),
    assessment: join(runDir, "knockout-assessment.md"),
    // Depth 2: the code-authoritative count sidecar + its per-call receipts. Both live under
    // _driver/ — they are the driver's own measurements, never a model's output.
    registerCounts: driverDir(runDir, "register-counts.json"),
    countLedger: driverDir(runDir, "register-count.jsonl"),
    // part 5 — the filings behind the narrow counts, beside the counts they explain. Because the
    // MCP server serves run artifacts generically, landing it here makes the filings queryable over MCP
    // with no MCP-side work at all. Its receipts ride the count lane's ledger file and are the ONLY
    // lines there carrying `stage: "records"` — so one file answers "what did this run's register lane
    // cost", and the two lanes are told apart by a key the older lines simply do not have. The count
    // rows were left exactly as they were rather than gaining a matching marker: their shape is pinned
    // byte-for-byte by register-count.test.mjs, and a discriminator only one side needs is enough.
    registerRecords: driverDir(runDir, "register-records.json"),
    researchDir: join(runDir, "research"),
    research: (markKebab) => join(runDir, "research", `${markKebab}.md`),
    sweepLedger: driverDir(runDir, "knockout-sweep.jsonl"),
    // 's SHAPE, APPLIED: the WORK MOVES OUT OF THE GUARDED TREE — the hook is never weakened.
    //
    // This chunk is a MODEL OUTPUT, and it sat under `_driver/` in flat contradiction of the rule stated
    // fourteen lines above: those files "are the driver's own measurements, NEVER a model's output". So
    // relocation is not a workaround for the boundary; it is this module finally obeying its own doctrine.
    //
    // WHY IT ONLY FAILED NOW, which is the part worth keeping. E13 has denied Write/Edit under `_driver/`
    // since 2026-08-14, and seats complied anyway by shelling out — Bash redirects wrote the file the Write
    // tool refused. closed that bypass on 2026-08-16, and knockout-assess broke the same day: the seat
    // was refused on Write AND on Bash, all three attempts, and the corrective ladder exhausted against a
    // stage ordering it to write somewhere nothing would let it. THE BYPASS WAS LOAD-BEARING AND NOBODY
    // KNEW — a run delivered two days earlier only because the workaround still worked.
    //
    // Measured blast radius, both directions independently: six `_driver` constructions in this module and
    // exactly one of them is a stage's `out:`; zero in stages.mjs (all 19 messages composed — four name a
    // `_driver/` path and every one is a READ, checked in context, not by keyword).
    // DELEGATED, not re-spelled. This PR introduced a second constructor for this exact path in
    // `knockout-assess-record.mjs` (the transport now writes the file the seat used to), and two
    // independent constructions of one path is a write-path/read-path split waiting to happen: the
    // driver would write where the pipeline does not read and every arm on both sides would stay green.
    // One producer, imported.
    assessChunk: (n) => knockoutAssessChunkFile(runDir, n),
    // The pre-relocation location, for READS ONLY. A run that got its chunks written before the move — or
    // through the Bash bypass — must still resume without re-dispatching a paid stage, so the reader falls
    // back to this and nothing ever writes it again. Delete once no resumable run predates the move.
    assessChunkLegacy: (n) => driverDir(runDir, `knockout-assess-${n}.json`),
    instructedScope: driverDir(runDir, "instructed-scope.json"),
    emailBody: join(runDir, "email-body.md"),
  };
}


// ── The sweep prompt — the interactive skill's Perplexity template, VERBATIM (knockout-searches
// SKILL.md :118-150), driver-templated: every substitution is DICTATED from the frame's plan row —
// nothing inferred at run time, and the template carries no client identity/reference/contact
// (the skill's HITL sanitization, now enforced by construction).
export function knockoutPrompt(markRow, batch, { jurisdictions = null } = {}) {
  const name = String(markRow.name);
  // Instructed territories are DICTATED from the job, never inferred by the frame — the same discipline
  // every other substitution here follows. Absent ⇒ the global default, which is what a quick screen has
  // always been; present ⇒ the screen is pointed, and the prompt says so in both places scope is stated
  // (the scope block and the report format), because a model told "US only" in one line and asked for
  // "jurisdiction" in another will happily hand back the world.
  const jx = Array.isArray(jurisdictions) ? jurisdictions.map((s) => String(s).trim()).filter(Boolean) : [];
  const scopeLine = jx.length ? `- ${jx.join(", ")} — named territories only` : `- Global — all jurisdictions`;
  const multi = /\s/.test(name.trim());
  const noSpaces = name.replace(/\s+/g, "");
  const hyphenated = name.trim().replace(/\s+/g, "-");
  const dotCom = `${noSpaces.toLowerCase().replace(/[^a-z0-9-]/g, "")}.com`;
  const ctxNote = markRow.contextFraming ? ` — ${markRow.contextFraming}` : "";
  return lines(
    `Quick knockout trademark search for the proposed mark "${name}" in the context of ${batch.productContext}${ctxNote}.`,
    ``,
    `SEARCH FOR:`,
    `1. "${name}" — exact phrase`,
    multi ? `2. "${noSpaces}" — no spaces` : "",
    multi ? `3. "${hyphenated}" — hyphenated` : "",
    ``,
    `CLASSES/INDUSTRIES TO CONSIDER: ${markRow.classesPlain}`,
    ``,
    `WHAT I NEED TO KNOW:`,
    `- Are there any MAJOR existing brands, products, companies, or well-known entities using this exact name or a very close variant?`,
    `- Is this name a well-known TV show, movie, book, song, game, or cultural reference?`,
    `- Are there any famous trademarks that are identical or nearly identical?`,
    `- Is the term commonly used in commerce in the relevant industries listed above?`,
    `- Are there any businesses using this name in the same or adjacent industries (especially ${batch.productContext})?`,
    `- Are there any negative, controversial, or offensive associations?`,
    `- Is there a dominant .com or commercial website at ${dotCom}?`,
    ``,
    `SEARCH SCOPE:`,
    scopeLine,
    `- All commercial contexts relevant to the classes above`,
    `- General web, major e-commerce (Amazon), app stores, social media, domain registries`,
    `- Industry-specific marketplaces relevant to the product context (e.g. for gaming: Steam, Epic, Google Play, App Store, Microsoft Store, itch.io; for physical goods: Amazon and the category's retail/marketplace sites)`,
    `- Do NOT search trademark registers (USPTO, WIPO, etc.) — common-law / marketplace only`,
    ``,
    // — the other half of part 2's ruling, which reached the ASSESS seat only (see the same
    // wording further down this file) and left this one with the same blindness and no prohibition.
    // Measured on R4 2026-08-21: this seat wrote "No USPTO, EUIPO, WIPO, Swiss, or other trademark-register
    // searches were performed, as instructed" into the delivered research file, on a run that took
    // THIRTEEN EUIPO register searches and reported their counts in the same delivery's email body.
    //
    // The seat was not lying and "as instructed" is a true description of the line above it — but the
    // line scopes THIS SEAT's work, and the client has no way to read it that narrowly. Nobody who
    // cannot see the machinery describes it: the renderer owns that sentence and writes it from the
    // sidecars, including the coverage-shortfall disclosure. Hidden until now only because the register
    // provider is normally clarivate while this sentence names USPTO/WIPO/Swiss as its examples; running
    // EUIPO put the named office and the counted office side by side in one delivery.
    `- SAY NOTHING ABOUT WHETHER THE REGISTERS WERE SEARCHED, counted, overlaid or checked — not in a`,
    `  finding, not in a gaps, scope or caveat note, not as an aside. The scope line above governs YOUR`,
    `  work and is not a fact about the run: this run may well be searching registers on a lane you`,
    `  cannot see, and the report states what it covered in code, from the run's own measurements.`,
    ``,
    `REPORT FORMAT:`,
    jx.length
      ? `- List any significant findings with: name, what it is, URL, jurisdiction, and why it matters — findings OUTSIDE ${jx.join(", ")} are out of scope for this screen and should be omitted`
      : `- List any significant findings with: name, what it is, URL, jurisdiction, and why it matters`,
    `- If NOTHING significant is found, explicitly state: "No major common law blockers identified for ${name}"`,
    `- Be concise — this is a knockout search, not a deep dive`,
    `- Focus on OBVIOUS conflicts: famous brands, identical names in same/adjacent industries, well-known cultural references, major commercial entities`,
    `- Note the crowded field situation if relevant (e.g., "many MOTO-[x] publications exist")`,
  );
}

// ── Assess chunking: ≤8 marks per LLM turn; chunks merged in code (pipeline-knockout) ────────────────
export const KO_ASSESS_CHUNK = 8;
export const koChunks = (marks) => {
  const out = [];
  for (let i = 0; i < marks.length; i += KO_ASSESS_CHUNK) out.push(marks.slice(i, i + KO_ASSESS_CHUNK));
  return out;
};

// ── Status stepper (knockout drives writeRunStatus directly — never seedRunStatus's 9-step flow) ─────
//
// The steps a PLAIN knockout walks. Depth 2 inserts one more (below), so the lane addresses its
// steps BY LABEL rather than by index — a Depth 2 run's "Report & publish" is step 5 while a plain
// knockout's is step 4, and a hardcoded 3 would silently mislabel every screen the client watches.
export const KO_STEPS = [
  "Framing the batch",        // 1
  "Sweeping marks",           // 2
  "Knockout assessment",      // 3
  "Report & publish",         // 4
  "Sending to you",           // 5
];

// Depth 2's own step. It sits AFTER the frame (the counts are scoped by the frame's per-mark
// classes) and BEFORE the sweep, so the cheap deterministic question is answered before the batch
// spends anything on research.
export const KO_STEP_REGISTER_COUNT = "Counting register filings";

/** The step labels this run will actually walk, in order. stepTotal comes from THIS list. */
export function koSteps({ registerProbe = false } = {}) {
  if (!registerProbe) return [...KO_STEPS];
  return [KO_STEPS[0], KO_STEP_REGISTER_COUNT, ...KO_STEPS.slice(1)];
}

// ── Stage defs ───────────────────────────────────────────────────────────────────────────────────────
export const KO_STAGES = {
  "knockout-frame": {
    model: "opus", thinking: "high", timeoutSec: 420, stallSec: 300,
    skillReads: ["skills/knockout-frame/SKILL.md"],
    out: (K) => K.plan,
    validate: koValidators.knockoutPlan,
    message: ({ K, job, profile }) => lines(
      reads(["skills/knockout-frame/SKILL.md"]),
      // ── NO DEPTH NUMBER ──────────────────────────────────────────────────────
      //
      // This read "(Depth 1 triage)". Depth is a rung on a ladder the offering retired, and the seat's
      // own doctrine — the file it is told to read on the line above — mentions Depth zero times. So
      // line 2 handed the model a product name line 1's authority does not contain, and left it to
      // decide what it meant.
      //
      // The rule already existed and had been applied to the surface a CLIENT reads and not to this
      // one: render-knockout.mjs says a depth number "is a rung on a ladder the offering no longer has,
      // and it must not appear on a client's page." If it is meaningless to a reader holding the
      // report, it is worse than meaningless to a seat being told what job it is doing.
      //
      // `RETIRED_POLICIES` keeps "Depth 1" deliberately, so an archived run re-renders under the name it
      // was sold under. That is a rendering concession for old artifacts, not live vocabulary.
      `You are framing a KNOCKOUT SEARCH batch — a triage pass. You frame, you do NOT search.`,
      `The instructed scope (AUTHORITATIVE — quote mark names verbatim from it): ${K.instructedScope}`,
      job.goods ? `Goods/services (verbatim): ${job.goods}` : "",
      job.customer ? `Applicant (context only — never enters the sweep prompt): ${job.customer}` : "",
      profile?.industry ? `Customer industry (context for marketplace selection): ${profile.industry}.` : "",
      // — "the request names none" reads the intake's classes-anywhere predicate, not a third copy
      // of it. This checked TOP-LEVEL classes only, and a knockout is a batch keyed on `job.marks`: a
      // request naming classes per mark was told it named none and handed the customer's defaults for a
      // layer it had not chosen. Measured: marks[{name, classes:[25]}] + defaultClasses [9,42] produced
      // "the request names none — consider them: 9, 42" on the knockout frame and nothing on the
      // clearance frame, from the same job.
      profile?.defaultClasses?.length && !requestNamesClasses(job)
        ? `Customer-default classes (the request names none — consider them): ${profile.defaultClasses.join(", ")}.` : "",
      job.upfrontInstructions ? `Requester instructions (verbatim — fold prior knowledge from here): ${job.upfrontInstructions}` : "",
      job.deadline ? `Requester deadline: ${job.deadline}` : "",
      // ── THE RETURN IS A CALL, AND IT CARRIES BOTH ARTIFACTS ( item C) ──────────
      //
      // THE DISPATCH NAMES NO PATHS. The driver writes the plan and the note from what the seat sends,
      // and the seat's grant carries no Write.
      //
      // THE NOTE IS ORDERED AS FINISHED PROSE, because the driver writes it byte-for-byte. Before this
      // conversion the seat wrote the file itself and could revise it; now what arrives IS the document.
      // It is also the only one of the two that was never checked — koStage takes `expectFile` and
      // `validate` from `out`, which is the plan — so a seat that wrote the plan and skipped the note
      // passed the stage. Saying "the driver writes it exactly as you send it" is what replaces the
      // second chance the Write tool used to give.
      `HAND THE FRAME BACK BY CALLING \`record_knockout_frame\`. THERE ARE NO FILES FOR YOU TO WRITE and this dispatch names none — the driver writes both the plan and the scope note from what you send, and nothing you write by hand is read.`,
      `Send \`scope_note\`: the 2–3 sentence scope note, FINISHED — what the batch is, which classes, anything flagged. It is written to knockout-frame.md exactly as you send it, with no heading added and nothing composed into it, so it must read as a complete document on arrival.`,
      `Send \`marks\`: one row per instructed mark, names verbatim from the instructed scope, each with its classes, beltAndBraces, classesPlain, contextFraming and priority. Two names that differ only in spacing, punctuation or case are REFUSED — they would share one research payload, and one of them would then be rated on the other's evidence.`,
      `Send \`batch\`: productContext, and executionOrder as a permutation of your mark names.`,
      `IF YOU CALL AGAIN, SEND ONLY WHAT YOU ARE CORRECTING. The driver merges marks BY NAME onto what it already accepted, so a mark you omit keeps its row — but a mark you DO send replaces that row whole, so send a corrected mark complete rather than as a fragment.`,
    ),
  },
  "knockout-assess": {
    model: "opus", thinking: "high", timeoutSec: 900, stallSec: 600,
    // ── WHAT THIS STAGE READS, AND WHY IT IS THREE DOCUMENTS NOW ──────────────
    //
    // It read one: its own SKILL.md. So it rated in a framework's band words while never seeing that
    // framework's rulebook, and it carried private calibration rules that had drifted out of doctrine.
    // Measured against a lawyer over four marks: two of them two bands high, same direction, stable
    // across two engine commits.
    //
    //   · the stage's own doctrine — depth, degraded marks, batch output shape, tone
    //   · THE DECK IN FORCE — its matrix and its ceilings ("High and Very High REQUIRE Legal Level D
    //     or E") and its anti-escalation rule ("Optics — owner size, fame, partnership — never move
    //     the legal read"). `framework.json` carries vocabulary and order ONLY, by framework.mjs's own
    //     rule, so the ceilings could not reach this seat at all.
    //   · THE FIRM-WIDE SPINE — one copy, shared with the clearance lane, never transcribed.
    //
    // NOTE ON `skillReads` HERE: on this lane it is DECLARATIVE ONLY. Nothing in koStage reads it, and
    // the guards that read `STAGES.skillReads` walk the clearance lane's table, not this one — so the
    // effective read is the `reads([...])` call in the message and nothing checks that the two agree.
    // They are edited together and the asymmetry is written down rather than left to be discovered.
    skillReads: ["skills/knockout-assess/SKILL.md", "skills/prelim-search/firm-wide-reasoning.md"],
    // out/validate are per-CHUNK; the merged knockout-findings.json is validated separately in code.
    out: (K, chunkNo) => K.assessChunk(chunkNo),
    validate: koValidators.knockoutAssessChunk,
    message: ({ K, chunkNo, chunkMarks, chunkTotal, framework, frameworkPath, probeNote }) => lines(
      // The deck path comes from ctx (attachKnockoutFramework resolves it once, on the fresh and the
      // resume path both) — never recomputed here, because "which deck" is one decision.
      reads(["skills/knockout-assess/SKILL.md", frameworkPath, "skills/prelim-search/firm-wide-reasoning.md"].filter(Boolean)),
      `You are rating chunk ${chunkNo + 1}/${chunkTotal} of a KNOCKOUT batch — triage, not clearance.`,
      `Rate ONLY these marks (one entry each, names verbatim): ${chunkMarks.map((m) => m.name).join(" · ")}.`,
      `The batch plan (context framing, classes, priorities): ${K.plan}`,
      // ── contextFraming IS A RATING INPUT, AND SAYING SO IS THE OTHER HALF OF THE DOCTRINE ─────────
      //
      // The firm-wide reasoning calibrates on MANNER OF USE — a character name inside a franchise sits
      // further from a franchise title than the two strings look, and that pair moves a band. The plan
      // has carried a per-mark `contextFraming` all along and nothing ever told this seat to rate with
      // it, so the requester's per-name detail reached the run and stopped. Shipping the doctrine
      // without pointing at the field it turns on is half a fix.
      `EACH MARK'S "contextFraming" IN THAT PLAN IS WHAT THE NAME IS FOR — a character name, a location, a biome feature, an achievement title. READ IT AND RATE WITH IT: the manner-of-use calibration in the firm-wide reasoning turns on exactly this, and it is per MARK, not per batch. Two names in one batch can sit at different bands on identical evidence because they are used differently. Carry the field through to your own row unchanged.`,
      // ── THE EVIDENCE BASE IS TWO THINGS NOW, AND IT WAS THE SECOND GAG ───────
      //
      // "the ONLY evidence base" is what stopped this seat weighing filings the same run had already
      // fetched and paid for. Measured on a delivered run: every one of the five filings the reviewing
      // lawyer built her read on was on disk before this stage started, and none was weighed — they
      // reached the client as raw cards with no band. The URL rule stays and is scoped: a cited URL must
      // come from one of the two sources named here, which is the anti-confabulation rule it always was
      // and never a rule about which of the two.
      `Each mark's RAW research payload (a cited URL must appear in the mark's own payload or in the register records below):`,
      ...chunkMarks.map((m) => `- ${m.name}: ${K.research(kebab(m.name))}${m.degraded ? `   (DEGRADED: ${m.degraded} — apply the null-results doctrine, never inflate)` : ""}`),
      // NAMED ONLY WHEN IT IS ON DISK. The records land at step 2 of 5 and this stage is step 3 or 4, so
      // the file exists by now on a run that fetched them — and on a run that did not, a dispatch naming
      // a path that is not there teaches the seat that a missing file is normal.
      existsSync(K.registerRecords)
        ? `THE REGISTER FILINGS THIS RUN ALREADY FETCHED — ${K.registerRecords}. Real records, retrieved before you started: owner, jurisdiction, status, classes, dates. Read them and WEIGH them for the marks you are rating. A registration on this list is evidence about the name it names — treat its owner, its scope and its vulnerability the way the firm-wide reasoning tells you to (revocability above the lowest band; an enforcer's portfolio profile; a crowd as a mitigant under its gating precondition). What you may NOT do is describe the lane that fetched them — see the coverage rule below.`
        : "",
      // ── THE READ REACHES THE PAGE ────────────────────────────────────────────
      //
      // Until now nothing this seat concluded about an INDIVIDUAL filing could reach a reader. A filing
      // it was handed rendered as a card with no band and no rater text, carrying one code-owned
      // sentence for every filing on every run. The ruling on asked for the opposite:
      // a filing the rater weighed shows its read; one it did not carries a stated reason.
      //
      // THE ID IS THE JOIN, AND IT IS WHY THIS IS NOT A SELF-REPORT. The driver checks every id against
      // the record store above and refuses one it does not hold, so a Register label can never appear on
      // a finding with no register evidence. Omitting either field is always safe: the card keeps its
      // neutral line, which describes the card and is true.
      existsSync(K.registerRecords)
        ? `WHEN YOU WEIGH ONE OF THOSE FILINGS, SAY SO BY ITS OWN ID — copy "recordId" verbatim from the file above. "registerReads" on the MARK: rows of {recordId, read} for a filing you weighed that did NOT become a findings[] record; "read" is what you concluded about THAT filing — whether it bears on the rating and why — and it prints on that filing's card in the reader's own report. "weighedFilings" on a FINDING: the recordIds whose evidence your reasoning for that conflict actually used, because the report derives that finding's source labelling from it. Both are optional and both are joined against the filings you were given, so an id we do not hold is refused by name. A filing you did not weigh simply gets no row: do not invent a read to fill one, and never write "not weighed" as a read.`
        : "",
      `A DEGRADED mark's row must carry degraded:true and the purple "Manual verification recommended"`,
      `note; a mark WITH a payload must never claim degraded (the validator joins both against the disk).`,
      `The FROZEN framework in force (rate in ITS band vocabulary, highest→lowest ${framework.bands.map((b) => b.label).join(" · ")}): ${driverDir(K.runDir, "framework.json")}`,
      // — the band is dictated here because the CODE cannot supply it: the rating is the author's
      // judgment about blocking power, and the machine can only check that what came back is a word from
      // the ladder above. The ORDINAL is a different case, and the wording below says so: the machine
      // ranks on the band and renumbers 1…N (findings-model.mjs validateKnockoutFindings), because the
      // number is a drill-through key printed as a range in the audit trail, and a gap in it makes that
      // cell assert findings the run does not hold. What is asked for here is the author's ORDER, which
      // is what breaks ties inside a band. The shape itself is the skill's (SKILL.md "The finding
      // record"); this says the two things that are per-TURN — that the ladder named on the line above
      // is also the per-finding vocabulary, and that the numbering restarts at each mark.
      `EVERY conflicting name is a typed findings[] record — {ordinal, name, owner, band, net, type,`,
      `evidence[], basis}, closed keys. Its "band" is a word from the SAME ladder as the mark's rating`,
      `(never HIGH/MEDIUM/LOW and never a number), and "ordinal" restarts at 1 for EACH mark, most`,
      `blocking first. The code re-ranks on the band and renumbers, so your order decides ties inside a`,
      `band — never cite a finding by its number in prose. A named conflict belongs in findings[], not`,
      `in bullets — write it once.`,
      // A seam for a note about Depth 2, and it stays UNUSED on purpose (2026-07-22). The counts
      // are code-measured and code-rendered; showing them to this turn would let a rating be argued
      // from register data a knockout has not analysed, and would put a figure the report prints
      // exactly ("37") in reach of a turn that can only paraphrase it ("around forty"). The two
      // would then disagree on the same page. A count is code-rendered or absent; a turn never restates one.
      probeNote ?? "",
      // — THE READ IS TYPED, not narrated. Every summary this lane has ever written walks the same
      // skeleton (why this band → what is crowding the field → what holds it off the next band →
      // what would move it), and it walked it in sentence flow, where only a careful read recovers it.
      // A ~180-word paragraph is not what a lawyer scanning twenty names can use. Emitted as fields, the
      // renderer can lay it out; emitted as prose, no renderer can. Same rule as: structure at
      // source, never a regex over rendered prose.
      // ── THE PER-MARK OPENING ASSESSMENT ──────────────────────────────────────
      //
      // Owner ruling, 2026-08-26: a batch client gets the same kind of opening paragraph a single-mark
      // client gets, MODEL-AUTHORED and at full length — "the most useful piece of pre-triage; I don't
      // see why we constrain it; 4× longer like the single mark seems fine."
      //
      // Until now a per-mark document opened with nothing at all: the batch paragraph names every mark,
      // so publish blanked it on each mark's own page rather than print a summary about other people's
      // names. That was right and it left the page with no opening read.
      //
      // ADDITIONAL TO `chunkSummary`, NOT A REPLACEMENT. The cross-mark paragraph still exists and still
      // owns the grouped page — the two are different documents for different readers, and collapsing
      // them is what produced the blank.
      // ── STRUCTURE, AND A SCALE THAT HOLDS (tracker issues 1934 and 2056) ──────────────────────────
      //
      // Owner, 2026-08-31, reading a delivered run: the per-mark opening was "now HUGE and formatted
      // even worse — no newlines, borderline not a summary". Measured on that run: 2,875 characters,
      // zero newlines, zero headings, zero bullets — and the same shape on a crowded register field as
      // on an empty one, so the seat was not sprawling under load. It was writing one block because the
      // line below asked for full length and said nothing about shape.
      //
      // His ruling, verbatim, and it AMENDS the 2026-08-26 "full length, not rationed" decision above
      // rather than quietly overriding it: "keep the length, add the structure, so long as length is
      // consistent more or less."
      //
      // The depth rule is not stylistic. `# ` opens a SECTION of the delivered report — parseSections
      // splits on /^# /m and batchSummaryOf terminates on it — so a single hash written here ends the
      // client's summary at that line and drops everything after it, silently, on the entry point.
      `EVERY mark ALSO carries "assessment": the opening read a reader of THIS MARK'S OWN report meets first, before any table. Write it for a client who ordered this one name and nothing else: what the name is, what the landscape around it looks like, what drives the rating, and what a reader should do with that.`,
      `GIVE IT STRUCTURE A READER CAN SCAN — that is what changed. Sub-headers where the content divides, "- " bullets for the load-bearing points, a blank line between blocks. A sub-header is "## " or "### ". NEVER "# ": one hash opens a section of the report itself, and a summary that opens a section ends there and takes the rest of itself off the client's page. A single sub-header over one unbroken block is not structure — the blocks are what make the length readable, and unstructured length is the complaint this replaces.`,
      `KEEP THE LENGTH. It is still the most useful part of a triage and it is still not rationed. What it now has to be is CONSISTENT: this mark's opening read is the scale of a single-mark report's opening read, and the marks of one batch sit within reach of each other. One assessment several times the size of its siblings is out of family. No word count and none is coming — judge it against the other marks in front of you.`,
      `SYNTHESISE THE SOURCES, DO NOT SHELVE THEM SEPARATELY. Where filings were handed to you for this mark, weigh them in the SAME passage as the marketplace and common-law reading — what the screened field shows, what those filings do to that reading, and what the two together mean for the band. A reader must not be handed one block per source and left to reconcile them.`,
      `IT NAMES THIS MARK AND NO OTHER. Each mark's report is delivered on its own, to a reader who may have ordered only that name, so a sibling's name appearing in this paragraph is another client's mark on this client's page. Do not compare across the batch here — the cross-mark reading is what "chunkSummary" is for, and it has its own page.`,
      `EVERY mark carries the READ as TYPED FIELDS, not as a paragraph:`,
      `  "basis"          ONE sentence: why this band, for this name, in these classes.`,
      `  "factors"        2-4 strings, one line each — the load-bearing observations behind the band.`,
      `  "counterFactors" 1-3 strings — what holds it at this band rather than the next one either way.`,
      `  "mitigation"     ONE line: the single thing that would move it. "" if nothing would.`,
      `Each is a standalone line: no semicolon chains, no clause stacking, no restating the band word.`,
      `Write each observation ONCE — a point made in "factors" is not repeated in "bullets".`,
      // The other half of part 2's ruling, enforced here rather than hoped for. The live 2026-08-11
      // report carried "the register overlay has not been run" directly under a table of register counts
      // the same run had taken. The turn was not lying: it is never shown the count lane's output (rule 1
      // of register-count.mjs) and it filled the gap with the only thing it had. Nobody who cannot see
      // the machinery describes it — the renderer owns that sentence and writes it from the sidecars.
      // ── THE GAG SPLITS: THE LANE STAYS GAGGED, THE FILINGS DO NOT ─────────────────────────────────
      //
      // The rule below is about COVERAGE — whether the register lane ran, how much it found, how far it
      // reached. That stays, and its reason is unchanged: this seat cannot see that lane, the report
      // states coverage in code from the run's own measurements, and a summary saying the registers were
      // not run above a table of counts that were is the contradiction it closes.
      //
      // What it must NOT be read as, and was: a bar on weighing an individual filing you were handed.
      // The validator arm behind it (`REGISTER_CLAIM_RE`) is KEPT and is already scoped correctly —
      // driven on seven sentences, it matches all three coverage narrations and none of four weighing
      // sentences ("Disney holds a Hong Kong registration…", "the German registration is vulnerable to
      // non-use revocation…"). The issue asked for the arm to be deleted; deleting it would remove
      // exactly the protection the issue's own next sentence says to keep. Measured, raised, kept.
      `SAY NOTHING ABOUT WHETHER THE REGISTER LANE RAN — whether registers were searched, counted,`,
      `overlaid or checked, how many filings exist, or how far the search reached. Not in any field, not`,
      `in the chunk summary. You cannot see that lane; the report states its coverage in code from the`,
      `run's own measurements, and the validator refuses a chunk that speaks for it.`,
      `THAT IS A RULE ABOUT THE LANE, NOT ABOUT THE FILINGS. Where records are given to you above, WEIGH`,
      `them: whose they are, what they cover, what they are worth against this name. A filing you were`,
      `handed is evidence like any other and reasoning about it is the job.`,
      // — THE GROUPED PAGE'S ENTRY POINT, AND IT WAS ORDERED AS ONE BLOCK TOO.
      // The owner's report on this surface was the same as the per-mark one: "just one block of text —
      // no sub-headers, bullet points etc. Very hard to digest. This is an important part of the report
      // — it's the entry point." The order below said "measured sentences" and the doctrine file said
      // "narrative, not bullets"; both moved together, because a seat given two answers picks one.
      // It stays the SHORTER digest that sits above the per-mark assessments — that is the owner's
      // ordering and it is unchanged. Structure is what it gains, not size.
      `EVERY chunk includes "chunkSummary": the cross-mark read covering THIS chunk's marks (code`,
      `concatenates the chunks into the batch executive summary — a mark missing from its chunkSummary`,
      `is missing from the report summary).`,
      `STRUCTURE IT: a short opening line for what the batch as a whole shows, then one "## <MARK NAME>"`,
      `sub-header per mark with its band and the one or two things that drive it, bullets where they`,
      `help. Same depth rule as the per-mark assessment — "## " or "### ", never "# ".`,
      `IT IS THE SHORTER DIGEST ABOVE THE PER-MARK ASSESSMENTS, not a rival to them. A reader opens this`,
      `to decide which name to read about; the mark's own page is where the full read lives. Keep it`,
      `tighter than any one mark's assessment.`,
      // ── THE RETURN IS A CALL, NOT A FILE (, item B) ────────────────────────────
      //
      // THE DISPATCH NAMES NO PATH, and on this stage that is not merely the house pattern. This seat
      // spent 2026-08 writing its chunk through a Bash redirect because the Write tool was already
      // refused under `_driver/`; closed that bypass and the stage broke the same day, its
      // corrective ladder exhausting against a dispatch that ordered a write nothing would permit. The
      // relocation to the run root fixed the permission. This removes the order itself: there is no path
      // here to hold, the seat's grant carries no Write, and the driver writes the chunk from values.
      //
      // THE CHUNK INDEX IS NOT A PARAMETER, and the tool's own description says so to the model. The
      // driver bound it at dispatch and the record tool reads it from the environment, never from the
      // payload — because the chunk assignment is exactly what the validator's membership join checks
      // against, and a seat that could name its own chunk would author the identity its work is judged by.
      `HAND YOUR RATINGS BACK BY CALLING \`record_knockout_assess\`. THERE IS NO FILE FOR YOU TO WRITE and this dispatch names none — the driver writes this chunk itself from what you send, and nothing you write by hand is read. You are not told which chunk number to send and there is no field for it: the driver bound that when it dispatched you.`,
      `SEND ONLY WHAT YOU ARE CORRECTING IF YOU CALL AGAIN. A second call MERGES into the first: marks are merged BY NAME, so a mark you omit keeps the rating you already gave it. What you DO send for a mark replaces that mark's whole record, so send a corrected mark complete rather than as a fragment.`,
      chunkNo === 0
        ? `As the FIRST chunk you also send \`batch\` (productContext, standardCaveats) and \`framework\`.`
        : `As a CONTINUATION chunk you send \`marks\` and \`chunkSummary\` only — batch and framework came from chunk 1.`,
    ),
  },
};
