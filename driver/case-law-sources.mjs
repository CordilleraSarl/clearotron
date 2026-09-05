// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// case-law-sources.mjs — telling the case-law seat which sources this deployment actually has.
//
// IT LIVES IN ITS OWN FILE, and not only for tidiness: stages.mjs is cited by line from a dozen places,
// so a block inserted into it stales every citation below the insertion point. Nine went blank on the
// first attempt at this change. A separable composer costs stages.mjs one import line.
//
// A delivered Full country search told the client its case-law sources "failed at the connection layer"
// and called it an infrastructure gap. The truth was that neither source had ever been enrolled on that
// box, which the portal's own product card states correctly one screen before ordering. Two surfaces of
// one product, two accounts of the same fact, and the report's was the flattering one.
//
// THE MODEL WAS NOT AT FAULT AND MUST NOT BE BLAMED BY THIS FIX. Its tool layer told it, verbatim:
// "these CONFIGURED MCP servers failed to connect" — because the bridges are declared to every case-law
// session regardless of enrolment and exit at start-up for want of a token. The model reported what it
// was told, including the word "configured". Nothing was invented. So the fix is ground truth, not
// wording: the stage is HANDED which sources this deployment has enrolled, and told to trust that list
// over the connection error, because the error cannot tell the two apart and this list can.
//
// A FIX THAT MAKES THE GAP QUIETER WOULD BE WORSE THAN THE DEFECT. The report never claimed there was no
// adverse case law; every surface disclosed the gap. That discipline is untouched here — this changes
// the REASON attached to an honest gap, never whether the gap is stated.
// ── AND A SOURCE NOBODY COULD CHECK IS NOT A SOURCE WE DO NOT HAVE (tracker issue 173) ──────────────
//
// The credential reader has four states — absent, usable, unusable, unreadable — and the caller used to
// flatten them into one boolean before this composer saw them. Three of those states then shared one
// sentence, so a credential that is PRESENT and merely unreadable (a permission or I/O error on the
// file) was described here as one that "was never enrolled here", inside a list this very file calls the
// ground truth. A deployment with a `chmod 000` on one file would tell a client it does not have US
// federal case law. Nobody knows that. We know only that we could not look.
//
// OWNER RULING, 2026-09-05, on the three wordings put to him: report it as a source whose availability
// COULD NOT BE CONFIRMED — never as one this deployment does not have, and never as an outage — and stop
// there. Deliberately it does not say whether to treat the coverage as available: that is a second
// question, it applies to every product rather than this one source, and settling it as a side effect of
// a wording fix is what the other two candidate wordings would have done.
//
// UNUSABLE KEEPS ITS ROUTING and that is not an oversight. A credential that is present and cannot work
// genuinely leaves this deployment without the source, so "does not have it" is the true answer. What
// was wrong for that state was only the clause "it was never enrolled here" — false about a credential
// somebody did enrol — so the sentence now says what is true of both: it is not enrolled and working.

/**
 * The inventory's rows, cut down to what the composer below reads — ONE AUTHOR, because there were two.
 *
 * `pipeline.mjs` built this shape inline and an arm rebuilt it by hand to drive the composer. Two copies
 * of one mapping, and the arm's copy could not fail when the real one changed: adding `checked` here for
 * tracker issue 173 left the arm still composing the old three-field row and still passing. A test that
 * restates the code it is checking agrees with itself.
 *
 * It is exported for that reason and not as a convenience: the arm and the pipeline must read the same
 * function, or the arm proves nothing about what the stage is actually handed.
 */
export function caseLawSourceRows(inventoryRows) {
  return (Array.isArray(inventoryRows) ? inventoryRows : [])
    .filter((r) => r?.key === "caselaw")
    .map((r) => ({
      label: r.providerLabel ?? r.provider,
      enrolment: r.enrolment ?? null,
      available: r.configured === true,
      // The could-not-look, carried rather than flattened. See the block above.
      checked: r.credential?.state !== "unreadable",
    }));
}

export function caseLawSourceLines(sources) {
  if (!Array.isArray(sources) || !sources.length) return [];
  const say = (r) => {
    if (r.enrolment === "built-in") return `${r.label} — part of this build, always available`;
    if (r.enrolment === "absent") return `${r.label} — NOT part of this build; it was never wired and cannot be searched`;
    // The could-not-look, before the two states that ARE answers. A reader who checks `available` first
    // and this second would re-introduce the defect, so the unknown is tested where it cannot be missed.
    if (r.checked === false) {
      return `${r.label} — COULD NOT BE CHECKED ON THIS DEPLOYMENT: its sign-in could not be read, so whether `
        + `this source is enrolled here is unknown. Report it as a source whose availability could not be `
        + `confirmed — never as one this deployment does not have, and never as an outage.`;
    }
    return r.available
      ? `${r.label} — enrolled on this deployment; if it fails at run time that IS an outage and you report it as one`
      // STATED POSITIVELY, ON PURPOSE. An earlier draft ended "It is not an outage." — a negation, which
      // is the one grammatical form a reader (or a matcher) can drop and invert. Say what to report.
      : `${r.label} — NOT SET UP ON THIS DEPLOYMENT: it is not enrolled and working here. Report it as a source this deployment does not have.`;
  };
  return [
    `THE CASE-LAW SOURCES THIS DEPLOYMENT HAS, which is the ground truth for anything you write about a source being unavailable:`,
    ...sources.map((r) => `  · ${say(r)}`),
    `YOUR TOOL LAYER CANNOT TELL THOSE APART AND THIS LIST CAN. An un-enrolled bridge is still declared to your session and still fails to connect, so you will see it reported as a CONFIGURED server that closed the connection. That wording describes the plumbing, not this deployment. Where the two disagree, the list above is right.`,
    `SO, WHEN YOU STATE A COVERAGE GAP FOR A SOURCE: a source marked NOT SET UP is reported as one this deployment does not have — never as unreachable, down, or an infrastructure or connection failure. A source marked enrolled that genuinely failed is reported as the outage it is, and say so plainly. State the gap either way: what changes here is the REASON, never whether you disclose it.`,
    `Name sources by the reader's name for them, never by an internal file, key or identifier.`,
  ];
}

