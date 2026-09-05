// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// report-card-record.mjs — the recording transport for a single finding card.
//
// Conversion 5, and the first FAN-OUT stage to convert: one card per finding, 26 of them on a big run,
// each an isolated turn that sees only its own record. That is what makes this conversion different
// from the four before it, and it is why two mechanisms had to exist before the transport could:
//
//   · the grant lookup is EXACT and a card is dispatched as `report-card:<ord>`, so the recording row
//     declares `perAxis` (gather-config.mjs) — measured before it existed: a grant that resolved for
//     `report-overview` resolved to NOTHING for `report-overview:2`, silently;
//   · every repair surface looks an artifact up by BASENAME, and a card's basename is `26.md`, so
//     per-ordinal artifacts are keyed on their DIRECTORY (gateway.mjs TOOL_WRITTEN_DIRS) with no
//     basename fallback inside it.
//
// ── WHAT MOVES, AND THE LINE THIS CONVERSION MUST NOT CROSS ────────────────────────────────────────
//
// OWNER RULING S2 (2026-08-13) re-scoped rather than adopting it: "the mechanical card fields
// (headings, ids, links, driver-stamped values) move to code NOW — uncontested. The prose half is
// decided by EVIDENCE: after config #40 lands, build one matter both ways and the owner reads the two
// cards side by side. If the rendered card reads worse, the model pass stays, on typed inputs."
//
// So the PROSE STAYS THE MODEL'S. This transport moves how a card reaches disk and who owns its line
// shapes; it does not render the analysis, and a later reader must not "finish the job" by making it do
// so. What the seat sends is its own judgment as typed bullets; what the driver owns is every shape
// around them, and the `- Source:` bullet, which is read off the finding's own record.
//
// ── THE FRAME IS ALREADY CODE'S, AND THAT IS WHY THE PAYLOAD IS SMALL ──────────────────────────────
//
// `assembleReportMd` composes the head, `- ord:`, `- group:`, `- net:` and `- open:` from the record via
// card-frame.mjs (the 2026-08-16 frame conversion). A compliant card body therefore STARTS at
// `### Full detail`, and this render produces exactly that — no head, no meta lines. A body that carries
// its own frame still assembles the old way (`carriesOwnFrame`), which is the archive path and stays.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { captureCall, stampVerdict } from "./call-capture.mjs";
import { join } from "node:path";
import { driverDir } from "../shared/driver-dir.mjs";   //
// — ONE definition of "present but not a link", imported rather than restated. The rule belongs to
// findings-model.mjs, which owns the record-URL contract; a second copy here would drift and the two
// would then disagree about the same value while both reporting themselves clean.
import { isDeadRecordLink } from "./findings-model.mjs";

export const CARDS_DIR = "report-cards";
const SCHEMA_VERSION = 1;

/** The card file for an ordinal — the same path `P.reportCard` builds, derived here from the run dir. */
export const cardFile = (runDir, ordinal) => join(String(runDir ?? ""), CARDS_DIR, `${ordinal}.md`);

/** Where the call's evidence lives, PER ORDINAL — 26 cards mean 26 captures, never one overwritten. */
export function reportCardCallPaths(runDir, ordinal) {
  const dir = driverDir(String(runDir ?? ""), "report-card-calls");
  return { dir, payload: join(dir, `call-${ordinal}.json`) };
}

const str = (v) => String(v ?? "").trim();

// The card body's floor, carried from `validators.reportCard` (`nonEmpty(c, 60)`) rather than re-chosen:
// a conversion moves a check, it does not get to pick a new threshold on the way past.
const BODY_FLOOR_CHARS = 60;

/**
 * The finding record this run holds for an ordinal, or `null`.
 *
 * READ FROM THE RUN, not from the payload. The card's `- Source:` bullet is declared
 * `mechanical:code-rendered` and the record already carries `source.resolved_link`, so the seat is not
 * asked for a URL it would have to compose from a host table it is not even given — the transcription
 * class in its purest form, and 's link-to-nowhere in a document a client reads.
 */
export function findingForOrdinal(runDir, ordinal) {
  return findingsDocFor(runDir, ordinal).finding;
}

