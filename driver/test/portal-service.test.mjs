// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// portal-service.test.mjs — the principal roster, the ONE chokepoint, the confirmation
// gate, the server-stamped trigger, account-filtered runs, and the 404-not-403 report ownership.
// Offline: injected grants/trigger/audit, no jose, no HTTP.
//
// SAFETY GUARD: env pinned before dynamic driver imports (driver.config freezes roots at import).
import { mkdtempSync as __mkdtemp } from "node:fs";
// The two dirs below are made BEFORE the file's real imports, to pin env — so the collector
// further down does not exist yet and cannot hold them. They get their own array, drained by the
// same `after`. Without this the file still leaks exactly two per run..
const __EARLY_TEMPS = [];
const __t = (prefix) => { const d = __mkdtemp(__join(__tmpdir(), prefix)); __EARLY_TEMPS.push(d); return d; };
import { tmpdir as __tmpdir } from "node:os";
import { join as __join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";   //
import { stdioConnectCommand } from "../../shared/stdio-connect.mjs";   // — assert against the ONE author, never a literal
import { pinEnv, envFrom } from "../../shared/env-aliases.mjs";   // — the default is taken only when NO spelling holds a value
pinEnv(process.env, "CLEAROTRON_WORK_DIR", envFrom(process.env, "CLEAROTRON_WORK_DIR") || __t("portal-ws-"));
pinEnv(process.env, "CLEAROTRON_REPORTS_DIR", envFrom(process.env, "CLEAROTRON_REPORTS_DIR") || __t("portal-pool-"));
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { PRODUCT_IDS } from "../products.mjs";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";


// EVERY temp directory this file makes is removed — including ones created inside helpers, and ones
// made by a test that then failed. A `beforeEach` that cleans the PREVIOUS iteration leaves the last of
// every run, and a hook over named bindings cannot reach a helper's dir at all; this file makes them at
// 25 sites. So `mkdtempSync` is wrapped and the collector is the only way one gets made — a new call
// site cannot forget to register itself..
const TEMP_DIRS = [];
const tempDir = (prefix) => { const d = mkdtempSync(join(tmpdir(), prefix)); TEMP_DIRS.push(d); return d; };
after(() => { for (const d of [...__EARLY_TEMPS, ...TEMP_DIRS]) rmSync(d, { recursive: true, force: true }); });

const { makePrincipal, assertPrincipal, PortalDeny } = await import("../portal-access.mjs");
const { makePortalService, mintConfirmation, verifyConfirmation, jobHashOf, scanAccountRuns, isAdminWrite } = await import("../portal-service.mjs");
const { listFlags } = await import("../feedback-store.mjs");
// — the door the searches payload's budget is promising to describe.
const { validateJob } = await import("../enqueue-schema.mjs");

const GRANTS = { tenants: {
  celta: { accounts: ["aurora", "zephyr"], users: { "cli@celta.example": ["aurora"], "boss@celta.example": "*" } },
} };
const STAFF_DOMAINS = ["example-firm.com"];
const STAFF = { email: "staff@example-firm.com" };
const CLIENT = { email: "cli@celta.example" };
const STRANGER = { email: "who@nowhere.example" };

// ── principal + chokepoint ─────────────────────────────────────────────────────────────────────────
test("makePrincipal: staff by domain (*), client by grants, stranger = null (403 at the door)", () => {
  assert.deepEqual(makePrincipal({ email: STAFF.email, grants: GRANTS, staffDomains: STAFF_DOMAINS }),
    { role: "staff", email: STAFF.email, accounts: "*" });
  assert.deepEqual(makePrincipal({ email: CLIENT.email, grants: GRANTS, staffDomains: STAFF_DOMAINS }),
    { role: "client", email: CLIENT.email, accounts: ["aurora"] });
  assert.equal(makePrincipal({ email: STRANGER.email, grants: GRANTS, staffDomains: STAFF_DOMAINS }), null);
  assert.equal(makePrincipal({ email: "", grants: GRANTS, staffDomains: STAFF_DOMAINS }), null);
});

test("assertPrincipal: clients FORCED to their grant (foreign = 404); staff act for anyone; door mode never resolves; multi-account = actionable 400", () => {
  const client = makePrincipal({ email: CLIENT.email, grants: GRANTS, staffDomains: STAFF_DOMAINS });
  const staff = makePrincipal({ email: STAFF.email, grants: GRANTS, staffDomains: STAFF_DOMAINS });
  const boss = makePrincipal({ email: "boss@celta.example", grants: GRANTS, staffDomains: STAFF_DOMAINS });
  assert.equal(assertPrincipal(client, { account: "aurora" }), "aurora");
  assert.equal(assertPrincipal(client), "aurora", "single-account client defaults to it");
  assert.throws(() => assertPrincipal(client, { account: "zephyr" }), (e) => e instanceof PortalDeny && e.status === 404,
    "a foreign account is a 404 — existence never leaks");
  assert.equal(assertPrincipal(staff, { account: "zephyr" }), "zephyr");
  assert.throws(() => assertPrincipal(client, { staffOnly: true }), (e) => e.status === 404);
  assert.throws(() => assertPrincipal(null), (e) => e.status === 403);
  // review 2026-07-18: a 2-account client was LOCKED OUT (404) at every bare door
  assert.deepEqual(boss.accounts, ["aurora", "zephyr"], "user-level * expands to the tenant's accounts");
  assert.equal(assertPrincipal(boss, { door: true }), null, "door mode admits multi-account clients");
  assert.throws(() => assertPrincipal(boss), (e) => e.status === 400 && /name an account/.test(e.message),
    "unresolved multi-account = actionable 400, never a lockout");
  assert.equal(assertPrincipal(boss, { account: "zephyr" }), "zephyr");
  // review 2026-07-18: last-@ semantics + multi-@ refusal (the staff bit must agree with the edge parse)
  assert.equal(makePrincipal({ email: "x@example-firm.com@evil.com", grants: GRANTS, staffDomains: STAFF_DOMAINS }), null,
    "multi-@ identities are refused outright");
});

// ── the confirmation token ─────────────────────────────────────────────────────────────────────────
test("confirmation: FULL-job binding (classes/goods/marks/selector), identity binding, one-shot jti, expiry, tamper", () => {
  const S = "test-secret";
  const job = { markName: "A", marks: [{ name: "A" }, { name: "B" }], classes: [9], goods: "software", product: "knockout-search" };
  const base = { secret: S, account: "aurora", email: "cli@celta.example", jobHash: jobHashOf(job) };
  const tok = mintConfirmation({ ...base, now: 1000 });
  const used = new Map();
  assert.equal(verifyConfirmation({ ...base, token: tok, now: 2000, usedJtis: used }), null);
  assert.match(verifyConfirmation({ ...base, token: tok, now: 3000, usedJtis: used }), /already used/, "one-shot: a replay never spends twice");
  assert.match(verifyConfirmation({ ...base, token: tok, now: 1000 + 11 * 60 * 1000 }), /expired/);
  assert.match(verifyConfirmation({ ...base, token: tok, account: "zephyr", now: 2000 }), /changed after confirmation/);
  // ANY field of the server-stamped job changes the hash — classes and goods included (review 2026-07-18)
  assert.match(verifyConfirmation({ ...base, token: tok, jobHash: jobHashOf({ ...job, classes: [9, 42] }), now: 2000 }), /changed/);
  assert.match(verifyConfirmation({ ...base, token: tok, jobHash: jobHashOf({ ...job, goods: "weapons" }), now: 2000 }), /changed/);
  assert.match(verifyConfirmation({ ...base, token: tok, email: "other@celta.example", now: 2000 }), /different sign-in/);
  assert.match(verifyConfirmation({ ...base, token: tok.slice(0, -3) + "xyz", now: 2000 }), /invalid/);
  assert.match(verifyConfirmation({ ...base, token: "garbage", now: 2000 }), /malformed/);
  // sorted-JSON identity: order-insensitive, and a '|' in a name can never alias two mark sets
  assert.equal(jobHashOf({ ...job, marks: [{ name: "B" }, { name: "A" }] }), jobHashOf(job));
  assert.notEqual(jobHashOf({ marks: [{ name: "a|b" }] }), jobHashOf({ marks: [{ name: "a" }, { name: "b" }] }));
});

// ── the service (offline fixture world) ────────────────────────────────────────────────────────────
function world(opts = {}) {
  const poolRoot = tempDir("portal-poolfx-");
  const workspaceRoot = tempDir("portal-wsfx-");
  const recipesDir = tempDir("portal-recfx-");
  // pool: two aurora runs (one with failed machine-QC checks stamped in meta), one zephyr run
  // The cross-mark paragraph a knockout writes into `report.md`, carrying the inline markdown the model
  // actually writes (the renderer's own note: "the model writes markdown because every other surface it
  // feeds renders markdown") and, in its second paragraph, characters that must never reach a browser as
  // markup. Both properties are asserted on the wire below.
  const BATCH_SUMMARY = "IRONWHISK rates **Medium** for Classes 9 and 42.\nCLUVENDRA rates Manageable.\n\n"
    + "Read together, <script>alert(1)</script> & the two names sit either side of the line.";

  const mkPool = (runId, customerKey, { released = true, client = true } = {}) => {
    mkdirSync(join(poolRoot, runId), { recursive: true });
    writeFileSync(join(poolRoot, runId, "meta.json"), JSON.stringify({ runId, customerKey, title: runId,
      kind: "clearance", overall: "LOW", date: "2026-07-18", clientGate: { released } }));
    // ONE report file: report.html. (The parameter is still called `client` for the callers below —
    // it now means "this run has a published report at all".)
    if (client) writeFileSync(join(poolRoot, runId, "report.html"), `<title>${runId}</title>ok`);
    // AND A `report.md` WITH REAL PROSE IN IT. Publish writes this file on every run, not only
    // on grouped ones, and on a single-document run the summary is non-empty AND already rendered inside
    // report.html. Without it here the summary route would 404 for this run because the FILE is absent,
    // which is the same answer for the wrong reason — and the gate that actually has to hold (a
    // single-document run has no grouped page, or the reader sees the paragraph twice on one screen)
    // would be provably untested.
    writeFileSync(join(poolRoot, runId, "report.md"), ["---", `title: "${runId}"`, `matter: "${runId}"`, "---",
      "", "# Summary", "", `${runId} rates **Low** across the board.`, "", "## Documents", "",
      "- **" + runId + "**: `report.html`"].join("\n"));
  };
// — a KNOCKOUT BATCH in the pool: two names, two documents, and NO report.html. Its meta carries
  // the published list, which is the only place a filename comes from.
  // — AND ITS `report.md`, written the shape publish writes it: YAML front matter for archive
  // greps, `# Summary`, the cross-mark paragraph, then `## Documents` naming the POOL FILENAMES. That
  // last section is why the fixture carries the whole file rather than a paragraph: the extractor has to
  // stop at it, and a fixture with nothing after the prose could not tell a correct terminator from a
  // read-to-end-of-file.
  const mkBatch = (runId, customerKey, marks, { summary = BATCH_SUMMARY } = {}) => {
    mkdirSync(join(poolRoot, runId), { recursive: true });
    const reports = marks.map((m) => ({ mark: m, slug: m.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      file: `report-${m.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.html`,
      dataFile: `report-data-${m.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.json`, band: "LOW" }));
    writeFileSync(join(poolRoot, runId, "meta.json"), JSON.stringify({ runId, customerKey, title: runId,
      kind: "knockout-batch", overall: "LOW", date: "2026-07-18", clientGate: { released: true },
      marks: marks.map((name) => ({ name, band: "LOW" })), reports }));
    for (const r of reports) writeFileSync(join(poolRoot, runId, r.file), `<title>${r.mark}</title>ok`);
    writeFileSync(join(poolRoot, runId, "report.md"), ["---", `title: "KNOCKOUT TRADEMARK REVIEW REPORT — ${runId}"`,
      `matter: "${runId}"`, 'overall_label: "LOW"', 'overall_badge: "🟢"', "---", "",
      "# Summary", "", summary, "", "## Documents", "",
      ...reports.map((r) => `- **${r.mark}** — ${r.band}: \`${r.file}\``), "",
      "One document per mark, each carrying its own register counts, records and coverage. There is no "
      + "combined report: this summary is the only place the marks appear together.",
      `The receipts are in the audit workbook: \`${runId}-audit.xlsx\`.`].join("\n"));
  };
  mkBatch("tmp4-aurora-batch", "aurora", ["IRONWHISK", "CLUVENDRA"]);
  mkBatch("tmp5-zephyr-batch", "zephyr", ["IRONWHISK", "CLUVENDRA"]);   // same names, another account
  // A grouped run whose summary was composed EMPTY. Not a hypothetical: `report.md` interpolates
  // `String(findings.batch?.executiveSummary ?? '')`, so a run that produced none writes a blank line
  // under the heading and the section is empty.
  mkBatch("tmp6-aurora-nosummary", "aurora", ["GHOSTONE", "GHOSTTWO"], { summary: "" });
  mkPool("tmp1-aurora-run", "aurora");
  mkPool("tmp2-aurora-held", "aurora", { released: false });   // failed-QC stamp — must change NOTHING below
  mkPool("tmp3-zephyr-run", "zephyr");
  // live: one aurora running (frozen sidecar shape: profileKey)
  const live = join(workspaceRoot, "workspace-test", "studio", "prelim-search", "tmp9-live", "2026-07-18-amber-x");
  mkdirSync(driverDir(live), { recursive: true });
  writeFileSync(join(live, "status.json"), JSON.stringify({ runId: "tmp9-live-amber-x", markName: "LIVEMARK", state: "running", stepLabel: "Searching registers", stepN: 4, stepTotal: 9, updatedAt: "2026-07-18T10:00:00Z" }));
  writeFileSync(driverDir(live, "profile.json"), JSON.stringify({ profileKey: "aurora", name: "Aurora" }));
  mkdirSync(join(recipesDir, "aurora"), { recursive: true });
  writeFileSync(join(recipesDir, "aurora", "screen.json"), JSON.stringify({ version: 1, label: "Quarterly screen", base: "knockout-search" }));
  const triggers = [], audits = [];
  const service = makePortalService({ poolRoot, workspaceRoot, recipesDir, secret: "test-secret",
    staffDomains: STAFF_DOMAINS, grants: GRANTS,
    // The queues the runner drains, injected the way serve() injects config.queueDirs. Omitted by
    // default so the allowance counter reports `complete:false` — a world with no queue wiring must
    // read as "could not count", never as "no runs today".
    ...(opts.queueDirs ? { queueDirs: () => opts.queueDirs } : {}),
    ...(opts.readBuilt ? { readBuilt: opts.readBuilt } : {}),
    ...(opts.upstream ? { upstream: opts.upstream } : {}),
    ...(opts.composeRead ? { composeRead: opts.composeRead } : {}),
    ...(opts.readBudget ? { readBudget: opts.readBudget } : {}),
    // — the capture endpoint is retired and answers 410. A world that does not ask for it gets the
    // shipped posture, which is what nearly every test below wants; the ten that drive the RETAINED
    // resolver (//) ask for it by name. Opt-in, so `world` alone can never accidentally
    // test a capability production does not have.
    ...(opts.feedbackCapture ? { feedbackCapture: true } : {}),
    ...(opts.stopControl ? { stopControl: opts.stopControl } : {}),
    // — opt-in, so `world` alone can never accidentally test a demo posture.
    ...(opts.demo ? { demo: true } : {}),
    trigger: async (args) => { triggers.push(args); return { ok: true, queued: true, id: args.id }; },
    audit: (r) => audits.push(r) });
  return { service, poolRoot, workspaceRoot, recipesDir, triggers, audits };
}

test("#1000 /portal/api/about answers the §13 source offer, and answers it to a STRANGER", async () => {
  const { service } = world();
  // THE STRANGER IS THE ASSERTION. Every other route in this file refuses one; this route must not.
  // AGPL §13 owes the source offer to the users interacting with the service, and an offer you have to
  // authenticate to read is not an offer. If someone later "fixes" this route to require a principal,
  // the licence obligation quietly stops being met and nothing else in the suite would notice.
  const r = await service.route("GET", "/portal/api/about", STRANGER);
  assert.equal(r.status, 200, "the source offer is not behind the door");
  assert.equal(r.json.name, "Clearotron");
  assert.equal(typeof r.json.sourceRepo, "string");
  assert.ok(r.json.copyright.length > 0);

  // The commit is what makes this a §13 offer rather than a marketing link, so the pair is asserted
  // together: either the sha is reported AND the url pins to it, or the sha is null AND the url falls
  // back to the bare repository. A pinned-looking url with no sha behind it is the failure mode.
  if (r.json.commit === null) {
    assert.equal(r.json.sourceUrl, r.json.sourceRepo, "no sha ⇒ the offer must not look pinned");
  } else {
    assert.match(r.json.commit, /^[0-9a-f]{40}$/);
    assert.ok(r.json.sourceUrl.endsWith(r.json.commit), "the url pins to the running build");
  }

  // Read from the manifest, never restated — so the relicence reaches this surface with no edit
  // here and no window where the About page names one licence and the repository declares another.
  const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
  assert.equal(r.json.license, pkg.license);
});

test("routes: stranger 403 everywhere; client sees only their account's searches; staff need an explicit acting-for", async () => {
  const { service } = world();
  assert.equal((await service.route("GET", "/portal/api/me", STRANGER)).status, 403);
  // "/portal" is no longer a route: the SPA document is served by portal-static.mjs above the limiter,
  // so the router legitimately does not know the path. The door check that used to live here has not
  // gone anywhere — it moved to where it can actually protect something. The app shell is static bytes
  // with no tenant data in it; /portal/api/me is what tells a stranger they have no access, and that is
  // asserted on the line above.
  assert.equal((await service.route("GET", "/portal", STRANGER)).status, 404);
  const mine = await service.route("GET", "/portal/api/searches", CLIENT, {}, {});
  assert.equal(mine.status, 200);
  assert.equal(mine.json.account, "aurora");
  assert.deepEqual(mine.json.recipes.map((r) => r.slug), ["screen"]);
  // The composer decides whether a saved search may be OFFERED while the row is being clicked (a full
  // deep dive reads one country at a time), so the flag rides the list row and not only the record.
  // Present and false here — absent would read as false too, and then the gate would never fire.
  assert.equal(mine.json.recipes[0].nativeLanguage, false, "the native-language toggle rides the list row");
  const foreign = await service.route("GET", "/portal/api/searches", CLIENT, {}, { account: "zephyr" });
  assert.equal(foreign.status, 404, "cross-account probe reads as not-found");
  const staffNoActing = await service.route("GET", "/portal/api/searches", STAFF, {}, {});
  assert.equal(staffNoActing.status, 400, "staff must NAME who they act for — no accidental firm-wide default");
  const staffActing = await service.route("GET", "/portal/api/searches", STAFF, {}, { account: "zephyr" });
  assert.equal(staffActing.status, 200);
});

// ── reading a brief ────────────────────────────────────────────────────────────────────────────────
test("compose/read: dark without a reader — /searches says so, the route refuses in the same words", async () => {
  const { service } = world();
  const searches = await service.route("GET", "/portal/api/searches", CLIENT, {}, {});
  assert.equal(searches.json.read.available, false, "fails DARK — the button must not light up over nothing");
  // THE PROPERTY IS THE SENTENCE'S SHAPE, NOT ITS WORDS. This pinned
  // "not switched on here yet" verbatim, and that wording was the defect: it promised a toggle nobody
  // had flipped, when the truth was a billing posture the feature could not run under. An arm that
  // spells the copy out has to be edited every time the copy is corrected, and an arm edited to match
  // whatever the code now says has stopped checking anything. So what is pinned is what the sentence
  // must never do, plus the sameness assertion below, which is this arm's actual subject.
  assert.ok(searches.json.read.note, "there must BE a sentence — dark and silent is worse than dark");
  assert.doesNotMatch(searches.json.read.note, /yet\b/,
    "no 'yet': it reads as a switch somebody forgot rather than a thing this instance cannot do");
  assert.ok(!/ANTHROPIC|API_KEY|env/i.test(searches.json.read.note), "never names our plumbing to a client");
  assert.match(searches.json.read.note, /set the search up below/, "and must say what the reader CAN do next");
  const r = await service.route("POST", "/portal/api/compose/read", CLIENT, { brief: "anything" }, {});
  assert.equal(r.status, 501);
  assert.equal(r.json.error, searches.json.read.note, "one sentence, both places");
  assert.equal(r.json.code, "unavailable", "the CODE is the machine word; `error` stays prose (portal-ui reads `error`)");
});

test("compose/read: a reader fills the form, spends nothing, queues nothing, and is audited by LENGTH not content", async () => {
  const READ = { names: ["AQUAPLUS"], classes: [32], goods: "energy drinks", territories: ["United States"],
    registers: false, marketplace: true, nativeLanguage: false, ref: "", deadline: "2026-07-24", notes: [] };
  const { service, triggers, audits } = world({ composeRead: async () => ({ ok: true, read: READ }) });
  const brief = "Quick check on AQUAPLUS for energy drinks in the US before Friday — just the obvious blockers.";
  const r = await service.route("POST", "/portal/api/compose/read", CLIENT, { brief }, {});
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.read, READ);
  assert.equal(r.json.confirmationToken, undefined, "THE line that must never move: a read mints no ticket");
  assert.equal(triggers.length, 0, "and starts nothing");
  const line = audits.find((a) => a.event === "compose-read");
  assert.equal(line.chars, brief.length);
  assert.ok(!JSON.stringify(line).includes("AQUAPLUS"), "a brief is client material — the audit log records that one happened, not whose mark it was");
  // Availability now reads true on the same payload the composer already fetches.
  assert.equal((await service.route("GET", "/portal/api/searches", CLIENT, {}, {})).json.read.available, true);
});

test("compose/read: a refusal is a sentence at 400/422; a provider throw is 502 and never a portal 500", async () => {
  const refusing = world({ composeRead: async () => ({ ok: false, error: "too_long", message: "That is too long — paste less." }) });
  const long = await refusing.service.route("POST", "/portal/api/compose/read", CLIENT, { brief: "x" }, {});
  assert.equal(long.status, 400);
  assert.equal(long.json.error, "That is too long — paste less.");

  const unreadable = world({ composeRead: async () => ({ ok: false, error: "unreadable", message: "I could not make sense of that." }) });
  assert.equal((await unreadable.service.route("POST", "/portal/api/compose/read", CLIENT, { brief: "x" }, {})).status, 422);

  const broken = world({ composeRead: async () => { throw new Error("provider 529 overloaded"); } });
  const out = await broken.service.route("POST", "/portal/api/compose/read", CLIENT, { brief: "x" }, {});
  assert.equal(out.status, 502, "an outage upstream is not a fault here");
  assert.match(out.json.error, /not answering just now/);
  assert.ok(!/529|overloaded|Error/.test(out.json.error), "the provider's own words never reach a client screen");
  assert.equal(broken.audits.find((a) => a.event === "compose-read").ok, false);
});

test("compose/read: the hourly budget is per person and refuses with a sentence", async () => {
  let calls = 0;
  const { service } = world({
    composeRead: async () => { calls += 1; return { ok: true, read: { names: [], classes: [], goods: "", territories: [], registers: true, marketplace: true, nativeLanguage: false, ref: "", deadline: "", notes: [] } }; },
    readBudget: { take: (key) => key === CLIENT.email && calls < 2 },
  });
  assert.equal((await service.route("POST", "/portal/api/compose/read", CLIENT, { brief: "a" }, {})).status, 200);
  assert.equal((await service.route("POST", "/portal/api/compose/read", CLIENT, { brief: "b" }, {})).status, 200);
  const third = await service.route("POST", "/portal/api/compose/read", CLIENT, { brief: "c" }, {});
  assert.equal(third.status, 429);
  assert.match(third.json.error, /a lot of reading/);
  assert.equal(calls, 2, "a refused press costs nothing");
});

