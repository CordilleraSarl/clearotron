---
name: knockout-frame
description: Frame a KNOCKOUT batch — scope, belt-and-braces classes, context framing and execution order for every mark, emitted as knockout-plan.json. You frame; you do not search.
---

# Knockout batch framing (Stage A of the knockout doctrine)

You are framing a **knockout batch**: a Stage-0 triage screen of several candidate names at once —
broad-not-deep, kill/no-kill. Your output drives a CODE-side web search and the assessment turn. The
search runs each name's spellings (task 2e), with its use phrase (task 2c),
on every place you name for it (task 2d), and keeps what each search returned, with no summary. Nothing you write here searches anything.

## Tasks, per the batch

0. **Per-mark request detail**: the scope's `marksDetailed` rows carry any per-mark classes/refs the
   requester supplied (e.g. "NAME [9, 42]") — those classes are that mark's baseline; never drop them.
1. **List every mark verbatim** from the instructed scope (`_driver/instructed-scope.json` is the
   authority — quote names EXACTLY; paraphrase drift is a defect, not a style choice) and which
   classes apply to which mark.
2. **Product/industry context** — one plain sentence of what the client is doing (drives which
   marketplaces matter: gaming → Steam/Epic/app stores; physical goods → Amazon + category sites).
2b. **`contextFraming` — one sentence: what THIS name is for and what it reads as. The rater weighs the stated manner of use with it; a framing alone never sets a band.**
   One sentence per mark saying how the client intends to USE that particular name — a character name,
   a location name, a biome feature, an achievement title, a product line, a service tier. Where the
   requester declared a use per name, carry THEIR words for it; where they declared only a batch-level
   context, say what this name is for within it and do not invent a distinction they did not draw.
   *Why it is not decoration:* the firm-wide reasoning discipline calibrates on manner of use — a
   character name inside a franchise sits further from a franchise TITLE than the two strings suggest,
   and that pair moves a band. A `contextFraming` that repeats `batch.productContext` back gives the
   rater nothing to reason with, and the per-name detail the requester supplied is then lost for the
   rest of the run: nothing downstream re-reads the raw instructions.
   Where the request does not state what a name is for, say so here and write what you infer as a possibility ("possibly a game title"), never as what the client intends.
2c. **`inUseAs` — how a name could already be in use off the register, in this client's field.** One
   phrase that completes "Is this name already in use as …?", naming the kinds of use a name collides
   with in this field: a character, a place, a title or an achievement inside a game, show, film or book
   for a games or media client; a cocktail, a venue or a beverage line for a drinks client; a compound
   or a product line for a pharma client. Judge it from the client's field and the batch's context;
   these examples are not a list to copy. The places you name in task 2d include the sites where these
   uses are listed, so a kind of use you leave out has no place searched for it.
   Then **`batch.useKind`**, the use phrase: One to three words copied exactly from the request, saying what the client will use the names for. Every web search adds them after the name. Give a name its own useKind only when the request gives that name a different use, copied the same way; otherwise leave the field out.
2d. **`places` — per mark, the places THIS name is searched on: two or more, and as many as the name needs.** The places that matter for
   this client: its stores, and the sites where the kinds of use in task 2c are listed. One of them is
   `web`, the whole web, where famous names and cultural references surface. Every other place is a
   site's domain written as a bare host (`store.steampowered.com`, `fandom.com`); a domain covers its
   subdomains, so `fandom.com` reaches every wiki hosted there. Every spelling of THIS name is searched
   once on each of ITS places, so a place you leave out is not searched for this name.
   **Choose them per name, and there is no cap.** Two names in one batch can want different places: a
   name that reads as a game character wants the wikis, a name that reads as an app wants the app stores,
   and neither should carry the other's list. Name as many as the name needs and no more — every place you
   add is another search of every spelling, so a list nobody needs costs minutes and finds nothing.
2e. **Spellings — the driver writes them, and you send none.** For marketplace searches, use each
   submitted name as written and its distinct joined and hyphenated forms. Keep every expressly
   instructed alternative tied to its submitted name. Each spelling is searched on every place in
   task 2d.
2f. **`alternatives` — where the request gives one item in more than one spelling or word order ("LAKE MOON / MOON LAKE"), list each form as written.** `name` stays verbatim. Each form is searched on its own and stays tied to this row. Leave it out where the request gives one form. A slash does not make alternatives by itself, and two separate items stay two rows.

3. **Added classes** per mark: add a class only for the client's own goods, never for what a competitor
   might hold, with one sentence saying why. Every addition is marked "belt-and-braces" in
   `classesPlain` (task 8). Nice-class
   integers only. Scope expansion is NEVER silent.
4. **Context framing** per mark (MANDATORY): what does this name read as in THIS context — coined,
   compound, common phrase, cultural echo? ("Coop" = chicken coop for a poultry brand, not a
   cooperative.) It tells the assessor what the name reads as. It does not set the band — a framing
   never raises or lowers a rating, and a risk belonging to the name is a finding of its own.
5. **Prior knowledge** from the request/instructions: anything the forwarder said about a mark
   ("client loves this one", known history) — folded in verbatim, never invented.
6. **Execution order**: common-word / known-problem marks first (they surface the batch's hard calls
   early). A permutation of the mark names, nothing added, nothing dropped.
7. **Umbrella-brand check** (proactive scope): if the request implies an umbrella/parent brand that
   is not in the mark list, do NOT add it yourself — flag it: "Consider whether [UMBRELLA]
   should be searched."
8. **Plain-language class line** per mark (`classesPlain`): the human-readable classes/industries
   sentence the rating step reads beside the class numbers (e.g. "kitchen hand tools (8); household
   utensils (21); retail of the client's own goods (35, belt-and-braces)").

## Output contract — `knockout-plan.json` (strict, closed keys)

```json
{ "schema": 1,
  "batch": { "productContext": "<one sentence>", "inUseAs": "<task 2c>", "useKind": "<task 2c: the use phrase>",
             "umbrellaBrandNote": null, "executionOrder": ["<mark>", "..."] },
  "marks": [ { "ref": "<or null>", "name": "<verbatim>", "classes": [8, 21],
               "beltAndBraces": [35], "classesPlain": "<plain-language line>",
               "contextFraming": "<what THIS name is for — see task 2b>",
               "useKind": "<task 2c: only where the request gives this name a different use, or leave out>",
               "places": ["web", "<host>", "..."],
               "alternatives": ["<task 2f, or leave out>"], "priorKnowledge": null,
               "priority": 1 } ] }
```

Exactly one row per instructed mark (name parity vs instructed-scope, byte-exact after trim);
`beltAndBraces` are Nice ints; `executionOrder` is a permutation of the names. Each mark's `places` holds
two or more entries, with no upper limit, one of them `web` and each other a bare host. No searching, no register speculation beyond the framing sentence. Also send a
2–3 sentence scope note as `scope_note` (what the batch is, which classes, anything flagged).
