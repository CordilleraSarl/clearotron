// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// ko-earlier-rights.mjs — the hand-over across the order: connect a held filing or market source to every name of the order for which
// resemblance and the requested goods make it plausible. Code, not a model session: it reads what the run already holds, asks nothing
// of any register or search service, and judges nothing. Whether a right bears on a name is that name's rating's call.
//
// A FILING reaches a name when it is live, the register reading carried it under ANOTHER name of the order, the product's own
// classifier (band-shape.mjs) ties its mark to one of this name's spellings, and it is in a class this name asks for.
//
// A MARKET SOURCE reaches a name through the business it names: a research lead found under another name that names the owner of a
// filing in front of this name, its own or connected. Measured in testing, 2026-11-23, on a saved eight-name order, resemblance of a
// lead's title alone put 177 leads in front of names that had not searched them, and the saved opinions for those names cited 10.
// Anchored to a business, the same leads add no comparison; they are the sources of one already in front.
//
// What a name's rating reads names no other name of the order: where a filing was found is provenance, and a solo order and a
// shortlist hand the same name the same job.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { classifyRecord, prepareTargets, isLiveRecord, niceClassKey } from "./band-shape.mjs";
import { kebab } from "./search-policy.mjs";
import { driverDir } from "../shared/driver-dir.mjs";

export const EARLIER_RIGHTS_FILE = "earlier-rights.json";
export const earlierRightsGroupFile = (chunkNo) => `earlier-rights.group-${chunkNo}.json`;

const readJson = (p) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };
const key = (s) => String(s ?? "").trim().toLowerCase();
const flat = (s) => key(s).replace(/[^\p{L}\p{N}]+/gu, "");
// A business is known by its name without its legal form; the words that tell one business from another are its name's distinctive
// words of four letters or more, not the words that say what kind of company it is.
const LEGAL = new Set(["inc", "llc", "ltd", "limited", "co", "corp", "corporation", "company", "gmbh", "sa", "sarl", "plc", "lp", "llp", "srl", "bv", "ag", "pty", "the"]);
const KIND = new Set(["brewing", "brewery", "beverage", "beverages", "drinks", "foods", "food", "group", "holdings", "holding", "international",
  "industries", "industrial", "products", "brands", "brand", "trading", "enterprises", "systems", "global", "media", "games", "entertainment",
  "studios", "studio", "interactive", "services", "technologies", "technology", "solutions", "partners", "ventures", "capital", "management"]);
export const businessKey = (owner) => key(owner).replace(/[^\p{L}\p{N}\s]+/gu, " ").split(/\s+/).filter((w) => w && !LEGAL.has(w)).join(" ");
export function brandWords(owner) {
  return [...new Set(businessKey(owner).split(" ").filter((w) => w.length >= 4 && !KIND.has(w)))];
}

