// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Builds the `claude --mcp-config` JSON + the per-stage allowedTools for the anthropic-agent engine's
// gather stages. A stage names abstract TOOL GROUPS (perplexity | register | band | caselaw); this maps
// them to the wrapped MCP servers (the active register provider + perplexity) + the already-MCP case-law bridge servers
// (courtlistener/legaldatahunter via oauth-mcp-bridge) + claude's built-in WebFetch (EUR-Lex). Creds reach
// the servers by ENV INHERITANCE from the engine process (no secrets written to the config); only the
// per-stage run session key + telemetry ledger paths ride the config env (so the $0 provider-usage diff
// still attributes calls to the run).
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { requireRegisterProvider } from "../../driver.config.mjs";
import { ledgerPath, runRecordLogPath } from "../../../providers/_shared/ledger-path.mjs";

const MCP_DIR = dirname(fileURLToPath(import.meta.url));
const NODE = process.execPath;
// Case-law bridge: default = the IN-REPO vendored copy (providers/oauth-mcp-bridge). Resolved relative
// to this module so a fresh standalone install works out of the box; CLEAROTRON_OAUTH_BRIDGE overrides for
// deployments running the bridge from elsewhere. (The old default pointed at the origin monorepo's
// /home/operator/<vendor-dir>/... layout and broke case-law gathering on a clean checkout.)
const BRIDGE = process.env.CLEAROTRON_OAUTH_BRIDGE || join(MCP_DIR, "..", "..", "..", "providers", "oauth-mcp-bridge", "bridge.mjs");

// ── The register surface is PROVIDER-NEUTRAL ────────────────────────────────────────────────────
// The active register provider is mounted under the single server key `register`, and every register
// tool is named `register_*`. The vendor's name survives ONLY inside its own *-server.mjs file and in
// skills/prelim-register/providers/<provider>.md (the vocabulary doc the spawns are told to read).
//
// Why neutral names rather than interpolating `${PROVIDER}_enumerate` into the prose: the register
// instructions in stages.mjs / pipeline.mjs / gateway.mjs are then correct BY CONSTRUCTION for every
// provider, and the namespaced ids (`mcp__register__register_enumerate`) stay stable across a swap.
//
// THIS USED TO CLAIM MORE THAN IT COULD KEEP. The old sentence ended "— so an excludeTools entry
// or a corrective-ladder nudge cannot silently name a tool that isn't loaded", and a stable NAME is not a
// loaded tool: signa served four of these eight while its grant carried two, so two ladder hints named
// tools its allowlist refused, and a third names one signa does not serve at all. What is true is now
// enforced instead of asserted here, in two places that fail rather than describe:
//   · register-advertisement-vs-grant.test.mjs — every provider grants exactly what its server advertises,
//     compared against the server's real tools/list, with any withholding written down;
//   · the same file's second arm — every neutral tool the driver's composed prose ORDERS is served by every
//     provider, with the one live exception named and required to still reproduce.
// A provider that cannot implement one of these tools must fail LOUDLY (and its gap becomes a
// `deferred` coverage row); it must never quietly expose a weaker substitute under the same name.
const REGISTER_TOOLS = [
  "register_search", "register_record_fetch", "register_image_fetch", "register_expand_phoneme",
  "register_batch_screen", "register_enumerate", "register_execute_plan", "register_propose_supplemental",
];

// Per-provider register server scripts. All expose the SAME `register_*` names (each wraps its own
// provider core as pure glue); they differ only in which of REGISTER_TOOLS they can actually serve.
// EXPORTED for E12: the dictation check has to know which tool names exist and which a stage
// holds, and it runs in CI with no deploy environment — so it cannot go through registerEntry(), which
// requires a provider by design. Reading this table directly lets it take the UNION for "what
// names exist" and the INTERSECTION for "what every provider grants", without re-introducing the
// default deleted.
export const REGISTER_SERVERS = {
  corsearch: { script: "corsearch-server.mjs", tools: REGISTER_TOOLS },
  // clarivate: 7 of the 8. `register_expand_phoneme` is ABSENT ON PURPOSE — the ranked-similarity
  // surface that would preview phoneme variants is not available on this provider (HTTP 403),
  // and doctrine 2 forbids stubbing it with something weaker. Phonetic SEARCH still works
  // (match_mode:"phonetic"); only the variant PREVIEW is unavailable. The gap is declared in
  // providers/clarivate/src/capabilities.js (phonemeExpansion:false) and pinned by
  // test/engine.gather.test.mjs, so it can never become a silent omission.
  clarivate: { script: "clarivate-server.mjs", tools: REGISTER_TOOLS.filter((t) => t !== "register_expand_phoneme") },
  // signa: 5 of the 8, and the grant is what the server SERVES. It was 2 until and 4 until.
  // The 2 was set on 2026-07-21 by 7ef96c7c when signa really was the thin provider — and it never
  // moved again. The five
  // commits that made it thick (4b3b59ef kernel + enumerate + execute_plan, 4a616899 the plan-vocabulary
  // deps, 3468d78c the probed capability contract) touched no file in this directory, so the row was not
  // dropped from a diff: it was never in one. `git log -L` on this line returns exactly one commit.
  //
  // WHAT THAT COST, and why the count pin did not say a word: `allowedToolsFor` is built FROM this row, so
  // the per-provider count assertion in engine.gather.test.mjs compared the table with itself and passed at
  // 2 — then DEFENDED the gap, because correcting the grant failed it. Signa was also the one provider of
  // six with no `handshake + N tools` test, so its advertisement was never compared to anything.
  // register-advertisement-vs-grant.test.mjs is the general form: every provider, discovered from this
  // table, its real `tools/list` against its resolved grant.
  //
  // PER TOOL, as every sibling entry does it:
  //   register_search / register_record_fetch — served since the thin days.
  //   register_enumerate     — SERVED and now granted.  built the page loop on the shared kernel;
  //     capabilities.js records the bounds it runs against as live-probed 2026-08-17 (pageSize 100 is the
  //     API's hard refusal, verified at 200/250/500). This is the tool 's owner-window ceiling is
  //     passed into (OWNER_SCOPED_WINDOW → ceilingFor → makeEnumerate), so withholding it put that
  //     criterion out of reach of any round.
  //   register_execute_plan  — SERVED and now granted. Two corrective-ladder hints name it unconditionally
  //     (`tool_timeout`, `named_band_missing`), so while it was withheld a repair turn on this provider was
  //     told to make a call its allowlist refused.
  //   register_propose_supplemental — SERVED as, and it is the same executor one file over. The
  //     mint is shared (mcp/supplemental.mjs); the only per-provider parts are doExecutePlan, which this
  //     server already binds for the dictated plan, and the capability contract, which the mint reads to
  //     decide what defers. Nothing new reaches the wire. While it was unwired the driver's composed prose
  //     ordered the mint UNCONDITIONALLY — `stages.mjs:2095` and `:2131` — so a signa deploy was told to
  //     make a call no server offered. Measured on  over a real signa run: the order reached three
  //     register-unit stages, no call was recorded against it, and the run still read `delivered`.
  //
  // THE OTHER THREE NEUTRAL NAMES ARE NOT SERVED BY THIS SERVER AT ALL, so they are outside the grant
  // question and outside. Each carries its reason, because an absence with no reason is a finding
  // rather than a decision:
  //   register_batch_screen  — no batch-screen surface and no clearance endpoint; `/v1/analysis/clearance`
  //     404s, stated in providers/signa.md.
  //   register_expand_phoneme — `phonemeExpansion: false` in the capability contract. READ THAT FIELD
  //     NARROWLY: it withholds the client-supplied VARIANT LIST, not phonetic search. `predicates.phonetic`
  //     is `"phonetic"`, a native ranked strategy, so a phonetic SWEEP runs here and only the variant
  //     PREVIEW is missing — the same shape as clarivate above. Reading it as "no phonetic surface" is how
  //     a copied sibling paragraph tells the seat to defer a slice this provider answers.
  //   register_image_fetch   — the tool's payload is the VIENNA figurative-element codes and a citable
  //     public page, and this provider publishes neither. Read 2026-08-22 across providers/signa/src: no
  //     vienna or figurative field anywhere in the core, the normaliser carries `imageAvailable`
  //     (`rec.has_media`) and nothing else about the mark's figure, `hasPublicRecordUrl: false` and
  //     `resolved_link: null` with "Signa exposes no per-record public URL". Serving it would return a
  //     bare boolean under a name that promises comparable figurative data. NOT A PROBE: this is a read of
  //     the code and the vendor doc in this repo, and whether the live API has an image endpoint nobody
  //     wired is UNTESTED from here — euipo's `markImage` looked equally absent until `GET
  //     /trademarks/{n}/image` answered 200, so treat this as the current best reading, not a closed
  //     question. PINNED, so this paragraph cannot outlive the facts it rests on: the arm
  //     " signa's core still carries NO figurative data" in driver/test/register-capabilities.test.mjs
  //     reds if a vienna/figurative field appears in providers/signa/src or if hasPublicRecordUrl goes
  //     true. If it reds, re-read this reason before you touch the test.
  signa:     { script: "signa-server.mjs",
    tools: ["register_search", "register_record_fetch", "register_enumerate", "register_execute_plan",
      "register_propose_supplemental"] },
  // euipo: 7 of the 8, the same count as clarivate and for the same missing tool.
  // `register_expand_phoneme` is ABSENT ON PURPOSE — there is no phonetic surface here to preview
  // variants of. `=phonetic=`, `=fuzzy=` and RSQL's own `~=` all return HTTP 400 at a valid `size`
  // (probed 2026-08-09), so unlike clarivate phonetic SEARCH is unavailable too:
  // capabilities.predicates.phonetic is null, the planner stamps the slice `unsupported`, and it
  // surfaces as a deferred coverage row rather than a contains wearing the phonetic name.
  //
  // `register_image_fetch` IS here, and was nearly dropped: the detail record's `markImage` carries
  // only {imageFormat, viennaClasses} with no bytes and no URL, which reads like an empty field.
  // `GET /trademarks/{n}/image` answers 200 with real image bytes. The tool serves the Vienna
  // figurative-element codes — the comparable data — rather than the bytes.
  euipo:     { script: "euipo-server.mjs",     tools: REGISTER_TOOLS.filter((t) => t !== "register_expand_phoneme") },
  // uspto-local: 6 of the 8, and the only provider here that is a FILE rather than an API — the guard
  // it fails on is USPTO_LOCAL_DB, not a key. Two tools are absent on purpose, neither stubbed:
  //   register_image_fetch    — the USPTO bulk product is text. It carries the drawing CODE (hence
  //     mark_feature) and not one byte of image data, so there is no weaker image to serve.
  //   register_expand_phoneme — no phonetic surface exists over a plain text column. Unlike clarivate,
  //     phonetic SEARCH is unavailable here too (capabilities.predicates.phonetic is null), so such a
  //     slice is stamped unsupported at compile time and disclosed as a deferred coverage row.
  // Both gaps are declared in providers/uspto-local/src/capabilities.js and the exact six are pinned by
  // test/engine.gather.test.mjs, so neither can become a silent omission.
  "uspto-local": { script: "uspto-local-server.mjs",
    tools: REGISTER_TOOLS.filter((t) => t !== "register_expand_phoneme" && t !== "register_image_fetch") },
  // free-tier: EUIPO + the local US index as ONE register — 7 of the 8. The surface is the UNION
  // of what its members can serve, not the intersection, because a tool one member serves is still a
  // real capability of the composite:
  //   register_image_fetch    — SERVED. EUIPO answers with image bytes; a US record refuses as a stated
  //     SOURCE LIMITATION. "The index holds no images" and "this record has no image" are different
  //     facts and the tool says which one it means.
  //   register_expand_phoneme — ABSENT, and here the intersection and the union agree: NEITHER member
  //     has a phonetic surface, so predicates.phonetic is null and a phonetic slice defers rather than
  //     degrading into a contains under the phonetic name.
  "free-tier": { script: "free-tier-server.mjs",
    tools: REGISTER_TOOLS.filter((t) => t !== "register_expand_phoneme") },
};

