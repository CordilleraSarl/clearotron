// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// plan.test.mjs — plan_run: the free preview. The contract under guard is that it DESCRIBES and never
// acts: no queue file, no spend, no reservation. Sets CLEAROTRON_WORK_DIR before importing (driver
// config reads it at module load) so any accidental write would land in a throwaway tree and be visible.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readdirSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pinEnv } from "../../shared/env-aliases.mjs";   // — a fixture pins EVERY spelling

const ROOT = mkdtempSync(join(tmpdir(), "plan-ws-"));
pinEnv(process.env, "CLEAROTRON_WORK_DIR", ROOT);
// The POOL root too, now that the availability gate reconciles `built` against the flag snapshot beside
// the pool: unpinned it defaults to the real /srv/trademark-archive, and a unit test whose answers depend
// on the deployment's own snapshot is the CI trap this repo has already been bitten by.
pinEnv(process.env, "CLEAROTRON_REPORTS_DIR", join(ROOT, "pool"));
// The RETIRED switches are cleared so this process looks exactly like the ops-MCP, which carries no
// EnvironmentFile. A built depth must preview as runnable anyway — that is the regression test for the
// bug that retired them (plan_run telling clients three shipped depths were "not switched on").
for (const sw of ["CLEAROTRON_JX_LANES", "CLEAROTRON_KNOCKOUT_MODE", "CLEAROTRON_RECIPES_MODE"]) delete process.env[sw];
const STUDIO = join(ROOT, "workspace-clawdi", "studio", "prelim-search");
const QUEUE = join(STUDIO, "queue");

const { planRun, PLAN_CAVEAT } = await import("../lib/plan.mjs");
// — the wall's default, read rather than restated. See describe-options.
const { DEFAULT_CLIENT_DAILY_RUNS } = await import("../../driver/usage-ledger.mjs");
const { startRun, buildJob } = await import("../lib/ops.mjs");
const { PORTAL_ROUTE_UNAVAILABLE } = await import("../../driver/enqueue-schema.mjs");
const { TOOL_DEFS } = await import("../server.mjs");

const BASE = { forwarder: "ops", markName: "NOVAPULSE", classes: [9, 41], profileKey: "aurora" };

test("plan_run writes NOTHING — the whole point is that it is free", () => {
  const before = existsSync(QUEUE) ? readdirSync(QUEUE).length : 0;
  const p = planRun({ ...BASE });
  assert.equal(p.ok, true);
  assert.equal(p.wouldRun, true);
  const after = existsSync(QUEUE) ? readdirSync(QUEUE).length : 0;
  assert.equal(after, before, "no queue file — a preview that reserves anything is not a preview");
  assert.match(p._note, /NOTHING HAS BEEN STARTED/);
});

test("plan_run previews the EXACT job start_run would build, not a lookalike", () => {
  // Both go through buildJob. The risk this guards is a second assembly path drifting from the first,
  // so that a requester confirms one search and a different one runs.
  const args = { ...BASE, id: "plan-fixed-id", jurisdictions: ["US", "us"], platforms: ["gnc.com"] };
  const planned = planRun(args);
  const built = buildJob(args, {});
  assert.equal(built.id, "plan-fixed-id");
  assert.deepEqual(planned.subject.marks, [built.markName]);
  assert.deepEqual(planned.scope.platformsAdded, ["gnc.com"]);
});

test("plan_run reports WHERE the depth came from, using the resolver's own origin", () => {
  // "Running at your account's default" and "running what you asked for" look identical in a result and
  // mean very different things to whoever approves the spend.
  // THERE IS NO HOUSE DEFAULT ANY MORE, and its removal is the answer this test now pins. `prelim` was
  // it, and `prelim` named three different searches depending on where it pointed — so a request that
  // named nothing got a guess wearing a level key. The SCOPE names it, and `chosenBy` says so.
  assert.match(planRun({ ...BASE }).search.chosenBy, /the territories this search resolves to/);
  assert.equal(planRun({ ...BASE, product: "global-preliminary-search" }).search.chosenBy, "this request");
});