const normUrl = (u) => String(u ?? "").trim().replace(/#.*$/, "").replace(/\/+$/, "").toLowerCase();
const TIED = new Set(["identical", "near-identical", "same-family"]);
// The classifier's test, in the words a rating reads.
const RESEMBLES = { "normalized-equal": "the same", "alias-exact": "the same", "script-exact": "the same", "edit-1": "one letter apart",
  "confusable-skeleton": "alike in look", "token-identical": "contains it as a word", "token-edit-1": "holds a word one letter from it",
  "consonant-skeleton": "the same consonants", "double-metaphone": "alike in sound", "edit-2": "two letters apart" };

/**
 * The shortlist step over the run as the register reading left it. Returns `{schema, names: [{name, rights, businesses}]}`:
 * `rights`, the filings connected to the name, each with `heldUnder` for the order's record and the reviewer; `businesses`, each
 * business in front of the name with its owner checks (one per distinct question) and the market sources found under the order's
 * other names that name it.
 */
export function earlierRights(runDir, { leadsPerBusiness = 40 } = {}) {
  const plan = readJson(join(runDir, "knockout-plan.json"))?.marks ?? [];
  const list = readJson(driverDir(runDir, "register-records.json"))?.marks ?? [];
  const checks = readJson(driverDir(runDir, "owner-checks.json"))?.checks ?? [];
  // Filings found by a name's own search, never a copy a later step made under the name it was weighed for.
  const ownOf = (n) => (list.find((m) => key(m.name) === key(n))?.records ?? []).filter((r) => r?.recordId && !r.foundUnder);
  const found = list.flatMap((m) => (m.records ?? []).filter((r) => r?.recordId && !r.foundUnder).map((r) => ({ r, under: m.name })));
  const leadsOf = new Map(plan.map((p) => {
    const cells = readJson(join(runDir, "research", `${kebab(p.name)}.md`))?.cells ?? [];
    return [key(p.name), new Map(cells.flatMap((c) => (c.candidates ?? []).filter((x) => x?.url).map((x) => [normUrl(x.url), { url: x.url, title: x.title ?? null }])))];
  }));
  const ownerChecksOf = (owner) => {
    const seen = new Set();
    return checks.filter((c) => businessKey(c.owner) === businessKey(owner)).filter((c) => !seen.has(c.query) && seen.add(c.query))
      .map((c) => ({ payload: c.ok && c.payloadFile ? join("research", c.payloadFile).replace(/^research\/research\//, "research/") : null,
        asked: c.query ?? null, answered: c.ok === true }));
  };
  const names = plan.map((p) => {
    const own = ownOf(p.name);
    const ownIds = new Set(own.map((r) => String(r.recordId)));
    const asked = new Set((p.classes ?? []).map(niceClassKey));
    const targets = prepareTargets([p.name, ...(p.spellings ?? [])]);
    const byId = new Map();
    for (const { r, under } of found) {
      const id = String(r.recordId);
      if (ownIds.has(id) || key(under) === key(p.name)) continue;
      if (byId.has(id)) { byId.get(id).heldUnder.push(under); continue; }
      if (!isLiveRecord(r)) continue;
      const classes = (r.classes ?? []).map(niceClassKey).filter((c) => asked.has(c));
      if (!classes.length) continue;
      const tie = classifyRecord(r.mark, targets);
      if (!TIED.has(tie.tier)) continue;
      byId.set(id, { recordId: id, mark: r.mark ?? null, owner: r.owner ?? null, status: r.status ?? null, classes: r.classes ?? null,
        territory: r.territory ?? null, registrationNumber: r.registrationNumber ?? null, applicationNumber: r.applicationNumber ?? null,
        goods: r.goods ?? null, goodsState: r.goodsState ?? null, heldUnder: [under],
        resembles: { spelling: tie.target, test: tie.basis, words: RESEMBLES[tie.basis] ?? tie.basis }, classesAsked: classes });
    }
    const rights = [...byId.values()];
    // THE BUSINESSES IN FRONT OF THIS NAME, and the market sources the order's other searches hold about each.
    const ownLeads = leadsOf.get(key(p.name)) ?? new Map();
    const byBusiness = new Map();
    for (const r of [...own, ...rights]) {
      const k = businessKey(r.owner);
      if (!k || byBusiness.has(k)) continue;
      const words = brandWords(r.owner);
      const seen = new Map();
      for (const q of plan) if (key(q.name) !== key(p.name)) for (const [u, l] of leadsOf.get(key(q.name)) ?? []) {
        if (ownLeads.has(u) || seen.has(u)) continue;
        if (words.some((w) => `${flat(l.title)} ${u}`.includes(w))) seen.set(u, l);
      }
      byBusiness.set(k, { owner: String(r.owner).trim(), filings: [...own, ...rights].filter((x) => businessKey(x.owner) === k).map((x) => String(x.recordId)),
        ownerChecks: ownerChecksOf(r.owner), marketSources: [...seen.values()].slice(0, leadsPerBusiness), marketSourcesHeld: seen.size });
    }
    return { name: p.name, rights, businesses: [...byBusiness.values()] };
  });
  return { schema: 1, names };
}

/** What one name's rating reads: its connected filings and the businesses in front of it, naming no other name of the order. PURE. */
export function earlierRightsForName(doc, name) {
  const n = (doc?.names ?? []).find((x) => key(x.name) === key(name));
  if (!n) return null;
  return { schema: 1, name: n.name,
    filings: n.rights.map(({ heldUnder: _h, resembles, ...x }) => ({ ...x, resembles: { spelling: resembles.spelling, how: resembles.words }, provenance: "a register search of this order" })),
    businesses: n.businesses.filter((b) => b.marketSources.length || n.rights.some((r) => businessKey(r.owner) === businessKey(b.owner))) };
}

/** The lines a rating reads for its names: one per connected filing, one per business whose market sources it is handed. PURE. */
export function earlierRightsLines(doc, chunkNames) {
  // A family's lines say which name each is for; one name's carry no tag.
  const tag = (name) => (chunkNames.length > 1 ? `For "${name}": ` : "");
  return chunkNames.flatMap((name) => {
    const one = earlierRightsForName(doc, name);
    if (!one) return [];
    return [
      ...one.filings.map((x) => `- ${tag(name)}Filing recordId "${x.recordId}": "${x.mark}", ${x.owner ?? "owner not recorded"}, ${x.status ?? "status not recorded"}, class ${(x.classes ?? []).join(", ")}, ${x.territory ?? "territory not recorded"}; ${x.resembles.how} from "${x.resembles.spelling}".`),
      ...one.businesses.map((b) => `- ${tag(name)}Business ${b.owner}: ${b.ownerChecks.length} owner check(s) and ${b.marketSourcesHeld} market source(s) about it.`),
    ];
  });
}

/**
 * What each rating did with the filings it was handed, read from the rated record: `weighed` in a finding (its weighedFilings),
 * `read` in a registerReads row, else `unresolved`. PURE.
 */
export function earlierRightsOutcome(doc, rated) {
  const marks = new Map((rated?.marks ?? []).map((m) => [key(m.name), m]));
  // Only the names this record rated: a document handed in from a larger order speaks for names this one does not hold.
  return (doc?.names ?? []).filter((n) => marks.has(key(n.name))).flatMap((n) => n.rights.map((x) => {
    const m = marks.get(key(n.name));
    const f = (m?.findings ?? []).find((y) => (y?.weighedFilings ?? []).map(String).includes(x.recordId));
    const row = (m?.registerReads ?? []).find((y) => String(y?.recordId) === x.recordId);
    const state = f ? "weighed" : row ? "read" : "unresolved";
    return { name: n.name, recordId: x.recordId, mark: x.mark, owner: x.owner, heldUnder: x.heldUnder, state,
      ...(f ? { finding: f.name ?? null, band: f.band ?? null } : {}), ...(row && !f ? { read: row.read ?? null } : {}) };
  }));
}

/** The reviewer's rows: each filing, the name it was handed to, and what the rating did with it. PURE. */
export function earlierRightsReviewLines(outcome) {
  return outcome.map((o) => `- "${o.name}": recordId "${o.recordId}" ("${o.mark}", ${o.owner ?? "owner not recorded"}), found under ${o.heldUnder.map((u) => `"${u}"`).join(", ")}: ${
    o.state === "weighed" ? `weighed in the finding on "${o.finding}"` : o.state === "read" ? `read with the reason "${String(o.read ?? "").replace(/\s+/g, " ").trim()}"` : "UNRESOLVED: no finding weighs it and no registerReads row reads it"}.`);
}

/** The per-name documents for one group, written beside the order's. PURE. */
export const earlierRightsGroupDoc = (doc, chunkNames) => ({ schema: 1, names: chunkNames.map((n) => earlierRightsForName(doc, n)).filter(Boolean) });