// ── RECORDING: THE ONE REGISTRY THE GRANT DERIVES FROM ─────────────────────────────────────────────
//
// Before this, membership in the category was written in FIVE places: the LOCAL entry, the resolveGroup
// case, the toolGroupsForStage line, RECORDING_STAGES and RECORDING_TOOLS. Three are read by the driver,
// two only by tests — and the one that DECIDED the grant was `if (name === "blind-frame")`, hardcoded in
// toolGroupsForStage, declared nowhere. So the two tables a reader would take for the category's
// definition were the two nothing in production consulted, a third conversion meant five coordinated
// edits, and no code made the fifth.
//
// Now the stage NAME is the key, and everything below derives from this: the LOCAL entries, the group
// resolution, the stage→group map, and RECORDING_STAGES. Adding a stage is one row.
//
// ONE KEY PER STAGE, and the per-stage split IS the point. A single shared `recording` key would
// enumerate every record tool into every recording stage's grant — so the second stage to convert would
// be handed `record_blind_frame` and could write blind-frame's artifact. That is the second-writer disease
// arriving as an allowlist side effect rather than as a decision, and O1's set-equality would go GREEN on
// it: a wider grant that still equals its row is precisely what O1 asks for. A guard satisfied by the
// thing it exists to catch. `group` is derived from the stage name rather than free-typed for the same
// reason — two stages could otherwise be given one key by a typo.
//
// THE KEY'S ALPHABET IS NOT THE TOOL'S. `contract-dictation-registry.mjs` parses grant tokens with
// /^mcp__[a-z0-9-]+__([a-z0-9_]+)$/ — the KEY takes hyphens and NOT underscores; the TOOL takes
// underscores and NOT hyphens. `recording_blind_frame` would have been legal in every place it is
// declared and invisible to the one registry that reads it, which reads as "this stage grants nothing".
// Read off the CONSUMER, not the declaration. A stage name carrying an underscore would produce exactly
// that key, so the derivation asserts the alphabet rather than trusting it.
//
// Both keys resolve to the ONE recording-server.mjs script: the server registers every record tool, and
// the PER-KEY tools list is what the allowlist derives from — a sibling's tool is served by the mounted
// process and uncallable by the seat. That served-vs-granted delta is deliberate, and the census pins it
// (server-tools-granted-or-stated.test.mjs: every record tool has exactly one granting stage).
const RECORDING_SERVER = "recording-server.mjs";
const RECORDING = Object.freeze({
  // FIRST OCCUPANT — blind-frame ('s transport, wired by, dictation deleted by).
  //
  // `seatWrites: false` is the half, and it is the only thing that closes the regression door BY
  // CONSTRUCTION rather than by prose. Once the driver writes blind-frame-model.json, nothing this stage is
  // ASKED to produce needs `Write` or `Edit` — and a grant that keeps carrying the hand-write tool leaves
  // the old path executable with only the prompt holding it shut, which is what e2e measured on 2e203b75:
  // a 17182B hand-written model, no call capture, on a box whose grant already carried the tool.
  //
  // THE EVIDENCE, and the cost, both stated. O3c (e2e's record, 15 attempts of this stage): 0 Bash calls,
  // and `Read`×12 / `Write`×12 — the Write being the artifact itself, which is now the driver's. `Read`
  // stays because the dispatch tells the seat to read its own skill doc. The cost: a blind-frame that ever
  // legitimately needs scratch I/O now FAILS rather than degrading. Chosen deliberately on the one stage
  // whose measured Bash use is zero, and it is the loud direction — a refusal it can see beats a silent
  // second writer.
  "blind-frame": {
    seatWrites: false,
    tools: Object.freeze(["record_blind_frame"]),
    reason: "hands back its cold threat model through record_blind_frame instead of writing "
      + "blind-frame-model.json itself; gains NO retrieval server, and loses the ambient Bash it was "
      + "measured never to use (O3c: 0 calls / 15 attempts)",
  },
  // SECOND — skeptic, same shape ( is the template). Its OWN key, so blind-frame's seat is never
  // handed record_skeptic and skeptic is never handed record_blind_frame.
  //
  // skeptic's key carries a SECOND tool: search_run_artifacts, the sanctioned read surface ('s
  // ratification hold, unlock path 1). A READ over the run's own tree, not retrieval — it dials nothing,
  // writes nothing, and is bounded to CLEAROTRON_BAND_RUN_DIR by construction (skeptic-search.mjs). It
  // replaces the artifact half of the Bash reads O3c measured; the skill-doc half was already the seeded
  // Read grant's. Skeptic-only: blind-frame's key does not carry it, and the census pins that.
  //
  // TOOL ORDER IS THE ARGV'S ORDER. `allowedToolsFor` enumerates this array into the --allowedTools
  // string, so a flip here changes the bytes the engine is handed. O1 sorts before comparing and would
  // not see it; recording-grant-preservation.test.mjs compares the string and does.
  //, second conversion — the row flipped in the same diff that deleted its dictation, which is the
  // rule the previous version of this comment stated. O3c (15 attempts of blind-frame, 11 of this stage):
  // skeptic made 7 Bash calls and ZERO writes, every one a read, and those reads have their sanctioned
  // equivalent on this same key (`search_run_artifacts`) plus the seeded `Read` for skill docs. So nothing
  // this stage does needs a writer once the driver renders skeptic-flags.md — and e2e measured what leaving
  // one buys: a hand-written file on 2e203b75 with no call capture beside it.
  // THIRD — frame-diff, and the first conversion under the sanctioned-equivalents design rather than as
  // a repair of an existing skew. Its equivalence class is 2 (run-artifact reads) and the design's ruling
  // for this stage is that the class needs no new surface here: the read set is CLOSED AND KNOWN — the
  // stage compares two files — so the dictation names the exact paths and the seeded `Read` grant carries
  // them. A `search_run_artifacts` grant would be handing a search tool to a stage whose reads are
  // enumerable, which the design forbids in as many words.
  //
  // THE COST, STATED. O3c measured 20 Bash calls with 2 WRITES across 12 attempts. The writes are the two
  // artifacts, which are now the driver's. The reads are the two input files, which `Read` serves. What
  // this stage loses that it demonstrably used is therefore nothing — but the two writes are the first
  // measured non-zero write count to convert, so an attempt that wants scratch I/O now FAILS rather than
  // degrading, and that is a first observation, not a regression.
  //
  // TWO ARTIFACTS ON ONE CALL, which no earlier row has. `frame-diff.json` is serialized and
  // `frame-diff.md` is RENDERED from the same parsed model — the stage's own contract already classifies
  // the prose `mechanical:code-rendered`, and nothing in the driver reads it.
  "frame-diff": {
    seatWrites: false,
    tools: Object.freeze(["record_frame_diff"]),
    reason: "hands back the blind-model-vs-actual-scope diff through record_frame_diff instead of writing "
      + "frame-diff.json and restating it in frame-diff.md; the driver serializes the model and renders the "
      + "prose from it. Gains NO retrieval server, and loses the ambient Bash it used to read its two input "
      + "files (O3c: 20 calls, 2 writes / 12 attempts) — those reads are enumerable and the seeded Read "
      + "grant serves them, which is why this stage gets no search tool",
  },
  // FOURTH — matter-frame, conversion 2 of the six the sanctioned-equivalents design rules. Its
  // equivalence class is 2 (run-artifact reads) and, unlike frame-diff, the reads are NOT enumerable:
  // O3c measured 21 Bash calls with 1 write across 15 attempts and the shape is `ls`/`find`/`cat` over
  // the run dir — DISCOVERY, not a known pair of files. That is exactly the line the design draws, so
  // this stage gets `search_run_artifacts` on its own key where frame-diff got only the seeded `Read`.
  //
  // THE HARDEST ARTIFACT IN THE RUN TO CONVERT, and the reason is the reader count rather than the
  // writer. `matter-context.md` is parsed by six consumers (channelsFromMatterContext,
  // meaningAnglesFromMatterContext, parseIntakeAsks, validators.matterContext, anchor-reader's bullet
  // scan, the S2 seed-neutrality scan) and handed as a dispatch INPUT to twelve downstream seats. So the
  // driver's render has to be byte-compatible with what the seat used to type, and the conversion's gain
  // is that the machine lines stop being a shape a model has to hit: they become typed values the driver
  // renders. The five matter-frame rows in `contract-e3-backlog.mjs` are the list of what that removes.
  "matter-frame": {
    seatWrites: false,
    tools: Object.freeze(["record_matter_frame", "search_run_artifacts"]),
    reason: "hands back the frame's judgment prose and its machine lines — search channels, meaning "
      + "angles, intake asks, scope — through record_matter_frame instead of hand-typing matter-context.md "
      + "to a dictated shape four parsers then re-read; the driver stamps the instructed-scope section it "
      + "already holds and renders the rest. Gains search_run_artifacts because its measured reads are "
      + "DISCOVERY over the run dir (O3c: 21 calls, 1 write / 15 attempts, `ls`/`find`/`cat`), not the "
      + "enumerable pair frame-diff's Read grant covers",
  },
  // FIFTH — prelim-variants, conversion 3. Classes 3 + 2, and the CLASS 3 half is what makes it
  // different from every conversion before it: O3c measured 9 Bash calls with 4 WRITES across 15
  // attempts, and the shape is `python3 -c` over `variant-manifest.json` — the seat PRE-CHECKING its own
  // JSON before saving it. That is a constraint the transport can check, so under the design's Class 3
  // ruling the check does not get a compute tool, it moves to the ACCEPTANCE BOUNDARY: the record tool
  // measures on accept and refuses with the measured value, and the check then runs on every call
  // instead of when a seat remembers.
  //
  // NO `search_run_artifacts`, and the design says why in as many words: this stage's inputs are
  // enumerable — it derives the manifest from material already on disk that the dictation names — so the
  // seeded `Read` grant carries them. Granting a search tool to a stage whose reads can be listed is
  // what the sanctioned-equivalents design refuses. Same ruling as frame-diff, opposite to matter-frame.
  "prelim-variants": {
    seatWrites: false,
    tools: Object.freeze(["record_prelim_variants"]),
    reason: "hands back the variant manifest — mark, dominant element, elements, variants with their "
      + "romanisations, incumbent classes, watchlist owners and the scope-ledger rows — through "
      + "record_prelim_variants instead of hand-formatting a JSON skeleton the driver already "
      + "strict-parses and a prose twin that restates it; the driver serialises variant-manifest.json, "
      + "renders variant-manifest.md, and derives scope-ledger.json from the same values rather than by "
      + "re-parsing a markdown table the seat typed. Gains NO retrieval server and NO search tool (its "
      + "inputs are enumerable and Read serves them), and loses the ambient Bash it used to "
      + "pre-validate its own JSON with (O3c: 9 calls, 4 writes / 15 attempts, `python3 -c` over "
      + "variant-manifest.json) — that check is now the record tool's, on every call",
  },
  // CONVERSION 4, and the first whose artifact a CLIENT reads. report-overview.md is the delivered
  // report's front-matter and its Actions section — assembleReportMd splices the code-built sections into
  // it and publishes the result — so this row's blast radius is a lawyer's desk, not a later stage.
  //
  // THE MEASUREMENT IS THE ARGUMENT. The stage declares SEVENTEEN contract elements and THIRTEEN are
  // already classed mechanical. Nine of the ten front-matter keys are driver facts the seat retypes, and
  // THREE of those — classes, overall_label, overall_badge — are stamped over by applyScopeFrontMatter /
  // applyVerdictFrontMatter after every assembly and after every lint-repair reassembly. The skill doc
  // annotates its own three fields as driver-replaced, in the model's own reading. The seat types nine
  // values so code can throw three of them away.
  //
  // CLASS 3 + CLASS 4, per the design's per-stage ruling. O3c measured 61 Bash calls with 8 WRITES across
  // 17 attempts — `wc -m` and `grep`-as-check over the seat's own output, a seat pre-checking the
  // constraints the validator would apply. Those checks move to the ACCEPTANCE BOUNDARY (they do not get
  // a compute tool), where they run on every call rather than when a seat remembers. The skill-doc reads
  // are Class 4 and the seeded `Read` grant already serves them.
  //
  // NO `search_run_artifacts`: the dictation names this stage's ONLY two inputs — the settled narrative
  // and findings.json — and already trimmed its declared reads to exactly those two. A read set that
  // short is enumerable by definition, and the design forbids handing a search tool to a stage whose
  // reads can be listed. Same ruling as frame-diff and prelim-variants.
  "report-overview": {
    seatWrites: false,
    tools: Object.freeze(["record_report_overview"]),
    reason: "hands back the report SHELL — the overall caption, the Actions bullets with their sources "
      + "and internal-note marks, an optional methodology note and an optional handling note — through "
      + "record_report_overview instead of typing report-overview.md's front-matter and section shapes "
      + "by hand; the driver renders the shell from those values and stamps the nine front-matter keys it "
      + "already holds, three of which it used to overwrite after the seat had typed them. Gains NO "
      + "retrieval server and NO search tool (its two declared inputs are named in the dispatch and Read "
      + "serves them), and loses the ambient Bash it used to pre-check its own output with (O3c: 61 "
      + "calls, 8 writes / 17 attempts, `wc -m` and grep-as-check) — those checks are now the record "
      + "tool's, on every call",
  },
  // CONVERSION 5 — THE FIRST FAN-OUT STAGE, and the highest-volume transport in the engine. O3c: 91 Bash
  // calls with 64 WRITES across 224 attempts, an order of magnitude past anything converted so far, and
  // the writes are the cards themselves.
  //
  // `perAxis: true` IS LOAD-BEARING, not documentation. This stage is dispatched as `report-card:<ord>`
  // (stageOnce builds `label = name + ":" + axis`), and the recording lookup is an exact `Map.get` by
  // design. Measured before the declaration existed: `report-overview` resolved its group while
  // `report-overview:2` resolved [] — a grant that exists, silently absent. Without this flag the card
  // seats would hold NO tool while their dictation ordered a call, and `toolGroupsForStage` now THROWS
  // rather than let the next fan-out conversion discover that in production.
  //
  // CLASS 1 + CLASS 4 per the design's per-stage ruling: the `mkdir -p` of its own output directory dies
  // by construction (the driver is the writer, so a seat never sees a directory again), and the skill-doc
  // reads are already the seeded `Read` grant's. No `search_run_artifacts`: this stage reads NOTHING from
  // the run — its finding arrives INLINE in the dispatch, which is the isolation the stage exists for.
  //
  // WHAT DOES NOT MOVE: the card's PROSE. Owner ruling S2 (2026-08-13) re-scoped — the mechanical
  // fields move now, the prose half waits on a side-by-side reading of one matter built both ways. The
  // transport carries the seat's bullets; it does not write them.
  "report-card": {
    seatWrites: false,
    perAxis: true,
    tools: Object.freeze(["record_report_card"]),
    reason: "hands back ONE finding's card — the `### Full detail` bullets, their optional bold lead-ins "
      + "and which of them are internal-only — through record_report_card instead of writing "
      + "report-cards/<ord>.md itself; the driver renders every line shape it used to dictate (the "
      + "one-item-per-bullet rule, the `::p::` marker position, the bold lead-in) and composes the final "
      + "`- Source:` bullet from the finding's own record rather than asking a seat to build a URL from a "
      + "host table it is not given. The card INDEX is bound by the driver and a payload naming any other "
      + "is refused, which turns O3c's measured 224/0 into a structure. Gains NO retrieval server and no "
      + "search tool (its finding arrives inline; it reads nothing), and loses the ambient Bash it used to "
      + "mkdir its own output directory with (O3c: 91 calls, 64 writes / 224 attempts)",
  },
  // EIGHTH — doubt-closure, conversion 6, and the one the corpus measurement had to clear first. This
  // row's predecessor in TOOL_FREE_STAGES said in as many words "which is why it does not convert",
  // resting on O3c's 72 Bash calls / 9 writes across 16 attempts. That string described the measurement,
  // not a ruling, and the measurement resolves the other way once you ask what the calls REACH rather
  // than how many there are. Re-measured on the wider corpus now on the box (113 calls / 19 attempts,
  // 1 attempt without a transcript — an absence, recorded as one):
  //
  //   Read x71    findings.json 34, register-findings.md 21, register-coverage-ledger.json 16 — the
  //               three citable files and NOTHING else. The seat already reads with Read today.
  //   Bash x113   102 of them name a citable file or the stage's own output. grep/head/wc — SECTION
  //               SEEKING inside those same three files.
  //   .py x3      ONE attempt of 19 wrote a scratch script. 13 lines, `open` + `print`, opening those
  //               same three files: a grep substitute over the closed evidence set, not new reach.
  //   the rest    mkdir/ls/find x11 — housekeeping, not evidence access.
  //
  // So nothing it demonstrably uses reaches outside the three files. That is frame-diff's case (reads
  // CLOSED AND KNOWN -> seeded `Read`, search tool forbidden), not matter-frame's (ls/find DISCOVERY ->
  // search_run_artifacts), and skeptic's row already ruled the seeking half: "section lookups in a file
  // the seeded Read grant serves whole". THE COST, STATED: the seat loses grep over a 48KB findings.json
  // and must take it whole. That is a context cost, not a capability loss, and it is the honest price.
  // NINTH — narrative-refutation, and the first conversion whose seat KEEPS its retrieval surface.
  //
  // The reviewer is the report's only check. Its output converts; its REACH does not. Owner ruling
  // (relayed 2026-08-26): it keeps the perplexity and band groups, because a reviewer that can only
  // compare the report against itself is a proofreader, and a prose-consistency read is the shape that
  // let the false coverage claim through. So this row states plainly what every sibling could take for
  // granted and this one cannot: THIS STAGE CONVERTS ITS OUTPUT WITHOUT CONVERTING ITS REACH. The
  // category's starvation property is not claimed here, and `recording-server.mjs`'s header — which
  // says the property holds "by CONSTRUCTION rather than by promise" — is true of its siblings and not
  // of this one. Written down rather than discovered.
  "narrative-refutation": {
    seatWrites: false,
    // THE FIRST MIXED STAGE: it records its artifact AND keeps retrieval. Declared rather than inferred,
    // because O4's partition treats "tooled" and "recording" as disjoint and that held only while every
    // recording stage carried its record tool alone. A stage may not drift into this state silently — the
    // flag is what O4 compares against, and a member that stops holding retrieval fails the reverse arm.
    keepsRetrieval: true,
    tools: Object.freeze(["record_narrative_refutation"]),
    reason: "hands back its verdict and typed flags through record_narrative_refutation instead of "
      + "writing senior-eye-review.md itself — so the enumeration style becomes the driver's and a flag "
      + "the parse cannot see stops being possible; KEEPS its perplexity and band groups, deliberately, "
      + "because verifying a record against a live source is what makes it a check",
  },
  "doubt-closure": {
    seatWrites: false,
    tools: Object.freeze(["record_doubt_closure"]),
    reason: "hands back its SETTLED/OPEN doubt verdicts and IMMATERIAL/OPEN ask verdicts as typed rows "
      + "through record_doubt_closure instead of dictating two line-forms into doubt-closure.md that two "
      + "separate parsers then re-read; the driver applies the rows and RENDERS the artifact from the same "
      + "accepted set. The anti-confabulation re-verification is UNTOUCHED — applyClosure still checks "
      + "every quote verbatim against the cited file, and the transport removes a PARSE failure, never a "
      + "verification. Gains NO retrieval server and NO search tool (its three citable files are named in "
      + "the dispatch and Read serves them whole), and loses the ambient Bash it used to seek inside those "
      + "same three files (O3c: 72 calls, 9 writes / 16 attempts; re-measured 113 / 19)",
  },
  // CONVERSION 11 — THE REGISTER FINDINGS DOCUMENT, AND THE WIDEST PARSER SURFACE IN THE RUN.
  //
  // `register-findings.md` is read by NINE parsers across driver/, mcp-server/ and driver/publish/, and
  // the reader count is the argument FOR this conversion rather than against it. Every one of them is a
  // heading / pipe-table / `/mark/…` uri scanner, and they are written that way because a model wrote
  // this file: they exist to tolerate freeform prose. A driver render satisfies them by construction.
  // Measured before the row landed, by feeding the render through the real parsers rather than by
  // reading them: parseFindingsEndings buckets the Sheet-1 uri as carried and the drop uri as a drop
  // row, parseCarrySurfaces agrees, findScreenGateParseGaps reports no gaps, and anchor-reader lifts
  // the owner and both classes out of the rendered table.
  //
  // WHY THE WRITER GOES, when register-unit's did not. That stage kept `Write` because its lane-OFF
  // branch genuinely still hand-writes the named band, so taking the tool away would break a live
  // configuration. This stage was believed to have the same shape — a no-form arm hand-writing the
  // `## Coverage ledger` table — and it does not: M6 deleted that arm on 2026-08-14. The belief
  // came from the stage's own contract-elements table, which still carries a full entry for the deleted
  // branch, because that table is a register of DECISIONS and its retired rows stay on purpose. One
  // `writeReturn`, one artifact, no surviving hand-write arm.
  //
  // THE COST, STATED, and it is the largest of any conversion so far: thirteen of the stage's twenty
  // contract elements move, and the seven that stay are the whole of its judgment — the relevance gate,
  // the opposition read, the instructed-check answers, adopt-or-override on every placement, and the
  // coverage `status`/`reason` pair that already rides `record_coverage`. What the seat loses is the
  // retyping of identifier cells, URLs, counts and audit rows out of artifacts the driver holds, plus
  // the ambient `Write` it used to author the document with. A digest that wants scratch I/O now FAILS
  // rather than degrading.
  "register-digest": {
    seatWrites: false,
    // MIXED, and declared rather than inferred — O4's partition treats "tooled" and "recording" as
    // disjoint, and a member that stops holding retrieval fails the reverse arm. This stage reads the
    // frozen band through band_shape / band_lookup / band_record to judge it, and rating frozen material
    // is what it reads WITH. It additionally holds `coverage`, which is a separate transport on its own
    // key and is untouched by this row.
    keepsRetrieval: true,
    tools: Object.freeze(["record_register_digest"]),
    reason: "hands back the findings document as typed rows and prose sections through "
      + "record_register_digest instead of authoring register-findings.md itself — so the Sheet-1 and "
      + "Sheet-2 identifier cells, the clickable record URL, the Negative-results provenance fields, the "
      + "summary counts and the audit trail are rendered FROM the band and the run's own receipts rather "
      + "than retyped out of them, and a row whose uri the band cannot resolve is refused AT THE CALL "
      + "instead of shipping as a line of blank cells. KEEPS its band group, deliberately — judging the "
      + "frozen material is what the stage is for — and keeps `coverage` on its own key: the obligation "
      + "ledger and the findings document are different statements with different writers",
  },
  skeptic: {
    seatWrites: false,
    tools: Object.freeze(["record_skeptic", "search_run_artifacts"]),
    reason: "hands back its fresh-eyes flags and escalation decisions through record_skeptic instead of "
      + "hand-writing skeptic-flags.md's machine-parsed ESCALATE lines; gains NO retrieval server, and "
      + "loses the ambient Bash it used only for reads (O3c: 7 calls, 0 writes / 11 attempts). Those "
      + "reads have a SANCTIONED equivalent: the run-artifact greps became search_run_artifacts (a "
      + "read-only, run-dir-bounded literal search on this stage's own key), and the two skill-doc reads "
      + "were section lookups in a file the seeded Read grant serves whole",
  },
  // THE WRITER, and the second conversion whose seat KEEPS its retrieval surface.
  //
  // It produces the report's substance and wrote both its artifacts as free prose. Every check on
  // either therefore ran afterwards, over text — and a prose regex cannot do that job: 31 of 32
  // positives false over the delivered corpus, and it fired on the real sentence too. The failure is
  // not sensitivity. Truth about coverage needs typed values joined to the run's own data, which is
  // what the transport's clean-claim join finally has.
  //
  // THIS STAGE CONVERTS ITS OUTPUT WITHOUT CONVERTING ITS REACH, like the reviewer beside it: it keeps
  // perplexity, band and declination. The first two are how a judgment stage reads the frozen material
  // it rates; `declination` is its own typed transport for what it does NOT deliver, and it stays a
  // separate key for the reason that still holds — one tool, one key, one holder.
  synthesis: {
    seatWrites: false,
    // MIXED, LIKE THE REVIEWER — and declared for the same reason its row gives: O4's partition treats
    // "tooled" and "recording" as disjoint, which held only while every recording stage carried its
    // record tool alone. This stage keeps perplexity, band AND declination, so it is the mixed state
    // three times over. The flag is what O4 compares against; a stage may not drift into this state
    // silently, and one that stops holding retrieval fails the reverse arm.
    keepsRetrieval: true,
    tools: Object.freeze(["record_synthesis"]),
    reason: "hands back the cross-finding narrative as typed sections and the findings record as the "
      + "values it already was, through record_synthesis, instead of authoring narrative.md and "
      + "findings.json itself — so a confirmed-clean coverage row can be joined to the plan-execution "
      + "receipt AT THE CALL and a false 'the search finished' cannot be written, rather than being "
      + "looked for in prose afterwards. KEEPS its perplexity, band and declination groups: rating "
      + "frozen material is what it reads with, and declining a record is a separate typed statement",
  },
  // ── THE FIRST KNOCKOUT ROW, AND THE FIRST perChunk ROW ( item B) ────────────────
  //
  // Every conversion before this one landed on the shared clearance pipeline, which three of the four
  // products are configurations of. Knockout is the one product on a separate lane — its own stage table,
  // pipeline, verify and publish modules — so it inherits none of that work as a side effect. This is the
  // lane's first typed return path.
  //
  // `perChunk: true` IS LOAD-BEARING AND IS WHY THIS ROW COULD NOT HAVE SHIPPED ALONE. knockout-assess is
  // ALWAYS dispatched with a chunk suffix (one call site, inside the chunk loop, always passing a chunk
  // number — even a single-chunk run is suffixed). Without the declaration the grant resolver refuses by
  // name ( built that refusal); before 2003 it returned nothing at all, silently, while
  // the dictation ordered a record call.
  //
  // THE REASON BELOW IS UNMEASURED, AND SAYS SO. Every other row cites O3c tool-use counts for its stage.
  // No such measurement can exist for this one: knockout seats hold ZERO tools today, so there is no
  // call record to count. The claim is derived from what the dictation orders, and the FIRST CONVERTED
  // RUN is its measurement — the gap is dated, not permanent, and whoever reads that run should replace
  // this sentence with the count.
  "knockout-frame": {
    seatWrites: false,
    // NO `perChunk` AND NO `perAxis`. This stage frames the whole batch in one turn, so its label carries
    // no suffix and the fan-out machinery never touches it. Stated by absence here and asserted in the
    // arms, because "not fanned" is the kind of fact that reads as an omission a year later.
    tools: Object.freeze(["record_knockout_frame"]),
    reason: "hands back the batch plan as VALUES and the scope note as one string, so the driver writes "
      + "both knockout-plan.json and knockout-frame.md. The plan's closed keys, its Nice-class arrays and "
      + "its research-key collisions are accepted or refused BY PATH at the call rather than parsed out of "
      + "a file afterwards. The note matters for a second reason: it was ordered but never checked — "
      + "koStage takes expectFile and validate from the stage's `out`, which is the PLAN, so a seat that "
      + "wrote the plan and skipped the note passed the stage and the missing document surfaced only in a "
      + "scenario run in another repo. Loses the hand-write tool: both files are the driver's now. "
      + "EXPECTED FROM THE DICTATION'S ORDERED CALLS, UNMEASURED PRE-CONVERSION — this lane's seats hold "
      + "no tools today, so the first converted run is where the count comes from",
  },
  "knockout-assess": {
    seatWrites: false,
    perChunk: true,
    tools: Object.freeze(["record_knockout_assess"]),
    reason: "hands back the per-chunk rated assessment as VALUES through record_knockout_assess instead "
      + "of writing knockout-assess-<n>.json itself, so the band, the class arrays and the typed read "
      + "(basis / factors / counterFactors / mitigation) are accepted or refused BY PATH at the call "
      + "rather than pattern-matched out of prose afterwards — the arrangement this programme exists to "
      + "replace, and the knockout lane was the last client-facing family still running it. Loses the "
      + "hand-write tool: the chunk file is the driver's now. EXPECTED FROM THE DICTATION'S ORDERED "
      + "CALLS, UNMEASURED PRE-CONVERSION — this lane's seats hold no tools today, so the first "
      + "converted run is where the count comes from",
  },
});

