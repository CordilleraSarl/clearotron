// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The EUIPO query builder. OFFLINE — every test here is over pure functions; nothing calls the
// API. Each pinned behaviour quotes the API's own response beside it, so a reader can tell a pinned
// FACT from a pinned ASSUMPTION.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildRsql, hasAnyElement, MISSING_ELEMENT_ERROR, PAGE_SIZE_MIN, PAGE_SIZE_MAX,
  renderTerm, resolvePredicate, resolveConfig, LIVE_STATUS_FILTER, isSearchResponseBody,
  CAPABILITIES,
} from "../src/core.js";
import { CAPABILITY_GAP_MARKER } from "../../_shared/execute-plan.mjs";
import {
  EUIPO_STATUS_AMBIGUOUS, EUIPO_STATUS_DEAD, EUIPO_STATUS_LIVE, EUIPO_STATUS_QUERYABLE,
  classifyEuipoStatus, makeRef, publicRecordUrl, refToId, rowScreen, toBandRow, toNeutralRecord,
} from "../src/row.js";
import { STATUSES } from "../src/euipo-client.js";

const V = "wordMarkSpecification.verbalElement";
const gap = (fn) => {
  try { fn(); } catch (e) { return e.message; }
  return null;
};

// ── THE PRECEDENCE TRAP ───────────────────────────────────────────────────────────────────────────
// PROBED: `A or B and niceClasses=in=(9,42)` → 109 hits. `(A or B) and niceClasses=in=(9,42)` → 47.
// `and` binds tighter, so an unparenthesised OR-stack is a DIFFERENT, WIDER query that answers HTTP
// 200 with plausible rows. Nothing downstream can detect it. These three tests are the only thing
// standing between that and a shipped band.

test("an OR group is parenthesised", () => {
  assert.equal(buildRsql({ names: ["ALPHA", "BETA"], match_mode: "exact" }),
    `(${V}=="ALPHA" or ${V}=="BETA")`);
});

test("a WIDTH-1 OR group is parenthesised too", () => {
  // Not decoration. An `if (n === 1) return bare` shortcut is correct in isolation and stops being
  // correct the moment its output is concatenated with an AND clause.
  assert.equal(buildRsql({ names: ["ALPHA"], match_mode: "exact" }), `(${V}=="ALPHA")`);
});

test("the OR group keeps its parentheses when an AND clause follows — the whole trap", () => {
  const rsql = buildRsql({ names: ["ALPHA", "BETA"], match_mode: "exact", nice_classes: [9, 42] });
  assert.equal(rsql, `(${V}=="ALPHA" or ${V}=="BETA") and niceClasses=in=(9,42)`);
  // Belt and braces: the OR must not be able to escape the parens under ANY clause ordering.
  assert.ok(!/[^(]\bor\b/.test(rsql.replace(/\([^)]*\)/g, "")), "an `or` survived outside a parenthesised group");
});

test("every multi-value clause is its own parenthesised group", () => {
  const rsql = buildRsql({ names: ["A", "B"], owners: ["X", "Y"], match_mode: "exact" });
  assert.equal(rsql, `(${V}=="A" or ${V}=="B") and (applicants.name=="*X*" or applicants.name=="*Y*")`);
});

// ── PREDICATE MAPPING ─────────────────────────────────────────────────────────────────────────────

test("each match_mode maps to the declared predicate", () => {
  assert.equal(resolvePredicate({ match_mode: "exact" }), "exact");
  assert.equal(resolvePredicate({ match_mode: "starts_with" }), "wildcardPrefix");
  assert.equal(resolvePredicate({ match_mode: "ends_with" }), "wildcardSuffix");
  assert.equal(resolvePredicate({ match_mode: "contains" }), "wildcardInfix");
  assert.equal(resolvePredicate({}), "wildcardInfix");          // the plan's default
});

test("PHONETIC IS REFUSED, and the refusal carries the capability-gap marker", () => {
  // PROBED ABSENT: `=phonetic=`, `=fuzzy=` and RSQL's `~=` all 400 at a valid size. Mapping phonetic
  // to a contains would run a DIFFERENT SEARCH under the right name and return state:"enumerated"
  // over it — doctrine rule 2's exact failure, and invisible in every artifact.
  const msg = gap(() => resolvePredicate({ match_mode: "phonetic" }));
  assert.ok(msg?.includes(CAPABILITY_GAP_MARKER), `expected a capability gap, got: ${msg}`);
  assert.ok(/phonetic/.test(msg));
});

