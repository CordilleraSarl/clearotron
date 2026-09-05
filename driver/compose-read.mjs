// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Reading a brief into a composed search — the "Describe it" half of the new-clearance screen.
//
// ── WHAT THIS IS, AND WHAT IT IS EMPHATICALLY NOT ───────────────────────────────────────────────────
//
// It is a FORM FILLER. Someone pastes "quick check on AQUAPLUS for energy drinks in the US before
// Friday, just the obvious blockers" and the composer comes back filled in: the name, class 32, the
// United States, a knockout search, a deadline. Every field it fills is an ordinary editable
// field afterwards, and the screen looks exactly as if the user had typed it.
//
// It is NOT a decision. It spends nothing, mints no confirmation token, touches no run store, and
// cannot start a search. That separation is the whole safety argument: the model's output is a DRAFT
// on a screen whose next step is still the plan gate, the server-resolved scope and the review dialog.
// Nothing here is trusted downstream, because nothing here reaches downstream — it reaches a textarea.
//
// ── WHY THE MODEL'S ANSWER IS BOUNDED HERE AND RESOLVED IN THE UI ───────────────────────────────────
//
// Two different jobs, deliberately split:
//
//   * THIS FILE bounds SHAPE. Types, array lengths, string lengths, integers in 1..45. A model that
//     returns three thousand names, or a 40kB "goods" string, or class 4000, must not reach a browser.
//     Shape is cheap to check and has no vocabulary in it, so it belongs on the server where the
//     untrusted bytes arrive.
//
//   * THE UI resolves VOCABULARY (portal-ui/src/contract/composeRead.ts). Whether "Bavaria" is a
//     territory the composer offers, whether class 43 belongs, is a question about the composer's own
//     lists — and those lists ARE the composer (composerLevers.ts, niceClasses.ts). Re-implementing
//     them here would give two answers to one question and the wrong one would be the invisible one.
//
// The prompt below names the territory vocabulary so the model returns canonical strings and the UI's
// resolution is usually a pass-through. That list is a DUPLICATE of REGIONS + COUNTRIES in
// portal-ui/src/contract/composerLevers.ts and is pinned by a test in both places. If they drift, the
// UI drops what it cannot place and SAYS SO in the read notes — a visible miss, never a silent one.
//
// ── WHAT THE READ IS NOT ALLOWED TO TOUCH ───────────────────────────────────────────────────────────
//
// Native-script deep dives (`scripts`). A deep dive is the most expensive lever on the screen and it
// routes on jurisdiction — inferring one from a sentence would quietly multiply the price of a search
// somebody asked to be quick. The user turns those on themselves, looking at the effort bar.

/** Hard input bound. A brief is an email or a paragraph; anything longer is a document, and a document
 *  is not what this button is for. Rejected loudly rather than truncated — a silently halved brief
 *  reads as a bad model. */
export const MAX_BRIEF = 12000;

/** Output bounds — enforced HERE, in `boundRead`, and nowhere else.
 *
 *  The schema cannot carry them: `maxItems` is not a keyword this API's structured output accepts and
 *  including it 400s the whole request (see the dialect note on READ_SCHEMA below). So these are
 *  stated to the model in prose, and applied to whatever actually comes back. A bound the server
 *  applies is a bound; a bound in a schema would only ever have been a request. */
const MAX_NAMES = 20;
const MAX_CLASSES = 15;
const MAX_TERRITORIES = 20;
const MAX_NOTES = 8;
import { PRODUCTS, PRODUCT_IDS } from "./products.mjs";

const MAX_STR = 600;
const MAX_NOTE = 240;

/**
 * The territory vocabulary, as offered by the composer's Where field.
 *
 * MIRRORS `REGIONS` + `COUNTRIES` in portal-ui/src/contract/composerProduct.ts. Kept here only so the
 * prompt can name it; the authority on what is selectable is the UI's own list.
 *
 * "Worldwide" LEFT THIS LIST. It is not a territory the composer offers and never was — it is a MODE,
 * and the read now carries it as its own boolean. Leaving it here taught the model to write a token the
 * form had to strip back out, which is how "everywhere" and "nowhere in particular" became the same
 * bytes on the wire in the first place.
 */
