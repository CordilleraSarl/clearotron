# Similar-group reference data — CN · JP · KR · TW

`similar-groups.db` — SQLite, **6 MB**. Uses `node:sqlite` with FTS5, **zero dependencies**, matching
`providers/uspto-local/src/index-store.js`.

Rebuild from what ships here: `node load-public.mjs`. `build-db.mjs` is the OFFICE path — it reads source
documents this repository deliberately does not carry, so it throws on a clean checkout. `BUILDING.md`
carries both paths and the reason. The JSON files are build intermediates, not the product.

**`public/` is the published extract, not a source** — JSONL drawn from `similar-groups.db` with a
`MANIFEST.json` carrying each file's row count and SHA-256. Generated, so it has no README: this line is
its front door, and a stub inside a generated directory would be overwritten or go stale.

## Contents

| table | rows | what |
|---|---|---|
| `goods` | 10,123 | Nice basic number, class, English and Chinese names |
| `group_code` | 44,840 | (basic_no, office, code) — many-to-many, all four offices |
| `goods_fts` | 10,123 | FTS5 over names in English, Chinese, Japanese, Korean |
| `cross_reference` | **5,102** | China 1,959 · Korea 2,129 · Taiwan 1,014 |
| `cn_goods` | 11,330 | Chinese goods names, with the printed page each was read from |
| `class_span` | 2,478 | which Nice classes a Japanese group spans, on three bases |
| `coverage` | 540 | which classes were read, and which carry no note — the authority on what may be answered |
| `provenance` | 7 | one entry per source document: office, edition, retrieval date, hash |

Everything derives from TIPO's three bilateral concordance tables at NCL 13-2026. Provenance is
`provenance.json`, published as `public/provenance.jsonl`; Japan's own full standard (17,311 rows) comes
from `jp/`, one of the source directories this repository does not carry.

## Validation on import

`build-db.mjs` rejects rather than imports: `office` must be one of the four, `cross_reference.type`
must be one of `similar` / `cross_search` / `intra_group_exception`, `basic_no` must exist in `goods`.
The `―` no-code placeholder is skipped (368 occurrences), never stored as a code.

## What FTS5 does and does not do

It matches **wording**, not meaning. `sunglasses` finds `sunglasses` and `sunglasses for pets`.
It will **not** connect "premium organic hair cleanser" to `shampoos` — those share no token.

So the lookup is two steps, and only the first is now solved:

1. **Narrow** — FTS5 returns candidate official entries. Cheap, deterministic, no model.
2. **Pick** — a model chooses among those candidates.

Step 2 is still a model call, but it is now *choosing from a supplied list* rather than recalling a
code from memory. That is the change that matters: the 21%-accuracy failure was recall, and recall is
gone.

## The cross-class trap, which this data solves

Japan and Korea group codes span Nice classes by design; China and Taiwan codes never do.
JP `19B33` (pet goods) covers **14 classes** — pet nappies, cattle chains, dog whistles, pet jewellery.
All presumed similar in Japan.

**A Japanese or Korean similarity search must not be scoped by Nice class.** Query by `group_code`
instead and the full set comes back. `query-demo.mjs` demonstrates all three query shapes.

## Cross-references — Taiwan done

TIPO's per-class reference PDFs **carry a text layer** (unlike CNIPA's, which is a scan), so Taiwan's
備註 remarks extract programmatically. `tw/extract_tw_xref.py` reads all 45 class PDFs:

**485 remarks · 1,013 relations · 340 source groups · 1 flagged for review.**
**682 of those relations cross a Nice class** — exactly what a class-scoped search would miss.

Example: Taiwanese cosmetics (`0301`) must also search `4402` (hairdressing/beauty **services**,
class 44) and `351918` (cosmetics retail, class 35). A class-3 search finds neither.

### A validation trap worth recording

The loader first validated `to_group` against the codes in the concordance (609) and **rejected 14
real groups**. TIPO's own class files carry **635**; the concordance lists only goods that have a Nice
basic number. Validating against the narrower source would have silently dropped real relations —
the authority is now `tw/tw-group-codes.json`, taken from TIPO's own group headers.

## Still outstanding

**China** — the notes are the same shape as Taiwan's but the source PDF is a scan with no text layer.
278 pages rendered in `cn/pages/`; extraction brief at `~/docs/PROMPT-cnipa-cross-references.md`,
running externally.

## Korea — done, and round-2 research had the mechanism wrong

KIPO publishes 「유사상품 심사기준(니스 제13판)」 as a direct download: **21.8 MB, 1,011 pages, full text
layer** (`kpoContFileDown.do?seq=30&fileNum=25`, Referer header required).

