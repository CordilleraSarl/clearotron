// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// lib/scrub.mjs — the CLIENT-VIEW transform for artifact text handed to a client principal ( R1).
//
// THE RULE, stated once: what a client reaches over MCP is what THE report already shows them — one
// report (spec 2026-07-30 §5): report.html as served to a client through the portal's readReport
// preparation — no more, no less. Not "no vendor names", not "no methodology". Both ARE client content:
//
// ⚠️ ONE BOUNDED EXCEPTION (2026-07-22, the evidence layer). "No more than the report" governs ARTIFACT
// TEXT, which is all this file transforms, and that is unchanged. It is no longer the whole story for the
// connector: a signed-in client ACCOUNT can also reach the run's EVIDENCE — the records considered and the
// searches run — which the report narrates but does not enumerate. That is deliberately more than the PDF,
// because a lawyer defending a filing decision needs the records, and it is bounded by a different
// mechanism (a structured-field projection, never prose) in lib/evidence.mjs. Read that file's header
// before widening anything here; the line it draws is evidence vs METHOD, and method stays sealed.
// publish/render.mjs renders the Methodology section to the client (scopeSection → plainScopeNote) and
// deliberately names the register provider (provenance honesty, receipts, enforcement telemetry). A scrubber
// stricter than the report would delete content the client was already sent, and would quietly make the MCP
// a different product from the PDF in their inbox.
//
// WHY THIS FILE EXISTS: read_artifact returned raw report.md. report.md is the INTERNAL cut — it carries
// `- [internal]` reasoning bullets, the internal band code (overall_badge: l4) and the framework profile
// hash (rated_under: … · profile d37721cda899). The rendered report carries the raw rated_under in its
// footer and portal-report.mjs strips that line at serve time — this surface must land in the same place.
// brief scrubbed its own output; read_artifact did not. That asymmetry was the leak.
//
// HOW IT IS BUILT: by COMPOSING the driver's own client-safety transforms (parse.mjs, via lib/driver.mjs) —
// never by restating their rules here. A second copy of "what is client-safe" is exactly the drift that
// caused R1. Add a rule in parse.mjs and both the report and this surface get it.
//
// The body transforms are applied FLAT over the whole document, where render.mjs applies them per-section
// (telemetry to the scope note, engine-internals to card prose). Flat is the safe direction: it can only
// over-strip (lose a little client prose), never under-strip (leak). The parity test pins that the client-
// meaningful content — Methodology prose, provider names, the framework title — actually survives.

import {
  parseFront, stripInternal, dropLabelledInternals, stripEngineInternals, stripTelemetry,
  resolutionForClient, contradictionResolutionForClient,
} from "./driver.mjs";

// Front-matter keys a client principal may see. ALLOWLIST, not a blocklist: a new internal key added to
// report.md upstream is withheld by default rather than leaking until someone notices (fail-closed).
//   Kept       — every field the client report itself prints: identity, the matter, the risk word + caption.
//   rated_under— TRANSFORMED, not dropped: the client footer shows the framework TITLE, so the leading title
//                segment survives and the "· profile <hash>" tail (internal config identity) is cut.
//   Dropped    — overall_badge (the internal Level/Composite shorthand the report footer says is "removed on
//                export"), origins_json ( configuration provenance, render.mjs gates it !CLIENT), and
//                anything not named here.
export const CLIENT_FRONT_MATTER = new Set([
  "type", "matter", "title", "client", "use", "classes", "run",
  "overall_label", "overall_caption", "run_under_project", "rated_under",
]);

// `Generic default (generic) · Generic default framework · profile d37721cda899` → drop the profile segment.
// The framework title is client-facing (report footer: "Rated under <title>"); the profile hash is the
// internal identity of the config that rated the matter and is not. A custom framework carries its source
// FILENAME too (`custom framework: Aurora Interactive ACP risk framework (risk-framework-aurora.md)`) — the
// human title stays, the file is config identity and goes.
function ratedUnderForClient(v) {
  return String(v ?? "").split("·").map((s) => s.trim())
    .filter((s) => s && !/^profile\s+[0-9a-f]{6,}$/i.test(s))
    .map((s) => s.replace(/\s*\([^()]*\.(?:md|json|ya?ml)\)/gi, "").trim())
    .join(" · ");
}

