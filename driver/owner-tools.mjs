// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// owner-tools.mjs — the judges' tools, as plain functions over a loaded pile.
//
// PORTED FROM THE PRIVATE BENCH'S STAND-IN REGISTER (its `src/register-tools.mjs`, with the owner table
// in its second order), which is what the two judging sessions were measured reading. Every description
// and every refusal is the bench's, with its "saved run" said as "this search": the judges read a live
// run's pile, not a saved one. Nothing else in the words is changed, because what they were measured
// with is what they get.
//
// THREE RULES HOLD EVERYWHERE, the bench's own. An answer comes from the pile or it is a refusal: nothing
// is ever answered as "nothing found" unless the pile holds that answer. Every request is logged with what
// came back, because the log is the record of what the judges chose to read — and the fate record of every
// owner is built from it. And no answer is longer than the model's program will carry: a longer one is
// served in pages or parts, whole.
//
// ONE DIFFERENCE FROM THE BENCH, BY RULING (owner, 2026-10-01): a record's full body is FETCHED WHEN A
// JUDGE OPENS IT, if the run does not already hold it, and not before. The bench answered from what a
// saved run held and fetched nothing. The fetch is the caller's (`fetchRecord`); this module asks for it
// once per record and reads the body the fetch wrote.

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { groupByOwner, ownerKey, buildOwnerTable, CLOSENESS, LINE_COLUMNS, lineOf as ownerLine, isLive } from "./owner-table.mjs";

// ── bounded answers (the bench's `src/bounded.mjs`) ──────────────────────────────────────────────────
//
// The model's program withholds a tool answer past about 25,000 tokens and hands the model a file path
// instead, which a confined model cannot open. An answer longer than ANSWER_CHARS is therefore served in
// pages or parts. Nothing is dropped: the pages together are the whole answer, and each one says how many
// there are. Measured on the bench's first run, 2026-09-28: answers of 55,081 characters and more were
// withheld, 13 of 287; the longest answer the model received was 39,914.

export const ANSWER_CHARS = 30000;
/** Room kept for the fields around a page's items: counts, notes, page numbers. */
export const ENVELOPE_CHARS = 2000;
/** The opening message carries the table's first pages up to this many characters; the rest is read by tool. */
export const MESSAGE_TABLE_CHARS = 60000;

/** Cut text into pieces of at most `limit` characters, after "; " or a space where one is near the end. */
export function splitText(text, limit) {
  const s = String(text ?? "");
  const pieces = [];
  let at = 0;
  while (s.length - at > limit) {
    const window = s.slice(at, at + limit);
    const half = Math.floor(limit / 2);
    const clause = window.lastIndexOf("; ");
    const space = window.lastIndexOf(" ");
    const cut = clause >= half ? clause + 2 : space >= half ? space + 1 : limit;
    pieces.push(window.slice(0, cut));
    at += cut;
  }
  pieces.push(s.slice(at));
  return pieces;
}

/** Pack items into pages of at most `limit` characters and at most `most` items, in order. */
export function pack(items, limit, { most = Infinity } = {}) {
  const pages = [[]];
  let used = 0;
  for (const item of items) {
    const n = JSON.stringify(item).length + 1;
    const page = pages[pages.length - 1];
    if (page.length && (used + n > limit || page.length >= most)) {
      pages.push([item]);
      used = n;
    } else {
      page.push(item);
      used += n;
    }
  }
  return pages;
}

/** The page asked for, held inside the pages there are. */
export const pageAt = (asked, pages) => Math.max(1, Math.min(Number(asked) || 1, pages.length));

// ── the tools ────────────────────────────────────────────────────────────────────────────────────────

const GOODS_LINE = 200;
const DEFAULT_PAGE = 100;
const MAX_PAGE = 1000;
const STEPS = CLOSENESS.map((c) => `"${c}"`).join(", ");