test("plan_run states the scope that would ACTUALLY be searched, and where each part came from", () => {
  const req = planRun({ ...BASE, jurisdictions: ["US", "us", "  EU  "] });
  assert.deepEqual(req.scope.jurisdictions, ["US", "EU"], "normalized, as the engine would receive it");
  assert.equal(req.scope.jurisdictionsFrom, "this request");
  const dflt = planRun({ ...BASE });
  assert.equal(dflt.scope.jurisdictionsFrom, "the account's default territories");
  assert.ok(dflt.scope.jurisdictions.length, "aurora has defaults, and the preview shows them rather than an empty list");
});

test("plan_run shows an added marketplace widening the grid — the part a requester cannot infer", () => {
  const plain = planRun({ ...BASE });
  const wider = planRun({ ...BASE, platforms: ["gnc.com"] });
  assert.deepEqual(wider.scope.platformsAdded, ["gnc.com"]);
  assert.equal(wider.scope.gridCellsPerVariant, plain.scope.gridCellsPerVariant + 1,
    "an extra marketplace is extra work per variant, and the plan says so before it is bought");
});

test("plan_run BLOCKS what start_run would refuse — the questions, before the spend", () => {
  for (const [label, args, re] of [
    ["out-of-range class", { ...BASE, classes: [99] }, /whole numbers 1–45/],
    // territories against a quick screen are ACCEPTED (2026-07-20); a marketplace still is not, because
    // a knockout has no grid for a store to be swept in.
    ["marketplace against a quick screen", { ...BASE, product: "knockout-search", platforms: ["gnc.com"] }, /no marketplace grid/],
    ["both selectors at once", { ...BASE, product: "global-preliminary-search", recipeKey: "quarterly" }, /name ONE selector/],
  ]) {
    const p = planRun(args);
    assert.equal(p.wouldRun, false, label);
    assert.match(p.blockers.join(" "), re, label);
    assert.match(p._note, /NOTHING HAS BEEN STARTED/);
    assert.match(p._note, /questions to put back/, "blockers are things to ask, not failures to retry");
  }
});

test("plan_run refuses an unrunnable combination up front rather than at the runner, after the queue", () => {
  // Not an availability refusal (the switches went 2026-07-27): a REQUESTED native-language
  // investigation with no routing territory in scope is refused by the scope rules, because it routes
  // on jurisdiction and would otherwise be billed and run zero lanes. The preview is where a requester
  // should learn that. Aurora's seven default territories carry no routing one.
  const p = planRun({ ...BASE, product: "multi-country-focus-search", nativeLanguage: true });
  assert.equal(p.wouldRun, false);
  assert.match(p.blockers.join(" "), /routing territor/);
  assert.equal(p.search.product, "multi-country-focus-search", "it still names the product that was asked for");
  // AND THE AUTOMATIC ARM DOES NOT REFUSE. On a Full country search the investigation is not a thing
  // anybody asked for, so a country with no adapter simply routes nothing — refusing there would be a
  // refusal we inflicted on ourselves.
  const auto = planRun({ ...BASE, product: "full-country-search", jurisdictions: ["Brazil"] });
  assert.equal(auto.wouldRun, true, JSON.stringify(auto.blockers));
});

test("plan_run carries the legal caveat verbatim, never paraphrased", () => {
  assert.equal(planRun({ ...BASE }).caveat, PLAN_CAVEAT);
  assert.match(PLAN_CAVEAT, /Register analysis may adjust ratings in either direction/);
});

test("plan_run names rating authority but offers no way to touch it", () => {
  const p = planRun({ ...BASE });
  assert.equal(p.account.profileKey, "aurora");
  assert.match(p.account.framework, /risk framework/);
  // A search says WHERE to look. What rates the findings belongs to the customer's profile, and no job
  // field reaches it — the plan reports it so a requester can see which framework applies, not change it.
  assert.ok(!("riskAppetite" in p.account), "posture is not restated as if it were adjustable from here");
});

test("plan_run then start_run with the SAME args does what the plan said", () => {
  const args = { ...BASE, id: "plan-then-run", jurisdictions: ["US"] };
  const planned = planRun(args);
  assert.equal(planned.wouldRun, true);
  const started = startRun(args, {});
  assert.equal(started.ok, true);
  assert.ok(existsSync(started.queuePath), "and THIS one is the act that queues");
});