/** Scrub a parsed front-matter object to the client view. */
export function scrubFrontMatter(fm) {
  const out = {};
  for (const [k, v] of Object.entries(fm ?? {})) {
    if (!CLIENT_FRONT_MATTER.has(k)) continue;
    out[k] = k === "rated_under" ? ratedUnderForClient(v) : v;
  }
  if (out.rated_under === "") delete out.rated_under;
  return out;
}

/** Scrub markdown BODY prose (no front matter) to the client view. */
export function scrubBody(md) {
  // Order matters: kill internal lines FIRST (whole bullets disappear), then the sentence-level filters.
  // BOTH internal forms are handled on purpose — `::p::` for text taken straight from the model, and the
  // `[internal]` label for text read off the published report.md, which is the form the MCP actually reads
  // (publish already consumed the marker). Dropping only the marker form is how R1 stayed open.
  const noInternal = dropLabelledInternals(stripInternal(String(md ?? ""), { client: true }));
  return stripTelemetry(stripEngineInternals(noInternal));
}

const emitFront = (fm) => Object.entries(fm).map(([k, v]) => `${k}: ${v}`).join("\n");

/**
 * Scrub a whole artifact document (front matter + body) to the client view.
 * Documents with no front matter (client-summary.md) are body-scrubbed alone.
 */
export function scrubMarkdown(text) {
  const { fm, body } = parseFront(String(text ?? ""));
  const scrubbedBody = scrubBody(body);
  if (!Object.keys(fm).length) return scrubbedBody;
  const front = emitFront(scrubFrontMatter(fm));
  return `---\n${front}\n---\n${scrubbedBody}`;
}