export const PROMPT_TERRITORIES = Object.freeze([
  "European Union", "Benelux", "African Regional (ARIPO)",
  "United States", "United Kingdom", "Ireland", "France", "Germany", "Spain", "Italy", "Netherlands",
  "Switzerland", "Austria", "Sweden", "Norway", "Poland", "Bulgaria", "Greece", "Turkey", "Canada",
  "Mexico", "Brazil", "Argentina", "China", "Hong Kong", "Taiwan", "Macau", "Japan", "South Korea",
  "Singapore", "India", "Thailand", "Australia", "New Zealand", "United Arab Emirates", "Saudi Arabia",
  "South Africa",
]);

/**
 * The shape the model must answer in.
 *
 * `additionalProperties: false` with every key required: a structured-output schema is not a hint, and
 * a partial object would leave the UI unable to tell "the brief said nothing about territories" from
 * "the model forgot". Absence is expressed as an empty array or an empty string, which is a statement.
 */
// THE STRUCTURED-OUTPUT SCHEMA IS A NARROW DIALECT — no `maxItems` on an array, no `minimum`/`maximum`
// on an integer. Either one 400s the WHOLE request:
//   output_config.format.schema: For 'array' type, property 'maxItems' is not supported
//   output_config.format.schema: For 'integer' type, properties maximum, minimum are not supported
// That is a failure on every single press, and no offline test can see it — a stubbed client happily
// accepts any schema you hand it. Both were found by making one real call, which is the only way this
// class of bug ever surfaces. Keep the dialect to types, `required`, `additionalProperties` and
// `description`; say the limits in prose and ENFORCE them in `boundRead`, which is where they belonged
// anyway. A bound the server applies is a bound; a bound in the schema was only ever a request.
export const READ_SCHEMA = Object.freeze({
  type: "object",
  properties: {
    names: {
      type: "array", items: { type: "string" },
      description: `The mark or marks to be cleared, exactly as written. At most ${MAX_NAMES}. Empty if the brief names none.`,
    },
    classes: {
      type: "array", items: { type: "integer" },
      description: `Nice classes (1 to 45) the goods or services fall in, at most ${MAX_CLASSES}. Empty unless the brief actually describes what is sold.`,
    },
    goods: {
      type: "string",
      description: "The goods and services in the brief's own words, one line. Empty if it does not say.",
    },
    territories: {
      type: "array", items: { type: "string" },
      // TWO DIFFERENT ANSWERS, and the form does different things with them. Empty is silence and the
      // filler leaves whatever the user already chose; `worldwide: true` is a statement and it clears
      // the countries on the form. Before this the model had no way to say the second at all, so an
      // explicit "worldwide" over a draft naming France was dropped without a trace.
      description: "Where, using the offered vocabulary exactly. Empty when the brief does not say — the form keeps whatever is already set. For a worldwide search set the `worldwide` field instead; never put a worldwide token in this list.",
    },
    worldwide: { type: "boolean", description: "True ONLY when the brief explicitly asks to search everywhere ('worldwide', 'global', 'all markets'). False when it names territories, and false when it says nothing about geography — those are different things and the form treats them differently." },
    product: { type: "string", description: "WHICH of the four searches the brief describes, by id, or an empty string when it does not say clearly. Never guess: an empty string leaves the choice to the person, which is the right outcome; a wrong guess buys them a different search." },
    ref: { type: "string", description: "The client's own reference or matter number, if the brief carries one." },
    deadline: { type: "string", description: "When it is needed by, as YYYY-MM-DD. Empty if the brief gives no date." },
    notes: {
      type: "array", items: { type: "string" },
      description: `Only what you were UNSURE about, one short line each, at most ${MAX_NOTES}. Empty when the brief was plain.`,
    },
  },
  required: ["names", "classes", "goods", "territories", "worldwide", "product", "ref", "deadline", "notes"],
  additionalProperties: false,
});

/**
 * The instructions.
 *
 * Written against the OFFERING, because the offering is what a client asks for by name. It used to be
 * written against four lever booleans from which the screen derived a level, with a note that a read
 * which "flips the wrong pair does not mislead anyone, it just picks wrong" — which was true only
 * because the screen then labelled the result. The reader names the product now, so the words it is
 * given and the words the client hears are the same four.
 */
