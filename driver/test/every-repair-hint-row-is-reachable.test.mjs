// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// every-repair-hint-row-is-reachable.test.mjs — each row of the repair-hint table answers a failure that no
// row above it already answers.
//
// The table is read in order and the first matching row answers. A row placed below a broader pattern never
// fires, and nothing else notices: the corrective turn is handed the broader row's sentence and the run goes on.
// So every row carries one example failure here, and the example must select its own row. A new row needs an
// example before this passes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { failureCode, REPAIR_HINT_CODES, correctionHint } from "../gateway.mjs";

const EXAMPLES = {
  findings_contract: "invalid_file:findings.json:finding_band_off_table",
  coverage_status_offenum: "invalid_file:register-findings.md:coverage_status_offenum",
  coverage_ledger_shape: "invalid_file:register-coverage-ledger.json:coverage_key_unknown",
  use_check_missing: "invalid_file:findings.json:use_check_missing",
  connotation_form_damaged: "invalid_file:x.json:connotation_form_damaged",
  connotation_quote_unbound: "invalid_file:x.json:connotation_quote_unbound",
  connotation_call_never_made: "invalid_file:x.json:connotation_call_never_made",
  connotation_call_truncated: "invalid_file:x.json:connotation_call_truncated",
  connotation_call_schema_violation: "invalid_file:x.json:connotation_call_schema_violation",
  connotation_call_partial: "invalid_file:x.json:connotation_call_partial",
  meaning_angles_missing: "invalid_file:matter-frame.json:meaning_angles_missing",
  own_rights_missing: "invalid_file:findings.json:own_rights_missing",
  blindframe: "invalid_file:blind-frame.json:blindframe_unparseable",
  framediff_directive_undispatchable: "invalid_file:frame-diff.json:framediff_directive_undispatchable",
  framediff: "invalid_file:frame-diff.json:framediff_unparseable",
  receipts_short: "invalid_file:x.json:receipts_short",
  grid_ledger_unparseable: "invalid_file:common-law-grid.json:grid_ledger_unparseable",
  grid_join_missing: "invalid_file:common-law-grid.json:grid_join_missing",
  platforms_missing: "invalid_file:common-law-grid.json:platforms_missing",
  connotation_query_unrecorded: "invalid_file:x.json:connotation_query_unrecorded",
  connotation_search_missing: "invalid_file:x.json:connotation_search_missing",
  named_band_collapsed: "invalid_file:x.json:named_band_collapsed",
  intake_ask_unanswered: "invalid_file:x.json:intake_ask_unanswered",
  tool_timeout: "tool_timeout:register_execute_plan:incumbent-class",
  named_band_missing: "invalid_file:x.json:named_band_missing",
  named_band_shape: "invalid_file:x.json:named_band_state_invalid",
  plan_audit_missing: "invalid_file:x.json:plan_audit_missing",
  coverage_no_status: "invalid_file:x.json:coverage_no_status",
  coverage_form_axis_invalid: "invalid_file:x.json:coverage_form_axis_invalid",
  coverage_form_damaged: "invalid_file:x.json:coverage_form_damaged",
  coverage_form_missing: "invalid_file:x.json:coverage_form_empty",
  coverage_deferred_unaccounted: "invalid_file:x.json:coverage_deferred_unaccounted",
  coverage_clean_unverified_incomplete: "invalid_file:x.json:coverage_clean_unverified_incomplete",
  coverage_clean_unexecuted: "invalid_file:x.json:coverage_clean_unexecuted",
  band_block_unplanned: "invalid_file:x.json:band_block_unplanned",
  coverage_clean_tainted: "invalid_file:x.json:coverage_clean_tainted",
  declared_unavailable: "invalid_file:x.json:declared_unavailable",
  coverage_status_row: "invalid_file:register-findings.md:findings+ledger",
  prose_sections: "invalid_file:common-law.md:audit-trail",
};

test("every row has an example, in the table's order, and no two rows share a code", () => {
  assert.deepEqual(Object.keys(EXAMPLES), [...REPAIR_HINT_CODES],
    "the examples and the table's rows differ: a row was added, removed or moved without its example");
  assert.equal(new Set(REPAIR_HINT_CODES).size, REPAIR_HINT_CODES.length, "two rows share a code");
});

test("every example selects its own row, so no row sits under a broader one", () => {
  for (const [code, fail] of Object.entries(EXAMPLES))
    assert.equal(failureCode(fail), code, `${JSON.stringify(fail)} selects ${failureCode(fail)}, so the ${code} row never answers it`);
});

test("a failure no row recognises has no code and gets the default end state", () => {
  assert.equal(failureCode("invalid_file:x.json:something_no_row_names"), null);
  assert.equal(correctionHint("invalid_file:x.json:something_no_row_names"),
    "the required output file is actually written and contains every required section IN FULL");
});
