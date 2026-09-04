// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Clearotron Perplexity plugin — pure logic + HTTP helper, with ZERO plugin-SDK / typebox imports
// (global fetch only). This is the testable core: index.js imports from here and adds the SDK
// registration + TypeBox parameter schemas (which need the SDK and typebox, neither resolvable in an
// offline `node --test` run). Tests import this module directly. build.js copies the whole src/ dir
// to dist/, so the `./core.js` import resolves at runtime. (Same layout as clawdi-corsearch.)

export const AGENT_API_URL = "https://api.perplexity.ai/v1/agent";

// ── Depth auto-detection ─────────────────────────────────────────

// Signals that push to deep-research (10 steps)
export const DEEP_SIGNALS = [
  "comprehensive", "detailed analysis", "in-depth", "compare and contrast",
  "historical overview", "full review", "thorough research",
  "financial analysis", "market analysis", "due diligence",
  "competitive landscape", "technical assessment", "risk assessment",
  "industry overview", "trend analysis", "benchmark",
  "evaluate alternatives", "pros and cons", "deep dive",
];

// Signals that push to advanced-deep-research (institutional-grade)
export const ADVANCED_SIGNALS = [
  "multi-jurisdictional", "regulatory framework", "cross-border",
  "systemic risk", "policy analysis", "institutional",
  "white paper", "legal analysis", "compliance framework",
  "comprehensive review", "exhaustive", "authoritative",
];

export const VALID_PRESETS = ["fast-search", "pro-search", "deep-research", "advanced-deep-research"];

export function detectPreset(task) {
  const lower = task.toLowerCase();
  const questionMarks = (task.match(/\?/g) || []).length;
  const semicolons = (task.match(/;/g) || []).length;
  const bullets = (task.match(/[-•]\s/g) || []).length;

  // Advanced signals or very complex multi-part queries → advanced-deep-research (Opus)
  if (
    ADVANCED_SIGNALS.some((s) => lower.includes(s)) ||
    questionMarks >= 4 ||
    bullets >= 4
  ) {
    return "advanced-deep-research";
  }

  // Deep signals or moderately complex queries → deep-research
  if (
    DEEP_SIGNALS.some((s) => lower.includes(s)) ||
    questionMarks >= 2 ||
    semicolons >= 2 ||
    bullets >= 3 ||
    task.length > 300
  ) {
    return "deep-research";
  }

  // Short, simple queries → fast-search
  if (task.length < 80 && questionMarks <= 1 && semicolons === 0 && bullets === 0) {
    return "fast-search";
  }

  // Default → pro-search
  return "pro-search";
}

// ── Request assembly (pure) ──────────────────────────────────────

export const REPORT_INSTRUCTIONS =
  "You are a research assistant. Return a structured report with these sections:\n" +
  "1. **Summary** — 2-3 sentence overview answering the core question.\n" +
  "2. **Findings** — organized by topic/sub-question. Use numbered citations [1], [2], etc.\n" +
  "3. **Gaps** — anything you could not find or verify. Be explicit.\n" +
  "4. **Sources** — numbered reference list: [1] Title — URL\n\n" +
  "Every factual claim must have a citation. Do not fabricate URLs or citations.";

// Sandbox (search-as-code) mode: the program's stdout is the deliverable; the model's final message is
// only a confirmation: a model that re-emits the program output transcribes
// it LOSSILY (a full term silently vanished), so re-emission is banned and the plugin reads stdout.
export const SANDBOX_INSTRUCTIONS =
  "Execute the task by writing and running ONE program with the sandbox tool. The program's stdout is the " +
  "deliverable — your final message must be only the short confirmation the task specifies, derived from the " +
  "parsed stdout. NEVER re-emit or summarize the program's output in your message.";

// Schema mode: the response must populate the caller's JSON schema; the prose-report format would fight it.
export const SCHEMA_INSTRUCTIONS =
  "Populate the response schema from your research. Every URL must be one you actually found — never " +
  "fabricate URLs. Use null or the literal string 'not extracted' for fields you could not confirm.";