export const OWNER_TOOLS = [
  {
    name: "owner_table",
    description: `Every owner this search found, one line each. Owners holding a live record in the order's classes come first; among them the closest mark first, then marks fewer letters away from the ordered mark, then owners at more offices. Closeness has four steps: ${STEPS}. The table comes in pages; the answer says how many, and how many owners each step holds.`,
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: {
        closeness: { type: "string", enum: CLOSENESS, description: "Only owners at this step." },
        live_in_the_order_classes: { type: "boolean", description: "Only owners holding a live record in the order's classes." },
        owner_contains: { type: "string", description: "Only owners whose name contains this text." },
        office: { type: "string", description: "Only owners holding a record at this office, by code." },
        page: { type: "integer", description: "Page, from 1." },
      },
    },
  },
  {
    name: "owner_records",
    description: "All the records of one owner across every list of this search, closest mark first. Each carries a first line of its goods and services. A long answer comes in pages.",
    inputSchema: {
      type: "object", additionalProperties: false, required: ["owner"],
      properties: {
        owner: { type: "string", description: "The owner's name, as the table gives it." },
        page: { type: "integer", description: "Page, from 1." },
      },
    },
  },
  {
    name: "register_questions",
    description: "The register questions this search ran, each with the register's own count and whether its records were listed. No other question can be answered here.",
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: {
        word: { type: "string", description: "Only questions asking a word that contains this text." },
        match: { type: "string", enum: ["exact", "contains", "wildcard"], description: "Only questions of this kind." },
        listed_only: { type: "boolean", description: "Only questions whose records were listed." },
        page: { type: "integer", description: "Page, from 1. The answer says how many pages there are." },
      },
    },
  },
  {
    name: "register_list",
    description: "The records one question returned, grouped by owner, largest owner first. Each record carries a first line of its goods and services. A long list comes in pages; the answer says how many.",
    inputSchema: {
      type: "object", additionalProperties: false, required: ["question"],
      properties: {
        question: { type: "string", description: "A question id from register_questions, such as Q012." },
        owner_contains: { type: "string", description: "Only owners whose name contains this text." },
        classes: { type: "array", items: { type: "integer" }, description: "Only records in any of these classes." },
        offices: { type: "array", items: { type: "string" }, description: "Only records at these offices, by code." },
        live_only: { type: "boolean", description: "Only registered and pending records." },
        page: { type: "integer", description: "Page, from 1." },
        page_size: { type: "integer", description: `Owner groups per page. Default ${DEFAULT_PAGE}, at most ${MAX_PAGE}. A page holds fewer when the groups are long.` },
      },
    },
  },
  {
    name: "register_open",
    description: "One full register record, with its complete goods and services. A long record comes in parts; the answer says how many.",
    inputSchema: {
      type: "object", additionalProperties: false, required: ["record"],
      properties: {
        record: { type: "string", description: "A record id from register_list." },
        classes: { type: "array", items: { type: "integer" }, description: "Only the goods and services in these classes." },
        part: { type: "integer", description: "Part of a long record, from 1." },
      },
    },
  },
  {
    name: "web_results",
    description: "Saved web search results. Without arguments: every word and place searched, with its number of results. With a word, a place or both: the results themselves, in pages when there are many.",
    inputSchema: {
      type: "object", additionalProperties: false,
      properties: {
        word: { type: "string", description: "The word searched." },
        place: { type: "string", description: "The place it was searched on." },
        page: { type: "integer", description: "Page, from 1." },
      },
    },
  },
  {
    name: "register_new_question",
    description: "Ask the register something this search did not run. It cannot be answered here. The request is recorded.",
    inputSchema: {
      type: "object", additionalProperties: false, required: ["words", "match", "reason"],
      properties: {
        words: { type: "array", items: { type: "string" } },
        match: { type: "string", enum: ["exact", "contains", "wildcard"] },
        classes: { type: "array", items: { type: "integer" } },
        offices: { type: "array", items: { type: "string" } },
        goods: { type: "string" },
        owner: { type: "string" },
        reason: { type: "string", description: "What the answer would change." },
      },
    },
  },
];

export const OWNER_TOOL_NAMES = OWNER_TOOLS.map((t) => t.name);

const refusal = (text) => ({ refused: true, text });
const present = (v) => v != null && !(Array.isArray(v) && v.length === 0);