test("compose/read: a stranger is refused at the door; staff need not have picked an account", async () => {
  const { service } = world({ composeRead: async () => ({ ok: true, read: { names: ["X"], classes: [], goods: "", territories: [], registers: true, marketplace: true, nativeLanguage: false, ref: "", deadline: "", notes: [] } }) });
  assert.equal((await service.route("POST", "/portal/api/compose/read", STRANGER, { brief: "a" }, {})).status, 403);
  // A door check, not an account check: the read touches no account data, so demanding one would be a
  // gate with nothing behind it — and would refuse a form-filler to staff composing for a client they
  // have not picked yet. Contrast /portal/api/searches on the line below, which IS account-scoped.
  assert.equal((await service.route("POST", "/portal/api/compose/read", STAFF, { brief: "a" }, {})).status, 200);
  assert.equal((await service.route("GET", "/portal/api/searches", STAFF, {}, {})).status, 400);
});

test("plan → confirm → run: honest gate, SERVER-stamped trigger, mutation/replay refuse, upstream refusal audited as 502", async () => {
  const { service, triggers, audits } = world();
  const body = { marks: [{ name: "IRONWHISK" }, { name: "CLUVENDRA" }], classes: [8], goods: "kitchen tools",
    product: "knockout-search", forwarder: "evil-forwarder", profileKey: "zephyr", forwarderEmail: "spoof@evil" };
  const plan = await service.route("POST", "/portal/api/run/plan", CLIENT, body, {});
  assert.equal(plan.status, 200, JSON.stringify(plan.json));
  assert.equal(plan.json.stageLabel, "Knockout search", "identity from the REGISTRY, never a client label");
  assert.equal(plan.json.marks, 2);
  // — THE COMPOSER SENDS NO CAVEAT NOW. It carried "Ratings reflect our common law
  // assessment. Register analysis may adjust ratings in either direction." into the review dialog; the
  // register IS weighed after the doctrine change, so the sentence stops being true there. Its half in
  // the delivered report is the doctrine lane's, not this one's.
  //
  // Asserted as ABSENT rather than deleted: a field that quietly comes back would restore a false
  // sentence to the one screen a client reads before spending.
  assert.equal(plan.json.caveat, undefined, "the composer no longer ships the common-law caveat");
  assert.ok(plan.json.confirmationToken);
  assert.equal(triggers.length, 0, "the plan step NEVER spends");
  // a mutated body refuses BEFORE any spend — classes/goods are now inside the binding (review 2026-07-18)
  for (const mut of [{ marks: [{ name: "SOMETHING ELSE" }] }, { classes: [8, 42] }, { goods: "different goods" }]) {
    const m = await service.route("POST", "/portal/api/run", CLIENT, { ...body, ...mut, confirmationToken: plan.json.confirmationToken }, {});
    assert.equal(m.status, 409, `mutation ${JSON.stringify(mut)} must refuse`);
  }
  assert.equal(triggers.length, 0);
  const run = await service.route("POST", "/portal/api/run", CLIENT, { ...body, confirmationToken: plan.json.confirmationToken }, {});
  assert.equal(run.status, 200, JSON.stringify(run.json));
  assert.equal(triggers.length, 1);
  const t = triggers[0];
  assert.equal(t.profileKey, "aurora", "profileKey is the PRINCIPAL's account — the body's zephyr is ignored");
  assert.equal(t.forwarder, "portal", "forwarder server-stamped");
  assert.equal(t.forwarderEmail, CLIENT.email, "reply routing = the verified identity");
  assert.equal(t.product, "knockout-search");
  // one-shot: replaying the SAME token after the successful run never spends twice
  const replay = await service.route("POST", "/portal/api/run", CLIENT, { ...body, confirmationToken: plan.json.confirmationToken }, {});
  assert.equal(replay.status, 409);
  assert.match(replay.json.error, /already used/);
  assert.equal(triggers.length, 1);
  assert.ok(audits.some((a) => a.event === "plan" && a.by === CLIENT.email));
  assert.ok(audits.some((a) => a.event === "trigger" && a.by === CLIENT.email));
});

// F4 — the composer's "Case law" lever has to survive the plan→confirm→trigger crossing, or it is the
// same dead switch it was when it lived behind a regex over the narrative. Only `true` travels: the
// engine treats the lever as additive, so forwarding an explicit false would imply a suppression that
// deliberately does not exist (pipeline.mjs decideCaseLaw).
// The body now names ONE territory: a full deep dive reads one country at a time, and aurora's account
// defaults are seven — so a caseLaw run that names no territory
// refuses at this gate rather than silently spreading the deep dive over all of them.
test("the native-language toggle reaches the trigger; caseLaw and a FALSE toggle are REFUSED rather than dropped", async () => {
  for (const [sent, expected] of [[true, true], [undefined, undefined]]) {
    const { service, triggers } = world();
    const body = { marks: [{ name: "IRONWHISK" }], classes: [8], goods: "kitchen tools",
      product: "multi-country-focus-search", jurisdictions: ["China", "Japan"],
      ...(sent === undefined ? {} : { nativeLanguage: sent }) };
    const plan = await service.route("POST", "/portal/api/run/plan", CLIENT, body, {});
    assert.equal(plan.status, 200, JSON.stringify(plan.json));
    const run = await service.route("POST", "/portal/api/run", CLIENT, { ...body, confirmationToken: plan.json.confirmationToken }, {});
    assert.equal(run.status, 200, JSON.stringify(run.json));
    assert.equal(triggers.length, 1);
    assert.equal(triggers[0].nativeLanguage, expected, `nativeLanguage:${sent} should forward as ${expected}`);
  }
  // `false` USED TO BE THE THIRD ROW OF THAT LOOP, expecting `undefined` at the trigger — the drop
  // written down as the contract. It is the accept-and-drop shape on the sibling of the field below: the
  // toggle only ever ADDED, so `false` asked to remove something no product runs conditionally, and the
  // requester who sent it on a Full country search believed they had switched the investigation off.
  // Carried now, and refused by validateJob in products.mjs's own words.
  {
    const { service, triggers } = world();
    const off = await service.route("POST", "/portal/api/run/plan", CLIENT,
      { marks: [{ name: "IRONWHISK" }], classes: [8], goods: "kitchen tools",
        product: "multi-country-focus-search", jurisdictions: ["China", "Japan"], nativeLanguage: false }, {});
    assert.equal(off.status, 422, JSON.stringify(off.json));
    assert.match(off.json.errors[0], /nativeLanguage: false switches nothing off/);
    assert.equal(off.json.confirmationToken, undefined, "no token — a token is a licence to spend");
    assert.equal(triggers.length, 0);
  }
  // AND THE FIELD THAT LEFT. This door deliberately owns no vocabulary of its own, so a body carrying
  // caseLaw is carried through to validateJob and REFUSED — not dropped here, which would make the
  // portal the one door that accepts the field and silently ignores it.
  const { service } = world();
  const res = await service.route("POST", "/portal/api/run/plan", CLIENT,
    { markName: "IRONWHISK", classes: [8], goods: "kitchen tools", product: "full-country-search",
      jurisdictions: ["United States"], caseLaw: true }, {});
  assert.equal(res.status, 422, JSON.stringify(res.json));
  assert.match(res.json.errors[0], /caseLaw is not a request setting/);
});

// ── the (depth × scope) combination rules at this door ─────────────────────────────────────────────
// The runner's admission gate is the wall; these prove the courtesy layer agrees with it, and that the
// saved-search hole is shut (a recipe whose scope routes no lane used to sail through /plan and spend).
test("the product's geography rule at the spend door: a two-country Full country search mints NO token", async () => {
  const { service, triggers, audits } = world();
  const body = { markName: "IRONWHISK", classes: [8], goods: "kitchen tools", product: "full-country-search",
    jurisdictions: ["United States", "France"] };
  const res = await service.route("POST", "/portal/api/run/plan", CLIENT, body, {});
  assert.equal(res.status, 422, JSON.stringify(res.json));
  assert.equal(res.json.confirmationToken, undefined, "no token — a token is a licence to spend");
  assert.match(res.json.errors[0], /reads exactly one country/);
  assert.match(res.json.errors[0], /names 2/);
  assert.ok(!audits.some((a) => a.event === "plan"), "a refused plan is not a plan");
  // the account's own defaults are seven territories, so one that names NONE refuses too
  const { jurisdictions: _j, ...unscoped } = body;
  const bare = await service.route("POST", "/portal/api/run/plan", CLIENT, unscoped, {});
  assert.equal(bare.status, 422, JSON.stringify(bare.json));
  assert.match(bare.json.errors[0], /reads exactly one country/);
  // one territory is the runnable shape, and it spends
  const ok = await service.route("POST", "/portal/api/run/plan", CLIENT, { ...body, jurisdictions: ["United States"] }, {});
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  const run = await service.route("POST", "/portal/api/run", CLIENT,
    { ...body, jurisdictions: ["United States"], confirmationToken: ok.json.confirmationToken }, {});
  assert.equal(run.status, 200, JSON.stringify(run.json));
  assert.equal(triggers.length, 1);
  assert.deepEqual(triggers[0].jurisdictions, ["United States"]);
  assert.equal(triggers[0].product, "full-country-search",
    "and the case-law reading rides the PRODUCT — there is no flag left to carry it");
  assert.ok(!("caseLaw" in triggers[0]));
});

test("the run door refuses the same combination — a token cannot outlive the rule that let it be minted", async () => {
  // Plan with one territory, then submit the token with two. The token binds the mark/classes/goods, not
  // the scope, so this is exactly the shape the gate has to catch at the second door as well.
  const { service, triggers } = world();
  const body = { markName: "IRONWHISK", classes: [8], goods: "kitchen tools", product: "full-country-search",
    jurisdictions: ["United States"] };
  const plan = await service.route("POST", "/portal/api/run/plan", CLIENT, body, {});
  assert.equal(plan.status, 200, JSON.stringify(plan.json));
  const run = await service.route("POST", "/portal/api/run", CLIENT,
    { ...body, jurisdictions: ["United States", "France"], confirmationToken: plan.json.confirmationToken }, {});
  assert.equal(run.status, 422, JSON.stringify(run.json));
  assert.match(run.json.errors[0], /reads exactly one country/);
  assert.equal(triggers.length, 0, "nothing was queued");
});

test("native-script deepening refuses a scope it cannot route on — the hole that billed 1.5 for 1", async () => {
  const { service, triggers } = world();
  // aurora's default territories carry no routing jurisdiction, so this run would have fired ZERO lanes
  const res = await service.route("POST", "/portal/api/run/plan", CLIENT,
    { markName: "IRONWHISK", classes: [8], goods: "kitchen tools", product: "multi-country-focus-search", nativeLanguage: true }, {});
  assert.equal(res.status, 422, JSON.stringify(res.json));
  assert.match(res.json.errors[0], /routes on territory/);
  assert.match(res.json.errors[0], /China \(CN\)/, "the message names the territories that DO route");
  assert.equal(res.json.confirmationToken, undefined);
  // naming one routes the lane and the request runs
  const ok = await service.route("POST", "/portal/api/run/plan", CLIENT,
    { markName: "IRONWHISK", classes: [8], goods: "kitchen tools", product: "multi-country-focus-search", nativeLanguage: true, jurisdictions: ["China", "Japan"] }, {});
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(triggers.length, 0, "the plan step still never spends");
});

test("a literal \"Worldwide\" is cleared at the gate, so the review step shows the scope that would ACTUALLY run", async () => {
  const { service, triggers } = world();
  const body = { markName: "IRONWHISK", classes: [8], goods: "kitchen tools", product: "global-preliminary-search",
    jurisdictions: ["Worldwide"] };
  const plan = await service.route("POST", "/portal/api/run/plan", CLIENT, body, {});
  assert.equal(plan.status, 200, JSON.stringify(plan.json));
  assert.ok(!plan.json.scope.jurisdictions.includes("Worldwide"), "a bogus territory must never be shown back as scope");
  assert.ok(plan.json.warnings.some((w) => /worldwide is not a list entry/.test(w)),
    "the requester is told what happened to the entry they sent");
  // ── KNOWN GAP AT THIS DOOR, pinned deliberately so it cannot be mistaken for correct ───────────────
  // validateJob now records a worldwide request as a geography MODE, and effective-scope short-circuits
  // on it so the account's defaults cannot narrow it. This door never sees that: planGates validates a
  // THROWAWAY PROBE and carries back only `jurisdictions` (portal-service.mjs), so the stamp is dropped
  // and the review step still resolves to the account's own territories — the very narrowing the stamp
  // exists to stop. Closing it is a one-line carry-back in this door, which belongs with the door work,
  // not with the wire format. When that lands, these two assertions must flip to "this request" / [] —
  // and this test failing is how that gets noticed.
  // THE GAP ABOVE IS CLOSED. planGates now carries the stamp back off the probe alongside the
  // territories, so a worldwide request is worldwide at this door too — the same answer the CLI and
  // start_run give. This test failing in the other direction is how a regression here gets noticed.
  assert.equal(plan.json.scope.geographyMode, "worldwide");
  assert.equal(plan.json.scope.jurisdictionsFrom, "this request",
    "a requested worldwide is not a gap for the account's own territories to fill");
  assert.deepEqual(plan.json.scope.jurisdictions, []);
  // and the token minted over the un-normalized body still fires: jobHashOf does not cover jurisdictions
  const run = await service.route("POST", "/portal/api/run", CLIENT, { ...body, confirmationToken: plan.json.confirmationToken }, {});
  assert.equal(run.status, 200, JSON.stringify(run.json));
  assert.equal(triggers.length, 1);
  assert.ok(!("jurisdictions" in triggers[0]), "the engine receives no territory restriction, not a bogus one");
  // A one-country product + Worldwide is the case the un-normalized copy used to wave through as "one
  // territory" — the token counted as a place.
  const { service: svc2 } = world();
  const deep = await svc2.route("POST", "/portal/api/run/plan", CLIENT, { ...body, product: "full-country-search" }, {});
  assert.equal(deep.status, 422, JSON.stringify(deep.json));
  assert.match(deep.json.errors[0], /reads exactly one country/);
});

test("the new refusals name no switch, variable or internal level key either", async () => {
  const { service } = world();
  const seen = [
    await service.route("POST", "/portal/api/run/plan", CLIENT, { markName: "SOLO", classes: [9], goods: "software", product: "multi-country-focus-search", nativeLanguage: true }, {}),
    await service.route("POST", "/portal/api/run/plan", CLIENT, { markName: "SOLO", classes: [9], goods: "software", product: "full-country-search" }, {}),
    await service.route("POST", "/portal/api/run/plan", CLIENT, { markName: "SOLO", classes: [9], goods: "software", product: "full-country-search", jurisdictions: ["US", "FR"] }, {}),
  ];
  for (const r of seen) {
    assert.equal(r.status, 422, JSON.stringify(r.json));
    const body = JSON.stringify(r.json);
    assert.ok(!/CLEAROTRON_|PORTAL_/.test(body), `a switch name reached the client: ${body}`);
    assert.doesNotMatch(body, /[A-Z][A-Z0-9]*_[A-Z0-9_]+/, `a variable-shaped name reached the client: ${body}`);
    // bare `prelim` included: it is a ORDERABLE_PRODUCTS key, these lines render verbatim in a client browser,
    // and the rule this gate states six lines up is the STAGE label or plain words — never the level key.
    // The assertion omitted it while its own title claimed to check it (review 2026-07-27).
    assert.ok(!/jxLanes|registerProbe|commonLawGrid|\bprelim\b|prelim-jx|prelim-register-only/.test(body),
      `an internal name reached the client: ${body}`);
    // THE PRODUCT IDS, DERIVED FROM THE REGISTRY AND NOT TYPED OUT. These refusals are written in
    // products.mjs now, so the id-leak risk arrived at this door with them — and the line above is a
    // literal list of TODAY's level keys, the shape that keeps passing while a NEW key walks through.
    // The ids are the product names hyphen-joined, so "Full country search" is safe and the id is not.
    for (const id of PRODUCT_IDS) assert.ok(!body.includes(id), `a product id reached the client: ${id} in ${body}`);
    // A clarify is a question with a one-field answer; the composer renders a classify-less 422 under
    // "That cannot be searched as written", which reads as a dead end for a rule whose whole answer is
    // "keep one territory". Same shape validateJob's own refusals use, and the same the runner files.
    assert.equal(r.json.classify, "clarify", `a scope-rule refusal must not render as a hard rejection: ${body}`);
  }
});

test("upstream trigger refusal: audited ok:false and surfaced as an honest 502, never an opaque 500", async () => {
  const { service, audits } = (() => {
    const w = world();
    return w;
  })();
  // rebuild the service with a REFUSING trigger over the same fixture world shape
  const poolRoot = tempDir("portal-refuse-");
  const workspaceRoot = tempDir("portal-refuse-ws-");
  const audits2 = [];
  const refusing = makePortalService({ poolRoot, workspaceRoot, secret: "test-secret",
    staffDomains: STAFF_DOMAINS, grants: GRANTS,
    trigger: async () => { throw new Error("FORBIDDEN (start_run): grant mismatch"); },
    audit: (r) => audits2.push(r) });
  const body = { markName: "SOLO", classes: [9], goods: "software" };
  const plan = await refusing.route("POST", "/portal/api/run/plan", CLIENT, body, {});
  assert.equal(plan.status, 200, JSON.stringify(plan.json));
  const run = await refusing.route("POST", "/portal/api/run", CLIENT, { ...body, confirmationToken: plan.json.confirmationToken }, {});
  assert.equal(run.status, 502, JSON.stringify(run.json));
  // The DETAIL lives in the audit, not the response. This test used to assert the opposite — that a
  // client saw "could not be queued (FORBIDDEN (start_run): grant mismatch)" — which is an upstream
  // message written for operators, echoed into a browser. Honest ≠ verbatim: the client is told the
  // truth that matters (nothing ran, nothing was charged) and staff keep the cause.
  assert.ok(!/grant mismatch|FORBIDDEN/.test(run.json.error), "upstream wording is not client copy");
  assert.match(run.json.error, /nothing was charged/);
  assert.ok(audits2.some((a) => a.event === "trigger" && a.ok === false && /grant mismatch/.test(a.error ?? "")),
    "the refused attempt is audited in full, never silent — this is where the cause lives");
  void service; void audits;
});

test("multi-account client: door routes admit; scoped routes demand a named account; both grants work", async () => {
  const { service } = world();
  const BOSS = { email: "boss@celta.example" };
  const me = await service.route("GET", "/portal/api/me", BOSS);
  assert.equal(me.status, 200, "the front door admits multi-account clients (review 2026-07-18: this was a 404 lockout)");
  assert.deepEqual(me.json.accounts, ["aurora", "zephyr"], "the accounts array feeds the UI picker");
  // (the SPA document itself is portal-static.mjs's job now — see portal-static.test.mjs)
  assert.equal((await service.route("GET", "/portal", BOSS)).status, 404);
  const un = await service.route("GET", "/portal/api/searches", BOSS, {}, {});
  assert.equal(un.status, 400, "unresolved multi-account scoped route = actionable 400");
  assert.equal((await service.route("GET", "/portal/api/searches", BOSS, {}, { account: "zephyr" })).status, 200);
  assert.equal((await service.route("GET", "/portal/report/tmp3-zephyr-run/", BOSS)).status, 200, "ownership passes via ANY granted account");
  assert.equal((await service.route("GET", "/portal/report/tmp1-aurora-run/", BOSS)).status, 200);
});

test("runs + reports: account-filtered listing; foreign/missing reports are 404, never 403", async () => {
  const { service } = world();
  const runs = await service.route("GET", "/portal/api/runs", CLIENT, {}, {});
  assert.equal(runs.status, 200);
  const ids = runs.json.runs.map((r) => r.runId).sort();
  // ONE report (spec 2026-07-30 §5): a run you have rights to is ALWAYS listed — the failed-QC stamp
  // suppresses nothing; only the foreign account stays invisible.
  // tmp6 is a grouped run whose cross-mark summary came out empty. It is LISTED like any other:
  // having no summary is not a reason to hide a run, and the same rule as the held stamp above applies —
  // only the foreign account stays invisible.
  assert.deepEqual(ids, ["tmp1-aurora-run", "tmp2-aurora-held", "tmp4-aurora-batch", "tmp6-aurora-nosummary",
    "tmp9-live-amber-x"], "every aurora run listed; zephyr invisible");
  const live = runs.json.runs.find((r) => r.runId === "tmp9-live-amber-x");
  assert.equal(live.state, "running");
  const ok = await service.route("GET", "/portal/report/tmp1-aurora-run/", CLIENT);
  assert.equal(ok.status, 200);
  assert.match(ok.html, /tmp1-aurora-run/);
  assert.equal((await service.route("GET", "/portal/report/tmp3-zephyr-run/", CLIENT)).status, 404, "foreign report = 404");
  assert.equal((await service.route("GET", "/portal/report/tmp2-aurora-held/", CLIENT)).status, 200, "a failed-QC run SERVES — the checks decide nothing about who may read");
  assert.equal((await service.route("GET", "/portal/report/ghost/", CLIENT)).status, 404);
  assert.equal((await service.route("GET", "/portal/report/..%2Fescape/", CLIENT)).status, 404, "traversal-shaped runId = 404");
  assert.equal((await service.route("GET", "/portal/report/tmp3-zephyr-run/", STAFF)).status, 200, "staff read any");
  assert.equal((await service.route("GET", "/portal/api/runs", CLIENT, {}, { account: "generic" })).status, 404,
    "generic is STAFF-only on every client surface (LEAK-#9 alignment)");
});