export function systemPrompt({ today = new Date().toISOString().slice(0, 10) } = {}) {
  return [
    "You read a trademark clearance brief and fill in a search request form. You do not run the search,",
    "you do not advise, and nothing you return is acted on until a person has looked at it and pressed a",
    "button. Fill in what the brief actually says and leave the rest empty.",
    "",
    "THE FOUR SEARCHES. Return the id, or an empty string when the brief does not clearly describe one:",
    ...PRODUCTS.map((p) => `  ${p.id.padEnd(28)} ${p.geography}; up to ${p.maxNames} name${p.maxNames === 1 ? "" : "s"}${p.caseLaw ? "; carries the case-law and opposition reading" : ""}`),
    "The geography and the search have to agree — that is what the form checks. A brief naming one country",
    "is a full-country-search; two or more, or a region, is a multi-country-focus-search; everywhere is a",
    "global-preliminary-search; several names screened quickly is a knockout-search.",
    "Choose full-country-search only when the brief asks for ONE country. Its case-law and opposition",
    "reading is not something to add — it is what that search is — so do not reach for it because the brief",
    "mentions a dispute in passing.",
    "AN EMPTY STRING IS A REAL ANSWER and often the right one. The person composing the search will choose,",
    "and the form shows them the four. A wrong guess buys them a different search.",
    "",
    "TERRITORIES — use these names exactly, and nothing else:",
    PROMPT_TERRITORIES.join(", "),
    "Return an EMPTY list when the brief does not say where — the form keeps whatever is already set.",
    "When the brief does say everywhere ('worldwide', 'global', 'all markets'), set `worldwide` true and",
    "leave this list empty: that is how the form is told to clear the countries already on it. Never put a",
    "worldwide token in this list, and never set `worldwide` alongside named territories.",
    "",
    "CLASSES — Nice classification, 1 to 45. Only classify goods or services the brief actually describes.",
    "If it says 'drinks' give 32; if it says nothing about what is sold, return an empty list rather than",
    "guessing from the mark. A wrong class is worse than a missing one: the reader will add what is",
    "missing, and may not notice what is wrong.",
    "",
    "NAMES — the mark being cleared, exactly as written, including its capitalisation. Not the company",
    "asking, not the product category, not a competitor mentioned in passing.",
    "",
    `DEADLINE — today is ${today}. Resolve 'Friday' or 'end of month' against it, as YYYY-MM-DD. If the`,
    "brief gives no date, return an empty string. Never invent urgency.",
    "",
    "NOTES — ONLY what you were unsure about, one short line each: 'The brief names both LUMEN and",
    "LUMENA — I took LUMEN', 'It says \"snacks\" but not what kind, so class 29 or 30'. Do not list what",
    "you did — the screen shows the reader every field you filled and they can see it for themselves.",
    "A note that says 'I read the mark as AQUAPLUS' beside a box already reading AQUAPLUS wastes the",
    "one place a doubt could have been raised. Return an empty list when the brief was plain.",
  ].join("\n");
}

const str = (v) => (typeof v === "string" ? v.trim().slice(0, MAX_STR) : "");
const strList = (v, cap, max = MAX_STR) =>
  (Array.isArray(v) ? v : [])
    .map((s) => (typeof s === "string" ? s.trim().slice(0, max) : ""))
    .filter(Boolean)
    .slice(0, cap);

/**
 * Everything the model said, bounded to what a browser may be handed.
 *
 * Total, not partial: an unparseable field becomes its empty value rather than throwing, because a
 * brief that half-read is still worth more than an error toast. What it must never do is pass an
 * unbounded value through — see the header.
 */
export function boundRead(raw) {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const classes = [];
  for (const c of Array.isArray(r.classes) ? r.classes : []) {
    const n = typeof c === "number" ? c : Number.parseInt(String(c), 10);
    // 1..45 is the whole Nice classification. Out of range is not a class the composer can render, and
    // de-duplicated because "32, 32" would draw one chip and count two.
    if (Number.isInteger(n) && n >= 1 && n <= 45 && !classes.includes(n)) classes.push(n);
  }
  // An ISO date or nothing. A free-text deadline is what the old composer had and what the redesign
  // replaced with a date field — accepting 'next Friday' here would put it straight back.
  const deadline = /^\d{4}-\d{2}-\d{2}$/.test(str(r.deadline)) ? str(r.deadline) : "";
  return {
    names: strList(r.names, MAX_NAMES, 120),
    classes: classes.slice(0, MAX_CLASSES),
    goods: str(r.goods),
    territories: strList(r.territories, MAX_TERRITORIES, 60),
    // WORLDWIDE IS POSITIVE-ONLY and the PRODUCT falls back to null, not to a guess. The old defaults
    // here read `!== false` — a dropped boolean became a full clearance, on the grounds that it must not
    // "silently downgrade someone's search to a knockout". That reasoning had no answer for the other
    // direction, and the offering makes the other direction expensive: a defaulted product is a search
    // nobody chose. Null leaves the choice on the screen, which is where it belongs.
    worldwide: r.worldwide === true,
    product: PRODUCT_IDS.includes(str(r.product)) ? str(r.product) : null,
    ref: str(r.ref),
    deadline,
    notes: strList(r.notes, MAX_NOTES, MAX_NOTE),
  };
}

