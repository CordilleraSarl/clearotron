// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The register tool surface is PROVIDER-NEUTRAL: every register tool is `register_*`, served under the
// MCP key `register`, whichever vendor REGISTER_PROVIDER selects (engine/mcp/gather-config.mjs).
//
// This test is the enforcement the boundary rule in skills/prelim-register/providers/README.md always
// stated but nothing checked — and which was, in fact, already being violated by SKILL.md and
// prelim-search/phase2-execution.md before the neutral-namespace change.
//
// Why it matters: the driver interpolates tool names into the instructions handed to register sub-agents.
// A vendor token that survives there tells the agent to call a tool that is not loaded under any provider
// but the one it names — the failure is silent (the agent improvises) and only shows up as a thin band.
//
// ALLOWED to carry vendor tokens:
//   - engine/mcp/<provider>-server.mjs   — the per-provider glue; the vendor name legitimately lives here
//   - skills/prelim-register/providers/  — the provider vocabulary docs, which exist to be provider-specific
//   - providers/<id>/src/core.js          — provider cores (their error strings name the vendor, by design)
//   - test fixtures asserting a provider CORE ERROR STRING (e.g. "ERROR: corsearch_search HTTP 414") —
//     those are diagnostics emitted by the core, not tool invocations. Matched by the ERROR_STRING_RE below.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { nonEmpty } from "../../shared/vacuous-pass.mjs";

const DRIVER = dirname(dirname(fileURLToPath(import.meta.url)));
// ── TWO SPELLINGS OF THE SAME PROVIDER LIST, AND NEITHER IMPLIES THE OTHER ───────────────────────
// Below, a provider id is used in three ways: as a TOKEN PREFIX in `<vendor>_<tool>`, as a FILE NAME
// in `<vendor>-server.mjs`, and as a plain id. `uspto-local` is the first id with a hyphen in it, and
// that breaks the assumption the earlier lists rested on:
//
//   * `uspto-local` in VENDOR_TOOL_RE matches ZERO tokens. The alternation is followed by `_`, so the
//     hyphenated id would only ever match a string carrying BOTH a hyphen and an underscore — which is
//     not how anyone writes a tool name. A leaked one would keep the hyphen as an underscore, or drop
//     the qualifier entirely. Adding the hyphenated id there LOOKS like a completed edit and guards
//     nothing at all. (The examples are not spelled out here: this test walks its own source, and
//     writing one would make it an offender. Which is itself the proof that the bare id catches both.)
//   * `uspto` in the file-name regex matches no file, because the server is `uspto-local-server.mjs`.
//
// So the token lists take the bare `uspto`, which catches both leak forms, and the file lists take
// `uspto-local`. Keep them separate on purpose. Case matters: the env var
// USPTO_LOCAL_DB and the office key "uspto" in prose are both left alone by these patterns, the first
// because it is uppercase and the second because it is not followed by `_<tool>`.
const VENDOR_TOOL_RE = /\b(corsearch|clarivate|signa|uspto)_[a-z_]+/g;
// a provider core's own error text, e.g. `ERROR: corsearch_search HTTP 414` / "corsearch_record_fetch HTTP 503"
const ERROR_STRING_RE = /(ERROR:\s*)?\b(corsearch|clarivate|signa|uspto)_[a-z_]+\s+(HTTP|—)/;

const SKIP_DIRS = new Set(["node_modules", ".git", "fixtures"]);
const isAllowedFile = (rel) =>
  /^engine\/mcp\/(corsearch|clarivate|signa|uspto-local|euipo|free-tier)-server\.mjs$/.test(rel) ||
  rel.startsWith("skills/prelim-register/providers/");

// The vacuity check sits on the WALK'S RESULT (`walked` below), not on each read —. An
// empty leaf directory is ordinary and the product writes them; guarding every recursive read turned
// one into a throw before a single file was read, on deployed boxes only, because git stores no empty
// directory and no clone ever has one.
function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    if (SKIP_DIRS.has(e)) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(mjs|js|md)$/.test(e)) out.push(p);
  }
  return out;
}
/** The walk's result, asked once whether it found anything at all. */
const walked = (dir) => nonEmpty(walk(dir), `the walk of ${relative(DRIVER, dir) || "the driver tree"}`);

test("no vendor tool tokens outside the provider glue and provider vocabulary docs", () => {
  const offenders = [];
  for (const path of walked(DRIVER)) {
    const rel = relative(DRIVER, path);
    if (isAllowedFile(rel)) continue;
    const lines = readFileSync(path, "utf8").split("\n");
    lines.forEach((line, i) => {
      const hits = line.match(VENDOR_TOOL_RE);
      if (!hits) return;
      if (ERROR_STRING_RE.test(line)) return;   // a provider core's diagnostic string, not a tool invocation
      offenders.push(`${rel}:${i + 1}  ${hits.join(", ")}`);
    });
  }
  assert.deepEqual(offenders, [],
    `Vendor register tool names must not appear outside engine/mcp/<provider>-server.mjs and ` +
    `skills/prelim-register/providers/. Use the neutral register_* names — they resolve to whichever ` +
    `provider REGISTER_PROVIDER selects. Offenders:\n  ${offenders.join("\n  ")}`);
});

