// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// E3 — $0 tests for the gather MCP layer: the config builder (pure) + each wrapped server's real MCP
// stdio round-trip (handshake → tools/list → a creds-missing guard call). No real vendor API is hit (that
// is the cents euipo round-trip + the paid A/B); these prove the servers SPEAK MCP and expose the right
// tools, and that the per-stage tool selection is correct.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const MCP = join(HERE, "..", "engine", "mcp");
import { buildGatherMcpConfig, allowedToolsFor, toolGroupsForStage, TOOL_FREE_STAGES, RECORDING_STAGES, RECORDING_TOOLS, RECORDING_KEYS, seatWritesForGroups, RECORDING_STAGES_KEEPING_RETRIEVAL } from "../engine/mcp/gather-config.mjs";
// A1 — the surface is the argv the engine BUILDS, never what the grant map returns.
import { buildClaudeArgs } from "../engine/anthropic-agent.mjs";
import { STAGES } from "../stages.mjs";
import { KO_STAGES } from "../stages-knockout.mjs";


// TAIL — PINNING A PROVIDER FOR A CHILD MEANS PINNING EVERY SPELLING. `driver.config.mjs`
// resolves the register provider from the current name first, so a child that inherits
// `CLEAROTRON_DATABASE` from the operator's shell and is handed only the legacy name runs as the
// INHERITED provider — silently, for every case in the loop. Measured: `CLEAROTRON_DATABASE=clarivate
// npm test` reported clarivate's numbers under all six provider names. Derived from the table so the
// next rename carries it.
const pinProvider = (value) => Object.fromEntries(
  ["CLEAROTRON_DATABASE"].map((n) => [n, value]));

// Spawn a server, run a sequence of JSON-RPC requests over stdio, return responses keyed by id.
async function mcpSession(serverScript, requests, env = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(MCP, serverScript)], { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, ...env } });
    const responses = {}; let buf = "", stderr = "";
    const wantIds = new Set(requests.filter((r) => r.id != null).map((r) => r.id));
    const done = () => { try { child.kill("SIGKILL"); } catch { /* gone */ } resolve({ responses, stderr }); };
    const timer = setTimeout(done, 8000);
    child.stdout.on("data", (d) => {
      buf += d.toString(); let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
        if (!line) continue;
        try { const m = JSON.parse(line); if (m.id != null) { responses[m.id] = m; wantIds.delete(m.id); } } catch { /* non-json */ }
      }
      if (wantIds.size === 0) { clearTimeout(timer); done(); }
    });
    child.stderr.on("data", (d) => { stderr += d.toString(); });
    child.on("error", reject);
    for (const r of requests) child.stdin.write(JSON.stringify(r) + "\n");
  });
}
const INIT = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } };
const LIST = { jsonrpc: "2.0", id: 2, method: "tools/list" };
const toolNames = (resp) => (resp.responses[2]?.result?.tools ?? []).map((t) => t.name).sort();

// ── gather-config (pure) ─────────────────────────────────────────────────────
test("toolGroupsForStage: gather stages → groups; judgment stages → none", () => {
  // — TWO groups now. The disposition transport left the shared `perplexity` entry for its own
  // key, granted to this lane and no other: it was held by four stages and ordered by one, and the
  // three that never ordered it were holding a writer into this lane's ruling ledger.
  assert.deepEqual(toolGroupsForStage("common-law"), ["perplexity", "dispositions"]);
  assert.deepEqual(toolGroupsForStage("common-law-half:a"), ["perplexity", "dispositions"], "A1 split — the half member rides the common-law prefix, disposition key included");
  // — TWO groups now, the `dispositions` shape one lane over: the unit's audit
  // note rides its own key. NOT on `register` — that key is the funnel's and a record tool on it would be
  // enumerated into every holder's grant, which is the second-writer disease arriving as an allowlist side
  // effect. NOT a RECORDING key either: this stage keeps a legitimate seat write (the lane-off band, live
  // for a matter with no Nice classes), and every RECORDING row declares `seatWrites: false`.
  assert.deepEqual(toolGroupsForStage("register-unit:primary-sweep"), ["register", "unit-note"]);
  assert.deepEqual(toolGroupsForStage("case-law"), ["caselaw"]);
  // matter-frame CONVERTED (conversion 2): its group is its own record key. It carries TWO tools —
  // the record tool and the Class 2 read surface — but the GROUP is still one key, and the key is the
  // stage's own so no sibling recording seat is handed a writer into the frame.
  assert.deepEqual(toolGroupsForStage("matter-frame"), ["recording-matter-frame"]);
  // THE TOOL-FREE CONTROL, and it moved in conversion 4 because report-overview used to be it. It is
  // `notify` now and it should stay there: notify is OWNER-HELD and outside the conversion programme, so
  // the control stops being re-homed by every conversion. What it proves is about a stage the map does
  // not name — that the catch-all still returns nothing — never about report-overview specifically.
  assert.deepEqual(toolGroupsForStage("notify"), []);
  // report-overview CONVERTED (conversion 4): its group is its own record key. The first converted stage
  // whose artifact a client reads.
  assert.deepEqual(toolGroupsForStage("report-overview"), ["recording-report-overview"]);
  // report-card CONVERTED (conversion 5) — and its group resolves under the DISPATCHED name, which
  // carries the axis. That is the whole obstacle this conversion had to solve first.
  assert.deepEqual(toolGroupsForStage("report-card"), ["recording-report-card"]);
  assert.deepEqual(toolGroupsForStage("report-card:26"), ["recording-report-card"]);
  // skeptic CONVERTED (second recording stage): its group is its own record key, not a retrieval grant.
  assert.deepEqual(toolGroupsForStage("skeptic"), ["recording-skeptic"]);
});