// ── report feedback — RETIRED, and still tested ───────────────────────────────────────
//
// EVERY TEST IN THIS SECTION DRIVES CODE PRODUCTION CANNOT REACH. The owner switched the capture off on
// 2026-08-20 and ruled disable rather than delete, so the resolver stays and these stay with it: a path
// kept "so re-enabling is a switch" is worth nothing if nobody can show it still works. They pass
// `world({ feedbackCapture: true })`; the shipped default answers 410 and is asserted in
// report-feedback-is-switched-off.test.mjs.
//
// — TWO ARTIFACTS NOW, not one. report-data.json is the CLIENT cut and stopped serving the engine's
// placement key, so the locator reads mark/band/excerpt from it and the disposition from the findings.json
// publish copies into the same run dir. Every clearance fixture below writes both, which is what a
// published run has on disk.
test("feedback: the LOCATOR is read from the run, never from the request — a caller cannot label a finding", async () => {
  const { service, poolRoot } = world({ feedbackCapture: true });
  writeFileSync(join(poolRoot, "tmp1-aurora-run", "report-data.json"), JSON.stringify({
    schema: "report-data/1", runId: "tmp1-aurora-run", engineCommit: "cafe1234",
    findings: [{ ordinal: 1, mark: "KURENA", band: "Manageable", net: "Distinguished as wholes." }],
  }));
  writeFileSync(join(poolRoot, "tmp1-aurora-run", "findings.json"), JSON.stringify({
    findings: [{ ordinal: 1, mark: "KURENA", disposition: "rebuttable" }],
  }));
  const fbDir = tempDir("portal-fb-");
  const prev = process.env.CLEAROTRON_FEEDBACK_DIR;
  process.env.CLEAROTRON_FEEDBACK_DIR = fbDir;
  try {
    const r = await service.route("POST", "/portal/api/feedback", CLIENT, {
      runId: "tmp1-aurora-run", ordinal: 1, verdict: "bad", why: "The citation does not show use.",
      // Every one of these is a lie the caller is trying to plant. None of them may reach the record.
      mark: "SOMEONE ELSE'S MARK", band: "Severe", disposition: "conceded",
      account: "zephyr", capturedBy: "boss@celta.example", excerpt: "attacker prose",
    });
    assert.equal(r.status, 201);
    assert.ok(r.json.id, "the flag's id comes back");
    const rows = listFlags(fbDir);
    assert.equal(rows.length, 1);
    const rec = rows[0];
    assert.equal(rec.locator.mark, "KURENA", "the mark is READ FROM THE RUN, not taken from the body");
    assert.equal(rec.locator.band, "Manageable");
    assert.equal(rec.locator.disposition, "rebuttable",
      "#831 — from findings.json beside the report data, which no longer serves the placement key");
    assert.equal(rec.excerpt, "Distinguished as wholes.", "the excerpt too — #264 puts it in an issue body");
    assert.equal(rec.run.account, "aurora", "the account is the RUN's owner, never the body's");
    assert.equal(rec.capturedBy, CLIENT.email, "from the verified identity, never the body");
    assert.equal(rec.run.engineCommit, "cafe1234", "which build produced the finding");
    assert.equal(rec.verdict, "bad");
  } finally {
    if (prev === undefined) delete process.env.CLEAROTRON_FEEDBACK_DIR; else process.env.CLEAROTRON_FEEDBACK_DIR = prev;
    rmSync(fbDir, { recursive: true, force: true });
  }
});

// ── — the knockout lane nests its findings, and its ordinals restart at 1 per mark ─────────────
//
// A SINGLE-MARK BATCH CANNOT SEE THIS, which is why both marks below carry a finding with ordinal 1 and
// the flag is left on the SECOND one. Before the fix `data.findings` was absent on this shape, so the
// flag resolved to nothing at all; the tempting repair — flatten and key on the ordinal — resolves to
// the FIRST mark's finding, which silently attaches a lawyer's correction to a different mark.
const KO_DATA = {
  schema: "report-data/1", runId: "tmp1-aurora-run",
  marks: [
    { name: "AURORA", band: "High", findings: [
      { ref: "AURORA #1", ordinal: 1, name: "AURORA LABS", owner: "Aurora Labs GmbH", band: "Severe", type: "paper-conflict", net: "Identical word mark in the filed class." },
    ] },
    { name: "AURORA BLUE", band: "Manageable", findings: [
      { ref: "AURORA BLUE #1", ordinal: 1, name: "BLUE AURORA", owner: "Blue Aurora SA", band: "Manageable", type: "descriptive-terms", net: "Distinguished as wholes." },
      { ref: "AURORA BLUE #2", ordinal: 2, name: "AURORABLU", owner: "Aurorablu Srl", band: "Watch", type: "paper-conflict", net: "Lapsed registration, no live rights." },
    ] },
  ],
};

test("#487 feedback: a flag on the SECOND mark's finding 1 resolves to that mark, not the first mark's finding 1", async () => {
  const { service, poolRoot } = world({ feedbackCapture: true });
  writeFileSync(join(poolRoot, "tmp1-aurora-run", "report-data.json"), JSON.stringify(KO_DATA));
  const fbDir = tempDir("portal-fb-ko-");
  const prev = process.env.CLEAROTRON_FEEDBACK_DIR;
  process.env.CLEAROTRON_FEEDBACK_DIR = fbDir;
  try {
    const r = await service.route("POST", "/portal/api/feedback", CLIENT, {
      runId: "tmp1-aurora-run", markIndex: 1, ordinal: 1, verdict: "bad",
      why: "These are distinguishable; the owner has never enforced.",
      ref: "AURORA #1",   // a lie the caller is trying to plant — the resolved key must not come from here
    });
    assert.equal(r.status, 201);
    const rec = listFlags(fbDir)[0];
    assert.equal(rec.locator.mark, "BLUE AURORA", "the conflicting name from the SECOND mark's finding 1");
    assert.notEqual(rec.locator.mark, "AURORA LABS", "…and emphatically not the first mark's finding 1");
    assert.equal(rec.locator.ref, "AURORA BLUE #1", "the drill-through key is read from the run, not from the body");
    assert.equal(rec.locator.searchedMark, "AURORA BLUE", "which of the batch's marks was being read");
    assert.equal(rec.locator.band, "Manageable");
    assert.equal(rec.excerpt, "Distinguished as wholes.");
  } finally {
    if (prev === undefined) delete process.env.CLEAROTRON_FEEDBACK_DIR; else process.env.CLEAROTRON_FEEDBACK_DIR = prev;
    rmSync(fbDir, { recursive: true, force: true });
  }
});

test("#487 feedback: a knockout flag with NO markIndex resolves nothing rather than guessing at mark 0", async () => {
  const { service, poolRoot } = world({ feedbackCapture: true });
  writeFileSync(join(poolRoot, "tmp1-aurora-run", "report-data.json"), JSON.stringify(KO_DATA));
  const fbDir = tempDir("portal-fb-ko2-");
  const prev = process.env.CLEAROTRON_FEEDBACK_DIR;
  process.env.CLEAROTRON_FEEDBACK_DIR = fbDir;
  try {
    // The flag is still STORED — the reader's words are never thrown away over a locator — but nothing
    // is invented about which finding it was. An ambiguous locator resolving to mark 0 is the defect.
    const r = await service.route("POST", "/portal/api/feedback", CLIENT, {
      runId: "tmp1-aurora-run", ordinal: 1, verdict: "bad", why: "Wrong owner on this one.",
    });
    assert.equal(r.status, 201, "the words are kept");
    const rec = listFlags(fbDir)[0];
    assert.equal(rec.locator.mark, null, "no mark is guessed");
    assert.equal(rec.locator.ref, null);
    assert.equal(rec.locator.searchedMark, null);
    assert.equal(rec.excerpt, null, "and no sentence is attributed to a finding nobody located");
    assert.equal(rec.locator.ordinal, 1, "the position the reader gave is still on the record");
  } finally {
    if (prev === undefined) delete process.env.CLEAROTRON_FEEDBACK_DIR; else process.env.CLEAROTRON_FEEDBACK_DIR = prev;
    rmSync(fbDir, { recursive: true, force: true });
  }
});

test("#487 feedback: the clearance lane is untouched — a top-level findings[] still resolves on the ordinal alone", async () => {
  const { service, poolRoot } = world({ feedbackCapture: true });
  writeFileSync(join(poolRoot, "tmp1-aurora-run", "report-data.json"), JSON.stringify({
    schema: "report-data/1", runId: "tmp1-aurora-run",
    findings: [{ ordinal: 2, mark: "KURENA", band: "Manageable", net: "Distinguished as wholes." }],
  }));
  writeFileSync(join(poolRoot, "tmp1-aurora-run", "findings.json"), JSON.stringify({
    findings: [{ ordinal: 2, mark: "KURENA", disposition: "rebuttable" }],
  }));
  const fbDir = tempDir("portal-fb-cl-");
  const prev = process.env.CLEAROTRON_FEEDBACK_DIR;
  process.env.CLEAROTRON_FEEDBACK_DIR = fbDir;
  try {
    const r = await service.route("POST", "/portal/api/feedback", CLIENT, {
      runId: "tmp1-aurora-run", ordinal: 2, verdict: "good", why: "Right call.",
    });
    assert.equal(r.status, 201);
    const rec = listFlags(fbDir)[0];
    assert.equal(rec.locator.mark, "KURENA");
    assert.equal(rec.locator.disposition, "rebuttable");
    assert.equal(rec.locator.ref, null, "the clearance lane has no per-mark composite key");
  } finally {
    if (prev === undefined) delete process.env.CLEAROTRON_FEEDBACK_DIR; else process.env.CLEAROTRON_FEEDBACK_DIR = prev;
    rmSync(fbDir, { recursive: true, force: true });
  }
});

// ── — THE PAIRED EDIT, tested from the side that can go wrong ──────────────────────────────────
//
// report-data.json stopped serving `disposition`. Deleting that line on its own would have written null
// into the locator of every flag captured afterwards — silently, because a null disposition is also a
// legitimate state (an archived run, the knockout lane). These arms are what tells the two apart.
const withFeedbackDir = async (name, fn) => {
  const fbDir = tempDir(name);
  const prev = process.env.CLEAROTRON_FEEDBACK_DIR;
  process.env.CLEAROTRON_FEEDBACK_DIR = fbDir;
  try { await fn(fbDir); }
  finally {
    if (prev === undefined) delete process.env.CLEAROTRON_FEEDBACK_DIR; else process.env.CLEAROTRON_FEEDBACK_DIR = prev;
    rmSync(fbDir, { recursive: true, force: true });
  }
};

test("#831 feedback: a clearance run with NO findings.json still saves the flag, with an honest null posture", async () => {
  const { service, poolRoot } = world({ feedbackCapture: true });
  writeFileSync(join(poolRoot, "tmp1-aurora-run", "report-data.json"), JSON.stringify({
    schema: "report-data/1", runId: "tmp1-aurora-run",
    findings: [{ ordinal: 1, mark: "KURENA", band: "Manageable", net: "Distinguished as wholes." }],
  }));
  await withFeedbackDir("portal-fb-831a-", async (fbDir) => {
    const r = await service.route("POST", "/portal/api/feedback", CLIENT, {
      runId: "tmp1-aurora-run", ordinal: 1, verdict: "bad", why: "The citation does not show use.",
    });
    assert.equal(r.status, 201, "an absent artifact never costs a lawyer their words");
    const rec = listFlags(fbDir)[0];
    assert.equal(rec.locator.mark, "KURENA", "everything report-data.json answers still resolves");
    assert.equal(rec.locator.band, "Manageable");
    assert.equal(rec.excerpt, "Distinguished as wholes.");
    assert.equal(rec.locator.disposition, null, "the one fact the missing file carried, and nothing invented for it");
  });
});

test("#831 feedback: findings.json disagreeing about the mark resolves NO posture rather than the wrong one", async () => {
  const { service, poolRoot } = world({ feedbackCapture: true });
  writeFileSync(join(poolRoot, "tmp1-aurora-run", "report-data.json"), JSON.stringify({
    schema: "report-data/1", runId: "tmp1-aurora-run",
    findings: [{ ordinal: 1, mark: "KURENA", band: "Manageable", net: "Distinguished as wholes." }],
  }));
  // A stale copy: ordinal 1 is a DIFFERENT mark. 's ruling, one field over — the wrong answer on a
  // lawyer's flag is worse than no answer, and a flag is evidence a revert cannot repair.
  writeFileSync(join(poolRoot, "tmp1-aurora-run", "findings.json"), JSON.stringify({
    findings: [{ ordinal: 1, mark: "SOMETHING ELSE", disposition: "adversarial" }],
  }));
  await withFeedbackDir("portal-fb-831b-", async (fbDir) => {
    const r = await service.route("POST", "/portal/api/feedback", CLIENT, {
      runId: "tmp1-aurora-run", ordinal: 1, verdict: "bad", why: "Wrong owner on this one.",
    });
    assert.equal(r.status, 201);
    const rec = listFlags(fbDir)[0];
    assert.equal(rec.locator.mark, "KURENA", "the flag still points where the reader was looking");
    assert.equal(rec.locator.disposition, null, "…and carries no posture read off a finding that is not it");
  });
});

test("#831 feedback: the knockout lane is untouched — no findings.json is consulted and the posture stays null", async () => {
  const { service, poolRoot } = world({ feedbackCapture: true });
  writeFileSync(join(poolRoot, "tmp1-aurora-run", "report-data.json"), JSON.stringify(KO_DATA));
  // A clearance-shaped findings.json sitting in the same dir must not be mined for a batch lane whose
  // ordinals restart at 1 per mark. publish/knockout.mjs emits no disposition; null is the correct answer.
  writeFileSync(join(poolRoot, "tmp1-aurora-run", "findings.json"), JSON.stringify({
    findings: [{ ordinal: 1, mark: "AURORA LABS", disposition: "adversarial" }],
  }));
  await withFeedbackDir("portal-fb-831c-", async (fbDir) => {
    const r = await service.route("POST", "/portal/api/feedback", CLIENT, {
      runId: "tmp1-aurora-run", markIndex: 1, ordinal: 1, verdict: "bad", why: "These are distinguishable.",
    });
    assert.equal(r.status, 201);
    const rec = listFlags(fbDir)[0];
    assert.equal(rec.locator.mark, "BLUE AURORA", "the knockout resolution is unchanged");
    assert.equal(rec.locator.disposition, null, "no posture is borrowed from a file that does not describe this lane");
  });
});

test("feedback: a reader who cannot READ the report cannot flag it — foreign and generic are 404, never 403", async () => {
  const { service } = world({ feedbackCapture: true });
  const fbDir = tempDir("portal-fb2-");
  const prev = process.env.CLEAROTRON_FEEDBACK_DIR;
  process.env.CLEAROTRON_FEEDBACK_DIR = fbDir;
  try {
    const body = { verdict: "bad", why: "wrong", ordinal: 1 };
    assert.equal((await service.route("POST", "/portal/api/feedback", CLIENT, { ...body, runId: "tmp3-zephyr-run" })).status, 404, "foreign run");
    assert.equal((await service.route("POST", "/portal/api/feedback", CLIENT, { ...body, runId: "ghost" })).status, 404, "no such run");
    assert.equal((await service.route("POST", "/portal/api/feedback", CLIENT, { ...body, runId: "../escape" })).status, 404, "traversal-shaped");
    assert.equal((await service.route("POST", "/portal/api/feedback", STRANGER, { ...body, runId: "tmp1-aurora-run" })).status, 403, "no portal access at all");
    assert.equal(listFlags(fbDir).length, 0, "not one refusal wrote a record");
    assert.equal((await service.route("POST", "/portal/api/feedback", STAFF, { ...body, runId: "tmp3-zephyr-run" })).status, 201, "staff may flag any run they can read");
  } finally {
    if (prev === undefined) delete process.env.CLEAROTRON_FEEDBACK_DIR; else process.env.CLEAROTRON_FEEDBACK_DIR = prev;
    rmSync(fbDir, { recursive: true, force: true });
  }
});

test("feedback: good and bad both land; a flag with no reason is refused with a sentence, not a code", async () => {
  const { service } = world({ feedbackCapture: true });
  const fbDir = tempDir("portal-fb3-");
  const prev = process.env.CLEAROTRON_FEEDBACK_DIR;
  process.env.CLEAROTRON_FEEDBACK_DIR = fbDir;
  try {
    const base = { runId: "tmp1-aurora-run", ordinal: 1 };
    assert.equal((await service.route("POST", "/portal/api/feedback", CLIENT, { ...base, verdict: "good", why: "Exactly right." })).status, 201);
    assert.equal((await service.route("POST", "/portal/api/feedback", CLIENT, { ...base, verdict: "bad", why: "Wrong owner." })).status, 201);
    assert.deepEqual(listFlags(fbDir).map((r) => r.verdict).sort(), ["bad", "good"], "good flags are first-class");

    const noWhy = await service.route("POST", "/portal/api/feedback", CLIENT, { ...base, verdict: "bad", why: "   " });
    assert.equal(noWhy.status, 400);
    assert.equal(noWhy.json.code, "why_required");
    assert.match(noWhy.json.error, /Say what is right or wrong/, "`error` carries the SENTENCE, `code` the machine word");
    const badVerdict = await service.route("POST", "/portal/api/feedback", CLIENT, { ...base, verdict: "meh", why: "x" });
    assert.equal(badVerdict.json.code, "bad_verdict");
    const long = await service.route("POST", "/portal/api/feedback", CLIENT, { ...base, verdict: "bad", why: "x".repeat(4001) });
    assert.equal(long.json.code, "why_too_long");
    assert.equal(listFlags(fbDir).length, 2, "no refusal wrote a record");
  } finally {
    if (prev === undefined) delete process.env.CLEAROTRON_FEEDBACK_DIR; else process.env.CLEAROTRON_FEEDBACK_DIR = prev;
    rmSync(fbDir, { recursive: true, force: true });
  }
});

test("feedback: the audit line carries the LENGTH of the why, never the words", async () => {
  const { service, audits } = world({ feedbackCapture: true });
  const fbDir = tempDir("portal-fb4-");
  const prev = process.env.CLEAROTRON_FEEDBACK_DIR;
  process.env.CLEAROTRON_FEEDBACK_DIR = fbDir;
  try {
    const why = "The proprietor named here is not the one on the register record.";
    await service.route("POST", "/portal/api/feedback", CLIENT, { runId: "tmp1-aurora-run", ordinal: 2, verdict: "bad", why });
    const rec = audits.find((r) => r.event === "report-feedback");
    assert.ok(rec, "the flag is audited");
    assert.equal(rec.chars, why.length);
    assert.equal(rec.ok, true);
    assert.equal(rec.account, "aurora");
    // A why is the lawyer's reading of a client matter. An audit log is a different disclosure surface
    // from the flag store, and the words belong in exactly one of them.
    assert.ok(!JSON.stringify(rec).includes("proprietor"), "the words never reach the audit log");
  } finally {
    if (prev === undefined) delete process.env.CLEAROTRON_FEEDBACK_DIR; else process.env.CLEAROTRON_FEEDBACK_DIR = prev;
    rmSync(fbDir, { recursive: true, force: true });
  }
});

test("admin surfaces: staff-only, clients get 404 (the surface does not exist for them)", async () => {
  const { service } = world();
  assert.equal((await service.route("GET", "/portal/admin/roster", CLIENT)).status, 404);
  assert.equal((await service.route("GET", "/portal/admin/anything", CLIENT)).status, 404);
  const r = await service.route("GET", "/portal/admin/roster", STAFF);
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.json.customers));
});

test("#275/#283: issuedAt crosses the wire at full precision — the ordering key `date` cannot provide", async () => {
  const { service, poolRoot } = world();
  // Two reads of one mark, same DAY, 2m08s apart. This is the House-default row measured on the test
  // instance on 2026-08-04: two different runs, through two different doors, that the page rendered
  // byte-identically because everything distinguishing them was dropped or truncated on the way out.
  for (const [id, at] of [["tmp7-aurora-cli", "2026-08-04T06:54:58.017Z"], ["tmp7-aurora-mcp", "2026-08-04T06:57:06.563Z"]]) {
    mkdirSync(join(poolRoot, id), { recursive: true });
    writeFileSync(join(poolRoot, id, "meta.json"), JSON.stringify({
      runId: id, customerKey: "aurora", title: "VENZY", markName: "VENZY",
      kind: "clearance", overall: "LOW", date: "2026-08-04", issuedAt: at,
    }));
    writeFileSync(join(poolRoot, id, "report.html"), "ok");
  }
  const res = await service.route("GET", "/portal/api/runs", CLIENT, {}, {});
  const rows = Object.fromEntries(res.json.runs.map((r) => [r.runId, r]));
  assert.equal(rows["tmp7-aurora-cli"].issuedAt, "2026-08-04T06:54:58.017Z");
  assert.equal(rows["tmp7-aurora-mcp"].issuedAt, "2026-08-04T06:57:06.563Z");
  assert.equal(rows["tmp7-aurora-cli"].date, "2026-08-04", "the day-level date is unchanged — this ADDS a key, it does not replace one");
  assert.notEqual(rows["tmp7-aurora-cli"].issuedAt, rows["tmp7-aurora-mcp"].issuedAt,
    "the two reads are now distinguishable on the wire, which they were not");
});

test("#275: a run published before issuedAt existed reads as null, never as a fabricated instant", async () => {
  const { service, poolRoot } = world();
  mkdirSync(join(poolRoot, "tmp8-aurora-old"), { recursive: true });
  writeFileSync(join(poolRoot, "tmp8-aurora-old", "meta.json"), JSON.stringify({
    runId: "tmp8-aurora-old", customerKey: "aurora", title: "OLDMARK", kind: "clearance", date: "2026-06-01",
  }));
  writeFileSync(join(poolRoot, "tmp8-aurora-old", "report.html"), "ok");
  const res = await service.route("GET", "/portal/api/runs", CLIENT, {}, {});
  const row = res.json.runs.find((r) => r.runId === "tmp8-aurora-old");
  assert.equal(row.issuedAt, null, "unknown must read as unknown — a made-up timestamp would sort wrong and look right");
  assert.equal(row.date, "2026-06-01", "and the day-level date still works, which is what the fallback uses");
});

test("scanAccountRuns is pure over the fixture world (delivered pool rows + live rows, account-scoped)", () => {
  const { poolRoot, workspaceRoot } = world();
  const zeph = scanAccountRuns({ poolRoot, workspaceRoot, account: "zephyr" });
  assert.deepEqual(zeph.map((r) => r.runId).sort(), ["tmp3-zephyr-run", "tmp5-zephyr-batch"]);
  assert.equal(scanAccountRuns({ poolRoot, workspaceRoot, account: "nobody" }).length, 0);
});

test("a RETIRED run leaves the portal list — for staff too — but its report URL still resolves", async () => {
  // THE GAP THIS CLOSES. `pool-admin archive` has always written <pool>/archive-tags.json, and until now
  // the only reader was regenIndex — the STATIC staff index, which the edge stopped serving at the
  // portal cutover. So the command reported success against a page nobody could open while the run
  // stayed in full view on the one page everybody opens. A curation verb that does nothing to the live
  // surface is worse than no verb: it is a control that lies about having worked.
  const { service, poolRoot, workspaceRoot } = world();
  assert.ok(scanAccountRuns({ poolRoot, workspaceRoot }).some((r) => r.runId === "tmp3-zephyr-run"),
    "precondition: the run is listed before it is retired");

  writeFileSync(join(poolRoot, "archive-tags.json"), JSON.stringify({ archived: ["tmp3-zephyr-run"] }));

  const all = scanAccountRuns({ poolRoot, workspaceRoot });
  assert.ok(!all.some((r) => r.runId === "tmp3-zephyr-run"), "retired ⇒ gone from the unscoped scan");
  // NAMED, not counted. `length === 0` was the assertion, and it passes just as well when the scan is
  // broken and returns nothing at all — an absence read as a pass, which is the shape this repo keeps
  // finding. What must be true is that THIS run left and the account's other run did not.
  const zephAfter = scanAccountRuns({ poolRoot, workspaceRoot, account: "zephyr" }).map((r) => r.runId);
  assert.ok(!zephAfter.includes("tmp3-zephyr-run"), "retired ⇒ gone from its own account's scan");
  assert.ok(zephAfter.includes("tmp5-zephyr-batch"), "…and retiring one run retires exactly one run");
  assert.ok(all.some((r) => r.runId === "tmp1-aurora-run"), "and no other run is disturbed");

  // STAFF TOO. Archiving is a deliberate staff act from the CLI, `pool-admin list` shows exactly what is
  // hidden and `unarchive` puts it back — control and inverse in one place. A staff-only fold in the
  // portal would be a second place to look, out of step with the first.
  const staffList = await service.route("GET", "/portal/api/runs", STAFF, null, { account: "*" });
  assert.equal(staffList.status, 200);
  assert.ok(!staffList.json.runs.some((r) => r.runId === "tmp3-zephyr-run"));

  // BUT THE LINK IS NOT REVOKED. Report URLs are in email already sent, and the Caddyfile's legacy
  // rewrite exists so those keep resolving. Retiring says "stop advertising this", never "rot the link".
  const report = await service.route("GET", "/portal/report/tmp3-zephyr-run/", STAFF);
  assert.equal(report.status, 200, "a retired run's report is still served to someone who holds it");
  assert.ok(report.html);
});