/**
 * A per-person hourly budget for pressing Read this.
 *
 * The portal's own limiter is 120/min shared across everything — sized for status polling, which is
 * free. This button is not free, and the failure it guards against is not abuse but a LOOP: a client
 * whose read came back thin presses again, and again, and a browser that retries on error presses
 * forever. Twenty an hour is more than any composition needs and cheap to be wrong about.
 *
 * Per process and in memory, exactly like the portal's other limiter — one portal process per instance
 * is a documented bound of this deployment, not an oversight.
 */
export function makeReadBudget({ perHour = 20 } = {}) {
  const seen = new Map();
  return {
    take(key, now = Date.now()) {
      const k = key || "anon";
      const hour = 3600000;
      const hits = (seen.get(k) ?? []).filter((t) => now - t < hour);
      // Pruned on the way past: a map keyed by verified emails is org-bounded, and every entry that
      // matters is rewritten here anyway.
      if (seen.size > 500) for (const [k2, v] of seen) if (!v.some((t) => now - t < hour)) seen.delete(k2);
      if (hits.length >= perHour) return false;
      hits.push(now);
      seen.set(k, hits);
      return true;
    },
  };
}

/**
 * The reader.
 *
 * `client` is injected so every test runs offline — the same shape the rest of the driver uses for its
 * executors. Live, portal-service builds one through the ENGINE DOOR; with no engine reachable it
 * builds NOTHING and the route reports itself unavailable, which is how this feature stays dark on a
 * box that cannot reach one rather than 500ing on every press.
 *
 * It used to say the client was built from `@anthropic-ai/sdk`, in the present tense, long after the
 * change recorded below moved this route through the engine door. The SDK has now been removed from
 * the manifests entirely (tracker issue 99) — nothing in the tree imports it.
 */
/**
 * Every way a parsed payload can fail to be a read, named.
 *
 * DERIVED FROM `READ_SCHEMA`, never restated. Until this issue the schema was enforced SERVER-SIDE by
 * `output_config: { format: { type: "json_schema" } }`, so a payload that parsed was a payload that
 * conformed. Going through the engine door removes that guarantee — `runTurn` spawns a CLI and there is
 * no `output_config` on it — so this function is the ONLY thing standing between a wrong-shaped answer
 * and the composer.
 *
 * That matters more than it looks. `boundRead` is a total normaliser: hand it `{}` and it returns a
 * complete, empty read, which the composer then presents as "the model read your brief and found
 * nothing". A missing-keys payload would not throw, would not warn, and would look exactly like a brief
 * that said nothing. Loud and by name is the whole requirement.
 *
 * A second statement of the shape would drift from the first, so `required` and the property types come
 * off the schema object itself.
 */
export function readShapeErrors(parsed) {
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
    return [`expected a JSON object, got ${parsed === null ? "null" : Array.isArray(parsed) ? "an array" : typeof parsed}`];
  const errs = [];
  const props = READ_SCHEMA.properties;
  for (const key of READ_SCHEMA.required) {
    if (!Object.hasOwn(parsed, key)) { errs.push(`missing "${key}"`); continue; }
    const want = props[key]?.type;
    const got = Array.isArray(parsed[key]) ? "array" : typeof parsed[key];
    const ok = want === "array" ? got === "array"
      : want === "boolean" ? got === "boolean"
      : want === "string" ? got === "string"
      : true;
    if (!ok) errs.push(`"${key}" should be ${want}, got ${got}`);
  }
  // `additionalProperties: false` is part of the schema, so a key nobody asked for is a shape error too —
  // it is the signal that the answer came from something that was not following these instructions.
  for (const key of Object.keys(parsed)) if (!Object.hasOwn(props, key)) errs.push(`unexpected "${key}"`);
  return errs;
}

/**
 * The JSON object in a turn's text, or null.
 *
 * The engine door returns whatever the CLI printed. A well-behaved turn prints the object alone; a
 * chatty one wraps it in a fence or a sentence. Both are read, and anything else is a null the caller
 * reports by name rather than a throw at this depth.
 */