// ── — the `return ` catch-all is CLOSED against the stage registry ────────────────────────────
// A stage this map does not name gets no MCP servers and no allowlist, and gets them silently: the turn
// simply cannot call anything, and a prompt that ordered a live check reads as a model that declined to.
// That shipped once already (register-digest's prompt ordered live register checks while this map gave it
// no register tools). Every stage must now resolve to tools OR be declared tool-free WITH A REASON.
test("#249: every stage either holds tool groups or is DECLARED tool-free — nothing falls into the catch-all", () => {
  const stages = Object.keys(STAGES);
  assert.ok(stages.length > 10, `only ${stages.length} stages — this guard is sweeping nothing`);
  const silent = stages.filter((s) => toolGroupsForStage(s).length === 0 && !(s in TOOL_FREE_STAGES));
  assert.deepEqual(silent, [],
    `these stages resolve to NO tool groups and are not declared tool-free: ${silent.join(", ")} — they run with no MCP servers loaded, silently. Add a branch to toolGroupsForStage, or add each to TOOL_FREE_STAGES with the reason it needs nothing.`);
  // The reverse: a declared tool-free stage that later GAINS tools must lose its declaration, and a
  // declaration for a stage that no longer exists is dead weight.
  const contradicted = Object.keys(TOOL_FREE_STAGES).filter((s) => toolGroupsForStage(s).length > 0);
  assert.deepEqual(contradicted, [], `declared tool-free but granted tools: ${contradicted.join(", ")}`);
  const dead = Object.keys(TOOL_FREE_STAGES).filter((s) => !stages.includes(s));
  assert.deepEqual(dead, [], `TOOL_FREE_STAGES names stages that do not exist: ${dead.join(", ")}`);
  for (const [s, why] of Object.entries(TOOL_FREE_STAGES))
    assert.ok(typeof why === "string" && why.length > 20, `TOOL_FREE_STAGES["${s}"] must state WHY it needs no tools`);
  // …and the guard must actually have exercised both sides.
  assert.ok(stages.some((s) => toolGroupsForStage(s).length > 0), "no stage resolved to any tool group — the map is not being read");
});

// PR-8 (reading layer): the band-consuming judgment stages hold the READ-ONLY band tools; synthesis
// DROPS the live register group (new register work enters only through the supplemental mint in a
// register-unit lane — a live search from the judgment seat is the un-frozen query the plan freeze
// retired). This also ends the register-digest "register tools you hold" prompt/grant mismatch.
test("PR-8 grants: digest/placement/refutation → band; synthesis → perplexity+band, NO live register", () => {
  // Typed transport: the digest additionally holds its OWN record tool on its OWN key — coverage
  // rulings ride record_coverage; the key is deliberately not on the shared `band` group (a record
  // tool riding a shared key would be enumerated into every holder's grant — the second-writer
  // disease as an allowlist side effect, the RECORDING split's own warning).
  //, conversion 11 — …and it has now GAINED its recording key too, so this stage
  // holds retrieval, its coverage transport AND its record tool: three keys, three distinct statements.
  // The enumeration moves by exactly one token and the assertion stays an EXACT set, for the reason the
  // two rows below give — both claims this test exists to make survive it, because the retrieval half is
  // unchanged and there is still no live register group. `coverage` deliberately does NOT merge into the
  // new key: the obligation ledger and the findings document are different artifacts with different
  // writers, and merging them would put a second writer into the ledger took one out of.
  assert.deepEqual(toolGroupsForStage("register-digest"), ["band", "coverage", "recording-register-digest"]);
  assert.deepEqual(toolGroupsForStage("placement-inquiry"), ["band"]);
  // — narrative-refutation GAINED perplexity. PR-8's contract is about the LIVE REGISTER group, and
  // that is untouched: a reading-layer stage holding perplexity was already the design (synthesis, one
  // line down). Its own served doctrine ordered one scoped `perplexity_research` probe while the grant
  // denied it, and on a delivered production run the stage ran nineteen minutes under an instruction it
  // could not execute, making zero such calls with no denial recorded anywhere.
  // — …and it has now GAINED its recording key, the same shape synthesis's `declination` row takes
  // one line down: the enumeration moves by exactly one token and the assertion stays an EXACT set. Both
  // claims this test exists to make survive it — the retrieval half is unchanged and there is still no
  // live register group. This stage is also the first to hold retrieval AND recording at once; that is
  // declared on its row as `keepsRetrieval: true` and checked by O4, not left to this pin.
  assert.deepEqual(toolGroupsForStage("narrative-refutation"), ["perplexity", "band", "recording-narrative-refutation"]);
  // — synthesis gained `declination` (record_declination: it states, per record, why something on
  // its findings surface was not delivered). then added its RECORDING key: the writer
  // hands its narrative and findings record through `record_synthesis` and the driver renders both. The
  // ENUMERATION moved by exactly one token each time; both claims this test exists to make are
  // untouched, which is why the row moves rather than the assertion relaxing — it is still an EXACT set
  // and it still holds no live register group. It is also the second stage to carry retrieval AND
  // recording keys at once, so the recording key is listed here rather than resolved by the derived
  // branch — see toolGroupsForStage's early return.
  assert.deepEqual(toolGroupsForStage("synthesis"), ["perplexity", "band", "declination", "recording-synthesis"]);
  assert.ok(!toolGroupsForStage("synthesis").includes("register"), "synthesis must not hold the live register group");
  // — …AND THE GROUP LIST IS NOT WHERE THIS ONE IS VISIBLE, which is why the assertion is on the
  // resolved allowlist instead. Both rows above are UNCHANGED by the disposition split: neither stage
  // ever named a `dispositions` group, they held `record_dispositions` because it was a second tool on
  // the `perplexity` ENTRY, one level below the group. So a test that only compares group lists reads
  // this change as a no-op — the exact blindness that let the grant sit here unexamined. Ask the table
  // that ENFORCES.
  for (const stage of ["synthesis", "narrative-refutation"]) {
    assert.ok(!/record_dispositions/.test(allowedToolsFor(toolGroupsForStage(stage))),
      `${stage} holds a disposition writer no dictation of its own ever orders — the common-law lane's transport, arriving as an allowlist side effect of the shared perplexity entry`);
  }
  // …and the lane that IS ordered to record them still can, under the new name.
  assert.ok(allowedToolsFor(toolGroupsForStage("common-law")).split(" ").includes("mcp__dispositions__record_dispositions"),
    "the common-law lane lost the tool its own doctrine orders — the split subtracted from the wrong stage");
  // The invariant PR-8 actually protects, now asserted for this stage too — the grant widened by exactly
  // one group and the reading layer still holds no live register tool.
  assert.ok(!toolGroupsForStage("narrative-refutation").includes("register"),
    "narrative-refutation must not hold the live register group either");
  // the funnel keeps its live tools — the reading layer never touches the search layer's grants
  assert.deepEqual(toolGroupsForStage("register-unit:incumbent-class"), ["register", "unit-note"]);
});

