// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The config inventory — what this instance searches.
//
// THE ONE PROPERTY EVERY TEST HERE DEFENDS: a provider that is not configured must produce a ROW SAYING
// SO. Not an omitted row. A page listing two providers is indistinguishable from a page listing a
// complete set of two, so an absence would be invisible at the one surface whose whole job is to show
// it — and this page is BELIEVED, which is what makes a quiet omission expensive rather than untidy.
//
// Every function here is pure and takes its environment, so nothing below reads or writes process.env.

import { test } from "node:test";
import assert from "node:assert/strict";
import { engineInventory, providerInventory, engineMode, ENGINE_MODES } from "../config-inventory.mjs";

/**
 * A fully-wired instance.
 *
 * The credential value is a long distinctive SENTINEL rather than "x" so the disclosure assertion below
 * can search the serialised inventory for it. A one-character value collides with ordinary content —
 * "Perplexity" contains an x — and the test passed for that reason rather than for the right one.
 */
const SECRET = "ZZ-credential-value-that-must-never-be-serialised-ZZ";
const WIRED = {
  CLEAROTRON_AI: "anthropic-agent",
  CLEAROTRON_DATABASE: "corsearch",
  CORSEARCH_SESSION_KEY: SECRET,
  PERPLEXITY_API_KEY: SECRET,
  SERPAPI_API_KEY: SECRET,
};

const row = (rows, key) => rows.find((r) => r.key === key);

// ── the inventory is the KNOWN set, not the configured set ──────────────────────────────────────────

test("#1439 — an instance with NOTHING configured still lists every provider, each marked missing", () => {
  // The decisive test. An empty environment is the state a fresh install is in, and the failure this
  // guards is the one that looks like success: build the list from what the environment holds and an
  // unconfigured instance renders a tidy, complete-looking page with nothing on it.
  const all = providerInventory({});
  // ── — TWO KINDS OF ROW SHARE THIS LIST, and only one is credentialed ──────
  //
  // The capability rows (case law, the engine's own web search) joined the same list deliberately: the
  // config page renders rows generically, so they reach the screen with no second surface to keep in
  // step. They are NOT credentialed providers, and the claim below is about credentialed providers —
  // "nothing configured" is not a state EUR-Lex or the engine's web search can be in, because there is
  // no credential for them to lack. `enrolment` is the discriminator, and it is on the row rather than
  // inferred from the key, so this arm cannot start silently skipping rows it should be checking.
  const rows = all.filter((r) => r.enrolment === undefined);
  assert.ok(rows.length >= 3, "register, research and open-web search are all searched with");
  assert.ok(rows.length < all.length, "the capability rows have gone — this arm is now checking a set of one kind");
  for (const r of rows) {
    assert.equal(r.configured, false, `${r.key} cannot be configured in an empty environment`);
    assert.ok(r.missing.length > 0, `${r.key} must name what is missing, or the row is not actionable`);
  }
  // Named individually, because "length >= 3" would pass on three copies of one row.
  for (const key of ["register", "research", "web"]) {
    assert.ok(row(rows, key), `${key} must have a row even with nothing set`);
  }
});

test("2087 — a capability row carries a remedy instead of a credential, and says which it is", () => {
  // The counterfactual for the filter above: it would also pass on a tree where the capability rows were
  // dropped entirely, which is the state this issue was filed about.
  const caps = providerInventory({}).filter((r) => r.enrolment !== undefined);
  assert.ok(caps.length >= 4, `only ${caps.length} capability row(s) — the case-law census has gone`);
  for (const r of caps) {
    assert.deepEqual(r.missing, [], `${r.provider} names a variable to set — an OAuth enrolment has none`);
    assert.ok(r.remedy !== undefined, `${r.provider} says nothing about what to do`);
    assert.ok(["oauth", "built-in", "absent"].includes(r.enrolment), `${r.provider} has an unknown enrolment kind`);
    // A row that is not configured must say what to do about it, or it is a state with no exit.
    if (!r.configured) assert.ok(r.remedy, `${r.provider} is not set up and offers no way to set it up`);
  }
});