export function jsonFromTurnText(text) {
  const raw = String(text ?? "").trim();
  if (!raw) return null;
  const direct = (() => { try { return JSON.parse(raw); } catch { return undefined; } })();
  if (direct !== undefined) return direct;
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) { try { return JSON.parse(fenced[1].trim()); } catch { /* fall through */ } }
  const first = raw.indexOf("{"), last = raw.lastIndexOf("}");
  if (first >= 0 && last > first) { try { return JSON.parse(raw.slice(first, last + 1)); } catch { /* fall through */ } }
  return null;
}

export function makeComposeReader({ turn, now = () => new Date() } = {}) {
  if (typeof turn !== "function") return null;
  return async function read(brief) {
    const text = String(brief ?? "").trim();
    if (!text) return { ok: false, error: "empty", message: "There is nothing to read yet." };
    if (text.length > MAX_BRIEF) {
      return {
        ok: false, error: "too_long",
        message: `That is ${text.length.toLocaleString("en-GB")} characters — paste up to ${MAX_BRIEF.toLocaleString("en-GB")}, or set the search up below.`,
      };
    }
    // NO `thinking` BLOCK, DELIBERATELY. Owner ruling 2026-07-22: sonnet, thinking off. This is
    // extraction, not judgment — the brief already contains every fact the answer needs, and the
    // reasoning that matters (is this mark clear?) happens later, in the run, where it is paid for.
    // Off also keeps the button feeling like a button.
    //
    // If anyone re-adds it: `thinking` is NOT accepted everywhere. Haiku 4.5 answers
    //   400 invalid_request_error: adaptive thinking is not supported on this model
    // which would be a failure on every press, so a `PORTAL_READ_MODEL` change and a thinking block
    // must never be made in the same breath without one real call to prove the pair.
    // THROUGH THE ENGINE DOOR, not a client of our own. The reader used to build an
    // `@anthropic-ai/sdk` client from a raw ANTHROPIC_API_KEY, which meant the button could only ever
    // work on a metered box — and `anthropic-agent` DELETES that key on a subscription box to force one
    // billing mode. So the feature was off exactly on the posture the product recommends, and the
    // remedy would have been metered spend beside subscription stages: the mix the owner's
    // "one LLM provider only ever, API or auth, no mix" ruling ended.
    //
    // The instruction has to carry the schema now. `output_config` is a Messages-API parameter and there
    // is no equivalent on a spawned CLI turn, so what was a server-side guarantee becomes a request —
    // and `readShapeErrors` below is what makes the difference visible instead of silent.
    const t = await turn({
      prompt: `${systemPrompt({ today: now().toISOString().slice(0, 10) })}\n\n`
        + `Reply with ONE JSON object and nothing else — no prose, no code fence. It must match this schema exactly:\n`
        + `${JSON.stringify(READ_SCHEMA)}\n\nThe brief:\n${text}`,
    });
    if (!t?.ok) {
      return { ok: false, error: "engine", message: "The reader could not reach the engine just now — set the search up below.",
        cause: t?.cause ?? "the engine turn did not complete", vendor: t?.vendor ?? null, authMode: t?.authMode ?? null,
        engine: t?.engine ?? null, model: t?.model ?? null };
    }
    const parsed = jsonFromTurnText(t.text);
    if (parsed === null) {
      return { ok: false, error: "unreadable", message: "I could not make sense of that — set the search up below.",
        cause: "the engine turn returned no JSON object", vendor: t.vendor, authMode: t.authMode, engine: t.engine, model: t.model };
    }
    // LOUD AND BY NAME, and this is the branch that matters. A payload that PARSES and is missing keys
    // would flow straight through `boundRead` — a total normaliser — and arrive at the composer as a
    // complete, empty read presented as an authoritative answer. Unparseable text was always caught;
    // plausible-but-wrong never was, because the schema was enforced on the server.
    const shape = readShapeErrors(parsed);
    if (shape.length) {
      return { ok: false, error: "shape", message: "The reader got an answer it could not trust — set the search up below.",
        cause: `the engine turn's JSON did not match the read schema: ${shape.join("; ")}`,
        vendor: t.vendor, authMode: t.authMode, engine: t.engine, model: t.model };
    }
    // Vendor, billing mode and served model ride on the result, the same receipt the jx lanes report.
    return { ok: true, read: boundRead(parsed), stopReason: t.truncated ? "max_tokens" : null,
      vendor: t.vendor, authMode: t.authMode, engine: t.engine, model: t.model };
  };
}