test("PR-8 band config: neutral `band` server mounted, run dir threaded, tools allow-listed", () => {
  const b = buildGatherMcpConfig(["band"], { sessionKey: "k", agent: "clawdi", runDir: "/tmp/run-x" });
  assert.ok(b.mcpServers.band, "band server present under the neutral key");
  assert.match(b.mcpServers.band.args[0], /band-server\.mjs$/);
  assert.equal(b.mcpServers.band.env.CLEAROTRON_BAND_RUN_DIR, "/tmp/run-x", "the band server serves THIS run's band/shape/_records");
  const allowed = allowedToolsFor(["band"]);
  for (const t of ["band_lookup", "band_record", "band_shape"]) assert.ok(allowed.split(" ").includes(`mcp__band__${t}`), `${t} allow-listed`);
  const synth = allowedToolsFor(toolGroupsForStage("synthesis"));
  assert.ok(!/mcp__register__/.test(synth), "no register_* tool reaches synthesis's allowlist");
  assert.match(synth, /mcp__perplexity__perplexity_research/);
  assert.match(synth, /mcp__band__band_lookup/);
});

test("band server: handshake + 3 read-only tools + missing-run-dir guard returns clean isError", async () => {
  const call = { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "band_lookup", arguments: { owner: "acme" } } };
  const r = await mcpSession("band-server.mjs", [INIT, LIST, call], { CLEAROTRON_BAND_RUN_DIR: "" });
  assert.equal(r.responses[1]?.result?.serverInfo?.name, "band");
  assert.deepEqual(toolNames(r), ["band_lookup", "band_record", "band_shape"]);
  assert.equal(r.responses[3]?.result?.isError, true);
  assert.match(r.responses[3]?.result?.content?.[0]?.text ?? "", /CLEAROTRON_BAND_RUN_DIR not set/);
});

test("buildGatherMcpConfig: maps groups → the right MCP servers + threads the run session key", () => {
  const p = buildGatherMcpConfig(["perplexity"], { sessionKey: "prelim-x-y-stage", agent: "clawdi" });
  assert.ok(p.mcpServers.perplexity, "perplexity server present");
  assert.equal(p.mcpServers.perplexity.command, process.execPath);
  assert.match(p.mcpServers.perplexity.args[0], /perplexity-server\.mjs$/);
  assert.equal(p.mcpServers.perplexity.env.CLEAROTRON_GATHER_SESSION_KEY, "prelim-x-y-stage");
  assert.equal(p.mcpServers.perplexity.env.CLEAROTRON_GATHER_AGENT, "clawdi");

  // The register provider mounts under the NEUTRAL key `register` — never the vendor's name. That key is
  // what `mcp__register__register_*` allowlist entries and pipeline.mjs's excludeTools bind to, so it must
  // stay stable across a REGISTER_PROVIDER swap; the vendor only decides which script sits behind it.
  // — a register server needs the run it fetches for; the box-global record ledger is retired.
  const r = buildGatherMcpConfig(["register"], { sessionKey: "k", runDir: "/tmp/run-register" });
  assert.ok(r.mcpServers.register, "register group → the neutral register server");
  assert.ok(!r.mcpServers.corsearch && !r.mcpServers.clarivate && !r.mcpServers.signa && !r.mcpServers["uspto-local"],
    "no vendor-named MCP server key may be mounted — the register surface is provider-neutral");
  assert.match(r.mcpServers.register.args[0], /(corsearch|clarivate|signa|euipo|uspto-local)-server\.mjs$/,    "the neutral key resolves to the active provider's server script");
  //: this assertion USED TO READ `r.mcpServers.register && r.mcpServers.euipo` — it PINNED the
  // credential-blind attach, mounting the EU tools beside the paid vendor on every register-unit
  // stage whether or not the instance held EUIPO credentials. EUIPO is a register PROVIDER now, so it
  // arrives under the neutral key or not at all. `euipo` as a SECOND mounted key is the defect.
  assert.ok(!r.mcpServers.euipo,
    "euipo must not mount as its own server key — it is the active register or it is absent");

  const c = buildGatherMcpConfig(["caselaw"]);
  assert.ok(c.mcpServers.courtlistener && c.mcpServers.legaldatahunter, "caselaw → bridge servers");
  assert.ok(c.mcpServers.courtlistener.args.includes("--server") && c.mcpServers.courtlistener.args.includes("courtlistener"));
});

test("allowedToolsFor: namespaced local tools + bridge wildcards + WebFetch + stage I/O", () => {
  const a = allowedToolsFor(["perplexity"]);
  assert.match(a, /mcp__perplexity__perplexity_research/);
  for (const io of ["Read", "Write", "Edit"]) assert.ok(a.split(" ").includes(io));
  const reg = allowedToolsFor(["register"]);
  assert.match(reg, /mcp__register__register_search/);
  // judgment-relocation: the funnel is MANDATED to enumerate the dangerous band via register_enumerate
  // (unit.md / register-recipes.md / stages.mjs register-unit message). It MUST be on the register group's
  // allowlist or every register-unit run is denied the tool the whole design hangs on — guard that wiring.
  assert.match(reg, /mcp__register__register_enumerate/, "the funnel's enumerate primitive must be allow-listed for the register group");
  //: this line USED TO ASSERT `mcp__euipo__euipo_search` — a vendor-named tool id in the
  // register group's allowlist, which is what the credential-blind attach put there. Nothing
  // vendor-named may survive in this namespace.
  assert.ok(!/mcp__euipo__/.test(reg),
    "no vendor-named euipo tool id may ride the register allowlist — the surface is provider-neutral");
  const cl = allowedToolsFor(["caselaw"]);
  assert.match(cl, /mcp__courtlistener__\*/);
  assert.match(cl, /mcp__legaldatahunter__\*/);
  assert.ok(cl.split(" ").includes("WebFetch"));
});