test("the match_mode map has NO phonetic key — absence is the mechanism", () => {
  // Pinned as a shape, not just a behaviour: someone adding `phonetic: "wildcardInfix"` to make a
  // slice "work" reddens this immediately.
  const msg = gap(() => resolvePredicate({ match_mode: "phonetic" }));
  assert.ok(!/phonetic/.test(msg.split("(supported:")[1] ?? ""), "phonetic is listed as supported");
});

test("an unknown match_mode is refused, not silently defaulted", () => {
  const msg = gap(() => resolvePredicate({ match_mode: "sounds_like" }));
  assert.ok(msg?.includes(CAPABILITY_GAP_MARKER));
});

// ── TERM RENDERING ────────────────────────────────────────────────────────────────────────────────

test("wildcards are placed inside the quoted value, per predicate", () => {
  assert.equal(renderTerm("ALPHA", "exact"), '"ALPHA"');
  assert.equal(renderTerm("ALPHA", "wildcardPrefix"), '"ALPHA*"');
  assert.equal(renderTerm("ALPHA", "wildcardSuffix"), '"*ALPHA"');
  assert.equal(renderTerm("ALPHA", "wildcardInfix"), '"*ALPHA*"');
});

test("an already-anchored term is de-anchored, never double-wrapped", () => {
  // `planPredicateParams` de-anchors `e.term` into `__term`, but `defaultBuildEntryQuery` applies that
  // ONLY to the single-`name` shape — a multi-term wildcard entry arrives at `names[]` with its
  // anchors intact. Without this, the value becomes `**ALPHA**`.
  assert.equal(renderTerm("*ALPHA*", "wildcardInfix"), '"*ALPHA*"');
  assert.equal(renderTerm("ALPHA*", "wildcardPrefix"), '"ALPHA*"');
  assert.equal(renderTerm("*ALPHA", "wildcardSuffix"), '"*ALPHA"');
});

test("an INTERNAL wildcard survives — it is native here, unlike on the local US index", () => {
  // `*` is a real operator inside an EUIPO quoted value, so `NI*E` is a legitimate evidenced query.
  // The same pattern had to be REFUSED on uspto-local, where SQLite would search for a literal `*`.
  assert.equal(renderTerm("NI*E", "wildcardInfix"), '"*NI*E*"');
});

test("an anchored term under `exact` is a PLAN DEFECT and is refused", () => {
  const msg = gap(() => renderTerm("*ALPHA*", "exact"));
  assert.ok(msg?.includes(CAPABILITY_GAP_MARKER));
  assert.ok(/plan defect/i.test(msg));
});

test("a term that is nothing but wildcards is refused, not sent as a register sweep", () => {
  assert.ok(gap(() => renderTerm("*", "wildcardInfix"))?.includes(CAPABILITY_GAP_MARKER));
  assert.ok(gap(() => renderTerm("**", "wildcardInfix"))?.includes(CAPABILITY_GAP_MARKER));
  assert.ok(gap(() => renderTerm("   ", "wildcardInfix"))?.includes(CAPABILITY_GAP_MARKER));
});

test("RSQL quoting escapes the two characters that break the grammar", () => {
  assert.equal(renderTerm('SAY "HI"', "exact"), '"SAY \\"HI\\""');
  assert.equal(renderTerm("BACK\\SLASH", "exact"), '"BACK\\\\SLASH"');
});

// ── COVERAGE ──────────────────────────────────────────────────────────────────────────────────────

test("a territory this source does not hold is REFUSED, never filtered away", () => {
  // Dropping the region would run a worldwide EU search and report it under a US qid — a clean
  // negative about a register we never asked.
  const msg = gap(() => buildRsql({ names: ["A"], regions: ["US"] }));
  assert.ok(msg?.includes(CAPABILITY_GAP_MARKER));
  assert.ok(/US/.test(msg));
});

test("EU and EM both translate to the covered office", () => {
  assert.doesNotThrow(() => buildRsql({ names: ["A"], regions: ["EU"] }));
  assert.doesNotThrow(() => buildRsql({ names: ["A"], regions: ["EM"] }));
  assert.doesNotThrow(() => buildRsql({ names: ["A"], regions: ["eu"] }));
});

// ── THE STATUS VOCABULARY ─────────────────────────────────────────────────────────────────────────