test("#1439 — the same three rows are present when everything IS configured, and say so", () => {
  // The counterfactual for the test above: if the rows were being produced by the absence rather than by
  // the table, this is where that shows.
  const rows = providerInventory(WIRED);
  for (const key of ["register", "research", "web"]) {
    const r = row(rows, key);
    assert.equal(r.configured, true, `${key} is configured in WIRED`);
    assert.deepEqual(r.missing, [], `${key} has nothing missing`);
  }
});

test("#1439 — a missing credential names the VARIABLE and never reads a value out", () => {
  const rows = providerInventory({ ...WIRED, SERPAPI_API_KEY: "" });
  const web = row(rows, "web");
  assert.equal(web.configured, false, "an empty string is not a credential");
  assert.deepEqual(web.missing, ["SERPAPI_API_KEY"]);
  // The whole snapshot is a disclosure surface. No value may appear anywhere in it, so this asserts on
  // the serialised row rather than on a field somebody remembered to check.
  assert.ok(!JSON.stringify(rows).includes(SECRET), "no credential value may reach the inventory");
});

test("#1439 — EVERY required variable, not just the first: euipo needs two and both are named", () => {
  // `missingCredentials` is shared with preflightCredentials precisely so a page cannot say "configured"
  // about an instance the run door will refuse. euipo is the provider that made that a half-check:
  // an id with no secret passes any `Boolean(env[credEnv])` test and dies at the first token request.
  const half = providerInventory({ CLEAROTRON_DATABASE: "euipo", EUIPO_CLIENT_ID: "id" });
  const reg = row(half, "register");
  assert.equal(reg.configured, false, "one of two credentials is not configured");
  assert.deepEqual(reg.missing, ["EUIPO_CLIENT_SECRET"], "and the page names the half that is absent");
});

// ── the register is a CHOICE, and its three failure states are different fixes ──────────────────────

test("#1439 — no register selected is a row naming the SELECTOR, in this release's spelling", () => {
  const reg = row(providerInventory({}), "register");
  assert.equal(reg.provider, null, "none is selected — distinct from one that is selected and unknown");
  assert.equal(reg.known, false);
  // CLEAROTRON_DATABASE, not CLEAROTRON_DATABASE: the page's only use for this name is "set this
  // one", and sending an operator to adopt a name being retired is worse than saying nothing.
  assert.deepEqual(reg.missing, ["CLEAROTRON_DATABASE"]);
});

test("#1439 — a register id this build does not ship is a TYPO, not an unmade choice", () => {
  // Two states that read alike on a page and are fixed differently: nobody chose, versus somebody
  // mistyped. `known` is what keeps them apart.
  const reg = row(providerInventory({ CLEAROTRON_DATABASE: "corsearchh" }), "register");
  assert.equal(reg.provider, "corsearchh", "the id is shown so the typo is visible");
  assert.equal(reg.known, false);
  assert.equal(reg.configured, false);
});

test("#1439 — the register row carries the vendor's own label, never a title-cased id", () => {
  const reg = row(providerInventory(WIRED), "register");
  assert.equal(reg.provider, "corsearch");
  assert.equal(reg.providerLabel, "Corsearch");
});

// ── the engine ──────────────────────────────────────────────────────────────────────────────────────

test("#1439 — the engine reports the vendor, the id, and a subscription bill", () => {
  const e = engineInventory({ ...WIRED, PATH: "" });
  assert.equal(e.id, "anthropic-agent");
  assert.equal(e.vendor, "Anthropic");
  assert.equal(e.known, true);
  assert.equal(e.billing.mode, "subscription");
  assert.equal(e.billing.apiBilled, false);
  assert.deepEqual(e.billing.missing, []);
});

test("#1439 — an unset engine reports the DEFAULT, not an empty one", () => {
  // The page must never render a blank where a default is in force: the engine spawns whatever
  // DEFAULT_ENGINE_ID names, and a reader who saw nothing would go looking for an unset variable.
  const e = engineInventory({ PATH: "" });
  assert.equal(e.id, "anthropic-agent");
  assert.equal(e.known, true);
});