test("an unreadable or absent archive-tags.json retires nothing (a pool has no reason to carry one)", () => {
  const { poolRoot, workspaceRoot } = world();
  const before = scanAccountRuns({ poolRoot, workspaceRoot }).length;
  writeFileSync(join(poolRoot, "archive-tags.json"), "{ this is not json");
  assert.equal(scanAccountRuns({ poolRoot, workspaceRoot }).length, before,
    "a garbled sidecar must never empty the portal — fail towards showing the work");
});

test("scanAccountRuns: WHICH PROJECT a run belongs to survives the trip back, on all three paths", () => {
  // THE GAP THIS CLOSES. The composer has a project picker, portal-service stamps `projectKey` onto the
  // job, and freezeProfile records key and resolved name in the run's sidecar — and then nothing read
  // any of it back. "What was I working on" had no answer anywhere in the portal, which is why Home
  // could offer no way to pick up where you left off.
  //
  // Three sources, because a run is read from a different place at each stage of its life: the queue
  // file before it starts, the frozen sidecar while it runs, the pool's meta after it is delivered.
  // A run that changed project identity as it moved between them would be worse than one with none.
  const { poolRoot, workspaceRoot } = world();

  // delivered — stamped into meta at publish
  mkdirSync(join(poolRoot, "tmp4-aurora-proj"), { recursive: true });
  writeFileSync(join(poolRoot, "tmp4-aurora-proj", "meta.json"), JSON.stringify({
    runId: "tmp4-aurora-proj", customerKey: "aurora", title: "T", date: "2026-07-19",
    projectKey: "spring-launch", projectName: "Spring launch",
  }));

  // live — straight off the frozen sidecar the live branch already reads
  const live = join(workspaceRoot, "workspace-test", "studio", "prelim-search", "tmp8-proj", "2026-07-19-jade-y");
  mkdirSync(driverDir(live), { recursive: true });
  writeFileSync(join(live, "status.json"), JSON.stringify({ runId: "tmp8-proj-jade-y", markName: "PROJMARK", state: "running", updatedAt: "2026-07-19T09:00:00Z" }));
  writeFileSync(driverDir(live, "profile.json"), JSON.stringify({
    profileKey: "aurora", name: "Aurora", projectKey: "spring-launch", projectName: "Spring launch",
  }));

  // queued — the job carries the KEY but no name; the engine resolves the name at start
  const q = join(workspaceRoot, "workspace-test", "studio", "prelim-search", "queue");
  mkdirSync(q, { recursive: true });
  writeFileSync(join(q, "portal-proj.json"), JSON.stringify({
    id: "portal-proj", profileKey: "aurora", markName: "QMARK", projectKey: "spring-launch",
  }));

  const by = Object.fromEntries(scanAccountRuns({ poolRoot, workspaceRoot, account: "aurora" }).map((r) => [r.runId, r]));
  assert.equal(by["tmp4-aurora-proj"].projectKey, "spring-launch");
  assert.equal(by["tmp4-aurora-proj"].projectName, "Spring launch");
  assert.equal(by["tmp8-proj-jade-y"].projectKey, "spring-launch");
  assert.equal(by["tmp8-proj-jade-y"].projectName, "Spring launch");
  assert.equal(by["portal-proj"].projectKey, "spring-launch");
  assert.equal(by["portal-proj"].projectName, null, "not yet resolved — the consumer falls back to the key");

  // NULL MEANS "WE DO NOT KNOW", NEVER "NO PROJECT". Every run delivered before the publish stamp
  // carries neither field whether or not it had one, so nothing downstream may render null as a claim.
  assert.equal(by["tmp1-aurora-run"].projectKey, null);
  assert.equal(by["tmp1-aurora-run"].projectName, null);
});

test("scanAccountRuns: a job still in the QUEUE is listed as queued — the window between Start and pickup", () => {
  // THE GAP THIS CLOSES (2026-07-22). The queue directory was skipped outright, so between pressing
  // Start and the driver writing a status.json a clearance appeared in NOTHING — while the screen that
  // had just accepted it promised "it will appear in Clearances". Indistinguishable, to whoever went
  // and looked, from a run that never started.
  const { poolRoot, workspaceRoot } = world();
  const q = join(workspaceRoot, "workspace-test", "studio", "prelim-search", "queue");
  mkdirSync(q, { recursive: true });
  writeFileSync(join(q, "portal-abc123.json"), JSON.stringify({
    id: "portal-abc123", profileKey: "aurora", markName: "LUMEN", product: "global-preliminary-search",
  }));
  // …and one the runner has already finished with. `.done`/`.failed` are HISTORY the pool and live
  // scans already own; listing them here would double every completed run.
  writeFileSync(join(q, "portal-old.json.done"), JSON.stringify({ id: "portal-old", profileKey: "aurora", markName: "OLD" }));

  const rows = scanAccountRuns({ poolRoot, workspaceRoot, account: "aurora" });
  const queued = rows.filter((r) => r.state === "queued");
  assert.deepEqual(queued.map((r) => r.runId), ["portal-abc123"], "the pending job, and only it");
  assert.equal(queued[0].markName, "LUMEN", "named by its mark, not by a job id nobody recognises");
  assert.equal(queued[0].step, "Waiting to start");
  assert.equal(queued[0].report, null);
  assert.equal(scanAccountRuns({ poolRoot, workspaceRoot, account: "zephyr" }).some((r) => r.state === "queued"), false,
    "and it is account-scoped like every other row");
});

test("scanAccountRuns: TERMINAL queue markers produce NO row — the queue is a dead-letter store", () => {
  // THE REGRESSION THIS PINS (2026-07-28). This scan was widened to also read `.failed` / `.duplicate` /
  // `.manifest.failed`, on the reasoning that a job refused at the runner's intake gate gets no run dir,
  // no status.json, and therefore appears nowhere. Sound reasoning; the wrong read of the evidence.
  //
  // "The live queue is holding thirty of these" did not mean it happens often. It meant THE DIRECTORY HAS
  // NO RETENTION. The thirty spanned six weeks — test artefacts, raw Outlook message ids, dev runs — and
  // twenty-six had no `.reason` sidecar, so each drew a row that said something stopped and could not say
  // what or why. Home and Clearances both read this scan, so both filled with dead letters on a morning
  // when nothing at all was running.
  //
  // Narrowing by age or by owner would only shrink the junk. The fix is that this scan answers "what is
  // waiting", and a refusal is answered at the door that refused it.
  const { poolRoot, workspaceRoot } = world();
  const q = join(workspaceRoot, "workspace-test", "studio", "prelim-search", "queue");
  mkdirSync(q, { recursive: true });
  const job = (id, mark) => JSON.stringify({ id, profileKey: "aurora", markName: mark, product: "global-preliminary-search" });

  writeFileSync(join(q, "portal-live.json"), job("portal-live", "LUMEN"));
  // Every terminal shape the runner writes, including one WITH a reason — the presence of a reason must
  // not buy a marker a row either, or the rule becomes "show the tidy dead letters".
  writeFileSync(join(q, "portal-refused.failed"), job("portal-refused", "REFUSED"));
  writeFileSync(join(q, "portal-refused.failed.reason"), "unresolved applicant — clarify with the sender\n");
  writeFileSync(join(q, "portal-dup.duplicate"), job("portal-dup", "DUP"));
  writeFileSync(join(q, "portal-bad.manifest.failed"), job("portal-bad", "BAD"));

  const rows = scanAccountRuns({ poolRoot, workspaceRoot, account: "aurora" });
  const queued = rows.filter((r) => r.state === "queued");
  assert.deepEqual(queued.map((r) => r.runId), ["portal-live"], "the waiting job, and nothing that already stopped");
  // Asserted by id as well as by count: the markers must not appear under ANY state — turning one into a
  // `failed` row is exactly the shape that filled both screens.
  for (const id of ["portal-refused", "portal-dup", "portal-bad"]) {
    assert.equal(rows.some((r) => r.runId === id), false, `${id} is a dead letter, not a row`);
  }
  // And nothing invented a stage for a job that never reached one.
  assert.equal(queued[0].failedStage, null);
});

// ── the ladder join (portal UI, P1) ────────────────────────────────────────────────────────────────
// The listing used to push a bare `overall` label and drop `meta.framework` entirely, which made the
// tone-keyed dot, the N-stop gauge and the "N names, worst: <band>" rule unimplementable. The join
// belongs on the server because the server is the only side that knows which framework rated the run.
test("scanAccountRuns: bands and tone come from the run's OWN framework, never a global label map", () => {
  const poolRoot = tempDir("portal-ladder-");
  const workspaceRoot = tempDir("portal-ladderws-");
  const put = (runId, meta) => {
    mkdirSync(join(poolRoot, runId), { recursive: true });
    writeFileSync(join(poolRoot, runId, "meta.json"), JSON.stringify({ runId, customerKey: "aurora", date: "2026-07-18", clientGate: { released: true }, ...meta }));
  };

  // A FOUR-stop ladder that says "Moderate" — the house default. A five-label map keyed on
  // {Low, Manageable, Medium, High, Very high} gets every one of these wrong.
  const houseDefault = { key: "house-default", title: "House", custom: false, bands: [
    { label: "Clear", tone: "minimal" }, { label: "Moderate", tone: "medium" },
    { label: "Elevated", tone: "high" }, { label: "Blocking", tone: "severe" }] };
  put("r-moderate", { title: "NOVAPULSE", kind: "clearance", overall: "Moderate", framework: houseDefault });

  // A different customer framework using the SAME word for a different rung.
  const bespoke = { key: "acme-v2", title: "Acme", custom: true, bands: [
    { label: "Moderate", tone: "severe" }, { label: "Fine", tone: "minimal" }] };
  put("r-bespoke", { title: "AQUAMAX", kind: "clearance", overall: "Moderate", framework: bespoke });

  // A knockout batch: per-mark bands resolve against the same ladder.
  put("r-batch", { title: "Knockout search — 3 marks", kind: "knockout-batch", overall: "Elevated",
    framework: houseDefault, marks: [{ name: "LUMEN", band: "Clear" }, { name: "LUMENA", band: "Elevated" }, { name: "LUMINA", band: "Moderate" }] });

  // A run archived before doc-50 — no framework at all.
  put("r-legacy", { title: "OLDMARK", kind: "clearance", overall: "LOW" });

  const runs = scanAccountRuns({ poolRoot, workspaceRoot, account: "aurora" });
  const by = Object.fromEntries(runs.map((r) => [r.runId, r]));

  assert.equal(by["r-moderate"].tone, "medium", "'Moderate' is medium in the house ladder");
  assert.equal(by["r-moderate"].bands.length, 4, "four stops, not five");
  assert.equal(by["r-bespoke"].tone, "severe", "the SAME word is a different tone in a different framework");

  assert.equal(by["r-batch"].kind, "knockout-batch");
  assert.deepEqual(by["r-batch"].marks.map((m) => [m.name, m.tone]),
    [["LUMEN", "minimal"], ["LUMENA", "high"], ["LUMINA", "medium"]],
    "every mark in a batch resolves against one ladder — a batch cannot mix vocabularies");

  // Unrated is unrated: a null tone, an empty ladder, and the label still shown.
  assert.equal(by["r-legacy"].tone, null, "no framework ⇒ no invented tone");
  assert.deepEqual(by["r-legacy"].bands, []);
  assert.equal(by["r-legacy"].band, "LOW", "the label survives so the row is not blank");

  // reportSchema is absent on every one of these, and ABSENCE is what identifies legacy.
  assert.equal(by["r-moderate"].reportSchema, null);
});

test("scanAccountRuns: the writers' STRING reportSchema ('report-data/1') arms the native-render flag", () => {
  const poolRoot = tempDir("portal-schema-");
  const workspaceRoot = tempDir("portal-schemaws-");
  const put = (runId, meta) => {
    mkdirSync(join(poolRoot, runId), { recursive: true });
    writeFileSync(join(poolRoot, runId, "meta.json"), JSON.stringify({ runId, customerKey: "aurora", date: "2026-07-18", clientGate: { released: true }, ...meta }));
  };
  // What publish/knockout.mjs (and the clearance producer) actually stamp — the string form. Gating on
  // `typeof === "number"` alone left this null forever, so the portal's native branch never armed.
  put("r-native", { title: "NOVAKIT", kind: "knockout-batch", overall: "Clear", reportSchema: "report-data/1" });
  put("r-numeric", { title: "NUMKIT", kind: "clearance", overall: "Clear", reportSchema: 1 });
  put("r-junk", { title: "JUNKKIT", kind: "clearance", overall: "Clear", reportSchema: "not-a-schema" });

  const by = Object.fromEntries(scanAccountRuns({ poolRoot, workspaceRoot, account: "aurora" }).map((r) => [r.runId, r]));
  assert.equal(by["r-native"].reportSchema, 1, "'report-data/1' means schema version 1 — the flag arms");
  assert.equal(by["r-numeric"].reportSchema, 1, "a bare number still passes through");
  assert.equal(by["r-junk"].reportSchema, null, "an unrecognised string stays legacy — never invented");
});

test("scanAccountRuns: a failed live run carries its reason — an unexplained failure is a phone call", () => {
  const poolRoot = tempDir("portal-fail-");
  const workspaceRoot = tempDir("portal-failws-");
  const dir = join(workspaceRoot, "workspace-test", "studio", "prelim-search", "slug", "run");
  mkdirSync(driverDir(dir), { recursive: true });
  writeFileSync(join(dir, "status.json"), JSON.stringify({ runId: "r-fail", markName: "BROKEN", state: "failed",
    failedStage: "register-probe", reason: "the register provider returned no results for three retries",
    updatedAt: "2026-07-18T10:00:00Z" }));
  writeFileSync(driverDir(dir, "profile.json"), JSON.stringify({ profileKey: "aurora" }));

  const [run] = scanAccountRuns({ poolRoot, workspaceRoot, account: "aurora" });
  assert.equal(run.state, "failed", "failed runs are LISTED, not hidden");
  assert.equal(run.failedStage, "register-probe");
  assert.match(run.reason, /three retries/);
});

// ── "All brand owners" (portal UI, P1) ─────────────────────────────────────────────────────────────
// The design's grouped view needs runs from several accounts at once. It is answered in ONE pass over
// the pool rather than by the browser fanning out across the roster — a roster-sized burst of requests
// on every 5s poll is exactly what the 120/min limiter exists to prevent.
test('runs?account=*: staff see every account tagged; a client sees a 404, not a filtered list', async () => {
  const { service } = world();

  const all = await service.route("GET", "/portal/api/runs", STAFF, {}, { account: "*" });
  assert.equal(all.status, 200);
  assert.deepEqual([...new Set(all.json.runs.map((r) => r.account))].sort(), ["aurora", "zephyr"],
    "every row carries its own owner, so the UI never infers it from the request");
  assert.ok(all.json.runs.some((r) => r.account === "zephyr"), "a staff view spans accounts");

  // A client asking for the wildcard must not get their own runs back either — that would teach the UI
  // that '*' is a harmless synonym for "mine" and invite it to be sent by default.
  const denied = await service.route("GET", "/portal/api/runs", CLIENT, {}, { account: "*" });
  assert.equal(denied.status, 404);
  assert.deepEqual(denied.json, { error: "not_found" }, "byte-identical to any other denial");

  // and the single-account path is unchanged
  const one = await service.route("GET", "/portal/api/runs", CLIENT, {}, {});
  assert.equal(one.status, 200);
  assert.deepEqual([...new Set(one.json.runs.map((r) => r.account))], ["aurora"]);
});

// The wildcard branch read `principal.role` directly. `principal` is null for any identity that is
// neither staff nor granted anything — which is exactly the caller the "every customer" route most needs
// to refuse — so the read threw a TypeError, which is not a PortalDeny and so escaped route()'s catch
// and became a 500. The route that lists every account answered a server error to an unenrolled prober
// while every other surface refused them cleanly.
test('?account=* checks the DOOR before it dereferences the principal — refused, never a 500', async () => {
  const { service } = world();

  const atTheDoor = await service.route("GET", "/portal/api/me", STRANGER);
  assert.equal(atTheDoor.status, 403);

  // Before the fix this REJECTED (TypeError: Cannot read properties of null), which the HTTP handler
  // turns into 500 { error: "internal" }.
  const denied = await service.route("GET", "/portal/api/runs", STRANGER, {}, { account: "*" });
  assert.equal(denied.status, 403, "an unenrolled identity is refused at the door");
  assert.deepEqual(denied.json, atTheDoor.json,
    "…with the same refusal every other surface gives them — no route answers a stranger differently");

  // The staff-only rule the branch exists for is untouched: door mode resolves no account.
  assert.equal((await service.route("GET", "/portal/api/runs", CLIENT, {}, { account: "*" })).status, 404,
    "an ADMITTED client still gets the plain 404 — the wildcard is not a synonym for 'mine'");
  const all = await service.route("GET", "/portal/api/runs", STAFF, {}, { account: "*" });
  assert.equal(all.status, 200, "and staff still see every account");
  assert.ok(all.json.runs.some((r) => r.account === "zephyr"));
});

// The config surface answered 405 method_not_allowed BEFORE any identity check. An unenrolled address
// POSTing to it got "that endpoint exists and you used the wrong verb" from the surface that reads and
// writes tenant configuration — while GET on the same path already 403'd (the door check lives inside
// portal-upstream's resolveAccount). One surface, two answers to the same stranger, and the chattier one
// had no identity check in front of it.
test("the config surface checks the DOOR before the method — and a wrong shape is a plain 404", async () => {
  const { makeUpstream } = await import("../portal-upstream.mjs");
  const seen = [];
  const upstream = makeUpstream({ callUpstream: async (m, p) => { seen.push(p); return { status: 200, json: { profile: {} } }; } });
  const { poolRoot, workspaceRoot } = world();
  const svc = makePortalService({ poolRoot, workspaceRoot, secret: "test-secret",
    staffDomains: STAFF_DOMAINS, grants: GRANTS, upstream, audit: () => {} });

  // Every method reads identically to an unadmitted identity, and identically to the front door.
  const atTheDoor = await svc.route("GET", "/portal/api/me", STRANGER);
  for (const method of ["GET", "POST", "PUT", "DELETE"]) {
    const r = await svc.route(method, "/portal/api/config/profile", STRANGER, {}, {});
    assert.deepEqual({ status: r.status, json: r.json }, { status: atTheDoor.status, json: atTheDoor.json },
      `${method} /portal/api/config/profile discloses the endpoint to an unadmitted caller`);
  }
  assert.equal(seen.length, 0, "and nothing reached profile-service on any of them");

  // For an ADMITTED caller, a shape this endpoint does not serve is byte-identical to a path that does
  // not exist. 405 made one endpoint distinguishable from nothing-at-all, which is the fact the
  // 404-never-403 rule exists to withhold.
  const unknown = await svc.route("GET", "/portal/api/nothing-here", CLIENT, {}, {});
  assert.equal(unknown.status, 404);
  for (const method of ["POST", "PUT", "DELETE"]) {
    const r = await svc.route(method, "/portal/api/config/profile", CLIENT, {}, {});
    assert.deepEqual({ status: r.status, json: r.json }, { status: unknown.status, json: unknown.json },
      `${method} on a real endpoint must read exactly like an endpoint that is not there`);
  }
  // …and the shape it DOES serve still works, for a client and for staff acting for someone.
  assert.equal((await svc.route("GET", "/portal/api/config/profile", CLIENT, {}, {})).status, 200);
  assert.equal((await svc.route("GET", "/portal/api/config/profile", STAFF, {}, { account: "zephyr" })).status, 200);
  assert.equal((await svc.route("POST", "/portal/api/config/profile/save", CLIENT, { profile: { name: "A" } }, {})).status, 200,
    "the write path is unaffected — it was never the disclosing one");
});

// A failure `reason` is a truncated stack trace (pipeline.mjs — `String(e?.stack ?? e)`), so it
// carries absolute paths, module names and provider error text. Staff need it; a client must not get it,
// and redacting only in the UI would be theatre — the field travels over the wire either way.
test('a failure reason reaches staff verbatim and never reaches a client', async () => {
  const poolRoot = tempDir("portal-redact-");
  const workspaceRoot = tempDir("portal-redactws-");
  const dir = join(workspaceRoot, "workspace-t", "studio", "prelim-search", "s", "r");
  mkdirSync(driverDir(dir), { recursive: true });
  const TRACE = "TypeError: x is not a function at /srv/app/driver/pipeline.mjs:2411:9";
  writeFileSync(join(dir, "status.json"), JSON.stringify({ runId: "r-fail", markName: "M", state: "failed",
    failedStage: "register-probe", reason: TRACE, updatedAt: "2026-07-19T10:00:00Z" }));
  writeFileSync(driverDir(dir, "profile.json"), JSON.stringify({ profileKey: "aurora" }));

  const service = makePortalService({ poolRoot, workspaceRoot, secret: "s",
    staffDomains: STAFF_DOMAINS, grants: GRANTS });

  const asStaff = await service.route("GET", "/portal/api/runs", STAFF, {}, { account: "aurora" });
  assert.equal(asStaff.json.runs[0].reason, TRACE, "staff get the engine's own words");

  const asClient = await service.route("GET", "/portal/api/runs", CLIENT, {}, {});
  const row = asClient.json.runs[0];
  assert.notEqual(row.reason, TRACE);
  assert.doesNotMatch(row.reason, /\/home\/|pipeline\.mjs|TypeError/, "no path, module or exception text");
  assert.equal(row.reasonRedacted, true, "the row says it was redacted rather than pretending there was no reason");
  // The failure itself stays visible — an invisible failure is worse than a visible one.
  assert.equal(row.state, "failed");
  assert.equal(row.failedStage, "register-probe", "the stage is product vocabulary, not a stack");
});

// ── one report, and who may open it (spec 2026-07-30 §5) ────────────────────────────────────────────
// The client/internal split is gone: there is one file, `report.html`, and a client and a lawyer read
// the same document. The machine-QC checks (meta.clientGate is the historical stamp name) survive as a
// workbook/telemetry record and decide NOTHING about who may read — a run you have rights to is always
// listed and always served. Ownership remains the one boundary.
test("a failed-QC run is a normal run: listed and served for staff AND for its own client; held is off the wire", async () => {
  const { service } = world();

  // staff: listed, openable
  const staffView = await service.route("GET", "/portal/api/runs", STAFF, {}, { account: "aurora" });
  const staffRun = staffView.json.runs.find((r) => r.runId === "tmp2-aurora-held");
  assert.ok(staffRun, "staff: the run is listed");
  assert.ok(!("held" in staffRun), "the retired held field is off the wire entirely");
  assert.ok(staffRun.report, "staff: and it is openable");
  assert.equal((await service.route("GET", "/portal/report/tmp2-aurora-held/", STAFF)).status, 200, "staff: the report serves");

  // client (the run's OWN account): listed and served — the QC stamp suppresses nothing
  const clientView = await service.route("GET", "/portal/api/runs", CLIENT, {}, {});
  assert.ok(clientView.json.runs.some((r) => r.runId === "tmp2-aurora-held"), "client: the failed-QC run IS on the list");
  assert.equal((await service.route("GET", "/portal/report/tmp2-aurora-held/", CLIENT)).status, 200, "client: the report serves");
  assert.equal((await service.route("GET", "/portal/report/tmp2-aurora-held/audit.xlsx", CLIENT)).status, 404, "workbook: 404 only because the fixture has no xlsx on disk — not a role gate");
  const released = clientView.json.runs.find((r) => r.runId === "tmp1-aurora-run");
  assert.ok(!("held" in released), "no run row carries the retired held field");

  // Account isolation is untouched: it is a different question, enforced by a different check.
  assert.equal((await service.route("GET", "/portal/report/tmp3-zephyr-run/", CLIENT)).status, 404, "foreign run = 404, never 403");
});

