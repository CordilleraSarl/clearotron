// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// verify-knockout.mjs — validators + gates for the KNOCKOUT (Depth 1) lane.
// Same contract as verify.mjs validators: (file, text) -> {ok, reason?} for per-stage outputs (they ride
// runStage's corrective ladder), plus code-side gates for the merged findings and the pre-publish lint.
// The receipts discipline: every cited URL must appear in THAT mark's raw research payload — the knockout
// analogue of the band-truth gate (a finding the driver cannot trace to held evidence is treated as
// fabricated). It runs at three doors and has NO off switch: CLEAROTRON_KNOCKOUT_URL_GATE is deleted.
// An env var that disarms a gate makes the gate's absence look exactly like its pass, which is the one
// failure mode this lane's gates exist to refuse.
import { readFileSync, existsSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { DRIVER_DIR, driverDir } from "../shared/driver-dir.mjs";   //
import { kebab, kebabCollisions, CAPABILITY_SKIPPED_NOTE } from "./search-policy.mjs";
import { validateKnockoutFindings } from "./findings-model.mjs";
import { runLog } from "./log.mjs";   // — the empty-ladder observable; validators are already disk-reading, this adds the record
// PR-5 — the permission-prose check (ION/copper-foundry: a false "tool was blocked" claim excusing
// missing coverage) now covers the knockout findings text too. These validators are this lane's HARD
// gate — its findings are store-rendered, and a fabricated permission excuse is surface-independent, so
// the one check that fires on it runs here as well and REFUSES the run.
// 2026-07-31: the lane also writes a predelivery-lint receipt at publish (the applicable subset, in
// publish/knockout.mjs — the DELIVERY.md memo records what changed). That receipt is ADVISORY and rides
// the delivery surfaces as flags; nothing about the gate below moved, and this file is the only place on
// this lane where a check can stop a delivery.
import { permissionProseChecks } from "./predelivery-lint.mjs";

const norm = (s) => String(s ?? "").trim();
const nameKey = (s) => norm(s).toLowerCase().replace(/\s+/g, " ");

// ── Tone guards (the skill's rules, mechanical subset) ───────────────────────────────────────────────
export const BANNED_TONE_RE = /\b(extremely difficult|most dangerous|massive|enormous)\b/i;
export const QUANT_CLAIM_RE = /(\b\d[\d,.]*\s*(?:M|million|billion|k|thousand)?\s*(?:streams|downloads|copies sold|units sold)\b)|(\$\s?\d[\d,.]*\s*(?:M|million|billion|k)?\s*(?:in\s+)?(?:annual\s+)?(?:revenue|sales))/i;

// ── URL normalization for the receipts gate ──────────────────────────────────────────────────────────
// Host+path identity: protocol/www./tracking-params/trailing-slash/fragments are presentation, not
// identity. ONLY http(s) URLs have an identity here — a javascript:/data:/vbscript: "URL" normalizes to
// null so it can never pass the receipts gate (and the publisher separately refuses to href it): the
// payload is web-derived text, so scheme-smuggling through a substring match is a live XSS route.
// Schemeless strings fall back to a trimmed lowercase substring check (conservative).
export function normalizeUrl(u) {
  const raw = String(u ?? "").trim();
  const scheme = raw.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/)?.[1]?.toLowerCase() ?? null;
  if (scheme && scheme !== "http" && scheme !== "https") return null;
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (!host) return null;
    const path = url.pathname.replace(/\/+$/, "").toLowerCase();
    return `${host}${path}`;
  } catch { return raw.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[?#]/)[0].replace(/\/+$/, "") || null; }
}
export function urlInPayload(url, payload) {
  const n = normalizeUrl(url);
  if (!n) return false;
  const hay = String(payload ?? "").toLowerCase();
  if (hay.includes(n)) return true;
  // tolerate the payload carrying the host with www./protocol or the path percent-decoded
  const host = n.split("/")[0];
  return Boolean(host && hay.includes(host) && (n === host || hay.includes(decodeURIComponent(n.slice(host.length)))));
}

// ── The receipts gate, as ONE function with three callers ────────────────────────────────────────────
//
// It used to be eleven lines inline in the chunk validator, which meant the merged artifact and the
// publisher — the two doors an ARCHIVED run comes through — had no receipts check at all. Extracted so
// the same join runs at every door: the chunk (per turn, on the corrective ladder), the merged findings
// (the only gate pipeline-knockout.mjs runs on the composed artifact), and publishKnockout (the republish
// path, publish/report-registry.mjs → publishKnockout, which re-renders archived findings).
//
// KNOCKOUT PROSE ARM 2026-08-06 — this reads BOTH shapes, and that is the deliberate half of the
// sequencing. The typed record cites `evidence`; the archived prose row cited one `url`. When
// the typed shape landed, `if (!f?.url) continue` skipped every typed finding and the gate returned ok
// having receipted NOTHING — a fabricated link walking past the one check that exists to catch it,
// silently, because a gate that stops running looks exactly like a gate that passed. Read both until no
// archived prose run republishes; then delete the `url` arm here and the one in findings-model.mjs's
// knockoutFindingView (grep the marker above), and not before.
export function knockoutCitedUrls(f) {
  return [
    ...(Array.isArray(f?.evidence) ? f.evidence : []),
    ...(f?.url ? [f.url] : []),                       // KNOCKOUT PROSE ARM 2026-08-06
  ].map((u) => String(u ?? "").trim()).filter(Boolean);
}

/**
 * Every cited URL ∈ that mark's own raw research payload on disk.
 *
 * WHAT A ZERO MEANS, because this gate can pass without doing anything: a batch whose findings cite no
 * URLs at all is `ok` with `checked.urls === 0`. That is not the same answer as "every citation was
 * traced" and the counts ride the result so a caller can say which it got — publishKnockout records them
 * in the lint receipt. A mark that cites URLs and has NO payload is a failure, never a skip: the
 * null-results doctrine says a degraded mark cannot cite evidence it never held.
 *
 * @returns {{ok: boolean, failures: string[], checked: {marks: number, citing: number, findings: number, urls: number}}}
 */
export function knockoutReceipts(runDir, marks) {
  const failures = [];
  const checked = { marks: (marks ?? []).length, citing: 0, findings: 0, urls: 0 };
  for (const m of marks ?? []) {
    const list = Array.isArray(m?.findings) ? m.findings : [];
    checked.findings += list.length;
    let payload = null, opened = false;
    for (const f of list) {
      const cited = knockoutCitedUrls(f);
      if (!cited.length) continue;
      if (!opened) {
        opened = true;
        checked.citing += 1;
        try { payload = readFileSync(join(runDir, "research", `${kebab(m.name)}.md`), "utf8"); } catch { payload = null; }
      }
      for (const url of cited) {
        checked.urls += 1;
        if (payload == null) { failures.push(`knockout_url_unreceipted:${m.name}: cites "${url}" but the mark has no research payload — a degraded mark cannot cite URLs`); continue; }
        if (!urlInPayload(url, payload)) failures.push(`knockout_url_unreceipted:${m.name}: "${url}" does not appear in the mark's research payload — cite only held evidence`);
      }
    }
  }
  return { ok: failures.length === 0, failures, checked };
}

// ── ratingQualifier: the closed SECOND axis (owner ruling, 2026-08-06) ────────────────────────
//
// The band is the rating; the qualifier is the only sub-gradation the doctrine allows, and until now it
// was free text on the mark row — validated by nothing, rendered verbatim on the client page
// (render-knockout.mjs), in the cover note (publish/knockout.mjs) and in the scorer. Free text in a
// rating field is a second vocabulary waiting to happen, which is exactly what rules out.
//
// THE SET IS ONE WORD, and it is one word because ONE is what the doctrine attests. knockout-assess
// SKILL.md exemplifies "Medium (low)" and calibration rule 6 says enforcer profiling "can cap a middle
// band at its '(low)' qualifier". Nothing in the doctrine, and no artifact in this repo, carries any
// other value. So the qualifier can SOFTEN a band and never sharpen it — minting "high" or "mid" to make
// the set look like a scale would be this build inventing vocabulary in the change that forbids it.
//
// ABSENCE, RECORDED. Calibration rule 5 tells the model to use a customer framework's own dispute-type
// notation (an A–E matrix) "exactly", and the mark row has no field for one: the framework manifest
// carries band words and order ONLY (framework.mjs: never a mapping table), so there is no vocabulary to
// validate such a notation against. It is not admitted here — a notation smuggled into this field would
// be the free text this closes. Raised as a finding rather than routed around.
//
// TOLERANT AT THE CHUNK, CANONICAL IN THE ARTIFACT — the same two-step the band takes (the chunk gate
// accepts the deck's word in any casing, validateKnockoutFindings writes back the manifest's own). The
// step matters because three surfaces print this field VERBATIM: the cover note wraps it in parentheses
// (`publish/knockout.mjs`), so a row that passed carrying "(Low)" would reach a client as "Medium
// ((Low))", and the scorer would double it again. Accepting a form and rendering it wrong is worse than
// refusing it, so the merged gate normalises rather than trusting what the turn typed.
// ──: the TYPED read, and the sentence the model may not write ──────────────────────────────────
//
// THE FIELDS ARE MANDATORY, and they are enforced here rather than patched at render for the reason
// settled: a renderer that repairs a contract is a renderer that hides the contract being broken.
// A chunk without them is invalid_file and the stage re-asks — the same outcome the typed-findings gate
// produces for a pre-contract chunk on a resume, and the correct one: the report renders these
// fields, and a paragraph cannot fill them.
export const READ_FIELDS = Object.freeze(["basis", "factors", "counterFactors", "mitigation"]);

// The register claim the model must never make. It cannot see the count lane — it is deliberately never
// shown the figures — so anything it says about register coverage is invention, and on 2026-08-11 the
// invention ("the register overlay has not been run") shipped directly above the counts the same run had
// taken. The renderer owns the sentence and writes it from the sidecars.
//
// DELIBERATELY NARROW: it fires on an assertion about whether a register WAS or WAS NOT searched,
// counted, run or checked. It does not fire on the standing caveat about register analysis adjusting a
// rating later (which validateMergedFindings separately REQUIRES), and it does not fire on naming a
// register as the source of a filing — both are things the turn legitimately knows.
export const REGISTER_CLAIM_RE =
  /\b(?:register|registry|registers|trademark office)\s+(?:overlay\s+|search(?:es)?\s+|check(?:s)?\s+|count(?:s)?\s+|data\s+)?(?:has|have|was|were|is|are)\s+(?:not\s+|n't\s+|yet\s+)?(?:been\s+)?(?:run|searched|checked|counted|performed|conducted|reviewed|carried out)\b/i;

// ── THE SUMMARY'S SHAPE (tracker issues 1934, 2056) ──────────────────────────────────────────────────
//
// Owner ruling 2026-08-31: "keep the length, add the structure, so long as length is consistent more or
// less." Two rules follow, and they are deliberately unlike each other.
//
// 1. AN H1 IS A CORRECTNESS DEFECT, refused outright. `# ` opens a SECTION of the delivered report:
//    publish/parse.mjs splits report.md on /^# /m and portal-report.mjs's batchSummaryOf terminates on
//    it. A single hash inside a summary therefore ENDS that summary at that line and drops the rest from
//    the client's page — silently, with nothing anywhere reporting a loss. The seat is told twice to use
//    `## `, so this is always one character for it to fix.
//
// 2. AN UNBROKEN WALL OF TEXT is refused only once it is long enough that the wall IS the defect.
//    This is not a length cap and cannot become one — no model on this engine gets a length budget, and
//    the same ruling says keep the length. It asks for a break, not a cut: a 4,000-character assessment
//    with sub-headers passes and a 900-character one with no newline at all does not. The floor sits
//    well above any honest single paragraph so that a genuinely short read is never blocked, because a
//    refusal this seat cannot satisfy exhausts the ladder and costs the client the whole report — and a
//    formatting rule must never be able to do that.
export const SUMMARY_SECTION_BREAK_RE = /^[ \t]*#[ \t]+\S/m;
/** Above this, prose with no break at all is the defect the ruling names. NOT a ceiling — see above. */
export const UNBROKEN_PROSE_CHARS = 900;
/** Is this summary field an unreadable wall? PURE. */
export function isUnbrokenWall(s) {
  const t = String(s ?? "").trim();
  return t.length > UNBROKEN_PROSE_CHARS && !/\n/.test(t);
}

// ── THE REGISTER READ, JOINED TO DISK ───────────────────────────────────────────
//
// The rater is handed this run's fetched filings and told to weigh them. Until now nothing it concluded
// about an individual filing could reach the page: a promoted register card had no band and no rater
// text, so it printed one constant for every filing on every run. 1935's own acceptance line asked for
// the opposite — "a filing the rater weighed shows its read; one it did not carries a stated reason,
// never a label that says the product does not do the thing it just did."
//
// WHY THE KEY IS A RECORD ID AND NOT A LABEL. stages.mjs already classifies the clearance lane's
// `source_type` as `mechanical:code-extracted`, on the stated ground that "the lane that produced the
// record is a driver fact". The same rule applies here, so the seat cites the record's OWN id out of the
// file it was given and the driver joins it; nothing downstream trusts a word the seat typed about its
// own sourcing. An id that is not in this mark's record store is refused by name.
//
// ABSENCE IS NEVER REFUSED. A seat that cites nothing produces exactly today's page — the neutral card
// line, which is true — so this can never cost a client a report over a field the run did not need.
/** Every register recordId this run holds for `markName`. Empty set when the lane did not run. PURE-ish (reads disk). */
export function registerRecordIdsFor(runDir, markName) {
  const doc = readJson(driverDir(runDir, "register-records.json"));
  const want = String(markName ?? "").trim().toLowerCase();
  const entry = (Array.isArray(doc?.marks) ? doc.marks : []).find((e) => String(e?.name ?? "").trim().toLowerCase() === want);
  return new Set((Array.isArray(entry?.records) ? entry.records : [])
    .map((r) => String(r?.recordId ?? "").trim()).filter(Boolean));
}

export const KNOCKOUT_RATING_QUALIFIERS = ["low"];
export function normalizeKnockoutQualifier(v) {
  const word = String(v ?? "").trim().replace(/^\(+|\)+$/g, "").trim().toLowerCase();
  return KNOCKOUT_RATING_QUALIFIERS.find((q) => q === word) ?? null;
}

// ── Ladder helpers over the frozen framework manifest ────────────────────────────────────────────────
const readJson = (p) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };
const ladderOf = (fw) => (Array.isArray(fw?.bands) ? fw.bands.map((b) => String(b.label)) : []);
const bandIdx = (ladder, word) => ladder.findIndex((l) => l.toLowerCase() === String(word ?? "").trim().toLowerCase());
// classesDriving is mandatory ABOVE the two lowest bands ("the material bands" — MEDIUM+ on a 5-tier
// ladder, the interactive skill's rule, generalized by position); registerEstimate above the lowest.
const materialIdxMax = (ladder) => ladder.length - 3;   // inclusive index bound for "material"

// ── Stage validators (runStage corrective-ladder shape) ──────────────────────────────────────────────
export const validators = {
  // knockout-plan.json — strict: closed keys, one row per instructed mark (name parity vs the
  // code-authoritative instructed scope), Nice ints, executionOrder a permutation of the names.
  knockoutPlan(file, text) {
    let p;
    try { p = JSON.parse(text); } catch (e) { return { ok: false, reason: `not valid JSON: ${e.message}` }; }
    if (p?.schema !== 1) return { ok: false, reason: "schema must be 1" };
    if (!p.batch || typeof p.batch.productContext !== "string" || !p.batch.productContext.trim())
      return { ok: false, reason: "batch.productContext (string) is required" };
    if (!Array.isArray(p.marks) || !p.marks.length) return { ok: false, reason: "marks[] is required" };
    const MARK_KEYS = ["ref", "name", "classes", "beltAndBraces", "classesPlain", "contextFraming", "priorKnowledge", "priority"];
    for (const m of p.marks) {
      for (const k of Object.keys(m)) if (!MARK_KEYS.includes(k)) return { ok: false, reason: `plan mark key "${k}" is not in the closed contract` };
      if (typeof m.name !== "string" || !m.name.trim()) return { ok: false, reason: "every plan mark needs a verbatim name" };
      if (typeof m.classesPlain !== "string" || !m.classesPlain.trim()) return { ok: false, reason: `mark "${m.name}": classesPlain (the sweep prompt's plain-language class line) is required` };
      if (typeof m.contextFraming !== "string" || !m.contextFraming.trim()) return { ok: false, reason: `mark "${m.name}": contextFraming is required (the rating hangs off it)` };
      for (const ck of ["classes", "beltAndBraces"]) {
        if (m[ck] != null && (!Array.isArray(m[ck]) || !m[ck].every((n) => Number.isInteger(n) && n >= 1 && n <= 45)))
          return { ok: false, reason: `mark "${m.name}": ${ck} must be Nice-class integers (1–45)` };
      }
    }
    // research-key collisions: per-mark artifacts are keyed on kebab(name) — two marks sharing a key
    // would silently share ONE research payload (one never swept, assessed against the other's evidence).
    const collisions = kebabCollisions(p.marks.map((m) => m.name));
    if (collisions.length)
      return { ok: false, reason: `marks ${collisions.map(([a, b]) => `"${a}"/"${b}"`).join(", ")} collide to the same research key — a batch cannot carry two marks that differ only in spacing/punctuation/case; drop or reword one` };
    // name parity vs the instructed scope (the paraphrase-drift gate)
    const scope = readJson(driverDir(dirname(file), "instructed-scope.json"));
    const instructed = Array.isArray(scope?.marks) ? scope.marks : (scope?.marks ? [scope.marks] : null);
    if (instructed?.length) {
      const want = new Set(instructed.map(nameKey));
      const got = new Set(p.marks.map((m) => nameKey(m.name)));
      for (const w of want) if (!got.has(w)) return { ok: false, reason: `plan is missing instructed mark "${w}" (names must match the instructed scope verbatim)` };
      for (const g of got) if (!want.has(g)) return { ok: false, reason: `plan invents mark "${g}" — not in the instructed scope` };
    }
    if (Array.isArray(p.batch.executionOrder)) {
      const got = new Set(p.marks.map((m) => nameKey(m.name)));
      for (const n of p.batch.executionOrder) if (!got.has(nameKey(n))) return { ok: false, reason: `executionOrder names "${n}" which is not a plan mark` };
    }
    return { ok: true };
  },

  // one assess CHUNK (knockout-assess-<n>.json, at the RUN ROOT since the relocation off the guarded
  // tree — it is a model output, and `_driver/` is for the driver's own measurements) — per-mark contract
  // + tone + the URL-receipts
  // gate against each mark's own research payload (so the corrective ladder fires per chunk).
  // CODE-side joins (never the model's say-so): chunk MEMBERSHIP against _driver/knockout-chunks.json
  // (the assignment sidecar the lane writes before assess) and DEGRADED status against the research
  // payloads on disk — "Rate ONLY these marks" and "never silently clean" are enforced here, not
  // merely prompted, so the corrective ladder fires per chunk and a resume can never skip a stale lie.
  knockoutAssessChunk(file, text) {
    let c;
    try { c = JSON.parse(text); } catch (e) { return { ok: false, reason: `not valid JSON: ${e.message}` }; }
    if (!Array.isArray(c?.marks) || !c.marks.length) return { ok: false, reason: "marks[] is required" };
    // THE RUN DIR IS DERIVED FROM THE CHUNK'S PATH, SO IT MOVED WHEN THE CHUNK DID. This was
    // `dirname(dirname(file))` with the comment "chunk lives in _driver/" — a fixed DEPTH assumption,
    // correct only while the chunk sat one level down. The chunk is a model output and now lands at the
    // run root, so two levels up overshoots and every lookup below it (research payloads, the chunks
    // sidecar, framework.json) resolves against the wrong directory — which surfaces as the honest-looking
    // but false "the driver holds NO research payload for this mark".
    // Both shapes are tolerated because the reader still falls back to the legacy path for runs written
    // before the move.
    const chunkDir = dirname(file);
    const runDir = basename(chunkDir) === DRIVER_DIR ? dirname(chunkDir) : chunkDir;
    const fw = readJson(driverDir(runDir, "framework.json"));
    const ladder = ladderOf(fw);
    // Whether this batch has more than one mark — the DRIVER's read off the frozen plan, never counted
    // from this chunk. A chunk is a slice: a two-chunk run has chunks of one mark each, and counting
    // locally would call a real multi-mark batch single and waive the per-mark assessment on exactly the
    // runs that need it. Unreadable plan ⇒ false ⇒ the requirement does not fire, because a driver-side
    // read that failed must not re-ask a seat for something no seat can repair (the same ruling the
    // ladder read below carries).
    const batchIsMultiMark = (() => {
      const plan = readJson(join(runDir, "knockout-plan.json"));
      return Array.isArray(plan?.marks) && plan.marks.length > 1;
    })();
    // — AN EMPTY LADDER IS NOW AN OBSERVABLE, NOT A SILENT SKIP. The three band checks below are
    // each guarded on `ladder.length`, so an empty one lets every rating in this chunk through unchecked
    // and says nothing at all — a run the ladder never constrained reads exactly like one it did.
    //
    // Deliberately NOT a validator failure. This validator rides the corrective ladder, so `{ok:false}`
    // re-asks the SEAT, and an unreadable framework sidecar is a DRIVER fault no seat can repair: the
    // re-ask would burn attempts on an instruction no turn can satisfy. The refusal belongs where it
    // costs nothing — `readBackLadder` in pipeline-knockout.mjs, at the freeze, before any dispatch.
    // What belongs HERE is the record that this chunk's ratings were never constrained.
    if (!ladder.length) {
      runLog(runDir, { event: "knockout-band-checks-inert", stage: "knockout-assess", chunk: file,
        framework: driverDir(runDir, "framework.json"),
        detail: "empty band ladder — knockout_band_unknown, classesDriving and registerEstimate all passed without checking anything" });
    }
    const chunkNo = Number(file.match(/knockout-assess-(\d+)\.json$/)?.[1] ?? NaN);
    // membership: the chunk may rate exactly its assigned marks — no invention, no neighbour-chunk
    // overrun (a duplicate row across chunks would double-render in the report), no omission.
    const chunksSidecar = readJson(driverDir(runDir, "knockout-chunks.json"));
    const assigned = Number.isInteger(chunkNo) && Array.isArray(chunksSidecar?.chunks) ? chunksSidecar.chunks[chunkNo] : null;
    if (Array.isArray(assigned)) {
      const want = new Set(assigned.map(nameKey));
      const seen = new Set();
      for (const m of c.marks) {
        const k = nameKey(m?.name);
        if (!want.has(k)) return { ok: false, reason: `chunk ${chunkNo} rates "${m?.name}" which is not assigned to it — rate ONLY this chunk's marks` };
        if (seen.has(k)) return { ok: false, reason: `chunk ${chunkNo} rates "${m?.name}" twice — one row per mark` };
        seen.add(k);
      }
      for (const w of want) if (!seen.has(w)) return { ok: false, reason: `chunk ${chunkNo} is missing its assigned mark "${w}"` };
    }
    // per-chunk summary: EVERY chunk narrates its own marks; code composes the whole-batch executive
    // summary by concatenation (without this, marks beyond chunk 0 silently vanish from the summary).
    if (typeof c.chunkSummary !== "string" || !c.chunkSummary.trim())
      return { ok: false, reason: "chunkSummary (the cross-mark read covering THIS chunk's marks) is required — code composes the batch summary from the chunks" };
    if (SUMMARY_SECTION_BREAK_RE.test(c.chunkSummary))
      return { ok: false, reason: `chunkSummary carries an "# " heading. A single hash opens a SECTION of the report, so the client's summary ends at that line and everything after it is dropped from the page with nothing reporting the loss. Sub-headers here are "## " or "### "` };
    if (isUnbrokenWall(c.chunkSummary))
      return { ok: false, reason: `chunkSummary is ${c.chunkSummary.trim().length} characters with no line break in it — the grouped page opens with this and a reader cannot scan a wall. Keep the length; add the structure: a short opening line, then one "## <MARK NAME>" sub-header per mark, bullets where they help` };
    if (chunkNo === 0 && !(c.batch && typeof c.batch.productContext === "string" && c.batch.productContext.trim()))
      return { ok: false, reason: "chunk 0 must carry the batch object (productContext at minimum)" };
    for (const m of c.marks) {
      if (typeof m.name !== "string" || !m.name.trim()) return { ok: false, reason: "every mark needs a name" };
      // degraded parity vs the DISK truth (the sweep's payload/.failed sentinels), both directions:
      // a mark without a payload can never be rated as researched, and a mark WITH one can't hide
      // behind a degraded flag (fresh evidence must be assessed, e.g. after a resume re-sweep).
      const payloadExists = existsSync(join(runDir, "research", `${kebab(m.name)}.md`));
      if (!payloadExists && !m.degraded)
        return { ok: false, reason: `mark "${m.name}": the driver holds NO research payload for this mark — the row must carry degraded:true (null-results doctrine; a degraded mark can never be silently clean)` };
      if (payloadExists && m.degraded)
        return { ok: false, reason: `mark "${m.name}": a research payload exists but the row claims degraded — assess the held evidence` };
      const rating = norm(m.rating);
      if (!rating) return { ok: false, reason: `mark "${m.name}": rating is required` };
      if (ladder.length && bandIdx(ladder, rating) < 0)
        return { ok: false, reason: `knockout_band_unknown:${m.name}: rating "${rating}" is not in the frozen ladder (${ladder.join(" / ")}) — rate in the framework's own vocabulary` };
      // the second axis, closed here because this is where the first one is closed ( owner ruling)
      if (m.ratingQualifier != null && !normalizeKnockoutQualifier(m.ratingQualifier))
        return { ok: false, reason: `knockout_qualifier_unknown:${m.name}: ratingQualifier "${m.ratingQualifier}" is not one of ${KNOCKOUT_RATING_QUALIFIERS.join(" / ")} — the qualifier is a closed sub-gradation that can only cap a band, and anything else belongs in the band word itself` };
      if (!Array.isArray(m.bullets) || m.bullets.length < 1 || m.bullets.length > 5)
        return { ok: false, reason: `mark "${m.name}": 1–5 evidence bullets required` };
      // — the typed read. Each field says what it is for in its own failure message, because the
      // corrective ladder re-asks the turn with this string and "basis is required" teaches nothing.
      if (typeof m.basis !== "string" || !m.basis.trim())
        return { ok: false, reason: `knockout_read_incomplete:${m.name}: "basis" is required — ONE sentence saying why this band, for this name, in these classes. The report renders it as the lead line; a paragraph in "bullets" cannot fill it` };
      if (!Array.isArray(m.factors) || m.factors.length < 2 || m.factors.length > 4
        || !m.factors.every((f) => typeof f === "string" && f.trim()))
        return { ok: false, reason: `knockout_read_incomplete:${m.name}: "factors" must be 2–4 non-empty one-line strings — the load-bearing observations behind the band, one per line, rendered as a bullet list` };
      if (!Array.isArray(m.counterFactors) || m.counterFactors.length < 1 || m.counterFactors.length > 3
        || !m.counterFactors.every((f) => typeof f === "string" && f.trim()))
        return { ok: false, reason: `knockout_read_incomplete:${m.name}: "counterFactors" must be 1–3 non-empty one-line strings — what holds this name at this band rather than the next one, either way` };
      // MITIGATION MAY BE EMPTY, and the empty string is the ANSWER rather than the absence of one:
      // some names have nothing that would move them, and forcing a sentence there invents advice. The
      // key must still be present, so "nothing would move it" is a thing the turn said, not a thing it
      // forgot — an absent key and a considered "none" read identically on the page otherwise.
      if (typeof m.mitigation !== "string")
        return { ok: false, reason: `knockout_read_incomplete:${m.name}: "mitigation" is required (may be "" when nothing would move the band — but the key must be there, so a considered "none" is not confusable with an omission)` };
      // class arrays are Nice-class INTEGERS — they interpolate into report/email HTML, so a free-string
      // here is both a contract break and an injection surface (review 2026-07-17).
      for (const ck of ["classesSearched", "classesDriving"]) {
        if (m[ck] != null && (!Array.isArray(m[ck]) || !m[ck].every((n) => Number.isInteger(n) && n >= 1 && n <= 45)))
          return { ok: false, reason: `mark "${m.name}": ${ck} must be Nice-class integers (1–45)` };
      }
      const idx = ladder.length ? bandIdx(ladder, rating) : -1;
      if (ladder.length && idx <= materialIdxMax(ladder) && !(Array.isArray(m.classesDriving) && m.classesDriving.length))
        return { ok: false, reason: `mark "${m.name}": classesDriving is mandatory at "${rating}" (class-specific ratings — calibration rule 1)` };
      // ── CONDITIONAL SINCE RF-15 v3, AND IT HAD TO MOVE WITH THE DOCTRINE ──────
      //
      // This demanded `registerEstimate` on every mark above the lowest band, unconditionally, citing
      // calibration rule 4 — the rule that is now retired. Shipping that retirement without this line
      // would break the lane outright rather than subtly: the seat stops emitting the field because its
      // doctrine no longer orders it, and this arm refuses every chunk. The two are one change.
      //
      // The replacement is the doctrine's own three states: estimation becomes CONFIRMATION once the
      // register actually ran. So the estimate is owed exactly where it is still the honest answer —
      // when this run holds no fetched records — and is not owed where it would be a guess printed
      // beside the filings it is guessing about.
      //
      // THE DRIVER'S READ, NOT THE SEAT'S. Whether the register ran is a fact about the run; a seat that
      // could assert it could waive its own requirement by claiming a lane it cannot see. `dirname(file)`
      // is the run dir — `assessChunk` writes `knockout-assess-<n>.json` into it (stages-knockout.mjs).
      const registerRan = existsSync(driverDir(dirname(file), "register-records.json"));
      if (!registerRan && ladder.length && idx < ladder.length - 1 && !(typeof m.registerEstimate === "string" && m.registerEstimate.trim()))
        return { ok: false, reason: `mark "${m.name}": registerEstimate is required above the lowest band on a run with no fetched register records (RF-15 v3 — estimation stands where the register did not run)` };
      // ── THE PER-MARK OPENING ASSESSMENT IS OWED ON A MULTI-MARK BATCH ───────
      //
      // ONLY on a multi-mark batch, and that is the whole scope of it. A single-mark run's document
      // keeps the batch paragraph — for one mark that paragraph IS about that mark, publish does not
      // blank it, and the page already opens with a model-authored read. Requiring a second one there
      // would buy a paragraph nobody renders.
      //
      // The blank this replaces only ever appeared on a per-mark document of a MULTI-mark run: the batch
      // paragraph names every mark, so publish blanked it rather than put other clients' marks on this
      // client's page, and nothing owed a replacement.
      //
      // Owner ruling: every mark's own report opens with a model-authored paragraph about that mark.
      // Required rather than optional, because the failure it replaces was a page that opened with
      // NOTHING and looked deliberate — publish blanked the batch paragraph on a per-mark document (it
      // names other clients' marks) and no one field owed a replacement.
      //
      // NO LENGTH CEILING, DELIBERATELY. The ruling is that this is not rationed. A floor only: a
      // one-line "assessment" is the shape that would satisfy a required field while giving the reader
      // less than the blank did, because a blank at least does not look like the answer.
      //
      // THE SIBLING-NAME RULE IS NOT CHECKED HERE, and that is a scope statement rather than an
      // omission. This validator sees ONE CHUNK, so it knows only the marks in it — a check written
      // here would refuse a sibling from this chunk, pass one from the next, and read like a complete
      // guard. The batch's full mark set is known at publish and in the fan-out arms, which is where
      // the residue rule is asserted.
      if (batchIsMultiMark && !(typeof m.assessment === "string" && m.assessment.trim().length >= 120))
        return { ok: false, reason: `mark "${m.name}": assessment is the opening paragraph this mark's own report leads with — required on a multi-mark batch, and at least a paragraph. A single line here reads as the answer while telling the reader less than the blank it replaced` };
      if (typeof m.assessment === "string" && SUMMARY_SECTION_BREAK_RE.test(m.assessment))
        return { ok: false, reason: `mark "${m.name}": assessment carries an "# " heading. A single hash opens a SECTION of the report, so this mark's summary ends at that line and the rest of it never reaches the client. Sub-headers are "## " or "### "` };
      if (isUnbrokenWall(m.assessment))
        return { ok: false, reason: `mark "${m.name}": assessment is ${String(m.assessment).trim().length} characters with no line break in it. Keep the length — it is not rationed and nothing here is asking you to cut it — but give it structure a reader can scan: sub-headers where the content divides, "- " bullets for the load-bearing points, a blank line between blocks` };
      // — the register reads and the per-finding weighed lists, both joined to the store.
      if (m.registerReads !== undefined && m.registerReads !== null) {
        if (!Array.isArray(m.registerReads))
          return { ok: false, reason: `mark "${m.name}": registerReads must be an ARRAY of { recordId, read } rows, or omitted entirely` };
        const held = registerRecordIdsFor(runDir, m.name);
        for (const row of m.registerReads) {
          const id = String(row?.recordId ?? "").trim();
          const read = String(row?.read ?? "").trim();
          if (!id) return { ok: false, reason: `mark "${m.name}": a registerReads row has no recordId — cite the record's own id, verbatim from the filings you were given` };
          if (!read) return { ok: false, reason: `mark "${m.name}": registerReads row "${id}" has an empty read. Omit the row rather than sending an empty one: a filing with no read keeps the card's neutral line, which is true` };
          if (!held.has(id))
            return { ok: false, reason: `mark "${m.name}": registerReads cites "${id}", which is not a record this run holds for that mark. The id must be copied from the filings you were handed — the driver joins it against the store and never takes your word for it` };
        }
      }
      for (const f of (Array.isArray(m.findings) ? m.findings : [])) {
        if (f?.weighedFilings === undefined || f?.weighedFilings === null) continue;
        if (!Array.isArray(f.weighedFilings))
          return { ok: false, reason: `mark "${m.name}": findings[].weighedFilings must be an ARRAY of register record ids, or omitted` };
        const held = registerRecordIdsFor(runDir, m.name);
        for (const raw of f.weighedFilings) {
          const id = String(raw ?? "").trim();
          if (!id || !held.has(id))
            return { ok: false, reason: `mark "${m.name}": finding "${f?.name}" lists weighedFilings "${id}", which is not a record this run holds for that mark. The source chip is derived from this list, so an id the driver cannot join would put a Register label on a finding with no register evidence` };
        }
      }
      if (m.degraded && !(Array.isArray(m.purpleNotes) && m.purpleNotes.some((n) => /manual verification/i.test(n))))
        return { ok: false, reason: `mark "${m.name}": degraded marks must carry the purple "Manual verification recommended" note (null-results doctrine)` };
      // The prose span the tone/quant/permission checks sweep GREW with the typed read: the
      // fields are the sentences a reader now sees FIRST, so a banned tone or a fabricated quantity in
      // `basis` reaches the page ahead of anything in `bullets`. A check whose span stops short of the
      // most prominent prose on the card is a check that stopped working the day the card changed.
      const prose = [m.contextFraming, m.basis, ...(m.factors ?? []), ...(m.counterFactors ?? []), m.mitigation,
        ...(m.bullets ?? []), ...(m.purpleNotes ?? []), m.registerEstimate].filter(Boolean).join("\n");
      // — the model may not speak for the register lane. Checked over the mark's whole prose and
      // over this chunk's summary: the live defect was in the summary, and the fields are new surface
      // for exactly the same invention.
      const claim = [prose, c.chunkSummary].filter(Boolean).join("\n").match(REGISTER_CLAIM_RE);
      if (claim)
        return { ok: false, reason: `knockout_register_claim:${m.name}: "${claim[0].trim()}" — this turn cannot see the register lane and must not describe it. The report states register coverage in code, from the run's own count sidecar; a summary that says the registers were not run, above a table of counts that were, is the contradiction this rule closes. Delete the clause` };
      const banned = prose.match(BANNED_TONE_RE);
      if (banned) return { ok: false, reason: `mark "${m.name}": banned tone "${banned[0]}" — measured tone only (the band colour carries urgency)` };
      const quant = prose.match(QUANT_CLAIM_RE);
      if (quant) return { ok: false, reason: `mark "${m.name}": quantitative claim "${quant[0].trim()}" — describe nature and reach, never counts/figures` };
      // PR-5 — a "tool was blocked / lacked permission" explanation for missing coverage is a false
      // excuse on this lane too (register work is a PENDING framing here, never an outage story). Fires
      // in the chunk validator so the corrective ladder re-asks THIS chunk with the quoted lines.
      const perm = permissionProseChecks({ text: prose, surface: "findings", idSuffix: ":knockout", structural: true, cards: false }).filter((c) => !c.pass);
      if (perm.length) return { ok: false, reason: `mark "${m.name}": ${perm[0].detail}` };
      // THE TYPED RECORD. findings-model.mjs owns the shape; this is where it becomes a GATE.
      // Unconditional — no shape sniffing: this validator only ever reads a chunk THIS run's assess turn
      // just wrote, so a "looks like the old shape, validate it loosely" arm could only ever be a way to
      // skip the check. A resumed run holding a pre- chunk file fails here and re-asks the turn
      // (pipeline-knockout.mjs koStage logs stage-stale and re-runs), which is the correct outcome: the
      // report renders `net`/`basis`/`evidence[]` and a prose row cannot fill them.
      //
      // The renumber this validator also performs is DELIBERATELY discarded here — `c` is a parse of the
      // chunk file and is thrown away, so the file on disk keeps the numbers the model wrote, which is
      // what an audit of the turn wants to read. The numbering that ships is written once, on the merged
      // artifact (validateMergedFindings below), which is the object every surface renders from.
      try { validateKnockoutFindings(m.findings, { manifest: fw }); }
      catch (e) { return { ok: false, reason: `mark "${m.name}": ${e.message}` }; }
      // URL-receipts gate: every cited URL ∈ that mark's raw payload (one function, three doors)
      const rec = knockoutReceipts(runDir, [m]);
      if (!rec.ok) return { ok: false, reason: rec.failures[0] };
    }
    return { ok: true };
  },
};

// ── Merged-findings validation + the pre-publish lint (code-side; structural gate) ───────────────────
/**
 * Did register analysis SURFACE LIVE FILINGS on this run? —.
 *
 * THE ONE DERIVATION, exported so the producer and this verifier ask the same question of the same file.
 * They disagreed: pipeline-knockout injected the standing caveat only when the seat supplied none AND the
 * register surfaced nothing, while the lint below required it UNCONDITIONALLY. Any run where the seat
 * supplied its own caveats — or where the register surfaced filings — failed by construction. R13's first
 * run ever died there with all four marks rated and its reasoning intact.
 *
 * Records present AND non-empty: a file that exists with nothing in it is a register that surfaced no
 * filings, which is exactly the case the caveat is still true for.
 */
export function registerSurfacedFilings(recordsPath, { read = readFileSync } = {}) {
  try {
    const doc = JSON.parse(read(recordsPath, "utf8"));
    const rows = Array.isArray(doc) ? doc : (doc?.records ?? doc?.marks ?? []);
    return Array.isArray(rows) && rows.length > 0;
  } catch { return false; }
}

/**
 * The survivor sentence's signature, and the engine's own caveats.
 *
 * MOVED HERE FROM pipeline-knockout SO THERE IS ONE DERIVATION, for the identical reason tracker issue
 * 1926 moved `registerSurfacedFilings`: the producer and the verifier were asking different questions of
 * the same array, and two predicates that must agree forever is how they stop agreeing.
 *
 * `pipeline-knockout.mjs` re-exports `SURVIVOR_BOUNDARY_RE` so its existing importers are untouched; the
 * import direction is producer -> verifier, and it cannot be the other way without a cycle.
 */
export const SURVIVOR_BOUNDARY_RE = /not knocked out at this screen's depth/i;

/**
 * Is this caveat the ENGINE'S OWN WORDS rather than the rater's?
 *
 * The engine appends two, both stated in code because the assessing model cannot see the facts behind
 * them: the survivor boundary, and the capability-skipped note. Neither is something "the rater
 * supplied", and telling them apart is the whole of — the standing-caveat lint asked
 * "did the rater supply caveats?" of an array the engine had already written into, so from the moment
 * the survivor sentence was appended the answer was always yes and the check could never fire again.
 */
export function isEngineAppendedCaveat(text) {
  const t = String(text ?? "");
  if (SURVIVOR_BOUNDARY_RE.test(t)) return true;
  return Object.values(CAPABILITY_SKIPPED_NOTE).some((note) => t.trim() === String(note).trim());
}

/**
 * What the RATER actually supplied: non-blank, and none of the engine's own sentences.
 *
 * Blank entries were never caveats. They mattered because the producer counted them (`?.length`) while
 * the verifier did not, so an array of `["", "  "]` meant "the rater supplied two" to one side and
 * "supplied none" to the other — a second disagreement, hidden underneath the first.
 */
export function raterCaveats(list) {
  return (Array.isArray(list) ? list : [])
    .filter((c) => String(c ?? "").trim() && !isEngineAppendedCaveat(c));
}

export function validateMergedFindings(runDir, merged, plan) {
  const failures = [];
  if (merged?.schema_version !== 1) failures.push("schema_version must be 1");
  if (!merged?.batch?.executiveSummary || !String(merged.batch.executiveSummary).trim()) failures.push("batch.executiveSummary is required");
  // — THE VERIFIER LEARNS THE DOCTRINE'S OWN CONDITION, which the producer already
  // knew. This required the caveat unconditionally while pipeline-knockout injected it only when the seat
  // supplied none AND the register surfaced no filings. The seat was right and the lint was wrong: a run
  // where the rater writes its own matter-specific caveats failed by construction, and the message named
  // a missing caveat, sending a reader to the rater who had done nothing wrong.
  //
  // RF-10 v3: when register analysis ran AND surfaced live filings, the caveat is FALSE — it describes
  // work that already happened — so requiring it would be requiring an untruth.
  // — THE RATER'S CAVEATS, not the array. This filtered blanks only, so the survivor
  // sentence the engine appends unconditionally a few lines before the one call to this function made
  // `supplied` non-empty on every real document. Measured: the standing caveat entirely absent, the lint
  // silent. Six arms drove a shape the producer never emits.
  const supplied = raterCaveats(merged?.batch?.standardCaveats);
  // Searched across the WHOLE array, not just the rater's: the standing caveat is a specific sentence and
  // it counts wherever it sits. `supplied` answers "does this run owe one"; this answers "is one there".
  const caveats = (merged?.batch?.standardCaveats ?? []).map((c) => String(c ?? "")).join(" ");
  const owed = supplied.length === 0
    && !registerSurfacedFilings(driverDir(runDir, "register-records.json"));
  if (owed && !/register analysis may adjust/i.test(caveats)) {
    failures.push('the standing caveat ("Register analysis may adjust ratings in either direction") is '
      + "missing, and this run owes it: the rater supplied no caveats of its own and the register "
      + "surfaced no filings");
  }
  const marks = merged?.marks ?? [];
  // duplicates BEFORE the Map join (a Map would silently collapse a mark rated in two chunks while the
  // report renders both rows — review 2026-07-17)
  const keys = marks.map((m) => nameKey(m.name));
  const dup = keys.find((k, i) => keys.indexOf(k) !== i);
  if (dup) failures.push(`mark "${dup}" has more than one rating row — chunks overlapped; one row per mark`);
  const planned = new Set((plan?.marks ?? []).map((m) => nameKey(m.name)));
  const rated = new Map(marks.map((m) => [nameKey(m.name), m]));
  for (const p of planned) if (!rated.has(p)) failures.push(`planned mark "${p}" has no rating row`);
  for (const r of rated.keys()) if (planned.size && !planned.has(r)) failures.push(`rated mark "${r}" was never planned`);
  // degraded parity vs the DISK truth (belt-and-braces over the per-chunk check — resume-proof: the
  // payload/.failed sentinels are the driver's ground truth, never the model's echo)
  for (const m of marks) {
    const payloadExists = existsSync(join(runDir, "research", `${kebab(m.name)}.md`));
    if (!payloadExists && !m.degraded) failures.push(`mark "${m.name}" has no research payload but is not flagged degraded — a degraded mark can never be silently clean`);
    if (payloadExists && m.degraded) failures.push(`mark "${m.name}" has a research payload but is flagged degraded — held evidence must be assessed`);
  }
  // PR-5 — permission-prose backstop over the MERGED text (chunk files can predate the per-chunk check
  // on a resume): the batch summary + every mark's prose. Same check the clearance gate closes on: a
  // fabricated tool-blocked excuse never ships from either lane. NOTE the span — executiveSummary plus
  // each mark's contextFraming/bullets/purpleNotes/registerEstimate. It does NOT cover findings[].name /
  // .description, which the report renders onto the page; that span is picked up (as a FLAG, never a
  // refusal) by the publish-path lint added 2026-07-31.
  const mergedProse = [String(merged?.batch?.executiveSummary ?? ""),
    ...marks.map((m) => [m.contextFraming, m.basis, ...(m.factors ?? []), ...(m.counterFactors ?? []), m.mitigation,
      ...(m.bullets ?? []), ...(m.purpleNotes ?? []), m.registerEstimate].filter(Boolean).join("\n")),
  ].join("\n");
  for (const c of permissionProseChecks({ text: mergedProse, surface: "findings", idSuffix: ":knockout", structural: true, cards: false }).filter((x) => !x.pass))
    failures.push(c.detail);
  // backstop, on the MERGED artifact — the same reason the permission check has one: a resume can
  // compose from chunk files written before this rule existed, and the register sentence is the one the
  // reader meets in the executive summary. The renderer owns register coverage; nothing else states it.
  {
    const claim = mergedProse.match(REGISTER_CLAIM_RE);
    if (claim) failures.push(`knockout_register_claim: "${claim[0].trim()}" — the assessing turn cannot see the register lane and must not describe it; the report states coverage in code from the run's own count sidecar`);
  }
  // ── — the typed findings and their receipts, ON THE MERGED ARTIFACT ────────────────────────────
  // This function is the ONLY gate pipeline-knockout.mjs runs on the composed output, and until now it
  // checked the batch's prose and nothing about its findings: the per-chunk arm was the whole of both
  // checks, so a merged file assembled from chunk files that predate a validator change shipped
  // unchecked. Both arms run again here, over what actually gets written and published.
  //
  // validateKnockoutFindings MUTATES what it validates — THREE writes, not two: it normalises each band
  // to the manifest's own casing, trims `net` (both exactly as the clearance's validateBand does), and
  // RANKS AND RENUMBERS the findings 1…N. `merged` is the object pipeline-knockout.mjs then writes to
  // knockout-findings.json. That is the intent: the artifact carries the deck's word, not the model's
  // casing of it, and a drill-through key the machine wrote rather than one the model was asked for.
  //
  // THIS IS THE ONE DOOR THE RENUMBER LANDS AT, and it is why the ranked array is assigned back here
  // while the chunk gate discards it: a chunk file is the audit record of what the model wrote, and
  // nothing publishes from it. Everything a reader sees is rendered from `merged`.
  const manifest = readJson(driverDir(runDir, "framework.json"));
  for (const m of marks) {
    // the second axis, canonicalised into the artifact — see KNOCKOUT_RATING_QUALIFIERS
    if (m.ratingQualifier != null) {
      const q = normalizeKnockoutQualifier(m.ratingQualifier);
      if (!q) failures.push(`knockout_qualifier_unknown:${m.name}: ratingQualifier "${m.ratingQualifier}" is not one of ${KNOCKOUT_RATING_QUALIFIERS.join(" / ")}`);
      else m.ratingQualifier = q;
    }
    // Per mark rather than one try: the batch's OTHER bad findings are worth naming in the same failure
    // list. Within a mark the first bad finding still wins (the validator throws token-first).
    // Assigned back only when the mark HAD an array: writing [] onto a mark that carried no findings key
    // would put a field in the artifact the stage never emitted.
    try { const ranked = validateKnockoutFindings(m.findings, { manifest }); if (Array.isArray(m.findings)) m.findings = ranked; }
    catch (e) { failures.push(`mark "${m.name}": ${e.message}`); }
  }
  const receipts = knockoutReceipts(runDir, marks);
  failures.push(...receipts.failures);
  return { ok: failures.length === 0, failures, receipts: receipts.checked };
}

// worst band across the batch, in the frozen ladder's own order (index 0 = worst)
export function worstBand(framework, marks) {
  const ladder = ladderOf(framework);
  let worst = null, worstIdx = Infinity;
  for (const m of marks ?? []) {
    const i = bandIdx(ladder, m.rating);
    if (i >= 0 && i < worstIdx) { worstIdx = i; worst = ladder[i]; }
  }
  return worst ?? ladder[ladder.length - 1] ?? null;
}