function describeQuestion(q) {
  const out = {
    id: q.id,
    words: q.words,
    match: q.match,
    classes: q.classes,
    offices: q.allOfficesInScope ? `every office in the order's scope (${q.offices.length})` : q.offices,
    count: q.count,
    listed: q.listed,
    records_held: q.recordsHeld,
  };
  if (q.goods) out.goods = q.goods;
  if (q.owner) out.owner = q.owner;
  if (q.narrows) out.narrows = q.narrows;
  if (q.countPerWord) out.count_per_word = q.countPerWord;
  if (!q.listed) {
    out.note = q.recordsHeld
      ? `The register counted these records. This search holds a sample of ${q.recordsHeld} and did not list the rest.`
      : "The register counted these records. This search did not list them.";
  }
  return out;
}

function goodsLine(full, classes) {
  // A record this search does not hold has no goods line at all, never an empty one: on a register whose
  // listing carries no goods wording the blank read as "nothing in common" (design, 2026-10-03).
  if (!full) return {};
  const entries = Array.isArray(full?.goodsServices) ? full.goodsServices : [];
  const wanted = entries.filter((g) => !classes?.length || (g.classes ?? []).some((c) => classes.includes(Number(c))));
  const text = (wanted.length ? wanted : entries)
    .map((g) => `${(g.classes ?? []).join(",")}: ${g.translation || g.description || ""}`.trim())
    .join(" | ");
  return text.length > GOODS_LINE ? { goods: text.slice(0, GOODS_LINE), goods_cut: true } : { goods: text, goods_cut: false };
}

// The fields of a full record a judge is shown, in the order the bench showed them. A record of another
// shape (another register's) carries none of these and is shown whole, less its raw provider fields.
const RECORD_FIELDS = ["markText", "markFeature", "markTranslation", "markTransliteration", "markDisclaimers",
  "owner", "ownerNative", "ownerCountry", "representative", "office", "statusText", "statusClass",
  "applicationNumber", "applicationDate", "registrationNumber", "registrationDate", "publicationDates",
  "lastPublicationDate", "expiryDate", "renewalDate", "cancellationDate", "abandonmentDate",
  "niceClasses", "goodsServices", "priorities", "seniorities", "oppositions", "madridDesignations",
  "basicRegistrationApplications"];
const NOISE_FIELDS = new Set(["raw", "highlight", "score", "poca_scores", "onomaticsAggression", "_receipt"]);

/**
 * The tools over one pile. `fetchRecord(id)` is the fetch on open: async, resolves to `{ ok, cause? }`,
 * and leaves the body where `pile.readFullRecord` finds it. `log(row)` receives one row per request. PURE
 * apart from those two callbacks.
 */