/**
 * The same read, with the CAUSE kept —.
 *
 * `findingForOrdinal` collapses three different states into one `null`, and two of them are legitimate
 * while the third is a driver-side inconsistency:
 *
 *   findings.json absent or not JSON     the driver is not ready. NOT this card's fault.
 *   readable, and it has no such ordinal the driver bound a card turn to an ordinal the run does not
 *                                        carry. THIS is the defect — and it currently ships as a
 *                                        well-formed card with no Source bullet, which is exactly what a
 *                                        legitimate record-less finding looks like.
 *   readable, ordinal present            fine, whatever the finding carries.
 *
 * Nothing downstream separates the first two from the third: `registry-record-coverage` harvests
 * `/mark/` URIs off the delivered report, and a card that cites nothing has nothing to harvest — so the
 * run goes green BECAUSE the evidence is missing.
 *
 * `readable` is the discriminator, and it is the whole reason this is not just a refusal on `!finding`.
 * Refusing whenever the finding is absent would refuse every card on any run that records one while
 * findings.json is being rewritten — the pipeline-breaking downside says must be checked rather
 * than asserted.
 *
 * @returns {{readable: boolean, finding: object|null}}
 */
export function findingsDocFor(runDir, ordinal) {
  let doc;
  try { doc = JSON.parse(readFileSync(join(String(runDir ?? ""), "findings.json"), "utf8")); }
  catch { return { readable: false, finding: null }; }
  if (!doc || typeof doc !== "object") return { readable: false, finding: null };
  return { readable: true, finding: (doc.findings ?? []).find((f) => String(f?.ordinal) === String(ordinal)) ?? null };
}

// ── — THE OFFICE AND THE NUMBER, NOT THE ENUM AND THE PATH ───────────────────────────────────
//
// The first version of this composer read `owner.registrations[0].register` and `.number`, falling back
// to `source.source_type` and `.uri`. NEITHER PREFERRED FIELD EXISTS. The registration schema is stated
// in contract-e3-backlog.mjs: `{"uri", optionally "classes", "status", "filed", "expiry",
// "jurisdiction"}` — there is no `register` and no `number`, on any record, ever. So both fallbacks
// fired on every card and the composed bullet read
//
//     - Source: [register-euipo · /mark/eu/018575624](https://euipo.europa.eu/…)
//
// where the corpus it replaced reads `- Source: [EUIPO · 018575624](…)`. An internal enum token and an
// internal URI path, in the one line of a client-facing card whose job is to say which register holds
// the record and under what number. publish/index.mjs quotes the correct shape verbatim in a comment of
// its own, which is what makes the divergence provable rather than a matter of taste.
//
// IT SHIPPED BECAUSE THE CONVERSION WAS NEVER CHECKED AGAINST THE ARTIFACT. asked for exactly that
// check — "recompose the bullet for every card in demo and assert byte-equality with the
// delivered report.md" — and writing it is what caught this. The guard now lives beside 's, and
// this is the argument for building the guard an issue asks for even when the code already looks done.
//
// THE NUMBER comes off the URI's last segment: `/mark/eu/018575624` → `018575624`. That is a parse, and
// a parse is what this file exists to avoid — but the alternative is a field that does not exist, and
// the URI's shape is the driver's own (`/mark/<jurisdiction>/<id>`, dictated in gateway.mjs and bound
// from the fetched record). A URI that does not match it yields NO number rather than a wrong one, and
// the bullet then names the register alone.
//
// THE LABEL is the office when the record names one. `register-euipo` is the EU register whatever vendor
// the run is configured with, so it reads off the record. A vendor aggregator's own label is genuinely
// not on the record — it is the run's configuration — so the caller passes it, and when nothing is
// passed this prints the neutral word `Register` rather than an enum token. There is NO `register-vendor`
// specimen in the delivered corpus: that leg is asserted as a unit and said so, rather than claimed
// against evidence that does not exist.
const REGISTER_OFFICE = Object.freeze({ "register-euipo": "EUIPO" });

/** The registration number inside a driver record URI (`/mark/eu/018575624`), or `""`. PURE. */
export function registrationNumber(uri) {
  const m = /^\/mark\/[a-z]{2}\/([A-Za-z0-9._-]+)$/.exec(str(uri));
  return m ? m[1] : "";
}