// ── each wrapped server speaks MCP + exposes the right tools ──────────────────
test("perplexity server: handshake + tools/list", async () => {
  // The list is pinned for the same reason the register servers' lists are: a tool that quietly appears
  // or disappears changes what the seat is able to do, and nothing else would notice.
  //
  // `record_dispositions` (B) was ADDED deliberately — the typed disposition transport, so the seat sends
  // values instead of hand-typing a 140 KB JSON document. It is named here rather than the assertion
  // being loosened, because relaxing this pin to accommodate one intended change retires it for every
  // unintended one.
  //
  // — AND IT IS GONE AGAIN, to its own module and its own grant key. The pin SHRINKS rather than
  // relaxes, for that same reason: the arm below is where the tool has to reappear, so a "move" that
  // actually dropped the tool reddens instead of reading as an intended subtraction here.
  const r = await mcpSession("perplexity-server.mjs", [INIT, LIST], { PERPLEXITY_API_KEY: "" });
  assert.equal(r.responses[1]?.result?.serverInfo?.name, "perplexity");
  assert.deepEqual(toolNames(r), ["perplexity_research"]);
});

test("dispositions server: handshake + the one tool, under its own server name (#1332)", async () => {
  // THE OTHER HALF OF THE MOVE, and the only test in the suite that LOADS this module. Everything else
  // that looks at it reads source text — the served-vs-granted scan parses a `tools:` declaration, the
  // census reads a directory listing — so a wrong relative import or a bad symbol name would sail
  // through all of them and fail on the first live common-law stage, which is where the disposition
  // ledger is. Spawning it is what makes the split observable off a real run.
  //
  // The SERVER NAME is asserted, not incidental: it is what the seat's tool is namespaced by, so
  // `mcp__dispositions__record_dispositions` in the grant table is only true if this answers
  // "dispositions".
  const r = await mcpSession("dispositions-server.mjs", [INIT, LIST], {});
  assert.equal(r.responses[1]?.result?.serverInfo?.name, "dispositions");
  assert.deepEqual(toolNames(r), ["record_dispositions"]);
});

test("corsearch server: handshake + 8 tools + creds-missing guard returns clean isError", async () => {
  const call = { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "register_search", arguments: { name: "ACME" } } };
  const r = await mcpSession("corsearch-server.mjs", [INIT, LIST, call], { CORSEARCH_SESSION_KEY: "" });
  assert.deepEqual(toolNames(r), ["register_batch_screen", "register_enumerate", "register_execute_plan", "register_expand_phoneme", "register_image_fetch", "register_propose_supplemental", "register_record_fetch", "register_search"]);
  assert.equal(r.responses[3]?.result?.isError, true);
  assert.match(r.responses[3]?.result?.content?.[0]?.text ?? "", /CORSEARCH_SESSION_KEY not set/);
});

// PHASE 5 — the clarivate server must serve the SAME neutral contract, minus exactly the one tool the
// provider genuinely cannot honour. Two things are pinned here because both fail SILENTLY otherwise:
// (a) the seven names, so a swap cannot quietly drop a tool the funnel's design hangs on
//     (register_enumerate / register_execute_plan / register_propose_supplemental especially);
// (b) the ABSENCE of register_expand_phoneme is cross-checked against the provider's own capability
//     contract — flipping phonemeExpansion to true without wiring a tool (or wiring a weaker stub
//     while the contract still says false) fails CI instead of shipping a phantom capability.
test("clarivate server: handshake + 7 tools, phoneme expansion absent-not-stubbed, creds guard", async () => {
  const { CAPABILITIES } = await import("../../providers/clarivate/src/capabilities.js");
  const call = { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "register_search", arguments: { name: "ACME", regions: ["CH"] } } };
  const r = await mcpSession("clarivate-server.mjs", [INIT, LIST, call], { CLARIVATE_API_KEY: "" });
  assert.equal(r.responses[1]?.result?.serverInfo?.name, "register", "the server key is neutral, never the vendor's name");
  const names = toolNames(r);
  assert.deepEqual(names, ["register_batch_screen", "register_enumerate", "register_execute_plan",
    "register_image_fetch", "register_propose_supplemental", "register_record_fetch", "register_search"]);
  assert.equal(names.includes("register_expand_phoneme"), CAPABILITIES.phonemeExpansion,
    "the phoneme-expansion tool must be present IFF the capability contract claims the provider has it — "
    + "a lacking capability is deferred loudly, never stubbed with a weaker search under the right name");
  assert.equal(r.responses[3]?.result?.isError, true);
  assert.match(r.responses[3]?.result?.content?.[0]?.text ?? "", /CLARIVATE_API_KEY not set/);
});