test("the three status lists partition the spec's eighteen, exactly", () => {
  const ours = [...EUIPO_STATUS_LIVE, ...EUIPO_STATUS_DEAD, ...EUIPO_STATUS_AMBIGUOUS];
  assert.equal(new Set(ours).size, ours.length, "a status appears in more than one list");
  assert.deepEqual([...ours].sort(), [...STATUSES].sort(),
    "the vocabulary and the spec enum have drifted — every EUIPO status must be classified deliberately");
});

test("the DEAD list is exactly five terminal acts", () => {
  // The list that decides which rights get dropped WITHOUT BEING LOOKED AT. Growing it is how a real
  // senior right disappears from a clearance, so it is pinned by value, not by size.
  assert.deepEqual([...EUIPO_STATUS_DEAD].sort(),
    ["CANCELLED", "REFUSED", "REMOVED_FROM_REGISTER", "SURRENDERED", "WITHDRAWN"]);
});

test("contested and pending statuses are LIVE, not dead", () => {
  for (const s of ["OPPOSITION_PENDING", "CANCELLATION_PENDING", "APPEALED", "APPEALABLE",
    "RECEIVED", "UNDER_EXAMINATION", "APPLICATION_PUBLISHED", "REGISTRATION_PENDING",
    "START_OF_OPPOSITION_PERIOD", "ACCEPTANCE_PENDING", "ACCEPTED", "REGISTERED"]) {
    assert.equal(classifyEuipoStatus(s), "live", `${s} must be live — a contested or pending right is not a dead one`);
  }
});

test("EXPIRED is AMBIGUOUS — the six-month grace period is a real senior right", () => {
  // EUTMR Art. 53(3): renewal within six months of expiry restores the right RETROACTIVELY, and EUIPO
  // has no separate grace status. Dead → live senior rights silently dropped. Live → overstated.
  // Ambiguous routes to deepfetch, which is the only honest answer.
  assert.equal(classifyEuipoStatus("EXPIRED"), "ambiguous");
  assert.ok(!EUIPO_STATUS_DEAD.includes("EXPIRED"));
  assert.ok(!EUIPO_STATUS_LIVE.includes("EXPIRED"));
});

test("an unrecognised status is ambiguous, never dead — fail open", () => {
  assert.equal(classifyEuipoStatus("SOME_NEW_STATUS_2027"), "ambiguous");
  assert.equal(classifyEuipoStatus(null), "ambiguous");
  assert.equal(classifyEuipoStatus(""), "ambiguous");
});

// ── QUERYABLE ≠ CLASSIFIABLE ──────────────────────────────────────────────────────────────────────

test("the two API-rejected status tokens are excluded from the WIRE vocabulary", () => {
  // PROBED one token at a time: `status=="APPEALABLE"` and `status=="ACCEPTANCE_PENDING"` both return
  // HTTP 400 at a valid size, while the other sixteen answer. Sending one 400s the entire query.
  assert.ok(!EUIPO_STATUS_QUERYABLE.includes("APPEALABLE"));
  assert.ok(!EUIPO_STATUS_QUERYABLE.includes("ACCEPTANCE_PENDING"));
  assert.equal(EUIPO_STATUS_QUERYABLE.length, 16);
});

test("…but both are still CLASSIFIED when they come back on a row", () => {
  // A status we cannot filter ON can still be filtered BY the office and returned to us.
  assert.equal(classifyEuipoStatus("APPEALABLE"), "live");
  assert.equal(classifyEuipoStatus("ACCEPTANCE_PENDING"), "live");
});

test("an unqueryable status is DROPPED from the filter, never sent", () => {
  const rsql = buildRsql({ names: ["A"], match_mode: "exact", status: ["REGISTERED", "APPEALABLE"] });
  assert.ok(!rsql.includes("APPEALABLE"), "a token the API rejects reached the wire");
  assert.ok(rsql.includes('status=="REGISTERED"'));
});

test("dropping every status token drops the CLAUSE, and never sends an empty one", () => {
  const rsql = buildRsql({ names: ["A"], match_mode: "exact", status: ["APPEALABLE"] });
  assert.ok(!/status/.test(rsql), `an empty status clause was emitted: ${rsql}`);
});

test("LIVE_STATUS_FILTER is the live list minus the two the API rejects", () => {
  assert.equal(LIVE_STATUS_FILTER.length, 10);
  assert.ok(LIVE_STATUS_FILTER.every((s) => EUIPO_STATUS_LIVE.includes(s) && EUIPO_STATUS_QUERYABLE.includes(s)));
});