export function makeOwnerTools(pile, { fetchRecord = null, log = null, now = () => Date.now(), answerChars = ANSWER_CHARS } = {}) {
  const room = Math.max(200, answerChars - Math.min(ENVELOPE_CHARS, Math.floor(answerChars / 4)));
  const table = buildOwnerTable(pile);
  const fetched = new Map();   // record id → the fetch's answer, asked once per record per session
  const fetchedNow = new Set();   // record ids whose open on this call reached the register: the log marks that call

  // A goods line is kept, never the full record behind it: some records run past a megabyte.
  const lines = new Map();
  const lineOf = (id, classes) => {
    const key = `${id}|${classes.join(",")}`;
    if (!lines.has(key)) lines.set(key, goodsLine(pile.readFullRecord(id), classes));
    return lines.get(key);
  };
  const noTable = () => refusal("This search does not record the order's mark, so its owners cannot be laid out by closeness.");

  const handlers = {
    owner_table({ closeness, live_in_the_order_classes, owner_contains, office, page } = {}) {
      if (!table) return noTable();
      const needle = owner_contains ? String(owner_contains).toLowerCase() : null;
      const atOffice = office ? String(office).toUpperCase() : null;
      const picked = table.rows.filter((r) =>
        (!closeness || r.row.closeness === closeness) &&
        (!live_in_the_order_classes || r.liveInClasses > 0) &&
        (!needle || r.records.some((x) => String(x.owner).toLowerCase().includes(needle))) &&
        (!atOffice || r.records.some((x) => String(x.office).toUpperCase() === atOffice)));
      const pages = pack(picked.map((r) => ownerLine(r.row)), room);
      const at = pageAt(page, pages);
      const before = pages.slice(0, at - 1).reduce((n, p) => n + p.length, 0);
      const answer = {
        owners_in_this_search: table.rows.length,
        by_closeness: table.summary,
        owners_after_filters: picked.length,
        page: at,
        pages: pages.length,
        columns: LINE_COLUMNS,
        owners: pages[at - 1],
      };
      // Kept off the answer: the owners on this page, by key, for the log and the fate record.
      Object.defineProperty(answer, "keysShown", { value: picked.slice(before, before + pages[at - 1].length).map((r) => r.key), enumerable: false });
      return answer;
    },

    owner_records({ owner, page } = {}) {
      if (!table) return noTable();
      const key = ownerKey(owner);
      const needle = String(owner ?? "").trim().toLowerCase();
      const found = table.byName.get(String(owner ?? "").trim()) ?? table.byKey.get(key) ??
        (needle.length >= 4 ? table.rows.filter((r) => r.records.some((x) => String(x.owner).toLowerCase().includes(needle))) : []);
      if (Array.isArray(found) && found.length !== 1) {
        return refusal(found.length
          ? `${found.length} owners hold "${owner}" in their name. owner_table with owner_contains lists them; ask for one by its full name.`
          : `No owner "${owner}" in this search. owner_table lists the owners it holds.`);
      }
      const one = Array.isArray(found) ? found[0] : found;
      const orderClasses = pile.orderClasses.map(Number);
      const list = one.records.map((r) => ({
        record: r.id, mark: r.mark, closeness: CLOSENESS[table.closenessOfRecord(r.id)], office: r.office, classes: r.classes,
        status: r.status, filed: r.filed, registered: r.registered,
        ...lineOf(r.id, orderClasses),
      }));
      const pages = pack(list, room);
      const at = pageAt(page, pages);
      const answer = { ...one.row, names: [...new Set(one.records.map((r) => r.owner))], page: at, pages: pages.length, list: pages[at - 1] };
      Object.defineProperty(answer, "keysShown", { value: [one.key], enumerable: false });
      return answer;
    },

    register_questions({ word, match, listed_only, page } = {}) {
      const needle = word ? String(word).toLowerCase() : null;
      const picked = pile.questions.filter((q) =>
        (!needle || q.words.some((w) => String(w).toLowerCase().includes(needle))) &&
        (!match || q.match === match) &&
        (!listed_only || q.listed));
      const pages = pack(picked.map(describeQuestion), room);
      const at = pageAt(page, pages);
      return {
        order_classes: pile.orderClasses,
        offices_in_scope: pile.scopeOffices.length,
        questions_held: pile.questions.length,
        matching: picked.length,
        page: at,
        pages: pages.length,
        shown: pages[at - 1].length,
        questions: pages[at - 1],
      };
    },

    register_list({ question, owner_contains, classes, offices, live_only, page, page_size = DEFAULT_PAGE } = {}) {
      const q = pile.questionById.get(String(question ?? "").toUpperCase());
      if (!q) return refusal(`No question ${question} in this search. register_questions lists the ones it ran.`);
      if (!q.listed && !q.recordsHeld) return refusal(`${q.id} was counted and not listed: the register gave ${q.count} records and this search holds none of them. Nothing is known about what they are.`);
      const wantOffices = offices?.length ? new Set(offices.map((o) => String(o).toUpperCase())) : null;
      const needle = owner_contains ? String(owner_contains).toLowerCase() : null;
      const rows = pile.recordsOf(q).filter((r) =>
        (!classes?.length || r.classes.some((c) => classes.includes(Number(c)))) &&
        (!wantOffices || wantOffices.has(String(r.office).toUpperCase())) &&
        (!live_only || isLive(r)) &&
        (!needle || String(r.owner).toLowerCase().includes(needle)));
      const groups = groupByOwner(rows);
      const questionClasses = q.classes.map(Number);
      const described = groups.map((g) => ({
        owner: g.owner,
        countries: [...new Set(g.records.map((r) => r.ownerCountry).filter(Boolean))],
        records: g.records.length,
        live: g.records.filter(isLive).length,
        offices: [...new Set(g.records.map((r) => r.office))].sort(),
        classes: [...new Set(g.records.flatMap((r) => r.classes))].sort((a, b) => a - b),
        list: g.records.map((r) => ({
          record: r.id, mark: r.mark, office: r.office, classes: r.classes, status: r.status,
          filed: r.filed, registered: r.registered,
          ...lineOf(r.id, questionClasses),
        })),
      }));
      // An owner whose records alone overfill a page is spread over several, and says so.
      const pieces = described.flatMap((g) => {
        if (JSON.stringify(g).length <= room) return [g];
        const { list, ...head } = g;
        const parts = pack(list, Math.max(200, room - JSON.stringify(head).length - 100));
        return parts.map((part, i) => ({ ...head, list_part: `${i + 1} of ${parts.length}`, list: part }));
      });
      const size = Math.max(1, Math.min(Number(page_size) || DEFAULT_PAGE, MAX_PAGE));
      const pages = pack(pieces, room, { most: size });
      const at = pageAt(page, pages);
      return {
        question: q.id,
        register_count: q.count,
        ...(q.listed ? {} : { sample_only: true, note: `A sample. The register counted ${q.count}; this search holds ${q.recordsHeld} of them and nothing is known about the rest.` }),
        records_held: q.recordsHeld,
        records_after_filters: rows.length,
        owner_groups: groups.length,
        page: at,
        pages: pages.length,
        groups: pages[at - 1],
      };
    },

    async register_open({ record, classes, part } = {}) {
      const id = String(record ?? "");
      if (!pile.recordById.has(id)) return refusal(`No record ${id} in this search.`);
      let f = pile.readFullRecord(id);
      if (!f && typeof fetchRecord === "function") {
        // FETCH ON OPEN, once per record: a second judge that fetched it first has written it to the
        // record log, so look again before asking the register.
        pile.refreshFullRecords?.();
        f = pile.readFullRecord(id);
        if (!f) {
          if (!fetched.has(id)) {
            let answer;
            try { answer = await fetchRecord(id); } catch (e) { answer = { ok: false, cause: String(e?.message ?? e).slice(0, 160) }; }
            fetched.set(id, answer ?? { ok: false, cause: "the fetch answered nothing" });
            fetchedNow.add(id);
            pile.refreshFullRecords?.();
          }
          f = pile.readFullRecord(id);
        }
      }
      if (!f) return refusal(`This search lists ${id} and holds no full record for it.`);
      const wanted = classes?.length ? new Set(classes.map(Number)) : null;
      const known = RECORD_FIELDS.some((k) => present(f[k]));
      const goods = (Array.isArray(f.goodsServices) ? f.goodsServices : [])
        .filter((g) => !wanted || (g.classes ?? []).some((c) => wanted.has(Number(c))));
      const whole = { record: id };
      if (known) {
        for (const k of RECORD_FIELDS) {
          const v = k === "goodsServices" ? goods : f[k];
          if (present(v)) whole[k] = v;
        }
      } else {
        for (const [k, v] of Object.entries(f)) if (!NOISE_FIELDS.has(k) && !k.startsWith("_") && present(v)) whole[k] = v;
      }
      if (wanted) whole.goods_shown_for_classes = [...wanted].sort((a, b) => a - b);
      if (JSON.stringify(whole).length <= answerChars) {
        if (part != null && Number(part) > 1) return refusal(`No part ${part}: ${id} is served whole.`);
        return whole;
      }

      // A long record. Its goods and services are cut into pieces and the pieces packed into parts;
      // part 1 also carries the rest of the record.
      const { goodsServices, ...head } = whole;
      const pieceChars = Math.max(100, Math.floor(room / 3));
      const pieces = goods.flatMap((g) => ["description", "translation"].flatMap((kind) => {
        if (!g[kind]) return [];
        const cut = splitText(g[kind], pieceChars);
        return cut.map((text, i) => ({
          classes: g.classes,
          language: kind === "description" ? g.language : g.translation_language,
          [kind]: text,
          ...(cut.length > 1 ? { piece: `${i + 1} of ${cut.length}` } : {}),
        }));
      }));
      const parts = pack(pieces, Math.max(pieceChars + 200, room - JSON.stringify(head).length));
      const at = part == null ? 1 : Number(part);
      if (!Number.isInteger(at) || at < 1 || at > parts.length) return refusal(`No part ${part}: ${id} has ${parts.length} parts.`);
      return {
        ...(at === 1 ? head : { record: id }),
        part: at,
        parts: parts.length,
        note: `A long record, served in ${parts.length} parts. Every part holds goods and services; part 1 also holds the rest of the record.`,
        goodsServices: parts[at - 1],
      };
    },

    web_results({ word, place, page } = {}) {
      const cells = pile.webCells();
      if (!cells) return refusal("This search holds no web results.");
      if (!word && !place) {
        return { cells: cells.length, searched: cells.map((c) => ({ word: c.word, place: c.place, results: c.results.length })) };
      }
      const picked = cells.filter((c) =>
        (!word || c.word.toLowerCase() === String(word).toLowerCase()) &&
        (!place || c.place.toLowerCase() === String(place).toLowerCase()));
      if (!picked.length) return refusal("This search searched no such word on no such place. web_results without arguments lists what it searched.");
      const pages = pack(picked, room);
      const at = pageAt(page, pages);
      return { cells: picked.length, page: at, pages: pages.length, results: pages[at - 1] };
    },

    register_new_question() {
      return refusal("This search never asked that, so nothing is known about its answer. The request is recorded.");
    },
  };

  async function call(name, args) {
    const handler = handlers[name];
    const started = now();
    let result;
    let failure = null;
    try {
      result = handler ? await handler(args ?? {}) : refusal(`No tool ${name}.`);
    } catch (e) {
      failure = String(e?.message ?? e);
      result = refusal(`The tool failed on this request: ${failure}`);
    }
    const text = JSON.stringify(result);
    if (typeof log === "function") {
      // An owner's records, asked for by owner, are one group of their own.
      const groups = Array.isArray(result?.groups) ? result.groups : Array.isArray(result?.list) ? [{ list: result.list }] : [];
      const opened = name === "register_open" && !result?.refused;
      const id = String(args?.record ?? "");
      try {
        log({
          at: started, tool: name, args: args ?? {},
          ok: result?.refused !== true, refused: result?.refused === true, failure,
          chars: text.length,
          records_shown: groups.reduce((n, g) => n + (g.list?.length ?? 0), 0) || (opened ? 1 : 0),
          owner_groups_shown: groups.length,
          // Which records and which owners were put in front of the judge. The log is the run's own.
          shown: opened ? [result.record] : groups.flatMap((g) => (g.list ?? []).map((r) => r.record)),
          ...(Array.isArray(result?.keysShown) ? { owner_keys_shown: result.keysShown } : {}),
          ...(opened && result.parts ? { part: result.part, parts: result.parts } : {}),
          ...(name === "register_open" && fetched.has(id) ? { fetched: fetched.get(id) } : {}),
          // THE CALL THAT REACHED THE REGISTER, once per fetch: every later open of the record carries the
          // answer above, and only this one was a billed call (owner-judgment-run.mjs, recordFetchCount).
          ...(name === "register_open" && fetchedNow.delete(id) ? { fetch_made: true } : {}),
        });
      } catch { /* a log that cannot be written must never break a read */ }
    }
    return { result, text, refused: result?.refused === true };
  }

  /**
   * A tool's answer for the driver's own use, unlogged: the driver is not a judge, and the opening pages it
   * puts in each message are recorded as shown to every judge where the step records its fates. Only the
   * tools that answer from the run's files at once; opening a record may fetch, and that is a judge's act.
   */
  function serve(name, args) {
    if (name === "register_open" || !handlers[name]) throw new Error(`owner-tools: ${name} is not served to the driver`);
    const result = handlers[name](args ?? {});
    return { result, text: JSON.stringify(result), refused: result?.refused === true };
  }

  return { call, serve, names: OWNER_TOOL_NAMES, tools: OWNER_TOOLS, table };
}

/** Append one request row to a JSONL log, creating its folder. Never throws. */
export function appendRequestLog(path, row) {
  try { mkdirSync(dirname(path), { recursive: true }); appendFileSync(path, `${JSON.stringify(row)}\n`); } catch { /* never breaks a read */ }
}