test("what the requester sets survives the trigger hop — buildJob carries what the portal confirmed", () => {
  // Found 2026-07-27: portal-service forwarded a lever, the plan gate and review screen showed it, and
  // buildJob dropped it — the queued job had no flag. The rule survives its subject: any field the
  // portal confirms must reach the job file, and any field this door will not honour must be REFUSED
  // rather than dropped.
  assert.equal(buildJob({ ...BASE, nativeLanguage: true }, {}).nativeLanguage, true);
  assert.ok(!("nativeLanguage" in buildJob({ ...BASE }, {})), "omitted toggle writes no field");
  // `false` IS CARRIED NOW, and that reverses this line. It used to assert the drop as the contract —
  // "false writes no field" — which is the accept-and-drop shape on the toggle beside caseLaw: the
  // schema declares a plain boolean, so an agent sends false, and the door recorded nothing and ran the
  // investigation anyway wherever the product carries it. Carried, so validateJob can refuse it.
  assert.equal(buildJob({ ...BASE, nativeLanguage: false }, {}).nativeLanguage, false, "carried, so it can be refused");
  assert.equal(planRun({ ...BASE, nativeLanguage: false }).wouldRun, false, "and it IS refused, not ignored");
  assert.deepEqual(buildJob({ ...BASE, worldwide: true }, {}).geography, { mode: "worldwide", origin: "request" });
  // caseLaw LEFT THE SCHEMA and is still CARRIED, so validateJob can refuse it. Dropping it here would
  // make this the one door that accepts the field and silently ignores it.
  assert.equal(buildJob({ ...BASE, caseLaw: true }, {}).caseLaw, true, "carried, so it can be refused");
  assert.equal(planRun({ ...BASE, caseLaw: true }).wouldRun, false, "and it IS refused, not ignored");
});

// ── the (depth × scope) combination rules, through the preview ──────────────────────────────────────
// The MCP door PR-1 wired. Without a test here the blockers fold could be deleted and nothing would turn
// red, and plan_run would go back to answering wouldRun:true about a request the runner refuses — the
// exact dishonesty this gate exists to close.
test("plan_run refuses the combinations the runner refuses, on the SAME ruler it prints the scope with", () => {
  // aurora's default territories are the scope this request would actually run at, so the product rule
  // counts them — an account default is not an exemption from a one-country product.
  const many = planRun({ ...BASE, product: "full-country-search" });
  assert.equal(many.wouldRun, false);
  const d1 = many.blockers.find((b) => /reads exactly one country/.test(b));
  assert.ok(d1, JSON.stringify(many.blockers));
  assert.match(d1, new RegExp(`this request names ${many.scope.jurisdictions.length}`),
    "the blocker counted the same territories the response prints beside it — one ladder, not two");
  assert.equal(planRun({ ...BASE, product: "full-country-search", jurisdictions: ["United States"] }).wouldRun, true);
  // the routing rule reaches this door too
  const jx = planRun({ ...BASE, product: "multi-country-focus-search", nativeLanguage: true });
  assert.ok(jx.blockers.some((b) => /routes on territory/.test(b)), JSON.stringify(jx.blockers));
});

test("plan_run never invents a blocker about territories it could not read", () => {
  // A profile store this process cannot resolve (the roster-blindness class of incident) leaves `profile`
  // null. Judging that as "resolves to no territory (worldwide)" would REFUSE a request the runner
  // ADMITS, telling a requester their search is impossible when it is not (review 2026-07-27).
  const blind = planRun({ ...BASE, profileKey: "no-such-customer", product: "full-country-search" });
  assert.deepEqual(blind.blockers.filter((b) => /reads exactly one country|routes on territory/.test(b)), []);
  // …and what the REQUEST itself names needs no profile to count, so the rule still bites there
  const named = planRun({ ...BASE, profileKey: "no-such-customer", product: "full-country-search", jurisdictions: ["US", "FR"] });
  assert.ok(named.blockers.some((b) => /this request names 2/.test(b)), JSON.stringify(named.blockers));
});

// ---- the deep dive, previewed ------------------------------------------------------------------