// stage → its server key. DERIVED, and the alphabet is checked rather than assumed: an underscore in a
// stage name would mint a key the dictation registry's grammar cannot parse, which reads as "this stage
// grants nothing" — the silent-zero this whole category is built to avoid. Throwing at import is the loud
// end of that: a bad row cannot reach a run.
function recordingKey(stage) {
  const key = `recording-${stage}`;
  if (!/^[a-z0-9-]+$/.test(key)) throw new Error(
    `[gather-config] recording stage "${stage}" mints server key "${key}", which the grant grammar in `
    + "contract-dictation-registry.mjs cannot parse — the key alphabet is [a-z0-9-] with no underscores. "
    + "Rename the stage or give it an explicit key.");
  return key;
}
// The suffix forms a dispatched label can carry, and the RECORDING flag each one requires. Kept as data
// so the two lanes' separators are readable in one place; adding a third means adding a row here AND the
// flag it needs, which is the point — a separator this table does not know falls through to `[]`.
const SUFFIX_FORMS = Object.freeze([[":", "perAxis"], ["#", "perChunk"]]);

const RECORDING_GROUPS = new Map(Object.keys(RECORDING).map((stage) => [stage, recordingKey(stage)]));
// EXPORTED for the partition check (engine.gather.test.mjs O4). O4 used to build "the recording group
// keys" as `RECORDING_STAGES.flatMap(toolGroupsForStage)` — every group any recording stage HOLDS — which
// was the same set only while recording groups were held alone. A mixed stage leaks its retrieval keys
// into it and moves ANOTHER stage's category: with `band` counted as a recording key, `placement-inquiry`
// (which holds only `band`) drops out of `tooled` into no category at all, and the guard then names the
// victim rather than the cause. These are the keys themselves, derived from RECORDING_GROUPS.
export const RECORDING_KEYS = new Set(RECORDING_GROUPS.values());
// group key -> stage. The reverse of RECORDING_GROUPS, derived from it so the two cannot disagree:
// allowedToolsFor is handed GROUPS and has to reach the stage's row to read `seatWrites`.
const RECORDING_BY_GROUP = new Map([...RECORDING_GROUPS].map(([stage, key]) => [key, stage]));