// — the local US index. Same neutral contract, minus the two tools it genuinely cannot serve, and
// with the one guard in this file that is NOT a credential: this provider's register is a FILE, so what
// it refuses on is USPTO_LOCAL_DB. Three things are pinned because all three fail silently:
// (a) the six names, so a later edit cannot quietly drop register_enumerate / register_execute_plan /
//     register_propose_supplemental — the tools the whole funnel design hangs on;
// (b) the ABSENCE of register_expand_phoneme, cross-checked against the provider's own capability
//     contract exactly as clarivate's is, and the absence of register_image_fetch, which has no
//     capability flag anywhere and would therefore reappear unnoticed if someone copied a server file;
// (c) the guard's message NAMES the variable. An unset path with a vague error is a stage that fails
//     with nobody able to say what to set.
test("uspto-local server: handshake + 6 tools, images and phonemes absent-not-stubbed, index guard", async () => {
  const { CAPABILITIES } = await import("../../providers/uspto-local/src/capabilities.js");
  const call = { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "register_search", arguments: { name: "ACME" } } };
  const r = await mcpSession("uspto-local-server.mjs", [INIT, LIST, call], { USPTO_LOCAL_DB: "" });
  assert.equal(r.responses[1]?.result?.serverInfo?.name, "register", "the server key is neutral, never the provider's name");
  const names = toolNames(r);
  assert.deepEqual(names, ["register_batch_screen", "register_enumerate", "register_execute_plan",
    "register_propose_supplemental", "register_record_fetch", "register_search"]);
  assert.equal(names.includes("register_expand_phoneme"), CAPABILITIES.phonemeExpansion,
    "the phoneme-expansion tool must be present IFF the capability contract claims it — and this "
    + "provider has no phonetic surface at all (capabilities.predicates.phonetic is null), so a "
    + "phonetic slice defers rather than degrading into a contains");
  assert.ok(!names.includes("register_image_fetch"),
    "the USPTO bulk product is TEXT — it carries the drawing code and no image data, so there is no "
    + "weaker image to serve and nothing is stubbed");
  assert.equal(r.responses[3]?.result?.isError, true);
  assert.match(r.responses[3]?.result?.content?.[0]?.text ?? "", /USPTO_LOCAL_DB not set/);
  // The refusal must say WHY a missing index is not an empty register. This provider is the one where
  // those two are confusable: every other provider's absent credential fails at the wire, and an
  // unconfigured local index would simply have nothing in it.
  assert.match(r.responses[3]?.result?.content?.[0]?.text ?? "", /clean US register/);
});

// The neutral namespace must RESOLVE for every provider that declares a server — a swap that throws at
// config-build time takes the whole register stage down, and it would only surface on the flip.
test("every REGISTER_SERVERS provider resolves to a mounted `register` key + its allowlist", async () => {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const run = promisify(execFile);
  const script = 'import("./driver/engine/mcp/gather-config.mjs").then(m=>{const c=m.buildGatherMcpConfig(["register"],{sessionKey:"k",runDir:"/tmp/run-register"});'
    + 'console.log(JSON.stringify({servers:Object.keys(c.mcpServers),script:c.mcpServers.register.args[0],'
    + 'tools:m.allowedToolsFor(["register"]).split(" ").filter(x=>x.startsWith("mcp__register__")).length}))})';
  const repo = join(HERE, "..", "..");
  // — signa is 4, not 2; then took it to 5 by wiring register_propose_supplemental.
  // It was pinned at 2 while its server advertised 4, and because
  // `allowedToolsFor` is built FROM `REGISTER_SERVERS[p].tools`, this assertion compared the table with
  // itself: vacuous about the server, and then actively DEFENDING the gap, since the correct grant failed
  // it. The count stays — a silent widening is still worth catching — but the question it cannot answer
  // now has its own file: register-advertisement-vs-grant.test.mjs compares each server's real tools/list
  // against its resolved grant, for every provider the table declares.
  for (const [provider, expected] of [["corsearch", 8], ["clarivate", 7], ["signa", 5], ["euipo", 7], ["uspto-local", 6], ["free-tier", 7]]) {    const { stdout } = await run(process.execPath, ["-e", script], { cwd: repo, env: { ...process.env, ...pinProvider(provider) } });
    const got = JSON.parse(stdout.trim().split("\n").pop());
    assert.ok(got.servers.includes("register"), `${provider}: the neutral register key must mount`);
    assert.match(got.script, new RegExp(`${provider}-server\\.mjs$`), `${provider}: resolves to its own server script`);
    assert.equal(got.tools, expected, `${provider}: mcp__register__* allowlist size`);
  }
});

// — THE SIXTH SIBLING, and its absence is why the grant gap lived for four weeks. Every other
// provider had a `handshake + N tools` test; signa had none, so it was the one provider whose
// advertisement was never compared to anything, and the only pin on it read the grant table against
// itself. Four tools, named, so a swap cannot quietly drop the two the funnel design hangs on.
test("signa server: handshake + 5 tools + creds-missing guard returns clean isError", async () => {
  // `query`, not `name` —. This fixture sent `{ name: "ACME" }`, which signa's
  // register_search does not declare at all while declaring `query` REQUIRED. It reached the creds guard
  // anyway because nothing validated arguments against the schema, so the arm proved the guard fires on a
  // call the tool would never accept. With the seam validating, an empty-of-`query` call is refused at the
  // door and never reaches the guard — correctly, but it would stop this arm testing what it is named for.
  // The property is unchanged and now proven on a CONFORMING call: valid arguments, absent key, key error.
  const call = { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "register_search", arguments: { query: "ACME" } } };
  const r = await mcpSession("signa-server.mjs", [INIT, LIST, call], { SIGNA_API_KEY: "" });
  assert.equal(r.responses[1]?.result?.serverInfo?.name, "register",
    "the server identifies as the neutral `register`, never as the vendor");
  assert.deepEqual(toolNames(r),
    ["register_enumerate", "register_execute_plan", "register_propose_supplemental",
      "register_record_fetch", "register_search"]);
  // enumerate and execute_plan are the two / wired and the grant did not follow;
  // propose_supplemental is 's, and while it was absent the driver's composed prose ordered it
  // unconditionally. Named individually because a count alone would pass on any five, and because these
  // three are what the register funnel actually hangs on.
  assert.ok(toolNames(r).includes("register_enumerate"), "the page loop's tool must be served");
  assert.ok(toolNames(r).includes("register_execute_plan"), "the plan executor's tool must be served");
  assert.ok(toolNames(r).includes("register_propose_supplemental"), "the supplemental mint must be served");
  assert.equal(r.responses[3]?.result?.isError, true);
  assert.match(r.responses[3]?.result?.content?.[0]?.text ?? "", /SIGNA_API_KEY/);
});