// ── PAGE SIZE ─────────────────────────────────────────────────────────────────────────────────────

test("the page-size floor is 10 — below it EVERY request 400s, whatever the query", () => {
  // This has cost two probe rounds. A 400 on a request whose QUERY you are testing reads exactly like
  // "the query is unsupported", and it once nearly cost the contract a wrong nativeScriptIndex and a
  // wrong wildcardSuffix.
  assert.equal(PAGE_SIZE_MIN, 10);
  assert.equal(PAGE_SIZE_MAX, 100);
});

// ── ROW SHAPES ────────────────────────────────────────────────────────────────────────────────────

const RAW = Object.freeze({
  applicationNumber: "000504787",
  markKind: "INDIVIDUAL", markFeature: "FIGURATIVE", markBasis: "EU_TRADEMARK",
  niceClasses: [9],
  wordMarkSpecification: { verbalElement: "ALPHA" },
  applicants: [{ office: "EM", identifier: "23535", name: "PHONOCAR S.p.A." }],
  representatives: [{ office: "EM", identifier: "15280", name: "LECCE & CALCIATI S.R.L." }],
  applicationDate: "1997-04-07",
  status: "WITHDRAWN",
});

test("the band row uses the BAND vocabulary, not the raw API one", () => {
  // `classes` / `owner_name` / `application_date` are the contract — band-shape, named-band and
  // supplemental's PREVIEW_FIELDS index into it BY NAME. Copying the API's own key names produces a
  // row where every lookup reads null and the band renders empty while every stage reports success.
  const row = toBandRow(RAW);
  for (const k of ["record_id", "mark_text", "classes", "status", "owner_name", "application_date"]) {
    assert.ok(k in row, `the band row is missing the contract key ${k}`);
  }
  assert.deepEqual(row.classes, [9]);
  assert.equal(row.owner_name, "PHONOCAR S.p.A.");
  assert.equal(row.mark_text, "ALPHA");
  assert.equal(row.record_id, "/mark/eu/000504787");
});

test("toBandRow is IDEMPOTENT — the kernel screens rows it has already converted", () => {
  // Reading only `niceClasses` empties the classes on the second pass. Empty classes make
  // screenVerdict SKIP its class check, so an out-of-scope mark reads as in-scope-live.
  const once = toBandRow(RAW);
  const twice = toBandRow(once);
  assert.deepEqual(twice.classes, [9], "classes were lost on the second conversion");
  assert.deepEqual(twice, once);
});

test("owner_country is null — this API has no applicant country at all", () => {
  // `applicants[].office` is the FILING OFFICE ("EM"), not a nationality. Mapping it would stamp
  // every EU applicant as EM-domiciled, which is a fabricated fact on every EU card.
  assert.equal(toBandRow(RAW).owner_country, null);
  assert.equal(toNeutralRecord(RAW).ownerCountry, null);
});

test("the public record URL is a real eSearch address", () => {
  assert.equal(publicRecordUrl("000504787"), "https://euipo.europa.eu/eSearch/#details/trademarks/000504787");
  assert.equal(publicRecordUrl(""), null);
  assert.equal(publicRecordUrl(null), null);
});

test("the ref round-trips", () => {
  assert.equal(refToId(makeRef("W00843717")), "W00843717");
  assert.equal(refToId(makeRef("000504787")), "000504787");
  assert.equal(makeRef(""), null);
});

// ── PROCEEDINGS: null means NOT ASKED, [] means ASKED AND NONE ────────────────────────────────────

test("a SEARCH ROW's proceedings are null — this API serves them only on the detail record", () => {
  // PROBED: `oppositions[] / cancellations[] / appeals[] / decisions[]` appear ONLY on the detail
  // record and are OMITTED WHEN EMPTY. capabilities.oppositions:true licenses a reader to treat an
  // empty list as a real answer — and it is only a real answer on the detail path. Collapsing the two
  // turns "we did not ask" into "there are none", on the one axis this provider beats both paid
  // vendors at.
  const r = toNeutralRecord(RAW);
  assert.equal(r.oppositions, null);
  assert.equal(r.cancellations, null);
  assert.match(r._provenance.proceedings, /would mean nothing/);
});

test("a DETAIL RECORD's absent proceedings become [] — asked, and none recorded", () => {
  const r = toNeutralRecord(RAW, { fromDetail: true });
  assert.deepEqual(r.oppositions, []);
  assert.deepEqual(r.appeals, []);
  assert.match(r._provenance.proceedings, /none are recorded/);
});

