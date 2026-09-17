// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A RUN LIST THAT NAMES NO CLIENT CANNOT ANSWER A QUESTION ABOUT ONE.
//
// Observed on a live deployment: a lawyer asked their assistant for one client's recent searches. The
// session held several clients. The assistant listed eight runs — seven for one client, one for
// another — and twice answered that none were for the client named, offering to start a new search.
// One of those eight was a batch delivered to that client the same day; it surfaced only when the
// lawyer named one of the marks in it.
//
// THE ANSWER FOLLOWED FROM THE ROWS, NOT FROM THE MODEL. No row carried a client, and the name-shaped
// filter read the mark and the identifier only, so no reading of that list could have answered the
// question. The engine knew throughout: the same frozen sidecar decides who may SEE each run.
//
// DRIVEN THROUGH THE REAL TOOL over real run directories, because the defect is in what the tool
// returns to a session, and a unit test of the row builder would have passed on the day this happened.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { driverDir } from "../../shared/driver-dir.mjs";
import { pinEnv } from "../../shared/env-aliases.mjs";

process.env.TRADEMARK_MCP_TOKEN_SECRET ||= "test-secret-run-list";

// Two clients of one firm, and a third run whose own record cannot be read.
const CLIENTS = {
  aurora: "Aurora Botanicals",
  celta: "Celta Foods",
};

function workspace() {
  const ws = mkdtempSync(join(tmpdir(), "run-list-client-"));
  const mk = (slug, run, key, markName, project) => {
    const d = join(ws, "workspace-test", "studio", "clearance-search", slug, run);
    mkdirSync(driverDir(d), { recursive: true });
    writeFileSync(join(d, "status.json"), JSON.stringify({
      schema: 1, runId: `${slug}-${run}`, slug, codename: run, agent: "test",
      state: "delivered", markName, updatedAt: "2026-01-01T00:00:00Z",
    }));
    // The REAL frozen shape — `profileKey` and `name`, as driver/pipeline.mjs freezeProfile writes it.
    // A fixture writing the reader's shape instead of the sidecar's is what masked a live reader bug
    // once already (grants.test.mjs records it), so this one follows the producer.
    if (key) writeFileSync(driverDir(d, "profile.json"), JSON.stringify({
      profileKey: key, name: CLIENTS[key],
      ...(project ? { projectKey: project.key, projectName: project.name } : {}),
    }));
  };
  mk("tmp1-lumen", "run-a", "aurora", "LUMEN");
  mk("tmp2-verdant", "run-b", "aurora", "VERDANT", { key: "rebrand-26", name: "Rebrand 2026" });
  mk("tmp3-pellar", "run-c", "celta", "PELLAR");
  mk("tmp4-orphan", "run-d", null, "ORPHAN");   // its own record is unreadable
  return ws;
}

async function withWorkspace(fn) {
  const ws = workspace();
  const saved = process.env.CLEAROTRON_WORK_DIR;
  pinEnv(process.env, "CLEAROTRON_WORK_DIR", ws);
  try {
    const { tools, filterByAccounts } = await import("../server.mjs");
    await fn({ tools, filterByAccounts });
  } finally {
    pinEnv(process.env, "CLEAROTRON_WORK_DIR", saved);
    rmSync(ws, { recursive: true, force: true });
  }
}

test("THE LAWYER'S QUESTION, in one call: a session holding two clients asks for one by NAME", async () => {
  await withWorkspace(({ tools, filterByAccounts }) => {
    const scope = { kind: "ops", accounts: ["aurora", "celta"] };

    // The question as asked — the client's name, not the mark's, and not an identifier the lawyer has
    // never seen. This is the call that used to come back empty.
    const asked = filterByAccounts(scope, "list_runs", tools.list_runs({ mark: "Aurora Botanicals" }));
    assert.deepEqual(asked.map((r) => r.markName).sort(), ["LUMEN", "VERDANT"],
      "asking for a client by name returned something other than that client's searches");
    for (const row of asked) {
      // THE FIELD FIRST, then its value. Dereferencing a missing `client` throws, and a stack trace is a
      // worse answer than a sentence when the thing that broke is "the row stopped naming its client".
      assert.ok(row.client, `the row for ${row.markName} carries no client at all`);
      assert.equal(row.client.key, "aurora", "a row for another client came back");
    }

    // PART OF THE NAME, because nobody types a client's registered spelling into a chat window.
    assert.deepEqual(tools.list_runs({ mark: "aurora bot" }).map((r) => r.markName).sort(), ["LUMEN", "VERDANT"]);
    assert.deepEqual(tools.list_runs({ mark: "celta" }).map((r) => r.markName), ["PELLAR"]);

    // THE OTHER TWO NAMES A QUESTION ARRIVES WITH, and the one it always could. The mark filter is one
    // parameter answering "find it by whichever name I hold", so all three are asserted together —
    // separately, a repair that moved one off the filter would leave the others passing.
    assert.deepEqual(tools.list_runs({ mark: "LUMEN" }).map((r) => r.markName), ["LUMEN"], "the mark still finds it");
    assert.deepEqual(tools.list_runs({ mark: "Rebrand 2026" }).map((r) => r.markName), ["VERDANT"], "the project does too");

    // AND A NAME NOBODY HOLDS FINDS NOTHING — a filter that matched everything would pass every
    // assertion above while answering the lawyer's question wrongly in the other direction.
    assert.deepEqual(tools.list_runs({ mark: "Meridian Shipping" }), []);
  });
});

