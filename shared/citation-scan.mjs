// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// citation-scan.mjs — does a shipped file point a reader at a path that will not be there.
//
// EXTRACTED, NOT COPIED, and the difference is the whole reason this file exists. This scanner lived
// inside driver/test/publication-scrub.test.mjs and carries four measurements in its comments below —
// the basename widening, the FILES-ONLY bound that cut 134 hits of noise to 6 real ones, the
// hyphenated-segment bound that cut 8 to 3, and why each stops where it does. A second caller copying
// it would have reverted every one of them the first time somebody fixed one side.
//
// PARAMETERISED OVER ITS POPULATION, because the second caller asks the same question about a different
// set: publication-scrub asks "does a shipped file cite a WITHHELD path", and the export asks "does a
// file in the exported tree cite a path the export DID NOT CARRY". Same scanner, same measured bounds,
// two populations.
//
//   paths       the paths a citation of which is a hit — `{ path }` entries, a trailing `/` meaning a directory
//   excluded    files that are not scanned at all, because they are not in the shipped set
//   declaredFor (file, path) => truthy when this citation is declared with a reason
//   sources     the files that DEFINE the rule, and so necessarily quote what it forbids

/** A withheld directory's own final segment, as a bounded pattern — or null where it is a bare word. */
export function dirSegment(path) {
  const p = path.slice(0, -1);
  const seg = p.slice(p.lastIndexOf("/") + 1);
  if (!seg.includes("-")) return null;
  const esc = seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![A-Za-z0-9-])${esc}(?![A-Za-z0-9-])`);
}

export function scanCitations(files, readFn, { paths, excluded, declaredFor, sources }) {
  const hits = [];
  for (const f of files) {
    if (excluded(f) || sources.has(f)) continue;
    const t = readFn(f);
    if (!t) continue;
    t.split("\n").forEach((line, i) => {
      for (const { path } of paths) {
        // A CITATION IS NOT ALWAYS SPELLED AS THE FULL PATH. docs/README.md is the doc map and links
        // its neighbours the way markdown does — `[JX.md](JX.md)` — so an includes() on the repo-root
        // path walks straight past four rows pointing at documents the cut removes. The reader gets a
        // 404 on the one page whose job is to say what exists. So a withheld FILE is also matched by
        // its basename, and a line naming the basename without the full path is the relative form.
        //
        // FILES ONLY, and that bound is the whole reason this is safe. A directory entry's members
        // have basenames like `README.md` and `Trademark Portal.dc.html`, whose leading word appears
        // in every brand string in the repo: matching those fired 134 times, almost all of it noise.
        // Measured at the bound written here: 6 hits, all real. Widen it further only with the same
        // measurement in hand.
        const base = path.endsWith("/") ? null : path.slice(path.lastIndexOf("/") + 1);
        // AND A DIRECTORY IS CITED BY ITS OWN NAME TOO (, measured 2026-08-24). Three shipping
        // files named `fixtures/owner-screen-2026-07-29` — a path relative to the file, not to the repo
        // root — so `includes(path)` walked straight past every one of them and the reader got a
        // directory that is not there. The FILES-ONLY bound above was measured against basenames like
        // `README.md`; a directory's own final segment is a different population.
        //
        // BOUNDED TO A HYPHENATED SEGMENT, and that is not cosmetic: `providers/clarivate/test/` and
        // `docs/design/` end in `test` and `design`, words this repository says several thousand times.
        // Measured at this bound: one segment qualifies today (`owner-screen-2026-07-29`) and it finds
        // 3 real citations. Without the trailing boundary it found 8, five of them the REDACTED sibling
        // directory whose name has the withheld one as a prefix — a substring read as a citation.
        const seg = path.endsWith("/") ? dirSegment(path) : null;
        const cited = line.includes(path) || (base && line.includes(base)) || (seg && seg.test(line));
        if (!cited) continue;
        if (declaredFor(f, path)) continue;
        hits.push(`${f}:${i + 1}: cites ${path}`);
      }
    });
  }
  return hits;
}