test("euipo server: handshake + the 7 NEUTRAL tools + creds-missing guard returns clean isError", async () => {
  //: this server used to serve `euipo_search` / `euipo_record_fetch` as a side tool. It now serves
  // the neutral register_* names as a register provider, under the server key `register`.
  const call = { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "register_search", arguments: { name: "ACME" } } };
  const r = await mcpSession("euipo-server.mjs", [INIT, LIST, call], { EUIPO_CLIENT_ID: "", EUIPO_CLIENT_SECRET: "" });
  assert.equal(r.responses[1]?.result?.serverInfo?.name, "register",
    "the server identifies as the neutral `register`, never as the vendor");
  assert.deepEqual(toolNames(r), [
    "register_batch_screen", "register_enumerate", "register_execute_plan", "register_image_fetch",
    "register_propose_supplemental", "register_record_fetch", "register_search",
  ]);
  // register_expand_phoneme is ABSENT, not stubbed: there is no phonetic surface here to preview
  // variants of (`=phonetic=`, `=fuzzy=` and `~=` all 400 at a valid size), so the slice defers and is
  // disclosed rather than degrading into a contains under the phonetic name.
  assert.ok(!toolNames(r).includes("register_expand_phoneme"),
    "a capability this provider lacks must be ABSENT from the tool list, never stubbed");
  // Fail-closed BY NAME before any call — an unset credential must never become an empty EU register.
  assert.equal(r.responses[3]?.result?.isError, true);
  assert.match(r.responses[3]?.result?.content?.[0]?.text ?? "", /EUIPO_CLIENT_ID/);
  assert.match(r.responses[3]?.result?.content?.[0]?.text ?? "", /clean EU register/);
});

// The recording server's served list, pinned like perplexity's: a record tool that quietly appears or
// disappears changes what a recording seat's server process is serving, and nothing else would notice.
// The ONE script is mounted under BOTH per-stage keys, so every tool here is served to every recording
// seat's process — the per-key allowlist is what keeps a sibling's tool uncallable, and the census
// (server-tools-granted-or-stated.test.mjs) pins that each tool is granted to exactly one stage.
test("recording server: handshake + the served list pinned + missing-run guard refuses by name, record and read paths both", async () => {
  const call = { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "record_skeptic", arguments: { flags: [], escalations: [] } } };
  // The read surface must hold the SAME no-run contract as the record tools: a search with no run wired
  // is a refusal by name, never a guess at a directory ('s lesson, applied to the read path too).
  const searchCall = { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "search_run_artifacts", arguments: { file: "register-findings.md", terms: ["x"] } } };
  const r = await mcpSession("recording-server.mjs", [INIT, LIST, call, searchCall], { CLEAROTRON_BAND_RUN_DIR: "" });
  assert.equal(r.responses[1]?.result?.serverInfo?.name, "recording");
  //, third conversion — `record_frame_diff` joins the served list. The list is pinned by NAME and
  // not by count, so a conversion has to come here deliberately: a tool that appeared without this edit
  // would be a record surface every recording seat's process serves, with nobody having written it down.
  // Conversion 2 adds `record_matter_frame` to the SERVED list. Served is not granted: every recording
  // seat's process serves all five, and the per-key `tools` array is what its allowlist derives from.
  // Conversion 4 adds `record_report_overview` — the first served tool whose artifact a client reads.
  // Conversion 5 adds `record_report_card` — the first whose artifact is one of MANY, per finding.
  // Conversion 6 adds `record_doubt_closure` — the LAST of the eight, and the only one that arrived by a
  // module MOVING rather than being written: closure-server.mjs served this tool inertly since and
  // is deleted here, because a second module serving a live tool is a dead surface that looks live.
    // TWO conversions land together, so the served list gains TWO tools and reads TEN. `record_synthesis`
    // is the writer — the first served tool that writes TWO artifacts of one judgment (the narrative a
    // lawyer reads and the findings record everything downstream is built from) and the first that accepts
    // a PATCH, so a repair sends the finding objects it corrects and the driver re-renders from the values
    // it already holds. `record_narrative_refutation` is the reviewer — the first whose seat KEEPS its
    // retrieval groups, so it is also the first whose stage holds a live source to check its record
    // against. Both were merged from separate branches; the list is alphabetical and neither is "the
    // ninth" any more, which is why the count is stated and not the ordinal.
    // Conversion 11 adds `record_register_digest` — the findings document, and the widest PARSER
    // surface of any converted artifact (nine readers). Served is not granted: this list is every tool
    // the one recording module exposes, and `toolGroupsForStage` is what decides which stage may call
    // which. The list is pinned by NAME so a conversion that lands a tool cannot land it silently.
    assert.deepEqual(toolNames(r), ["record_blind_frame", "record_doubt_closure", "record_frame_diff", "record_knockout_assess", "record_knockout_frame", "record_matter_frame", "record_narrative_refutation", "record_prelim_variants", "record_register_digest", "record_report_card", "record_report_overview", "record_skeptic", "record_synthesis", "search_run_artifacts"]);
  // The guard answer is a structured {error} payload, same as record_blind_frame's: the server answers
  // rather than erroring, and the text names the contract (per-run wiring, no run_dir parameter).
  const text = r.responses[3]?.result?.content?.[0]?.text ?? "";
  assert.match(text, /started without a run/, "an unset run dir must refuse by name, never guess a run");
  const searchText = r.responses[4]?.result?.content?.[0]?.text ?? "";
  assert.match(searchText, /started without a run/, "the read surface too: no run wired means refuse by name, never guess");
});

// ── THE RECORDING CATEGORY — SCAFFOLDING, ARMED BEFORE IT CARRIES A STAGE ────────────────────────────
//
// Acceptance was written before the shapes (O1–O4 + six additions). The category is DELIBERATELY EMPTY:
// a stage moves in only with its own conversion PR, and only once the corpus measurement shows it loses
// no tool it demonstrably uses. These guards exist now so the category lands the day that clears.
//
// AN EMPTY SET MAKES EVERY MEMBERSHIP ASSERTION VACUOUS, which is the whole hazard of arming early. So
// every check below is paired with a PLANTED VIOLATION driven through the same predicate — the assertion
// is shown to fail before it is trusted to pass.