test("EVERY ROW NAMES ITS CLIENT, and a run whose record cannot be read SAYS SO", async () => {
  await withWorkspace(({ tools }) => {
    const rows = tools.list_runs({});
    assert.ok(rows.length >= 4, `the fixture put four runs on disk and the tool returned ${rows.length}`);
    const by = (mark) => rows.find((r) => r.markName === mark);

    for (const mark of ["LUMEN", "PELLAR", "VERDANT", "ORPHAN"])
      assert.ok(by(mark)?.client, `the row for ${mark} carries no client field at all`);
    assert.deepEqual(by("LUMEN").client, { key: "aurora", name: "Aurora Botanicals" });
    assert.deepEqual(by("PELLAR").client, { key: "celta", name: "Celta Foods" });
    assert.deepEqual(by("VERDANT").project, { key: "rebrand-26", name: "Rebrand 2026" },
      "a run started under a project does not name it");
    assert.equal(by("LUMEN").project, null, "a run with no project invented one");

    // THE ABSENCE IS STATED. A row that simply left the field out is what made eight rows unanswerable;
    // "the engine cannot tell" is a different sentence, and one a reader can act on.
    const orphan = by("ORPHAN");
    assert.equal(orphan.client.known, false, "an unreadable record left the field out instead of saying so");
    assert.equal(orphan.client.key, null);
    assert.match(orphan.client.note, /could not be read/);
  });
});

test("THE NEW FIELD RIDES BEHIND THE ACCOUNT GATE — it never widens who sees what", async () => {
  await withWorkspace(({ tools, filterByAccounts }) => {
    const scoped = { kind: "ops", accounts: ["aurora"] };

    // A session granted ONE client gets only its own runs, each naming its own client.
    const mine = filterByAccounts(scoped, "list_runs", tools.list_runs({}));
    assert.deepEqual(mine.map((r) => r.markName).sort(), ["LUMEN", "VERDANT"]);
    for (const row of mine) {
      assert.ok(row.client, `the row for ${row.markName} carries no client at all`);
      assert.equal(row.client.name, "Aurora Botanicals");
    }

    // AND NAMING ANOTHER FIRM'S CLIENT TEACHES IT NOTHING. The filter widened what is FOUND; the gate
    // decides what is RETURNED, and it runs after. Both halves are asserted, because "the answer is
    // empty" would also be true of a filter that had simply stopped working.
    assert.deepEqual(filterByAccounts(scoped, "list_runs", tools.list_runs({ mark: "Celta Foods" })), [],
      "a scoped session learned about a client it was not granted");
    assert.equal(tools.list_runs({ mark: "Celta Foods" }).length, 1,
      "the row was not found at all — this assertion is passing for the wrong reason");

    // The untagged run stays invisible to a scoped session, as it was before this change: an
    // unreadable record is answered ON the row for a session that may see it, never made visible by it.
    assert.equal(mine.some((r) => r.markName === "ORPHAN"), false);
  });
});

test("THE DESCRIPTION STOPS CALLING THE LIST ONE CLIENT'S — for every session kind", async () => {
  // The other half of the defect. Told the list is "the searches on this account", a session holding
  // several clients reads an empty result as "that client has nothing" rather than "this list was not
  // asked the right way" — and `list_runs` had no client-facing text at all, so the lawyer's session
  // was handed the operator's line.
  const { TOOL_DEFS, describeForAudience } = await import("../server.mjs");
  const def = TOOL_DEFS.find((d) => d.name === "list_runs");
  assert.ok(def, "list_runs is not in the tool table — this test is reading nothing");

  for (const kind of ["ops", "account", "user"]) {
    const text = describeForAudience(def, kind).description;
    assert.doesNotMatch(text, /searches on this account/i, `the ${kind} description still calls the list one client's`);
    assert.match(text, /client/i, `the ${kind} description does not say the rows name their client`);
  }

  // THE CLIENT CUT EXISTS, and differs from the operator's — a cut that fell back to the operator text
  // would satisfy the loop above while leaving the lawyer's session reading the line that misled it.
  assert.notEqual(describeForAudience(def, "account").description, def.description,
    "the account audience is being handed the operator description");

  // AND IT NAMES NO CLIENT AND OFFERS NO ROSTER. A description is served to every session before any
  // gate applies, so an example client in it would be a name leak at the one surface that has none.
  for (const kind of ["account", "user"]) {
    const text = describeForAudience(def, kind).description;
    for (const name of Object.values(CLIENTS)) assert.doesNotMatch(text, new RegExp(name, "i"));
    assert.doesNotMatch(text, /list_profiles|the roster|every client on/i,
      "the client cut points at a way to enumerate clients");
  }
});