test("a detail record's REAL proceedings survive", () => {
  const r = toNeutralRecord({ ...RAW, status: "OPPOSITION_PENDING", oppositions: [{ oppositionNumber: "B123" }] }, { fromDetail: true });
  assert.equal(r.oppositions.length, 1);
  assert.equal(r.statusClass, "live");
});

// ── SCREENING ─────────────────────────────────────────────────────────────────────────────────────

test("rowScreen returns a FLAT row — it must not nest itself under `screen`", () => {
  // makeEnumerate composes `{ ...liftScreenFields(record, row), screen: row }` — it does the nesting.
  // A row that nests itself lands at record.screen.screen.screen_verdict; nothing errors, the verdict
  // is simply absent, and a band with no verdicts is a band that was never screened.
  const r = rowScreen(RAW, [9]);
  assert.ok(!("screen" in r), "rowScreen nested itself");
  assert.equal(typeof r.screen_verdict, "string");
  assert.ok("live_status" in r && "all_class" in r);
});

test("the screen verdict follows the status vocabulary", () => {
  assert.equal(rowScreen(RAW, [9]).screen_verdict, "drop:dead");                                   // WITHDRAWN
  assert.equal(rowScreen({ ...RAW, status: "REGISTERED" }, [9]).screen_verdict, "surface:in-scope-live");
  assert.equal(rowScreen({ ...RAW, status: "REGISTERED" }, [30]).screen_verdict, "drop:out-of-class");
  assert.equal(rowScreen({ ...RAW, status: "EXPIRED" }, [9]).screen_verdict, "deepfetch:ambiguous"); // grace period
});

test("an all-class registration is never class-dropped", () => {
  const all = { ...RAW, status: "REGISTERED", niceClasses: Array.from({ length: 45 }, (_, i) => i + 1) };
  assert.equal(rowScreen(all, [30]).screen_verdict, "surface:all-class");
});

// ── NON-ANSWERS ───────────────────────────────────────────────────────────────────────────────────

test("a parseable body that is not a search response is NOT an answer", () => {
  // An RFC-7807 problem served with a 200 parses fine and used to ride out as an empty register page
  // — which a model reads as "nothing is registered".
  assert.equal(isSearchResponseBody({ type: "about:blank", title: "Bad Request", status: 400 }), false);
  assert.equal(isSearchResponseBody(null), false);
  assert.equal(isSearchResponseBody("a string"), false);
  assert.equal(isSearchResponseBody({ trademarks: [] }), true);
  assert.equal(isSearchResponseBody({ totalElements: 0 }), true);
});

test("hasAnyElement never throws, whatever it is handed", () => {
  // The kernel calls this as a plain predicate BEFORE any error handling exists. Routing it through
  // buildRsql (which throws capability gaps) would abort the stage instead of producing a disclosed
  // refusal — the defect this provider's sibling shipped and had to fix.
  for (const p of [null, undefined, {}, { regions: ["US"] }, { match_mode: "phonetic" }, { names: ["*"] }]) {
    assert.doesNotThrow(() => hasAnyElement(p), `hasAnyElement threw on ${JSON.stringify(p)}`);
  }
  assert.equal(hasAnyElement({}), false);
  assert.equal(hasAnyElement({ names: ["A"] }), true);
  assert.ok(MISSING_ELEMENT_ERROR.startsWith("ERROR:"));
});

// ── CREDENTIALS ───────────────────────────────────────────────────────────────────────────────────

test("a missing credential fails LOUDLY and by name, never as an empty register", () => {
  const saved = { id: process.env.EUIPO_CLIENT_ID, sec: process.env.EUIPO_CLIENT_SECRET };
  delete process.env.EUIPO_CLIENT_ID; delete process.env.EUIPO_CLIENT_SECRET;
  try {
    const msg = gap(() => resolveConfig(null));
    assert.ok(/EUIPO_CLIENT_ID/.test(msg), msg);
    assert.ok(/refuse rather than report an empty EU register/.test(msg), msg);
  } finally {
    if (saved.id) process.env.EUIPO_CLIENT_ID = saved.id;
    if (saved.sec) process.env.EUIPO_CLIENT_SECRET = saved.sec;
  }
});

test("an unknown environment is refused — sandbox and production hold different corpora", () => {
  const msg = gap(() => resolveConfig({ clientId: "x", clientSecret: "y", environment: "staging" }));
  assert.ok(/SEPARATE DEPLOYMENTS/.test(msg), msg);
});

