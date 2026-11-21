// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// run-scope.mjs — the scope a clearance searches: the classes in scope, and the territories of its register plan.
//
// Moved out of pipeline.mjs unchanged, so that the steps and the modules beside them read the scope directly.
import { resolveTerritories } from "./effective-scope.mjs";

export function inScopeClassList(job, profile) {   // @internal — also read by scripts/register-plan-shape.mjs, which must resolve scope exactly as the run did
  const fromMarks = Array.isArray(job?.marks) ? job.marks.flatMap((m) => (Array.isArray(m?.classes) ? m.classes : [])) : [];
  const declared = [...(Array.isArray(job?.classes) ? job.classes : []), ...fromMarks];
  return [...new Set((declared.length ? declared : (profile?.defaultClasses ?? [])).map(String))];
}
// The matter's territorial scope for the REGISTER PLAN — THE SHARED LADDER (effective-scope.mjs
// resolveTerritories), the same one the doors, the freeze and stages.mjs scopeTerritories read.
// Deduped, blank-stripped. Exported for test.
//
// IT USED TO BE A HAND COPY of "instructed, else the account's defaults", and that copy had never heard
// of the geography stamp. So a `mode: "worldwide"` clearance — admitted as worldwide at every door,
// priced as worldwide, printed as a Global preliminary search — arrived here and NARROWED to the
// account's default territories: the register plan swept seven countries for a search sold as
// everywhere, and nothing anywhere disagreed. An empty list is the worldwide answer downstream
// (register-plan.mjs treats emptiness as unrestricted), so the fix is the ladder, not a special case.
export function registerJurisdictions(job, profile) {   // @internal
  const list = resolveTerritories(job, profile).jurisdictions;
  return [...new Set((Array.isArray(list) ? list : []).map((x) => String(x ?? "").trim()).filter(Boolean))];
}