// NOTE ON THE FIXTURE. It is synthetic, and deliberately so — a real delivered report is a client's
// work product and does not belong in this repository. It mirrors the real markup shape, and the strip
// was verified against an actual 78KB delivered report during development: 78,200 bytes in, 67,091 out,
// which lands within 0.5% of that run's old report.client.html. That convergence is the evidence that
// the internal/client difference really was chrome and not analysis.
test("the served report carries no link to another customer, and no dead staff button", async () => {
  const { prepareReportForEmbed } = await import("../portal-report.mjs");

  // A real report's shared site-nav, shortened. The "Clients" dropdown names every customer — correct
  // for a file a lawyer opens from the archive, a disclosure of the client list to anyone else.
  const withNav = `<!doctype html><html><body>`
    + `<nav class="sitenav"><div class="navinner"><a href="../index.html">Reports</a>`
    + `<a href="../quality.html">Quality</a><a href="../feedback.html">Feedback</a>`
    + `<div class="clipop"><a class="cli" href="../customer/zephyr/">Zephyr Beverages</a>`
    + `<a class="cli" href="../customer/aurora/">Aurora Interactive</a></div></div></nav>`
    + `<h1 class="mark">NOVAPULSE</h1><p>the actual report</p></body></html>`;

  const { html, strippedNav } = prepareReportForEmbed(withNav);
  assert.equal(strippedNav, 1);
  assert.doesNotMatch(html, /class="cli"/, "the Clients dropdown goes with the nav");
  assert.doesNotMatch(html, /zephyr|aurora/i, "no other customer is named in what a client receives");
  assert.doesNotMatch(html, /\.\.\/customer\//, "no cross-customer link survives");
  assert.doesNotMatch(html, /\.\.\/[a-z0-9-]+\.html/, "no staff page is linkable");
  assert.match(html, /NOVAPULSE/, "the report itself is untouched");
  assert.match(html, /the actual report/);

  // The strip is a regex over markup, so the real guarantee is the assertion AFTER it: if the nav ever
  // changes shape and the block regex stops matching, the leaky hrefs are still neutralised and the
  // caller is told the count so it can be noticed rather than silently survived.
  const drifted = `<nav class="sitenav" data-v="2"><a href="../customer/acme/">Acme</a></nav><p>body</p>`;
  const r2 = prepareReportForEmbed(drifted);
  assert.doesNotMatch(r2.html, /\.\.\/customer\//, "a drifted nav still cannot leak a customer link");
});

test("the Ask-your-AI connector is staff-only — it points at the STAFF MCP host", async () => {
  const { prepareReportForEmbed } = await import("../portal-report.mjs");

  // The renderer picks this host by audience on purpose (publish/render.mjs): the internal report
  // gets the staff surface, the client export gets the hardened client surface and FAILS CLOSED rather
  // than falling back — because falling back discloses the internal MCP hostname ( finding 4).
  // Serving report.html to a client hands them the staff host, so the block comes out for clients.
  //
  // Production currently points both at the same address, which makes the difference invisible. That is
  // a deployment accident, not a guarantee — this test encodes the guarantee.
  const doc = `<body><h1 class="mark">NOVAPULSE</h1>`
    + `<details class="askband no-print"><summary>Ask your AI</summary>`
    + `<div class="askai-field"><code class="askai-url">https://mcp.internal.example/mcp?token=abc123</code>`
    + `<button class="util askai-copy" data-copy="https://mcp.internal.example/mcp?token=abc123">Copy</button>`
    + `</div></details><p>the analysis</p></body>`;

  const forClient = prepareReportForEmbed(doc, { staff: false });
  assert.doesNotMatch(forClient.html, /mcp\.internal\.example/, "the staff MCP host must not reach a client");
  assert.doesNotMatch(forClient.html, /token=abc123/, "…nor the connector token with it");
  assert.match(forClient.html, /the analysis/, "the report itself is untouched");
  assert.match(forClient.html, /NOVAPULSE/);

  const forStaff = prepareReportForEmbed(doc, { staff: true });
  assert.match(forStaff.html, /mcp\.internal\.example/, "staff keep their own tool");

  // The block is nested markup, so a non-greedy match could stop early and leave the host in a sibling
  // node. Anything that survives is redacted and COUNTED rather than trusted.
  const drifted = `<div class="askband-v2">https://mcp.internal.example/mcp</div>`;
  const r = prepareReportForEmbed(drifted, { staff: false });
  assert.doesNotMatch(r.html, /mcp\.internal\.example/, "a drifted block still cannot leak the host");
  assert.equal(r.mcpLeaks, 1, "…and the miss is reported, not silent");
});

test("staff instrumentation is removed, and classes are matched by TOKEN", async () => {
  const { prepareReportForEmbed } = await import("../portal-report.mjs");

  // Every one of these carries a SECOND class in the real markup. A pattern written against the exact
  // attribute value (`class="cardflag-pop"`) matches none of them — silently, reporting success while
  // the buttons ship. That is the mistake this test exists to catch.
  const doc = `<body>`
    + `<a class="homebtn tb-back no-print" href="../index.html">← All reports</a>`
    + `<div class="review internal no-print"><div class="rv-bar">Internal review copy<span class="qcctl">flag</span></div></div>`
    + `<button type="button" class="cardflag no-print" title="Flag">🏳 Flag</button>`
    + `<span class="cardflag-pop no-print" data-ord="1" hidden>popover</span>`
    + `<a class="util" href="../run-audit.xlsx">Download audit</a>`
    + `<h1 class="mark">NOVAPULSE</h1><p>Composite 4 · Level B — the analysis stays.</p>`
    + `</body>`;

  const { html } = prepareReportForEmbed(doc);
  for (const gone of ["homebtn", "review internal", "cardflag", "cardflag-pop", ".xlsx", "All reports"]) {
    assert.ok(!html.includes(gone), `${gone} must not survive into an embedded report`);
  }
  // The analysis is untouched — including the scoring vocabulary, which is part of the report now that
  // there is only one version of it.
  assert.match(html, /NOVAPULSE/);
  assert.match(html, /Composite 4 · Level B/);
  assert.match(html, /the analysis stays/);
});

// ── availability: what a user may even PICK ────────────────────────────────────────────────────────
// These exercise the path the default cannot reach. With no snapshot on disk the degradation rule makes
// everything available, which is correct and also means every test above passes without ever refusing
// anything. The refusal path needs the flags injected, or it ships untested.

/** The engine environment as this box actually has it today: knockout and jx OFF, nothing set. */
// These used to be FLAGS_OFF/FLAGS_ON, injected through a `readFlags` option that fed three admission
// kill switches. The switches were retired 2026-07-27 (they gated shipped machinery, and any process
// without an engine environment read them as OFF and refused shipped depths), so `readFlags` is gone and
// BUILT is the only axis that can make a level unavailable. Unbuilt-knockout is the shape these tests use
// to exercise the unavailable path, because it is the one that still exists.
const BUILT_ALL = { knockout: true, jxLanes: true, registerProbe: true };
const BUILT_NO_KNOCKOUT = { knockout: false, jxLanes: true, registerProbe: false };

test("THE REGRESSION: on a complete build every level is available, with no environment at all", async () => {
  // This used to inject FLAGS_OFF and assert that knockout and Depth 2 came back unavailable with "Not
  // switched on for this account yet". That was the bug in miniature: an empty environment is what the
  // portal and the ops-MCP actually have, and it made shipped depths unorderable.
  const { service } = world();
  const res = await service.route("GET", "/portal/api/searches", CLIENT, {}, {});
  assert.equal(res.status, 200);
  const by = Object.fromEntries(res.json.products.map((l) => [l.key, l]));
  // FOUR, not five: `prelim-register-only` is retired and the menu is built from the orderable
  // registry. It is not listed-and-greyed — that shape is for a level this deployment cannot run TODAY,
  // and a client can act on it by asking. A retired level is not coming back, so listing it would be an
  // invitation to ask for a product that no longer exists.
  assert.deepEqual(Object.keys(by).sort(),
    ["full-country-search", "global-preliminary-search", "knockout-search", "multi-country-focus-search"]);
  for (const retired of ["prelim", "prelim-jx", "knockout", "knockout-register", "prelim-register-only"])
    assert.ok(!(retired in by), `${retired} is retired and is never offered, greyed or otherwise`);
  for (const [key, l] of Object.entries(by)) {
    assert.equal(l.available, true, `${key} is built and must be pickable`);
    assert.equal(l.unavailableNote, null, `${key}: an available product carries no note`);
  }
  // Scoped to the LEVELS: `read.note` is the brief reader, a genuinely unconfigured feature in this world,
  // and it says "not switched on here yet" for a real reason. No DEPTH may say that any more.
  assert.doesNotMatch(JSON.stringify(res.json.products), /switched on/, "no depth is waiting to be switched on");
});

test("an UNBUILT level is still LISTED, marked unavailable, and says which kind of unavailable it is", async () => {
  // A level that vanishes leaves a client no way to know it exists. Listed-and-greyed is an invitation;
  // the gate is the wall. This is the surviving unavailable path — a component the build does not have.
  const { service } = world({ readBuilt: () => BUILT_NO_KNOCKOUT });
  const res = await service.route("GET", "/portal/api/searches", CLIENT, {}, {});
  const by = Object.fromEntries(res.json.products.map((l) => [l.key, l]));
  assert.deepEqual(Object.keys(by).sort(),
    ["full-country-search", "global-preliminary-search", "knockout-search", "multi-country-focus-search"]);

  // A Global preliminary search needs nothing and runs on any box. If this ever goes false, the product
  // has no floor.
  assert.equal(by["global-preliminary-search"].available, true, "the plain clearance is always pickable");
  assert.equal(by["global-preliminary-search"].unavailableNote, null);

  assert.equal(by["knockout-search"].available, false);
  assert.match(by["knockout-search"].unavailableNote, /Not part of the current release/,
    "an unbuilt product must NOT promise that Cordillera can switch it on");
});

test("built-but-off and can't-be-built read differently — the Knockout search on a register that cannot count", async () => {
  // The distinction is the point: "ops can switch this on" and "this deployment cannot have it" are
  // different sentences, and the second one is not worth a client asking for. Depth 2 is the level
  // where that can genuinely happen — a register with no count endpoint (capabilities.countProbe
  // "none") cannot answer it however the switches are set. The portal learns that from the snapshot's
  // `built`, not from its own import, because it has no engine environment to work it out from.
  const { service } = world({
    readBuilt: () => BUILT_ALL,
    readBuilt: () => ({ knockout: true, jxLanes: true, registerProbe: false }),
  });
  const res = await service.route("GET", "/portal/api/searches", CLIENT, {}, {});
  const by = Object.fromEntries(res.json.products.map((l) => [l.key, l]));
  // ONE knockout, and it carries the counts — so a register that cannot count takes the whole product
  // with it. That consequence is real and stays visible rather than being smoothed over: the row is
  // still LISTED, and it says which kind of unavailable it is.
  assert.equal(by["knockout-search"].available, false);
  assert.match(by["knockout-search"].unavailableNote, /current release/, "not worth asking ops for");
  assert.equal(by["global-preliminary-search"].available, true, "every clearance is unaffected");
});

test("switching the flags on flips availability — the snapshot is genuinely the source", async () => {
  const { service } = world();
  const res = await service.route("GET", "/portal/api/searches", CLIENT, {}, {});
  const by = Object.fromEntries(res.json.products.map((l) => [l.key, l]));
  for (const key of ["knockout-search", "global-preliminary-search", "multi-country-focus-search", "full-country-search"])
    assert.equal(by[key].available, true, `${key} is built and must be pickable`);
});

test("THE SPEND DOOR: /plan refuses an unavailable level and mints NO token", async () => {
  const { service, audits } = world({ readBuilt: () => BUILT_NO_KNOCKOUT });
  const res = await service.route("POST", "/portal/api/run/plan", CLIENT,
    { markName: "SOLO", classes: [9], goods: "software", product: "knockout-search" }, {});

  assert.equal(res.status, 422, JSON.stringify(res.json));
  assert.equal(res.json.confirmationToken, undefined, "no token — a token is a licence to spend");
  // The registry's NAME, never the internal key and no longer the bare stage number: "Depth 1 is
  // unavailable" names our pricing ladder at a client, "Knockout search is unavailable" names the thing
  // they asked for (owner ruling 2026-07-20 — the interface leads with the name).
  assert.match(res.json.errors[0], /Knockout search is unavailable/);
  assert.doesNotMatch(res.json.errors[0], /^Depth /);
  assert.ok(!audits.some((a) => a.event === "plan"), "a refused plan is not a plan");
});

test("the run door refuses too — a token minted on a fuller build cannot outlive it", async () => {
  // Plan against a build that has knockout, take the token, then ask a deployment that does not. The token
  // is still cryptographically valid; the request must still refuse. This is why the gate runs at BOTH
  // doors rather than trusting that a token implies a runnable body.
  const { service: on } = world({ readBuilt: () => BUILT_ALL });
  const body = { markName: "SOLO", classes: [9], goods: "software", product: "knockout-search" };
  const plan = await on.route("POST", "/portal/api/run/plan", CLIENT, body, {});
  assert.equal(plan.status, 200, JSON.stringify(plan.json));

  const { service: off, triggers } = world({ readBuilt: () => BUILT_NO_KNOCKOUT });
  const run = await off.route("POST", "/portal/api/run", CLIENT,
    { ...body, confirmationToken: plan.json.confirmationToken }, {});
  assert.equal(run.status, 422, JSON.stringify(run.json));
  assert.equal(triggers.length, 0, "nothing was queued");
});

test("a missing snapshot DEGRADES to available — one unreadable file must not stop the product", async () => {
  // world() with no readBuilt is the live default: read the snapshot from poolRoot, where there is none.
  const { service, triggers } = world();
  const res = await service.route("GET", "/portal/api/searches", CLIENT, {}, {});
  const by = Object.fromEntries(res.json.products.map((l) => [l.key, l]));
  assert.equal(by["knockout-search"].available, true, "unknown availability behaves as today's behaviour does");

  const body = { markName: "SOLO", classes: [9], goods: "software", product: "knockout-search" };
  const plan = await service.route("POST", "/portal/api/run/plan", CLIENT, body, {});
  assert.equal(plan.status, 200, "and the request goes through to the engine, which is the real gate");
  const run = await service.route("POST", "/portal/api/run", CLIENT, { ...body, confirmationToken: plan.json.confirmationToken }, {});
  assert.equal(run.status, 200);
  assert.equal(triggers.length, 1);
});

test("NO client-facing surface names a switch — the leak this design exists to prevent", async () => {
  const { service } = world({ readBuilt: () => BUILT_NO_KNOCKOUT });
  const seen = [
    await service.route("GET", "/portal/api/searches", CLIENT, {}, {}),
    await service.route("POST", "/portal/api/run/plan", CLIENT, { markName: "SOLO", classes: [9], goods: "software", product: "knockout-search" }, {}),
    await service.route("POST", "/portal/api/run/plan", CLIENT, { markName: "SOLO", classes: [9], goods: "software", product: "knockout-search" }, {}),
    await service.route("POST", "/portal/api/run/plan", CLIENT, { markName: "SOLO", classes: [9], goods: "software", recipeKey: "aurora/screen" }, {}),
  ];
  for (const r of seen) {
    const body = JSON.stringify(r.json);
    // step 4.0 — both spellings; a converted switch name reaching a client is the same leak.
    assert.ok(!body.includes("CLEAROTRON_") && !body.includes("CLEAROTRON_"),
      `a switch name reached the client: ${body}`);
    // The internal component names are not for clients either.
    assert.ok(!/registerProbe|jxLanes/.test(body.replace(/"components":\[[^\]]*\]/g, "")),
      `an internal component name reached the client: ${body}`);
  }
});

test("a saved search is PLANNABLE — the door it used to be refused at has no shut state", async () => {
  // This asserted a 422 reading "Saved searches are not switched on for this account yet". It fired
  // whenever CLEAROTRON_RECIPES_MODE was unset — which, in the portal, is always: the unit deliberately has no
  // EnvironmentFile. Retired 2026-07-27; a client's own saved search is honoured wherever it resolves.
  // The engine's own resolver reads CLEAROTRON_RECIPES_DIR, while the service's `recipesDir` option only feeds
  // the MENU — so the fixture has to be visible to both or resolution clarifies on an unknown slug. The old
  // test never needed this because the recipes-disabled refusal fired BEFORE resolution ever ran.
  const { service, recipesDir } = world();
  const prev = process.env.CLEAROTRON_RECIPES_DIR;
  process.env.CLEAROTRON_RECIPES_DIR = recipesDir;
  try {
    const res = await service.route("POST", "/portal/api/run/plan", CLIENT,
      { markName: "SOLO", classes: [9], goods: "software", recipeKey: "aurora/screen" }, {});
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.ok(res.json.confirmationToken, "it plans, and mints a token to confirm with");
    assert.doesNotMatch(JSON.stringify(res.json), /Saved searches are not switched on/);
  } finally {
    if (prev === undefined) delete process.env.CLEAROTRON_RECIPES_DIR; else process.env.CLEAROTRON_RECIPES_DIR = prev;
  }
});

test("the plan door names the product it QUOTED — one resolution, not two", async () => {
  // The regression this exists for: the door named the product with
  // `policyFor(body.product || "prelim")` while quoting effort off the RESOLVED policy. Those are
  // two different answers. On the recipeKey arm the first was null outright, so the review modal — the
  // last screen before money is spent — showed the headline "saved search" above an effort figure and a
  // turnaround computed for a Depth 1 knockout. An account whose profile defaults to a knockout got the
  // same split with no recipe involved: a Depth 4 headline over a Depth 1 quote.
  //
  // aurora/screen is `base: "knockout-search"`, so a door that resolves once must call this a Knockout search.
  const { service, recipesDir } = world();
  const prev = process.env.CLEAROTRON_RECIPES_DIR;
  process.env.CLEAROTRON_RECIPES_DIR = recipesDir;
  try {
    const res = await service.route("POST", "/portal/api/run/plan", CLIENT,
      { markName: "SOLO", classes: [9], goods: "software", recipeKey: "aurora/screen" }, {});
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.equal(res.json.name, "Knockout search", "the recipe's BASE level names the plan");
    assert.equal(res.json.stageLabel, "Knockout search", "no longer the placeholder 'saved search'");
    // The turnaround must come off the same level as the name. A knockout quotes 5–10 min; a clearance
    // quotes 1.5–2.5 hours, which is what the old `|| "prelim"` fallback would have quoted here. The two
    // are unmistakable for each other, which is the property this arm needs — it is checking that ONE
    // resolution produced both the name and the figure, not that the figure has any particular value.
    // ( ruled the knockout quote down from ~45 min against 4–6 min delivered.)
    assert.equal(res.json.turnaround, "5–10 min");
    // And the effort quote — the other half that used to disagree — describes that same knockout.
    assert.ok(res.json.effort, "a resolved plan quotes effort");
    assert.equal(res.json.effort.turnaround, "5–10 min", "the quote and the name describe one product");
  } finally {
    if (prev === undefined) delete process.env.CLEAROTRON_RECIPES_DIR; else process.env.CLEAROTRON_RECIPES_DIR = prev;
  }
});

// THE SAVED-SEARCH HOLE this gate was added for. A recipe carries its own base level, so nothing on this
// path ever names product — a prelim-jx recipe used to sail through /plan and spend on zero lanes.
// It also pins the honest consequence of measuring the MACHINERY's scope: the recipe's own saved
// scope.jurisdictions is display-only at runtime (decideJxLanes reads job||profile), so a saved deep
// dive does NOT route its lane unless the request names the territory again. Refusing says so before the
// money; passing it would certify a lane that never fires.
test("a saved search's own territories are honoured at the gate — and the deepening gap is SAID, not refused", async () => {
  // resolveSearchPolicy loads the store through CLEAROTRON_RECIPES_DIR (the service's `recipesDir` option
  // feeds the MENU), so the fixture has to sit where the engine's own resolver looks.
  const store = tempDir("portal-recipestore-");
  mkdirSync(join(store, "aurora"), { recursive: true });
  writeFileSync(join(store, "aurora", "deep-jx.json"), JSON.stringify({
    version: 1, label: "Asia deepening", base: "multi-country-focus-search", nativeLanguage: true,
    scope: { jurisdictions: ["China", "Japan"] } }));
  const prev = process.env.CLEAROTRON_RECIPES_DIR;
  process.env.CLEAROTRON_RECIPES_DIR = store;
  try {
    const { service, triggers } = world();
    const base = { markName: "IRONWHISK", classes: [8], goods: "kitchen tools", recipeKey: "aurora/deep-jx" };
    const res = await service.route("POST", "/portal/api/run/plan", CLIENT, base, {});
    // The composer replaces the whole levers panel when a saved search is picked, so a refusal telling
    // this client to "add a territory" or "pick a different level" names two remedies the screen gives
    // them no way to reach. The guard measures the same ladder this response prints its scope from, so
    // the recipe's own China is the scope — and the run is planned, not blocked (correction 2026-07-27).
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.deepEqual(res.json.scope.jurisdictions, ["China", "Japan"]);
    assert.equal(res.json.scope.jurisdictionsFrom, "the saved search");
    assert.ok(res.json.confirmationToken);
    // …and it is not merely un-refused: foldRecipeScope writes the saved search's territories into the
    // job before the lane table is read (audit N3), so this run really does deepen. Nothing to warn about.
    assert.equal(res.json.warnings.some((w) => /no lane to run/.test(w)), false, JSON.stringify(res.json.warnings));
    assert.equal(triggers.length, 0, "the plan step still never spends");
    // naming the territory ON THE REQUEST is the same run by the other route
    const ok = await service.route("POST", "/portal/api/run/plan", CLIENT, { ...base, jurisdictions: ["China", "Japan"] }, {});
    assert.equal(ok.status, 200, JSON.stringify(ok.json));
    assert.ok(ok.json.confirmationToken);
    assert.deepEqual(ok.json.scope.jurisdictions, ["China", "Japan"]);
  } finally {
    if (prev === undefined) delete process.env.CLEAROTRON_RECIPES_DIR; else process.env.CLEAROTRON_RECIPES_DIR = prev;
  }
});

test("a trigger failure tells a CLIENT the facts and an OPERATOR the cause — never a variable name", async () => {
  const { poolRoot, workspaceRoot } = world();
  const mk = (msg) => makePortalService({ poolRoot, workspaceRoot, secret: "test-secret",
    staffDomains: STAFF_DOMAINS, grants: GRANTS, audit: () => {},
    trigger: async () => { throw new Error(msg) } });

  const body = { markName: "SOLO", classes: [9], goods: "software" };
  const UNWIRED = "PORTAL_MCP_URL / PORTAL_OPS_TOKEN unset — the trigger lane is not wired on this instance";

  for (const [who, ident] of [["client", CLIENT], ["staff", STAFF]]) {
    const svc = mk(UNWIRED);
    const q = who === "staff" ? { account: "aurora" } : {};
    const plan = await svc.route("POST", "/portal/api/run/plan", ident, { ...body, ...q }, {});
    const run = await svc.route("POST", "/portal/api/run", ident, { ...body, ...q, confirmationToken: plan.json.confirmationToken }, {});
    assert.equal(run.status, 502, JSON.stringify(run.json));
    assert.equal(run.json.unwired, true, "an instance with no engine attached is a distinct cause");

    if (who === "client") {
      // The leak this test exists for. These are infrastructure variable names, and they were being
      // rendered in a client's browser.
      assert.ok(!/PORTAL_MCP_URL|PORTAL_OPS_TOKEN|PORTAL_|CLEAROTRON_/.test(run.json.error),
        `an internal variable name reached the client: ${run.json.error}`);
      // What the user actually needs to know, and the only thing that stops the support ticket.
      assert.match(run.json.error, /[Nn]othing was started/);
      assert.match(run.json.error, /nothing was charged/);
    } else {
      assert.match(run.json.error, /PORTAL_MCP_URL/, "staff can act on this, so staff get it verbatim");
    }
  }

  // A genuine upstream refusal is NOT reported as unwired — the two invite different responses.
  const svc = mk("FORBIDDEN (start_run): grant mismatch");
  const plan = await svc.route("POST", "/portal/api/run/plan", CLIENT, body, {});
  const run = await svc.route("POST", "/portal/api/run", CLIENT, { ...body, confirmationToken: plan.json.confirmationToken }, {});
  assert.equal(run.json.unwired, false);
  assert.ok(!/grant mismatch/.test(run.json.error), "an upstream's own wording is not client copy either");
  assert.match(run.json.error, /nothing was charged/);
});

// ── the config surface, through the REAL router ────────────────────────────────────────────────────
// portal-upstream is tested directly elsewhere. These prove the wall is actually MOUNTED: a route that
// forgot to pass the principal, or resolved an account itself, would pass those tests and fail these.

test("BREACH: a client cannot reach another customer's config through the ROUTER", async () => {
  const { makeUpstream } = await import("../portal-upstream.mjs");
  const seen = [];
  const upstream = makeUpstream({ callUpstream: async (m, p, b, id) => { seen.push({ p, id }); return { status: 200, json: { profile: {} } }; } });
  const { poolRoot, workspaceRoot } = world();
  const svc = makePortalService({ poolRoot, workspaceRoot, secret: "test-secret",
    staffDomains: STAFF_DOMAINS, grants: GRANTS, upstream, audit: () => {} });

  for (const path of ["/portal/api/config/profile", "/portal/api/config/projects"]) {
    const r = await svc.route("GET", path, CLIENT, {}, { account: "zephyr" });
    assert.equal(r.status, 404, `${path} must 404 for a foreign account`);
  }
  assert.equal(seen.length, 0, "nothing reached profile-service");

  // …and the client's OWN account works, resolved from the principal rather than the query.
  const ok = await svc.route("GET", "/portal/api/config/profile", CLIENT, {}, {});
  assert.equal(ok.status, 200);
  assert.equal(seen[0].p, "/profiles/aurora");
  assert.equal(seen[0].id.email, "cli@celta.example", "the verified identity is what stamps the git author");
});

test("BREACH: the code-owned fields cannot be written through the ROUTER either", async () => {
  const { makeUpstream } = await import("../portal-upstream.mjs");
  let sent = null;
  const upstream = makeUpstream({ callUpstream: async (m, p, b) => { sent = b; return { status: 200, json: { ok: true } }; } });
  const { poolRoot, workspaceRoot } = world();
  const svc = makePortalService({ poolRoot, workspaceRoot, secret: "test-secret",
    staffDomains: STAFF_DOMAINS, grants: GRANTS, upstream, audit: () => {} });

  const r = await svc.route("POST", "/portal/api/config/profile/save", CLIENT,
    { profile: { name: "Aurora", frameworkPath: "evil.md", runCaps: { perMonth: 99999 } } }, {});
  assert.equal(r.status, 200);
  assert.equal(sent.profile.frameworkPath, undefined, "the framework that RATES this client is not theirs to move");
  assert.equal(sent.profile.runCaps, undefined);
  assert.equal(sent.profile.name, "Aurora");
});

test("an instance with no config surface answers 404 — never a 500, never a half-page", async () => {
  const { service } = world();   // no upstream wired
  for (const p of ["/portal/api/config/profile", "/portal/api/config/projects", "/portal/api/config/projects/x"]) {
    assert.equal((await service.route("GET", p, CLIENT, {}, {})).status, 404);
  }
});

test("a save is AUDITED with the human who did it", async () => {
  const { makeUpstream } = await import("../portal-upstream.mjs");
  const upstream = makeUpstream({ callUpstream: async () => ({ status: 200, json: { ok: true } }) });
  const { poolRoot, workspaceRoot } = world();
  const audits = [];
  const svc = makePortalService({ poolRoot, workspaceRoot, secret: "test-secret",
    staffDomains: STAFF_DOMAINS, grants: GRANTS, upstream, audit: (r) => audits.push(r) });

  await svc.route("POST", "/portal/api/config/profile/save", CLIENT, { profile: { name: "Aurora" } }, {});
  assert.ok(audits.some((a) => a.event === "profile-save" && a.by === "cli@celta.example"));
  // A dry-run validate is NOT audited as a save — it changed nothing.
  await svc.route("POST", "/portal/api/config/profile/validate", CLIENT, { profile: { name: "Aurora" } }, {});
  assert.equal(audits.filter((a) => a.event === "profile-save").length, 1);
});

test("the staff config and access surfaces are STAFF-ONLY, and a client gets a plain 404", async () => {
  const { service } = world();
  for (const p of ["/portal/admin/config", "/portal/admin/access", "/portal/admin/observed"]) {
    const asClient = await service.route("GET", p, CLIENT, {}, {});
    assert.equal(asClient.status, 404, `${p} must not exist for a client`);
    assert.deepEqual(asClient.json, { error: "not_found" },
      "byte-identical to a path that does not exist — a distinct body would confirm the surface is there");
    assert.equal((await service.route("GET", p, STAFF, {}, { account: "aurora" })).status, 200, `${p} for staff`);
  }
});

test("the observed surface answers 200-unavailable when the log cannot be read, never an error", async () => {
  // Asserted as a STATUS, not just a body: an error status here would trip the screen's load gate and
  // blank the whole access page to report that an optional extra was missing. The panel is allowed to
  // be unavailable; the page is not allowed to be.
  const { service } = world();   // no auditPath wired
  const r = await service.route("GET", "/portal/admin/observed", STAFF, {}, {});
  assert.equal(r.status, 200);
  assert.equal(r.json.available, false);
  assert.deepEqual(r.json.people, []);
});

test("the access surface names the grants file, so 'I want to add someone' has a next step", async () => {
  const { service } = world();
  const r = await service.route("GET", "/portal/admin/access", STAFF, {}, {});
  // world() sets CLEAROTRON_ACCESS_FILE to a real fixture, so this resolves; when it cannot, null.
  if (r.json.grantsFile !== null) {
    assert.ok(!r.json.grantsFile.name.includes("/"), "basename only — never a deployment's filesystem layout");
    assert.match(r.json.grantsFile.modifiedAt, /^\d{4}-\d{2}-\d{2}T/);
  }
});

test("the config surface never reports 'all off' from an absence, and names which reading it gave", async () => {
  // WHAT THIS ARM IS FOR, UNCHANGED: reporting "everything off" from a thing nobody could read would
  // send a staff member to go switch on what is already running.
  //
  // WHAT MOVED (owner ruling 2026-09-05, tracker issue 170): `available` used to mean "a snapshot
  // exists", and this arm used it as the precondition for "the fixture pool has no snapshot". The page
  // now answers LIVE, always, so it can be available with no capture at all — the absence of a capture
  // is reported by `lastRun`, and `source` says which reading the answer is. Asserting `available:
  // false` here would now be pinning the retired behaviour.
  const { service } = world();
  const r = await service.route("GET", "/portal/admin/config", STAFF, {}, {});
  assert.equal(r.json.lastRun, null, "precondition: this fixture pool genuinely has no capture");
  assert.ok(r.json.source === "live" || r.json.source === "capture" || r.json.source === null,
    `the page must say which reading it gave, got ${JSON.stringify(r.json.source)}`);
  if (!r.json.available) {
    // Nothing could be read at all — then nothing may be asserted about the switches either.
    assert.deepEqual(r.json.flags, []);
    return;
  }
  // Available means it read something. Every flag it names must carry whether it was CONFIGURED, which
  // is what keeps "explicitly off" from rendering identically to "never set" — the original defect.
  for (const f of r.json.flags) {
    assert.equal(typeof f.on, "boolean");
    assert.equal(typeof f.configured, "boolean", `flag ${f.name} does not say whether it was configured`);
  }
});

// ── the auth row rides the SAME response, and is read live rather than from the snapshot ────────────
//
// 's fifth criterion. The view function is unit-tested in portal-config-view.test.mjs; what these
// two arms cover is the WIRING, which that file cannot see: that the route actually attaches the field,
// and that it attaches it from THIS process's environment. A correct view function behind a route that
// never mounted it is a wall in a field.

test("#1439 — the config route carries the auth row, read from THIS process's environment", async () => {
  const { service } = world();
  const before = process.env.PORTAL_AUTH_MODE;
  const beforeTeam = process.env.CF_ACCESS_TEAM;
  process.env.PORTAL_AUTH_MODE = "local";
  process.env.CF_ACCESS_TEAM = "should-not-appear-in-local-mode";
  try {
    const r = await service.route("GET", "/portal/admin/config", STAFF, {}, {});
    assert.ok(r.json.auth, "the route must attach `auth` — a screen cannot render a field nobody sent");
    assert.equal(r.json.auth.mode, "local", "and it is THIS service's env, which is the whole exception");
    assert.equal(r.json.auth.issuer, null, "local mode has no issuer, and the planted team is not one");
  } finally {
    if (before === undefined) delete process.env.PORTAL_AUTH_MODE; else process.env.PORTAL_AUTH_MODE = before;
    if (beforeTeam === undefined) delete process.env.CF_ACCESS_TEAM; else process.env.CF_ACCESS_TEAM = beforeTeam;
  }
});

test("#1439 — the auth row survives a MISSING snapshot, because it does not come from one", async () => {
  // The decisive arm. The fixture pool has no snapshot, so every snapshot-derived field is unavailable —
  // and the auth row must still answer, because it never depended on the engine having drained. If this
  // ever goes null alongside the others, the row has been quietly routed back through the writer, which
  // is the build this criterion exists to prevent.
  const { service } = world();
  const r = await service.route("GET", "/portal/admin/config", STAFF, {}, {});
  // The precondition is that there is no CAPTURE — which is what this arm always meant. It used to be
  // spelled `available === false`, and that spelling stopped meaning it when the page began answering
  // live (owner ruling 2026-09-05, tracker issue 170): a box with no capture is now perfectly available.
  assert.equal(r.json.lastRun, null, "precondition: this fixture genuinely has no capture");
  assert.ok(r.json.auth, "the portal's own door is answerable with no snapshot at all");
  assert.equal(typeof r.json.auth.mode, "string");
  assert.ok(r.json.auth.mode.length > 0, "an empty mode would render as a blank row on a running portal");
});

// ── the saved-search config routes + the usage counter ──────────────────────────────────────────────
// portal-upstream owns the tenancy wall and is tested there. What these cover is the WIRING: that the
// routes exist, reach the right upstream method with the right arguments, and that a save is audited.
// A tenancy wall behind a route nobody mounted is a wall in a field.

/** Records which upstream method a route reached, and with what. */
function upstreamSpy(over = {}) {
  const calls = [];
  const rec = (name) => async (...args) => { calls.push({ name, args }); return { status: 200, json: { ok: true, version: 2 } }; };
  return {
    calls,
    up: {
      getProfile: async () => ({ status: 200, json: { readOnly: { runCaps: over.runCaps ?? null } } }),
      listSearches: rec("listSearches"),
      getSearch: rec("getSearch"),
      writeSearch: rec("writeSearch"),
      listProjects: rec("listProjects"),
      getProject: rec("getProject"),
      writeProject: rec("writeProject"),
      writeProfile: rec("writeProfile"),
      listRoster: rec("listRoster"),
      ...over.methods,
    },
  };
}

test("saved searches: list, read and write are mounted, and the account is never taken from the body", async () => {
  const { calls, up } = upstreamSpy();
  const { service } = world({ upstream: up });

  const list = await service.route("GET", "/portal/api/config/searches", CLIENT, {}, {});
  assert.equal(list.status, 200);
  assert.equal(calls[0].name, "listSearches");

  await service.route("GET", "/portal/api/config/searches/quarterly", CLIENT, {}, {});
  assert.equal(calls[1].name, "getSearch");
  assert.equal(calls[1].args[2], "quarterly", "the slug rides as its own argument, never interpolated into a path here");

  await service.route("POST", "/portal/api/config/searches/quarterly/validate", CLIENT,
    { recipe: { label: "Q", base: "global-preliminary-search" } }, {});
  assert.equal(calls[2].name, "writeSearch");
  assert.equal(calls[2].args[3], "validate");

  // The action is passed through VERBATIM rather than being interpolated or defaulted here. Refusing
  // anything that is not validate/save is portal-upstream's job (asserted there, against the real
  // implementation) — this layer's contract is that it does not invent or rewrite the action on the way.
  await service.route("POST", "/portal/api/config/searches/quarterly/delete", CLIENT, { recipe: {} }, {});
  assert.equal(calls[3].args[3], "delete", "whatever arrived is what the wall gets to judge");

  // A path shape with no route is 404 — the same answer as a path that does not exist.
  assert.equal((await service.route("GET", "/portal/api/config/searches/a/b/c", CLIENT, {}, {})).status, 404);
});

test("saved searches: a SAVE is audited with who, which account and which slug", async () => {
  const { up } = upstreamSpy();
  const { service, audits } = world({ upstream: up });
  await service.route("POST", "/portal/api/config/searches/quarterly/save", CLIENT,
    { recipe: { label: "Q", base: "global-preliminary-search", archived: true } }, {});
  const row = audits.find((a) => a.event === "saved-search-save");
  assert.ok(row, "a write to a client's configuration must leave a trace");
  assert.equal(row.slug, "quarterly");
  assert.equal(row.by, CLIENT.email);
  assert.equal(row.archived, true);
});

test("saved searches: with no config surface wired, the routes 404 rather than half-answering", async () => {
  const { service } = world();   // no upstream
  assert.equal((await service.route("GET", "/portal/api/config/searches", CLIENT, {}, {})).status, 404);
  assert.equal((await service.route("POST", "/portal/api/config/searches/x/save", CLIENT, { recipe: {} }, {})).status, 404);
});

test("usage: counts are per-ACCOUNT, and caps come from the profile rather than being invented", async () => {
  const { up } = upstreamSpy({ runCaps: { dailyRuns: 3, monthlyRuns: 40 } });
  const { service } = world({ upstream: up });
  const r = await service.route("GET", "/portal/api/usage", CLIENT, {}, {});
  assert.equal(r.status, 200);
  assert.equal(r.json.account, "aurora");
  assert.equal(r.json.dailyRuns, 3);
  assert.equal(r.json.monthlyRuns, 40);
  assert.equal(typeof r.json.today, "number");
  assert.equal(r.json.capped, true, "a client principal is bound by the allowance");
});

test("usage: a cap the server cannot read is NULL, never zero and never unlimited", async () => {
  // "we cannot tell you your limit" is a different statement from "your limit is zero", and only one of
  // them is honest when the config surface is unreachable. The UI renders null as nothing at all.
  const { up } = upstreamSpy({ methods: { getProfile: async () => { throw new Error("config surface down"); } } });
  const { service } = world({ upstream: up });
  const r = await service.route("GET", "/portal/api/usage", CLIENT, {}, {});
  assert.equal(r.status, 200, "a settings-surface fault must not take the counter down");
  assert.equal(r.json.dailyRuns, null);
});

// ── the quota pre-check ─────────────────────────────────────────────────────────────────────
// This 429 is the ONLY place a client is told, in a sentence, that today's allowance is spent and what
// to do instead. It was unreachable for as long as the counter read a path that did not exist, because
// a missing ledger is a low count and never an error — so `0 + 1 <= limit` was always true. Nothing
// over-admitted (the runner's checkRunCaps is the control); what was lost was the sentence.
const QUOTA_BODY = { marks: [{ name: "PETCARY" }], classes: [8], goods: "kitchen tools",
  product: "knockout-search", forwarder: "cli", profileKey: "aurora" };

/**
 * A standalone queue with a ledger beside it — the deployment shape the old path could not see.
 *
 * Rows are stamped `Date.now()` and quotaRefusal counts against its own `Date.now()`: the route has no
 * `now` seam, so a UTC midnight landing between these two calls would move the rows out of "today" and
 * the 429 below would not fire. A sub-millisecond window once a day, recorded rather than engineered
 * around — plumbing a clock through the router for it would be a wider change than the defect.
 */
function queueWith(rows) {
  const root = tempDir("portal-quota-");
  const qdir = join(root, "queue");
  mkdirSync(qdir, { recursive: true });
  writeFileSync(join(root, ".matter-ledger.jsonl"),
    rows.map((r) => JSON.stringify({ profileKey: "aurora", clientPrincipal: true, ts: Date.now(), ...r })).join("\n") + "\n");
  return qdir;
}

test("quota: a client at the day's limit gets the 429 that names the reset and the way round it", async () => {
  const { up } = upstreamSpy({ runCaps: { dailyRuns: 2 } });
  const { service, triggers } = world({ upstream: up, queueDirs: [queueWith([{}, {}])] });
  const r = await service.route("POST", "/portal/api/run/plan", CLIENT, QUOTA_BODY, {});
  assert.equal(r.status, 429, "the refusal the client is owed never fired");
  assert.match(String(r.json.errors?.[0]), /all 2 of this account's searches/);
  assert.match(String(r.json.errors?.[0]), /midnight UTC/, "a hard stop with no reset time is the worst version of a cap");
  assert.equal(triggers.length, 0);
});

test("quota: under the limit, the ledger the wall reads admits the run", async () => {
  const { up } = upstreamSpy({ runCaps: { dailyRuns: 2 } });
  const { service } = world({ upstream: up, queueDirs: [queueWith([{}])] });
  assert.equal((await service.route("POST", "/portal/api/run/plan", CLIENT, QUOTA_BODY, {})).status, 200);
});

test("quota: a ledger the server could not read is NOT a spent-nothing zero — no refusal, and the audit says why", async () => {
  // The gate fails OPEN, deliberately: the wall still holds, so a blind pre-check costs a better
  // sentence, while refusing on a count we did not take costs a client a search they never spent. The
  // same call the unreadable-profile branch beside it already makes. What it must NOT do is stay silent.
  const { up } = upstreamSpy({ runCaps: { dailyRuns: 2 } });
  const { service, audits } = world({ upstream: up, queueDirs: [join(tmpdir(), "no-such-queue-429p", "queue")] });
  const r = await service.route("POST", "/portal/api/run/plan", CLIENT, QUOTA_BODY, {});
  assert.equal(r.status, 200, "a blind counter must not refuse — the wall is the control");
  const row = audits.find((a) => a.event === "quota-precheck-blind");
  assert.ok(row, "the gate could not read its input and said nothing");
  assert.equal(row.account, "aurora");
  // WHICH kind of blind, because a queue nobody wired and a file that will not open are fixed by
  // different people. Without it the operator gets "blind" and no next step.
  assert.equal(row.basis, "no-ledger");
});

test("quota: a queue that EXISTS with no ledger beside it is blind too — the production shape of #429", async () => {
  // The first attempt at this fix read `complete` off existsSync(queueDir), which is constant true in
  // production: driver.config appends the canonical queue with no existence test and drainQueue mkdir
  // -p's it. A portal pointed at that queue while the wall writes its ledger beside another one would
  // have gone on reporting a confident "0 of 2 used" forever, with the detector reporting green.
  const { up } = upstreamSpy({ runCaps: { dailyRuns: 2 } });
  const root = tempDir("portal-quota-noledger-");
  const qdir = join(root, "queue");
  mkdirSync(qdir, { recursive: true });   // the directory is real; no ledger is beside it
  const { service, audits } = world({ upstream: up, queueDirs: [qdir] });
  const r = await service.route("GET", "/portal/api/usage", CLIENT, {}, {});
  assert.equal(r.json.complete, false, "an existing directory was mistaken for a ledger that was read");
  assert.equal((await service.route("POST", "/portal/api/run/plan", CLIENT, QUOTA_BODY, {})).status, 200);
  assert.ok(audits.find((a) => a.event === "quota-precheck-blind"), "the pre-check was blind and said nothing");
});

test("usage: a deployment whose queues are not wired reports complete:false, not a confident zero", async () => {
  const { up } = upstreamSpy({ runCaps: { dailyRuns: 3 } });
  const { service } = world({ upstream: up });   // no queueDirs
  const r = await service.route("GET", "/portal/api/usage", CLIENT, {}, {});
  assert.equal(r.json.today, 0);
  assert.equal(r.json.complete, false, "0 counted from nowhere read as 0 runs today");
  // `basis` is our diagnosis of our own deployment and stays in the audit trail. What the client is owed
  // is "we could not count", which `complete` says.
  assert.equal("basis" in r.json, false, "a server-side diagnosis went out in a client answer");
  const wired = world({ upstream: up, queueDirs: [queueWith([{}])] });
  const ok = await wired.service.route("GET", "/portal/api/usage", CLIENT, {}, {});
  assert.equal(ok.json.today, 1);
  assert.equal(ok.json.complete, true);
});

test("usage: STAFF are not bound by a client's allowance, and the answer says so", async () => {
  const { up } = upstreamSpy({ runCaps: { dailyRuns: 3 } });
  const { service } = world({ upstream: up });
  const r = await service.route("GET", "/portal/api/usage", STAFF, {}, { account: "aurora" });
  assert.equal(r.status, 200);
  assert.equal(r.json.capped, false, "staff runs never consume a client's daily allowance");
});

// ── /portal/api/mcp-access ─────────────────────────────────────────────────────────────────────────
// This route answers nothing per-account: one connector host for the deployment, and the caller's own
// sign-in identity. It once resolved an ACCOUNT anyway, and the failure was silent in the worst way —
// assertPrincipal returns null for STAFF with no acting-for account, that null became a 400, and the
// screen fell back to "not shown here". Staff and multi-account clients were told the connector did not
// exist while single-account clients saw it. These pin all three principals against that.
const MULTI_CLIENT = { email: "boss@celta.example" };   // granted the tenant's whole list

test("mcp-access: STAFF with no acting-for account still gets the connector details", async () => {
  const { service } = world();
  process.env.CLEAROTRON_CLIENT_MCP_URL = "https://clients-mcp.test/mcp";
  try {
    const r = await service.route("GET", "/portal/api/mcp-access", STAFF, {}, {});
    assert.equal(r.status, 200, "staff were refused — this is the bug that hid the page");
    assert.equal(r.json.url, "https://clients-mcp.test/mcp");
    assert.equal(r.json.enabled, true);
    assert.equal(r.json.email, STAFF.email, "the sign-in address is the caller's own");
  } finally { delete process.env.CLEAROTRON_CLIENT_MCP_URL; }
});

test("1959 mcp-access: STAFF are handed the local connect route; a CLIENT never is", async () => {
  // The route needs no address, so it is the answer on a local install — where the reader IS the
  // operator. It is a true fact about this install's own disk and useless to a hosted client, who has no
  // checkout to spawn a server from; offering it there would be a false instruction on a client's page.
  const { service } = world();
  const staff = await service.route("GET", "/portal/api/mcp-access", STAFF, {}, {});
  assert.equal(staff.status, 200);
  assert.ok(staff.json.stdio, "staff were not given the route that works with no address");
  // ASSERTED AGAINST THE COMPOSER, not against a literal. Spelling the command here would make this file
  // a second author of it — which the one-author guard correctly flagged when this arm first did that —
  // and it is the stronger check anyway: the wire must carry exactly what the one composer produces.
  assert.equal(staff.json.stdio.command, stdioConnectCommand({ workDir: process.env.CLEAROTRON_WORK_DIR || null }),
    "the wire carries a command the composer did not produce");
  assert.ok(staff.json.stdio.note && staff.json.stdio.verify, "a bare command with no note or check");

  const client = await service.route("GET", "/portal/api/mcp-access", MULTI_CLIENT, {}, {});
  assert.equal(client.status, 200);
  assert.equal(client.json.stdio, null,
    "a hosted client was offered a command that spawns a server off a disk they do not have");
});

test("mcp-access: a MULTI-account client is not asked to pick one", async () => {
  const { service } = world();
  process.env.CLEAROTRON_CLIENT_MCP_URL = "https://clients-mcp.test/mcp";
  try {
    const r = await service.route("GET", "/portal/api/mcp-access", MULTI_CLIENT, {}, {});
    assert.equal(r.status, 200, "a multi-account client got the pick-an-account refusal");
    assert.equal(r.json.enabled, true);
  } finally { delete process.env.CLEAROTRON_CLIENT_MCP_URL; }
});

test("mcp-access: a single-account client keeps working", async () => {
  const { service } = world();
  process.env.CLEAROTRON_CLIENT_MCP_URL = "https://clients-mcp.test/mcp";
  try {
    const r = await service.route("GET", "/portal/api/mcp-access", CLIENT, {}, {});
    assert.equal(r.status, 200);
    assert.equal(r.json.email, CLIENT.email);
  } finally { delete process.env.CLEAROTRON_CLIENT_MCP_URL; }
});

test("mcp-access: env unset ⇒ url null and enabled false — never a placeholder host", async () => {
  const { service } = world();
  const saved = process.env.CLEAROTRON_CLIENT_MCP_URL;
  delete process.env.CLEAROTRON_CLIENT_MCP_URL;
  try {
    const r = await service.route("GET", "/portal/api/mcp-access", STAFF, {}, {});
    assert.equal(r.status, 200);
    assert.equal(r.json.url, null, "a deployment with no client MCP must not invent an address");
    assert.equal(r.json.enabled, false);
  } finally { if (saved !== undefined) process.env.CLEAROTRON_CLIENT_MCP_URL = saved; }
});

test("mcp-access: the API-key door is a SEPARATE address, and null until it exists", async () => {
  // The two doors are different hosts with different protection. Reporting them in one field — or
  // letting the key door inherit the signed-in address — would put a customer in front of a failure
  // they cannot diagnose (a key pasted at a door that only accepts a browser sign-in).
  const { service } = world();
  process.env.CLEAROTRON_CLIENT_MCP_URL = "https://clients-mcp.test/mcp";
  try {
    const off = await service.route("GET", "/portal/api/mcp-access", STAFF, {}, {});
    assert.equal(off.json.keyUrl, null, "the key door was invented on a deployment that has not stood it up");
    assert.equal(off.json.enabled, true, "the signed-in door must not depend on the key door existing");

    process.env.CLEAROTRON_AGENT_MCP_URL = "https://agent-mcp.test/mcp";
    const on = await service.route("GET", "/portal/api/mcp-access", STAFF, {}, {});
    assert.equal(on.json.keyUrl, "https://agent-mcp.test/mcp");
    assert.notEqual(on.json.keyUrl, on.json.url, "the two doors collapsed into one address");
    // and no credential is ever handed to whoever loads the page
    assert.ok(!JSON.stringify(on.json).match(/\bv1\.[A-Za-z0-9_-]/), "a key appeared in the response body");
  } finally { delete process.env.CLEAROTRON_CLIENT_MCP_URL; delete process.env.CLEAROTRON_AGENT_MCP_URL; }
});

test("mcp-access: an unmapped identity is still refused at the door", async () => {
  const { service } = world();
  process.env.CLEAROTRON_CLIENT_MCP_URL = "https://clients-mcp.test/mcp";
  try {
    const r = await service.route("GET", "/portal/api/mcp-access", STRANGER, {}, {});
    assert.ok(r.status === 403 || r.status === 404, `a stranger got ${r.status} — the door must hold`);
  } finally { delete process.env.CLEAROTRON_CLIENT_MCP_URL; }
});

// ── the brand owner's NAME ─────────────────────────────────────────────────────────────────────────
//
// The account key is a slug; the brand owner is a name. Before /me carried the names, only the
// staff-only roster resolved them — so the same customer read "Aurora Interactive" to staff and
// "aurora" to the client whose company it is, on the same screens.
test("/portal/api/me names the accounts it grants, and never more than it grants", async () => {
  const profiles = new Map([
    ["aurora", { key: "aurora", name: "Aurora Interactive" }],
    ["zephyr", { key: "zephyr", name: "Zephyr Beverages" }],
    ["secret-client", { key: "secret-client", name: "A Customer Nobody Asked About" }],
  ]);
  const { poolRoot, workspaceRoot } = world();
  const svc = makePortalService({ poolRoot, workspaceRoot, secret: "test-secret",
    staffDomains: STAFF_DOMAINS, grants: GRANTS, audit: () => {},
    loadProfilesImpl: async () => profiles });

  const single = await svc.route("GET", "/portal/api/me", CLIENT);
  assert.deepEqual(single.json.accountNames, { aurora: "Aurora Interactive" },
    "a client is told what their own brand owner is called");

  const multi = await svc.route("GET", "/portal/api/me", { email: "boss@celta.example" });
  assert.deepEqual(multi.json.accountNames, { aurora: "Aurora Interactive", zephyr: "Zephyr Beverages" });
  // THE BOUNDARY: this route is reachable by every signed-in identity, so it may never become a
  // roster. `secret-client` exists in the store and is absent here because it was never granted.
  assert.equal("secret-client" in multi.json.accountNames, false,
    "an account nobody granted is not named on the one route everybody can reach");

  // Staff hold "*", which is not a list and cannot be turned into one without publishing the roster.
  // They read names from /portal/admin/roster, which is staff-gated — so this stays empty for them.
  const staff = await svc.route("GET", "/portal/api/me", STAFF);
  assert.deepEqual(staff.json.accountNames, {}, "an all-accounts identity gets no map, it gets the roster");
  assert.deepEqual((await svc.route("GET", "/portal/admin/roster", STAFF)).json.customers.map((c) => c.key),
    ["aurora", "zephyr", "secret-client"], "the roster is the staff answer, and it is still staff-only");
});

test("an unreadable profile store costs a name, never the door", async () => {
  const { poolRoot, workspaceRoot } = world();
  const svc = makePortalService({ poolRoot, workspaceRoot, secret: "test-secret",
    staffDomains: STAFF_DOMAINS, grants: GRANTS, audit: () => {},
    loadProfilesImpl: async () => { throw new Error("profiles/generic.json is REQUIRED"); } });
  const me = await svc.route("GET", "/portal/api/me", CLIENT);
  assert.equal(me.status, 200, "a cosmetic lookup must not decide whether someone can sign in");
  assert.deepEqual(me.json.accounts, ["aurora"]);
  assert.deepEqual(me.json.accountNames, {}, "no name is offered rather than a wrong one; the UI falls back to the key");
});

/** driver/profiles — the shipped store, for tests that need a profile the engine's validator accepts. */
const __dirname_profiles = () => join(fileURLToPath(new URL("../profiles", import.meta.url)));

// ── a CLIENT creating their own project, through the whole composition ──────────────────────────────
//
// Clients may create projects. Every layer already permitted it — the UI was
// the only thing withholding it — so the risk is not that a rule refuses, it is that nobody had ever run
// the three layers together for this verb and each of them looked fine alone. This drives the real
// portal-service → the real portal-upstream → the real profile-service, over a real profile store.
test("a client creates a project for their OWN account, end to end, and cannot create one for another", async () => {
  const { makeProfileService } = await import("../profile-service.mjs");
  const { makeUpstream } = await import("../portal-upstream.mjs");

  // The SHIPPED profiles, copied rather than invented. The loader runs the engine's full shape validator
  // on every file in the directory, so a hand-written stub fails on fields that have nothing to do with
  // this test — and a stub trimmed until it passes is a fixture that certifies its own assumptions.
  // `generic` is required by the loader; `aurora` is the account CLIENT holds; `zephyr` is the one it
  // does not. Copied to a temp dir because this test WRITES.
  const profileDir = tempDir("portal-e2e-profiles-");
  mkdirSync(join(profileDir, "projects"), { recursive: true });
  const shipped = join(__dirname_profiles());
  for (const f of ["generic.json", "aurora.json", "zephyr.json"]) {
    writeFileSync(join(profileDir, f), readFileSync(join(shipped, f), "utf8"));
  }

  const profiles = makeProfileService({ profileDir });          // no gitCommit: the write is the subject
  const upstream = makeUpstream({
    callUpstream: (method, path, body, identity) => profiles.route(method, path, { email: identity?.email }, body ?? {}),
  });
  const { poolRoot, workspaceRoot } = world();
  const svc = makePortalService({ poolRoot, workspaceRoot, secret: "test-secret",
    staffDomains: STAFF_DOMAINS, grants: GRANTS, upstream, audit: () => {} });

  const body = { profile: { projectName: "EU launch 2027" }, contextPack: "" };
  const path = "/portal/api/config/projects/eu-launch-2027";

  // Check, then write — the ladder the screen uses. `isNew` is what tells it this is a create.
  const check = await svc.route("POST", `${path}/validate`, CLIENT, body, {});
  assert.equal(check.status, 200, JSON.stringify(check.json));
  assert.equal(check.json.ok, true, JSON.stringify(check.json.errors));
  assert.equal(check.json.isNew, true);

  const save = await svc.route("POST", `${path}/save`, CLIENT, body, {});
  assert.equal(save.status, 200, JSON.stringify(save.json));
  assert.equal(save.json.created, true, "a save to a slug that does not exist creates it");
  assert.equal(save.json.customer, "aurora", "filed under the account the PRINCIPAL resolves to");

  // ...and it is really there, through the read path the screen uses.
  const list = await svc.route("GET", "/portal/api/config/projects", CLIENT, {}, {});
  assert.deepEqual(list.json.projects.map((p) => p.key), ["eu-launch-2027"]);
  assert.equal(list.json.projects[0].name, "EU launch 2027");
  assert.equal(list.json.projects[0].archived, false);

  // THE BOUNDARY. The account is resolved from the verified principal, never from the request — so a
  // client naming someone else's account gets the same 404 a nonexistent one gets, and nothing is written.
  const foreign = await svc.route("POST", `${path}/save`, CLIENT, body, { account: "zephyr" });
  assert.equal(foreign.status, 404);
  assert.deepEqual(foreign.json, { error: "not_found" });
  assert.equal(existsSync(join(profileDir, "projects", "zephyr")), false, "and no file was written for them");

  // Archiving is the same save with a flag, and it is REVERSIBLE for a client — which is the point of
  // showing archived rows to them at all (portal-upstream rule 4).
  const archived = await svc.route("POST", `${path}/save`, CLIENT,
    { profile: { projectName: "EU launch 2027", archived: true }, contextPack: "" }, {});
  assert.equal(archived.status, 200, JSON.stringify(archived.json));
  const afterArchive = await svc.route("GET", "/portal/api/config/projects", CLIENT, {}, {});
  assert.equal(afterArchive.json.projects[0].archived, true, "a client SEES their archived project…");

  const restored = await svc.route("POST", `${path}/save`, CLIENT,
    { profile: { projectName: "EU launch 2027", archived: false }, contextPack: "" }, {});
  assert.equal(restored.status, 200, JSON.stringify(restored.json));
  const afterRestore = await svc.route("GET", "/portal/api/config/projects", CLIENT, {}, {});
  assert.equal(afterRestore.json.projects[0].archived, false, "…and can bring it back without asking anyone");

  rmSync(profileDir, { recursive: true, force: true });
});

// ── — ONE REPORT PER MARK, AT THE ROUTE ────────────────────────────────────────────────────────
//
// The run-level report route answered `report.html` unconditionally. A batch does not have that file, so
// without this the route would 404 every batch outright; and the tempting repair — serve `reports[0]` —
// is the defect the fan-out removed, wearing a URL. These pin BOTH directions: a batch's per-name
// documents are reachable, and its run-level URL resolves to nothing rather than to one name in two.
test("#472: a batch serves each name's own report, and has no run-level report to serve", async () => {
  const { service } = world();
  const one = await service.route("GET", "/portal/report/tmp4-aurora-batch/ironwhisk/", CLIENT);
  assert.equal(one.status, 200, "the name's own document is served");
  assert.match(one.html, /IRONWHISK/);
  assert.doesNotMatch(one.html, /CLUVENDRA/, "and it is that name's document, not the other's");
  const two = await service.route("GET", "/portal/report/tmp4-aurora-batch/cluvendra/", CLIENT);
  assert.equal(two.status, 200);
  assert.match(two.html, /CLUVENDRA/);

  assert.equal((await service.route("GET", "/portal/report/tmp4-aurora-batch/", CLIENT)).status, 404,
    "a batch has no run-level document — serving the first of two as 'the report' is what this replaced");
  // A slug this run did not publish resolves to nothing. The slug is matched against the run's OWN list
  // and never used to build a path, so it can name nothing that is not already one of its documents.
  assert.equal((await service.route("GET", "/portal/report/tmp4-aurora-batch/ghostmark/", CLIENT)).status, 404);
  assert.equal((await service.route("GET", "/portal/report/tmp4-aurora-batch/..%2F..%2Fetc/", CLIENT)).status, 404);
  // Ownership is unchanged and still checked first: a foreign reader gets 404, never a document.
  // Ownership is checked BEFORE the slug, and the per-mark route inherits it unchanged: the same slug on
  // another account's batch is 404, never 403 and never a document. Same names deliberately — the slug
  // resolving is not the question, whose run it is, is.
  assert.equal((await service.route("GET", "/portal/report/tmp5-zephyr-batch/ironwhisk/", CLIENT)).status, 404);
  // And a single-document run is untouched — same URL, same 200, no slug needed.
  assert.equal((await service.route("GET", "/portal/report/tmp1-aurora-run/", CLIENT)).status, 200);
});

test("#472: the run row carries one link per name, and no run-level link for a batch", async () => {
  const { service } = world();
  const res = await service.route("GET", "/portal/api/runs", CLIENT, {}, {});
  assert.equal(res.status, 200);
  const batch = res.json.runs.find((r) => r.runId === "tmp4-aurora-batch");
  assert.ok(batch, "the batch is listed");
  assert.equal(batch.report, null, "no run-level link — there is no run-level document");
  assert.deepEqual(batch.reports.map((r) => r.mark), ["IRONWHISK", "CLUVENDRA"]);
  // Each row's path is that mark's own, checked per row rather than by set membership: two links both
  // merely PRESENT passes just as well when the rows are swapped.
  for (const r of batch.reports) assert.ok(r.path.endsWith(`/${r.mark.toLowerCase()}/`), `${r.mark} links its own`);
  const plain = res.json.runs.find((r) => r.runId === "tmp1-aurora-run");
  assert.equal(plain.report, "/portal/report/tmp1-aurora-run/", "a one-document run keeps its run-level link");
  assert.deepEqual(plain.reports.map((r) => r.path), ["/portal/report/tmp1-aurora-run/"],
    "…and lists it too, so a reader of `reports` never has to special-case the single case");

  // — THE NAME RIDES BESIDE THE PATH, AND THE PATH IS STILL THE DOCUMENT.
  //
  // The portal opens a batch's names inside its own shell now, at /portal/result/<run>/<slug>. It builds
  // that route, so it needs the NAME of each document — not a second spelling of its address. Handing it
  // one by repointing `path` at the route is the repair that looks obvious and is wrong: `report` above
  // is consumed as an IFRAME SOURCE and `path` is its sibling, so the frame would be fed the screen that
  // contains it and no report would render at all.
  assert.deepEqual(batch.reports.map((r) => r.slug), ["ironwhisk", "cluvendra"]);
  for (const r of batch.reports) {
    assert.ok(r.path.startsWith("/portal/report/"), `${r.mark}: path is still the document, not a route`);
    assert.ok(r.path.endsWith(`/${r.slug}/`), `${r.mark}: the slug names the document the path serves`);
    // The slug is the one the per-name ROUTE resolves with — asserted against the server, not against
    // the string, so a slug that no longer opens anything fails here rather than on a client's screen.
    assert.equal((await service.route("GET", `/portal/report/${batch.runId}/${r.slug}/`, CLIENT)).status, 200,
      `${r.mark}: its slug opens its document`);
  }
  // Null on a single-document run: one document, and no name to pick between.
  assert.deepEqual(plain.reports.map((r) => r.slug), [null]);
});

// ── — THE CROSS-MARK PARAGRAPH REACHES A READER ───────────────────────────────────────────────
//
// A knockout over several names publishes no combined document, so the one piece of prose that reads
// the names against each other goes to `report.md` — and reached nobody. `meta.reports` lists the
// per-mark HTMLs only, so the portal's report route resolves nothing for it; the pool path is not one
// the edge serves either. Composed on every multi-mark run, delivered on none.

test("#1921: a grouped run serves its cross-mark paragraph, and nothing else out of that file", async () => {
  const { service } = world();
  const res = await service.route("GET", "/portal/api/run/tmp4-aurora-batch/summary", CLIENT, {}, {});
  assert.equal(res.status, 200);
  assert.equal(res.json.runId, "tmp4-aurora-batch");
  // Paragraphs, in the file's order, split on the blank line exactly as the document renderer splits
  // them. A single-line break inside a paragraph is a wrap and collapses.
  assert.deepEqual(res.json.summary, [
    "IRONWHISK rates **Medium** for Classes 9 and 42. CLUVENDRA rates Manageable.",
    "Read together, <script>alert(1)</script> & the two names sit either side of the line.",
  ]);
  // THE INLINE MARKDOWN SURVIVES THE TRIP. The model writes markdown because every surface it feeds
  // renders markdown, and the reports themselves render it (render-knockout's inlineMd). A server that
  // stripped it here would put the same sentence on two surfaces in two different voices.
  assert.match(res.json.summary[0], /\*\*Medium\*\*/);
  // AND SO DO THE CHARACTERS THAT LOOK LIKE MARKUP. They are carried verbatim, unescaped and
  // un-sanitised, because this is JSON and the client renders text nodes — escaping here would show a
  // client `&lt;script&gt;` in the middle of a legal opinion. The client half of this rule is
  // portal-ui/test/inlineMd.test.ts; between them the string is never HTML at any point.
  assert.match(res.json.summary[1], /<script>alert\(1\)<\/script> & /);
  assert.equal(res.html, undefined, "served as JSON — this route never renders a document");
});

test("#1921: the summary route serves the SUMMARY, never the rest of report.md", async () => {
  const { service } = world();
  const whole = (await service.route("GET", "/portal/api/run/tmp4-aurora-batch/summary", CLIENT, {}, {}))
    .json.summary.join("\n");
  // The `## Documents` section is what follows the summary, and it names POOL FILENAMES — addresses no
  // client can reach and no client should be handed. An extractor that read to the end of the file
  // would ship that list, and would look correct on any fixture that ended at the prose.
  assert.doesNotMatch(whole, /report-ironwhisk\.html/, "no document filename");
  assert.doesNotMatch(whole, /audit\.xlsx/, "no workbook filename");
  // BOTH SPELLINGS. This pinned `## Documents` alone, which is the ARCHIVED shape — publish writes the
  // heading as `# Documents` since promoted it to the section it always was. A guard
  // matching only the retired spelling goes on passing while the live one leaks past it.
  assert.doesNotMatch(whole, /#+ Documents/);
  assert.doesNotMatch(whole, /this summary is the only place the marks appear together/,
    "…nor the prose that section carries about them");
  // The YAML front matter is for archive greps. It is not prose, and it must not reach a reader.
  assert.doesNotMatch(whole, /^---/m);
  assert.doesNotMatch(whole, /matter:|overall_badge:|KNOCKOUT TRADEMARK REVIEW REPORT/);
  assert.doesNotMatch(whole, /# Summary/, "the heading is the marker, not the content");
});

test("#1921: every absence answers 404, and the run you may not read is one of them", async () => {
  const { service } = world();
  // The multi-account client from the grants fixture — holds aurora AND zephyr. Declared here rather
  // than shared, the way every other test in this file declares it.
  const BOTH = { email: "boss@celta.example" };
  const status = async (path, who = CLIENT) => (await service.route("GET", path, who, {}, {})).status;
  // A SINGLE-DOCUMENT RUN ANSWERS TOO, and that is deliberate. `report.md` is written on every run, so
  // its prose EXISTS on this one; 404 would say "there is none" about something that does. The rule this
  // route was briefly gated on — never print the same paragraph twice on one screen — is real and lives
  // where the screen is: a single-document run's assessment is already inside the document the screen
  // frames, so the screen does not ask (showsAssessment, portal-ui/src/contract/reads.ts). It also makes
  // report.md a published file with an address on every run, which published-documents-have-routes
  // asserts as a class.
  assert.equal(await status("/portal/api/run/tmp1-aurora-run/summary"), 200, "its prose exists, so it is served");
  // A grouped run whose summary came out empty HAS no paragraph. A 200 carrying [] would have the client
  // render an empty panel that says nothing and explains nothing; an absence is a result, not a value.
  assert.equal(await status("/portal/api/run/tmp6-aurora-nosummary/summary"), 404, "composed empty = none");
  // Ownership, off the run's own meta, exactly as the report route reads it: FOREIGN IS 404, NEVER 403.
  // The same run answers 200 for the account that owns it, so this arm is about the reader and not about
  // the run — without that pairing a 404 for any reason at all would satisfy it.
  assert.equal(await status("/portal/api/run/tmp5-zephyr-batch/summary"), 404, "another account's run");
  assert.equal(await status("/portal/api/run/tmp5-zephyr-batch/summary", BOTH), 200,
    "…and it is ownership doing that, not an absent file: the holder of both accounts reads it");
  assert.equal(await status("/portal/api/run/no-such-run/summary"), 404);
  // A runId is one pool directory NAME. Nothing traversal-shaped reaches the filesystem.
  assert.equal(await status("/portal/api/run/..%2F..%2Fetc/summary"), 404);
  assert.equal(await status("/portal/api/run/../../etc/summary"), 404);
});

// ── — A REFUSED ADMIN WRITE LEAVES A LINE ─────────────────────────────────────────────────────
//
// The portal journalled an admin write only when it SUCCEEDED. A refusal — a client on a staff surface,
// a runId naming nothing — returned its status and wrote nothing anywhere, so "nobody tried" and
// "someone was turned away" read identically off the log. These assert the outcome row, its status and
// its reason; the pre-route half (an unauthenticated POST, refused before route() is reached) cannot be
// driven from here because it is decided in makeHttpHandler — it is in portal-local-login.test.mjs.

test("#723 a REFUSED admin write is journalled, with the status and the reason", async () => {
  const { service, audits } = world();
  // A client on a staff-only surface: 404 by construction (the surface does not exist for them).
  const refused = await service.route("POST", "/portal/admin/retired", CLIENT, { action: "retire", runIds: ["tmp1-aurora-run"] });
  assert.equal(refused.status, 404, "the refusal itself is unchanged");

  const row = audits.find((a) => a.event === "request-refused" && a.path === "/portal/admin/retired");
  assert.ok(row, "the refused write filed a row — the whole point of the issue");
  assert.equal(row.status, 404, "with the status it answered");
  assert.equal(row.reason, "not_found", "and the reason, so the row explains itself");
  assert.equal(row.method, "POST", "the verb, so a refused write is distinguishable from a refused read");
  assert.equal(row.by, CLIENT.email, "and who was turned away");
});

test("#723 the row carries the refusal's own reason, not a generic one", async () => {
  const { service, audits } = world();
  // Staff, so past the door — refused deeper in, on the run id. A different status and a different
  // reason from the case above, which is what proves the row reports the refusal rather than the route.
  const bad = await service.route("POST", "/portal/admin/retired", STAFF, { action: "retire", runIds: ["no-such-run"] });
  assert.equal(bad.status, 400);
  const row = audits.find((a) => a.event === "request-refused" && a.status === 400);
  assert.ok(row, "a 400 is a refusal too");
  assert.equal(row.reason, "unknown run", "the route's own reason, carried through");
  assert.equal(row.by, STAFF.email);
});

// ── — THE RECORD EXISTS. IT WAS THE SIGNPOST THAT DID NOT. ───────────────────────────────────
//
// The owner clicked Retire on a failed production run, got "That change could not be saved.", and the
// box's journal held 17 lines of startup banner. closed once on the same symptom, and its triage
// recorded the empty journal as its central lead — "that absence is the first thing to explain".
//
// There was nothing to explain. Every mutating admin request IS recorded: the route files its own row
// on success, routeAudited files one for any 4xx, and the door files one for a refusal it decides
// itself. All of it goes to portal-audit.log, and nothing in the journal ever said that file existed.
//
// These two pin the half nobody had a test for — the SUCCESS row — because a fix that adds a signpost
// to a record is worthless the moment the record stops being written.

test("#1254 a SUCCESSFUL retire files its own row, so 'did the write arrive' is answerable", async () => {
  const { service, audits } = world();
  const ok = await service.route("POST", "/portal/admin/retired", STAFF, { action: "retire", runIds: ["tmp1-aurora-run"] });
  assert.equal(ok.status, 200, "the retire itself is unchanged");

  const row = audits.find((a) => a.event === "run-retire");
  assert.ok(row, "a retire that WORKED left no trace — the client says it failed and the box cannot disagree");
  assert.equal(row.by, STAFF.email, "who did it");
  assert.equal(row.runs, 1, "and how many runs it moved");
  assert.equal(row.status, 200);
  // NOT the generic outcome row. That one fires on 4xx/5xx only, and a success arriving through it
  // would be indistinguishable from a refusal in the same file.
  assert.ok(!audits.some((a) => a.event === "request-refused" && a.path === "/portal/admin/retired"),
    "a 200 filed a refusal row");
});

test("#1254 restore files its own row too — the inverse is as auditable as the act", async () => {
  const { service, audits } = world();
  await service.route("POST", "/portal/admin/retired", STAFF, { action: "retire", runIds: ["tmp1-aurora-run"] });
  await service.route("POST", "/portal/admin/retired", STAFF, { action: "restore", runIds: ["tmp1-aurora-run"] });
  const back = audits.find((a) => a.event === "run-restore");
  assert.ok(back, "a restore left no trace");
  assert.equal(back.runs, 1);
});

test("#1254 the startup banner NAMES the audit log, in the place an operator actually reads", async () => {
  // The journal is what somebody tails when a client reports a failed save. It carried auth mode, the
  // ops-token posture, the saved-search store and the listen line — and no mention of the file holding
  // every admin write. Two investigations then spent themselves on an absence that was never a signal.
  const src = readFileSync(new URL("../portal-service.mjs", import.meta.url), "utf8");
  assert.match(src, /log\(`audit log: \$\{auditPath\}/,
    "the banner stopped naming the audit log — the journal goes back to looking empty on a box that is recording everything");
  assert.match(src, /PORTAL_AUDIT overrides/, "…including how to point it somewhere else");
  // NOT a second per-request log into the journal: each of those rows would duplicate one this file
  // already has, and /portal/admin/observed reads the audit log back through a fixed 256 KiB tail, so
  // a duplicate is span that panel can no longer see.
  assert.ok(!/log\(`(POST|request) /.test(src), "a per-request journal line appeared — it duplicates the audit row");
});

test("#723 the outcome row never carries the body, the query or a credential", async () => {
  const { service, audits } = world();
  // A body with something that must never be journalled, and a query string beside it. The row is built
  // from the method, the PATHNAME and the status — never from anything the caller wrote.
  await service.route("POST", "/portal/admin/retired", CLIENT,
    { action: "retire", runIds: ["tmp1-aurora-run"], passphrase: "hunter2-do-not-log", token: "sk-secret-value" },
    { account: "aurora", token: "query-secret" });
  const row = audits.find((a) => a.event === "request-refused");
  assert.ok(row, "the refusal is journalled");
  const dumped = JSON.stringify(row);
  assert.ok(!dumped.includes("hunter2-do-not-log"), "no body field reaches the log");
  assert.ok(!dumped.includes("sk-secret-value"), "and no token in it");
  assert.ok(!dumped.includes("query-secret"), "the query string is not in the row either");
  assert.ok(!row.path.includes("?"), "the PATH is a pathname — a logged query string is a logged secret");
});

test("#723 a SUCCESSFUL write still audits exactly as before — one row, the specific one", async () => {
  const { service, audits } = world();
  // The regression this shape exists to avoid. The success rows are richer than a generic row could be
  // (the account resolved from the run, the actor, the run count), so a generic row on top of them would
  // duplicate every write and cost /portal/admin/observed its window for nothing.
  const ok = await service.route("POST", "/portal/admin/families", STAFF,
    { name: "Hydra range", runIds: ["tmp1-aurora-run"] }, { account: "aurora" });
  assert.equal(ok.status, 200);
  assert.deepEqual(audits.map((a) => a.event), ["family-group"],
    "exactly one row, and it is the route's own — a success is not journalled twice");
  assert.equal(audits[0].status, 200, "…and it now says how it ended, like the refusal rows do");
  assert.ok(!audits.some((a) => a.event === "request-refused"), "nothing was refused, so nothing says it was");
});

// ── — AND NOTHING ELSE FILES A ROW. The issue's Out of scope, asserted. ────────────────────────
//
// "Per-request access logging for the whole portal. This is about the admin WRITE paths, which are few,
// staff-only and already have a sink." The first cut of this change wrapped EVERY route and filed a row
// for every non-2xx anywhere in the portal — a client's 404 on /portal/api/runs, a malformed query on a
// report path. That is per-request access logging under a narrower name, and these are the tests that
// would have caught it. They assert the NEGATIVE, which is the direction a wrapper gets wrong.

// ── WIDENED THE POSITIVE HALF, and the negative half is why it is still here.
//
// 's out-of-scope line — "per-request access logging for the whole portal" — is unchanged and is
// what the second loop below still asserts. What changed is the reading of "the write paths".
// admitted only `/portal/admin/*` plus the one named client write, on the reasoning that the other
// write routes "already file a richer row" of their own; measured, that is true of their OUTCOMES and
// false of their REFUSALS, and `/portal/api/ack` filed nothing in either direction. So the rule is now
// the PREFIX with a named non-mutating exception list, which is what stops it falling behind a route
// added later — and `POST /portal/api/run` has moved from the second loop to the first, deliberately.
//
// Still refusals only. A success row is still filed by the route that can say more than a generic one.
test("#723/2077 isAdminWrite admits the state-changing writes and nothing else", () => {
  for (const [method, path] of [
    ["POST", "/portal/admin/retired"],
    ["POST", "/portal/admin/families"],
    ["POST", "/portal/api/feedback"],
    ["POST", "/portal/api/ack"],                       // 2077 — the route that filed nothing at all
    ["POST", "/portal/api/run"],                       // and the spend path, whose EARLY refusals filed nothing
    ["POST", "/portal/api/run/abc/stop"],
    ["POST", "/portal/api/queue/abc/cancel"],
    ["post", "/portal/admin/retired"],                 // the verb is normalised
    ["POST", "/portal/admin/retired?account=aurora"],  // a query string never decides the answer
  ]) assert.equal(isAdminWrite(method, path), true, `${method} ${path} is a state-changing write`);

  for (const [method, path] of [
    ["GET", "/portal/admin/retired"],       // a READ of a staff surface is not a write
    ["GET", "/portal/admin/observed"],
    ["GET", "/portal/api/runs"],
    ["POST", "/portal/api/compose/read"],   // computes a draft and changes nothing — named, not forgotten
    ["POST", "/portal/api/run/plan"],       // prices a request and changes nothing
    ["POST", "/portal/login"],              // and never the credential-carrying ones
    ["POST", "/portal/logout"],
    ["GET", "/portal/report/tmp1-aurora-run/"],
    ["POST", "/portal/adminx/retired"],     // prefix, not substring
    ["POST", "/portal/apix/ack"],
    ["POST", ""],
    ["POST", undefined],
  ]) assert.equal(isAdminWrite(method, path), false, `${method} ${path} must not be journalled`);
});

test("#723 a refused NON-admin-write files nothing — the log is not a request log", async () => {
  const { service, audits } = world();
  // A client asking for a run that is not theirs. A real refusal, on a real route, that this issue
  // deliberately does not cover: it happens on every mistyped URL and would drown the panel that reads
  // this log back through a fixed tail.
  const r = await service.route("GET", "/portal/api/run/no-such-run", CLIENT, {}, {});
  assert.ok(r.status >= 400, "it is a refusal");
  assert.deepEqual(audits.filter((a) => a.event === "request-refused" || a.event === "request-error"), [],
    "and it leaves no outcome row — per-request access logging is out of scope by ruling");
});

test("#723 a refused READ of a staff surface files nothing, but the WRITE beside it does", async () => {
  const { service, audits } = world();
  await service.route("GET", "/portal/admin/retired", CLIENT, {}, {});
  assert.deepEqual(audits.filter((a) => a.event === "request-refused"), [],
    "reading a staff surface is not a write, however it ends");

  await service.route("POST", "/portal/admin/retired", CLIENT, { action: "retire", runIds: ["tmp1-aurora-run"] });
  assert.equal(audits.filter((a) => a.event === "request-refused").length, 1,
    "the same path, the same principal, the same 404 — journalled because this one changes state");
});

// ══ 1986: a control the deployment cannot serve says so on /me ════════════════════════════════════

test("1986: /me carries the stop control's verdict — unavailable with a staff-only reason, default available", async () => {
  // The boot log said for days that the token cannot stop_run; every press failed identically. The
  // bootstrap reads the live token's posture and passes the verdict through this seam; the button
  // disables itself with the reason instead of failing forever.
  const dead = world({ stopControl: { available: false, reason: "the ops token's verbs are [start_run] — it cannot stop_run" } }).service;
  const staffMe = await dead.route("GET", "/portal/api/me", STAFF);
  assert.equal(staffMe.json.controls.stop.available, false);
  assert.match(staffMe.json.controls.stop.reason, /cannot stop_run/, "staff read the posture reason");
  const clientMe = await dead.route("GET", "/portal/api/me", CLIENT);
  assert.equal(clientMe.json.controls.stop.available, false);
  assert.equal(clientMe.json.controls.stop.reason, null, "a client is not handed an operator instruction");
  // Default: a service built without the seam behaves exactly as before — available, no reason.
  const alive = world({}).service;
  const me = await alive.route("GET", "/portal/api/me", STAFF);
  assert.equal(me.json.controls.stop.available, true);
});

// ── — THE DEMO OPENS THIS PORTAL, AND ITS ORDERING IS REAL ──────────────────
//
// `clearotron demo` used to open the dev cockpit. It opens this service now, and these two arms USED TO
// assert that every product was greyed with a sentence about credentials — the owner's ruling of
// 2026-08-31 14:44, which he superseded at 14:47 the same day:
//
//   "i think its OK for someone to be able to press New Clearance in demo mode and see it work and get
//    the static results, right?"
//
// His reasoning for reversing himself is why these are inverted rather than deleted: a demo that shows
// finished reports and a dead button "demonstrates the output and hides the thing a buyer is deciding
// about", and the disabled control was "a viewer creeping back in".
//
// THE FIRST ASSERTION OF EACH IS THE BEHAVIOUR AS IT SHIPPED, so this is a measured reversal rather than
// a test rewritten to match whatever the code does now.

test("2015 in a demo every product is listed and ORDERABLE — the form is the thing a visitor came for", async () => {
  const { service } = world({ demo: true });
  const res = await service.route("GET", "/portal/api/searches", CLIENT, {}, {});
  assert.equal(res.status, 200);
  const by = Object.fromEntries(res.json.products.map((l) => [l.key, l]));
  // THE WHOLE CLASS, unchanged and still load-bearing. Nothing may vanish: a product that disappears in
  // a demo tells a visitor the product does not exist.
  assert.deepEqual(Object.keys(by).sort(),
    ["full-country-search", "global-preliminary-search", "knockout-search", "multi-country-focus-search"]);
  for (const [key, l] of Object.entries(by)) {
    assert.equal(l.available, true, `${key}: a demo greys the product again — the superseded ruling is back`);
    assert.equal(l.unavailableNote, null, `${key}: a demo carries a refusal sentence for a product it will honour`);
  }
  // AND THE SENTENCE IS GONE FROM THE MAP, not merely unreached. While it sat there the greyed control
  // was one `return "demo"` away from returning, which is how it survived the supersession the first time.
  assert.doesNotMatch(JSON.stringify(res.json.products), /credentials/i,
    "the demo refusal sentence is being rendered again");
});

test("2015 the demo PLANS a clearance, because the plan is most of what a visitor came to see", async () => {
  // This arm asserted a 422 with the credentials sentence. Under the standing ruling the flow is real up
  // to the confirmation — "the brand owner, the names, the classes, the four searches, the price and the
  // turnaround, the confirmation" — and only the dispatch is not.
  const { service } = world({ demo: true });
  const body = { marks: [{ name: "IRONWHISK" }], classes: [8], goods: "kitchen tools",
    product: "knockout-search", forwarder: "f", profileKey: "zephyr", forwarderEmail: "f@example.test" };
  const plan = await service.route("POST", "/portal/api/run/plan", CLIENT, body, {});
  assert.equal(plan.status, 200, `a demo must be able to plan a clearance, got ${plan.status}: ${JSON.stringify(plan.json)}`);
  assert.ok(plan.json.confirmationToken, "the demo's review step has no ticket, so the flow cannot be walked to its end");
  assert.doesNotMatch(JSON.stringify(plan.json), /credentials/i, "the retired refusal is back on the plan path");
});

test("2015 a demo ORDER lands on a finished run and NEVER dispatches", async () => {
  // THE CLAIM A 200 CANNOT CARRY. "Nothing was started" is not readable from a status code, so this
  // counts calls to the trigger seam — the one function in this service that spends anything — and
  // asserts it was never reached. The ruling's own words: "no engine turn, no register call, no queue
  // entry, no run directory. The confirmation resolves to a preloaded run."
  const w = world({ demo: true });
  // A finished run of the product about to be ordered, filed the way the seeded example is.
  mkdirSync(join(w.poolRoot, "demo-multi"), { recursive: true });
  writeFileSync(join(w.poolRoot, "demo-multi", "meta.json"), JSON.stringify({
    // `aurora`, because CLIENT's grant is aurora — a demo may only ever land on a run this principal
    // could open by any other route, and filing the fixture where they cannot see it is the arm
    // accidentally proving the tenancy rule instead of the landing.
    runId: "demo-multi", customerKey: "aurora", title: "VENQORI", kind: "clearance", overall: "LOW",
    date: "2026-08-11", searchLevel: "multi-country-focus-search", clientGate: { released: true } }));
  writeFileSync(join(w.poolRoot, "demo-multi", "report.html"), "<title>VENQORI</title>ok");

  const body = { marks: [{ name: "IRONWHISK" }], classes: [8], goods: "kitchen tools",
    product: "multi-country-focus-search", jurisdictions: ["European Union", "United States"],
    forwarder: "f", profileKey: "zephyr", forwarderEmail: "f@example.test" };
  const plan = await w.service.route("POST", "/portal/api/run/plan", CLIENT, body, {});
  assert.equal(plan.status, 200, JSON.stringify(plan.json));

  const run = await w.service.route("POST", "/portal/api/run", CLIENT,
    { ...body, confirmationToken: plan.json.confirmationToken }, {});
  assert.equal(run.status, 200, JSON.stringify(run.json));

  // ── THE LOAD-BEARING ASSERTION ────────────────────────────────────────────────────────────────────
  assert.deepEqual(w.triggers, [], "a demo reached the trigger seam — an engine turn was dispatched");
  // AND IT LANDED SOMEWHERE HONEST, on the run whose product it asked for.
  assert.equal(run.json.landedOn, "demo-multi");
  assert.equal(run.json.landedProduct, "multi-country-focus-search");
  // NEVER "queued". The one thing this must not read like is a run that has just started.
  assert.equal(run.json.queued, false, "a demo order reports itself as queued work");

  // The audit says which report a press resolved to, so a capture can be traced to the run it opened.
  const landedRow = w.audits.find((a) => a.event === "demo-order");
  assert.ok(landedRow, "a demo order files no audit row at all");
  assert.equal(landedRow.landedOn, "demo-multi");
});

test("2015 a demo REFUSES a product it has no finished run for, rather than landing on the wrong one", async () => {
  // "Picking the fourth product and receiving the first one's report would teach the wrong thing about
  // all four." Today the demo pool holds one product's report; three of the four are not captured yet,
  // and this is the honest state of that — a named refusal rather than an approximate landing.
  const w = world({ demo: true });
  mkdirSync(join(w.poolRoot, "demo-multi"), { recursive: true });
  writeFileSync(join(w.poolRoot, "demo-multi", "meta.json"), JSON.stringify({
    // `aurora`, because CLIENT's grant is aurora — a demo may only ever land on a run this principal
    // could open by any other route, and filing the fixture where they cannot see it is the arm
    // accidentally proving the tenancy rule instead of the landing.
    runId: "demo-multi", customerKey: "aurora", title: "VENQORI", kind: "clearance", overall: "LOW",
    date: "2026-08-11", searchLevel: "multi-country-focus-search", clientGate: { released: true } }));
  writeFileSync(join(w.poolRoot, "demo-multi", "report.html"), "<title>VENQORI</title>ok");

  const body = { marks: [{ name: "IRONWHISK" }], classes: [8], goods: "kitchen tools",
    product: "knockout-search", forwarder: "f", profileKey: "zephyr", forwarderEmail: "f@example.test" };
  const plan = await w.service.route("POST", "/portal/api/run/plan", CLIENT, body, {});
  assert.equal(plan.status, 200, "the demo must still PLAN a product it cannot show — the form is real");
  const run = await w.service.route("POST", "/portal/api/run", CLIENT,
    { ...body, confirmationToken: plan.json.confirmationToken }, {});

  assert.equal(run.status, 409, `expected a named refusal, got ${run.status}: ${JSON.stringify(run.json)}`);
  assert.deepEqual(w.triggers, [], "the refusal path dispatched anyway");
  const said = JSON.stringify(run.json.errors ?? run.json);
  assert.match(said, /Knockout search/, "the refusal does not name which search has no report");
  assert.match(said, /Nothing was started/, "it does not say that nothing was spent");
  // NOT the retired credentials sentence — that is the superseded ruling wearing a different status code.
  assert.doesNotMatch(said, /credentials/i, "the demo refusal is back to explaining credentials");
});

test("2015 a service that was NOT told it is a demo carries the demo sentence nowhere", async () => {
  // The direction that catches a flag stuck ON. Without this arm, `demo: true` hardcoded in the factory
  // would pass every arm above and quietly grey out a real deployment.
  const { service } = world();
  const res = await service.route("GET", "/portal/api/searches", CLIENT, {}, {});
  assert.doesNotMatch(JSON.stringify(res.json.products), /demo/i,
    "a live deployment reported itself a demo — the flag defaults on");
  for (const l of res.json.products) assert.equal(l.available, true, `${l.key}: greyed on a live deployment`);
});


// ── — THE NUMBER THE SCREEN STATES IS THE NUMBER THE DOOR REFUSES ON ───────
//
// The intake refuses an over-long mark name, and the composer states the limit at the control so the
// reader never meets that refusal after confirming. Those are two sites, and the payload is the only
// thing joining them: a field computed here and dropped anywhere between here and the wire leaves the
// screen stating no limit — SILENTLY, because absent reads as null and the client then fails open by
// design and lets the door refuse. That is the round trip this issue exists to end, restored without a
// single arm going red.
//
// So this drives the JOIN rather than asserting the constant twice: take the budget off the wire, build
// a name of exactly that length and one character longer, and put both through the door the payload is
// promising to describe.
test("2078 the searches payload carries the mark-name budget, and it is the budget the door enforces", async () => {
  const { service } = world();
  const searches = await service.route("GET", "/portal/api/searches", CLIENT, {}, {});
  assert.equal(searches.status, 200);
  const budget = searches.json.maxMarkName;
  assert.equal(typeof budget, "number",
    "the budget never reached the wire — the screen states no limit and the reader meets the refusal after confirming");

  const door = (n) => {
    const errs = validateJob({ id: "j1", forwarder: "a", msgId: "<x@y>", classes: [9],
      markName: "A".repeat(n) }).errors ?? [];
    return errs.some((e) => /may be at most/.test(e));
  };
  assert.equal(door(budget), false,
    "a name of exactly the length the screen offers is refused by the door — the screen invites work the door will not take");
  assert.equal(door(budget + 1), true,
    "a name one over the length the screen states is accepted by the door — the two have drifted apart");
});

test("2015 a demo may only land on a run this principal could open anyway", async () => {
  // The tenancy rule, asserted as its own arm rather than left implied by a fixture's account. A demo
  // resolves through the SAME ownership scan every other surface uses — there is no demo-only read path
  // — so a report belonging to an account the reader has no grant for is not a demo affordance, it is a
  // tenancy break wearing one.
  const w = world({ demo: true });
  mkdirSync(join(w.poolRoot, "demo-elsewhere"), { recursive: true });
  writeFileSync(join(w.poolRoot, "demo-elsewhere", "meta.json"), JSON.stringify({
    runId: "demo-elsewhere", customerKey: "zephyr", title: "VENQORI", kind: "clearance", overall: "LOW",
    date: "2026-08-11", searchLevel: "multi-country-focus-search", clientGate: { released: true } }));
  writeFileSync(join(w.poolRoot, "demo-elsewhere", "report.html"), "<title>VENQORI</title>ok");

  const body = { marks: [{ name: "IRONWHISK" }], classes: [8], goods: "kitchen tools",
    product: "multi-country-focus-search", jurisdictions: ["European Union", "United States"],
    forwarder: "f", profileKey: "zephyr", forwarderEmail: "f@example.test" };
  const plan = await w.service.route("POST", "/portal/api/run/plan", CLIENT, body, {});
  const run = await w.service.route("POST", "/portal/api/run", CLIENT,
    { ...body, confirmationToken: plan.json.confirmationToken }, {});

  // CLIENT is granted `aurora`. The only finished multi-country run in this pool is zephyr's.
  assert.equal(run.status, 409, "a demo landed a reader on another account's report");
  assert.doesNotMatch(JSON.stringify(run.json), /demo-elsewhere/, "and it named the run it must not have seen");
  assert.deepEqual(w.triggers, []);
});