// Wrapped local servers (this build). Each entry: the server script + the tool names it exposes.
// `register` is filled in per-run from REGISTER_PROVIDER (see registerEntry below).
const LOCAL = {
  // — ONE TOOL AGAIN, and the removal is the decision. `record_dispositions` shipped here as a
  // second tool on this entry, correctly reasoned as "an allowlist growing by one token on an
  // ALREADY-TOOLED stage" — which was true about the ARGV and silent about the POPULATION. This key is
  // held by FOUR stages (common-law, common-law-half, narrative-refutation, synthesis), so enumerating a
  // record tool here handed three of them a writer into the common-law lane's disposition accumulator
  // that no doctrine ever ordered — the second-writer disease as an allowlist side effect, which is the
  // hazard the `coverage` comment below names in as many words and was not applied to this tool because
  // it was already sitting here when that ruling was written. It is `dispositions` now, one key down.
  perplexity: { script: "perplexity-server.mjs", tools: ["perplexity_research"] },
  // `euipo` is NOT here any more. It moved into REGISTER_SERVERS above, under the neutral
  // `register_*` names, because it is a register PROVIDER — selected by CLEAROTRON_DATABASE,
  // fail-closed on its credential at preflight, ledgered, and planned against a declared capability
  // contract. As a LOCAL entry it was none of those things.
  // PR-8 (reading layer): the read-only band tools — the deterministic shape, record lookups over the
  // frozen merged band, and the run's fetched official records. Every call is appended to the run's
  // _driver/reading-log.jsonl (the reading audit). Provider-neutral by construction: it serves driver
  // artifacts and never dials a vendor.
  band:       { script: "band-server.mjs",        tools: ["band_lookup", "band_record", "band_shape"] },
  // ── COVERAGE: the register-digest typed transport (B's pattern, one lane over) ───────────────────
  //
  // ITS OWN KEY, NOT A TOOL ON `band`, and the reason is the RECORDING split's own: `band` is held by
  // FOUR judgment stages, and a record tool riding that shared entry would be enumerated into every
  // holder's grant — a synthesis seat handed a writer into the digest's coverage accumulator. The
  // second-writer disease as an allowlist side effect. One tool, one key, granted by exactly one
  // stage's group list (toolGroupsForStage below).
  //
  // Like `record_dispositions` above this is an allowlist growing by one token on an ALREADY-TOOLED
  // stage — not a tool-free flip — so no argv-surface transition fires and the RECORDING tables are
  // untouched.
  coverage:   { script: "coverage-server.mjs",    tools: ["record_coverage"] },
  // ── DECLINATION: synthesis's typed transport for what it does NOT deliver ────────────────
  //
  // `coverage`'s shape exactly, and it stays its own key — but READ THE REASON, because the one this
  // comment used to give has since gone false and a stale objection reads as a live one.
  //
  // WHAT IT USED TO SAY, and why it was right at the time: the RECORDING category moves a stage's
  // ARTIFACT to the driver, every row is `seatWrites: false`, and synthesis "authors findings.json and
  // keeps authoring it" — so building declination as a RECORDING row made synthesis the first
  // `seatWrites: true` member of a table whose invariants all assume the opposite. The guards refused
  // it within one run: the corrective began naming a driver-written ledger and a hand-written
  // deliverable in one message. Neither guard was wrong; the category was.
  //
  // WHAT CHANGED: synthesis no longer authors either of its artifacts. It hands typed values through
  // `record_synthesis` and the driver renders both, so it IS a `seatWrites: false` RECORDING row now
  // and the objection above no longer describes anything. Left standing it would read as a live
  // ruling against a shape the repository has since adopted.
  //
  // WHY DECLINATION IS STILL ITS OWN KEY, on the reason that does hold: one tool, one key, granted by
  // exactly one stage's group list. It states, per record, why something that reached the findings
  // surface was not delivered — a different statement from the narrative and its findings record, and
  // a tool on a shared entry is enumerated into every holder's grant, which is the second-writer
  // disease arriving as an allowlist side effect rather than as a decision.
  //
  // So: ITS OWN KEY, one tool, granted by exactly one stage's group list — and an allowlist growing by
  // one token on an ALREADY-TOOLED stage, so no argv-surface transition fires and the RECORDING tables
  // are untouched. Not a tool on `band` (four holders) or `perplexity` (two): a record tool on a shared
  // entry is enumerated into every holder's grant, which is the second-writer disease arriving as an
  // allowlist side effect rather than as a decision.
  declination: { script: "declination-server.mjs", tools: ["record_declination"] },
  // ── DISPOSITIONS: the common-law lane's meaning-ruling transport, moved OFF the shared key ─
  //
  // `coverage`'s and `declination`'s shape, and the only one of the three that arrived by SUBTRACTION.
  // The other two were built on their own key so a record tool would never be enumerated onto a stage
  // that merely shares a retrieval server. This tool was already on `perplexity` when that rule was
  // written, so it was the one instance the rule never reached: four holders of the key, one lane's
  // doctrine ordering the tool, three seats silently granted a writer into that lane's ledger.
  //
  // GRANTED BY EXACTLY ONE LANE'S GROUP LIST — `common-law` and its `common-law-half` variant, through
  // the prefix branch in toolGroupsForStage. Every doctrinal mention of the tool is theirs:
  // driver/skills/prelim-common-law/SKILL.md and the two common-law stage dictations in stages.mjs.
  //
  // NOT an allowlist growing by a token this time: it SHRINKS synthesis's and narrative-refutation's
  // argv and RENAMES the token on common-law's (`mcp__perplexity__record_dispositions` →
  // `mcp__dispositions__record_dispositions`). That is a real argv-surface change on four stages, so it
  // ships status:merged-awaiting-e2e — the byte pins in recording-grant-preservation.test.mjs move with
  // it and no live run has exercised the new name.
  dispositions: { script: "dispositions-server.mjs", tools: ["record_dispositions"] },
  // ── UNIT-NOTE: the register unit's audit note, and the first own-key transport that MOVES an artifact ─
  //
  // `coverage`'s and `declination`'s shape, chosen for a reason those two did not have. Those stages keep
  // authoring their deliverable and gain a typed side-channel. This one's artifact — register-units/<axis>.md
  // — becomes the DRIVER's, which is the RECORDING category's own business. It is not in that category
  // because every row there declares `seatWrites: false`, and register-unit is the first stage for which
  // that is false: its dispatch's lane-OFF branch orders the seat to hand-write the named band, and that
  // branch is live for a matter with NO NICE CLASSES (no register plan compiles, so ctx.registerPlan is
  // null and the flag is absent). `band_block_unplanned` is gated on the same flag, so the validator
  // deliberately steps aside for that path rather than merely tolerating it. Taking `Write` away breaks a
  // current configuration. `seatWrites: true` INSIDE RECORDING is not the alternative — see the
  // `declination` entry above for the run in which the guards refused exactly that.
  //
  // What the artifact move needs is `toolWrittenArtifact` (gateway.mjs), which is keyed on the PATH and
  // not on category membership, so a repair naming the note is re-routed to this call rather than to the
  // write-mode tails. recording-agreement.test.mjs requires RECORDING → the artifact tables, never the
  // reverse, so the row below is free to name a tool no recording stage holds.
  //
  // ONE TOOL ON ITS OWN KEY, not on `register` — that key is the funnel's and a record tool added to it
  // would be enumerated into every register-unit seat's grant AND every other holder's. Same rule the
  // three entries above follow.
  "unit-note": { script: "unit-note-server.mjs", tools: ["record_unit_note"] },
  // ── RECORDING — DERIVED from the registry above, one entry per stage, in registry order ──────────
  //
  // These rows were hand-written here until 's collapse. They are LAST in this object on purpose:
  // LOCAL_SERVER_SCRIPTS below is `Object.values(LOCAL).map(...)`, so insertion order is part of its
  // value, and `recording-server.mjs` appearing TWICE is the evidence both keys resolve to the one
  // module. recording-grant-preservation.test.mjs pins that array verbatim, duplicates included.
  ...Object.fromEntries([...RECORDING_GROUPS].map(([stage, key]) =>
    [key, { script: RECORDING_SERVER, tools: RECORDING[stage].tools }])),
};