// ── the capability contract's queryable-status list agrees with row.js ────────────────────────────

test("capabilities.queryableStatuses agrees with the row vocabulary, exactly", () => {
  // TWO SOURCES OF ONE FACT, kept in different files on purpose (the contract is read at PLAN time and
  // must stay dependency-free; the classifier is read at SCREEN time). This is the test that stops
  // them drifting — a drift here sends a token the API rejects, and one rejected token 400s the whole
  // query, so the band errors rather than narrowing.
  assert.deepEqual([...CAPABILITIES.queryableStatuses].sort(), [...EUIPO_STATUS_QUERYABLE].sort());
});

test("every queryable status is CLASSIFIED — and EXPIRED is the one deliberate ambiguity", () => {
  // The first draft of this asserted "never ambiguous" and reddened on EXPIRED. That was the test
  // being wrong, not the code: EXPIRED is queryable AND deliberately unclassified, because the
  // six-month grace period makes it neither live nor dead. Pinned as an exact exception list so a
  // SECOND status quietly falling through would still fail here.
  const ambiguous = CAPABILITIES.queryableStatuses.filter((s) => classifyEuipoStatus(s) === "ambiguous");
  assert.deepEqual(ambiguous, ["EXPIRED"],
    `unclassified queryable statuses: ${ambiguous.join(", ")} — a filtered band would screen these as all-ambiguous`);
});

// ── the registration number is decided by the DATE, not the status ────────────────────────────────

test("a DEAD mark that was once registered still reports its registration number", () => {
  // PROBED against production: CANCELLED, SURRENDERED, EXPIRED and REMOVED_FROM_REGISTER all carry
  // `registrationDate` on 100% of rows — they WERE registered and still hold that number. The first
  // cut gated on `status === "REGISTERED"` and reported null for every one of them, which reads as
  // "never registered" for precisely the dead SENIOR rights a clearance exists to surface.
  for (const status of ["CANCELLED", "SURRENDERED", "EXPIRED", "REMOVED_FROM_REGISTER", "OPPOSITION_PENDING"]) {
    const row = toBandRow({ ...RAW, status, registrationDate: "2001-03-14" });
    assert.equal(row.registration_number, "000504787", `${status} lost its registration number`);
    assert.equal(toNeutralRecord({ ...RAW, status, registrationDate: "2001-03-14" }).registrationNumber, "000504787", status);
  }
});

test("a mark that NEVER registered reports no registration number", () => {
  // WITHDRAWN and APPLICATION_PUBLISHED carry no registrationDate at all (0% of rows, probed), so
  // null is the honest answer — not an omission.
  for (const status of ["WITHDRAWN", "APPLICATION_PUBLISHED", "REFUSED", "UNDER_EXAMINATION"]) {
    assert.equal(toBandRow({ ...RAW, status }).registration_number, null, status);
    assert.equal(toNeutralRecord({ ...RAW, status }).registrationNumber, null, status);
  }
});

test("a REGISTERED mark reports its number, as before", () => {
  assert.equal(toBandRow({ ...RAW, status: "REGISTERED", registrationDate: "2001-03-14" }).registration_number, "000504787");
});

test("#1149 item 2: EUIPO_ENVIRONMENT has NO default — sandbox is never reached by omission", () => {
  // Sandbox and production are separate deployments over different corpora; the sandbox is a frozen
  // snapshot plus synthetic rows ("EUTM Generated by QC Automated Script"). This used to default to
  // sandbox, so a hand-written .env that omitted the variable produced a clearance against marks that
  // are not in the register, silently. `npm run setup` always writes production, which is exactly why
  // the exposed population was the one configuring by hand.
  const creds = { clientId: "id", clientSecret: "secret" };
  assert.throws(() => resolveConfig(creds),
    /EUIPO_ENVIRONMENT is not set, and there is NO default/,
    "an unset environment resolved to something instead of refusing");

  // Both intentions still work when stated.
  assert.equal(resolveConfig({ ...creds, environment: "production" }).environment, "production");
  assert.equal(resolveConfig({ ...creds, environment: "sandbox" }).environment, "sandbox");

  // ORDER MATTERS: a missing credential is the more specific refusal and must still win, or an operator
  // with neither set is sent to fix the wrong thing first. (This ordering was wrong in the first draft
  // of this change and the credential test above caught it.)
  assert.throws(() => resolveConfig({}), /no credentials/,
    "the environment refusal preempted the credential refusal");
});