test("#1439 — THE THROW IS THE ROW: api-key billing with no key is recorded, not swallowed", () => {
  // resolveAuthMode REFUSES rather than returning here, because silently billing a subscription the
  // operator thought they had stopped using is the footgun engine/auth.mjs exists to close. A writer
  // that caught that and recorded "unknown" would erase the single misconfiguration this page is most
  // needed for — so it is recorded as itself.
  const e = engineInventory({ CLEAROTRON_AI: "openai-agent", CLEAROTRON_AI_BILLING: "api-key", PATH: "" });
  assert.equal(e.billing.mode, "api-key", "the mode is what the operator set");
  assert.equal(e.billing.apiBilled, false, "…and it is NOT what would happen — believe this field");
  // CODEX_API_KEY, not OPENAI_API_KEY. openai-agent.mjs strips OPENAI_API_KEY for a clean subscription
  // bill, so naming it here would send an operator to set a variable that changes nothing ( item 5).
  assert.deepEqual(e.billing.missing, ["CODEX_API_KEY"]);
});

test("#1439 — api-key billing WITH the key is billed to the key", () => {
  const e = engineInventory({ CLEAROTRON_AI: "openai-agent", CLEAROTRON_AI_BILLING: "api-key", CODEX_API_KEY: "k", PATH: "" });
  assert.equal(e.billing.apiBilled, true);
  assert.deepEqual(e.billing.missing, []);
});

test("#1439 — an engine this build does not ship is marked unknown rather than rendered as a name", () => {
  const e = engineInventory({ CLEAROTRON_AI: "gemini-agent", PATH: "" });
  assert.equal(e.id, "gemini-agent");
  assert.equal(e.known, false);
  assert.equal(e.vendor, null, "there is no vendor to name — the page shows the id");
  assert.equal(e.binaryPresent, false, "nothing to spawn");
});

test("#1439 — a binary that cannot be found is false, not a throw and not a path", () => {
  // preflightEngineBinary throws for four different reasons and every one of them means "this engine
  // cannot run". The refusal that says WHICH belongs at the run door, where the reader can act on the
  // path it quotes; a path must never reach a snapshot a web service renders.
  const e = engineInventory({ CLEAROTRON_AI: "anthropic-agent", CLEAROTRON_CLAUDE_PATH: "definitely-not-here", PATH: "" });
  assert.equal(e.binaryPresent, false);
  assert.ok(!JSON.stringify(e).includes("/"), "no path may reach the snapshot");
});

test("#1439 — the engine id resolves by the RUN DOOR's expression, whitespace included", () => {
  // A whitespace-only value is where the two plausible expressions disagree: `?? ""` then `.trim() ||
  // DEFAULT` falls back to the default, while `(env.X || DEFAULT).trim()` resolves to "" and the door
  // refuses. Reporting a known engine the door will not start is the failure this asserts against.
  const e = engineInventory({ CLEAROTRON_AI: "   ", PATH: "" });
  assert.equal(e.id, "", "empty after trim — the same answer preflightEngineBinary reaches");
  assert.equal(e.known, false, "and it is NOT reported as the default engine");
});

// ── — THE MODE IS DERIVED, AND `engine-ready` IS NOT REACHABLE FROM A FILESYSTEM ─────────────
//
// "no engine" was reported as an ABSENCE — "install it for a real run", "a real run will refuse" — and a
// first-time reader cannot tell a deliberate limited mode from a botched install by reading a list of
// what they are missing. `npm start` seeds an example report into the pool, so demo is a product.
//
// A STORED FLAG IS THE DEFECT THIS AVOIDS. It can disagree with the credentials in either direction and
// the disagreement is silent, which is why this takes an inventory and answers now.

