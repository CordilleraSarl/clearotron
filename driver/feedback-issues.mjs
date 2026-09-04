// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// feedback-issues.mjs — turn a captured flag into one GitHub issue.
//
// PURE. Data in, `{title, body, labels}` out. No network, no filesystem, no clock. The minting worker
// that actually calls GitHub is feedback-mint.mjs; keeping the shaping here means the thing most likely
// to be wrong — what a triager reads — is the thing that unit-tests offline.
//
// THE ONE RULE THIS MODULE ENFORCES: it carries the flag and decides nothing about it.
//
// is explicit that no auto-triage, auto-rating or auto-spec behaviour may exist, and the reason is
// not squeamishness — a flag that arrives pre-judged is a quality decision nobody delegated, made by the
// only participant with no opinion. So there is no severity, no priority, no area guessing, no
// summarising of the lawyer's words, and NO STATUS LABEL: a flag is input for human triage in a design
// session, not buildable work, and the dev agent must not be able to pick one up by accident.

/** Every flag gets these. `feedback:good` / `feedback:bad` is appended from the verdict. */
export const BASE_LABELS = ["source:report-feedback", "area:report"];

/**
 * The labels this feature needs to exist, with the description each should carry.
 *
 * `area:report` is the only `area:*` applied, and it is applied to every flag because it is the one area
 * statement that is mechanically true of all of them: a flag is raised on a delivered report. Choosing a
 * NARROWER area per flag would mean reading the lawyer's words and deciding what kind of defect they
 * describe, which is triage — the thing this issue forbids. A human adds the real area during triage.
 */
export const REQUIRED_LABELS = [
  { name: "source:report-feedback", color: "c5def5", description: "Raised by a reviewing lawyer on a delivered report (#260)." },
  { name: "feedback:good", color: "0e8a16", description: "A lawyer marked this finding RIGHT. Not a defect — a confirmation worth keeping." },
  { name: "feedback:bad", color: "b60205", description: "A lawyer marked this finding WRONG. Input for triage, not yet buildable work." },
  { name: "area:report", color: "d4c5f9", description: "The delivered report and what it says." },
];

const clip = (s, n) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
};

/** A fenced block that cannot be broken by its own content. */
function fence(text) {
  const body = String(text ?? "");
  let ticks = "```";
  while (body.includes(ticks)) ticks += "`";
  return `${ticks}\n${body}\n${ticks}`;
}

/**
 * One flag → one issue.
 *
 * The title names the verdict, the mark and the finding, so a list of these is scannable without opening
 * any of them. The body is ordered for a triager: what the lawyer said first, what they were looking at
 * second, and the machine handles last — a person reading this in a design session should be able to stop
 * after the first section.
 */
export function issueForFlag(flag) {
  const v = flag?.verdict === "good" ? "good" : "bad";
  const loc = flag?.locator ?? {};
  const run = flag?.run ?? {};
  const mark = loc.mark || run.markName || "unknown mark";
  const where = loc.ordinal != null ? `finding ${loc.ordinal}` : "the report";

  const title = clip(
    `[${v === "good" ? "right" : "wrong"}] ${mark} · ${where} — ${flag?.why ?? ""}`,
    120,
  );

  // POINTER PLUS EXCERPT, ruled by the owner: triage should not require opening the VM to read one
  // sentence. The excerpt is the run's own text, read server-side at capture — never anything the
  // browser sent.
  const excerpt = flag?.excerpt
    ? `**The finding said:**\n\n> ${String(flag.excerpt).replace(/\n/g, "\n> ")}\n`
    : "_The run carried no excerpt for this finding — it predates report-data.json, or the ordinal no longer resolves._\n";

  const body = [
    `## What the lawyer said`,
    ``,
    fence(flag?.why ?? ""),
    ``,
    `— ${flag?.capturedBy ?? "unknown"}, ${flag?.capturedAt ?? "unknown"} · marked **${v === "good" ? "right" : "wrong"}**`,
    ``,
    `## Where in the report`,
    ``,
    excerpt,
    // THE LOCATOR IS COMPOSITE ON PURPOSE. `ordinal` is renumbered contiguously on every publish
    // (findings-model.mjs), so on its own it silently re-points at a different finding after a
    // republish. A triager who finds ordinal 3 now showing a different mark and band knows what
    // happened, which a bare id would have hidden.
    `| | |`,
    `|---|---|`,
    `| Finding | ${loc.ordinal ?? "—"} |`,
    `| Mark | ${loc.mark ?? "—"} |`,
    `| Band | ${loc.band ?? "—"} |`,
    `| Disposition | ${loc.disposition ?? "—"} |`,
    ...(loc.section ? [`| Section | ${loc.section} |`] : []),
    ``,
    `> The finding number is renumbered on every republish. If the four rows above no longer agree with`,
    `> what the report shows at that number, the run was republished and the finding moved.`,
    ``,
    `## Debug handles`,
    ``,
    `| | |`,
    `|---|---|`,
    `| Run | \`${run.runId ?? flag?.runId ?? "—"}\` |`,
    `| Brand owner | ${run.account ?? "—"} |`,
    `| Matter | ${run.matter ?? "—"} |`,
    `| Search | ${run.searchLevel ?? "—"} |`,
    `| Issued | ${run.issuedAt ?? "—"} |`,
    `| Engine build | ${run.engineCommit ? `\`${run.engineCommit}\`` : "— (published before the build stamp)"} |`,
    `| Run directory | \`${run.runDir ?? "—"}\` |`,
    // — the path a human retypes to find the row, and it has to be the path this run actually has.
    // The knockout lane nests findings under the mark and restarts ordinals at 1 per mark, so the flat
    // `findings[]` instruction sent a reader to a key that is not in the file and, on a batch, to an
    // ordinal that matches several rows. `ref` is the key both the report page and the workbook print.
    loc.ref
      ? `| Finding row | \`${loc.ref}\` — \`report-data.json\` → \`marks[].findings[]\` |`
      : `| Finding row | \`report-data.json\` → \`findings[]\` where \`ordinal == ${loc.ordinal ?? "?"}\` |`,
    `| Flag record | \`${flag?.id ?? "—"}.json\` in the feedback store |`,
    ``,
    `---`,
    `_Minted from a report flag (#260/#264). Nothing here is triaged: no status label, no rating, and no_`,
    `_reading of what the lawyer meant. A human decides what this becomes._`,
  ].join("\n");

  return { title, body, labels: [...BASE_LABELS, `feedback:${v}`] };
}