export function buildRequestBody({
  task,
  preset,
  allowFetch = false,
  domainFilter = null,
  modelOverride = null,
  enableSandbox = false,
  responseSchema = null,
  schemaName = null,
}) {
  const tools = [];
  if (enableSandbox) {
    tools.push({ type: "sandbox" });
  }
  tools.push({ type: "web_search" });
  if (allowFetch) {
    tools.push({ type: "fetch_url" });
  }

  // Apply domain filter to web_search if provided
  if (domainFilter && domainFilter.length > 0) {
    tools.find((t) => t.type === "web_search").search_domain_filter = domainFilter;
  }

  const body = {
    preset,
    input: task,
    tools,
    instructions: enableSandbox ? SANDBOX_INSTRUCTIONS : responseSchema ? SCHEMA_INSTRUCTIONS : REPORT_INSTRUCTIONS,
  };

  if (responseSchema) {
    body.response_format = {
      type: "json_schema",
      json_schema: { name: schemaName || "tool_response", schema: responseSchema },
    };
  }

  if (modelOverride) {
    body.model = modelOverride;
  }

  return body;
}

// ── Retry policy ─────────────────────────────────────────────────
// A transient transport throw ("fetch failed") or a 5xx/429 gets
// retried with linear backoff. 4xx config/auth errors fail fast (a retry cannot fix a bad key or a
// malformed request). Deep tiers get one retry only — a deep re-run is expensive and the calling
// skill has its own follow-up logic as the second line of defence.

export function retriesForPreset(preset) {
  return preset === "deep-research" || preset === "advanced-deep-research" ? 1 : 2;
}

export function isRetryableStatus(status) {
  return status >= 500 || status === 429;
}

// ── API call ─────────────────────────────────────────────────────

/**
 * POST the assembled body to the Agent API with retry/backoff.
 *
 * @param {string} apiKey
 * @param {object} body          from buildRequestBody()
 * @param {object} [opts]        { retries, backoffMs, fetchImpl } — injectable for tests
 * @returns {Promise<object>}    parsed response JSON
 * @throws {Error}               on persistent transport failure or non-retryable / final HTTP error
 */
