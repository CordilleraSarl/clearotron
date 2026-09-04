// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// recording-server.mjs — the seat-facing surface of the RECORDING category.
//
// ── WHAT THIS CATEGORY IS FOR, AND WHY IT IS NOT A RETRIEVAL GRANT ──────────────────────────────────
//
// The two-box model conflates "may reach the outside world" with "may hand back structure"
// (gather-config.mjs:246-268). A stage converted to a typed return needs the second and not the first.
// This server carries ONLY the second: it writes the calling stage's own artifact into the calling
// stage's own run directory, and it dials nothing.
//
// So the starvation blind-frame exists to have is meant to be preserved by CONSTRUCTION rather than by
// promise — the stage's mcp config would name this server and nothing else.
//
// ✅ THAT IS NOW A MEASURED PROPERTY, and this paragraph used to say the opposite. It read "nothing is
// wired: this module is granted to nothing and reachable by no stage" — true when written, false from the
// first conversion onward, and left standing it is the stale-comment disease in the file whose wiring it
// describes. EIGHT stages are wired here. The proof owed was the ARGV DIFFERENTIAL — before, a tool-free
// stage is passed no `--allowedTools`, no `--mcp-config` and no `--strict-mcp-config` at all ( pins
// that); after, it is passed all three, naming this server and only this server. That differential now
// exists per converted stage in tool-free-argv-baseline.test.mjs, each against its own retired row.
//
// ── THE RUN IS NOT THE SEAT'S TO NAME ───────────────────────────────────────────────────────────────
//
// `CLEAROTRON_BAND_RUN_DIR`, read at CALL TIME. `serverEnv()` (gather-config.mjs:162) sets it for every local
// server, not only band. There is no `run_dir` parameter and there must not be one — the lesson is
// 's, where an invented `CLEAROTRON_RUN_DIR` fallback sat two lines under a sentence promising the tool
// never guesses a run. Call time rather than module load: stdio-server.mjs:29-33 states why for this
// exact variable.
// ── THE SECOND CAPABILITY CLASS: A SCOPED READ, and why it does not break the sentence above ────────
//
// `search_run_artifacts` is the skeptic's sanctioned read surface ('s ratification hold, unlock
// path 1): a literal substring search over the calling run's OWN artifact tree, replacing the Bash
// reads O3c measured the stage using. It still dials nothing and writes nothing — the category's
// promise is about RETRIEVAL and writes, and a read bounded to CLEAROTRON_BAND_RUN_DIR widens neither.
// Granted under the `recording-skeptic` key only; blind-frame's process serves it unreachably, the
// same served-vs-granted delta as the record tools, pinned by the same census.
import { serve } from "./stdio-server.mjs";
import { recordSynthesis } from "../../synthesis-record.mjs";   // the writer
import { recordRegisterDigest } from "../../register-digest-record.mjs";   // conversion 11 — the findings document
import { FINDING_KEYS_CURRENT, COVERAGE_AREA_STATES } from "../../findings-model.mjs";
import { recordBlindFrame } from "../../blind-frame-record.mjs";
import { VARIANT_DIRECTIONS, RANKING_BASES } from "../../blind-frame-model.mjs";
import { recordSkeptic } from "../../skeptic-record.mjs";
import { recordFrameDiff } from "../../frame-diff-record.mjs";
import { recordMatterFrame, INTAKE_ASK_OWNERS, SCOPE_BASES } from "../../matter-frame-record.mjs";
import { recordPrelimVariants, SCOPE_LAYERS, SCOPE_STATUS } from "../../prelim-variants-record.mjs";
import { recordReportOverview } from "../../report-overview-record.mjs";
import { recordReportCard } from "../../report-card-record.mjs";      // conversion 5 — the fan-out transport
import { recordRefutation, REVIEW_VERDICTS } from "../../narrative-refutation-record.mjs";   // conversion 9
import { CORRECTION_KINDS } from "../../verify.mjs";
import { PROVIDERS, REGISTER_PROVIDER } from "../../driver.config.mjs";
// Conversion 6 — the closure transport. Built inert in and consumed here: the tool half holds the
// disk work, the call half is pure and holds the acceptance boundary. Both landed 2026-08-16 with 21 arms
// already written against them; this conversion is the consumption their headers said was still owed.
import { recordClosures } from "../../doubt-closure-tool.mjs";
import { MAX_CLOSURES_PER_CALL, CLOSURE_KINDS } from "../../doubt-closure-call.mjs";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { driverDir } from "../../../shared/driver-dir.mjs";   //
import { VARIANT_CATEGORIES } from "../../variant-manifest-model.mjs";
import { DIFF_LAYERS, DIFF_SEVERITIES } from "../../frame-diff-model.mjs";
import { REGISTER_AXES } from "../../coverage-ledger.mjs";
import { searchRunArtifacts, SEARCH_LIMITS } from "../../skeptic-search.mjs";
import { recordKnockoutAssess } from "../../knockout-assess-record.mjs";
import { recordKnockoutFrame } from "../../knockout-frame-record.mjs";

async function record_blind_frame(params) {
  const runDir = String(process.env.CLEAROTRON_BAND_RUN_DIR ?? "");
  if (!runDir) {
    return { error: "this server was started without a run — the driver wires it per run; there is no parameter for it and this tool never guesses one" };
  }
  return recordBlindFrame(runDir, params);
}

async function record_skeptic(params) {
  const runDir = String(process.env.CLEAROTRON_BAND_RUN_DIR ?? "");
  if (!runDir) {
    return { error: "this server was started without a run — the driver wires it per run; there is no parameter for it and this tool never guesses one" };
  }
  return recordSkeptic(runDir, params);
}

async function record_frame_diff(params) {
  const runDir = String(process.env.CLEAROTRON_BAND_RUN_DIR ?? "");
  if (!runDir) {
    return { error: "this server was started without a run — the driver wires it per run; there is no parameter for it and this tool never guesses one" };
  }
  return recordFrameDiff(runDir, params);
}

async function record_knockout_assess(params) {
  const runDir = String(process.env.CLEAROTRON_BAND_RUN_DIR ?? "");
  if (!runDir) {
    return { error: "this server was started without a run — the driver wires it per run; there is no parameter for it and this tool never guesses one" };
  }
  // THE BOUND CHUNK IS THE DRIVER'S AND IS READ HERE, never taken from the payload — the same rule
  // record_report_card states for its card index, and for a sharper reason on this lane: the chunk
  // assignment sidecar is what the validator joins the marks AGAINST. A chunk taken from the payload
  // would make the seat the author of the identity its own membership is checked against.
  // Absent = unbound, which the acceptance boundary refuses by name rather than defaulting to chunk 0.
  const boundChunk = String(process.env.CLEAROTRON_RECORD_AXIS ?? "");
  return recordKnockoutAssess(runDir, params, { boundOrdinal: boundChunk || null });
}

async function record_knockout_frame(params) {
  const runDir = String(process.env.CLEAROTRON_BAND_RUN_DIR ?? "");
  if (!runDir) {
    return { error: "this server was started without a run — the driver wires it per run; there is no parameter for it and this tool never guesses one" };
  }
  // NO BOUND ORDINAL HERE, and the asymmetry with record_knockout_assess one function up is the point:
  // that stage is fanned per chunk, this one frames the whole batch in a single turn. There is nothing
  // for the driver to bind, so there is nothing for a payload to usurp.
  return recordKnockoutFrame(runDir, params);
}

async function record_prelim_variants(params) {
  const runDir = String(process.env.CLEAROTRON_BAND_RUN_DIR ?? "");
  if (!runDir) {
    return { error: "this server was started without a run — the driver wires it per run; there is no parameter for it and this tool never guesses one" };
  }
  return recordPrelimVariants(runDir, params);
}