// The scripts LOCAL grants, DERIVED. Exported because the server census would otherwise recite them, and
// a recited list is one more population to keep in sync by hand — 's census derived the register
// half from REGISTER_SERVERS and hardcoded this half, so wiring a new local server left it reading as
// ungranted. Derive both halves or neither.
export const LOCAL_SERVER_SCRIPTS = Object.freeze(Object.values(LOCAL).map((e) => e.script));
// Case-law: the oauth-mcp-bridge spawns these (already-MCP); EUR-Lex uses claude's built-in WebFetch.
// EXPORTED since: it is also the answer to "which case-law sources does this build
// have", which `caseLawInventory` needs in order to report readiness per source. Derived from the one
// list that actually decides what gets spawned, so a source added here joins the doctor, the config
// screen and the composer's warning at the same time — the census this issue is about.
export const CASELAW_BRIDGES = ["courtlistener", "legaldatahunter"];
const CASELAW_TOOLS = ["WebFetch"]; // bridge tools are namespaced courtlistener__*/legaldatahunter__*; allowlist the whole server (see allowedToolsFor)

// The active register provider's server entry, mounted under the neutral key `register`. An unknown
// provider fails LOUDLY rather than silently dropping register search.
/**
 * THE REGISTER TOOLS THIS DEPLOYMENT'S PROVIDER DELIBERATELY DOES NOT SERVE —.
 *
 * Derived from the very table that does the excluding, so there is one definition and no second list to
 * keep in step. A tool in here is NOT a grant the engine forgot: it is a capability the active provider
 * does not have, declared in `REGISTER_SERVERS` above and again in that provider's own
 * `capabilities.js`, each with the reason written beside it.
 *
 * WHY ANYTHING NEEDS TO ASK. The ordered-but-not-granted check reads a dispatch that NAMES a tool and a
 * grant that lacks it, and calls that a disagreement — which is right when the engine forgot, and wrong
 * when the provider simply cannot serve it and the dispatch says so in the same breath. On a clarivate
 * deployment that made `register-unit` red on a configuration three layers agree about, with a message
 * asserting a behavioural defect, sending the reader hunting in a lane where nothing is wrong. CI never
 * saw it because CI runs corsearch.
 *
 * Returns an empty set when the provider is unset or unknown — never a guess, and never a throw: a
 * reporting helper that killed a run over a missing env var would be a worse defect than the one it
 * exists to describe.
 */
export function providerUnavailableRegisterTools(provider = null) {
  let p = provider;
  if (!p) { try { p = requireRegisterProvider(); } catch { return new Set(); } }
  const entry = REGISTER_SERVERS[p];
  if (!entry) return new Set();
  const served = new Set(entry.tools ?? []);
  return new Set(REGISTER_TOOLS.filter((t) => !served.has(t)));
}

function registerEntry() {
  // `|| "corsearch"` lived here too — a SECOND silent default, behind the first one, so fixing
  // driver.config alone would have left the gather stages resolving to a vendor we hold no licence
  // with. requireRegisterProvider throws instead, with the same message the driver gives.
  const p = requireRegisterProvider();
  const entry = REGISTER_SERVERS[p];
  if (!entry) throw new Error(`[gather-config] no MCP server built for REGISTER_PROVIDER="${p}" yet — wrap providers/${p}/src/core like corsearch-server.mjs (pure glue, exposing the register_* names), then add it to REGISTER_SERVERS.`);
  return entry;
}

// Resolve a local key to its {script, tools}. `register` is dynamic; everything else is static LOCAL.
function localEntry(key) {
  return key === "register" ? registerEntry() : LOCAL[key];
}

// group → { localKeys[], bridgeKeys[], extraTools[] }
function resolveGroup(group) {
  // RECORDING, derived — one branch for the category instead of one case per stage. `bridges: []` is load-
  // bearing, not boilerplate: a bridge is a WILDCARD grant, so a recording group that ever gained one
  // would hand a starved stage a whole server. The category's one provable promise is that it does not
  // widen the RETRIEVAL surface, and this empty array is where that promise is kept — for every stage in
  // the registry, including ones added after this line was written, which is the point of deriving it.
  if (RECORDING_KEYS.has(group)) return { local: [group], bridges: [], extra: [] };
  switch (group) {
    case "perplexity": return { local: ["perplexity"], bridges: [], extra: [] };
    // ── the credential-blind EUIPO attach is GONE ──────────────────────────────────────────
    // This used to read `["register", "euipo"]`, mounting the EU tools beside the paid vendor on every
    // register-unit stage — whether or not the instance held EUIPO credentials. So an instance with no
    // key looked identical to one with a key, and the missing cross-check surfaced only as a model's
    // unprompted aside in a run report (flag-snapshot.mjs records exactly that). A silent
    // capability hole wearing the costume of a model's choice.
    //
    // ORDER MATTERED, and deleting this attach alone would have been the worse bug: it was EUIPO's
    // ONLY path into a run. `euipo` was not in REGISTER_SERVERS and the `case "euipo"` branch below was
    // dead code, so removing the attach before the provider existed would have ended the EU
    // cross-check outright — on a capability production is actively using — with NOTHING representing
    // the absence, because the coverage ledger is keyed axis × jurisdiction and never by source. The
    // provider is mounted in REGISTER_SERVERS above FIRST; this line goes second.
    //
    // A paid-vendor deployment does NOT keep the EUIPO cross-check. Corsearch and Clarivate already
    // aggregate EUIPO, so the second call buys nothing and costs wall time. EUIPO reaches a run only as
    // the ACTIVE register — or as a member of the `free-tier` composite above.
    case "register":   return { local: ["register"], bridges: [], extra: [] };
    case "band":       return { local: ["band"], bridges: [], extra: [] };
    // COVERAGE. `bridges: []` is load-bearing exactly as on the recording group below: this group's
    // one promise is that it widens no retrieval surface — it carries the digest's record tool and
    // nothing else.
    case "coverage":   return { local: ["coverage"], bridges: [], extra: [] };
    // — `bridges: ` for the same load-bearing reason as its siblings: a bridge is a WILDCARD
    // grant, so an empty array here is where "this key widens no retrieval surface" is actually kept.
    case "declination": return { local: ["declination"], bridges: [], extra: [] };
    // — `bridges: ` for the third time and the same load-bearing reason: a bridge is a WILDCARD
    // grant, so the empty array is where "this key widens no retrieval surface" is actually kept. It
    // matters more here than on its siblings: this key's holder ALSO holds `perplexity`, and the whole
    // point of the split is that the transport travels without carrying any retrieval with it.
    case "dispositions": return { local: ["dispositions"], bridges: [], extra: [] };
    // — `bridges: ` for the fourth time and the same load-bearing reason: a
    // bridge is a WILDCARD grant, so the empty array is where "this key widens no retrieval surface" is
    // actually kept. It matters here for the `dispositions` reason as well as its own: this key's holder
    // ALSO holds `register`, the heaviest retrieval key in the tree, and the point of the split is that
    // the note's transport travels without carrying any of it.
    case "unit-note":  return { local: ["unit-note"], bridges: [], extra: [] };
    case "caselaw":    return { local: [], bridges: CASELAW_BRIDGES, extra: CASELAW_TOOLS };
    // RECORDING is resolved above this switch, from the registry — see the top of this function.
    default: throw new Error(`[gather-config] unknown tool group "${group}"`);
  }
}

// The mcp-config server env carries ONLY the per-run, non-secret values (session key + ledger paths +
// agent + the run dir the band tools serve). Creds (CORSEARCH_SESSION_KEY / PERPLEXITY_API_KEY /
// EUIPO_*) are inherited from the engine env.
function serverEnv({ sessionKey, agent, runDir, recordAxis }) {
  const e = {};
  // — see buildGatherMcpConfig: a register server without a run is refused there, so by the time
  // the record-log line below runs, `runDir` is present for every config that could use it.
  if (sessionKey) e.CLEAROTRON_GATHER_SESSION_KEY = sessionKey;
  if (agent) e.CLEAROTRON_GATHER_AGENT = agent;
  if (runDir) e.CLEAROTRON_BAND_RUN_DIR = runDir;   // band-server: which run's band/shape/_records to serve + where the reading log lands
  // conversion 5 — THE BOUND CARD INDEX. A fan-out recording stage writes ONE member of a
  // per-ordinal artifact, and which one is the DRIVER's answer: it knows what it fanned out. Handed to
  // the server per turn so the acceptance boundary can refuse a payload naming any other index, which
  // turns O3c's measured 224/0 habit into a structure. Absent for every non-fan-out stage.
  if (recordAxis) e.CLEAROTRON_RECORD_AXIS = String(recordAxis);
  // — the ledger paths are RESOLVED HERE and handed to the child explicitly, not forwarded as raw
  // env. Two reasons, and the second is the one that kept this rename parked for months:
  //   · the old line was `if (process.env[v]) e[v] = …`, and NO box sets those vars — prod, test and dev
  //     all run the homedir default. So it forwarded nothing, every time, and the child re-derived the
  //     path on its own. That worked only because both sides computed the same constant.
  //   · once the answer depends on which files exist, two independent derivations can disagree, and the
  //     disagreement is exactly driver-reads-new / plugin-writes-old — a run whose records are written
  //     somewhere the reader never looks. Resolving once, here, makes that unrepresentable.
  // Unconditional, so the child is never left to guess.
  e.CLEAROTRON_REGISTER_CALL_LOG = ledgerPath("call");
  // — THE RECORD LOG IS THE RUN'S, THE CALL LEDGER IS THE BOX'S, and the asymmetry is deliberate.
  // A register response body belongs to the run that fetched it and dies with that run; the call ledger
  // is billing-grade and read across runs by provider-usage.mjs. Handing the child the run's path here
  // is what stops the global file growing without bound — and the child's own module-load capture is
  // correct precisely because this server is spawned per run.
  // — THE BOX-GLOBAL FALLBACK IS GONE, AND ITS REASONING WAS BACKWARDS. It read "losing a record
  // body is worse than filing it somewhere an operator has been told about". What an operator was told
  // is docs/architecture/06-operations-runbook.md, which says the old global file "is now written by
  // nothing and read by nothing" and to archive it with an `mv` — so a body filed there is not filed
  // somewhere anyone looks. It is filed somewhere the documentation actively invites them to move.
  //
  // Nothing is dropped by omitting it either. The servers that WRITE record bodies are the register
  // providers, and those cannot be mounted without a run at all now — refused in buildGatherMcpConfig.
  // A config with no register server (perplexity, caselaw, the recording servers) never needed this
  // path, and gets no key rather than an empty one.
  if (runDir) e.CLEAROTRON_REGISTER_RECORD_LOG = runRecordLogPath(runDir);
  for (const v of ["CLEAROTRON_GATHER_SESSION_ID", "EUIPO_ENVIRONMENT"])
    if (process.env[v]) e[v] = process.env[v];
  return e;
}