// ── AND WHAT KIND OF SEARCH IT WAS, which is the same defect one turn later ─────────────────────────
//
// A mark and a date are not a key. Asked about "the LUMEN clearance from that day", a session holding
// the whole account gets two rows, both that mark, both delivered, differing only in which search ran —
// and the row carried nothing to tell them apart but the runId, an internal slug a client has never seen
// and which this tool's own description says is not theirs to read. A report-bound session was always
// safe, because its scope carries the runId whatever the question says; an account-scoped one had only
// the list.
//
// ITS OWN WORKSPACE, not the one above. That fixture is asserted row for row by the arms that own it,
// and the pair this arm needs — one mark, one day, two products — would have changed their populations
// to make room. An arm that edits another arm's ground is how a fixture stops proving what it says.
//
// BREAK MATRIX:
//   · every row says which search it was      → break: leave the field off, arm 1 red
//   · two runs of one mark are told apart     → break: derive it from the runId, arm 2 red
//   · the words are the report's own          → break: invent a label here, arm 3 red
//   · a level the registry lost says nothing  → break: fall back to the stored id, arm 4 red
test("EVERY ROW SAYS WHICH SEARCH IT WAS, so one mark on one day is not two indistinguishable rows", async () => {
  const ws = mkdtempSync(join(tmpdir(), "run-list-product-"));
  const mk = (slug, run, markName, level) => {
    const d = join(ws, "workspace-test", "studio", "clearance-search", slug, run);
    mkdirSync(driverDir(d), { recursive: true });
    writeFileSync(join(d, "status.json"), JSON.stringify({
      schema: 1, runId: `${slug}-${run}`, slug, codename: run, agent: "test",
      state: "delivered", markName, updatedAt: "2026-01-01T00:00:00Z",
    }));
    writeFileSync(driverDir(d, "profile.json"), JSON.stringify({ profileKey: "aurora", name: CLIENTS.aurora }));
    // The frozen LEVEL — the product's id, in the sidecar the resolver reads. The run records which
    // search ran; what that search is CALLED is the registry's answer at read time, so an archived run
    // is named the way the product is named today.
    if (level) writeFileSync(driverDir(d, "search-policy.json"), JSON.stringify({ level }));
  };
  // The pair the question lands on: same client, same mark, same day, two different searches.
  mk("p1-lumen-fc", "run-a", "LUMEN", "full-country-search");
  mk("p2-lumen-ko", "run-b", "LUMEN", "knockout-search");
  mk("p3-pellar", "run-c", "PELLAR", "multi-country-focus-search");
  mk("p4-retired", "run-d", "RETIRED", "a-level-that-never-existed");   // a row retired since the run
  mk("p5-nolevel", "run-e", "NOLEVEL", null);                           // older than the sidecar

  const saved = process.env.CLEAROTRON_WORK_DIR;
  pinEnv(process.env, "CLEAROTRON_WORK_DIR", ws);
  try {
    const { tools } = await import("../server.mjs");
    const rows = tools.list_runs({});
    for (const row of rows) {
      assert.ok("product" in row, `the row for ${row.markName} does not carry the search it was at all`);
    }

    const lumen = rows.filter((r) => r.markName === "LUMEN");
    assert.equal(lumen.length, 2, "the fixture no longer holds the two runs this arm is about");
    assert.deepEqual(lumen.map((r) => r.product).sort(), ["Full country search", "Knockout search"],
      "the two runs of one mark are not told apart by the row");

    // THE REGISTRY'S WORDS, not a label written here: these are what the report's own header prints.
    assert.equal(rows.find((r) => r.markName === "PELLAR").product, "Multi-country focus search");

    // A LEVEL THE REGISTRY LOST, and a run with no sidecar at all: both say nothing rather than guess.
    // A hardcoded fallback is how a knockout once announced itself as a product it provably was not.
    assert.equal(rows.find((r) => r.markName === "RETIRED").product, null,
      "a level this build has never heard of was given a name anyway");
    assert.equal(rows.find((r) => r.markName === "NOLEVEL").product, null,
      "a run with no frozen level was given a name anyway");
  } finally {
    pinEnv(process.env, "CLEAROTRON_WORK_DIR", saved);
    rmSync(ws, { recursive: true, force: true });
  }
});