async function record_report_card(params) {
  const runDir = String(process.env.CLEAROTRON_BAND_RUN_DIR ?? "");
  if (!runDir) {
    return { ok: false, reason: "reportcard_no_run_dir: CLEAROTRON_BAND_RUN_DIR is unset — the driver sets it for every local server; a tool that guessed a run dir would write a client's card into someone else's run" };
  }
  // THE BOUND INDEX IS THE DRIVER'S AND IS READ HERE, never taken from the payload. `CLEAROTRON_RECORD_AXIS`
  // is set per turn by serverEnv from the same label the grant was resolved from, so the tool enforces
  // exactly the card the driver fanned out. Absent = unbound, which the acceptance boundary refuses by
  // name rather than defaulting to whatever the seat claimed.
  const boundOrdinal = String(process.env.CLEAROTRON_RECORD_AXIS ?? "");
  // — THE VENDOR'S LABEL IS THE RUN'S, NOT THE RECORD'S. An office named by the record
  // (`register-euipo`) reads off the record and needs nothing from here; a vendor aggregator's own name
  // is configuration, so it is handed in. Read WITHOUT the throwing accessor on purpose: an unset
  // provider must degrade this one label to a neutral word, never fail a card the seat has already
  // written. `REGISTER_PROVIDER` is a plain null-defaulting const for exactly this reason.
  const registerLabel = PROVIDERS[REGISTER_PROVIDER ?? ""]?.label ?? "";
  return recordReportCard(runDir, params, { boundOrdinal: boundOrdinal || null, registerLabel });
}

async function record_report_overview(params) {
  const runDir = String(process.env.CLEAROTRON_BAND_RUN_DIR ?? "");
  if (!runDir) {
    return { ok: false, reason: "reportoverview_no_run_dir: CLEAROTRON_BAND_RUN_DIR is unset — the driver sets it for every local server; a tool that guessed a run dir would write a client's report shell into someone else's run" };
  }
  return recordReportOverview(runDir, params);
}

async function record_matter_frame(params) {
  const runDir = String(process.env.CLEAROTRON_BAND_RUN_DIR ?? "");
  if (!runDir) {
    return { error: "this server was started without a run — the driver wires it per run; there is no parameter for it and this tool never guesses one" };
  }
  return recordMatterFrame(runDir, params);
}

const CLOSURE_SPEC = "doubt-closure-spec.json";

/**
 * Read the driver's closure spec and load the citable files' text.
 *
 * The file TEXTS are read HERE, at call time, not carried in the spec: the spec names what may be cited;
 * the content is whatever is on disk now, which is what `applyClosure` verifies against afterwards. A spec
 * carrying cached text could verify a quote against bytes the ledger no longer sees — two readers of one
 * file disagreeing is the whole failure this transport exists to remove.
 */
function loadClosureSpec(runDir) {
  const spec = JSON.parse(readFileSync(driverDir(runDir, CLOSURE_SPEC), "utf8"));
  const allowedFiles = Array.isArray(spec?.allowedFiles) ? spec.allowedFiles : [];
  const fileTexts = {};
  for (const name of allowedFiles) {
    try { fileTexts[name] = readFileSync(join(runDir, name), "utf8"); } catch { fileTexts[name] = ""; }
  }
  // `bornIn` rides the spec, not the call: it is the driver's record of which artifact minted each
  // doubt, and the seat has no business supplying it. Absent (an older run's spec) means the call-time
  // provenance check has nothing to say and applyClosure enforces it alone — see doubt-closure-call.mjs.
  return {
    runDir, allowedFiles, fileTexts,
    openIds: Array.isArray(spec?.openIds) ? spec.openIds : [],
    bornIn: (spec?.bornIn && typeof spec.bornIn === "object") ? spec.bornIn : {},
  };
}

async function record_narrative_refutation(params) {
  const runDir = String(process.env.CLEAROTRON_BAND_RUN_DIR ?? "");
  if (!runDir) {
    return { error: "this server was started without a run — the driver wires it per run; there is no parameter for it and this tool never guesses one" };
  }
  return recordRefutation(runDir, params);
}

async function record_doubt_closure(params) {
  const runDir = String(process.env.CLEAROTRON_BAND_RUN_DIR ?? "");
  if (!runDir) {
    return { error: "this server was started without a run — the driver wires it per run; there is no parameter for it and this tool never guesses one" };
  }
  let spec;
  try { spec = loadClosureSpec(runDir); }
  catch (e) { return { error: `no readable ${CLOSURE_SPEC} in this run (${String(e?.message ?? e).slice(0, 120)}) — the driver writes it before dispatching this stage` }; }
  return recordClosures(spec, params);
}

async function record_register_digest(params) {
  const runDir = String(process.env.CLEAROTRON_BAND_RUN_DIR ?? "");
  if (!runDir) {
    return { error: "this server was started without a run — the driver wires it per run; there is no parameter for it and this tool never guesses one" };
  }
  // The band index, the record host, the counts and the audit rows are read from the RUN by
  // `recordRegisterDigest` itself, out of the driver's own facts sidecar. They are not parameters and
  // there is nothing to thread here: a seat that could hand us its own record index could hand us a
  // record that is not in the band, which is the one thing the join at the acceptance boundary is for.
  return recordRegisterDigest(runDir, params);
}

async function record_synthesis(params) {
  const runDir = String(process.env.CLEAROTRON_BAND_RUN_DIR ?? "");
  if (!runDir) {
    return { error: "this server was started without a run — the driver wires it per run; there is no parameter for it and this tool never guesses one" };
  }
  // The intake asks, the plan-execution receipt and the frozen framework are read from the RUN by
  // `recordSynthesis` itself. They are not parameters and there is nothing to thread here: a seat that
  // could hand us its own receipt could waive its own coverage join.
  return recordSynthesis(runDir, params);
}

async function search_run_artifacts(params) {
  const runDir = String(process.env.CLEAROTRON_BAND_RUN_DIR ?? "");
  if (!runDir) {
    return { error: "this server was started without a run — the driver wires it per run; there is no parameter for it and this tool never guesses one" };
  }
  return searchRunArtifacts(runDir, params);
}

