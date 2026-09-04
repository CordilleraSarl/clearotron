---
name: knockout-frame
description: Frame a KNOCKOUT batch — scope, belt-and-braces classes, context framing and execution order for every mark, emitted as knockout-plan.json. You frame; you do not search.
---

# Knockout batch framing (Stage A of the knockout doctrine)

You are framing a **knockout batch**: a Stage-0 triage screen of several candidate names at once —
broad-not-deep, kill/no-kill. Your output drives a CODE-side research sweep (one templated call per
mark) and the assessment turn; nothing you write here searches anything.

## Tasks, per the batch

0. **Per-mark request detail**: the scope's `marksDetailed` rows carry any per-mark classes/refs the
   requester supplied (e.g. "NAME [9, 42]") — those classes are that mark's baseline; never drop them.
1. **List every mark verbatim** from the instructed scope (`_driver/instructed-scope.json` is the
   authority — quote names EXACTLY; paraphrase drift is a defect, not a style choice) and which
   classes apply to which mark.
2. **Product/industry context** — one plain sentence of what the client is doing (drives which
   marketplaces matter: gaming → Steam/Epic/app stores; physical goods → Amazon + category sites).
2b. **`contextFraming` — what THIS name is for, per mark, and it is a rating input.**
   One sentence per mark saying how the client intends to USE that particular name — a character name,
   a location name, a biome feature, an achievement title, a product line, a service tier. Where the
   requester declared a use per name, carry THEIR words for it; where they declared only a batch-level
   context, say what this name is for within it and do not invent a distinction they did not draw.
   *Why it is not decoration:* the firm-wide reasoning discipline calibrates on manner of use — a
   character name inside a franchise sits further from a franchise TITLE than the two strings suggest,
   and that pair moves a band. A `contextFraming` that repeats `batch.productContext` back gives the
   rater nothing to reason with, and the per-name detail the requester supplied is then lost for the
   rest of the run: nothing downstream re-reads the raw instructions.

3. **Belt-and-braces classes** per mark: add closely-adjacent classes a prudent search would cover
   (e.g. retail 35 beside goods classes; food theme → 29/43). Every addition gets a purple note in
   the plan ("Given the use for …, Class N was added for a belt-and-braces approach"). Nice-class
   integers only. Scope expansion is NEVER silent.
4. **Context framing** per mark (MANDATORY): what does this name read as in THIS context — coined,
   compound, common phrase, cultural echo? ("Coop" = chicken coop for a poultry brand, not a
   cooperative.) The assessor's rating hangs off this framing.
5. **Prior knowledge** from the request/instructions: anything the forwarder said about a mark
   ("client loves this one", known history) — folded in verbatim, never invented.
6. **Execution order**: common-word / known-problem marks first (they surface the batch's hard calls
   early). A permutation of the mark names, nothing added, nothing dropped.
7. **Umbrella-brand check** (proactive scope): if the request implies an umbrella/parent brand that
   is not in the mark list, do NOT add it yourself — flag it: "Consider whether [UMBRELLA]
   should be searched."
8. **Plain-language class line** per mark (`classesPlain`): the human-readable classes/industries
   sentence the sweep prompt will embed (e.g. "kitchen hand tools (8); household utensils (21);
   retail services (35, belt-and-braces)") — write it here so the sweep stays pure code.

## Output contract — `knockout-plan.json` (strict, closed keys)

```json
{ "schema": 1,
  "batch": { "productContext": "<one sentence>", "umbrellaBrandNote": null,
             "executionOrder": ["<mark>", "..."] },
  "marks": [ { "ref": "<or null>", "name": "<verbatim>", "classes": [8, 21],
               "beltAndBraces": [35], "classesPlain": "<plain-language line>",
               "contextFraming": "<what THIS name is for — see task 2b>", "priorKnowledge": null,
               "priority": 1 } ] }
```

Exactly one row per instructed mark (name parity vs instructed-scope, byte-exact after trim);
`beltAndBraces` are Nice ints; `executionOrder` is a permutation of the names. No tool calls, no
searching, no register speculation beyond the framing sentence. Also write a 2–3 sentence scope note
as `knockout-frame.md` (what the batch is, which classes, anything flagged).
