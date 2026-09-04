// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// describe-options.test.mjs — the MENU an external agent gets before it composes anything.
//
// What this has to prove, in order of what it would cost to get wrong:
//   1. NOTHING STAFF-FACING LEAVES. This output goes straight into a conversation with a client's
//      assistant. A kill-switch name, an env var, a module path — any of them teaches a client about our
//      plumbing and none of them is actionable. (The three admission kill switches were retired
//      2026-07-27 — the scan still names them, because a menu that starts printing them again is a
//      regression whether or not the constant still exists.)
//   2. IT AGREES WITH THE PORTAL. The three bundles are read out of the composer's own TEMPLATES file. A
//      menu that disagrees with what a client sees in the browser is worse than no menu.
//   3. THE DISCOVERY DEAD END IS ACTUALLY CLOSED. An omitted profileKey must be answerable (that is the
//      whole point — list_profiles is staff-only), while a NAMED one is grant-gated like anything else.
//   4. The allowance is the ledger's number, not a guess.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pinEnv } from "../../shared/env-aliases.mjs";   // — a fixture pins EVERY spelling

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = mkdtempSync(join(tmpdir(), "options-ws-"));
pinEnv(process.env, "CLEAROTRON_WORK_DIR", ROOT);
// The POOL root is pinned for the same reason the workspace root is: availability now reconciles `built`
// against the flag snapshot beside the pool, and unpinned that would be the real /srv/trademark-archive —
// a unit whose answers depend on the deployment's own snapshot (the CI trap this repo has been bitten by).
pinEnv(process.env, "CLEAROTRON_REPORTS_DIR", join(ROOT, "pool"));
// The retired switches are cleared so the assertions below prove what they claim: this process must look
// exactly like the ops-MCP, which has no EnvironmentFile. Every depth still has to be offered — that
// equivalence is the regression test for the bug that retired them.
for (const sw of ["CLEAROTRON_JX_LANES", "CLEAROTRON_KNOCKOUT_MODE", "CLEAROTRON_RECIPES_MODE"]) delete process.env[sw];

const { describeOptions } = await import("../lib/options.mjs");
// — the wall's default, read rather than restated. These arms are about the
// allowance being the LEDGER's number and the wall's own; a literal here pins the value instead, and
// went red on a ruled change to the number rather than on a defect.
const { DEFAULT_CLIENT_DAILY_RUNS } = await import("../../driver/usage-ledger.mjs");
const { authorize } = await import("../lib/scope.mjs");
const { ORDERABLE_PRODUCTS } = await import("../../driver/search-policy.mjs");
const { maxNamesFor, productSpec } = await import("../../driver/products.mjs");
// server.mjs is import-safe (its stdio bootstrap is guarded by an isMain check), so the REGISTRATION
// half of the wiring can be asserted rather than assumed — see the last section.
const { TOOL_DEFS, tools, presentForPrincipal } = await import("../server.mjs");
const { TOOL_SCOPES } = await import("../lib/scope.mjs");

const CLIENT = { kind: "account", runId: null, sub: "lawyer@aurora.example", accounts: ["aurora"] };

// ---- 1. the leak scan ---------------------------------------------------------------------------

test("NOTHING staff-facing reaches a client's assistant — the whole response is scanned", () => {
  // every principal shape, so no branch escapes the scan
  for (const scope of [CLIENT, { kind: "account", accounts: ["aurora", "zephyr"], sub: "l@x.example" },
    { kind: "ops", accounts: "*", sub: "local" }, { kind: "internal", accounts: "*", sub: "staff@firm.example" }]) {
    const blob = JSON.stringify(describeOptions({}, { scope }));
    assert.doesNotMatch(blob, /(CLEAROTRON|PORTAL|CF_ACCESS|MCP)_[A-Z_]+/,
      "an environment-variable name reached the menu a client's assistant reads aloud");
    assert.doesNotMatch(blob, /[\w./-]+\.mjs/, "a module path leaked — most likely a caught error message");
    // The three retired kill switches by name. KILL_SWITCHES used to be imported for this; the export went
    // with the switches, so the names are written out — a menu that starts naming them again is a
    // regression whether or not the constant still exists.
    for (const sw of ["CLEAROTRON_KNOCKOUT_MODE", "CLEAROTRON_JX_LANES", "CLEAROTRON_RECIPES_MODE"]) {
      assert.ok(!blob.includes(sw), `${sw} named in the client-facing menu`);
    }
  }
});