The cross-reference mechanism is **not** a letter suffix. Round-2 research reported `G1301B`-style
suffixes marking 비고 유사 links; in the whole document there are 41 such codes and every one is written
`(구)G1201B` — 구 meaning *former*, i.e. a superseded code. Not a live mechanism.

The real mechanism is a labelled section under each group entry:

    [제6류/G1801] 금속제 냄비고리
      타류·타유사군에 속하는 상품(예시)          ← goods in other classes / other similar groups
      - 비전기식 요리용 냄비, 비전기식 압력솥 …(제21류/G1801)

`kr/extract_kr_xref.py` reads these: **601 entries · 2,129 relations · 252 groups · 661 cross-class**,
which is **96%** of the 2,210 references appearing inside those sections.

**Deliberately not captured:** 290 further `(제N류/Gxxxx)` references that sit *outside* a
타류 section — they appear in 특히 포함되지 않는 상품 (goods specifically NOT included) blocks and are
exclusions, not similarity links. Capturing them would invert their meaning, which is the same error
that produced the wedding-dress mistake.

## Japan — the notes beat the codes, and the codes under-report

The JPO Excel carries per-group notes of the form 審査基準 [ 1,2,4,19,30 類] 国際分類表 [ … ] naming the
classes a group spans. **447 notes across 164 groups**, now in `class_span`.

Compared against the spans I derived from where goods actually appear:

Two note columns exist and they are not interchangeable: **審査基準** governs examination,
**国際分類表** does not. Every figure below states which one it is measured against.

| 164 groups carrying a note | vs 審査基準 | vs 国際分類表 |
|---|---|---|
| derived span covers the note | 156 | 140 |
| exact match | 76 | 134 |
| pairs the note names and the goods data lacks | **24** (8 groups) | 52 (24 groups) |
| groups where the goods data has a class the note lacks | **84** | — |

**Neither side is a superset.** The notes carry 24 group-class pairs the goods data lacks; the goods
data carries classes in 84 groups the notes do not enumerate. Both were checked and both are real:

- The 24 note-only pairs are absent from the JPO Excel itself, in all 8 groups. `09A48`'s standard
  names 10 classes and JPO lists 3 goods for it, all in class 21. The standard states the group's
  reach; the goods list gives no example there.
- The 84 goods-only classes are mostly JPO's class-35 retail rows carrying the group code of the goods
  retailed — `01B01` (pharmaceuticals) on 薬剤及び医療補助品の卸売. That is the retail-services
  similarity link, correctly extracted.

**So any class-span query must union both bases.** Only 164 of 712 groups carry a note, so for the
rest the derived span is all there is.

**1,703 of 10,023 goods carry more than one JP group code.** Cells in the JPO sheet can hold two codes
separated by a space; an anchored single-code pattern dropped every one of them silently. 17% of the
goods, and the fault was mine, not the data's.

**Korea's letter-suffix mechanism does not exist.** External research reported that KIPO marks
remarks-similarity with a suffix on the base code (`G1301B`). In the whole 1,011-page 유사상품 심사기준
there are 41 such codes and every one reads `(구)G1201B` — 구 meaning *former*. They are superseded
codes, not cross-references. The real mechanism is a labelled 타류·타유사군 section per entry, and it is
extracted: 2,129 relations across 252 groups.

Current honest state per office:

| | group per good | cross-class via codes | remarks/notes links |
|---|---|---|---|
| Taiwan | yes | n/a (class-bound) | **1,014** |
| Japan | yes | yes — 43% of codes, plus 447 class-span notes | class spans done; group→group notes n/a |
| Korea | yes | yes — 39% of codes | **2,129** |
| China | yes | n/a (class-bound) | **pending** — external extraction running |

## China: loading and verification

`load-cn.mjs` reads `cn/cnipa-cross-references.jsonl` (one note per line — a malformed line costs one
note and is named by line number, never the file). Run `node load-cn.mjs --dry-run` first: it validates
without writing. Every row is checked against the 480 known CN group codes, the three relation types,
and the 278-page range; a failure is rejected and counted, never coerced. Full-width codes are
NFKC-folded, and a 6-digit sub-group reference is accepted through its 4-digit parent.

It was dry-run against a fixture carrying one planted fault of each kind before any real data existed.

**Verification.** The extraction is verified by the agent producing it. On top of that, six groups are
spot-checked here against the rendered page images in `cn/pages/` — read the page, compare the row:

```
0101  0711  1010  1913  2806  3706
```

Drawn by a fixed rule (every 80th code in the sorted list of 480) before the data existed, so they are
not chosen to be easy.

**What six spot checks can and cannot catch.** They catch systematic faults — a relation type read as
its opposite, exclusions recorded as links, edition qualifiers dropped, page numbers off by a fixed
offset. They do not measure omission rate: a note missed on a page nobody sampled stays missed. Whole-
document coverage rests on the extraction's own page-by-page count, not on this.