// ── — A BARE HOST LEAKS PAST THE TOKEN RULE ABOVE ──────────────────────────────────────────────
//
// VENDOR_TOOL_RE catches a vendor-prefixed TOOL name. It cannot catch a bare vendor HOST, and that is
// the form that survived two de-vendoring passes: fixed the rule in status-rules.md, and
// `prelim-register/digest.md` and `prelim-search/delivery-contract.md` went on naming the Corsearch
// host as THE base host — digest.md loads on every digest run whatever the provider, so the vendored
// instruction outranked the de-vendored one and a clarivate run composed Corsearch links.
//
// The banned list is READ FROM THE PROVIDER DOCS rather than typed here. Every host any provider
// teaches is a host no provider-agnostic file may state, so a sixth provider's host is covered the day
// its doc lands — which is the only version of this test that survives the next vendor.
//
// A blockquote is the one exception, and deliberately a narrow one: `status-rules.md` explains this
// exact defect by naming the host it used to carry. Prose ABOUT a host reads differently from an
// instruction to compose one, and `>` is the mark the document already uses for the difference.
test("#798 no provider-agnostic skill file states a record base host", () => {
  const SKILLS = join(DRIVER, "skills");
  const PROVIDER_DOCS = join("skills", "prelim-register", "providers");

  const hosts = new Set();
  for (const path of walked(join(SKILLS, "prelim-register", "providers"))) {
    for (const m of readFileSync(path, "utf8").matchAll(/https?:\/\/([a-zA-Z0-9._-]+)/g)) hosts.add(m[1]);
  }
  assert.ok(hosts.size >= 3,
    `read ${hosts.size} host(s) from the provider docs — an empty or thin list makes this test pass by `
    + `finding nothing, which is the failure it exists to catch`);

  const offenders = [];
  for (const path of walked(SKILLS)) {
    const rel = relative(DRIVER, path);
    if (rel.startsWith(PROVIDER_DOCS)) continue;
    readFileSync(path, "utf8").split("\n").forEach((line, i) => {
      if (/^\s*>/.test(line)) return;              // commentary about a host, not an instruction
      for (const h of hosts) if (line.includes(h)) offenders.push(`${rel}:${i + 1}  ${h}`);
    });
  }
  assert.deepEqual(offenders, [],
    `A skill file loaded whatever the provider must not name one provider's record host — point at `
    + `providers/<name>.md, "Record base host", the way status-rules.md does. The model follows the `
    + `instruction it was given, so a host written here ships a link to a register the run never `
    + `searched. Offenders:\n  ${offenders.join("\n  ")}`);
});

test("every register server exposes the same neutral tool names", async () => {
  const { readFileSync: rf } = await import("node:fs");
  // FILE-NAME spelling — the hyphenated id. See the note at the top: this list and VENDOR_TOOL_RE's
  // are deliberately not the same strings, and putting either spelling in the other guards nothing.
  // adds free-tier; `euipo` was ALREADY missing here — 4 of the 5 providers were swept, so the
// one whose server was rewritten wholesale by was the one this never checked.
for (const provider of ["corsearch", "clarivate", "signa", "uspto-local", "euipo", "free-tier"]) {
    const src = rf(join(DRIVER, "engine", "mcp", `${provider}-server.mjs`), "utf8");
    // the served tool names must all be register_*; no vendor-prefixed tool may be registered
    const names = [...src.matchAll(/^\s*name:\s*"([a-z_]+)",\s*$/gm)].map((m) => m[1]);
    const toolNames = names.filter((n) => n !== "register" || false);
    for (const n of toolNames) {
      assert.match(n, /^register(_[a-z_]+)?$/,
        `${provider}-server.mjs registers "${n}" — every register tool must be register_*`);
    }
    assert.match(src, /name:\s*"register",\s*version/,
      `${provider}-server.mjs must serve under the neutral MCP server name "register"`);
  }
});

test("tracker 2018 the walk refuses an empty corpus, and an empty leaf is not one", () => {
  // BOTH DIRECTIONS. A guard moved onto the aggregate and a guard deleted read identically on a healthy
  // tree; only a walk handed an empty tree tells them apart.
  const tmp = mkdtempSync(join(tmpdir(), "b2018-provider-neutral-"));
  const leaf = join(DRIVER, "profiles", "projects", `b2018-${process.pid}`);
  try {
    mkdirSync(join(tmp, "a", "b"), { recursive: true });
    assert.throws(() => walked(tmp), /VACUOUS/,
      "a walk that descended a whole tree and found no file reported a corpus instead of refusing");

    // …and the leaf that produced: written by the product, unstorable by git, and it must
    // change nothing here.
    const baseline = walked(DRIVER).map((f) => relative(DRIVER, f)).sort();
    mkdirSync(leaf, { recursive: true });
    assert.deepEqual(walked(DRIVER).map((f) => relative(DRIVER, f)).sort(), baseline,
      "an empty directory under the driver tree changed the set of files this sweep reads");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
    rmSync(leaf, { recursive: true, force: true });
  }
});