// Build the mcp-config object for a set of groups. Returns { config: <object>, servers: [...] } or null if
// the groups need no MCP server (e.g. caselaw-only EUR-Lex via WebFetch needs no server but the bridges do).
export function buildGatherMcpConfig(groups = [], { sessionKey, agent, runDir, recordAxis } = {}) {
  const localKeys = new Set(), bridgeKeys = new Set();
  for (const g of groups) { const r = resolveGroup(g); r.local.forEach((k) => localKeys.add(k)); r.bridges.forEach((k) => bridgeKeys.add(k)); }
  const mcpServers = {};
  // — A REGISTER SERVER WITHOUT A RUN IS REFUSED, RATHER THAN GIVEN THE BOX-GLOBAL LEDGER.
  //
  // The register providers write record BODIES, and since a body belongs to the run that fetched
  // it. Handing them a box path when no run is known used to look like the safe side of the trade; it
  // is not. Two things make it the unsafe side:
  //
  //   · OMITTING the variable does not avoid it. `providers/_shared/ledger-path.mjs` resolves by
  //     EXISTENCE — an unset `CLEAROTRON_REGISTER_RECORD_LOG` walks four legacy candidates and lands on the
  //     same box-global file. So there is no quiet middle option here; the choice is a run path or a
  //     box path, and refusing is what removes the box path.
  //   · The runbook tells an operator that file is written by nothing and invites them to `mv` it
  //     aside. A body written there is a body the next archive step moves out from under its run.
  //
  // There is no production caller to break: `driver/gateway.mjs` is the only non-test call site in the
  // tree and it always passes the run it is dispatching for. A caller that reaches this without one has
  // a defect a refusal names immediately, instead of a record body somewhere its run will never look.
  // ORDER MATTERS: resolve the register provider FIRST. 's "CLEAROTRON_DATABASE is not set"
  // is the more fundamental refusal and the one an operator acts on, so it must still come out ahead of
  // this one — a box with neither a provider nor a run should be told about the provider.
  if (localKeys.has("register")) {
    localEntry("register");
    if (!runDir) {
      throw new Error("gather-config: a register server needs the run it is fetching for — record bodies "
        + "belong to their run since #743, and the box-global ledger is retired (#1390). Pass runDir.");
    }
  }
  const env = serverEnv({ sessionKey, agent, runDir, recordAxis });
  for (const k of localKeys) mcpServers[k] = { command: NODE, args: [join(MCP_DIR, localEntry(k).script)], env };
  // — THE BRIDGES GET THE AUDIT ENV, AND ONLY THAT. Until now they were spawned with no env at
  // all, so a case-law tool call had nowhere to log: `tool-calls.jsonl` recorded server/tool/ok and the
  // bridge could not write what was asked or what came back. That is why a cited authority and an
  // invented one left the same trace.
  //
  // A DELIBERATELY SMALLER SET THAN serverEnv. The local servers get ledger paths and a session key
  // because they do register work; a bridge proxies someone else's MCP server and needs exactly three
  // facts to write an audit line. Minimum necessary, so a bridge cannot quietly acquire reach it has no
  // use for.
  //
  // ADDITIVE, not replacing — established by the local servers above, which pass `env` AND rely on
  // inherited credentials (CORSEARCH_SESSION_KEY / PERPLEXITY_API_KEY / EUIPO_*). The bridges inherit
  // their OAuth material the same way, and that is why this may not become an exhaustive env.
  const auditEnv = {};
  if (runDir) auditEnv.CLEAROTRON_BAND_RUN_DIR = runDir;
  if (sessionKey) auditEnv.CLEAROTRON_GATHER_SESSION_KEY = sessionKey;
  if (agent) auditEnv.CLEAROTRON_GATHER_AGENT = agent;
  for (const k of bridgeKeys) mcpServers[k] = { command: NODE, args: [BRIDGE, "--server", k], connectionTimeoutMs: 60000, ...(Object.keys(auditEnv).length ? { env: auditEnv } : {}) };
  return Object.keys(mcpServers).length ? { mcpServers } : null;
}

// Stage name (or "register-unit:<axis>" etc.) → the tool groups it needs. Prefix-matched so per-axis
// register units and any followup-suffixed stage names resolve. Tool-FREE judgment stages return [] (no
// MCP servers loaded → lean context, no tool-def bloat on judgment turns).
export function toolGroupsForStage(name = "") {
  // — the disposition transport is the LANE'S, not the perplexity key's. It rode `perplexity`
  // until now, which granted it to every holder of that key; here it is named by the one lane whose
  // doctrine orders it, and the prefix carries `common-law-half` with it (the A1 split member).
  if (name.startsWith("common-law")) return ["perplexity", "dispositions"];
  // — the audit note is a typed call now (`unit-note`, own key, one tool). The
  // funnel's `register` key is UNCHANGED beside it: the band is still the tools', the note is no longer
  // the seat's, and the two are separate artifacts with separate writers. An allowlist growing by one
  // token on an already-tooled stage, so no argv-surface transition fires.
  if (name.startsWith("register-unit")) return ["register", "unit-note"];
  // PR-8 (reading layer): the band-consuming judgment stages hold the READ-ONLY band tools — the shape,
  // record lookups over the frozen band, and the run's fetched official records (band_record finally
  // feeds _records/ to judgment) — every call logged to the reading audit.
  //
  // synthesis DROPS the live register group on purpose: it never enumerated (the funnel owns that) and
  // a live search from the judgment seat is exactly the un-frozen, un-audited query the plan freeze
  // retired. A register check judgment still wants is either answerable from the frozen material (the
  // band tools) or it is NEW SEARCH WORK — and new register work enters only through the supplemental
  // mint (register_propose_supplemental in a register-unit lane / the escalation re-run), the same
  // door every other new query uses. This also ends the stages.mjs "register tools you hold" mismatch:
  // register-digest's prompt ordered live register checks while this map gave it NO register tools.
  // B's pattern, one lane over ( transport conversion): the digest additionally holds its OWN
  // record tool — coverage rulings ride `record_coverage`, never a hand-edited file. The key is the
  // digest's alone; see the LOCAL entry for why it does not ride the shared `band` key.
  //
  // ── AND THE SECOND BRANCH THAT RETURNS RETRIEVAL *AND* RECORDING (conversion 11) ─────────────────
  //
  // The third key is not optional decoration. This branch RETURNS EARLY, so a conversion that added the
  // RECORDING row and stopped would never reach the derived branch below, `recording-register-digest`
  // would never enter the resolved grant, and `recording-agreement` would fail by name at "NO
  // TOOL_WRITTEN_ARTIFACTS row names a tool this stage holds" — exactly what narrative-refutation's
  // comment below records happening to it. The key is composed the way the derived branch composes it
  // (`recording-${stage}`), so the two cannot drift into naming different servers for one stage.
  //
  // `coverage` stays beside it, unchanged and separate. The two transports state different things: the
  // coverage form is the run's obligation ledger, ruled row by row; the digest call is the findings
  // document. One tool, one key, one holder — and merging them would put a second writer into the
  // ledger the conversion took a writer out of.
  if (name.startsWith("register-digest")) return ["band", "coverage", "recording-register-digest"];
  if (name.startsWith("placement-inquiry")) return ["band"];
  // ── — THE SEED INSTANCE, RESOLVED BY GRANTING RATHER THAN BY DELETING THE ORDER ─────────────
  //
  // The stage held ["band"] while its own doctrine ordered one scoped `perplexity_research` query before
  // flagging. Two ways to make them agree, and the doc decides which: the probe is "the single place the
  // review is required to introduce evidence the upstream units did not produce", because re-reading the
  // files the author read "can only show they agree with themselves". Drop the order and the refutation
  // stage can no longer refute anything the run did not already contain — the check is removed, not the
  // mismatch. So the grant moves to meet the doctrine.
  //
  // WHAT IT COST WHILE THEY DISAGREED, measured on a delivered production run (2026-08-18): the stage ran
  // nineteen minutes under an instruction it could not execute and made zero such calls. Nothing recorded
  // a denial, because the seat never attempted a call it was not told it lacked — the silent degradation
  // the issue predicts, on the one matter where the confirmation step was most clearly indicated (four
  // `loaded` meaning rulings, see).
  //
  // This changes engine behaviour and ships `status:merged-awaiting-e2e`, which 's out-of-scope block
  // anticipates in as many words. The scoping is doctrine's, not the grant's: SKILL.md already caps it at
  // one probe per review and requires the query and its result recorded verbatim.
  // ── THE ONE BRANCH THAT RETURNS RETRIEVAL *AND* RECORDING, and it has to be here ────────────────
  //
  // Every other converted stage falls through to the derived recording branch below and gets ONLY its
  // record key. This one returns early — it keeps perplexity and band by the owner's ruling — so a
  // conversion that added the registry entry and stopped would never reach the derived branch, the
  // record tool would never enter the resolved grant, and `recording-agreement` would fail by name at
  // "NO TOOL_WRITTEN_ARTIFACTS row names a tool this stage holds". Measured: that is exactly what it
  // did before this line changed, which is the guard doing its job rather than a surprise.
  //
  // The key is composed the same way the derived branch composes it (`recording-${stage}`), so the two
  // cannot drift into naming different servers for one stage.
  if (name.startsWith("narrative-refutation")) return ["perplexity", "band", "recording-narrative-refutation"];
  // — `declination` joins synthesis's list: it states, per record, why something that reached its
  // findings surface was not delivered. A PREFIX branch because synthesis has per-pass variants
  // (`synthesis(corrective)`), and every one of them must be able to state its declines.
  // ── RETRIEVAL *AND* RECORDING, the second such branch, and it has to be here ────────────────────
  //
  // A converted stage normally falls through to the derived recording branch below and gets ONLY its
  // record key. This one returns early — it keeps perplexity, band and declination — so a conversion
  // that added the registry entry and stopped would never reach that branch, the record tool would
  // never enter the resolved grant, and `recording-agreement` would fail by name at "NO
  // TOOL_WRITTEN_ARTIFACTS row names a tool this stage holds".
  //
  // The key is composed the way the derived branch composes it, so the two cannot drift into naming
  // different servers for one stage. STILL A PREFIX: synthesis has per-pass variants
  // (`synthesis(corrective)`), and every one of them must reach both its declines and its record tool.
  if (name.startsWith("synthesis")) return ["perplexity", "band", "declination", recordingKey("synthesis")];
  if (name.startsWith("case-law")) return ["caselaw"];
  // RECORDING, DERIVED from the registry — and the exactness is now structural. Every branch above is a
  // prefix because those stages have per-axis or followup-suffixed variants; recording stages have none,
  // and a prefix here would silently hand the grant to any future stage whose name began with one. A map
  // lookup cannot be a prefix match by accident, which is a stronger guarantee than the comment that used
  // to say so. `Map.get` and not `RECORDING[name]`: an object index answers for inherited keys, so a stage
  // called `constructor` would resolve to a truthy row and mint a group from it.
  const rec = RECORDING_GROUPS.get(name);
  if (rec) return [rec];
  // ── FANNED-OUT RECORDING STAGES ( conversion 5; #-form added by) ──────────
  //
  // A fanned-out stage is dispatched under a SUFFIXED label, so the exact lookup above misses it. There
  // are two suffix forms in the tree and they are dispatched by different lanes:
  //
  //   `<name>:<axis>`   stageOnce, clearance lane      — declared by `perAxis`
  //   `<name>#<chunk>`  koStage, knockout lane         — declared by `perChunk`
  //                     (`driver/pipeline-knockout.mjs`: label = `${name}#${chunkNo}`)
  //
  // Measured before the first of these existed: `report-overview` resolved its group and
  // `report-overview:2` resolved [] — a grant that exists, silently absent, which is the catch-all's
  // silent zero arriving through the door this branch was written to shut. The `#` form was measured
  // into the same state on 2026-08-28: `#` appeared NOWHERE in this module, so
  // `knockout-assess#0` fell past both the exact lookup and the colon branch to `return []`. It had
  // never fired because no knockout stage carries a RECORDING row yet — the trap was waiting exactly
  // where the next conversion lands.
  //
  // ONE BLOCK, TWO SEPARATORS, deliberately: a second block beside the first is a second place to forget.
  // The separators keep DISTINCT declaration flags because they mean different things — a stage that fans
  // out per axis has not thereby said anything about chunks — so a row still cannot acquire a suffix form
  // it did not declare.
  //
  // NOT a prefix test, for either form. A prefix would hand the grant to any future stage whose name
  // merely began with a recording stage's. The base row must SAY it fans out — declaration, not
  // inference, the same principle as 's declared phase.
  for (const [sep, flag] of SUFFIX_FORMS) {
    const at = name.lastIndexOf(sep);
    if (at <= 0) continue;
    const base = name.slice(0, at), suffix = name.slice(at + 1);
    const row = RECORDING[base];
    if (!row || !suffix) continue;
    if (row[flag]) return [RECORDING_GROUPS.get(base)];
    // AND IT THROWS RATHER THAN RETURNING []. A recording stage that starts fanning out without
    // declaring it would otherwise grant its seats NOTHING, silently, while its dictation ordered a
    // call — the failure this whole block exists to prevent, one level down. Either silent default
    // picks a side; this one refuses to. The next fan-out conversion fails its first test run.
    //
    // THE COST, STATED, because this lane is client-facing: a throw here fires BEFORE dispatch, and a
    // knockout stage throw becomes a StageFailure and thence a failure packet — no delivered report. That
    // is correct for a MISDECLARED ROW, which is a build-time contract error CI catches, not a runtime
    // state to deliver through; the deliver-always ruling governs delivery-time guards. The arm in
    // tool-free-argv-baseline.test.mjs is what keeps this failing in CI instead of in production.
    throw new Error(
      `[gather-config] stage "${name}" resolves to recording stage "${base}", which does NOT declare `
      + `\`${flag}: true\`. A fanned-out recording stage must declare it: without the declaration its seats `
      + "resolve to no grant at all while their dictation orders a record call. Add "
      + `\`${flag}: true\` to the RECORDING row for "${base}", or stop dispatching it with "${sep}".`);
  }
  return [];
}