test("the PREVIEW says whether the case-law pass is part of what was ordered — from the PRODUCT", () => {
  // The plan used to describe a deep dive in words indistinguishable from a standard preliminary, so the
  // one screen a requester approves said nothing about the half of the product that makes it deep. It is
  // read off the resolved product now, not off a flag, so it cannot disagree with what runs.
  const deep = planRun({ ...BASE, product: "full-country-search", jurisdictions: ["United States"] });
  assert.equal(deep.search.caseLaw, true);
  assert.equal(deep.wouldRun, true, JSON.stringify(deep.blockers));
  assert.equal(deep.search.nativeLanguage, "automatic");
  assert.equal(planRun({ ...BASE }).search.caseLaw, false, "no other product previews as carrying it");
  // AND THE FLAG IS REFUSED, not ignored. A request that asks for case law believes it bought the deep
  // reading; accepting and dropping it is the "accepted, then quietly narrower" shape.
  const flagged = planRun({ ...BASE, product: "full-country-search", jurisdictions: ["United States"], caseLaw: true });
  assert.equal(flagged.wouldRun, false);
  assert.match(flagged.blockers.join(" "), /caseLaw is not a request setting/);
});

test("the ONE-COUNTRY rule reaches the requester through the preview, as a question", () => {
  // aurora's account default is seven territories, so a Full country search ordered without a territory
  // of its own silently resolves to seven — and seven territories is a Multi-country focus search. The
  // preview is where that is learned, before the spend.
  const spread = planRun({ ...BASE, product: "full-country-search" });
  assert.equal(spread.wouldRun, false);
  assert.match(spread.blockers.join(" "), /reads exactly one country/);
  assert.match(spread.blockers.join(" "), /order a Multi-country focus search over them/,
    "the preview names the product to order instead, computed from this very scope");
  assert.match(spread._note, /questions to put back/);
  // and the blocker AGREES with the scope the same response reports
  assert.equal(spread.scope.jurisdictions.length, 7);
  const worldwide = planRun({ ...BASE, profileKey: "generic", product: "full-country-search" });
  assert.equal(worldwide.wouldRun, false);
  assert.match(worldwide.blockers.join(" "), /resolves to no territory \(worldwide\)/);
});

// ---- availability, in words a client's assistant can relay ---------------------------------------

test("THE REGRESSION: a BUILT depth previews as runnable from a process with no engine environment", () => {
  // This used to assert that prelim-jx came back `wouldRun: false` with "Depth 5 is unavailable. Not
  // switched on for this account yet — Cordillera can enable it." It passed, and it was asserting the bug:
  // the ops-MCP unit has no EnvironmentFile, so CLEAROTRON_JX_LANES read as unset, unset was the same as off,
  // and plan_run told clients a shipped depth could not be ordered. Retired 2026-07-27.
  const p = planRun({ ...BASE, product: "multi-country-focus-search", nativeLanguage: true, jurisdictions: ["China", "Japan"] });
  assert.equal(p.wouldRun, true, "the native-language investigation is built and routed — it must preview as runnable");
  const blob = JSON.stringify(p);
  assert.doesNotMatch(blob, /CLEAROTRON_/, "a client's assistant was handed one of our environment variable names");
  assert.doesNotMatch(blob, /Not switched on for this account yet/, "nothing is switched off any more");
  assert.doesNotMatch(blob, /is unavailable\./, "nothing is unavailable on a complete build");
});

test("a resolution failure keeps the engine's own clarify sentence, verbatim", () => {
  // It is already actionable prose written for the requester, and it carries no switch name — flattening
  // it into a generic cause would lose the one thing that tells them what to send instead.
  const p = planRun({ ...BASE, product: "not-a-level" });
  assert.equal(p.wouldRun, false);
  assert.match(p.blockers.join(" "), /names no search we offer — one of:/);
  assert.doesNotMatch(JSON.stringify(p), /CLEAROTRON_/);
});

// ---- the daily allowance: advice, beside the blockers --------------------------------------------