test("THE REGRESSION: every BUILT search is offered, from a process with no engine environment", () => {
  // This test used to assert the opposite — that knockout and prelim-jx came back `available: false` with
  // the note "Not switched on for this account yet — Cordillera can enable it." It passed, and it was
  // asserting the bug: this process has no EnvironmentFile, the kill switches read as unset, unset was
  // indistinguishable from off, and so `describe_options` told clients three SHIPPED products could not
  // be ordered. The switches were retired 2026-07-27 and availability is now the build alone.
  const by = Object.fromEntries(describeOptions({}, { scope: CLIENT }).products.map((l) => [l.key, l]));
  for (const key of ORDERABLE_PRODUCTS) {
    assert.equal(by[key].available, true, `${key} is built and must be offered — no environment required`);
    assert.equal(by[key].unavailableNote, null, `${key}: an available product carries no note`);
  }
  // And the sentence that carried the lie is gone from the response entirely.
  const blob = JSON.stringify(describeOptions({}, { scope: CLIENT }));
  assert.doesNotMatch(blob, /Not switched on for this account yet/,
    "the menu still claims something is waiting to be switched on");
});

// ---- 2. shape: the offering, and nothing beside it ----------------------------------------------

test("products: the closed offering, in offering order, each in words a requester can act on", () => {
  const products = describeOptions({}, { scope: CLIENT }).products;
  assert.deepEqual(products.map((l) => l.key), [...ORDERABLE_PRODUCTS],
    "offering order, so the menu reads lightest first");
  for (const l of products) {
    assert.ok(l.headline && l.headline.length > 20, `${l.key}: a product shipped with no plain-words headline`);
    assert.ok(l.name, `${l.key}: no client-facing name to lead with`);
    // EVERY FIGURE COMPUTED. A menu that states a number the wall does not enforce is the
    // invitation/enforcement mismatch said out loud to a client.
    assert.equal(l.maxNames, maxNamesFor(l.key), `${l.key}: the name count must be the offering's own`);
    assert.equal(l.geography, productSpec(l.key).geography, `${l.key}: the geography must be the offering's own`);
    assert.ok(l.baseTurnaround, `${l.key}: no turnaround to relay`);
    // the machinery's names for itself are not the product's names
    assert.doesNotMatch(JSON.stringify(l), /jxLanes|commonLawGrid|registerProbe/, `${l.key}: engineering vocabulary in the menu`);
    // and neither is our own retired ladder
    assert.doesNotMatch(JSON.stringify(l), /Depth \d|prelim-jx|knockout-register/, `${l.key}: a retired rung in the menu`);
  }
});