export async function callAgentAPI(apiKey, body, opts = {}) {
  const retries = opts.retries ?? retriesForPreset(body.preset);
  const backoffMs = opts.backoffMs ?? 1500;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  let lastErr;
  for (let i = 0; i <= retries; i++) {
    if (i > 0) await sleep(backoffMs * i);
    let response;
    try {
      response = await fetchImpl(AGENT_API_URL, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      lastErr = err; // transport/network throw — retryable
      continue;
    }

    if (response.ok) {
      return response.json();
    }

    const errorText = await response.text();
    lastErr = new Error(`Perplexity API ${response.status}: ${errorText}`);
    // The status travels on the ERROR OBJECT, not only inside the message. A caller that has to recover
    // the code by parsing prose is a caller that will get it wrong: the driver's own outage patterns
    // (repairs.mjs OUTAGE_RE / TRANSIENT_RE) require a literal "http" before the number, so
    // "Perplexity API 429: …" matches neither of them and a rate-limit reads as an ordinary defect.
    lastErr.status = response.status;
    lastErr.retryable = isRetryableStatus(response.status);
    if (!isRetryableStatus(response.status)) throw lastErr;
  }
  throw lastErr;
}

// ── Response formatting (pure) ───────────────────────────────────

export function extractText(data) {
  // Agent API returns output as an array of items:
  //   { type: "message", content: [{ type: "output_text", text: "..." }] }
  //   { type: "web_search_call", ... }
  // Extract text from all message items.
  let text = "";
  const output = data.output || [];

  for (const item of output) {
    if (item.type === "message" && Array.isArray(item.content)) {
      for (const block of item.content) {
        if (block.type === "output_text" && block.text) {
          text += block.text;
        }
      }
    }
  }

  // Fallback: some response shapes may use output_text directly (SDK) or choices (Sonar)
  if (!text) {
    text = data.output_text || data.choices?.[0]?.message?.content || "";
  }

  return text;
}

// ── Sandbox (search-as-code) response handling ───────────────────
// The response's `sandbox_results` items carry the executed program (`code`) and its run records
// ({stdout, stderr, exit_code}). The LAST run whose stdout parses as JSON is the deliverable (the model
// may legitimately run, fix, and re-run the program). The code is returned as an audit appendix — it is
// the receipt of exactly what was executed.

export function parseSandboxResults(data) {
  const runs = [];
  for (const item of data.output || []) {
    if (item.type !== "sandbox_results") continue;
    for (const r of item.results || []) {
      runs.push({
        code: item.code || "",
        stdout: r.stdout || "",
        stderr: r.stderr || "",
        exitCode: r.exit_code,
        status: r.status,
      });
    }
  }
  return runs;
}

export function formatSandboxResponse(data, preset) {
  const runs = parseSandboxResults(data);

  if (runs.length === 0) {
    // Mechanism, not prompt prose: a SaC call that never ran the sandbox is a failed call — the calling
    // worker sees an ERROR and retries, instead of mistaking model prose for program output.
    return "ERROR: sandbox was not used — no program was executed. Retry the call; the task requires the " +
      "sandbox tool to run the search program.";
  }

  let deliverable = null;
  for (let i = runs.length - 1; i >= 0; i--) {
    try {
      JSON.parse(runs[i].stdout);
      deliverable = runs[i];
      break;
    } catch { /* not this run */ }
  }

  if (!deliverable) {
    const last = runs[runs.length - 1];
    const stderrTail = (last.stderr || "").slice(-500);
    return `ERROR: the sandbox program ran (exit ${last.exitCode}) but its stdout is not valid JSON. ` +
      `Retry with a corrected program.${stderrTail ? ` stderr tail: ${stderrTail}` : ""}`;
  }

  const meta = [`Depth: ${preset}`];
  const usage = data.usage || {};
  if (usage.total_tokens) meta.push(`Tokens: ${usage.total_tokens}`);
  const cost = usage.cost?.total_cost;
  if (cost != null) meta.push(`Cost: $${cost}`);
  const confirmation = extractText(data).trim();

  return deliverable.stdout.trim() +
    "\n\n--- SANDBOX PROGRAM (audit receipt — this exact code produced the JSON above) ---\n" +
    "```python\n" + deliverable.code.trim() + "\n```" +
    (confirmation ? `\n\nModel confirmation: ${confirmation}` : "") +
    `\n\n---\n_Research metadata: ${meta.join(" | ")}_`;
}

export function formatResponse(data, preset) {
  const text = extractText(data);

  if (!text) {
    const output = data.output || [];
    console.error(`[clawdi-perplexity] No text extracted. Response keys: ${Object.keys(data).join(", ")}`);
    console.error(`[clawdi-perplexity] output array types: ${output.map((i) => i.type).join(", ")}`);
    return `ERROR: Perplexity returned a response but no text content could be extracted. Status: ${data.status || "unknown"}`;
  }

  const citations = data.citations || [];
  const usage = data.usage || {};

  let result = text;

  // Append metadata footer
  const meta = [];
  meta.push(`Depth: ${preset}`);
  if (usage.total_tokens) meta.push(`Tokens: ${usage.total_tokens}`);
  if (citations.length > 0) meta.push(`Citations: ${citations.length}`);

  if (meta.length > 0) {
    result += `\n\n---\n_Research metadata: ${meta.join(" | ")}_`;
  }

  return result;
}

// ── Grid capture — deterministic data plane (search-as-code) ──────────────────────────────────────────
// Root-cause fix. The marketplace grid is a
// LARGE machine artifact (~terms × platforms cells). Routing it back through the calling model's bounded
// turn-OUTPUT to "save it verbatim" fails two ways, and both happen: the model TRUNCATES it
// ("Unterminated string in JSON at position ~20000" — the output-ceiling signature) or DROPS / MIS-KEYS
// cells ("grid_join_missing", "cell missing term/platform"). Same disease: a probabilistic model in the
// verbatim-data path. The cure: keep the grid out of the model's output entirely — the driver DICTATES
// the cells (grid-spec.json), the plugin runs EXACTLY those, RECONCILES the program's stdout against
// them, and the caller (index.js) WRITES the ledger itself from the API response (which arrives over
// HTTP, never through the model's turn-output, so no ceiling can truncate it). The model only judges.

const gnorm = (s) => String(s ?? "").trim().replace(/^["'`]+|["'`]+$/g, "").toLowerCase();
const cellKey = (term, platform) => `${gnorm(term)}\u0000${gnorm(platform)}`;

// A handful of honest gaps are fine (reconciled → coverage-closure re-runs them). But if the program ran
// fewer than this fraction of the dictated cells, it is a BROKEN program / transient tool failure — the
// grid must RETRY, not be written as a mostly-gaps ledger that silently passes the receipts gate (the
// teal-vault 1-of-154 "WebHit not iterable" failure shipped exactly that way before this floor).
export const GRID_COVERAGE_FLOOR = 0.5;

// THE SAME MECHANISM FOR THE MEANING SWEEP, WITH A TIGHTER BOUND, AND THE DIFFERENCE IS REDUNDANCY —
//.
//
// A marketplace grid is term x platform: lose one platform for a term and the other platforms still speak
// to that term, so coverage degrades gradually and 0.5 is an honest floor. The connotation sweep has no
// such redundancy. Each dictated query is a distinct meaning probe — a gang label, a slang reading, a
// cultural association — and a query that does not run is a meaning nothing else in the run can surface.
// Losing half of THAT is not a degraded sweep, it is a different claim to a client.
//
// So the bound is deliberately tighter rather than inherited. It is not zero: zero tolerance is what
// discarded 59 paid-for receipts to avoid shipping two gap rows, which is the defect this replaces.
export const CONNOTATION_COVERAGE_FLOOR = 0.9;

/** The grid contract the driver hands the plugin via grid_spec_path. Throws on a malformed spec. */
export function validateGridSpec(spec) {
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) throw new Error("grid spec is not an object");
  // — a spec must dictate SOME work; it need not dictate CELLS. The meaning seat's spec carries
  // `terms: []` and the whole connotation sweep, and refusing it here would refuse the one seat whose
  // entire dispatch is the meaning work. A spec with neither is still malformed and still throws.
  const hasCells = Array.isArray(spec.terms) && spec.terms.length > 0;
  const hasQueries = Array.isArray(spec.connotation?.queries) && spec.connotation.queries.length > 0;
  if (!Array.isArray(spec.terms)) throw new Error("grid spec.terms[] missing or empty");
  if (!hasCells && !hasQueries) throw new Error("grid spec dictates no work — terms[] and connotation.queries[] are both empty");
  if (!Array.isArray(spec.platforms) || spec.platforms.length === 0) throw new Error("grid spec.platforms[] missing or empty");
  if (typeof spec.output_path !== "string" || !spec.output_path) throw new Error("grid spec.output_path missing");
  // OPTIONAL connotation/meaning sweep (back-compat: absent ⇒ marketplace-grid-only). The driver dictates
  // the meaning queries verbatim (mark + near-forms × shapes), the program runs them on the general web and
  // records them into extras.pr_risk — distinct from the term×platform marketplace cells.
  if (spec.connotation != null) {
    if (typeof spec.connotation !== "object" || Array.isArray(spec.connotation)) throw new Error("grid spec.connotation must be an object { queries[] }");
    if (!Array.isArray(spec.connotation.queries)) throw new Error("grid spec.connotation.queries[] must be an array");
  }
  return spec;
}

/** The dictated connotation queries (non-empty strings) the program must run + record. PURE. */
export function connotationQueriesOf(spec) {
  return Array.isArray(spec?.connotation?.queries)
    ? spec.connotation.queries.filter((q) => typeof q === "string" && q.trim())
    : [];
}

/**
 * Build the sandbox task from the DICTATED spec — the term and platform keys reach Perplexity's program
 * from code, never re-typed by the calling model (this is what kills re-typed-key corruption (VIBRANTE→VIBRNTE-class typos)).
 * CRITICAL: this carries the PINNED pplx_sdk access idiom (the same one in
 * skills/prelim-common-law/perplexity-prompts.md). Without it the sandbox agent free-styles the SDK and
 * dies with "TypeError: 'pplx_sdk.WebHit' object is not iterable" on every cell (the teal-vault /
 * a 1-of-154 fold failure). The result object supports ITERATION + ATTRIBUTE
 * access only. The per-cell try/except keeps one bad cell from aborting the whole grid.
 */
export function buildGridProgramTask(spec) {
  validateGridSpec(spec);
  const { terms, platforms, batch = 14 } = spec;
  const cellCount = terms.length * platforms.length;
  const conn = connotationQueriesOf(spec);
  const hasConn = conn.length > 0;
  // — THE MEANING RECEIPTS CARRY A SNIPPET; THE MARKETPLACE CELLS DO NOT.
  // The disposition form's spot-check joins the seat's `quote` against text the TOOL fetched, so a
  // snippet has to exist on a meaning receipt or there is nothing to join against — until this, nothing
  // in the dataplane captured one. It is added HERE ONLY, on the connotation collection: the marketplace
  // `candidates[]` are JSON.stringify'd wholesale into the seat's tool result (candidatesForJudgment →
  // perplexity-server.mjs), so a snippet on every cell would multiply that payload for a judgment that
  // reads titles and URLs. Narrower than the design's "both places", and the reason is token cost on the
  // one payload the seat actually reads.
  const extrasShape = hasConn
    ? '"extras":{"pr_risk":[{"query":"<verbatim>","results":[{"title":"...","url":"...","snippet":"..."}]}]}'
    : '"extras":{}';
  // — a MEANING-ONLY spec (terms:) dictates no grid at all. Emitting the cell instructions with
  // an empty TERMS list and "0 cells total" would tell the sandbox to run a grid and then describe an
  // empty one — the program would still have to be written, and "no additions, no omissions" over an
  // empty list is an instruction nobody can follow usefully. The meaning block below is the whole task.
  const hasCells = cellCount > 0;
  return [
    hasCells
      ? "Write and run ONE sandbox program that executes a marketplace clearance search grid."
      : "Write and run ONE sandbox program that executes a MEANING/CONNOTATION sweep. There is no marketplace grid in this spec — do not invent one.",
    hasCells ? `Search EXACTLY this term × platform grid — every (term × platform) cell runs once, no additions, no omissions, keys VERBATIM (${cellCount} cells total):` : "",
    hasCells ? `TERMS (${terms.length}): ${JSON.stringify(terms)}` : "",
    hasCells ? `PLATFORMS (${platforms.length}): ${JSON.stringify(platforms)}` : "",
    "Access the Perplexity results with EXACTLY this idiom — the result object supports ITERATION and ATTRIBUTE access ONLY (NO slicing, NO list(...), NO dict(...), NO indexing — iterating a single hit raises 'WebHit object is not iterable'):",
    hasCells ? "    hits = pplx_sdk.search.web(term, limit=10, domains=[platform])   # for the \"web\" platform, OMIT the domains= argument entirely" : "",
    hasCells ? "    results = []" : "",
    hasCells ? "    for h in hits:" : "",
    hasCells ? "        if len(results) >= 8: break" : "",
    hasCells ? "        results.append({\"title\": h.title or \"\", \"url\": h.url or \"\"})" : "",
    hasCells ? "Per cell: status = \"hit\" if results else \"no_hit\". Wrap EACH cell in its own try/except; on an exception append the string \"<term> | <platform> | <repr(exception)>\" to gaps and CONTINUE — one failing cell must never abort the grid." : "",
    hasCells && terms.length > batch
      ? `Batch into groups of <= ${batch} terms (accumulate ALL cells before printing — one oversized run truncates).`
      : "",
    // ── CONNOTATION / MEANING sweep (distinct from the marketplace grid) ──
    hasConn
      ? "AFTER the grid, run a CONNOTATION / MEANING sweep. This is NOT the marketplace grid: the grid asks \"who SELLS this name?\"; this asks \"what does this name MEAN, and to whom?\" — gang / slang / offensive / cultural meaning, on the GENERAL web (Urban Dictionary, Wikipedia, news). A benign dictionary gloss is NEVER a clearance (e.g. a mark reading as a benign given name can be one letter off a major street-gang label — only a meaning search surfaces it)."
      : "",
    hasConn ? `CONNOTATION QUERIES (${conn.length}, run each VERBATIM): ${JSON.stringify(conn)}` : "",
    hasConn
      // getattr with a default, NOT `h.snippet` — the pinned idiom is attribute access, and an SDK build
      // whose WebHit has no snippet attribute would raise inside the per-query try/except and send the
      // whole meaning query to gaps. A missing snippet must cost the spot-check, never the receipt.
      ? "For EACH connotation query: hits = pplx_sdk.search.web(query, limit=10)   # GENERAL web — OMIT the domains= argument; collect up to 8 {\"title\": h.title or \"\", \"url\": h.url or \"\", \"snippet\": (getattr(h, \"snippet\", \"\") or \"\")[:400]} using the SAME iterate-only idiom; wrap each in its own try/except (on an exception append \"<query> | connotation | <repr(exception)>\" to gaps and CONTINUE)."
      : "",
    hasConn
      ? "Record EVERY connotation query — INCLUDING ones that returned zero results — as one entry of extras.pr_risk = [{\"query\":\"<verbatim>\",\"results\":[...]}]. An empty results[] is a SEARCHED-clean receipt; a MISSING query is not a receipt."
      : "",
    "Print to stdout EXACTLY one JSON object (no prose, no markdown fences):",
    `{"cells":[{"term":"<verbatim>","platform":"<verbatim>","status":"hit|no_hit","candidates":[{"title":"...","url":"..."}]}],${extrasShape},"gaps":["<term> | <platform> | <error>"]}`,
    "Every (term × platform) pair appears once — in cells[] if it ran, or in gaps[] only if that specific cell threw.",
    hasConn ? "Every connotation query appears once in extras.pr_risk[] (or in gaps[] only if that specific query threw)." : "",
  ].filter(Boolean).join("\n");
}

/** Flatten a stdout ledger (single object OR array of per-batch objects) into cells + gaps + extras. */
function flattenLedger(parsed) {
  const batches = Array.isArray(parsed) ? parsed : [parsed];
  const cells = [], gaps = [], extras = {};
  for (const b of batches) {
    if (!b || typeof b !== "object") continue;
    for (const c of b.cells ?? []) if (c && typeof c === "object") cells.push(c);
    for (const g of b.gaps ?? []) gaps.push(g);
    if (b.extras && typeof b.extras === "object") Object.assign(extras, b.extras);
  }
  return { cells, gaps, extras };
}

/**
 * Reconcile the program output against the dictated grid: every requested (term × platform) must be
 * accounted as a cell OR a gap. Cells the program dropped become honest reconciled gaps
 * (coverage-limited) — never a silent recall hole, never a hard-fail. Throws only on unparseable stdout
 * (a parse miss must never pass). Returns { ledger, missing[], requested, present }.
 */
export function reconcileGridLedger(stdoutStr, spec) {
  validateGridSpec(spec);
  const parsed = JSON.parse(stdoutStr);
  const { cells, gaps, extras } = flattenLedger(parsed);
  const accounted = new Set();
  for (const c of cells) if (c && c.term != null && c.platform != null) accounted.add(cellKey(c.term, c.platform));
  for (const g of gaps) {
    if (typeof g === "string") { const [t, p] = g.split("|").map((s) => s.trim()); if (t && p) accounted.add(cellKey(t, p)); }
    else if (g && g.term != null && g.platform != null) accounted.add(cellKey(g.term, g.platform));
  }
  const missing = [], addedGaps = [];
  for (const term of spec.terms) for (const platform of spec.platforms) {
    if (!accounted.has(cellKey(term, platform))) {
      missing.push({ term, platform });
      addedGaps.push({ term, platform, error: "cell not returned by grid program (reconciled gap)" });
    }
  }
  // ── — THE MEANING SWEEP RECONCILES THE SAME WAY THE GRID ALREADY DOES ──────────
  //
  // Above, a dictated CELL the program did not return becomes an honest gap row and the ledger is written.
  // A dictated QUERY that did not come back used to reach captureGridFromResponse as a hard refusal that
  // threw the WHOLE ledger away — receipts, cells and all. R14 lost 59 of 61 paid-for meaning receipts to
  // save two gap rows, four times, and re-bought the sweep on every attempt.
  //
  // One file held two policies for one failure class. This is the deletion of that contradiction, not a
  // new branch: the same reconciliation, over the other collection.
  //
  // It also ends the re-buy for free. `recordedLedgerFor` re-runs a spec whose queries carry neither a
  // receipt nor a gap row; once they carry gap rows, a retry answers from the ledger on disk instead of
  // paying for the sweep again.
  const dictatedQueries = connotationQueriesOf(spec);
  const missingQueries = dictatedQueries.length
    ? findUnrecordedConnotationQueries(spec, { extras, gaps: [...gaps, ...addedGaps] }).missing
    : [];
  for (const q of missingQueries) {
    addedGaps.push({ term: q, platform: "connotation", error: "query not returned by grid program (reconciled gap)" });
  }

  return {
    ledger: { cells, extras, gaps: [...gaps, ...addedGaps] },
    missing,
    missingQueries,
    requestedQueries: dictatedQueries.length,
    presentQueries: dictatedQueries.length - missingQueries.length,
    requested: spec.terms.length * spec.platforms.length,
    present: cells.length,
  };
}

/**
 * The dictated connotation queries with NO receipt in extras.pr_risk[] AND no honest gap row — plus the
 * recorded queries that match nothing dictated.
 *
 * Why identity and not a count: the sandbox program TRANSCRIBES the dictated queries into its own source,
 * and a mutated string is a DIFFERENT SEARCH. The count stays right while the dictated query never ran, so
 * every count-based check upstream and downstream reads clean. Observed: the dictated
 * `提基斯拉什 offensive meaning` came back as `提基斯ラッシュ offensive meaning` — the katakana of the
 * sibling Japanese row fused into the Chinese transliteration. 27 dictated, 27 recorded, one never searched.
 *
 * A query that THREW and said so is not this defect — it owns a gap row (`<query> | connotation | <error>`,
 * or the reconciled object form) and the driver's merge gate weighs it separately. Only a silent
 * substitution is reported here. PURE.
 */
export function findUnrecordedConnotationQueries(spec, ledger) {
  const dictated = connotationQueriesOf(spec);
  if (!dictated.length) return { missing: [], unmatched: [] };
  const recorded = new Set();
  for (const e of Array.isArray(ledger?.extras?.pr_risk) ? ledger.extras.pr_risk : [])
    if (e && typeof e.query === "string" && e.query.trim()) recorded.add(gnorm(e.query));
  const errored = new Set();
  for (const g of Array.isArray(ledger?.gaps) ? ledger.gaps : []) {
    if (typeof g === "string" && g.includes("| connotation |")) errored.add(gnorm(g.split("|")[0]));
    else if (g && typeof g === "object" && gnorm(g.platform) === "connotation" && g.term != null) errored.add(gnorm(g.term));
  }
  const dictatedNorm = new Set(dictated.map(gnorm));
  return {
    missing: dictated.filter((q) => !recorded.has(gnorm(q)) && !errored.has(gnorm(q))),
    unmatched: [...recorded].filter((q) => !dictatedNorm.has(q)),
  };
}

/** Compact judgment payload: only cells with candidate hits need the model's taxonomy judgment. */
export function candidatesForJudgment(ledger) {
  return (ledger.cells ?? [])
    .filter((c) => Array.isArray(c.candidates) && c.candidates.length > 0)
    .map((c) => ({ term: c.term, platform: c.platform, candidates: c.candidates }));
}

/**
 * End-to-end pure capture: parse the sandbox response, pick the deliverable run, reconcile against the
 * dictated spec. Returns { ok, ledgerJson, missing, present, requested, candidates, code, error }.
 * index.js does the fs read of the spec and the fs write of ledgerJson — this stays pure for `node --test`.
 */
/**
 * THE REFUSAL A SEAT IS HANDED WHEN A REQUIRED LEDGER WAS NOT PRODUCED —.
 *
 * Every grid refusal returns a STRING to the seat, and a seat told there is no ledger can only honestly
 * write nothing. That is what R14's meaning seat did, four times, across two attempts and a rerun. The
 * driver then failed the stage on `missing_file` naming the seat's REPORT — so the record pointed at a
 * seat that had behaved correctly, while the artifact actually missing was a ledger two layers upstream.
 *
 * THE DRIVER-SIDE GATE CANNOT COVER THIS, and that is the reason this lives here rather than there.
 * `verify.mjs` does hold a `grid_ledger_missing` check that already names the halved spec — but it sits
 * INSIDE THE VALIDATOR FOR THAT SEAT'S REPORT, and a missing ledger is precisely what stops the report
 * existing. It can therefore only fire when a seat wrote a report DESPITE having no ledger, which is the
 * one case where the seat is the one at fault. On the path that needs it, it is unreachable by
 * construction.
 *
 * So the enforcement is at the point of production, and it names the SPEC — the file whose
 * `ledger_required` was not honoured — never the consumer that a missing ledger prevented from existing.
 *
 * PURE, and a no-op when the spec did not require a ledger: a spec that never promised one is not handed
 * a refusal it did not earn.
 */
export function requiredLedgerRefusal(why, { spec, gridSpecPath } = {}) {
  if (spec?.ledger_required !== true) return why;
  return `${why}\nREQUIRED LEDGER NOT PRODUCED: ${gridSpecPath} carries ledger_required:true and nothing was `
    + `written to ${spec.output_path}. This is a failure of the grid tool, not of your turn — do not author `
    + `the ledger yourself, and do not summarise one that does not exist. Report this refusal and stop.`;
}

export function captureGridFromResponse(data, spec) {
  validateGridSpec(spec);
  const runs = parseSandboxResults(data);
  if (runs.length === 0) return { ok: false, error: "sandbox was not used — no program executed" };
  let deliverable = null;
  for (let i = runs.length - 1; i >= 0; i--) {
    try { JSON.parse(runs[i].stdout); deliverable = runs[i]; break; } catch { /* not this run */ }
  }
  if (!deliverable) {
    const last = runs[runs.length - 1];
    return { ok: false, error: `sandbox stdout is not valid JSON (exit ${last.exitCode})`, stderrTail: (last.stderr || "").slice(-400) };
  }
  let rec;
  try { rec = reconcileGridLedger(deliverable.stdout, spec); }
  catch (e) { return { ok: false, error: `grid stdout reconcile failed: ${String(e.message).slice(0, 160)}` }; }
  // Coverage floor (the teal-vault backstop): a few honest gaps are fine, but if the program errored
  // on MOST cells, return ERROR so the stage RETRIES the grid — never write a mostly-gaps ledger that
  // silently passes the receipts gate and ships an unrun marketplace layer.
  if (rec.present < rec.requested * GRID_COVERAGE_FLOOR) {
    const errs = [...new Set(rec.ledger.gaps
      .map((g) => (typeof g === "string" ? g.split("|").pop() : g?.error) || "")
      .map((s) => String(s).trim()).filter(Boolean))].slice(0, 2);
    return {
      ok: false,
      catastrophic: true,
      present: rec.present,
      requested: rec.requested,
      error: `grid catastrophically incomplete — only ${rec.present}/${rec.requested} cells returned (floor ${Math.round(GRID_COVERAGE_FLOOR * 100)}%). The program likely errored on most cells${errs.length ? ` (e.g. ${errs.join("; ")})` : ""}. Use the pinned pplx_sdk idiom (iterate hits; no slicing/list()/dict()) and retry the grid.`,
    };
  }
  // ── THE MEANING SWEEP'S FLOOR —, replacing zero tolerance ──────────────────────
  //
  // This used to refuse outright when ANY dictated query came back without a receipt. R14 lost 59 of 61
  // paid-for receipts to two missing queries, four times over, re-buying the whole sweep each attempt and
  // meeting the same deterministic pair. Meanwhile an unreturned marketplace CELL in the same function was
  // recorded as an honest gap and shipped. One file, one failure class, two policies.
  //
  // The unreturned queries are now reconciled into gap rows upstream, so the only question left here is the
  // one the marketplace floor already asks: is what came back enough to stand behind? The refusal does not
  // disappear — it becomes PROPORTIONATE, and a sweep that loses most of itself still refuses and retries.
  const conn = connotationQueriesOf(spec);
  if (conn.length > 0 && rec.presentQueries < rec.requestedQueries * CONNOTATION_COVERAGE_FLOOR) {
    const ident = findUnrecordedConnotationQueries(spec, { extras: rec.ledger.extras, gaps: [] });
    const none = rec.presentQueries === 0;
    return {
      ok: false,
      connotationBelowFloor: true,
      presentQueries: rec.presentQueries,
      requestedQueries: rec.requestedQueries,
      missingQueries: rec.missingQueries,
      error: none
        ? `connotation/meaning sweep missing — the program recorded ZERO of the ${conn.length} dictated `
          + "connotation queries into extras.pr_risk. Run the meaning sweep on the general web (no domain "
          + "filter), record each query — even zero-result ones — into extras.pr_risk, and retry. A "
          + "dictionary gloss is never a clearance."
        : `connotation/meaning sweep below the coverage floor — only ${rec.presentQueries}/${rec.requestedQueries} `
          + `dictated queries came back (floor ${Math.round(CONNOTATION_COVERAGE_FLOOR * 100)}%). A few unreturned `
          + "queries are recorded as honest gaps and the ledger ships; this many means the program is broken, not "
          + `the coverage. Missing: ${JSON.stringify(rec.missingQueries.slice(0, 5))}.`
          + (ident.unmatched.length
            ? ` Recorded but never dictated, so the above were most likely MIS-TRANSCRIBED into these: `
              + `${JSON.stringify(ident.unmatched.slice(0, 5))}. Copy every dictated query EXACTLY as given — `
              + "character for character, including non-Latin script, and never merge two that look alike."
            : "")
          + " Retry the grid.",
    };
  }

  return {
    ok: true,
    ledgerJson: JSON.stringify(rec.ledger),
    missing: rec.missing,
    present: rec.present,
    requested: rec.requested,
    candidates: candidatesForJudgment(rec.ledger),
    code: deliverable.code || "",
  };
}