/**
 * The recording stage and BOUND AXIS behind a dispatched stage label, or `null`.
 *
 * ONE derivation, shared with `toolGroupsForStage` above, because the alternative is two places that
 * decide what `report-card:2` means — and the first time they disagree, a card seat gets a grant bound
 * to a different index than the one the tool enforces. DECLARED membership is the whole test here
 * too: this returns nothing for a stage that is not in the per-axis population below.
 */
/**
 * THE PER-AXIS POPULATION, DERIVED FROM BOTH CATEGORIES — one predicate, one implementation.
 *
 * A stage fans out when its dispatch label carries an index the driver chose, and the driver binds that
 * index so the tool can refuse a payload naming another. That property has nothing to do with WHICH
 * transport category a stage's record tool lives in, and until it was readable only
 * off a RECORDING row — so the first own-key transport to fan out would have resolved to no binding at
 * all while its tool waited for one. A second predicate beside this one is the shape this repo keeps
 * finding broken (two readers of the same question that can disagree), so membership gets a second
 * SOURCE rather than a second implementation.
 *
 * The RECORDING half stays derived from the frozen table. The own-key half is listed, because those
 * rows are keyed by SERVER and this question is asked about a STAGE — and a list of one is honest here
 * in a way a derivation over the wrong key would not be.
 */
const PER_AXIS_OWN_KEY = Object.freeze(["register-unit"]);
export const PER_AXIS_STAGES = Object.freeze([...new Set([
  ...Object.keys(RECORDING).filter((k) => RECORDING[k].perAxis === true),
  ...PER_AXIS_OWN_KEY,
])].sort());

// The chunk-fanned counterpart of PER_AXIS_STAGES ( item B). Derived the same way, from
// the rows that DECLARE the form — never from a name pattern.
export const PER_CHUNK_STAGES = Object.freeze(
  Object.keys(RECORDING).filter((k) => RECORDING[k].perChunk === true).sort());

const FANNED_STAGES = Object.freeze({ perAxis: PER_AXIS_STAGES, perChunk: PER_CHUNK_STAGES });

/**
 * The BOUND ORDINAL for a fanned-out recording stage: which member of a per-ordinal artifact this turn
 * is writing. The driver knows, because the driver is what fanned it out.
 *
 * ONE FUNCTION, BOTH SUFFIX FORMS, for the reason `toolGroupsForStage` gives one block to both (tracker
 * issue 2003): a second derivation beside the first is a second place to forget, and forgetting is how
 * the `#` form came to be unhandled in the first place. It walks SUFFIX_FORMS, so a separator this
 * module knows for grants is a separator it also knows for binding — the two cannot drift apart.
 *
 * NAMING DEBT, STATED RATHER THAN HIDDEN: this is called `recordAxisFor` and returns `{stage, axis}`,
 * and the env channel it feeds is `CLEAROTRON_RECORD_AXIS` — all named for the FIRST fan-out form, which was
 * per-axis. It now also carries a chunk ordinal, which is not an axis. The concept is one thing (the
 * driver's answer to "which member") and the server already calls it `boundOrdinal`, so the behaviour is
 * right and only the words are dated. Renaming touches a clearance-lane export and two callers, so it is
 * a separate tidy rather than cargo in a stage conversion; it is recorded so the next reader knows the
 * name is historical, not a claim that a chunk is an axis.
 */
export function recordAxisFor(name = "") {
  for (const [sep, flag] of SUFFIX_FORMS) {
    const at = String(name).lastIndexOf(sep);
    if (at <= 0) continue;
    const stage = String(name).slice(0, at), axis = String(name).slice(at + 1);
    if (!axis) continue;
    // A stage that did not DECLARE this form binds nothing, and falls through to the next separator
    // rather than short-circuiting — the same declaration-not-inference rule the grant resolver applies.
    if (FANNED_STAGES[flag].includes(stage)) return { stage, axis };
  }
  return null;
}

// — the stages that legitimately get NO tools, each with the reason. `return ` above is a
// CATCH-ALL: a stage this map does not name runs with no MCP servers loaded and no allowlist, and it does
// so SILENTLY — the turn simply cannot call anything, and the prompt that ordered a live check reads as a
// model that chose not to. That already shipped once (register-digest's prompt ordered live register
// checks while this map gave it no register tools — see the note above). TOOL_FREE_STAGES ∪ the tooled
// prefixes above is now a CLOSED partition of Object.keys(STAGES), asserted by engine.gather.test.mjs, so
// a new stage must state which side it is on rather than falling into the catch-all by omission.
// ── THE RECORDING CATEGORY — DECLARED, EMPTY, AND NOT YET CARRYING A STAGE ─────────────────────────
//
// The two-box model conflates two different things: "may reach the outside world" and "may hand back
// structure". A stage converted to a typed return needs the second and not the first, and today the only
// way to give it one is to move it into the box that means retrieval — which for blind-frame would
// delete the starvation the stage exists to have.
//
// MEASURED BEFORE THIS WAS ADDED, because the two-box model also over-promises: for a tool-free stage
// the driver passes NO tool arguments at all. `allowedToolsFor` is called only inside `if (groups.length)`
// (gateway.mjs), and `--allowedTools` / `--strict-mcp-config` are pushed only when truthy
// (anthropic-agent.mjs). So starvation today is the ABSENCE OF RETRIEVAL SERVERS, never a constraint on
// tools. `blind-frame`'s row used to say "makes no tool call", claiming more than anything enforced —
// that string is GONE (it converted; see RECORDING_STAGES) and every remaining row in TOOL_FREE_STAGES
// was rewritten in the same PR to state what the driver enforces rather than what the dictation asks.
// The category does not have to defend a guarantee that does not exist; it has to not WIDEN the
// retrieval surface, which is provable.
//
// NO LONGER EMPTY. A stage moves in only with its own conversion PR, citing its original tool-free
// reason and why recording preserves it — and only once the corpus measurement (O3c) shows the stage
// loses no tool it demonstrably uses. Until then this is scaffolding with its guards armed, and the
// planted-violation controls in engine.gather.test.mjs are what stop an empty set reading as a pass.
//
// NOTE THE FLIP, so it is never a side effect nobody wrote down: the first stage to enter this category
// gains `--mcp-config`, `--strict-mcp-config` AND `--allowedTools` where it previously had none. That is
// a change in KIND and the right one — these stages become constrained for the first time — but it must
// be asserted at the argv level, not inferred from this map.
// FIRST OCCUPANT — blind-frame ('s transport, wired here). SECOND — skeptic.
//
// The safety basis is a SAMPLE and is stated as one: O3c measured blind-frame at 0 Bash calls across 15
// attempts, alone among the eleven tool-free stages. That is why it converted first. On attempt 16 a
// blind-frame that wants Bash now FAILS rather than degrading — with `--allowedTools` in force it gets
// a refusal it can see, not a silent capability hole. Loud is the right direction, but a first refusal
// here is a FIRST OBSERVATION, not a regression: there has never been an attempt under a constraint
// before.
//
// skeptic is second because its measured reliance is the LIGHTEST that remains: 7 Bash calls, 0 WRITES,
// across 11 attempts — every one a READ (`grep`/`sed` over skill docs and run artifacts). Unlike
// blind-frame's zero, converting skeptic COSTS something and the cost is stated: those seven reads now
// have to go through the seat's `Read` grant or not happen. A grep it wants on attempt 12 is a refusal
// it can see, and the same first-observation caveat applies. The other six measured stages wait for
// sanctioned equivalents. (Three send stages were owner-held and unmeasured; deleted them with
// the delivery mode that was their only caller, so the measured population is the whole population.)
// DERIVED from the registry (the `reason` field), so the category's membership and its stated reasons
// cannot disagree — three test files key on this table's KEYS to decide what a recording stage is, and a
// stage present in the grant but absent here would make every one of them vacuous for it.
export const RECORDING_STAGES = Object.freeze(Object.fromEntries(
  Object.entries(RECORDING).map(([stage, r]) => [stage, r.reason])));

