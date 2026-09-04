# Prelim Template — HTML Formatting Spec

> **THIS FILE IS HALF LIVE, AND THE HALVES HAVE DIFFERENT READERS. Check which half you are in before
> you trust a line.**
>
> **LIVE — [Formatting specifications](#formatting-specifications) onward (fonts, colours, table
> styling, spacing, alignment, CSS classes).** This is the FORMATTING REFERENCE that
> `driver/publish/render-knockout.mjs` follows byte-faithfully — `border:solid windowtext 1pt`,
> `padding:0cm 5.4pt`, Calibri 11pt. It is a description of what the renderer emits, addressed to
> whoever maintains the renderer. **Changing a value here changes nothing on its own; the renderer is
> the thing that emits.** Never edit a value here without moving the renderer in the same change, or
> the two silently disagree and this file starts lying.
>
> **RETIRED — [Fields to extract](#fields-to-extract) through [Multiple names](#multiple-names), and
> the email-body items under [Critical formatting rules](#critical-formatting-rules).** These dictate a
> seat-authored HTML email body. **No seat writes one.** `composeEmailHtml` composes the client email
> in code and the notify seat sends that file verbatim, so a body drafted against this spec reaches no
> reader. Kept because the section names map onto the knockout table the renderer still builds.
>
> **The confidentiality marking is not stated here.** It is `confPosture` in `shared/brand.mjs`, which
> is three-valued and is the only statement of it: absent ⇒ "Privileged & Confidential", `true` ⇒ that
> plus "· Attorney Work Product", `false` ⇒ off. This file used to assert it unconditionally, which
> made a third rule for one marking.

The HTML structure, styling, and content rules for the Preliminary Trademark Review Report.

## Fields to extract

From the TRADEMARK SEARCH REQUEST FORM in the forwarded email:

| Field | Maps to |
|-------|---------|
| Deadline | Note in daily log; consider diarizing |
| Reference No. | Used in subject line and logging only |
| Names | → NAME(S) row + one ANALYSIS/NOTES row per name |
| Classes | → Referenced in intro text ("Our search primarily focused on Classes X, Y, Z") |
| Description | → PROJECT DESCRIPTION row |
| Manner of Use | → MANNER OF USE row |
| Additional Info | → ADDITIONAL INFORMATION row (preserve line breaks) |
| Send Response to | Note for the reviewing lawyer's reference; do NOT send to these addresses |

## Output structure

**RETIRED — this section describes the seat-authored email body, and no seat authors one.** It is the
section order of the document the knockout renderer builds, kept as the map from these names to that
table. Do not draft an email from it.

Sections in order:

1. The confidentiality line, italic — **wording and condition both come from `confPosture`
   (`shared/brand.mjs`), never from this file.** It is three-valued and the row DROPS when the posture
   is off, so this is not an unconditional header.
2. Blank line
3. Greeting: `Hi [Client first name] and team`
4. Blank line
5. Intro paragraph: `We conducted a preliminary clearance search for the use of **[NAME]** as a [description context]. Our search primarily focused on Classes [X, Y, Z].`
6. Blank line
7. Purple legend: `Information for your reference/context that likely does not need to be shared with the business is in **purple**.` (black text, "purple" in bold purple #A02B93)
8. Report table (see below)
9. Sign-off: `Any questions, let me know!` / blank line / `Best wishes,` / `[reviewer name]`

## Table structure

Single HTML table with the following rows.

### Header row
Full-width black background, white bold centered text: `PRELIMINARY TRADEMARK REVIEW REPORT`.

### Data rows (2-column: label | value)
Left cell = bold label (centered). Right cell = extracted data.

| Label | Content |
|-------|---------|
| NAME(S) | Bold uppercase: e.g. `NIMBUS TRAIL` |
| PROJECT DESCRIPTION | From Description field. Include context like "Name will be used as..." |
| MANNER OF USE | From Manner of Use field |
| ADDITIONAL INFORMATION | From Additional Info field. Preserve line breaks (each item on its own line) |

### EXECUTIVE SUMMARY section
Full-width gray (#BFBFBF) background header row, bold centered: `EXECUTIVE SUMMARY`. Content row spans full width:

- `Based on the global preliminary search results, the use of **[NAME]** as a [description context] poses a **[x risk]**.`
- Blank line
- In purple (#A02B93): `The below analysis takes account of the following factors:`
- Bullet list with placeholder: `**[x]**` (bold, yellow highlight, purple text)

### ANALYSIS/NOTES section
Full-width gray (#BFBFBF) background header row, bold centered: `ANALYSIS/NOTES`.

**One row per search name** (2-column layout):

Left cell:
- Name in bold uppercase centered: e.g. `NIMBUS TRAIL`
- Below: `**[x]** RISK` ([x] on yellow highlight)

Right cell — structured with subsections:
- Underlined subheading: `Filings`
  - Bullet: `**Level 2 Risk = B –**` (green #4EA72E, bold, purple text)
  - Bullet: `**Level 3 Risk = C + Horse Trade / Paper Conflict –**` (yellow/amber #FFC000, bold, purple text after dash underlined)
- Blank line
- Underlined subheading: `Common law use`
  - Bullet: `**Level 2 Risk = B –**` (green #4EA72E, bold, purple text)
  - Bullet: `**Level 3 Risk = C + Horse Trade / Paper Conflict –**` (yellow/amber #FFC000, bold, purple text after dash underlined)

### Multiple names
When the request contains multiple names, duplicate the ANALYSIS/NOTES row for each name. Each gets its own left cell (name + risk placeholder) and right cell (Filings + Common law use structure).

## Formatting specifications

### Fonts
- Primary: `"Calibri", sans-serif` at `11.0pt`
- Sign-off and greeting: same as primary
- Do NOT use Aptos, Arial, or other fonts in the report body

### Colors (exact hex codes)

| Element | Color |
|---------|-------|
| Table header background | black |
| Table header text | white |
| Section header background (EXEC SUMMARY, ANALYSIS/NOTES) | #BFBFBF (gray) |
| Internal context text | #A02B93 (purple) |
| Level 2 Risk text | #4EA72E (green) |
| Level 3 Risk text | #FFC000 (amber/yellow) |
| Risk placeholder highlight | yellow background |
| Regular body text | black |

### Table styling
- Border: `solid windowtext 1.0pt` on cells
- ANALYSIS/NOTES bottom border: `solid windowtext 1.5pt` (thicker)
- Cell padding: `0cm 5.4pt 0cm 5.4pt`
- Border-collapse: collapse
- Table offset: `margin-left: 5.4pt`

### Spacing
- Line-height: `105%` on list paragraphs
- Paragraph margins: `margin: 0cm` (use `&nbsp;` paragraphs for vertical spacing between sections)
- Margin-bottom on specific paragraphs: `3.0pt` or `6.0pt` where breathing room is needed (e.g., after PROJECT DESCRIPTION text)

### Text alignment
- Table header rows: centered (`text-align: center`)
- Label cells (NAME(S), PROJECT DESCRIPTION, etc.): centered
- Content cells: left-aligned (default)
- ANALYSIS/NOTES left cell (name + risk): centered

### Bold, italic, underline rules
- The confidentiality line (wording from `confPosture`, `shared/brand.mjs`): italic
- Search name in NAME(S) row: bold
- Search name in ANALYSIS/NOTES left cell: bold
- Section labels (NAME(S), PROJECT DESCRIPTION, etc.): bold, black
- EXECUTIVE SUMMARY / ANALYSIS/NOTES headers: bold, black, centered
- Subsection headings in analysis (Filings, Common law use): underlined, black
- Risk level labels: bold, coloured per spec above
- Purple legend text: bold on "purple" word only

## CSS classes

Consistent with Outlook/Word HTML:
- `MsoNormal` for regular paragraphs
- `MsoListParagraph` for list items
- Inline styles on `<span>` for colours, fonts, sizes

## Critical formatting rules

**LIVE — what the renderer emits:**

1. **HTML only** — the document is markup, never markdown. `<table>`, `<strong>`, `<em>`, `<br>`, `<u>`, `<span style="...">`.
2. **One ANALYSIS/NOTES row per search name** — the full row structure repeats for each name.
3. **The boilerplate is fixed text** — purple legend, "The below analysis takes account of the following factors:", sign-off structure. These appear every time.

**RETIRED — instructions to a seat that no longer drafts this:**

4. ~~**Calibrate against this spec** before sending.~~ Nothing is drafted against this spec, so there is nothing to calibrate. The renderer emits it; the check that matters is `render-frozen`, not a reader's eye.
5. ~~**Bullet formula (spec 09)**~~ — and it is not merely unused, it is **SUPERSEDED**. It formed the bullet as `Level <Composite 1–5> Risk = <letter A–E>`, and the live doctrine forbids exactly that: `delivery-contract.md` rules ZERO risk codes on a client surface, and [worked-examples.md](worked-examples.md) §"The client-table bullet formula" carries the form in force — the framework's own **band word**, a plain word, never a numeral or letter code. Follow worked-examples.md. Copying the formula above would put a retired rating code in front of a client.