serve({
  name: "recording",
  tools: [{
    name: "record_blind_frame",
    description:
      "Hand back your cold threat model as VALUES. The driver serializes it and writes " +
      "blind-frame-model.json, so you never format JSON and a stray brace cannot cost the run its model. " +
      "The answer tells you what was stored, or names the exact defect token — in this turn, rather than " +
      "an attempt later through the corrective ladder.",
    inputSchema: {
      type: "object",
      required: ["dominant_element", "variants", "fields", "ranking_basis"],
      properties: {
        dominant_element: {
          type: "string",
          description: "The element the mark actually turns on, re-derived from the raw request alone.",
        },
        variants: {
          type: "array",
          description: "The neighbourhood, BOTH directions. At least one — an empty set is not a model.",
          items: {
            type: "object",
            required: ["value", "direction", "rationale"],
            properties: {
              value: { type: "string" },
              // ENUM, so `blindframe_direction_invalid` cannot arise from a typed call at all. A schema
              // that cannot express a bad value has removed the defect; a validator that rejects one has
              // only moved it.
              direction: { type: "string", enum: [...VARIANT_DIRECTIONS] },
              rationale: { type: "string", description: "One line. Why this neighbour is reachable." },
            },
          },
        },
        fields: {
          type: "array",
          description: "The field, by GOODS OVERLAP with the actual product — never by class number.",
          items: {
            type: "object",
            required: ["goods", "on_field", "rationale"],
            properties: {
              goods: { type: "string" },
              on_field: { type: "boolean", description: "Whether these goods are on the field of play." },
              rationale: { type: "string" },
            },
          },
        },
        sources: {
          type: "array",
          description: "Real channels the mark would be met on. Optional.",
          items: {
            type: "object",
            required: ["channel", "rationale"],
            properties: { channel: { type: "string" }, rationale: { type: "string" } },
          },
        },
        // ENUM for the same reason as `direction`.
        ranking_basis: { type: "string", enum: [...RANKING_BASES] },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: record_blind_frame,
  }, {
    // ── SECOND OCCUPANT — the skeptic's transport ─────────────────────────────────────────────────
    //
    // Registered on the SAME script, granted under its OWN key (`recording-skeptic`, Shape 2): the
    // server serves every record tool, and the per-key allowlist is what keeps a sibling's tool
    // uncallable — blind-frame's seat is never handed record_skeptic and vice versa. The census pins
    // that mapping (every record tool has exactly one granting stage).
    name: "record_skeptic",
    description:
      "Hand back your fresh-eyes flags and escalation decisions as VALUES. The driver renders " +
      "skeptic-flags.md — the flag bullets, the clean sentinel, and the machine-parsed ESCALATE lines " +
      "that decide which register axes are re-run — so a malformed line cannot become a silent " +
      "no-escalation. The answer tells you what was stored, or names the exact defect token in this turn.",
    inputSchema: {
      type: "object",
      required: ["flags", "escalations"],
      properties: {
        flags: {
          type: "array",
          description:
            "One entry per flag, one line each, citing the affected worker / axis / finding. An EMPTY " +
            "array IS the clean answer — it renders the \"no flags surfaced\" sentinel.",
          items: { type: "string" },
        },
        escalations: {
          type: "array",
          description:
            "One entry per register axis with a MATERIAL, unresolved, genuinely closeable gap a re-run " +
            "would actually fix. An EMPTY array renders \"ESCALATE: none\". Never escalate an axis whose " +
            "only gap is coverage-limited or a capability-gap deferral.",
          items: {
            type: "object",
            required: ["axis", "reason"],
            properties: {
              // ENUM over the full axis vocabulary — a misspelled axis, which the dictated path parses
              // as NO escalation silently, cannot arise from a typed call at all. Narrowing to the
              // run's ACTIVE axes stays the pipeline's, same as for the dictated path.
              axis: { type: "string", enum: [...REGISTER_AXES] },
              reason: { type: "string", description: "One line. Why a re-run closes this gap." },
            },
          },
        },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: record_skeptic,
  }, {
    // ── THIRD OCCUPANT — frame-diff's transport, and the first to own TWO artifacts ───────────────
    //
    // Same Shape 2 as the two above: registered on this one script, granted under its own key
    // (`recording-frame-diff`), so no sibling seat can call it. What is new is that accepting this call
    // writes `frame-diff.json` AND renders `frame-diff.md` from the same parsed model — the stage's own
    // contract already classifies the prose `mechanical:code-rendered`, and nothing in the driver
    // reads it. See frame-diff-record.mjs for why the render takes the PARSED model rather than the
    // received params.
    //
    // THE ASK CONTRACT RIDES THE REFUSAL, and that is the point of converting this stage rather than a
    // quieter one. `parseFrameDiff` collects EVERY undispatchable firing directive into one throw; the
    // seat now meets that list in the turn where restating is free, instead of at reopen with its
    // session gone. The 2026-07-29 artifact carried four offenders against a three-attempt ladder.
    name: "record_frame_diff",
    description:
      "Hand back the blind-model-vs-actual-scope diff as VALUES. The driver serializes frame-diff.json " +
      "and renders frame-diff.md from it, so you never format JSON and never write the prose twin. A " +
      "FIRING directive (severity dominant-element or material) must be dispatchable — its `item` is " +
      "itself a mark-shaped search term, or `remedy.terms` names one — and the answer names EVERY " +
      "offending directive at once, in this turn, so one restatement fixes them all. An EMPTY " +
      "`directives` array IS the clean answer: the blind model matched the actual scope.",
    inputSchema: {
      type: "object",
      // NO `dominant_element`. It was an echo of a value the driver already held two copies of,
      // and the driver PREFERRED the echo over both — so a transcription slip retargeted the spine test
      // that forces `dominant_element_gap`. `boundDominantElement` supplies it now, and the property is
      // REMOVED rather than validated: a field the schema cannot express is a defect that cannot arise.
      required: ["directives", "dominant_element_gap"],
      properties: {
        directives: {
          type: "array",
          description:
            "One entry per omission the diff found. EMPTY is valid and is the clean answer, not a gap.",
          items: {
            type: "object",
            required: ["layer", "item", "observation", "severity"],
            properties: {
              // ENUMS, so `framediff_layer_invalid` and `framediff_severity_invalid` cannot arise from a
              // typed call at all — the doubt-closure-call.mjs rule: a schema that cannot express a bad value has
              // REMOVED the defect, where a validator that rejects one has only moved it. Both tokens stay
              // reachable through the dictated path, which the archive is full of.
              layer: { type: "string", enum: [...DIFF_LAYERS] },
              item: {
                type: "string",
                description:
                  "For a FIRING variant directive this must be a mark-shaped search term (TAKIS, CORAL " +
                  "MAGIC) or carry a remedy. A label — a parenthetical, an enumeration, more than about " +
                  "four words — dispatches as a nil search that reads CLEAN, and is refused here.",
              },
              observation: { type: "string", description: "What the blind model saw that the scope did not." },
              severity: { type: "string", enum: [...DIFF_SEVERITIES] },
              remedy: {
                type: "object",
                description:
                  "What to search, when the item is not itself the term. Required in effect for a firing " +
                  "variant directive whose item is a label. The driver never guesses `term: item` — the " +
                  "asker has to say what the search IS.",
                properties: {
                  terms: { type: "array", items: { type: "string" } },
                  nice_classes: { type: "array", items: { type: "string" } },
                  regions: { type: "array", items: { type: "string" } },
                },
              },
            },
          },
        },
        // TYPED boolean, which removes `framediff_gap_invalid` the same way the enums remove their pair.
        // Deliberately REQUIRED and never defaulted: the driver re-checks this against the named dominant
        // element and forces it true on any firing on-spine directive, so a seat that omits it is making
        // no claim and must be told, not answered for.
        dominant_element_gap: {
          type: "boolean",
          description:
            "True when the dominant element is not fully enumerated. The driver holds the dominant "
            + "element itself (from the blind model) and re-checks this against it — it will not hide a "
            + "spine omission.",
        },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: record_frame_diff,
  }, {
    // ── CONVERSION 3 — THE VARIANT MANIFEST ───────────────────────────────────────────────────────
    //
    // The first converted stage that was ALREADY emitting JSON. The dictation was a literal skeleton the
    // seat hand-formatted and `parseVariantManifestModel` then strict-parsed; the schema below is that
    // same shape, typed, so the `variantmodel_*_unknown` / `_invalid` families stop being reachable from
    // a typed call at all rather than merely being caught.
    //
    // `scope_ledger` is the one genuinely new field, and it is what deletes a derivation: those rows used
    // to reach the driver only by re-parsing a markdown table out of the prose manifest.
    name: "record_prelim_variants",
    description:
      "Hand back the variant manifest as VALUES. The driver serialises variant-manifest.json, renders " +
      "variant-manifest.md and writes scope-ledger.json from what you send, so you never format JSON, " +
      "never lay out a table and never save a file. Romanisation is required on every non-Latin value " +
      "and refused on a Latin one; the whole search family must be stated, not a single row.",
    inputSchema: {
      type: "object",
      required: ["mark", "dominant_element", "elements", "variants", "scope_ledger"],
      properties: {
        mark: { type: "string", description: "The mark, verbatim as the request gave it." },
        dominant_element: { type: "string", description: "The distinctive anchor the sweep enumerates." },
        elements: {
          type: "array",
          items: {
            type: "object", required: ["value", "kind"],
            properties: {
              value: { type: "string" },
              kind: { type: "string", enum: ["distinctive", "common", "saturated-common"] },
            },
          },
        },
        variants: {
          type: "array",
          description: "The WHOLE search family — at minimum one core, one phonetic and one visual, plus a transliteration variant when any term is non-Latin.",
          items: {
            type: "object", required: ["value", "category"],
            properties: {
              value: { type: "string", description: "The search term itself — never a label, never an enumeration." },
              // THE CANONICAL ENUM, imported — never a second copy. `parseVariantManifestModel` refuses
              // anything outside it, so a hand-typed list here could drift into promising a category the
              // parser rejects. 's brief reads the same constant.
              category: { type: "string", enum: [...VARIANT_CATEGORIES] },
              rationale: { type: "string" },
              romanization: { type: "string", description: "Latin-script form. NON-LATIN VALUES ONLY — a romanisation on a Latin value is refused as an orphan." },
            },
          },
        },
        incumbent_classes: { type: "array", items: { type: "string" } },
        // — OPTIONAL, and omitting it is a real answer rather than a gap: most marks designate no
        // floor. The description says what designating one COSTS, because a field whose consequence is
        // invisible gets filled in out of politeness and then holds a run open for nothing.
        search_floor: {
          type: "array", items: { type: "string", enum: [...REGISTER_AXES] },
          description:
            "OPTIONAL. The axes this mark's search floor obliges — work a `coverage-limited` row may not " +
            "demote. Designating one means: if that axis comes back labelled an accepted limit rather " +
            "than executed, the run discloses it as an unmet floor and the axis stays escalatable. " +
            "Designate an axis only where conflict genuinely concentrates for THIS mark; omit the field " +
            "entirely when no axis is mandatory, which is the ordinary case.",
        },
        watchlist_owners: { type: "array", items: { type: "string" },
          description: "Real register owners the plan compiles owner lanes from — never sectors or descriptions." },
        scope_ledger: {
          type: "array",
          description:
            "One row per scope decision. The driver renders the ledger table AND writes scope-ledger.json " +
            "from these rows — it no longer recovers them by parsing the table back out of the prose.",
          items: {
            type: "object", required: ["layer", "item", "status"],
            properties: {
              layer: { type: "string", enum: [...SCOPE_LAYERS] },
              item: { type: "string" },
              status: { type: "string", enum: [...SCOPE_STATUS] },
              reason: { type: "string" },
              reopen_trigger: { type: "string", description: "What would reopen a dropped row." },
            },
          },
        },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: record_prelim_variants,
  }, {
    // ── CONVERSION 4 — THE REPORT SHELL, AND THE FIRST ARTIFACT A CLIENT READS ────────────────────
    //
    // The schema is deliberately SHORTER than the dictation it replaces, because most of that dictation
    // was about keys the driver already holds. Nine of the ten front-matter keys are driver facts the
    // seat used to retype — and three of them (classes, overall_label, overall_badge) were stamped over
    // by the driver after the seat had typed them, which the skill doc annotated in the model's own
    // reading. None of those nine is a field here. What the seat sends is the judgment and nothing else.
    // ── CONVERSION 11 — THE REGISTER FINDINGS DOCUMENT ───────────────────────────────────────────
    //
    // THE SCHEMA IS THE CONVERSION. Thirteen of this stage's twenty contract elements are mechanical,
    // and the way they leave is by not appearing here: there is no Mark field, no Owner, no Country,
    // no Classes, no Status, no Filed, no Expiry, no record URL, no summary count and no audit row.
    // Every one of those is rendered from the band record the `uri` names, or from the run's own
    // receipts. What a row carries is the uri that identifies it and the judgment about it.
    //
    // `uri` IS THE JOIN, AND THE JOIN IS THE CHECK. A uri no band record carries is refused by name at
    // the call. Under the old dictation the seat retyped the cells beside it, so a mistyped uri
    // produced a plausible row that failed downstream or nowhere; here it cannot be rendered at all.
    name: "record_register_digest",
    description:
      "Hand back the register findings as VALUES. The driver renders register-findings.md — the title, " +
      "the summary counts, every identifier cell, the clickable record URL, the Negative-results " +
      "provenance fields and the audit trail — so you never retype a record's fields, never lay out a " +
      "table and never save a file. Send the uri of each position that earns a row and WHY, the drops " +
      "and why, and your prose sections. Coverage rulings do NOT come here: they ride record_coverage, " +
      "row by row, exactly as before.",
    inputSchema: {
      type: "object",
      properties: {
        findings_rows: {
          type: "array",
          description:
            "Sheet 1 — one entry per POSITION that earns a row (never one per registration of the same " +
            "right). Cite any one constituent uri of the position; the driver renders the identifier " +
            "cells and the clickable URL from the band record it names.",
          items: {
            type: "object", required: ["uri", "flag_reason", "verify"],
            properties: {
              uri: { type: "string", description: "The record's `/mark/…` uri, as the band carries it. The driver joins on it; a uri the band cannot resolve is refused." },
              flag_reason: { type: "string", description: "WHY this position is risk-relevant — the judgment the row exists to carry." },
              verify: { type: "string", enum: ["yes", "no"], description: "EXACTLY one bare token: does this row still need verification against the live register?" },
            },
          },
        },
        incumbent_rows: {
          type: "array",
          description: "Sheet 2 — incumbent-context positions, same shape as findings_rows.",
          items: {
            type: "object", required: ["uri", "flag_reason", "verify"],
            properties: {
              uri: { type: "string", description: "The record's `/mark/…` uri, as the band carries it." },
              flag_reason: { type: "string", description: "WHY this position is incumbent context rather than a risk-relevant conflict." },
              verify: { type: "string", enum: ["yes", "no"], description: "EXACTLY one bare token." },
            },
          },
        },
        negative_rows: {
          type: "array",
          description:
            "Every candidate screened OUT — one entry per drop. The Notes cell's provenance (uri, " +
            "screen_verdict, class, status) is rendered from the band record, not typed: a batch-dropped " +
            "candidate with no entry here vanishes from the published audit, which is a silent recall loss.",
          items: {
            type: "object", required: ["uri", "drop_reason"],
            properties: {
              uri: { type: "string", description: "The dropped record's `/mark/…` uri." },
              drop_reason: { type: "string", description: "The one-line WHY — the judgment about THIS record. Never a bare status word." },
              ground: {
                type: "string",
                enum: ["off-field", "goods-distance", "duplicate-of-surfaced", "dead-status", "out-of-class"],
                description:
                  "REQUIRED. EXACTLY one bare token saying under WHICH RULE the drop is made — the prose " +
                  "in drop_reason says why this record, the token says under which rule. `off-field` " +
                  "(the relevance gate, on the record's own goods), `goods-distance`, " +
                  "`duplicate-of-surfaced` (the same right already has a row). `dead-status` and " +
                  "`out-of-class` name the SCREEN's own verdict and are checked against it: a record " +
                  "the band screened as a live in-scope candidate cannot be dropped on status or class, " +
                  "and that call is refused — decide it on its goods or carry it.",
              },
              variant: { type: "string", description: "OPTIONAL — the search term / variant this candidate came back on." },
            },
          },
        },
        instructed_checks: {
          type: "array",
          description:
            "One entry per requester ask this stage owns, answered from the FROZEN material. The record " +
            "ids you read are the reading audit's and are rendered for you. A check the frozen material " +
            "genuinely cannot answer is answered honestly here AND recorded as an open coverage row.",
          items: {
            type: "object", required: ["ask", "answer"],
            properties: {
              ask: { type: "string", description: "The requester's ask, as dispatched." },
              answer: { type: "string", description: "Your answer — including the honest \"the frozen material cannot answer this\"." },
            },
          },
        },
        disagreement_resolutions: {
          type: "array",
          description: "One entry per surfaced disagreement and per borderline placement — each ADOPTED or OVERRODE in writing, engaging the reason.",
          items: {
            type: "object", required: ["subject", "decision", "reason"],
            properties: {
              subject: { type: "string", description: "Which placement — the mark and, where it helps a reader, its uri." },
              decision: { type: "string", enum: ["ADOPTED", "OVERRODE"], description: "EXACTLY one bare token." },
              reason: { type: "string", description: "An override QUOTES the reason it contradicts; a kept tier still says why." },
            },
          },
        },
        patch: {
          type: "boolean",
          description:
            "OPTIONAL. true MERGES what you send onto what you already sent. Row arrays join on `uri`; " +
            "`instructed_checks` joins on `ask` and `disagreement_resolutions` on `subject`. An entry " +
            "you name replaces the one with that key, a new key is appended, and everything you do not " +
            "name comes back byte-identical — including a whole array you omit. Use it for a correction " +
            "that ADDS or CHANGES named entries. Omit it (a whole re-send) when the correction is about " +
            "which entries belong at all — a patch never DELETES anything, because dropping a finding " +
            "is a decision and it arrives where a reader can see it.",
        },
        opposition: { type: "string", description: "OPTIONAL — the opposition-history read, captured verbatim where high-signal." },
        merch_sweep: { type: "string", description: "OPTIONAL — the cross-class merchandising sweep." },
        cross_checks: { type: "string", description: "OPTIONAL — the Option-D cross-checks executed (cap N=10)." },
        open_flags: { type: "string", description: "OPTIONAL — open verification flags." },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: record_register_digest,
  }, {
    name: "record_report_overview",
    description:
      "Hand back the report SHELL as VALUES. The driver renders report-overview.md — the front-matter it " +
      "already holds, the # Actions section and the optional # Methodology note — so you never type a " +
      "front-matter key, never lay out a section and never save a file. Send the caption, the checks and " +
      "what they found, and the optional notes.",
    inputSchema: {
      type: "object",
      required: ["overall_caption"],
      properties: {
        overall_caption: {
          type: "string",
          description:
            "The WHOLE summary, ONE line, at most 3 sentences: the consequence + the finding that drives " +
            "it + the fact that conditions reliance. Facts that condition, never advice — no recommended " +
            "step, no risk codes, and never led by a coverage gap.",
        },
        actions: {
          type: "array",
          description:
            "The checks that were run and what they found — plain-English RESULTS, impersonal, one per " +
            "entry. The driver renders the heading, the sub-heading and the list; the code-built forward " +
            "asks are spliced in separately and are never yours to author.",
          items: {
            type: "object", required: ["text"],
            properties: {
              text: { type: "string", description: "The result, in one line — what was checked and how it came back." },
              source_link: { type: "string", description: "An http(s) URL for the page it came from. OMIT it when the source is a SEARCH rather than a page — a citation label in a link destination ships a link to nowhere (#875)." },
              internal: { type: "boolean", description: "true marks this an INTERNAL reviewer note; the driver renders the ::p:: marker and the client export strips it." },
            },
          },
        },
        methodology: {
          type: "string",
          description:
            "OPTIONAL plain-English scope note a reviewer needs. Never a telemetry block — no query, " +
            "fetch, variant, platform or storefront counts, no clean-check enumeration. Omit it when " +
            "there is no real scope note to make.",
        },
        handling_note: {
          type: "string",
          description: "OPTIONAL, ONE line — only when a finding rests on an adversary's public social/web profiles. Renders bold on the email cover.",
        },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: record_report_overview,
  }, {
    // ── CONVERSION 5 — ONE FINDING CARD, AND THE FIRST FAN-OUT TRANSPORT ──────────────────────────
    //
    // The schema carries the seat's JUDGMENT and nothing else. Owner ruling S2 keeps the prose the
    // model's pending a side-by-side reading, so `text` is the seat's sentence — what the driver takes
    // over is every SHAPE around it: the bullet, the bold lead-in, the `::p::` position, and the final
    // `- Source:` line, which is composed from the finding's own record rather than typed from a host
    // table the stage is not even given.
    //
    // `ordinal` is REQUIRED and is checked against the index the driver bound to this turn. It is not
    // how the tool learns which card to write — it already knows — it is how a seat that has drifted
    // onto the wrong finding is caught saying so.
    name: "record_report_card",
    description:
      "Hand back THIS finding's card as VALUES. The driver renders the `### Full detail` section, every " +
      "bullet shape, the bold lead-ins, the internal-note markers and the final Source link, and writes " +
      "the card file. You never lay out a line and never save a file. Send the ordinal you were given " +
      "and your detail bullets.",
    inputSchema: {
      type: "object",
      required: ["ordinal", "full_detail"],
      properties: {
        ordinal: {
          type: "string",
          description: "The ordinal of the finding this card is for — the one named in your dispatch. A payload naming any other card is refused: you hold no other finding's record.",
        },
        full_detail: {
          type: "array",
          description:
            "The card's analysis, ONE item per entry — filing, portfolio, risk assessment, enforcement. " +
            "Never state a registration or application number here; the driver renders it once, in the " +
            "Source line it composes from the record.",
          items: {
            type: "object", required: ["text"],
            properties: {
              text: { type: "string", description: "The item, in one line. A claim whose record basis is inferred-from-signal reads AS an inference; a verified-from-record fact stays fact." },
              lead: { type: "string", description: "One-word lead-in — \"Filing\", \"Risk assessment\", \"Enforcement\". Send the word alone; the driver renders the bold and the full stop. Optional per bullet, with ONE exception: exactly one entry carries this finding's risk read and is led \"Risk assessment\" (never \"Legal lever\"), and it is not an internal note. The report suppresses the record's own legal/practical reads wherever that bullet is present, so a card without it reaches the client with no risk read at all — the payload is refused." },
              internal: { type: "boolean", description: "true marks this an INTERNAL reviewer note; the driver renders the ::p:: marker in the position the render splits on, and the client export strips it." },
            },
          },
        },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: record_report_card,
  }, {
    // ── CONVERSION 2 — THE MATTER FRAME ───────────────────────────────────────────────────────────
    //
    // The widest-read artifact in the run: six parsers and twelve downstream seats. The driver renders
    // every line of it from these values, so the shapes those parsers anchor on stop being shapes a model
    // has to hit. What stays the seat's is the judgment — `prose_body`, the angles, the asks, the scope
    // reasoning. What the driver stamps is `## Instructed scope`, which the seat used to retype out of a
    // file the driver itself wrote at intake.
    //
    // NO `instructed_scope` PROPERTY, deliberately, and it is the rule one stage over: a field the
    // schema cannot express is a defect that cannot arise. The retyping loop it removes is the one
    // `frame_scope_missing` existed to police.
    name: "record_matter_frame",
    description:
      "Hand back the matter frame as VALUES. The driver renders matter-context.md from them — including " +
      "the `Search channels:` and `Meaning angles:` lines and the `### Intake asks` section, which twelve " +
      "downstream stages and six parsers read — so you never format a line shape and never save a file. " +
      "The instructed scope is stamped by the driver from its own intake record and is not yours to send.",
    inputSchema: {
      type: "object",
      required: ["prose_body", "scope_basis", "search_channels", "meaning_angles", "intake_asks"],
      properties: {
        prose_body: {
          type: "string",
          description:
            "The commercial read of the matter, in prose: client, sector, product description, customer " +
            "base, channels of trade, off-field sectors, sector-convergence flags, watchlist-owner seeds, " +
            "the scope reasoning, the class scope and adjacency call, the applicant's own and affiliated " +
            "marks, and any inferred campaign shape (labelled as an inference). Rendered verbatim.",
        },
        scope_basis: { type: "string", enum: [...SCOPE_BASES] },
        scope_jurisdictions: { type: "array", items: { type: "string" },
          description: "The territories in scope." },
        excluded_jurisdictions: { type: "array", items: { type: "string" },
          description: "Territories deliberately scoped OUT, each with its reopen trigger stated in prose_body." },
        search_channels: {
          type: "array", items: { type: "string" },
          description:
            "DOMAINS only (amazon.com, fda.gov) — the common-law grid site-restricts to them and the " +
            "general web is always added by the driver. Reasoned from THIS matter's vertical, never a " +
            "fixed list. A non-domain value is kept in the record and dropped by the grid.",
        },
        meaning_angles: {
          type: "array", items: { type: "string" },
          description:
            "3-8 short web-search queries, each anchored on the mark's element(s): the cultural origin " +
            "and communities the word evokes, charged historical or political associations, " +
            "category-specific controversy for these goods. Every one is executed and receipted.",
        },
        // AN ASSERTED ZERO IS ITS OWN FIELD, never an inference from an empty array. "This mark is coined
        // and has no semantic field" and "the seat did not answer" are different facts, and an empty array
        // cannot tell them apart — CHANNEL_STATES in scope-ledger.mjs is this codebase learning that once
        // already. Sending both, or neither, is refused.
        meaning_angles_none: {
          type: "boolean",
          description:
            "True ONLY for a coined term with no real-word semantic field to probe, sent with an empty " +
            "meaning_angles array. This is an asserted zero, not an omission.",
        },
        intake_asks: {
          type: "array",
          description:
            "One row per EXPLICIT check the requester asked for. EMPTY is valid and IS the answer when " +
            "the request contains none beyond the clearance itself — the driver renders `none stated`.",
          items: {
            type: "object",
            required: ["ask", "owner"],
            properties: {
              ask: { type: "string", description: "The requester's own words, quoted verbatim." },
              owner: { type: "string", enum: [...INTAKE_ASK_OWNERS],
                description: "The layer that will execute it." },
            },
          },
        },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: record_matter_frame,
  }, {
    // ── THE SKEPTIC'S SANCTIONED READ SURFACE ─────────────────────────────────────────────────────
    //
    // Serves what O3c measured the stage's ambient Bash doing and nothing wider: literal-token,
    // grep -n -i-shaped search over the run's own artifacts. Scope, bounds and refusal tokens live in
    // skeptic-search.mjs; this handler only wires the run dir, same contract as the record tools.
    name: "search_run_artifacts",
    description:
      "Search ONE of this run's own artifacts (e.g. register-findings.md, common-law-findings.md) for " +
      "literal substrings — like grep -n -i. `terms` are OR-matched per line, case-insensitive unless " +
      "case_sensitive is true, and are LITERALS, never regex (a dot matches a dot). The answer carries " +
      `1-based line numbers, is capped at ${SEARCH_LIMITS.maxMatches} matches and says when it truncated. ` +
      "Read-only and scoped to this run's directory: absolute paths, .. and _driver/ are refused by " +
      "name. Found-nothing is an answer (total_matches: 0 with lines_scanned) — treat an expected token's " +
      "absence as a finding.",
    inputSchema: {
      type: "object",
      required: ["file", "terms"],
      properties: {
        file: {
          type: "string",
          description: "Path RELATIVE to the run directory, e.g. \"register-findings.md\". One file per call; no listings.",
        },
        terms: {
          type: "array",
          items: { type: "string" },
          description: `1-${SEARCH_LIMITS.maxTerms} literal substrings, OR-matched per line. One line of the file matches if ANY term occurs in it.`,
        },
        case_sensitive: {
          type: "boolean",
          description: "Default false — matching is case-insensitive like grep -i.",
        },
      },
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: search_run_artifacts,
  }, {
    // ── NINTH — narrative-refutation, and the first whose seat KEEPS its retrieval surface ──────────
    //
    // The reviewer is the report's only check, and it wrote its own review as prose. Everything
    // downstream then parsed that prose back: the verdict token, the flag list, the `[kind:]`/`[on:]`
    // channels, and the count that decides whether a BLOCKING is degenerate. The seat chose the
    // enumeration style, so the parse could miss it — 's lettered flags were invisible
    // for exactly that reason. Handing values makes the style the driver's, so a flag the parse cannot
    // see stops being possible rather than being detected afterwards.
    //
    // THIS STAGE CONVERTS ITS OUTPUT WITHOUT CONVERTING ITS REACH. It keeps the perplexity and band
    // groups by the owner's ruling: a reviewer that can only compare the report against itself is a
    // proofreader, and a prose-consistency read is the shape that let the false coverage claim through.
    // So this server's header — "starvation preserved by CONSTRUCTION" — is true of the eight siblings
    // and NOT of this one. Said here rather than left for a reader to discover.
    name: "record_narrative_refutation",
    description:
      "Hand back your verdict and your flags as VALUES. The driver renders senior-eye-review.md — the " +
      "verdict line, each flag with its kind and the finding it is about, and the plan-execution audit — " +
      "so a flag the corrective ladder cannot parse cannot be written. The answer tells you what was " +
      "stored, or names the exact defect token in this turn.",
    inputSchema: {
      type: "object",
      required: ["verdict", "flags"],
      properties: {
        verdict: {
          type: "string", enum: [...REVIEW_VERDICTS],
          description: "Your verdict. BLOCKING requires at least one flag — a refusal to sign that names nothing is refused here rather than at the gate, where its only repair is one forced re-ask of this whole stage.",
        },
        flags: {
          type: "array",
          description: "One entry per flag. An EMPTY array is the clean answer and is only valid on CLEAR or CONDITIONAL. You do NOT number them: render order is the numbering, so a number cannot disagree with the list it labels.",
          items: {
            type: "object",
            required: ["kind", "text"],
            properties: {
              kind: { type: "string", enum: [...CORRECTION_KINDS], description: "Which kind of defect this is. You declare it from your own read; code only partitions the closed set, never a keyword grep over your prose." },
              text: { type: "string", description: "One line, naming the file and the exact claim. A flag that opens as a list item or heading is refused — the driver renders the list." },
              fix: { type: "string", description: "Optional. One line describing the targeted edit that would settle it." },
              on: { type: "array", items: { type: "integer" }, description: "The finding ordinals this flag is about, 1-based. Omit for a flag about the document rather than a finding." },
            },
          },
        },
        plan_audit: {
          type: "array", items: { type: "string" },
          description: "The PLAN-EXECUTION CHECK lines. REQUIRED when this run has a plan-execution receipt — the driver reads whether it does, so you cannot waive your own audit by omitting this.",
        },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: record_narrative_refutation,
  }, {
    name: "record_doubt_closure",
    description:
      "Record your closure verdicts as VALUES. The driver applies them to the ledgers and renders the " +
      "artifact, so you never type a line-form and a stray quote character cannot cost you a settlement. " +
      "One call carries a batch; the answer tells you what was accepted, what was refused and why, and " +
      "which of your ids are still open. A refusal is actionable inside this turn. Your quote is checked " +
      "against the cited file NOW — the driver re-checks it verbatim afterwards either way, so a stretched " +
      "citation never becomes a settlement, it just costs you the row.",
    inputSchema: { type: "object", required: ["closures"], properties: {
      closures: {
        type: "array",
        description: `Up to ${MAX_CLOSURES_PER_CALL} rows per call. Send more in a further call; every accepted row is kept — a refused row never voids its neighbours.`,
        items: { type: "object", required: ["kind", "doubt_id", "verdict"], properties: {
          kind: { type: "string", enum: [...CLOSURE_KINDS], description: "Which ledger this row speaks to. The two vocabularies are not interchangeable." },
          doubt_id: { type: "string", description: "The id exactly as your open list gives it. An id you were not given is refused — you cannot speak about a doubt or ask this run did not hand you." },
          verdict: { type: "string", description: "A doubt is settled|open. An ask is immaterial|open. You can NEVER mark an ask executed: execution is computed by code from the plan-execution record, never asserted." },
          file_index: { type: "integer", description: "The POSITION of the evidence file you are citing, in the list this tool's answer names. There is no field for a file NAME — a file you were not given cannot be expressed." },
          quote: { type: "string", description: "Copied EXACTLY from that file. Checked against it now, so you learn in this turn rather than three attempts later." },
          reason: { type: "string", description: "One line. On a settled doubt, an immaterial ask, or an open doubt." },
          handoff: { type: "string", description: "On an OPEN ASK only, and required there: this REPLACES the ask's standing handoff, so it is what the reviewing lawyer reads. Not commentary." },
        } },
      },
    } },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: record_doubt_closure,
  }, {
    // ── THE WRITER, and the second tool here whose seat keeps its retrieval surface ────────────────
    //
    // It produces the report's substance and wrote both its artifacts as free prose, so every check on
    // either ran afterwards over text. A prose regex cannot do that job — 31 of 32 positives false over
    // the delivered corpus, and it fired on the real sentence too. Handing values lets the clean-claim
    // join run against the run's own plan-execution receipt AT THE CALL.
    //
    // The per-finding write-ups are deliberately NOT a field here. That direction was ruled against by
    // the owner: report-card holds the single authored wording. See synthesis-record.mjs' header.
    name: "record_synthesis",
    description:
      "Hand back your cross-finding narrative as SECTIONS and your findings as the record they already " +
      "are. The driver renders narrative.md and findings.json. Your coverage rows are joined to this " +
      "run's plan-execution receipt as you send them, so a clean claim over a slice that did not run is " +
      "refused here — in this turn, where restating it is free — rather than at a gate that can only " +
      "re-ask the whole stage. The answer tells you what was stored, or names the exact defect token.",
    inputSchema: {
      type: "object",
      // ── NO BLANKET `required`, AND THAT IS THE FIX FOR ─────────────────────────
      //
      // This said `required: ["narrative", "findings"]` and declared no `findings_patch`. Meanwhile all
      // three repair composers instruct the seat, verbatim, to "send the correction with
      // `record_synthesis`: a PATCH call carrying `findings_patch` … AND NOTHING ELSE".
      //
      // Those two cannot both be satisfied, and the transport detects a patch by exactly the absence
      // this schema forbade — `received.findings === undefined || received.narrative === undefined`. So
      // NO SCHEMA-CONFORMING CALL COULD EVER BE A PATCH, and `mergeSynthesisPatch` — the ordinal
      // replacement, the carry-through of every key the seat does not name, the whole "what you do not
      // name comes back byte-identical" promise the prompt makes — was unreachable in production.
      //
      // MEASURED, on the 2026-08-27 R2 run: `findings` is the only object here with no declared
      // properties, so it is the one place an undeclared key can ride and still conform. The seat put
      // `findings_patch` inside it, which made the call carry both halves, which made it NOT a patch.
      // The merge never ran, the stray key reached the parser, and the call was refused
      // `findings_key_unknown:findings_patch`. The seat then complied the only way left — a whole
      // document holding the four findings it had corrected. Fifteen went. It validated, so nothing
      // downstream fired.
      //
      // WHY NOT ADD THE KEY TO THE VALIDATOR INSTEAD, which was the first fix proposed: because that
      // makes the malformed document VALIDATE. The merge would still never run and the fifteen findings
      // would still be gone, now behind a green. The refusal was doing its job; the shape reaching it
      // was the defect.
      //
      // A FIRST CALL STILL CANNOT SEND A PATCH, and it needs no `required` to say so: a patch with
      // nothing to patch is refused by name in the transport as `synthesis_patch_without_base`, which
      // reads the run's own accepted-call record rather than trusting the shape. That check is older
      // than this change and is the reason relaxing `required` costs nothing.
      properties: {
        findings_patch: {
          type: "array",
          description:
            "A TARGETED CORRECTION, and the shape the repair prompts ask for. Send the complete corrected finding object(s), each carrying the `ordinal` of the finding it replaces, and send NOTHING else — no `findings`, no `narrative` unless you also corrected a section. The driver is holding every value you already sent and re-renders both files from them, so what you do not name comes back byte-identical. It cannot remove a finding: an ordinal names one to replace, and there is no way to express a deletion. Sending the whole `findings` document instead REPLACES the record, which is how fifteen findings were lost once — if you mean to correct four findings, send four rows here, not a document containing four.",
          items: {
            type: "object",
            required: ["ordinal"],
            description: "One complete finding object. `ordinal` is not optional here: it is the only thing that says WHICH finding this replaces, and a row without one has nowhere to land.",
            properties: {
              ordinal: { type: "number", description: "The ordinal of the finding this row replaces, exactly as it appears in the record you emitted. An ordinal this run does not hold is refused rather than appended — a patch corrects, it is not a way to add." },
              // ── — THE ROW IS A FINDING, AND THE SCHEMA NOW SAYS WHICH KEYS THAT MEANS ──
              //
              // The description above has always called this "one complete finding object" while the
              // properties declared `ordinal` alone. Measured across 294 captured calls: seats correctly
              // send thirteen keys here and twelve of them were undeclared. They are the payload, not
              // stray keys — which is why unknown-key refusal could not be switched on against this
              // schema without refusing the traffic it was meant to police.
              //
              // DERIVED, NEVER COPIED. The authority for what a finding carries is findings-model.mjs's
              // key ladder. A hand-written list here would be a second definition of the record's shape
              // and the two would drift the first time that ladder gains a key. The schema declares that
              // these keys EXIST; what each one means stays where it is defined.
              ...Object.fromEntries(FINDING_KEYS_CURRENT.filter((k) => k !== "ordinal")
                .map((k) => [k, { description: `Part of the finding record; see findings-model.mjs for what \`${k}\` carries.` }])),
            },
          },
        },
        narrative: {
          type: "object",
          description: "The cross-finding read, as sections. This is the material no other artifact on the run holds — NOT a second write-up of each finding, which lives on the report card. On a first call, send it complete. On a correction, send only the sections you changed — the rest are held.",
          required: ["spine", "verdict"],
          properties: {
            spine: { type: "string", description: "The dominant-element spine: what carries these marks and what a register would weigh. The core of the product." },
            verdict: { type: "string", description: "The verdict prose — what the findings together mean for this client." },
            coverage: {
              type: "object",
              description: "The coverage PROSE. The rows themselves are `findings.coverage` and are not repeated here — the driver renders the readable list from the record, so there is one authored set and no way for the client's statement and the machine record to disagree.",
              properties: {
                read: { type: "string", description: "The honest coverage read, in your own voice. State a gap as an attempted-and-unreachable FACT — never as re-run work for a human, which is refused: the driver already closed or proved-unclosable every closable gap before you ran." },
              },
            },
            calibration: {
              type: "array",
              description: "The calibration challenges you put to your own read, and your answers.",
              items: { type: "object", required: ["challenge", "answer"], properties: {
                challenge: { type: "string", description: "The challenge, as a question." },
                answer: { type: "string", description: "Your answer to it." },
              } },
            },
          },
        },
        findings: {
          type: "object",
          description:
            "The findings document — schema_version, rated_under_framework, findings[], coverage[], ask_answers[] and the other top-level registers. Already typed values; it arrives here instead of being written as a file so the joins below can run, and it is validated through the shipped parser, which names its own defect tokens. " +
            "TWO OF ITS FIELDS ALSO RENDER INTO THE NARRATIVE, which is why they are here and not on `narrative`: `coverage[]` becomes the readable coverage list (rows are {area, state, note}; `confirmed-clean` ASSERTS a search ran and is joined to this run's plan-execution receipt, so a clean claim over a slice that did not run is refused — name the area as the receipt names the slice, and the honest alternatives are coverage-limited and not-searched), and `ask_answers[]` becomes the labelled answer lines ({ask, answer}: the ask VERBATIM because the driver joins on it, and the ANSWER ALONE starting at its first word — the driver writes the \"- You asked: <ask> → \" label, so an answer that repeats the ask ships the question to the client twice).",
        },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: record_synthesis,
  }, {
    name: "record_knockout_assess",
    description:
      "Hand back THIS CHUNK's rated assessment as VALUES. The driver serializes knockout-assess-<n>.json, " +
      "so you never format JSON and never write the file. WHICH CHUNK IS NOT YOURS TO SAY — the driver " +
      "bound it when it dispatched you, and there is no parameter for it. Rate every mark assigned to " +
      "this chunk and no others. A repair turn may send only the marks it is correcting: the driver " +
      "merges them onto what it already accepted BY MARK NAME, so the marks you omit survive rather " +
      "than being deleted — but a mark you DO send replaces its stored row key by key, so send that " +
      "mark whole.",
    inputSchema: {
      type: "object",
      // `schema_version` is accepted and ignored: the driver writes its own. Declared so a seat that
      // sends it is not refused for a field nobody reads — the narrow-refusal rule preserve-merge.mjs
      // states, after the strict form killed a stage over exactly that.
      required: ["chunkSummary", "marks"],
      additionalProperties: false,
      properties: {
        schema_version: { type: "integer", description: "Accepted and ignored — the driver stamps its own." },
        chunkSummary: {
          type: "string",
          description:
            "2–5 sentences covering THIS chunk's marks, as markdown narrative. EVERY chunk emits one: " +
            "the whole-batch executive summary is composed in code by concatenating them, so a chunk " +
            "without one vanishes from the summary a client reads.",
        },
        framework: {
          type: "object", additionalProperties: false,
          description: "Chunk 0 only — the deck in force and its ladder, as you were handed them.",
          properties: {
            source: { type: "string", description: "The framework key." },
            ladder: { type: "array", items: { type: "string" }, description: "Band words, highest first." },
          },
        },
        batch: {
          type: "object", additionalProperties: false,
          description: "Chunk 0 only, and required there — the merged artifact takes it from chunk 0 alone.",
          properties: {
            productContext: { type: "string", description: "What the batch is FOR, in the client's terms." },
            standardCaveats: { type: "array", items: { type: "string" } },
          },
        },
        marks: {
          type: "array", minItems: 1,
          description: "One row per mark assigned to THIS chunk — no invention, no neighbour-chunk overrun, no omission.",
          items: {
            type: "object", additionalProperties: false,
            required: ["name", "rating", "bullets", "basis", "factors", "counterFactors", "mitigation"],
            properties: {
              ref: { type: ["string", "null"] },
              name: { type: "string", description: "The mark, VERBATIM as the plan names it — the join key for everything downstream." },
              rating: { type: "string", description: "The band word from the framework in force, verbatim. Not a numeral, not a letter code." },
              ratingQualifier: { type: ["string", "null"], description: "A closed sub-gradation that can only CAP a band; anything else belongs in the band word itself." },
              degraded: { type: ["boolean", "null"], description: "True only when the driver holds NO research payload for this mark. A degraded mark can never read as silently clean." },
              bullets: { type: "array", minItems: 1, maxItems: 5, items: { type: "string" }, description: "1–5 evidence bullets." },
              basis: { type: "string", description: "ONE sentence: why this band, for this name, in these classes. The report renders it as the lead line — a paragraph in bullets cannot fill it." },
              factors: { type: "array", minItems: 2, maxItems: 4, items: { type: "string" }, description: "2–4 one-line load-bearing observations behind the band." },
              counterFactors: { type: "array", minItems: 1, maxItems: 3, items: { type: "string" }, description: "1–3 one-line statements of what holds this name at this band rather than the next, either way." },
              mitigation: { type: "string", description: "May be \"\" when nothing would move the band — but SEND THE KEY, so a considered \"none\" is not confusable with an omission." },
              assessment: { type: "string", description: "The opening paragraph a reader of THIS MARK'S own report sees first: what the name is, what the landscape looks like, what drives the rating, what to do with it." },
              contextFraming: { type: "string" },
              registerEstimate: { type: "string" },
              parodyNote: { type: ["string", "null"] },
              crowdedField: { type: "boolean" },
              purpleNotes: { type: "array", items: { type: "string" }, description: "Internal notes — removed on export, never client-facing." },
              // — DECLARED HERE OR IT IS FOLKLORE.
              //
              // Both fields were built end to end for — instructed in the dispatch,
              // allowed by the recorder, validated against the run's own record store, rendered on the
              // card — and never declared HERE. The seat was therefore told two contradictory things:
              // the prose said send `registerReads`, and this object says `additionalProperties: false`.
              //
              // AND THE CONTRADICTION IS WHY THE BEHAVIOUR IS INCIDENTAL RATHER THAN BROKEN. The driver
              // validates against its own allowlist, not this schema, so a seat that trusts the prose
              // sends the field and it lands: measured on a 2026-09-01 run whose accepted call carries a
              // populated `registerReads`. A seat that trusts the schema omits it, and its read falls
              // into `purpleNotes` — which is stripped on export, so the reader never sees it. Same
              // code, two runs, two answers, and nothing anywhere disagreed.
              //
              // This repo already names the class, in a-cancel-marker-names-its-actor.test.mjs: "the
              // argument left the tool schema — an undocumented arg is folklore, and the next caller
              // will not pass it." Declaring it costs nothing and is the whole of the first half.
              registerReads: {
                type: "array",
                description: "Rows of { recordId, read } for a filing you WEIGHED that did not become a findings[] record. `read` is what you concluded about that filing — whether it bears on the rating and why — and it prints on that filing's card in the reader's own report. The recordId is joined against the run's own register-record store, so an id we do not hold is refused by name. Omit a filing you did not weigh; never write \"not weighed\" as a read.",
                items: {
                  type: "object", additionalProperties: false,
                  required: ["recordId", "read"],
                  properties: {
                    recordId: { type: "string", description: "Copied VERBATIM from the filings you were given." },
                    read: { type: "string", description: "What you concluded about THIS filing." },
                  },
                },
              },
              classesSearched: { type: "array", items: { type: "integer", minimum: 1, maximum: 45 } },
              classesDriving: { type: "array", items: { type: "integer", minimum: 1, maximum: 45 }, description: "Mandatory at a material band — class-specific ratings." },
              beltAndBraces: { type: "array", items: { type: "integer", minimum: 1, maximum: 45 } },
              negatives: {
                type: "array",
                items: {
                  type: "object", additionalProperties: false,
                  properties: { term: { type: "string" }, source: { type: "string" }, note: { type: "string" } },
                },
              },
              findings: {
                type: "array",
                description: "CLOSED KEYS, all nine, no others.",
                items: {
                  type: "object", additionalProperties: false,
                  required: ["ordinal", "name"],
                  properties: {
                    ordinal: { type: "integer", minimum: 1, description: "Unique within the mark, most blocking first. The code renumbers contiguously; yours breaks ties inside a band. Never cite a finding by number in prose." },
                    name: { type: "string", description: "The CONFLICTING name, verbatim." },
                    owner: { type: "string" },
                    band: { type: "string" },
                    net: { type: "string", description: "One conclusion sentence." },
                    type: { type: "string" },
                    evidence: { type: "array", items: { type: "string" } },
                    basis: { type: "string", description: "The ground THIS FINDING's band rests on — not the mark's `basis`, which is a different field one level up." },
                    // — the ninth key, and the count above moved with it. The
                    // recorder's own DECLARED list has carried this field since
                    // while this object said eight and forbade it, so "all eight, no others" was a
                    // closed set that disagreed with the closed set actually enforced.
                    weighedFilings: {
                      type: "array", items: { type: "string" },
                      description: "The register record ids whose evidence THIS finding's reasoning actually used, copied verbatim from the filings you were given. The report derives this finding's source labelling from it, and the driver joins every id against the run's own record store — so a Register label can never appear on a finding with no register evidence. Optional; omit it rather than guessing.",
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: record_knockout_assess,
  }, {
    name: "record_knockout_frame",
    description:
      "Hand back the batch FRAME as VALUES: the plan, and the scope note. The driver serializes " +
      "knockout-plan.json and writes knockout-frame.md, so you never format JSON and never write either " +
      "file. `scope_note` is written EXACTLY as you send it, so write the finished 2-3 sentences — the " +
      "driver adds no heading and composes nothing into it. One row per instructed mark, names verbatim " +
      "from the instructed scope. A repair turn may send only what it is correcting: the driver merges " +
      "marks onto what it already accepted BY MARK NAME, so the marks you omit survive — but a mark you " +
      "DO send replaces its stored row key by key, so send that mark whole.",
    inputSchema: {
      type: "object",
      // THE FIRST CALL'S CONTRACT, and it matches the acceptor rather than under-promising against it.
      // This schema declared NOTHING required while `acceptKnockoutFrame` refused a call missing any of
      // these three, so the document handed to the seat said a field was optional and the driver then
      // refused it by name. A schema and an acceptor that disagree resolve toward the STRICTER side.
      //
      // A REPAIR turn may still omit all three: the acceptor validates the MERGED result, so the stored
      // value stands. `required` describes the call that has nothing to merge onto — the first one.
      required: ["scope_note", "batch", "marks"],
      // `schema` is accepted and ignored: the driver writes its own. Declared so a seat that sends it is
      // not refused for a field nobody reads — the narrow-refusal rule preserve-merge.mjs states.
      properties: {
        schema: { type: "number", description: "Accepted and ignored — the driver writes the schema version it owns." },
        scope_note: {
          type: "string",
          description:
            "The 2-3 sentence scope note, written to knockout-frame.md EXACTLY as sent. What the batch " +
            "is, which classes, anything flagged. Name the search that was configured — this document is " +
            "read to check that what ran is what the client ordered.",
        },
        batch: {
          type: "object",
          required: ["productContext"],
          properties: {
            productContext: { type: "string", description: "One sentence: what the batch is for. Every mark's contextFraming is read against it." },
            umbrellaBrandNote: { type: "string", description: "A note where an umbrella brand is in play, or omit it." },
            executionOrder: {
              type: "array", items: { type: "string" },
              description: "The mark names in the order they should be swept — common-word and known-problem marks first. Every entry must be a mark in this plan.",
            },
          },
        },
        marks: {
          type: "array",
          description: "One row per instructed mark, names verbatim. Two names that differ only in spacing, punctuation or case are REFUSED: they would share one research payload, and one of them would be rated on the other's evidence.",
          items: {
            type: "object",
            // The three the acceptor refuses a row without, by name. `classes` is NOT among them: a plan
            // row may legitimately carry none, and the acceptor only constrains its shape when present.
            required: ["name", "classesPlain", "contextFraming"],
            properties: {
              ref: { type: "string", description: "The requester's own reference for this mark, or omit it." },
              name: { type: "string", description: "The mark, verbatim from the instructed scope." },
              classes: { type: "array", items: { type: "number" }, description: "Nice classes, integers 1-45." },
              beltAndBraces: { type: "array", items: { type: "number" }, description: "Adjacent Nice classes swept as a precaution, integers 1-45." },
              classesPlain: { type: "string", description: "The sweep prompt's plain-language class line — what these classes are, in words a search engine can use." },
              contextFraming: { type: "string", description: "What THIS name is for — a character, a location, a product line. The rating hangs off it: the assess stage is told to rate WITH this field, per mark, and two names in one batch can sit at different bands on identical evidence because they are used differently." },
              priorKnowledge: { type: "string", description: "What the requester already told you about this name, or omit it." },
              priority: { type: "number", description: "This mark's position in the execution order." },
            },
          },
        },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    handler: record_knockout_frame,
  }],
});