// PER STAGE, and each row is that stage's COMPLETE resolved argv token set — built-ins included.
//
// Not just the record tool: O1 asserts the resolved grant EQUALS its row, so pinning the whole set means
// a retrieval server added to a recording group turns O1 red. Naming only the record tool would have
// forced O1 to subtract the built-ins before comparing, and a check that subtracts before it compares has
// a blind spot the size of whatever it subtracted.
//
// `Read`/`Write`/`Edit` are seeded unconditionally by `allowedToolsFor` for stage I/O, so the seat CAN
// still write the file: the typed transport is the sanctioned path, not a physical impossibility. Stated
// rather than papered over — this category's provable promise is that it does not widen the RETRIEVAL
// surface, which is exactly what the comment above says it has to be.
//
// ── DELIBERATELY NOT DERIVED FROM THE REGISTRY, unlike the four declarations above it ──────────────
//
// 's collapse made the LOCAL entries, the group resolution, the stage→group map and RECORDING_STAGES
// derive from one registry. This table did NOT move, and the reason is the whole value of it: O1 asserts
// the resolved grant EQUALS this row. Derive it from the same registry the grant derives from and O1
// compares a value with itself — a guard turned tautology inside the PR that was meant to strengthen it.
// The census's RECORDING_GRANTS is literal for the same reason and says so in its own words. An
// INDEPENDENT expectation is the only kind a pin can be, so a new recording stage adds a row here BY HAND
// and O1's missing-row assertion is what makes forgetting loud.
export const RECORDING_TOOLS = Object.freeze({
  // — `Edit` and `Write` are GONE from this row, and the row is the pin that makes it visible. The
  // driver writes blind-frame-model.json now, so the seat holds `Read` (its skill doc) and its record tool
  // and nothing else. This is the first row in this table that is not the unconditional built-in trio.
  "blind-frame": Object.freeze(["Read", "mcp__recording-blind-frame__record_blind_frame"]),
  // BY HAND, like every row here (see the block above): O1 compares the resolved grant against this row,
  // so deriving it would compare a value with itself. matter-frame carries the search tool for the same
  // reason skeptic does, on its OWN key — a shared key would hand skeptic a writer into the frame.
  // BY HAND, like every row here — O1 compares the resolved grant against it, so a derived row would
  // compare a value with itself. prelim-variants carries NO search tool: enumerable inputs, Read serves.
  "prelim-variants": Object.freeze(["Read", "mcp__recording-prelim-variants__record_prelim_variants"]),
  "matter-frame": Object.freeze(["Read", "mcp__recording-matter-frame__record_matter_frame",
    "mcp__recording-matter-frame__search_run_artifacts"]),
  skeptic: Object.freeze(["Read", "mcp__recording-skeptic__record_skeptic",
    "mcp__recording-skeptic__search_run_artifacts"]),
  // 's third conversion. `Read` and its one record tool: the stage's reads are its two named input
  // files, which the seeded grant serves, and it gets no search tool because a stage with an enumerable
  // read set does not need one. BY HAND, like every row here — deriving it from the registry would make
  // O1 compare a value with itself.
  "frame-diff": Object.freeze(["Read", "mcp__recording-frame-diff__record_frame_diff"]),
  // Conversion 4. BY HAND, like every row here — O1 asserts the resolved grant EQUALS this row, so a
  // derived row would compare a value with itself. `Read` and its one record tool: this stage's declared
  // reads are the two files the dispatch names ( trimmed them to exactly those), which the seeded
  // grant serves, so no search tool.
  "report-overview": Object.freeze(["Read", "mcp__recording-report-overview__record_report_overview"]),
  // Conversion 5. BY HAND, like every row here. `Read` and its one record tool: this stage reads nothing
  // from the run — its finding arrives inline — so `Read` serves only its skill docs.
  "report-card": Object.freeze(["Read", "mcp__recording-report-card__record_report_card"]),
  "doubt-closure": Object.freeze(["Read", "mcp__recording-doubt-closure__record_doubt_closure"]),
  // THE FIRST KNOCKOUT-LANE CONVERSION, and the first fanned recording stage on the `#` (perChunk) form.
  // BY HAND, like every row here — O1 asserts the resolved grant EQUALS this row, so a derived row would
  // compare a value with itself.
  //
  // `Read` and its one record tool, and NO Write: the chunk artifact is the driver's now. That removal is
  // the load-bearing half on THIS lane specifically. `knockout-assess` is the stage whose seat, in 2026-08,
  // was refused Write AND the Bash redirect it had been quietly using instead, and whose corrective ladder
  // then exhausted against a dispatch ordering it to write somewhere nothing would let it. A grant that
  // still carried Write after the conversion would leave exactly that contradiction standing, one table
  // over from the fix.
  //
  // No search tool: this stage's reads are enumerable — its skill doc, the deck, the firm-wide spine, the
  // plan, and the per-mark payloads the dispatch names by path. `Read` serves all of them.
  "knockout-assess": Object.freeze(["Read", "mcp__recording-knockout-assess__record_knockout_assess"]),
  // THE LANE'S SECOND AND LAST CONVERSION. BY HAND, like every row here — O1 asserts the resolved grant
  // EQUALS this row, so a derived row would compare a value with itself.
  //
  // `Read` and its one record tool, and NO Write: both of this stage's artifacts are the driver's now.
  // No search tool — this stage FRAMES and is told in as many words that it does not search, so a
  // retrieval grant here would contradict its own dispatch. Its reads are the instructed-scope sidecar
  // and its skill doc, which the seeded Read grant serves.
  "knockout-frame": Object.freeze(["Read", "mcp__recording-knockout-frame__record_knockout_frame"]),
  // THE WRITER. BY HAND, like every row here — O1 asserts the resolved grant EQUALS this row, so a
  // derived row would compare a value with itself. This stage keeps three retrieval groups, and O1
  // compares the WHOLE grant, so they are listed: a row naming only the recording half would be a row
  // that does not describe the grant it is pinning.
  synthesis: Object.freeze([
    "Read",
    "mcp__band__band_lookup", "mcp__band__band_record", "mcp__band__band_shape",
    "mcp__declination__record_declination",
    "mcp__perplexity__perplexity_research",
    "mcp__recording-synthesis__record_synthesis",
  ]),
  // Conversion 9. BY HAND, like every row here — O1 asserts the resolved grant EQUALS this row, so a
  // derived row would compare a value with itself. The retrieval groups this stage keeps are resolved
  // separately by `toolGroupsForStage`; this row is the RECORDING half.
  // THE FIRST MIXED ROW: a recording transport held ALONGSIDE retrieval groups. O1 compares the WHOLE
  // resolved grant against this row, so the retrieval tools belong in it — writing only the recording half
  // would make O1 red on a correct grant and invite "fix" by subtraction, which is the blind spot the note
  // above this table warns about. `Write`/`Edit` are absent and that is the point of the conversion: the
  // seat hands back a record and the driver renders senior-eye-review.md.
  "narrative-refutation": Object.freeze([
    "Read",
    "mcp__perplexity__perplexity_research",
    "mcp__band__band_lookup",
    "mcp__band__band_record",
    "mcp__band__band_shape",
    "mcp__recording-narrative-refutation__record_narrative_refutation",
  ]),
  // Conversion 11 — THE THIRD MIXED ROW, and the only one holding a SECOND typed transport beside its
  // own. BY HAND, like every row here — O1 asserts the resolved grant EQUALS this row, so a derived row
  // would compare a value with itself, and O1 compares the WHOLE grant, so the retrieval and coverage
  // tools belong in it: a row naming only the recording half would go red on a correct grant and invite
  // "fix" by subtraction, which is the blind spot the note above this table warns about.
  //
  // `record_coverage` and `record_register_digest` sit side by side ON PURPOSE. They are two statements:
  // the coverage form is the run's obligation ledger, ruled row by row against the plan-execution
  // receipt; the digest call is the findings document. Folding them into one key would put a second
  // writer into the ledger the conversion took a writer out of.
  //
  // `Write`/`Edit` are absent, and that is the conversion: the seat hands back rows and prose and the
  // driver renders register-findings.md.
  "register-digest": Object.freeze([
    "Read",
    "mcp__band__band_lookup", "mcp__band__band_record", "mcp__band__band_shape",
    "mcp__coverage__record_coverage",
    "mcp__recording-register-digest__record_register_digest",
  ]),
});

// ── A6: THESE STRINGS NOW STATE WHAT IS ENFORCED, NOT WHAT IS HOPED ───────────────────────────────
//
// The old rows described a stage's INTENT ("makes no tool call"). Nothing enforced that. For a tool-free
// stage the driver passes no tool arguments at all — `allowedToolsFor` is called only inside
// `if (groups.length)` (gateway.mjs) and the flags are pushed only when truthy (anthropic-agent.mjs) — so
// what a tool-free seat actually holds is the agent's AMBIENT defaults, Bash included. O3c measured seven
// of the eight measurable ones CALLING BASH, which is what a promise nobody enforces is worth.
//
// So each row now says what the driver DOES (mounts no retrieval server) and, separately, what the seat
// can still reach anyway — a reader can tell an enforced constraint from a dictated one without leaving
// the line. `blind-frame` and `skeptic` are gone from here entirely: they are in RECORDING_STAGES above.
export const TOOL_FREE_STAGES = {
  // report-overview's row RETIRED at conversion 4 — its reason moved to RECORDING, the same move
  // skeptic's row made. The stage is no longer tool-free: it holds `Read` and its record tool, and the
  // ambient Bash this row used to record as REACHABLE is now denied by an allowlist it can see.
  // report-card's row RETIRED at conversion 5 — its reason moved to RECORDING. It is no longer tool-free:
  // it holds `Read` and its record tool, and the ambient Bash this row recorded as reachable (O3c
  // measured 91 calls, the heaviest in the corpus) is now denied by an allowlist it can see.
  // doubt-closure's row RETIRED at conversion 6 — its reason moved to RECORDING, the same move the two
  // above made. It is no longer tool-free: it holds `Read` and its record tool, and the ambient Bash this
  // row recorded as reachable (O3c: 72 calls, 9 writes, second-heaviest of the eleven) is now denied by an
  // allowlist it can see. The measurement is preserved in the RECORDING row rather than deleted — it is
  // the historical fact the argv baseline treats as unmovable, and the reason it no longer BLOCKS the
  // conversion is that the calls reach only the three files `Read` serves.
  //
  // WITH THIS ROW GONE, THE MECHANICAL SCOPE IS EMPTY: 8 of 11 converted. The three that remained were
  // the owner-held notify stages, and DELETED them rather than converting them — the delivery mode
  // that was their only caller left the product, so the population that made the scope "8 of 11" is now
  // 8 of 8. This table is empty, and empty is the finished state rather than a gap: every stage that
  // still exists either mounts a retrieval server or holds a recording transport.
};

// The allowedTools string for a set of groups: the local tool names (bare) + namespaced server allows for
// the bridges (mcp__courtlistener__* etc.) + claude built-ins (WebFetch + Read/Write/Edit for the stage I/O).
// ── — DOES THE SEAT OF THIS STAGE AUTHOR A FILE? ──────────────────────────────────────────────
//
// One derivation, two consumers. `allowedToolsFor` uses it to decide whether the hand-write tools are
// granted at all; the anthropic adapter uses it as the CROSS-CHECK on the run-dir read grant.
// It was inline in `allowedToolsFor` and is exported here rather than copied, because two readers of
// "does this seat write" that can disagree is the shape of defect this repository keeps finding.
//
// A RECORDING ROW THAT WRITES keeps the pair for the whole stage — the recording half does not get to
// starve a stage that must still author its own findings. That rule lives here now, where both callers
// get it.
//
// ✕ ONLY RECORDING ROWS VOTE, AND THAT IS A CORRECTION TO A RULE THAT HAD NEVER BEEN EXERCISED.
//
// What stood here asked `.every()` over the WHOLE group list and returned `false` for any group with no
// recording row. A retrieval group therefore counted as a writer, so a single `perplexity` or `band`
// alongside a recording group put `Write`/`Edit` back in the grant — the superseded path a conversion
// exists to close. It read as deliberate because the comment above it argued for exactly that outcome,
// and it was invisible because every recording stage until now has held its recording group ALONE:
//
//   allowedToolsFor(["recording-doubt-closure"])                     -> Read + record tool
//   allowedToolsFor(["perplexity","band","recording-doubt-closure"]) -> Read WRITE EDIT + record tool
//
// Measured on defa33c with no edits. narrative-refutation is the first stage to hold both kinds, and
// `allowedToolsFor`'s own note predicted it in as many words — "this is what makes the first one that
// appears behave correctly instead of silently". It did not behave correctly. The prediction was right
// about the moment and wrong about the outcome, which is why the note is rewritten below rather than kept.
//
// Retrieval groups author nothing, so they must ABSTAIN rather than vote "writer". `RECORDING_BY_GROUP`
// is an exact derived group→stage map for the only groups that can carry the property, so the group-keyed
// signature can still answer a stage-shaped question without guessing — and keeping the signature is what
// keeps this ONE derivation: `contract-dictation-registry.mjs:80` and `:99` call `allowedToolsFor` with no
// stage in hand (`:99` filters a group out first), so a stage-keyed signature would force a second path,
// which is the defect extracted this function to prevent.
export function seatWritesForGroups(groups = []) {
  const gs = Array.isArray(groups) ? groups : [];
  const rows = gs.map((g) => RECORDING_BY_GROUP.get(g)).filter(Boolean);
  if (!rows.length) return true;                     // no recording group ⇒ an ordinary authoring stage
  return !rows.every((stage) => RECORDING[stage].seatWrites === false);
}

/**
 * THE ENUMERATION, derived and not hand-listed ('s third proof requirement).
 *
 * A naive grep for `seatWrites: false` returns TEN hits and the population is EIGHT: two of the hits are
 * comment text — one in the blind-frame FIRST OCCUPANT note, one in `allowedToolsFor`'s own
 * paragraph. A fix sized from the grep widens itself by two stages that were never in the set.
 *
 * Reading the frozen table cannot make that mistake, and a stage joining or leaving the set moves this
 * list with it.
 */
export const SEAT_WRITE_FREE_STAGES = Object.freeze(
  Object.keys(RECORDING).filter((k) => RECORDING[k].seatWrites === false).sort(),
);

/**
 * THE MIXED CATEGORY, derived from the same table — recording stages that also hold retrieval groups.
 *
 * Every recording stage until narrative-refutation held its record tool ALONE, which made "tooled" and
 * "recording" look like disjoint categories and let O4 assert their overlap was empty. It is not a law; it
 * was a property of a population of one shape. This list is what O4 compares the overlap against now, so
 * the mixed state is entered by an edit to a row and never by drift.
 */
export const RECORDING_STAGES_KEEPING_RETRIEVAL = Object.freeze(
  Object.keys(RECORDING).filter((k) => RECORDING[k].keepsRetrieval === true).sort(),
);

export function allowedToolsFor(groups = []) {
  // — THE SEED IS NO LONGER UNCONDITIONAL. `Read` always; `Write`/`Edit` only where some group's seat
  // still authors a file. A recording row that declares `seatWrites: false` has its artifact written by the
  // driver, so the hand-write tools are a superseded path left executable — and this is the seeding that
  // made "every stage holds Read/Write/Edit" true, which is why the claim had to move here rather than into
  // a per-stage carve-out somewhere else.
  //
  // A RECORDING ROW that writes keeps the pair for the whole stage: a stage whose recording half declares
  // `seatWrites: true` must still be able to author its own findings. RETRIEVAL groups do not vote — see
  // `seatWritesForGroups`. This paragraph used to say "ANY group that writes" and predicted that the first
  // stage to hold both kinds would "behave correctly instead of silently"; narrative-refutation is that
  // stage and it did neither, keeping `Write`/`Edit` because `perplexity` and `band` were counted as
  // writers. The prediction is left here in corrected form rather than deleted — the moment it named was
  // real, and this is the line that was wrong about it.
  const tools = seatWritesForGroups(groups) ? new Set(["Read", "Write", "Edit"]) : new Set(["Read"]);
  for (const g of groups) {
    const r = resolveGroup(g);
    for (const k of r.local) localEntry(k).tools.forEach((t) => tools.add(`mcp__${k}__${t}`));
    for (const k of r.bridges) tools.add(`mcp__${k}__*`);    // whole bridge server (its tools are namespaced)
    r.extra.forEach((t) => tools.add(t));
  }
  return [...tools].join(" ");
}