test("the allowance is REPORTED for a readable account, and never invented for one we cannot read", () => {
  // THE LEDGER IS WRITTEN HERE ON PURPOSE. This test used to run with no ledger on disk at all
  // and still assert the three usage keys — i.e. it pinned a count of a file nobody had read, which is
  // the defect its own title refuses. An empty ledger is the honest fixture for "a readable account
  // that has spent nothing": the read succeeds, the answer is zero, and the zero has evidence behind it.
  mkdirSync(STUDIO, { recursive: true });
  writeFileSync(join(STUDIO, ".matter-ledger.jsonl"), "");
  const p = planRun({ ...BASE });
  assert.equal(p.account.dailyRunsEffective, DEFAULT_CLIENT_DAILY_RUNS, "aurora sets no runCaps — the wall's own default applies");
  assert.deepEqual(Object.keys(p.account.usage ?? {}).sort(), ["queued", "thisMonth", "today"]);
  assert.equal(p.account.usageComplete, true);
  assert.equal(p.account.allowanceApplies, false, "a staff preview is not capped, and says so");
  // the neutral profile is not an account with an allowance
  assert.equal(planRun({ ...BASE, profileKey: "generic" }).account.usage, null);
  assert.equal(planRun({ ...BASE, profileKey: "generic" }).account.dailyRunsEffective, null);
});

test("an exhausted CLIENT account is told before start_run, not by the runner afterwards", () => {
  // The same ledger the admission wall counts (usage-ledger.mjs) — anything else and the number on
  // screen could disagree with the number that refuses.
  mkdirSync(STUDIO, { recursive: true });
  const today = Date.now();
  // EXACTLY A FULL DAY, derived from the wall's own default — the arm's subject is that an exhausted
  // account is told BEFORE start_run, not what the number is, so the fixture spends the day the wall
  // grants rather than a count that has to be edited whenever the allowance is ruled on.
  writeFileSync(join(STUDIO, ".matter-ledger.jsonl"),
    Array.from({ length: DEFAULT_CLIENT_DAILY_RUNS },
      () => ({ profileKey: "aurora", ts: today, clientPrincipal: true })).map((r) => JSON.stringify(r)).join("\n") + "\n");
  const client = { kind: "account", runId: null, sub: "lawyer@aurora.example", accounts: ["aurora"] };
  const p = planRun({ ...BASE }, { scope: client, now: today });
  assert.equal(p.wouldRun, false);
  assert.match(p.blockers.join(" "), new RegExp(`used all ${DEFAULT_CLIENT_DAILY_RUNS} of today's client-started searches`));
  assert.match(p.blockers.join(" "), /resets at midnight UTC/);
  assert.doesNotMatch(JSON.stringify(p), /CLEAROTRON_|runCaps\.dailyRuns/, "the refusal is a sentence, not a config field");
  assert.equal(p.account.remainingToday, 0);
  // STAFF are not capped — the wall only bites jobs stamped clientPrincipal, and only the client door
  // stamps them. A staff preview for the same exhausted account must still say wouldRun.
  const staff = planRun({ ...BASE }, { scope: { kind: "ops", runId: null, sub: "ops" }, now: today });
  assert.equal(staff.wouldRun, true, "a staff preview was blocked by a client's allowance");
  assert.equal(staff.account.usage.today, DEFAULT_CLIENT_DAILY_RUNS, "…while still being told the count");
});