/**
 * The `- Source:` bullet, composed from the record. Empty string when there is no register record link.
 *
 * ONLY A REGISTER FINDING CARRIES ONE, and that is findings-model.mjs's rule reused rather than
 * re-decided: `source.resolved_link` is a record link only when the source type starts with "register";
 * a common-law finding's is a marketplace or a company site. The delivered corpus agrees — its one
 * common-law card carries no Source bullet — and composing one there would add a line to every
 * common-law card in every report, which is a delivery change wearing a bug fix's clothes.
 */
export function renderSourceBullet(finding, { registerLabel = "" } = {}) {
  const link = str(finding?.source?.resolved_link);
  const type = str(finding?.source?.source_type);
  // — a DEAD link composes nothing, exactly as a missing one does. `!link` already covered absent;
  // `#` fell through it and composed `](#)`, which is the anchor is about. The validator rejects
  // this value now too, so a card reaching here with one means the validator was bypassed, not that the
  // seat was obeyed — composing nothing is the safe reading either way.
  if (!link || isDeadRecordLink(link) || !type.startsWith("register")) return "";
  const reg = REGISTER_OFFICE[type] || str(registerLabel) || "Register";
  const id = registrationNumber(finding?.owner?.registrations?.[0]?.uri);
  return `- Source: [${reg}${id ? ` · ${id}` : ""}](${link})`;
}

/**
 * Render the card body — `### Full detail` and its bullets, and nothing above it.
 *
 * Every shape here was a dictated line the seat had to hit and a parser then re-read: the one-item-per-
 * bullet rule, the optional bold lead-in, the `::p::` marker's position (FIRST token after "- ", never
 * bold-wrapped, never mid-sentence) and the final Source bullet. They are the driver's now.
 */
export function renderReportCard(model, finding, { registerLabel = "" } = {}) {
  const out = ["### Full detail", ""];
  for (const b of model.full_detail) {
    const lead = b.lead ? `**${b.lead}.** ` : "";
    // `::p::` FIRST, before any bold lead-in — the position the render splits on. A flag that arrived
    // after the lead-in would read as body text to every consumer that strips internal notes.
    out.push(`- ${b.internal ? "::p:: " : ""}${lead}${b.text}`);
  }
  const src = renderSourceBullet(finding, { registerLabel });
  if (src) out.push(src);
  return `${out.join("\n").replace(/\n+$/, "")}\n`;
}

// ── THE RISK READ IS A STRUCTURE, NOT A DICTATED HABIT ( D3) ─────────────────────────────────
//
// render.mjs suppresses the typed `legal_position` / `practical_position` pair on any card whose prose
// already carries a "Risk assessment"-led bullet (, ONE ACCOUNT PER FACT). That gate reads a lead
// this stage's dispatch calls OPTIONAL and this acceptance never checked — the card contract's §L
// requirement was a HABIT, in exactly the sense the card index was one before the driver bound it.
//
// could live with a habit, and said why: the typed pair was the last copy, so a drifted lead meant
// the reader saw the DUPLICATE — "visible, and fixable at the contract". D3 takes that safety away. Once
// the typed fields stop carrying a second authored account, a card whose read is led anything else
// leaves the reader with no risk read on any surface and nothing saying so. Visible-duplicate becomes
// silent-absence, which is the one failure direction this program does not ship.
//
// ONE PREDICATE, TWO SITES. render.mjs imports this regex rather than re-typing it, so what the render
// deduplicates against is exactly what acceptance requires. Two copies that drifted by a character would
// leave both sides green and put the silent case back.
//
// IT MATCHES THE RENDERED LINE, NOT THE `lead` FIELD, because that is what the render sees: an unled
// bullet opening "Risk assessment" fires the dedupe and must therefore pass acceptance, and an
// `internal: true` read does NOT — `::p::` renders before the bold lead-in and breaks the match on both
// sides, which is right, because a staff aside is not the client's read.
export const READ_LEAD_RE = /(^|\n)\s*-\s*(\*\*)?\s*Risk assessment\b/i;

/**
 * Validate the typed values against the BOUND ordinal, then render.
 *
 * `boundOrdinal` is the DRIVER'S — it knows which card it fanned out — and a payload naming any other
 * index is refused. O3c measured the sibling contract holding 224/0 (every card seat touched only its
 * own card), but that is a measured HABIT, not a structure; this is what makes it a structure.
 *
 * Returns `{ok:true, model, content}` or `{ok:false, reason}`, reason token-first. PURE.
 */
