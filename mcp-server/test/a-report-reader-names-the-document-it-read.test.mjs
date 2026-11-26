// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// A REPORT READER NAMES THE DOCUMENT IT READ, AND ITS SHAPE REUSES WHAT THE REPORT DATA ALREADY PUBLISHES.
//
// The six tools that answer from a run's report document (brief, list_findings, get_finding, list_evidence,
// list_searches, get_search_coverage) carry, in their structured result, the version of the document the call read
// (`report-document/clearance-1`, `report-document/knockout-1`), or null where it read the run's own files. The text
// block an assistant reads is unchanged.
//
// Where one of their fields means what a field of the published report data means, the declared shape uses report
// data's own definition, copied so it stands alone for an offline client; this file holds each copy equal to the
// published one, so the two cannot drift. A demo answer passes its shape, and a real answer with a changed or missing
// required field is refused.
import { mkdtempSync, mkdirSync, writeFileSync, cpSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pinEnv } from "../../shared/env-aliases.mjs";   // — a fixture pins EVERY spelling

const ROOT = mkdtempSync(join(tmpdir(), "report-reader-"));
const POOL = join(ROOT, "pool");
mkdirSync(POOL, { recursive: true });
pinEnv(process.env, "CLEAROTRON_WORK_DIR", ROOT);
pinEnv(process.env, "CLEAROTRON_REPORTS_DIR", POOL);
pinEnv(process.env, "CLEAROTRON_QUEUE_DIR", join(ROOT, "intake-queue"));

const { test, before } = await import("node:test");
const assert = (await import("node:assert/strict")).default;
const { makeServer } = await import("../server.mjs");
const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
const { AjvJsonSchemaValidator } = await import("@modelcontextprotocol/sdk/validation/ajv-provider.js");
const { outputSchemaFor, DOCUMENT_READERS } = await import("../lib/result-shapes.mjs");
const { config } = await import("../lib/driver.mjs");

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");
const STUDIO = join(ROOT, `workspace-${config.defaultAgent}`, "studio", "clearance-search");
const RD = (name) => JSON.parse(readFileSync(join(REPO, "docs", "report-data", `${name}.schema.json`), "utf8"));
const IDS = {};

before(() => {
  for (const product of readdirSync(join(REPO, "demo")).filter((n) => existsSync(join(REPO, "demo", n, "meta.json")))) {
    const s = JSON.parse(readFileSync(join(REPO, "demo", product, "run", "status.json"), "utf8"));
    const dir = join(STUDIO, "archive", s.date.slice(0, 7), s.slug, `${s.date}-${s.codename}`);
    mkdirSync(dirname(dir), { recursive: true });
    cpSync(join(REPO, "demo", product, "run"), dir, { recursive: true });
    IDS[product] = s.runId;
  }
  // A run published before the document existed: the same multi-country run with its document taken away.
  const s = JSON.parse(readFileSync(join(REPO, "demo", "multi-country-focus-search", "run", "status.json"), "utf8"));
  const old = { ...s, runId: `${s.slug}-${s.date}-olderedition`, codename: "olderedition" };
  const dir = join(STUDIO, s.slug, `${s.date}-olderedition`);
  cpSync(join(REPO, "demo", "multi-country-focus-search", "run"), dir, { recursive: true, filter: (p) => !p.endsWith("report-document.json") });
  writeFileSync(join(dir, "status.json"), JSON.stringify(old));
  IDS.older = old.runId;
});

async function call(name, args) {
  const [a, b] = InMemoryTransport.createLinkedPair();
  await makeServer().connect(b);
  const client = new Client({ name: "report-reader-test", version: "1" });
  await client.connect(a);
  await client.listTools();   // so the SDK client checks each answer against the tool's declared shape
  const r = await client.callTool({ name, arguments: args });
  await client.close();
  return r;
}

test("each report reader names the document version it read, or null where it read the run's own files", async () => {
  const cases = [
    [IDS["multi-country-focus-search"], "report-document/clearance-1", ["brief", "list_findings", "list_searches", "get_search_coverage"]],
    [IDS["knockout-search"], "report-document/knockout-1", ["list_findings", "list_evidence", "list_searches"]],
  ];
  for (const [runId, version, tools] of cases)
    for (const tool of tools) {
      const r = await call(tool, { runId });
      assert.equal(r.structuredContent?.document, version, `${tool} on ${runId}`);
      assert.ok(!r.content[0].text.includes('"document"'), `${tool}: the text block is unchanged; only the structured result names it`);
    }
  for (const tool of ["list_findings", "list_searches", "get_search_coverage"])
    assert.equal((await call(tool, { runId: IDS.older })).structuredContent?.document, null, `${tool} on a run with no document`);
});

test("a demo answer passes its declared shape, and a real answer with a changed or missing field is refused", async () => {
  const ajv = new AjvJsonSchemaValidator();
  const ko = (await call("list_findings", { runId: IDS["knockout-search"] })).structuredContent;
  const shape = ajv.getValidator(outputSchemaFor("list_findings"));
  assert.equal(shape(ko).valid, true, "the demo Knockout's findings pass");
  assert.equal(shape({ ...ko, items: [{ ...ko.items[0], band: 5 }] }).valid, false, "a band that is not text is refused (report data's definition)");
  assert.equal(shape({ ...ko, items: [{ ...ko.items[0], evidence: "one line" }] }).valid, false, "evidence that is not a list is refused");
  const { document: _gone, ...noDocument } = ko;
  assert.equal(shape(noDocument).valid, false, "an answer that does not name its document is refused");
  const brief = (await call("brief", { runId: IDS["multi-country-focus-search"] })).structuredContent;
  const briefShape = ajv.getValidator(outputSchemaFor("brief"));
  assert.equal(briefShape(brief).valid, true, "the demo brief passes");
  const { caption: _c, ...noCaption } = brief;
  assert.equal(briefShape(noCaption).valid, false, "a brief without its caption is refused");
  assert.equal(briefShape({ ...brief, surprise: true }).valid, false, "a brief with a field the code never builds is refused");
});

test("a field that means what report data means takes report data's published definition, held equal here", () => {
  const ko = RD("knockout-1").$defs.webFinding.properties;
  const item = outputSchemaFor("list_findings").properties.items.items.properties;
  for (const field of ["name", "owner", "band", "type", "net", "basis", "evidence"]) {
    assert.deepEqual(item[field], ko[field], `list_findings item ${field}`);
    assert.deepEqual(outputSchemaFor("get_finding").properties[field], ko[field], `get_finding ${field}`);
  }
  assert.deepEqual(outputSchemaFor("brief").properties.caption, RD("clearance-1").properties.caption, "brief caption");
  // NOT REUSED, and why: report data's `ordinal` is an integer on every finding, and the connector answers null for a
  // register filing, so the two do not mean the same thing.
  assert.equal(item.ordinal, undefined);
  for (const tool of DOCUMENT_READERS) assert.ok(outputSchemaFor(tool)?.required?.includes("document"), `${tool} requires its document`);
});
