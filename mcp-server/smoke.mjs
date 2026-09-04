// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Manual smoke: spawn the real server process and drive it over MCP (SDK client) against the test fixture.
//   node smoke.mjs
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { buildFixture, buildRichRun, RUN_ID2 } from "./test/_fixture.mjs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
buildFixture(); // sets CLEAROTRON_WORK_DIR / CLEAROTRON_REGISTER_CALL_LOG + writes the fixture
buildRichRun(); // a second, archived run: a re-digest (sha change), BLOCKING→CONDITIONAL, a _history snapshot

const transport = new StdioClientTransport({ command: "node", args: [join(here, "server.mjs")], env: { ...process.env } });
const client = new Client({ name: "smoke", version: "0.0.0" }, { capabilities: {} });
await client.connect(transport);

const tools = await client.listTools();
console.log("tools:", tools.tools.length, "→", tools.tools.map((t) => t.name).join(", "));

const call = async (name, args) => JSON.parse((await client.callTool({ name, arguments: args })).content[0].text);

const list = await call("list_runs", {});
console.log("list_runs →", list.length, "run(s);", list[0]?.runId);
const rid = list[0].runId;

const br = await call("brief", { runId: rid });
console.log("brief → source:", br.source, "| note:", !!br._note, "| model-leak:", /(claude|sonnet|opus|gemini|deepseek)/i.test(br.brief));

const tr = await call("trace", { runId: rid, target: "F1" });
console.log("trace F1 → kind:", tr.resolvedAs.kind, "| owner:", tr.finding?.owner, "| url:", tr.record?.url, "| verdict:", tr.judgment.verdict);

const ts = await call("trace", { runId: rid, target: "report-overview" });
console.log("trace report-overview → inputs:", ts.emittingStage.inputs.map((i) => i.name).join(","), "| escalated:", ts.judgment.skepticEscalated.join(","));

const pu = await call("get_provider_usage", { runId: rid });
console.log("usage → total:", pu.live.total, "search:", pu.live.search, "record_fetch:", pu.live.record_fetch, "drift:", pu.drift);

const cov = await call("get_coverage", { runId: rid });
console.log("coverage → complete:", cov.complete, "ledger:", cov.coverageLedgerPresent, "axes:", cov.registerAxes.map((a) => `${a.axis}:${a.present}`).join(" "));

const wf = await call("what_if_plan", { runId: rid, stage: "report-overview", instructions: "tighten the read" });
console.log("what_if_plan → runnable:", wf.runnable, "completeness:", wf.completeness, "external:", wf.externalCalls.slice(0, 28));

const cards = await call("list_findings", { runId: rid, group: "on-field" });
console.log("list_findings group=on-field →", cards.items.length, "card(s):", cards.items.map((c) => c.who).join(" | "));

const res = await client.listResources();
console.log("resources:", res.resources.length, "e.g.", res.resources[0]?.uri);
const reportUri = res.resources.find((r) => r.uri.endsWith("/report"))?.uri;
const rd = await client.readResource({ uri: reportUri });
console.log("read", reportUri, "→", rd.contents[0].text.length, "bytes");

// ---- trace / search / decision_timeline / run_changes ----
const trS = await call("trace", { runId: rid, target: "report-overview", shallow: true });
console.log("trace shallow → mode:", trS.mode, "| providerUsage:", typeof trS.providerUsage === "string" ? "skipped" : "present", "| findingsSource:", trS.findingsSource);

const sAll = await call("search", { runId: RUN_ID2, query: "MYRKUR similar mark conflict", mode: "all" });
const sPhrase = await call("search", { runId: RUN_ID2, query: "MYRKUR similar mark conflict", mode: "phrase" });
console.log("search mode=all →", sAll.hits.length, "hit(s); mode=phrase →", sPhrase.hits.length, "hit(s) (expected 0)");

const dt = await call("decision_timeline", { runId: RUN_ID2 });
console.log("decision_timeline →", dt.timeline.length, "milestones; verdictHistory:", dt.verdictHistory.join("→"), "| riskLadderAvailable:", dt.riskLadderAvailable);

const since = dt.timeline[2].ts;
const rc = await call("run_changes", { runId: RUN_ID2, since });
console.log("run_changes since", since, "→", rc.count, "change(s); cursor(seq):", rc.cursor);
const rc2 = await call("run_changes", { runId: RUN_ID2, since: rc.cursor }); // re-poll on the seq cursor
console.log("run_changes re-poll since cursor →", rc2.count, "change(s) (expected 0)");

const da = await call("diff_artifact", { runId: RUN_ID2, name: "registerFindings" });
console.log("diff_artifact rich →", da.identical === null ? "nothing-to-diff" : `diff a=${da.a} b=${da.b}`, "| snapshots:", da.snapshotsAvailable.length);
const daNorm = await call("diff_artifact", { runId: rid, name: "registerFindings" });
console.log("diff_artifact normal →", daNorm.identical === null ? "nothing-to-diff (honest)" : "unexpected-diff");
// security: diff_artifact a/b path-escape (absolute + traversal) must be refused (the pre-deploy-review fix)
const dAbs = await client.callTool({ name: "diff_artifact", arguments: { runId: RUN_ID2, name: "registerFindings", a: "/tmp", b: "canonical" } });
const dTrav = await client.callTool({ name: "diff_artifact", arguments: { runId: RUN_ID2, name: "registerFindings", a: "../../../../tmp", b: "canonical" } });
const dAxis = await client.callTool({ name: "diff_artifact", arguments: { runId: RUN_ID2, name: "primary-sweep", axis: "../../etc" } });
console.log("diff_artifact escape refs → absolute isError:", !!dAbs.isError, "| traversal isError:", !!dTrav.isError, "| bad-axis isError:", !!dAxis.isError);

const sr = await call("search_runs", { query: "MYRKUR", scope: "key-artifacts" });
console.log("search_runs MYRKUR →", sr.hits.length, "hit(s) across", sr.runsScanned, "run(s); first:", sr.hits[0]?.runId);

// security: registerUnit path-traversal must be refused (artifactPath returns null → "not recognized")
const trav = await client.callTool({ name: "read_artifact", arguments: { runId: rid, name: "registerUnit:../../../CLAUDE" } });
console.log("traversal read_artifact → isError:", !!trav.isError);
// security: what_if_run with no token must be refused
const noTok = await client.callTool({ name: "what_if_run", arguments: { confirmationToken: "" } });
console.log("what_if_run empty-token → isError:", !!noTok.isError);

await client.close();
console.log("SMOKE OK");