// ── THE PARTITION SPANS TWO LANES NOW, AND ONE STAGE IS NOT YET IN IT ───────────────────────────────
//
// This arm read `Object.keys(STAGES)` — the clearance table — because that was every stage there was.
// knockout-assess's conversion put a RECORDING stage in the knockout table, so the union began naming a
// stage the population did not contain, and the arm failed on "a category names a stage that does not
// exist" while nothing was wrong with any category.
//
// Widening the population to both tables is correct and it exposes `knockout-frame`, which holds no MCP
// group at all: it lands in none of the three categories, which is exactly the state this arm's last
// assertion exists to refuse — "they run with no MCP servers and no allowlist, silently, which shipped
// once already". That IS true of it today and the conversion is the next PR.
//
// So it is NAMED here rather than hidden by scoping the arm back to one lane, and rather than declared
// tool-free — `TOOL_FREE_STAGES` says in as many words that it is empty and that empty is its finished
// state, and a row added there to be retired one PR later would reopen a closed statement to buy a green.
// The reverse arm below is what stops this list outliving its reason, the same way
// RECORDING_STAGES_KEEPING_RETRIEVAL's does.
// EMPTY, AND THAT IS THE FINISH LINE. `knockout-frame` sat here because it held no MCP group and landed
// in none of the three categories — genuinely the state the last assertion refuses. Its conversion
// ( item C) put it in `rec`, and the reverse arm below is what said so: it fails the
// moment an exempted stage acquires a category, so the exemption's death date was chosen by the
// measurement rather than by anyone deciding the work was done.
//
// The list stays, empty, with its arms live. Both lanes are converted today; the next lane that arrives
// unconverted needs this to be a mechanism rather than a comment, and the loop below runs over whatever
// it holds.
const UNPARTITIONED_STAGES = Object.freeze([]);

/**
 * THE REVERSE ARM'S PREDICATE, EXTRACTED SO IT CAN BE DRIVEN WHILE THE LIST IS EMPTY.
 *
 * As of item C `UNPARTITIONED_STAGES` has no members, so the loop that used to sit
 * inline in O4 walks nothing and its two refusals are unreachable. Keeping the mechanism for the next
 * unconverted lane while nothing exercises it is the shape that redded item B's own gate — a fix for an
 * empty population that had an empty population itself. One definition, called by the arm and planted
 * against by the negative control, so the two cannot drift apart.
 */
function assertExemptionsStillEarned(exempt, stages, union) {
  for (const stage of exempt) {
    assert.ok(stages.has(stage), `${stage} is exempted from the partition and is not a stage on any lane — drop the row`);
    assert.ok(!union.has(stage),
      `${stage} is exempted from the partition and now HOLDS a category — delete it from UNPARTITIONED_STAGES `
      + "in the commit that converted it, or the exemption reads as a standing decision about a stage nothing excuses");
  }
}

test("O4: the partition is CLOSED three ways — disjoint pairwise, and the union is every stage", () => {
  const stages = new Set([...Object.keys(STAGES), ...Object.keys(KO_STAGES)]);
  // "tooled" means holds a RETRIEVAL group. A recording stage resolves to a group too, so the old
  // `length > 0` put the first recording stage into `tooled` AND `rec` and tripped the disjointness
  // check on a correct conversion.
  //
  // ✕ THE KEYS THEMSELVES, NOT WHAT RECORDING STAGES HAPPEN TO HOLD. This read
  // `Object.keys(RECORDING_STAGES).flatMap(toolGroupsForStage)` — the union of every group held by a
  // recording stage — which equals the recording keys ONLY while every recording stage holds nothing but
  // its own. narrative-refutation holds `perplexity` and `band` too, so both leaked into "the recording
  // groups", and `placement-inquiry` — which holds only `band` — stopped counting as tooled and fell into
  // NO category. The arm then failed naming `placement-inquiry`, a stage nothing had touched: it named
  // the victim, not the cause. `RECORDING_KEYS` is the derived set of keys, so a recording stage's
  // retrieval grant can no longer move another stage's category.
  const recGroups = RECORDING_KEYS;
  const tooled = new Set(Object.keys(STAGES).filter((s) => toolGroupsForStage(s).some((g) => !recGroups.has(g))));
  const free = new Set(Object.keys(TOOL_FREE_STAGES));
  const rec = new Set(Object.keys(RECORDING_STAGES));

  const overlap = (a, b) => [...a].filter((x) => b.has(x));
  assert.deepEqual(overlap(tooled, free), [], "a stage is both tooled and declared tool-free");
  // ✕ NO LONGER EMPTY, AND NOT WEAKENED TO NOTHING. "Tooled" and "recording" were disjoint only while
  // every recording stage held its record tool alone; narrative-refutation records its artifact AND
  // verifies against live sources, which is the whole reason its conversion keeps perplexity and band.
  // Asserting `[]` here would now be false, and deleting the assertion would let any stage acquire
  // retrieval silently. So the overlap is compared against the DECLARED list instead: entering the mixed
  // state costs a `keepsRetrieval: true` on the row and nothing less.
  assert.deepEqual(overlap(tooled, rec).sort(), [...RECORDING_STAGES_KEEPING_RETRIEVAL],
    "a recording stage holds a retrieval group without declaring `keepsRetrieval: true` on its row — or "
    + "declares it and no longer holds one. Recording is not a retrieval grant by default; the mixed "
    + "state is legitimate and must be written down");
  // THE REVERSE ARM. Without it the declaration outlives its reason: a stage that loses its retrieval
  // groups keeps a flag nobody re-derives, and the arm above then fails naming the wrong side.
  for (const stage of RECORDING_STAGES_KEEPING_RETRIEVAL) {
    assert.ok(toolGroupsForStage(stage).some((g) => !RECORDING_KEYS.has(g)),
      `${stage} declares keepsRetrieval: true and holds no retrieval group — drop the flag rather than `
      + "leaving an exemption that can no longer be exercised");
  }
  assert.deepEqual(overlap(free, rec), [], "a stage is both tool-free and recording; recording stages hold a grant, so they are no longer tool-free");

  const union = new Set([...tooled, ...free, ...rec]);
  assert.deepEqual([...stages].filter((s) => !union.has(s) && !UNPARTITIONED_STAGES.includes(s)), [],
    "these stages are in NO category — they run with no MCP servers and no allowlist, silently, which shipped once already");
  // THE REVERSE ARM, so the exemption cannot outlive the fact. A named stage that HAS acquired a category
  // must leave this list in the commit that gives it one; otherwise the list quietly excuses a stage the
  // partition is already covering, and the next reader takes the exemption for a standing decision.
  assertExemptionsStillEarned(UNPARTITIONED_STAGES, stages, union);
  assert.deepEqual([...union].filter((s) => !stages.has(s)), [], "a category names a stage that does not exist");
});