test("a ledger the preview could not read yields NO allowance, never a full one (#429)", () => {
  // The header above this function has always promised "a ledger that cannot be read yields no
  // allowance rather than a fabricated one". Nothing delivered it: the count never throws, it just comes
  // back 0 — so a deployment whose ledger path was wrong told every agent its client had a fresh day.
  // Pointing the queue scan at an empty tree is that deployment, reduced to one test.
  const blind = mkdtempSync(join(tmpdir(), "plan-blind-"));
  const saved = process.env.CLEAROTRON_WORK_DIR, savedQ = process.env.CLEAROTRON_QUEUE_DIR;
  pinEnv(process.env, "CLEAROTRON_WORK_DIR", blind);   // no queue, no ledger, nothing to count
  pinEnv(process.env, "CLEAROTRON_QUEUE_DIR", undefined);         // …and nothing ambient to count from either
  try {
    const client = { kind: "account", runId: null, sub: "lawyer@aurora.example", accounts: ["aurora"] };
    const p = planRun({ ...BASE }, { scope: client, now: Date.now() });
    assert.equal(p.account.usage, null, "a count nobody took was reported as a count");
    assert.equal(p.account.remainingToday, null, "an allowance was promised off an unread ledger");
    // `usage: null` ALONE cannot be the answer: it is also what a generic or unreadable-profile preview
    // returns, i.e. "no allowance applies". An agent reading only that is told this client is uncapped.
    assert.equal(p.account.usageComplete, false, "blind was indistinguishable from uncapped");
    assert.equal(planRun({ ...BASE, profileKey: "generic" }).account.usageComplete, null,
      "…and \"no allowance applies\" must not borrow the blind shape either");
    // Same correction as its sibling in describe-options: aurora sets no runCaps, so the limit here is
    // the WALL'S DEFAULT and never came off a profile. The property being asserted is unchanged — an
    // unreadable ledger loses the COUNTS and keeps the LIMIT, because the limit needs no ledger.
    assert.equal(p.account.dailyRunsEffective, DEFAULT_CLIENT_DAILY_RUNS,
      "the LIMIT is knowable without the ledger and is still a fact");
    assert.equal(p.wouldRun, true, "the preview must degrade, not refuse — the wall is the control");
    // The field is for a program; the sentence is what an assistant actually relays to the requester.
    assert.match(p.warnings.join(" "), /usage could not be read/, "blind passed silently to the agent");
    assert.doesNotMatch(p.blockers.join(" "), /usage could not be read/, "a count we did not take refused a run");
  } finally {
    pinEnv(process.env, "CLEAROTRON_WORK_DIR", saved);
    pinEnv(process.env, "CLEAROTRON_QUEUE_DIR", savedQ);
  }
});

// ---- the unbuilt DELIVERY lane -------------------------------------------------------------------

test("deliveryRoute \"portal\" is BLOCKED in the preview, in the runner's own words", () => {
  // plan_run's schema OFFERS this enum value, and the runner clarifies it at admission. Without the
  // blocker the preview answered wouldRun:true / blockers:[] about a job that cannot start — an agent
  // relays "this is what would run", start_run is called with the same arguments, and the job is
  // refused at intake. A field the preview invites is a field the preview has to judge.
  const p = planRun({ ...BASE, deliveryRoute: "portal" });
  assert.equal(p.wouldRun, false);
  assert.match(p.blockers.join(" "), /the portal delivery lane ships with the portal; omit deliveryRoute to deliver by email/);
  assert.equal(p.blockers.includes(PORTAL_ROUTE_UNAVAILABLE), true,
    "the preview and the wall must refuse in the SAME sentence — two doors, one string");
  // case and padding are the wall's own reading, not a stricter one
  assert.equal(planRun({ ...BASE, deliveryRoute: "  PORTAL " }).wouldRun, false);
  // …and the working value is untouched
  assert.equal(planRun({ ...BASE, deliveryRoute: "email" }).wouldRun, true);
  assert.equal(planRun({ ...BASE }).wouldRun, true, "omitting it is the default and blocks nothing");
});

// ---- what a caught engine error may say to a client ----------------------------------------------