test("#1720 engineMode derives the three states, and growth in neither direction changes that", () => {
  assert.equal(engineMode({ binaryPresent: false }), ENGINE_MODES.DEMO, "nothing to spawn is demo");
  assert.equal(engineMode({ binaryPresent: true }), ENGINE_MODES.UNPROVEN,
    "a resolvable binary is NOT a working engine — a signed-out CLI passes every filesystem test there is");
  assert.equal(engineMode({ binaryPresent: true }, { probe: { ok: true } }), ENGINE_MODES.READY,
    "a completed turn is the only thing that proves it");
  assert.equal(engineMode({ binaryPresent: true }, { probe: { ok: false } }), ENGINE_MODES.UNPROVEN,
    "a FAILED probe is not a proof, and must not read as one");

  // The filesystem fact wins. A probe cannot have completed against a binary that is not there, so if
  // the two ever disagree the inventory is the half to believe.
  assert.equal(engineMode({ binaryPresent: false }, { probe: { ok: true } }), ENGINE_MODES.DEMO,
    "a passing probe over a missing binary must not lift the mode");

  // FAIL-SAFE ON ABSENCE. An inventory nobody could build is not evidence of an engine.
  for (const nothing of [null, undefined, {}, { binaryPresent: undefined }]) {
    assert.equal(engineMode(nothing), ENGINE_MODES.DEMO, `${JSON.stringify(nothing)} must not read as an engine`);
  }
});

test("#1720 NOTHING short of a completed probe produces `engine-ready`", () => {
  // The property, driven rather than asserted once. If a later edit lets any filesystem-derived shape
  // reach READY, the portal — which can never probe — starts claiming an engine works because a file is
  // executable, which is the exact sentence the issue forbids.
  const shapes = [];
  for (const binaryPresent of [true, false]) {
    for (const known of [true, false]) {
      for (const mode of ["subscription", "api-key", "unknown"]) {
        for (const apiBilled of [true, false]) {
          shapes.push({ id: "anthropic-agent", vendor: "Anthropic", known, binaryPresent, billing: { mode, apiBilled, missing: [] } });
        }
      }
    }
  }
  assert.equal(shapes.length, 24, "the matrix collapsed — this arm would then prove almost nothing");

  for (const inv of shapes) {
    assert.notEqual(engineMode(inv), ENGINE_MODES.READY, `reached READY with no probe: ${JSON.stringify(inv)}`);
    // …and every one of them still answers, rather than returning undefined for a shape nobody planned.
    assert.ok(Object.values(ENGINE_MODES).includes(engineMode(inv)), `unnamed mode for ${JSON.stringify(inv)}`);
  }

  // The probe results that are NOT a completed turn. `ok` is the field, and a truthy object is not it.
  const live = { binaryPresent: true };
  for (const probe of [{}, { ok: "yes" }, { ok: 1 }, { ok: null }, { failed: false }, null]) {
    assert.equal(engineMode(live, { probe }), ENGINE_MODES.UNPROVEN,
      `${JSON.stringify(probe)} was accepted as a completed turn`);
  }
});

// ══ 2072/2089: the setup wizard DERIVES its search-credential prompts from these tables ═══════════

test("every research and web adapter carries its reader-terms pair — absentMeans and obtain", async () => {
  // The wizard's prompt loop and its before-you-start list render these fields; a row without them is
  // an adapter a reader meets as a bare variable name, which is the SERPAPI defect one generation on:
  // the credential existed, the code required it, and nothing on the reader's path ever said so.
  const { RESEARCH_PROVIDERS, SERP_PROVIDERS } = await import("../driver.config.mjs");
  for (const [table, rows] of [["RESEARCH_PROVIDERS", RESEARCH_PROVIDERS], ["SERP_PROVIDERS", SERP_PROVIDERS]]) {
    for (const [id, a] of Object.entries(rows)) {
      assert.ok(typeof a.absentMeans === "string" && a.absentMeans.length > 10,
        `${table}.${id} declares no absentMeans — the wizard would prompt with nothing to say about the cost of skipping`);
      assert.ok(typeof a.obtain === "string" && a.obtain.length > 10,
        `${table}.${id} declares no obtain line — the reader is asked for a key with nowhere to get one`);
      // Reader terms: the consequence sentence may not lean on an environment-variable spelling.
      assert.ok(!/_API_KEY|_SESSION_KEY|CLEAROTRON_/.test(a.absentMeans),
        `${table}.${id}'s absentMeans hands the reader a variable name instead of a consequence`);
    }
  }
});
