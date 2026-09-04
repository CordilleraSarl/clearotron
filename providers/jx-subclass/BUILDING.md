# Building the table

Two paths, and they answer different questions. Neither is a flag on the other.

## 1. From what ships here — no office document needed

```sh
node load-public.mjs     # public/ → the database, refusing on any hash mismatch
```

One command. It lays the schema itself — `build-db.mjs` is the OFFICE path and reads documents this
repo does not carry, so requiring it first made this path throw ENOENT on a clean checkout.

`public/` carries every column a lookup reads: group codes, relation types, edition qualifiers, the
goods each relation binds, coverage and provenance. It does not carry `note_text_zh`, the office's
sentence as printed — 626 KB across CN, KR and TW that no consumer reads. Acceptance 6 on asks
for a citation, not a quotation, and every row still carries one: CN by printed page and note number,
KR and TW by source document and source group, because those extractions were never paginated.

Proven, not assumed: rebuilt from `public/` alone, `coverage-demo.mjs`, `lookup-demo.mjs` and
`score-truth.mjs` produce byte-identical output to the full database.

## 2. Re-deriving it from the office

For verifying what shipped, or extending coverage. The scripts read source documents from a path you
give them, and every source is named, hashed, dated and URL'd in `provenance.json` — so a build either
reproduces the recorded hash or tells you which document drifted.

```sh
node build-db.mjs                                  # schema
node load-xref.mjs && node load-kr.mjs             # TW, KR cross-references
node load-jp-spans.mjs                             # JP class spans
node parse-layout.mjs --from 4 --to 252 \
     --layout <mineru layout.json> --out cn/tranche2/notes.jsonl
node load-cn.mjs --dry-run cn/tranche2/notes.jsonl # validate; then assemble and --replace
node update-coverage-cn.mjs && node load-coverage.mjs
node load-provenance.mjs && node load-fold.mjs
```

Then the evidence, which is the point of the directory:

```sh
node verify-relations.mjs      # relation typing vs the hand-checked answer key
node verify-overlap.mjs        # a machine read vs a human read, on pages both cover
node coverage-demo.mjs         # read-and-empty and never-read answer DIFFERENTLY
node score-truth.mjs           # the 63-item key from #1210
```

## What a build needs that this repo does not carry

| | |
|---|---|
| CN | 《类似商品和服务区分表》 12th ed (2023 text), 126,137,158 bytes, sha256 `4dcf74fc…`, plus an OCR pass over it — the current tables came from MinerU 3.4.4 |
| JP · KR · TW | the office files listed in `provenance.json`, by URL and hash |

Every script that needs one of these REFUSES BY NAME without it, naming the file and what it was for.
Nothing throws a stack trace and nothing half-builds: `build-db.mjs` checks its sources before it
deletes anything, so a missing document costs a message rather than your database.

Without them path 2 writes nothing and every lookup **refuses by name**. That is the design: an
index nobody built must never answer "no similar groups found".