export function acceptReportCard(params, { boundOrdinal = null, finding = null, registerLabel = "", findingsReadable = null } = {}) {
  if (boundOrdinal == null || str(boundOrdinal) === "")
    return { ok: false, reason: "reportcard_no_bound_ordinal: the driver did not bind a card index to this turn — a card written without one could land on any finding's file" };

  const claimed = str(params?.ordinal);
  if (!claimed)
    return { ok: false, reason: `reportcard_ordinal_missing: state the ordinal of the finding this card is for (this turn is bound to ${boundOrdinal})` };
  if (claimed !== str(boundOrdinal))
    return { ok: false, reason: `reportcard_ordinal_mismatch:${claimed} — this turn is bound to card ${boundOrdinal} and writes only that one. You hold no other finding's record.` };

  // — THE BOUND ORDINAL NAMES A FINDING THIS RUN DOES NOT CARRY.
  //
  // Refused only when findings.json was READ and does not hold the ordinal. That conjunction is the whole
  // check: `finding == null` alone is also true when the file is missing or mid-rewrite, and refusing
  // there would fail every card on a run that is merely early — the pipeline-breaking downside says
  // to check rather than assert. `findingsReadable` defaults to null (unknown), so a caller that has not
  // measured it keeps today's behaviour instead of inheriting a refusal it never asked for.
  //
  // WHY A REFUSAL AND NOT A RENDER. There are three legitimate ways a card ends up with no Source bullet
  // — no resolved link, a non-register source type, and a record-less run — and all three render
  // identically to this one. The artifact cannot carry the distinction, so the only place it can be made
  // is here, before a card is written. Downstream cannot recover it either: `registry-record-coverage`
  // harvests `/mark/` URIs off the delivered report, and a card that cites nothing has nothing to
  // harvest, so the run goes green BECAUSE the evidence is missing.
  if (findingsReadable === true && !finding)
    return { ok: false, reason: `reportcard_ordinal_unknown:${str(boundOrdinal)} — findings.json was read and carries no finding with this ordinal, so this card turn is bound to a finding the run does not hold. A driver-side inconsistency, not something the card can fix: nothing written here would be about a real finding.` };

  const bullets = Array.isArray(params?.full_detail) ? params.full_detail : [];
  if (!bullets.length)
    return { ok: false, reason: "reportcard_detail_missing: the card's `### Full detail` bullets are the finding's analysis — filing, portfolio, risk assessment, enforcement" };

  const full_detail = [];
  for (const b of bullets) {
    const text = str(b?.text);
    if (!text) return { ok: false, reason: "reportcard_bullet_text_missing: every bullet states one item" };
    if (text.includes("\n"))
      return { ok: false, reason: `reportcard_bullet_newline: one item per bullet — a second line renders outside the list (${text.slice(0, 40)})` };
    // The number suppression rule, enforced where it is cheap rather than asked for in prose: the
    // per-record structured render owns registration numbers, and the Source bullet's id is the ONE
    // place a number appears. A bullet carrying one is the drift `registration-number suppression` was
    // written to prevent.
    if (/\b\d{6,}\b/.test(text))
      return { ok: false, reason: `reportcard_bullet_registration_number: a registration/application number belongs ONLY in the Source bullet the driver renders — name the owner and mark instead (${text.slice(0, 48)})` };
    const lead = str(b?.lead);
    // The lead-in gets the SAME newline rule as the text, and for the same reason. `text` was checked and
    // `lead` was not, so a lead carrying a newline was accepted and rendered a bullet whose second line
    // falls outside the list — the exact shape `reportcard_bullet_newline` exists to prevent, reached
    // through the other half of the same bullet. Found in review, not by the suite: every arm sent a
    // one-word lead, so no test exercised the field the render interpolates into bold.
    if (lead.includes("\n"))
      return { ok: false, reason: `reportcard_lead_newline:${lead.slice(0, 30)} — the lead-in is one phrase on one line; a newline inside it breaks the bullet open` };
    if (lead.includes("."))
      return { ok: false, reason: `reportcard_lead_punctuated:${lead.slice(0, 30)} — send the lead-in word alone; the driver renders the bold and the full stop` };
    full_detail.push({ text, lead, internal: b?.internal === true });
  }

  const model = { schema_version: SCHEMA_VERSION, ordinal: str(boundOrdinal), full_detail };
  const content = renderReportCard(model, finding, { registerLabel });
  if (content.length < BODY_FLOOR_CHARS)
    return { ok: false, reason: `reportcard_too_short:${content.length} characters rendered (floor ${BODY_FLOOR_CHARS}) — the card carries this finding's analysis, not a line` };

  // Tested on the RENDERED card, with the renderer's own predicate — see READ_LEAD_RE above for why this
  // is a refusal and not a lint. A card the render will deduplicate the typed reads away from must
  // actually carry the read it is deduplicated against; there is no surface that recovers it afterwards.
  if (!READ_LEAD_RE.test(content))
    return { ok: false, reason: "reportcard_read_lead_missing: one bullet carries this finding's risk read and is led \"Risk assessment\" — §L's lead, and NEVER \"Legal lever\". The report suppresses the record's own legal/practical reads wherever this bullet is present, so a card without it (or with the read marked internal) reaches the client with no risk read at all" };

  return { ok: true, model, content };
}

