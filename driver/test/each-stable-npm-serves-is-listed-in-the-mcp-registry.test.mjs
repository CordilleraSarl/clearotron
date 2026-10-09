// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// EACH STABLE NPM SERVES IS LISTED IN THE MCP REGISTRY, FROM NPM'S OWN MANIFEST, AND NOTHING ELSE IS.
//
// The registry keeps a version's listing for good, so these arms hold the listing to npm's manifest for
// that exact version, hold the plan to the stables only, oldest first, and hold every source that could
// not be read to exit 2 rather than "nothing to list". A listing counts only once the registry reads it
// back. The workflow that runs it holds the registry login and nothing else, on main only, and cannot
// become a way to publish to npm. npm, the registry and the publisher are stand-ins here: no arm reaches
// the network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SERVER_NAME, DESCRIPTION, SCHEMA, NPM_URL, LISTED_URL, serverJsonFor, plan, main, publishOne,
} from "../../scripts/mcp-registry-listing.mjs";
import { publishableManifest } from "../../scripts/pack-publishable.mjs";
import { publishingJobs } from "../../scripts/release-publish-guard.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const WORKFLOW = ".github/workflows/mcp-registry.yml";

const named = (version) => ({ name: "clearotron", version, mcpName: SERVER_NAME });
const unnamed = (version) => ({ name: "clearotron", version });

/** A stand-in for fetch: npm and the registry answer from the given tables, in call order for the registry. */
function stand({ npm = { status: 200, body: { versions: {} } }, registry = [{ status: 404 }] } = {}) {
  const calls = [];
  let r = 0;
  const answer = (a) => {
    if (a instanceof Error) throw a;
    return { status: a.status, json: async () => { if (a.text !== undefined) throw new SyntaxError("not JSON"); return a.body; } };
  };
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url === NPM_URL) return answer(npm);
    if (url === LISTED_URL) return answer(registry[Math.min(r++, registry.length - 1)]);
    throw new Error(`a call this stand-in does not expect: ${url}`);
  };
  return { fetchImpl, calls };
}
const listedBody = (...versions) => ({ status: 200, body: { servers: versions.map((version) => ({ server: { name: SERVER_NAME, version } })), metadata: { count: versions.length } } });

/** Run the CLI with stand-ins; collect what it said and what the publisher was handed. */
async function cli(argv, { npm, registry, publisher = () => ({ status: 0, stdout: "", stderr: "" }) } = {}) {
  const { fetchImpl } = stand({ npm, registry });
  const said = [];
  const handed = [];
  const run = (file, args) => {
    handed.push({ file, args, listing: JSON.parse(readFileSync(args[1], "utf8")) });
    return publisher(handed.at(-1));
  };
  const dir = mkdtempSync(join(tmpdir(), "mcp-registry-test-"));
  const output = join(dir, "github-output");
  try {
    const exit = await main(argv, { fetchImpl, run, output, log: (l) => said.push(l), warn: (l) => said.push(l) });
    let out = "";
    try { out = readFileSync(output, "utf8"); } catch { /* nothing written */ }
    return { exit, said: said.join("\n"), handed, out };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test("the listing is npm's manifest for that version, under the shipped description", () => {
  const listing = serverJsonFor(named("0.4.1"));
  assert.equal(listing.$schema, SCHEMA);
  assert.equal(listing.name, SERVER_NAME);
  assert.equal(listing.version, "0.4.1");
  assert.deepEqual(listing.repository, { url: "https://github.com/CordilleraSarl/clearotron", source: "github" });
  assert.deepEqual(listing.packages, [{
    registryType: "npm", identifier: "clearotron", version: "0.4.1",
    transport: { type: "stdio" }, packageArguments: [{ type: "positional", value: "mcp" }],
  }]);
  assert.equal(listing.description, DESCRIPTION);
  assert.ok([...DESCRIPTION].length <= 100, "the registry refuses a description over 100 characters");
  assert.ok(read("README.md").includes(`alt="${DESCRIPTION}"`), "the description is no longer the README banner's shipped line");
  assert.throws(() => serverJsonFor(unnamed("0.4.1")), /carries mcpName null/);
  assert.throws(() => serverJsonFor({ ...named("0.4.1"), mcpName: "io.github.someone/clearotron" }), /not io\.github\.CordilleraSarl/);
  assert.throws(() => serverJsonFor(named("0.4.2-beta.0")), /not a stable version/);
});

test("the package carries the registry name, and the manifest npm receives keeps it", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.mcpName, SERVER_NAME);
  assert.equal(publishableManifest(pkg).mcpName, SERVER_NAME, "the published manifest drops mcpName, and the registry checks it on npm");
});

