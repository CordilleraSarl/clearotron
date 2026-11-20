// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// email-conditions.mjs — the conditions the cover email carries in its "Only you can close these" box.
//
// The email composes its box from this list, and the delivery check reads the same list as the email's own action
// lines, so the two cannot differ. It lives beside the renderer rather than in it: render.mjs was hash-frozen
// when this was written (render-frozen.test.mjs), and this reads it without changing it.
//
// The delivery check is HANDED the list, by the run and by the replay, rather than importing this: the check runs inside
// the tool servers too, and the renderer would bring the brand settings into every server's environment.
import { parseActionBuckets, actYouConditions } from './render.mjs';
import { parseFront, parseSections } from './parse.mjs';
import { EMAIL } from './strings.mjs';

/**
 * The items the report lists under its own "Before you can rely on this result" heading, in order. That group alone: a
 * question for the client or a watch item is not a condition of reliance. Empty where the report names none. PURE.
 */
export function relyBeforeOf(actionsSection) {
  const you = parseActionBuckets(actionsSection).you;
  if (!you?.body) return [];
  const groups = String(you.body).split(/^(?=\s*\*\*.+\*\*\s*$)/m);
  const group = groups.find((g) => g.trim().replace(/\n[\s\S]*$/, '').replace(/\*\*/g, '').trim() === EMAIL.beforeYouCanRely);
  return group ? actYouConditions({ body: group }) : [];
}

/**
 * The report's only-you items, on a conditional or blocking result only. Where the assessment did not complete there is
 * no result to condition, and the items are the report's own conditions of reliance (relyBeforeOf). PURE.
 */
export function emailConditionsOf(actionsSection, verdict, { assessmentNotCompleted = false } = {}) {
  if (assessmentNotCompleted) return relyBeforeOf(actionsSection);
  return verdict === 'CONDITIONAL' || verdict === 'BLOCKING' ? actYouConditions(parseActionBuckets(actionsSection).you) : [];
}

/** The same list, from the report's markdown, as the email reads its `# Actions` section. PURE. */
export const emailConditionsOfReport = (reportMd, verdict, opts = {}) => emailConditionsOf(parseSections(parseFront(String(reportMd ?? '')).body).Actions, verdict, opts);