// Curated report cards: `tier` and `label` are the internal Level A–E / Composite 1–5 shorthand the report
// footer states is "removed on export". `group` is NOT stripped — on-field / off-field / out-of-scope are
// the client report's own section headings (render.mjs "02 On-field conflicts"), i.e. client vocabulary.
//
// `disposition` IS stripped ( D5), and it belongs to the same ruling as the report's own risk chip.
// It is a PLACEMENT key, not a rating: stages.mjs dictates it as the posture that sets only where a card
// is placed and never the band. The client report says the same thing in its own words — the section
// heading it produces, which is exactly what `group` carries — so disposition on this surface is the
// engine's spelling of a fact the client already has, and its members ("adversarial") read as claims
// about the owner rather than about the placement. Before this it was in NEITHER list, so it left over
// `list_findings` unruled: buildAuditMd stamps `- disposition: withdrawn` on any audit block that joins
// a withdrawn finding (predelivery-lint.mjs relies on that stamp), parseBlocks turns the line into a key,
// and server.mjs pipes those items straight through here.
//
// — AND STRIPPING THE KEY WAS NOT ENOUGH, because the same builder re-encodes the same word into
// two keys an allowlist keyed on NAMES cannot see:
//
//   - resolution: adversarial / MEDIUM — see finding #3
//   - contradiction_resolution: findings.json (finding #3, adversarial) supports "…"
//
// Both are TRANSFORMED, not dropped — the same treatment `rated_under` gets above, and for the same
// reason: each carries a client-meaningful cross-reference (which finding this block resolved to; which
// fragment of a contradicted pair the record supports), so deleting the key would delete the pointer
// along with the word. The transforms themselves live in the driver (publish/parse.mjs
// resolutionForClient / contradictionResolutionForClient) beside stripTelemetry and stripEngineInternals,
// because this file COMPOSES the driver's client-safety rules and never restates them — and because the
// defect was precisely that a reader of this allowlist could not see a builder three files away
// composing a stripped field into a surviving one.
// — AND `withdrawn_reason` IS A THIRD CLASS, which is why it needed its own ruling rather than a
// quiet addition to the line below.
//
// Everything stripped or transformed above is the ENGINE'S SPELLING OF A FACT THE CLIENT ALREADY HAS.
// `disposition` says what the section heading says; `tier`/`label` are shorthand for the risk chip;
// `resolution` keeps its pointer and loses its vocabulary. In every case the client could have read the
// same thing off the report.
//
// `withdrawn_reason` is not that. It is THE REVIEWER'S JUDGMENT ABOUT THE ENGINE'S OWN OUTPUT —
// "confabulated attribution", "confabulated product page; owner-site search found no such product" — and
// the client has no counterpart for it, because the client is never shown the finding at all. A
// withdrawn finding renders nowhere, and `publish/report-data.mjs` states that ruling on its own
// surface: "only LIVE findings (a withdrawn finding renders nowhere — it does not exist here either)",
// "no withdrawn_reason".
//
// So the two client surfaces disagreed about one field: the data file refused to carry it and the MCP
// handed it over. THE RULING, written where the next person adding a key will read it: internal
// judgment about the engine's own quality never reaches a client principal, and there is nothing to
// transform — a pointer is worth keeping, an assessment of our own confabulation is not.
//
// STRIPPED, NOT TRANSFORMED, for that reason. There is no client-meaningful residue.
//
// — AND THEN THE BLOCK ITSELF, which is what raised and this settles.
//
// Stripping the two keys left something worse behind. `buildAuditMd` stamps `- disposition: withdrawn`
// on any audit block joining a withdrawn finding, `disposition` goes above ( D5) and
// `withdrawn_reason` goes with it — so a client was served a block about a finding that renders
// NOWHERE in their report, with both markers of the withdrawal removed. Every signal that it should not
// be there was exactly the set we deleted on the way out, and what arrived read as live. A leaked reason
// at least announced itself as internal.
//
// The ruling needed no new product decision, because the product had already made it:
// `publish/report-data.mjs:64` filters to live findings, "a withdrawn finding renders nowhere — it does
// not exist here either". Two client surfaces, one question, two answers. So the block is DROPPED, and
// the two agree by construction rather than key by key — which is the thing asked not to repeat.
//
// THE JOIN IS ALREADY DONE, by the only code that can do it. `buildAuditMd` holds the findings set and
// stamps the block; this reads that stamp. A second join here — re-matching blocks to findings by title
// and owner — would be a second implementation of `withdrawnMatchFor` on a surface with worse inputs,
// which is the defect class is about.
//
// THE ONE PLACE THAT STAMP CAN BE ABSENT is `lib/findings.mjs`'s rebuilt-from-spine backstop, which used
// to call `buildAuditMd` with no findings set — and audit-from-spine.mjs says exactly what that means:
// "Absent a findings set (replay/legacy callers), this is a no-op." That path now passes the run's
// findings.json, so the stamp is there to read. Without that, this filter would be correct and would
// quietly have nothing to act on.
//
// WHAT DOES NOT CHANGE, and both halves matter to a reviewer weighing a DROP:
//
//   · The audit markdown keeps the block and the stamp. predelivery-lint.mjs reads
//     `- disposition: withdrawn` to catch a withdrawn finding resurrected in the report.
//   · STAFF AND OPS PRINCIPALS NEVER REACH THIS FUNCTION. server.mjs's `presentForPrincipal` returns
//     early for anything outside CLIENT_KINDS — "staff/ops principals are untouched — they read the
//     internal cut, byte-identical to before". So nothing here removes a record from the people whose
//     job is to audit it; it removes it from the one audience the report never showed it to.
export function scrubCards(items) {
  if (!Array.isArray(items)) return items;
  return items
    .filter((c) => String(c?.disposition ?? "").trim().toLowerCase() !== "withdrawn")
    .map(({ tier, label, disposition, withdrawn_reason, ...rest }) => {
      // Only rewrite a key the block actually carries: an absent key must stay absent, never become null.
      if ("resolution" in rest) rest.resolution = resolutionForClient(rest.resolution);
      if ("contradiction_resolution" in rest) rest.contradiction_resolution = contradictionResolutionForClient(rest.contradiction_resolution);
      return rest;
    });
}
