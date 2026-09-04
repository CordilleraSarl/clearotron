# Test fixtures — provenance

House rule: **real shapes, synthetic identities.** Every byte of structure here was cut from a real
run — an invented fixture only carries the shapes you already thought of, so it certifies the bug
instead of catching it. But the identities that made it one client's matter have been substituted for
demo twins, because this repo publishes.

**What that means when you read these files.** The layout, the field grammar, the punctuation, the
truncations, the odd casings and the wrong-looking spacing are all real and must be preserved — they
are the fixture. The names, the mark, the transliteration and the run slugs are not real, and nothing
about them should be treated as a fact about the world. Two identities were left as they are and are
declared in `driver/test/no-client-identifiers.test.mjs`: public register proprietors cited as
third-party evidence, where renaming would rewrite what the fixture is evidence *of*.

The substitution was mechanical and stem-based, so the relationships between the marks survive it — an
edit-1 neighbour is still one edit away, a terminal embedding still embeds, the wildcard queries still
match the stem, and the letter-overlap arithmetic in the prose still adds up. **If you regenerate or
extend these files, preserve the relationships, not just the strings.**

Formatting is otherwise untouched — no added headers, no reformatting — so they parse exactly as
production input does.

## `report.internal.md`

Excerpt of `report.md` from a real run, identities substituted — the **internal cut**, i.e. the bytes
`read_artifact` serves for `name:"report"`. Two contiguous blocks, unmodified but for the
substitution: source lines `1–31` (front matter + `# Actions`) and `39–65` (`# Methodology` + the first
`# Marks` card). It ends mid-document on a bare card heading with no body; that truncation is one of
the shapes — do not complete the card.

Chosen because every shape `lib/scrub.mjs` must handle is real in it:

| Shape | Why it matters |
|---|---|
| `- [internal] …` bullets | the labelled internal form the published file actually carries (the raw `::p::` marker is consumed at publish) — the R1 leak |
| `overall_badge: l4` | the internal Level/Composite shorthand the report footer says is "removed on export" |
| `rated_under: … · profile d37721cda899` | framework config identity; the client footer shows the title alone |
| `Corsearch` / `perplexity_research` in ordinary prose, and in `- Source: […](…)` links | provider names the client report names **deliberately** — they must SURVIVE the scrub |
| `# Methodology` prose | the client report renders this section too — it must SURVIVE the scrub |

Matter was already client-anonymous at source (`client: Undisclosed pharmaceutical company`); the mark
and the senior owner are now demo twins on top of that. A newer run was rejected as a fixture source
despite being current-pipeline: it named a client and their unreleased product plans, and anonymity
you have to add is weaker than anonymity the artifact already had.

## `audit.evidence.md`

Excerpt of `audit.md` from a second real run of the same matter, identities substituted — two
contiguous blocks: the `# Findings` head plus its first five record blocks, and the `# Negative
Results` head plus its first six. The counts are load-bearing (`evidence.test.mjs` asserts six
negative results and reads them positionally), and so is the long/short asymmetry: the first two
finding blocks carry `dates`/`key_factors`/`verify`, the last three do not. Drives
`test/evidence.test.mjs`.

**The owner's name is spelled two different ways on purpose** — this file uses the ASCII letter where
`report.internal.md` uses the dotted Turkish capital, in the same position of the same name, and each
spelling is pinned by a different assertion. It is not a typo and it must not be normalised: a
single-token substitution that collapses the two breaks one of the tests.

Chosen because every shape the evidence projection must survive is real in it:

| Shape | Why it matters |
|---|---|
| `key_factors: … placement demotion … rating step … watchlist enforcer` | the firm's REASONING about a record — the projection must never read this field |
| `notes: … screen_verdict=drop:dead; …` | the register screener's internal verdict tokens, on a negative result |
| `result: screened out — dead-status` | an outcome that is neither a clean nor a conflict — collapsing it loses a real answer |
| `search_term: exact VENZY [cl 5]` | a term wrapped in bracketed scaffolding |
| `search_term: translit-numeric exact Вензи [cl 5]` | a real term in a cased non-Latin script, inside scaffolding |
| `search_term: v*z / v?nz? / VENZ contains` | wildcard query syntax |
| `## <Mark> / <MARK>` | one mark under two casings in a single slash-joined heading |

Client-anonymous on the same standard as `report.internal.md`: the run's `meta.json` carries
`client: "Undisclosed (a pharmaceutical company)"` and `customerKey: generic`, and the excerpt itself
says "applicant undisclosed" twice. The remaining records are public register or marketplace data
about third parties; the two that the scrub guard's closed set declares are named there with reasons.

> Not a shape in this file: `## **MARK** (primary form)`, a block title carrying markdown emphasis. All
> eleven `##` headings here are plain, and the emphasised form exists only as a comment in
> `lib/evidence.mjs`. The table above once carried a row for it — do not add one back.