test("a MALFORMED recipe belonging to ANOTHER customer never reaches this client's blockers", () => {
  // loadRecipes walks EVERY customer directory under the store and rethrows the first invalid file's
  // message verbatim — and validateRecipe prefixes each with `recipes/<customer>/<slug>.json:`. Relayed
  // as a blocker that handed a client another customer's account key, their saved-search slug, a
  // config-store path and the engine's component vocabulary, for a file they did not write. Neither leak
  // scan could see it: a .json store path is not a module path and carries no CLEAROTRON_ name.
  const store = join(ROOT, "recipes-broken");
  mkdirSync(join(store, "celta"), { recursive: true });
  writeFileSync(join(store, "celta", "quarterly-sweep.json"), JSON.stringify({
    version: 1, label: "Quarterly sweep", base: "global-preliminary-search", components: { commonLawGrid: false },
  }));
  const saved = process.env.CLEAROTRON_RECIPES_DIR;
  process.env.CLEAROTRON_RECIPES_DIR = store;
  try {
    const p = planRun({ ...BASE, recipeKey: "usual" });
    assert.equal(p.wouldRun, false, "an unresolvable depth still blocks — the fix is silence, not permission");
    const blob = JSON.stringify(p);
    assert.doesNotMatch(blob, /celta/, "another customer's account key reached this client's assistant");
    assert.doesNotMatch(blob, /quarterly-sweep/, "another customer's saved-search slug leaked");
    assert.doesNotMatch(blob, /recipes\/[\w-]+\//, "a config-store path leaked");
    assert.doesNotMatch(blob, /\.(json|mjs)\b/, "a file path leaked — the shape a caught error carries");
    assert.doesNotMatch(blob, /jxLanes|commonLawGrid|registerProbe/, "the engine's component vocabulary leaked");
    assert.match(p.blockers.join(" "), /That search could not be resolved — name a product, or omit it to run the account's default\./);
  } finally {
    if (saved === undefined) delete process.env.CLEAROTRON_RECIPES_DIR; else process.env.CLEAROTRON_RECIPES_DIR = saved;
  }
});

test("a real saved search previews as RUNNABLE — the door has no shut state any more", () => {
  // This used to assert the opposite: a real recipe in a real store, with CLEAROTRON_RECIPES_MODE unset, was
  // refused with "Saved searches are not switched on for this account yet". A client's own saved search,
  // refused because a web service has no environment file. Retired 2026-07-27.
  const store = join(ROOT, "recipes-ok");
  mkdirSync(join(store, "aurora"), { recursive: true });
  writeFileSync(join(store, "aurora", "quarterly-screen.json"), JSON.stringify({
    // The base must be a product whose geography this ACCOUNT's own territories satisfy: aurora holds
    // seven, which is a Multi-country focus search. A Global preliminary base would resolve to those
    // seven and be refused — correctly, and for a reason that has nothing to do with saved searches.
    version: 1, label: "Quarterly product-name screen", base: "multi-country-focus-search", archived: false,
  }));
  const saved = process.env.CLEAROTRON_RECIPES_DIR;
  process.env.CLEAROTRON_RECIPES_DIR = store;
  try {
    const p = planRun({ ...BASE, recipeKey: "quarterly-screen" });
    assert.equal(p.wouldRun, true, "a saved search is honoured wherever it resolves");
    assert.equal(p.search.savedSearch?.key, "aurora/quarterly-screen", "and the preview names the search it resolved");
    const blob = JSON.stringify(p);
    assert.doesNotMatch(blob, /CLEAROTRON_/, "no environment variable name reaches a client's assistant");
    assert.doesNotMatch(blob, /Saved searches are not switched on/);
  } finally {
    if (saved === undefined) delete process.env.CLEAROTRON_RECIPES_DIR; else process.env.CLEAROTRON_RECIPES_DIR = saved;
  }
});

// ── audit item 3: plan_run answers the TRUE cause on a register that cannot count ──────────────────
test("a can't-count register blocks the Knockout search with the provider cause — never the release sentence", () => {
  // The describe-options fixture, at THIS door: the flag snapshot records the wired register cannot
  // count (signa, countProbe:'none') and folds built.registerProbe down. plan_run used to read only the
  // folded build map, so it told a client's assistant "Not part of the current release." — waiting for a
  // release that will never fix it — while describe_options answered the true cause from the same
  // snapshot. Same question, same answer, whichever door asked.
  const stateDir = join(ROOT, "pool", "_state");
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(join(stateDir, "prelim-flag-snapshot.json"), JSON.stringify({
    capturedAt: new Date().toISOString(), flags: {}, built: { registerProbe: false },
    register: { provider: "signa", canCount: false },
  }));
  try {
    const p = planRun({ ...BASE, product: "knockout-search" });
    assert.equal(p.wouldRun, false, "the search genuinely cannot run here");
    assert.match(p.blockers.join(" "),
      /The trademark register wired to this deployment cannot return filing counts, so this search cannot run here\./,
      "the provider cause — this is not a version problem, so waiting will not fix it");
    assert.doesNotMatch(p.blockers.join(" "), /Not part of the current release/,
      "the retired lie: it sent the reader to wait for a release that will never help");
    assert.doesNotMatch(JSON.stringify(p), /signa|countProbe|canCount/, "WHICH register is wired is staff knowledge");
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
});

// ── WHATEVER OFFERS AN OPTION MUST AGREE WITH WHATEVER ENFORCES IT ──────────────────────────────────
//
// The tool schema is what an agent reads before it sends anything, so a value the schema INVITES and the
// doors always REFUSE is a request somebody will make on our instructions. That is the shape of both of
// this round's defects: `deliveryRoute: "portal"` is a declared enum member with a refusal of its own,
// and `nativeLanguage` is declared a plain boolean while `false` is refused at five doors.
//
// So this is derived rather than listed. For every property the two faces offer, take the values its own
// declared TYPE invites — both booleans, every enum member — and put each through plan_run. A value the
// preview blocks on EVERY scope is refused by its nature rather than by this request's geography, and the
// property's DESCRIPTION has to say so. Testing on one scope would flag `product: "full-country-search"`,
// which is refused here only because aurora holds seven territories, and that is a scope answer, not an
// invitation defect.
const SCOPES = [
  { worldwide: true },
  { jurisdictions: ["United States"] },
  { jurisdictions: ["France", "Germany"] },
  { jurisdictions: ["European Union"] },
];

/** The values a JSON-schema property invites, from its own declaration. Strings without an enum invite
 *  an open set nobody can enumerate, so they are not judged here. */
function invitedValues(spec) {
  if (Array.isArray(spec?.enum)) return spec.enum;
  if (spec?.type === "boolean") return [true, false];
  return [];
}

test("no MCP property invites a value every door refuses without its description saying so", () => {
  const offenders = [];
  for (const verb of ["start_run", "plan_run"]) {
    const tool = TOOL_DEFS.find((t) => t.name === verb);
    assert.ok(tool, `${verb} is no longer an MCP tool — this assertion is measuring nothing`);
    for (const [prop, spec] of Object.entries(tool.inputSchema.properties)) {
      for (const value of invitedValues(spec)) {
        // Refused on EVERY scope ⇒ refused by what the value IS, not by where this request points.
        const blocked = SCOPES.map((scope) => {
          try { return planRun({ ...BASE, jurisdictions: undefined, ...scope, [prop]: value }); }
          catch (e) { return { wouldRun: false, blockers: [String(e?.message ?? e)] }; }
        });
        if (!blocked.every((b) => b.wouldRun === false)) continue;
        // The description has to name the refusal. Not a specific sentence — the point is that a reader
        // of the schema learns it before spending a call, however it is worded.
        const desc = String(spec.description ?? "");
        const says = /refus|not available|CLARIF|blocks?\b/i.test(desc) && new RegExp(String(value), "i").test(desc);
        if (!says) offenders.push(`${verb}.${prop} = ${JSON.stringify(value)} — always refused, and its description does not say so: ${JSON.stringify(desc.slice(0, 120))}`);
      }
    }
  }
  assert.deepEqual(offenders, [],
    "the schema invites a value the doors always refuse and does not warn. Say it in the description, or "
    + "narrow the declared type so the value cannot be offered — an invitation nothing honours is how "
    + "deliveryRoute:\"portal\" and nativeLanguage:false were both sent and both dropped.");
});

test("the two values this round closed are the ones that test bites on", () => {
  // The derivation above is only trustworthy if it can SEE these two. Both are refused on every scope,
  // so both are in its input set — asserted here so a change that quietly narrows the scope list, or
  // stops planRun refusing, shows up as this test rather than as a silently empty derivation.
  for (const scope of SCOPES) {
    assert.equal(planRun({ ...BASE, jurisdictions: undefined, ...scope, nativeLanguage: false }).wouldRun, false,
      `nativeLanguage:false must be refused on ${JSON.stringify(scope)}`);
    assert.equal(planRun({ ...BASE, jurisdictions: undefined, ...scope, deliveryRoute: "portal" }).wouldRun, false,
      `deliveryRoute:"portal" must be refused on ${JSON.stringify(scope)}`);
  }
  // …and a value that is legal stays legal, so the derivation is not just "everything is refused".
  assert.equal(planRun({ ...BASE, jurisdictions: ["United States"], deliveryRoute: "email" }).wouldRun, true);
});