test("O4 NEGATIVE CONTROL: the partition checks FAIL on planted violations — both ways", () => {
  // Without this the three assertions above are satisfied by an empty recording set forever. Each is
  // driven through the same predicate against a planted case, so the guard is shown to bind.
  const overlap = (a, b) => [...a].filter((x) => b.has(x));
  // …a stage in two categories.
  assert.notDeepEqual(overlap(new Set(["matter-frame"]), new Set(["matter-frame"])), [],
    "the disjointness predicate does not detect a stage present in two categories");
  // …and a stage in none: the union check must notice it is missing.
  const stages = new Set(["a", "b"]);
  const union = new Set(["a"]);
  assert.deepEqual([...stages].filter((s) => !union.has(s)), ["b"],
    "the union predicate does not detect a stage that belongs to no category");

  // ── AND THE EXEMPTION'S REVERSE ARM, WHOSE POPULATION IS NOW EMPTY ───────────────────────────────
  //
  // Driven through the SAME function the arm above calls, never a paraphrase of it: a copy asserts what
  // its author remembered, and the point of this control is the code that actually runs.
  assert.throws(() => assertExemptionsStillEarned(["ghost-stage"], new Set(["real-stage"]), new Set()),
    /is not a stage on any lane/,
    "the reverse arm does not refuse an exemption naming a stage that is on no lane");
  assert.throws(
    () => assertExemptionsStillEarned(["real-stage"], new Set(["real-stage"]), new Set(["real-stage"])),
    /now HOLDS a category/,
    "the reverse arm does not refuse an exemption for a stage that has since acquired a category — which is "
    + "exactly how an exemption outlives its reason");
  // …and it PASSES a legitimate row, so this control is not satisfied by a predicate that always throws.
  assert.doesNotThrow(() => assertExemptionsStillEarned(["real-stage"], new Set(["real-stage"]), new Set()),
    "the reverse arm refuses a stage that is genuinely exempt — the predicate is not discriminating, it is "
    + "just failing");
});

test("O1: a recording stage's grant EQUALS the recording allowlist — set equality, never `includes`", () => {
  // Vacuous today by construction, and it says so. The predicate is asserted against planted sets so it
  // is known to reject a missing member AND an extra one — "an assertion that names members of a set
  // does not pin the set" is this repo's own rule, learned from a check that passed on both.
  // PER STAGE (Shape 2). One shared allowlist would be satisfied by every recording stage holding every
  // recording tool — the widening this check exists to prevent would make it GREEN. A missing row is a
  // finding, not an empty expectation: without the first assertion below, a stage with no row would
  // compare against [] and fail with a confusing message instead of the true one.
  for (const stage of Object.keys(RECORDING_STAGES)) {
    assert.ok(Array.isArray(RECORDING_TOOLS[stage]),
      `${stage} is a recording stage with no RECORDING_TOOLS row — its grant is unpinned, which reads exactly like a pinned one`);
    const granted = allowedToolsFor(toolGroupsForStage(stage)).split(/\s+/).filter(Boolean).sort();
    assert.deepEqual(granted, [...RECORDING_TOOLS[stage]].sort(), `${stage}: grant must EQUAL its recording allowlist`);
  }
  // …and no row for a stage that is not a recording stage — the same staleness the exemption tables get.
  assert.deepEqual(Object.keys(RECORDING_TOOLS).filter((s) => !(s in RECORDING_STAGES)), [],
    "RECORDING_TOOLS names a stage that is not in RECORDING_STAGES — delete the row");
  const want = ["Read", "Write", "mcp__rec__record"].sort();
  assert.notDeepEqual(["Read", "Write"].sort(), want, "the equality predicate does not notice a MISSING member");
  assert.notDeepEqual(["Read", "Write", "mcp__rec__record", "Bash"].sort(), want, "…nor an EXTRA one");
});

test("A1/O3b BASELINE: today a tool-free stage is passed NO allowlist and NO strict flag — pinned at the argv", () => {
  // The fact O3b will compare against, recorded BEFORE the first conversion, because afterwards nobody
  // can prove what the surface used to be. Asserted on the argv the engine BUILDS, never on what the map
  // returns: the surface is decided by an `if (groups.length)` two call-sites away from the map anyone
  // would read, and reasoning from the map is exactly how the two-box model came to over-promise.
  // buildClaudeArgs returns { args, input } — destructured, because reading the object as an array
  // gives `args.includes is not a function` and would have looked like a failing assertion.
  const { args } = buildClaudeArgs({ message: "x", model: "opus", thinking: "low", cwd: "/tmp", runDir: "/RUN" });
  assert.ok(!args.includes("--allowedTools"), "a tool-free stage must currently receive NO allowlist — if this fails, the baseline moved and O3b's before/after is invalid");
  assert.ok(!args.includes("--strict-mcp-config"), "…and no strict flag, since no MCP config is passed");
  assert.ok(args.includes("--permission-mode") && args.includes("acceptEdits"), "acceptEdits is unconditional — it is what makes the absent allowlist consequential");
  // The positive leg: with a config and an allowlist, BOTH flags appear. Proves the assertions above are
  // reading a real argv rather than an empty array.
  const { args: armed } = buildClaudeArgs({ message: "x", model: "opus", thinking: "low", cwd: "/tmp", runDir: "/RUN", mcpConfig: "{}", allowedTools: "Read Write" });
  assert.ok(armed.includes("--allowedTools") && armed.includes("--strict-mcp-config"), "the argv builder does not push the flags it is given — this test is reading nothing");
});