test("only stables are listed, oldest first, from the first stable that carries the name", () => {
  const served = {
    "0.10.0": named("0.10.0"), "0.4.2": named("0.4.2"), "0.3.3": unnamed("0.3.3"), "0.4.1": named("0.4.1"),
    "0.4.0": unnamed("0.4.0"), "0.4.3-beta.0": named("0.4.3-beta.0"), "0.9.0": named("0.9.0"),
  };
  const none = plan(served, new Set());
  assert.deepEqual(none.list.map((m) => m.version), ["0.4.1", "0.4.2", "0.9.0", "0.10.0"]);
  assert.deepEqual(none.passedBy, ["0.3.3", "0.4.0"]);
  assert.deepEqual(none.refused, []);
  assert.deepEqual(plan(served, new Set(["0.4.1", "0.9.0"])).list.map((m) => m.version), ["0.4.2", "0.10.0"]);
  assert.deepEqual(plan(served, new Set(["0.4.1", "0.4.2", "0.9.0", "0.10.0"])).list, []);
});

test("no stable carries the name yet: nothing to list, which is not a refusal", async () => {
  const p = plan({ "0.3.3": unnamed("0.3.3"), "0.4.0": unnamed("0.4.0") }, new Set());
  assert.deepEqual(p, { list: [], passedBy: ["0.3.3", "0.4.0"], refused: [] });
  const r = await cli(["plan"], { npm: { status: 200, body: { versions: { "0.4.0": unnamed("0.4.0") } } } });
  assert.equal(r.exit, 0);
  assert.equal(r.out, "count=0\n");
});

test("a stable after the first that carries the name, without it, is refused before anything is listed", async () => {
  const versions = { "0.4.1": named("0.4.1"), "0.4.2": unnamed("0.4.2"), "0.4.3": named("0.4.3") };
  assert.deepEqual(plan(versions, new Set()).refused, ["0.4.2"]);
  const r = await cli(["publish", "./mcp-publisher"], { npm: { status: 200, body: { versions } } });
  assert.equal(r.exit, 1);
  assert.match(r.said, /REFUSED.*0\.4\.2/);
  assert.deepEqual(r.handed, [], "a listing went out past a stable that lost its name");
});

test("npm or the registry unreadable is exit 2, never nothing to list and never already listed", async () => {
  const served = { status: 200, body: { versions: { "0.4.1": named("0.4.1") } } };
  const cases = {
    "npm does not answer": { npm: new Error("ECONNRESET") },
    "npm answers 500": { npm: { status: 500 } },
    "npm answers 404": { npm: { status: 404 } },
    "npm answers something not JSON": { npm: { status: 200, text: "<html>" } },
    "npm names no versions": { npm: { status: 200, body: {} } },
    "the registry does not answer": { npm: served, registry: [new Error("ETIMEDOUT")] },
    "the registry answers 503": { npm: served, registry: [{ status: 503 }] },
    "the registry lists no servers": { npm: served, registry: [{ status: 200, body: {} }] },
    "the registry's answer is paged": { npm: served, registry: [{ status: 200, body: { servers: [], metadata: { nextCursor: "x" } } }] },
    "the registry answers for another name": { npm: served, registry: [{ status: 200, body: { servers: [{ server: { name: "io.github.someone/x", version: "1.0.0" } }] } }] },
  };
  for (const [why, c] of Object.entries(cases)) {
    for (const argv of [["plan"], ["publish", "./mcp-publisher"]]) {
      const r = await cli(argv, c);
      assert.equal(r.exit, 2, `${why} (${argv[0]}): exit ${r.exit}, said ${r.said}`);
      assert.match(r.said, /could not look/, why);
      assert.equal(r.out, "", `${why}: a count was written for a plan that could not look`);
      assert.deepEqual(r.handed, [], `${why}: a listing went out`);
    }
  }
});

test("the registry's 404 for the exact name is an answer: nothing listed under it yet", async () => {
  const r = await cli(["plan"], { npm: { status: 200, body: { versions: { "0.4.0": unnamed("0.4.0"), "0.4.1": named("0.4.1") } } } });
  assert.equal(r.exit, 0);
  assert.equal(r.out, "count=1\n");
  assert.match(r.said, /to list, oldest first: 0\.4\.1/);
});

test("each listing goes to the publisher as npm's manifest, and counts only once the registry reads it back", async () => {
  const npm = { status: 200, body: { versions: { "0.4.1": named("0.4.1"), "0.4.2": named("0.4.2") } } };

  const listed = await cli(["publish", "./mcp-publisher"], { npm, registry: [{ status: 404 }, listedBody("0.4.1"), listedBody("0.4.1", "0.4.2")] });
  assert.equal(listed.exit, 0, listed.said);
  assert.deepEqual(listed.handed.map((h) => [h.file, h.args[0], h.listing.version]), [["./mcp-publisher", "publish", "0.4.1"], ["./mcp-publisher", "publish", "0.4.2"]]);
  assert.deepEqual(listed.handed[0].listing, serverJsonFor(named("0.4.1")), "the publisher was handed something other than npm's manifest for the version");

  const duplicate = await cli(["publish", "./mcp-publisher"], {
    npm: { status: 200, body: { versions: { "0.4.1": named("0.4.1") } } },
    registry: [{ status: 404 }, listedBody("0.4.1")],
    publisher: () => ({ status: 1, stdout: "", stderr: "Error: publish failed: invalid version: cannot publish duplicate version" }),
  });
  assert.equal(duplicate.exit, 0, "a version the registry already holds, and reads back, is listed");
  assert.match(duplicate.said, /0\.4\.1 was already listed, and read back/);

  const unread = await cli(["publish", "./mcp-publisher"], { npm, registry: [{ status: 404 }, { status: 404 }] });
  assert.equal(unread.exit, 1, "the publisher's word was taken without the registry's");
  assert.equal(unread.handed.length, 1, "a second listing went out after the first did not read back");

  const refused = await cli(["publish", "./mcp-publisher"], { npm, publisher: () => ({ status: 1, stdout: "", stderr: "Error: 403 namespace" }) });
  assert.equal(refused.exit, 1);
  assert.match(refused.said, /0\.4\.1 was not listed: Error: 403 namespace/);
  assert.equal(refused.handed.length, 1, "the next version was tried after one failed");
});