test("THE BUNDLES ARE GONE — there is one menu, and it is the offering", () => {
  // There were three hand-written shortcuts here (`knockout` / `global-prelim` / `deep-dive`), each
  // naming a product — "Full deep dive" — that appeared in no registry, on no report and on no wire.
  // That is what a bundle IS when the wire cannot carry the product: a second menu, invented to say the
  // thing the first one could not. A whole test used to exist to keep it in step, by eye, with three
  // TEMPLATES in the browser's own source. The wire carries the product now.
  const out = describeOptions({}, { scope: CLIENT });
  assert.equal(out.bundles, undefined, "a second menu is a second thing to drift");
  assert.ok(Array.isArray(out.products) && out.products.length === 4);
  // AND THE BROWSER READS THE SAME LIST. Not a mirror kept in step by a test — the same server row.
  const src = readFileSync(join(HERE, "..", "..", "portal-ui", "src", "contract", "composerProduct.ts"), "utf8");
  assert.doesNotMatch(src, /export const TEMPLATES/, "the composer's own hand-written bundles are gone too");
  const screen = readFileSync(join(HERE, "..", "..", "portal-ui", "src", "screens", "NewClearance.tsx"), "utf8");
  assert.match(screen, /\{levels\.map\(\(t\) => \(\s*<PickRow/,
    "the picker is built from the fetched offering, so there is nothing left to keep in step");
});

test("the ONE-territory product states its rule where an agent will read it", () => {
  // The deep-dive BUNDLE used to carry `argsIncomplete`: a long note saying jurisdictions was
  // deliberately not defaulted, because a baked-in country would silently order a US deep dive for a
  // client who meant Germany. That reasoning was right and is structural now — the product states the
  // geography it accepts, and the same sentence refuses at every door.
  const full = describeOptions({}, { scope: CLIENT }).products.find((p) => p.key === "full-country-search");
  assert.equal(full.geography, "exactly one country");
  assert.match(full.caseLaw, /part of this search/);
  assert.match(full.nativeLanguage, /runs automatically/i);
  const knock = describeOptions({}, { scope: CLIENT }).products.find((p) => p.key === "knockout-search");
  assert.equal(knock.caseLaw, null, "a quick screen reads no case law, and says nothing about a lever");
  assert.equal(knock.maxNames, 8, "the offering's figure — not the registry's retired 20");
});

test("availability is read from the flag SNAPSHOT's build map, exactly as the portal reads it", () => {
  // The portal computes availability as productAvailability(policy, { built: builtFor(
  // readFlagSnapshot(poolRoot)) }). The Knockout search carries the register count probe and not every
  // wired register can count, so the snapshot reconciles built.registerProbe down — and a menu reading
  // the bare BUILT map would tell a client's assistant that search is available while the client's own
  // browser said it is not.
  const stateDir = join(ROOT, "pool", "_state");
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(join(stateDir, "prelim-flag-snapshot.json"), JSON.stringify({
    capturedAt: new Date().toISOString(), flags: {}, built: { registerProbe: false },
    register: { provider: "signa", canCount: false },
  }));
  try {
    const out = describeOptions({}, { scope: CLIENT });
    const lvl = out.products.find((l) => l.key === "knockout-search");
    assert.equal(lvl.available, false, "the register in use cannot count — the portal says so and the menu must too");
    // THE FIX, and this fixture is what made the bug visible: it sets canCount false — the register in
    // use cannot count — and used to assert "Not part of the current release." That sentence sends the
    // reader to wait for a version that will never help, when the fix is a different register. The two
    // causes are split now, and the sentence names no vendor.
    assert.equal(lvl.unavailableNote,
      "The trademark register wired to this deployment cannot return filing counts, so this search cannot run here.",
      "the portal's exact note — the provider cause, not the release cause");
    assert.doesNotMatch(JSON.stringify(out), /signa|corsearch|clarivate/i, "no vendor name reaches a client");
    assert.doesNotMatch(JSON.stringify(out), /signa|countProbe|canCount/, "WHICH register is wired is staff knowledge");
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
  }
});

test("scopeRules say the things a server would otherwise refuse one at a time", () => {
  const r = describeOptions({}, { scope: CLIENT }).scopeRules;
  assert.match(r.jurisdictions, /never send "Worldwide" as a list entry/i);
  assert.match(r.jurisdictions, /Max 20/);
  // THE TWO STATES THAT USED TO BE ONE. "everywhere" and "I said nothing about geography" resolve
  // differently — the second falls through to the account's own territories — and until the geography
  // stamp existed they were the same bytes on this wire. An agent that cannot tell a requester which
  // one they are sending is an agent that sells a worldwide search and delivers seven countries.
  assert.match(r.jurisdictions, /geography \{"mode":"worldwide"\}/);
  assert.match(r.jurisdictions, /Omitting jurisdictions is NOT the same thing/);
  // the routing territories, from the shared vocabulary rather than typed out twice
  for (const name of ["China (CN)", "Hong Kong (HK)", "Taiwan (TW)", "Macau (MO)", "Japan (JP)", "South Korea (KR)"])
    assert.ok(r.nativeScript.includes(name), `${name} missing from the routing list`);
  // CASE LAW IS NOT A FIELD, and the rule says so rather than describing how to send one.
  assert.match(r.caseLaw, /NOT A FIELD/);
  assert.match(r.caseLaw, /Full country search/);
  assert.match(r.platforms, /ADDED to the account's own marketplaces/);
  assert.match(r.platforms, /Max 10/);
  assert.match(r.classes, /1–45/);
  // The name count is COMPUTED from the offering, per product — never a sentence that says 20 while a
  // wall refuses at 8.
  assert.match(r.marks, /Knockout search: 8/);
  assert.match(r.marks, /never silently truncated/);
});

test("_note frames it as a menu, and names the two calls that follow", () => {
  const out = describeOptions({}, { scope: CLIENT });
  assert.match(out._note, /Nothing here reserves, spends or starts anything/);
  assert.match(out._note, /plan_run \(free\)/);
  assert.match(out._note, /start_run with the SAME arguments/);
});

// ---- 3. the discovery dead end ------------------------------------------------------------------

test("an OMITTED profileKey is legal and answers from the session's own grant", () => {
  // This is the fix. An accounts-scoped session MUST pass profileKey to plan_run/start_run and cannot
  // call list_profiles to learn one — so a describe_options that demanded the key would re-open the
  // exact dead end it exists to close.
  assert.doesNotThrow(() => authorize(CLIENT, "describe_options", {}));
  const out = describeOptions({}, { scope: CLIENT });
  assert.equal(out.account.profileKey, "aurora");
  assert.equal(out.account.name, "Aurora Interactive");
});

test("a session holding SEVERAL accounts and naming none is given the list, not a guess", () => {
  const multi = { kind: "account", accounts: ["aurora", "zephyr"], sub: "l@vendor.example" };
  const out = describeOptions({}, { scope: multi });
  assert.equal(out.account, null, "guessing which of two accounts they meant would be worse than asking");
  assert.deepEqual(out.accountsGranted.map((a) => a.profileKey), ["aurora", "zephyr"]);
  assert.ok(out.accountsGranted.every((a) => a.name), "the keys alone are not a question a user can answer");
  // …and naming one resolves it
  assert.equal(describeOptions({ profileKey: "zephyr" }, { scope: multi }).account.profileKey, "zephyr");
});

test("a NAMED account is grant-gated exactly like plan_run/start_run", () => {
  assert.throws(() => authorize(CLIENT, "describe_options", { profileKey: "zephyr" }),
    /grant \[aurora\] does not include account "zephyr"/);
  const opsScoped = { kind: "ops", accounts: ["aurora"], sub: "connector" };
  assert.throws(() => authorize(opsScoped, "describe_options", { profileKey: "celta" }), /does not include account "celta"/);
  assert.doesNotThrow(() => authorize(opsScoped, "describe_options", {}), "the ops branch keeps the same omission rule");
});

test("a session with no account of its own is told so, rather than shown someone else's", () => {
  const ops = describeOptions({}, { scope: { kind: "ops", accounts: "*", sub: "local" } });
  assert.equal(ops.account, null);
  assert.equal(ops.accountsGranted, undefined, "a full grant is not a list of accounts to offer");
  assert.match(ops.accountNote, /Pass profileKey/);
  // the neutral profile is not an account
  assert.equal(describeOptions({ profileKey: "generic" }, { scope: { kind: "ops", accounts: "*" } }).account, null);
});

test("saved searches: an account with none gets an empty list and NO note", () => {
  // This used to assert a SHUT door: CLEAROTRON_RECIPES_MODE off ⇒ empty list plus "Saved searches are not
  // switched on for this account yet". That switch was retired 2026-07-27, so there is no shut state and
  // no note — and "you have none saved" must not be dressed up as "the feature is off", which is a
  // different fact and the only one of the two a client could act on.
  const out = describeOptions({}, { scope: CLIENT });
  assert.deepEqual(out.account.savedSearches, []);
  assert.equal(out.account.savedSearchesNote, null, "nothing is switched off, so nothing is claimed to be");
});

// ---- 4. the allowance ---------------------------------------------------------------------------

test("the allowance is the LEDGER's number — the same one the admission wall counts", () => {
  const studio = join(ROOT, "workspace-clawdi", "studio", "prelim-search");
  mkdirSync(studio, { recursive: true });
  const now = Date.now();
  writeFileSync(join(studio, ".matter-ledger.jsonl"), [
    { profileKey: "aurora", ts: now, clientPrincipal: true },
    { profileKey: "aurora", ts: now, clientPrincipal: true, failed: true },   // a failure does not spend the day
    { profileKey: "zephyr", ts: now, clientPrincipal: true },                 // another account's row
  ].map((r) => JSON.stringify(r)).join("\n") + "\n");
  const a = describeOptions({}, { scope: CLIENT, now }).account.allowance;
  assert.equal(a.dailyRuns, DEFAULT_CLIENT_DAILY_RUNS, "aurora sets no runCaps — the wall's own default");
  assert.equal(a.usedToday, 1, "the failed row was counted against the client's day");
  assert.equal(a.remainingToday, DEFAULT_CLIENT_DAILY_RUNS - 1);
  assert.equal(a.usedThisMonth, 2, "a failed run still spent, and the monthly figure says so");
  assert.equal(a.capped, true);
  assert.match(a.note, /resets at midnight UTC/);
  // STAFF are not capped, and are told that rather than shown a limit that does not bind them
  assert.equal(describeOptions({ profileKey: "aurora" }, { scope: { kind: "ops", accounts: "*" }, now }).account.allowance.capped, false);
});

test("a ledger the menu could not read reports NO FIGURES and says so — never a full day (#429)", () => {
  // "A ledger that cannot be read yields no allowance rather than a fabricated one" is what allowanceFor
  // has always said it does. A wrong ledger path does not throw — it counts zero — so before this the
  // menu answered "2 of 2 remaining" to every client of a deployment whose queue had moved.
  //
  // AND IT MUST NOT ANSWER `null` EITHER. null here is "no allowance applies" (staff, generic, no
  // profile); an assistant handed that about a capped account is told it is uncapped, which is the same
  // lie wearing the other shape. The blind answer is its own block: complete:false, figures absent
  // rather than zero, the limit still named, and a sentence the assistant can relay.
  const blind = mkdtempSync(join(tmpdir(), "options-blind-"));
  const saved = process.env.CLEAROTRON_WORK_DIR, savedQ = process.env.CLEAROTRON_QUEUE_DIR;
  pinEnv(process.env, "CLEAROTRON_WORK_DIR", blind);   // no queue, no ledger, nothing to count
  pinEnv(process.env, "CLEAROTRON_QUEUE_DIR", undefined);         // …and nothing ambient to count from either
  try {
    const a = describeOptions({}, { scope: CLIENT, now: Date.now() }).account.allowance;
    assert.ok(a, "blind answered `null`, which an assistant reads as \"no allowance applies\"");
    assert.equal(a.complete, false, "a full allowance was offered off a ledger nobody read");
    assert.equal(a.usedToday, null, "a count nobody took went out as a number");
    assert.equal(a.remainingToday, null);
    assert.equal(a.usedThisMonth, null);
    // The limit is the WALL'S DEFAULT here, not the profile's — aurora sets no runCaps. (The note this
    // line used to carry said "came off the profile", which was never true of this fixture.) The point
    // stands either way: an unreadable ledger loses the COUNTS and keeps the LIMIT, because the limit is
    // known without reading anything.
    assert.equal(a.dailyRuns, DEFAULT_CLIENT_DAILY_RUNS, "the LIMIT is knowable without the ledger and is still a fact");
    assert.equal(a.capped, true);
    assert.match(a.note, /could not be read/, "the one thing an assistant reliably relays is the sentence");
  } finally {
    pinEnv(process.env, "CLEAROTRON_WORK_DIR", saved);
    pinEnv(process.env, "CLEAROTRON_QUEUE_DIR", savedQ);
  }
});

test("a ledger that WAS read says complete:true beside its figures", () => {
  // The control for the test above: the same field, on the same shape, when the count is real. Without
  // it `complete:false` could be constant and every assertion up there would still pass.
  const studio = join(ROOT, "workspace-clawdi", "studio", "prelim-search");
  mkdirSync(studio, { recursive: true });
  const now = Date.now();
  writeFileSync(join(studio, ".matter-ledger.jsonl"),
    JSON.stringify({ profileKey: "aurora", ts: now, clientPrincipal: true }) + "\n");
  const a = describeOptions({}, { scope: CLIENT, now }).account.allowance;
  assert.equal(a.complete, true);
  assert.equal(a.usedToday, 1);
});

// ---- 5. it is actually REACHABLE ------------------------------------------------------------------

test("describe_options is REGISTERED — a TOOL_SCOPES entry is not a tool a connector can call", () => {
  // Everything above this line keys on TOOL_SCOPES, and so do account-principal.test.mjs, packs.test.mjs
  // and connector-guidance.test.mjs. No test in the repo read TOOL_DEFS or the impl map — so dropping the
  // entry from that 4KB single-line array (a high-conflict site, and PR-3 is queued behind this) or
  // dropping the impl would leave the whole suite green while every connecting agent got a tool list
  // without it, and the account pack that now LEADS with it taught them to call a tool that is not there.
  assert.ok(TOOL_DEFS.some((d) => d.name === "describe_options"),
    "declared in TOOL_SCOPES and absent from the tool list — the classic half-wired failure");
  assert.equal(typeof tools.describe_options, "function", "listed but not dispatchable");
});

test("the tool registry is COMPLETE in all FOUR directions", () => {
  // The generic form of the above, so the next tool cannot ship half-wired either: a name in the list
  // with no implementation is a runtime "unknown tool"; an implementation with no authorize() rule
  // defaults to whatever the kind branches happen to do, which is not a decision anyone made.
  //
  // (It asserted four and said three. Corrected while added the fifth.)
  const defs = TOOL_DEFS.map((d) => d.name);
  assert.deepEqual(defs.filter((n) => typeof tools[n] !== "function"), [], "advertised with no implementation");
  assert.deepEqual(defs.filter((n) => !(n in TOOL_SCOPES)), [], "dispatchable with no authorization rule");
  assert.deepEqual(Object.keys(TOOL_SCOPES).filter((n) => !defs.includes(n)), [], "authorized but never advertised");
  assert.deepEqual(Object.keys(tools).filter((n) => !defs.includes(n)), [], "implemented but never advertised");
});

test("#305: every client-reachable tool DECLARES how its result is presented", () => {
  // The fifth direction, and the one whose absence was a live default-allow: presentForPrincipal
  // dispatched by name and fell through to `return result`. The declaration is now required and an
  // undeclared tool refuses at the chokepoint — this
  // is what stops one shipping at all.
  const PRESENTATIONS = new Set(["scrub", "bounded", "project", "passthrough"]);
  const reachable = Object.entries(TOOL_SCOPES).filter(([, v]) => v.clientSafe || v.accountSafe);
  assert.ok(reachable.length >= 10, `the reachable set looks wrong: ${reachable.length}`);

  assert.deepEqual(
    reachable.filter(([, v]) => !PRESENTATIONS.has(v.present)).map(([n]) => n),
    [],
    "a client principal can reach this tool and nothing says what it may see",
  );
  // The reverse, so the table cannot rot into declarations for tools no client can reach.
  assert.deepEqual(
    Object.entries(TOOL_SCOPES).filter(([, v]) => v.present && !(v.clientSafe || v.accountSafe)).map(([n]) => n),
    [],
    "a presentation is declared for a tool no client principal can reach",
  );
});

test("#305: an UNDECLARED tool is refused, loudly, and only for a client principal", () => {
  // Refuse rather than return empty, which is the choice the issue asks to be made: a client handed an
  // empty list believes it, and the failure is silent. A throw reaches the caller as an error and the
  // operator as a log line.
  const asClient = { kind: "account", accounts: ["celta"] };
  assert.throws(() => presentForPrincipal(asClient, "a_tool_nobody_declared", { text: "secret" }), /no declared client presentation/);
  assert.throws(() => presentForPrincipal({ kind: "user" }, "a_tool_nobody_declared", { text: "secret" }), /no declared client presentation/);

  // Staff and ops are untouched — they read the internal cut, and that asymmetry is deliberate.
  for (const scope of [{ kind: "ops", accounts: "*" }, { kind: "internal", accounts: "*" }]) {
    assert.deepEqual(presentForPrincipal(scope, "a_tool_nobody_declared", { text: "secret" }), { text: "secret" });
  }
});

test("#305: a declared tool keeps EXACTLY the behaviour it had — this flip changes no client's bytes", () => {
  // Every disposition written down is the tool's existing behaviour. The change alters what happens to
  // the NEXT tool somebody adds, not what any client receives today.
  const asClient = { kind: "account", accounts: ["celta"] };
  // passthrough: returned as-is, as before
  const plan = { depth: "prelim", caps: { runsToday: 1 } };
  assert.deepEqual(presentForPrincipal(asClient, "plan_run", plan), plan);
  assert.deepEqual(presentForPrincipal(asClient, "describe_options", plan), plan);
  // bounded: returned as-is, as before — the projection happens at the tool
  const ev = { items: [{ kind: "register", uri: "x" }] };
  assert.deepEqual(presentForPrincipal(asClient, "list_evidence", ev), ev);
  // scrub: still transformed
  const brief = presentForPrincipal(asClient, "brief", { brief: "a line\n- [internal] not for them" });
  assert.ok(!/internal/.test(brief.brief), "the scrub branches still run");
});

test("#305: the dead search_runs branch is gone — it could never fire", () => {
  // search_runs is neither clientSafe nor accountSafe, so authorize() refuses it for both CLIENT_KINDS
  // before dispatch reaches the chokepoint. A dead branch inside a security chokepoint reads as coverage
  // that is not there. If it ever becomes client-reachable, the declaration requirement refuses it until
  // somebody decides what it should show.
  assert.ok(!TOOL_SCOPES.search_runs.clientSafe && !TOOL_SCOPES.search_runs.accountSafe);
  assert.equal(TOOL_SCOPES.search_runs.present, undefined, "and it declares nothing, because it needs nothing");
  assert.throws(() => presentForPrincipal({ kind: "account", accounts: ["celta"] }, "search_runs", []), /no declared client presentation/);
});
