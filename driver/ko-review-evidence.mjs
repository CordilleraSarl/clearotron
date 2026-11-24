// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// ko-review-evidence.mjs — what a Knockout's review and its corrections are handed up front, composed by code from what the run
// holds: a digest of the opinions as rated, and the evidence each one cites, with what the run holds of it.
//
// Measured in testing, 2026-11-23, on a real eight-name order: the review made 18 calls on Claude, nine of them single fact checks,
// and each call re-sent the conversation so far, 116k to 147k tokens. It read the rated record twice and opened the register's
// files to find what the opinions cite. Handed the opinions and their cited evidence in its first message, it has what it checks
// before its first call. A held source stays one call away: `read_register_list` for a filing's whole wording, and the research
// payloads for a market source.
//
// Reads files, asks nothing of any register or search service, and judges nothing.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { paths } from "./run-record.mjs";
import { knockoutAssessChunkFile } from "./knockout-assess-record.mjs";

const readJson = (p) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };
const key = (s) => String(s ?? "").trim().toLowerCase();
const one = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const list = (v) => (Array.isArray(v) ? v : v == null || v === "" ? [] : [v]);
const normUrl = (u) => String(u ?? "").trim().replace(/#.*$/, "").replace(/\/+$/, "").toLowerCase();
const isUrl = (s) => /^https?:\/\//i.test(String(s ?? ""));
// A filing's goods in the classes asked, past this length, are cut, and say so; the whole wording is one call away by record_id.
export const EVIDENCE_GOODS_CHARS = 800;
// An owner check's answer longer than this is cut, and says so; the whole answer is in its payload file.
// A register read that rates no band says why a filing does not bear on the name; past this length it is cut, and says so.
export const UNBANDED_READ_CHARS = 300;
// A reason the rating or the reading gave for setting something aside, past this length, is cut, and says so.
export const REASON_CHARS = 200;
const cut = (s, n) => { const t = one(s); return t.length > n ? `${t.slice(0, n)}… (cut)` : t; };
export const OWNER_ANSWER_CHARS = 1500;

/** The classes a name asks for: the plan's classes and its belt-and-braces classes. null when the plan does not say. PURE. */
function classesAsked(plan, name) {
  const row = (plan?.marks ?? []).find((m) => key(m?.name) === key(name));
  const c = [...list(row?.classes), ...list(row?.beltAndBraces)].map(Number).filter(Number.isInteger);
  return c.length ? new Set(c) : null;
}

/** A filing's goods in the classes `scope` holds, from its whole held record where one is held, else the view the run kept. */
function filingGoods(record, runDir, scope) {
  const whole = record?.fullRecord ? readJson(join(runDir, record.fullRecord)) : null;
  const rows = Array.isArray(whole?.goodsServices) && whole.goodsServices.length
    ? whole.goodsServices.map((g) => ({ classes: list(g?.classes).map(Number), text: one(g?.description ?? g?.translation) }))
    : list(record?.goods).map((t) => ({ classes: [Number(String(t).split(":")[0])], text: one(String(t).replace(/^\s*\d+\s*:\s*/, "")) }));
  const kept = rows.filter((g) => g.text && (!scope || g.classes.some((c) => scope.has(c))));
  const text = kept.map((g) => `${g.classes.join(",")}: ${g.text}`).join(" / ");
  return text.length > EVIDENCE_GOODS_CHARS ? `${text.slice(0, EVIDENCE_GOODS_CHARS)}… (cut; whole wording by record_id)` : text;
}

/**
 * Everything the run holds that a citation can name: its filings by record ID (carried or set aside, under whichever name found
 * them), its market sources by address (with the search that returned each), and its owner checks.
 */
export function heldSources(runDir) {
  const register = readJson(paths(runDir).registerRecords);
  const filings = new Map();
  for (const m of register?.marks ?? []) for (const [k, how] of [["records", "carried"], ["setAsideRecords", "set aside"]])
    for (const r of m?.[k] ?? []) {
      const id = String(r?.recordId ?? "");
      if (!id) continue;
      const held = filings.get(id) ?? { record: r, under: [] };
      held.under.push({ name: m.name, how, why: one(r.carriedBecause ?? r.setAsideBecause ?? r.why ?? r.reason ?? "") });
      filings.set(id, held);
    }
  const market = new Map();
  const researchDir = join(runDir, "research");
  let files = [];
  try { files = readdirSync(researchDir); } catch { files = []; }
  const owners = [];
  for (const f of files) {
    if (!f.endsWith(".md")) continue;
    const text = (() => { try { return readFileSync(join(researchDir, f), "utf8"); } catch { return ""; } })();
    if (f.startsWith("owner-")) { owners.push({ file: f, text }); continue; }
    let doc = null;
    try { doc = JSON.parse(text); } catch { doc = null; }
    // A payload held as prose, not as a grid of searches, is read for its sources where it names them.
    if (!doc) { owners.push({ file: f, text, prose: true }); continue; }
    for (const cell of doc?.cells ?? []) for (const c of cell?.candidates ?? []) {
      const u = normUrl(c?.url);
      if (!u || market.has(u)) continue;
      market.set(u, { url: c.url, title: one(c.title), payload: f, term: cell.term ?? null, platform: cell.platform ?? null });
    }
  }
  const checks = readJson(paths(runDir).ownerChecks)?.checks ?? [];
  return { filings, market, owners, checks };
}

/** What a rated record cites, per name: each finding's sources and each register read's filing, by the finding or read that cites it. PURE. */
export function citations(record) {
  const out = [];
  for (const m of record?.marks ?? []) {
    for (const f of m?.findings ?? []) {
      const by = `"${m.name}" finding ${f.ordinal}`;
      for (const id of list(f.weighedFilings)) out.push({ ref: String(id), by, name: m.name, rated: true });
      for (const e of list(f.evidence)) out.push({ ref: String(e), by, name: m.name, rated: true });
    }
    for (const r of m?.registerReads ?? []) if (r?.recordId) out.push({ ref: String(r.recordId), by: `"${m.name}" register read`, name: m.name, rated: Boolean(r.band) });
  }
  return out;
}

/** One held source as one line, or null where the run holds nothing under that reference. */
function sourceLine(ref, held, { runDir, plan, name, goods = true }) {
  const f = held.filings.get(ref);
  if (f) {
    const r = f.record;
    const dates = [r.applicationDate && `filed ${r.applicationDate}`, r.registrationDate && `registered ${r.registrationDate}`].filter(Boolean).join(", ");
    const wording = goods ? filingGoods(r, runDir, classesAsked(plan, name)) : null;
    const where = f.under.map((u) => `${u.how} under "${u.name}"${u.why ? ` (${u.why.slice(0, 200)})` : ""}`).join("; ");
    return `- ${ref} · "${one(r.mark)}" · ${one(r.owner) || "owner not recorded"} · ${one(r.status) || "status not recorded"} · ${one(r.territory) || "office not recorded"} · classes ${list(r.classes).join(",")}${dates ? ` · ${dates}` : ""} · ${wording == null ? "goods by record_id" : `goods in the classes asked: ${wording || "none held"}`} · ${where}`;
  }
  if (isUrl(ref)) {
    const m = held.market.get(normUrl(ref));
    if (m) return `- ${m.url} · "${m.title}" · returned by the search for "${one(m.term)}" on ${one(m.platform)} (${m.payload})`;
    const o = held.owners.find((x) => x.text.includes(ref));
    if (o) {
      const at = o.text.indexOf(ref);
      const from = Math.max(0, at - 400), to = Math.min(o.text.length, at + ref.length + 200);
      return `- ${ref} · in ${o.prose ? "the research payload" : "the owner check"} ${o.file}: "…${one(o.text.slice(from, to))}…"`;
    }
    return `- ${ref} · not held by this run`;
  }
  return null;
}

/** The owner checks behind a name's filings, each with its question and its answer. */
function ownerCheckLines(held, names) {
  const want = new Set([...names].map(key));
  const seen = new Set();
  return held.checks.filter((c) => want.has(key(c?.mark)) && !seen.has(c.query) && seen.add(c.query)).map((c) => {
    const o = held.owners.find((x) => x.file === c.payloadFile && !x.prose);
    const answer = c.ok && o ? one(o.text) : "the lookup did not answer";
    const cut = answer.length > OWNER_ANSWER_CHARS ? `${answer.slice(0, OWNER_ANSWER_CHARS)}… (cut; whole answer in research/${c.payloadFile})` : answer;
    const marks = list(c.filingMarks).map((x) => `"${x.mark}"`).join(", ");
    return `- ${one(c.owner)}${marks ? ` (proprietor of the filings for ${marks})` : ""}, filings ${list(c.recordIds).join(", ")}: ${cut}`;
  });
}

/**
 * Each rating group's own summary, as the group wrote it, by each of its names. The order's summary is the groups' summaries joined
 * in order, each opening with its own lines before its names' headings, so cutting it at a name's heading hands that name the next
 * group's opening lines. Measured in testing, 2026-11-24: a review read those as another name's rating on this name's page.
 */
function groupSummaries(runDir) {
  const out = new Map();
  const chunks = readJson(paths(runDir).knockoutChunks)?.chunks ?? [];
  chunks.forEach((names, c) => {
    const text = readJson(knockoutAssessChunkFile(runDir, c))?.chunkSummary;
    if (typeof text !== "string" || !text.trim() || !Array.isArray(names) || !names.length) return;
    for (const n of names) out.set(key(n), { text, names, first: key(names[0]) });
  });
  return out;
}

/** What the register was asked for one name, question by question, and what the reading did with each list. */
function searchedLines(entry) {
  if (!entry) return [];
  const byQid = new Map();
  for (const t of entry.terms ?? []) {
    // A record from before questions carried an ID names each by its basis and label.
    const id = t.qid ?? `${t.basis ?? "question"}: ${t.label ?? ""}`.trim();
    const q = byQid.get(id) ?? { qid: id, basis: t.basis, terms: [], state: t.state, total: 0, fetched: 0, known: false };
    q.terms.push(one(t.term));
    if (Number.isFinite(Number(t.total)) && t.total !== null) { q.total += Number(t.total); q.known = true; }
    q.fetched += Number(t.fetched) || 0;
    if (t.state && t.state !== "zero") q.state = t.state;
    byQid.set(id, q);
  }
  const reading = entry.reading ?? {};
  const asideWhy = new Map(list(reading.setAside).map((x) => [x.question, cut(x.why ?? "", REASON_CHARS)]));
  return [
    ...[...byQid.values()].map((q) => `${q.qid} (${q.basis}): ${[...new Set(q.terms)].join(", ")} · ${q.state ?? "no state"}, ${q.known ? `${q.total} filing(s)` : "count not given"}, ${q.fetched} fetched${asideWhy.has(q.qid) ? ` · the reading set it aside: ${asideWhy.get(q.qid)}` : ""}`),
    ...list(reading.notAsked).map((x) => `Not asked: ${cut(x.question ?? "", REASON_CHARS)} · ${cut(x.why ?? "", REASON_CHARS)}`),
  ];
}

/**
 * The opinions as rated, one block a name: its band and basis, the reasons for and against, its opening read and its line in the
 * order's summary, each finding with its ordinal, band, reasoning and cited sources, its register reads, and each filing the reading
 * carried with what became of it. What was searched and the web leads set aside are their own sections (searchedAndSetAside). PURE but
 * for reading the register record.
 */
export function opinionDigest(record, runDir) {
  const register = readJson(paths(runDir).registerRecords);
  const summaryOf = groupSummaries(runDir);
  const carriedOf = (name) => (register?.marks ?? []).find((m) => key(m?.name) === key(name))?.records ?? [];
  const out = [];
  for (const m of record?.marks ?? []) {
    const findings = m.findings ?? [];
    const reads = new Map((m.registerReads ?? []).map((r) => [String(r.recordId), r]));
    out.push(
      `### "${m.name}": ${m.rating}${m.ratingQualifier ? ` (${m.ratingQualifier})` : ""}`,
      `Basis: ${one(m.basis)}`,
      list(m.factors).length ? `For: ${list(m.factors).map(one).join(" | ")}` : "",
      list(m.counterFactors).length ? `Against: ${list(m.counterFactors).map(one).join(" | ")}` : "",
      m.mitigation ? `Mitigation: ${one(m.mitigation)}` : "",
      m.contextFraming ? `Context: ${one(m.contextFraming)}` : "",
      `Opening read: ${one(m.assessment)}`,
      (() => {
        const g = summaryOf.get(key(m.name));
        if (!g) return "";
        const others = g.names.filter((n) => key(n) !== key(m.name));
        return g.first === key(m.name) ? `In the order's summary${others.length ? `, with ${others.map((n) => `"${n}"`).join(", ")}` : ""}: ${one(g.text)}` : `In the order's summary: with "${g.names[0]}", above.`;
      })(),
      ...findings.map((f) => `${f.ordinal}. ${one(f.name)}${f.owner ? `, ${one(f.owner)}` : ""} · ${one(f.type)} · ${f.band}: ${one(f.net)} Reasoning: ${one(f.basis)}${list(f.evidence).length || list(f.weighedFilings).length ? ` Sources: ${[...list(f.weighedFilings), ...list(f.evidence)].join(", ")}` : " Sources: none cited"}`),
      ...[...reads.values()].map((r) => {
        const read = one(r.read);
        return `Register read ${r.recordId}${r.band ? ` (${r.band})` : ""}: ${r.band || read.length <= UNBANDED_READ_CHARS ? read : `${read.slice(0, UNBANDED_READ_CHARS)}… (cut)`}`;
      }),
      (() => {
        // A carried filing a finding weighs or a register read names is above, by its record ID; the rest are listed once.
        const weighed = new Set(findings.flatMap((x) => list(x.weighedFilings).map(String)));
        const unused = carriedOf(m.name).filter((r) => !weighed.has(String(r.recordId)) && !reads.has(String(r.recordId)));
        return unused.length ? `Carried, and neither weighed nor read: ${unused.map((r) => `${r.recordId} ("${one(r.mark)}", ${one(r.owner) || "owner not recorded"})`).join("; ")}` : "";
      })(),
      "",
    );
  }
  return out.filter((l, i, a) => l !== "" || (i > 0 && a[i - 1] !== ""));
}

/**
 * What the register was asked for each name and what the reading did with each list, and the web leads each rating set aside with
 * its reason: one row a question or a lead, each opening with its name.
 */
export function searchedAndSetAside(record, runDir) {
  const register = readJson(paths(runDir).registerRecords);
  const registerOf = (name) => (register?.marks ?? []).find((m) => key(m?.name) === key(name)) ?? null;
  const searched = [], setAside = [];
  for (const m of record?.marks ?? []) {
    for (const l of searchedLines(registerOf(m.name))) searched.push(`- "${m.name}": ${l}`);
    for (const x of list(m.setAside)) setAside.push(`- "${m.name}": ${x.url} · ${cut(x.ground ?? x.why ?? x.reason ?? "", REASON_CHARS)}`);
  }
  return { searched, setAside };
}

/** The evidence the opinions cite, each source once with what the run holds of it, and the owner checks behind each name's filings. */
export function citedEvidence(record, runDir, plan) {
  const held = heldSources(runDir);
  const byRef = new Map();
  for (const c of citations(record)) {
    const e = byRef.get(c.ref) ?? { names: new Set(), by: [], rated: false };
    e.names.add(c.name); e.by.push(c.by); e.rated ||= c.rated;
    byRef.set(c.ref, e);
  }
  const lines = [...byRef].map(([ref, e]) => {
    const line = sourceLine(ref, held, { runDir, plan, name: [...e.names][0], goods: e.rated });
    return line ? `${line} · cited by ${[...new Set(e.by)].join(", ")}` : null;
  }).filter(Boolean);
  return { sources: lines, ownerChecks: ownerCheckLines(held, (record?.marks ?? []).map((m) => m.name)) };
}

/**
 * What one correction's defects rest on: each source a defect names, and each source the finding it names cites, with what the run
 * holds of it; the owner checks behind the names it concerns.
 */
export function defectEvidence(defects, asRated, runDir, plan) {
  const held = heldSources(runDir);
  const refs = new Map();
  for (const d of defects ?? []) {
    const mark = (asRated?.marks ?? []).find((m) => key(m?.name) === key(d.mark));
    const finding = d.finding != null ? (mark?.findings ?? []).find((f) => f.ordinal === d.finding) : null;
    for (const r of [...list(d.rests_on), ...list(finding?.weighedFilings), ...list(finding?.evidence)]) if (!refs.has(String(r))) refs.set(String(r), d.mark);
  }
  const sources = [...refs].map(([ref, name]) => sourceLine(ref, held, { runDir, plan, name })).filter(Boolean);
  return { sources, ownerChecks: ownerCheckLines(held, (defects ?? []).map((d) => d.mark)) };
}