test("the publisher is handed a file it can read, and nothing is left behind", () => {
  let seen = null;
  const r = publishOne(named("0.4.1"), "./mcp-publisher", (file, args) => {
    seen = { file, args, text: readFileSync(args[1], "utf8") };
    return { status: 0, stdout: "ok", stderr: "" };
  });
  assert.equal(r.ok, true);
  assert.deepEqual(JSON.parse(seen.text), serverJsonFor(named("0.4.1")));
  assert.throws(() => readFileSync(seen.args[1]), { code: "ENOENT" }, "the listing file outlived the call");
});

// ── THE WORKFLOW ─────────────────────────────────────────────────────────────────────────────────────

/** A job's own block: its header line to the next job header. */
function jobBlock(text, id) {
  const start = text.search(new RegExp(`^ {2}${id}:\\s*$`, "m"));
  assert.ok(start >= 0, `no job ${id}`);
  const rest = text.slice(start + 1);
  const end = rest.search(/^ {2}[a-z][\w-]*:\s*$/m);
  return end === -1 ? text.slice(start) : text.slice(start, start + 1 + end);
}

test("the workflow holds the registry login and nothing more, on main only, pinned", () => {
  const wf = read(WORKFLOW);
  assert.match(wf, /^# SPDX-License-Identifier: AGPL-3\.0-only$/m);
  assert.match(wf, /^permissions: \{\}$/m, "the workflow grants permissions at its top");
  const on = wf.match(/^on:\n((?: .*\n|\n)+?)^\S/m)?.[1] ?? "";
  assert.deepEqual([...on.matchAll(/^ {2}([a-z_]+):/gm)].map((m) => m[1]), ["schedule", "workflow_dispatch"],
    "the listing runs on something other than the schedule and a dispatch");
  const job = jobBlock(wf, "list");
  assert.match(job, /^ {4}if: github\.repository == 'CordilleraSarl\/clearotron' && github\.ref == 'refs\/heads\/main'$/m,
    "the login grants the owner's namespace to any branch that asks, so the job must be held to main");
  const perms = job.match(/^ {4}permissions:\n((?: {6}.*\n)+)/m)?.[1] ?? "";
  assert.deepEqual([...perms.matchAll(/^ {6}([a-z-]+): (\w+)/gm)].map((m) => `${m[1]}: ${m[2]}`), ["contents: read", "id-token: write"]);
  assert.doesNotMatch(wf, /^\s*environment:/m, "the job runs in an environment, which is how npm's trusted publisher is reached");
  assert.deepEqual(publishingJobs(wf), [], "a job in the registry workflow publishes to npm");
  const uses = [...wf.matchAll(/^\s*(?:- )?uses: (\S+)/gm)].map((m) => m[1]);
  assert.ok(uses.length >= 2, "no action read; the pattern no longer matches the file");
  for (const u of uses) assert.match(u, /@[0-9a-f]{40}$/, `${u} is not pinned to a commit`);
  assert.match(wf, /^ {2}MCP_PUBLISHER_VERSION: '\d+\.\d+\.\d+'$/m);
  assert.match(wf, /^ {2}MCP_PUBLISHER_SHA256: '[0-9a-f]{64}'$/m);
  assert.match(wf, /releases\/download\/v\$\{MCP_PUBLISHER_VERSION\}\/mcp-publisher_linux_amd64\.tar\.gz/);
  assert.match(wf, /echo "\$\{MCP_PUBLISHER_SHA256\} {2}mcp-publisher\.tar\.gz" \| sha256sum -c -/, "the publisher runs unverified");
  assert.ok(wf.indexOf("sha256sum -c") < wf.indexOf("./mcp-publisher login"), "the publisher runs before its checksum is checked");
});

test("the release workflow's scheduled entry job still holds no token", () => {
  const entry = jobBlock(read(".github/workflows/release.yml"), "entry");
  assert.doesNotMatch(entry, /id-token/, "the entry job requests an OIDC token");
});
