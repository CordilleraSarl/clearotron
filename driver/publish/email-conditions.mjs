// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// email-conditions.mjs — the conditions the cover email carries in its "Only you can close these" box.
//
// The email composes its box from this list, and the delivery check reads the same list as the email's own action
// lines, so the two cannot differ. It lives beside the renderer rather than in it: render.mjs is frozen
// (render-frozen.test.mjs), and this reads it without changing it.
//
// The delivery check is HANDED the list, by the run and by the replay, rather than importing this: the check runs inside
// the tool servers too, and the renderer would bring the brand settings into every server's environment.
import { parseActionBuckets, actYouConditions } from './render.mjs';
import { parseFront, parseSections } from './parse.mjs';

/** The report's only-you items, on a conditional or blocking result only. PURE. */
export function emailConditionsOf(actionsSection, verdict) {
  return verdict === 'CONDITIONAL' || verdict === 'BLOCKING' ? actYouConditions(parseActionBuckets(actionsSection).you) : [];
}

/** The same list, from the report's markdown, as the email reads its `# Actions` section. PURE. */
export const emailConditionsOfReport = (reportMd, verdict) => emailConditionsOf(parseSections(parseFront(String(reportMd ?? '')).body).Actions, verdict);