/**
 * Capture, validate, then write. The capture happens BEFORE the decision, as in every sibling
 * transport: it exists even for a REFUSED call, which is what makes its presence the discriminator this
 * conversion is proven by — per ordinal, so one card's refusal is legible beside twenty-five successes.
 */
export function recordReportCard(runDir, received, { boundOrdinal = null, registerLabel = "", now = () => new Date().toISOString() } = {}) {
  const ord = str(boundOrdinal) || str(received?.ordinal) || "unbound";
  const { dir, payload } = reportCardCallPaths(runDir, ord);
  // — ONE FILE PER CALL, refusals included. ITS OWN NAMESPACE, and the reason is a
  // collision: this transport already spells its captures `call-<ordinal>.json`, UNPADDED, so a shared
  // padded sequence would put call 2 of ordinal 1 on top of ordinal 2's first call. Sequence 1 keeps
  // `call-<ordinal>.json`; later calls on the SAME ordinal take a `-NNN` suffix.
  const nameFor = (seq) => (seq === 1 ? payload : join(dir, `call-${ord}-${String(seq).padStart(3, "0")}.json`));
  const cap = captureCall({ nameFor, params: received, extra: { boundOrdinal: boundOrdinal ?? null }, now });
  const captureFailed = cap.failed;
  const closeCapture = (v) => { stampVerdict(cap.path, v); return cap.path; };

  // — one read, both facts. Reading the finding and then re-reading to ask whether the file was
  // legible would be two reads of a file the report phase actively rewrites, and they could disagree.
  const docState = findingsDocFor(runDir, boundOrdinal);
  const verdict = acceptReportCard(received, {
    boundOrdinal,
    finding: docState.finding,
    findingsReadable: docState.readable,
    // — the RUN's provider label, for the one register kind the record cannot name itself.
    registerLabel,
  });
  if (!verdict.ok) {
    return { written: null, refused: verdict.reason, captured: closeCapture({ ok: false, refused: verdict.reason }), capture_failed: captureFailed };
  }

  const at = cardFile(runDir, verdict.model.ordinal);
  try {
    mkdirSync(join(String(runDir ?? ""), CARDS_DIR), { recursive: true });
    writeFileSync(at, verdict.content);
  } catch (e) {
    return { written: null, refused: null, write_failed: String(e?.message ?? e).slice(0, 200),
      captured: closeCapture({ ok: false, write_failed: true }), capture_failed: captureFailed };
  }

  return {
    written: at,
    refused: null,
    ordinal: verdict.model.ordinal,
    bullets: verdict.model.full_detail.length,
    captured: closeCapture({ ok: true }),
    capture_failed: captureFailed,
  };
}

/** Was THIS card written through the typed transport? The ruled discriminator, per ordinal. */
export function reportCardWasRecorded(runDir, ordinal) {
  try { readFileSync(reportCardCallPaths(runDir, ordinal).payload, "utf8"); return true; }
  catch { return false; }
}
