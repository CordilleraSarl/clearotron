// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// — THE AGPL §13 SOURCE OFFER, ON ALL THREE FACES.
//
// §13 obliges an operator running a MODIFIED version over a network to offer its users the source of
// THAT version. Three surfaces of this product are reachable over a network, and `shared/product-identity.mjs`
// was written for exactly them — its own header names all three: "the portal's About page, the
// MCP server's about resource, and the CLI ". The portal's landed; these are the other two.
//
// THE FAILURE THIS GUARDS IS NOT AN ABSENT PAGE, IT IS THREE DISAGREEING ANSWERS. Each surface could
// resolve its own commit, and then the one that matters is whichever the reader did not check. So the
// arms below assert that every face reads the SAME module, not merely that each says something.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { TOOL_SCOPES, authorize } from "../../shared/scope.mjs";
import { productIdentity, SOURCE_REPO } from "../../shared/product-identity.mjs";
import { grepTrackedFiles } from "../../shared/tracked-files.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (...p) => readFileSync(join(ROOT, ...p), "utf8");
// Generated, and its whole job is to name third parties and reproduce their licence texts.
const ATTRIBUTIONS = "THIRD-PARTY-NOTICES.md";

// ── row 1: no shipped document names the wrong licence ──────────────────────────────────────────────

test("#854 no shipped markdown claims Apache — the issue's own external check", () => {
  // "Checkable from outside once done: `git grep -in apache -- '*.md'` returns nothing."
  //
  // THIS ARM WAS A FALSE GREEN WHEN FIRST WRITTEN, and the way it failed is the reason it is worth
  // saying here: the flags were passed as one combined `-lin`, git refused it, grepTrackedFiles
  // returned null — its "could not look" answer — and an `if (hits === null) return` turned that into
  // a pass. An absence read as a success, in the arm whose whole job is to notice a presence. The
  // helper did print its SKIPPED marker, which the merge gate greps for, so the gate would have caught
  // what a single-file run did not.
  //
  // THE ATTRIBUTIONS FILE IS EXCLUDED, and the exclusion is the narrowest one that works. 's own
  // other row requires `THIRD-PARTY-NOTICES.md` to reproduce each dependency's licence NOTICE — MIT,
  // BSD and ISC all oblige a distributor to, not merely to name the licence — and some dependencies
  // are Apache-2.0. So the issue's external check as literally written became unsatisfiable the moment
  // its own sibling row landed. What the check MEANS is unchanged: no shipped document says this
  // product is Apache. The arm below keeps that meaning for the attributions file by a sharper test
  // than a path exclusion.
  const hits = grepTrackedFiles("#854 no shipped doc names Apache",
    { root: ROOT, args: ["-l", "-i", "apache", "--", "*.md", `:!${ATTRIBUTIONS}`] });
  assert.notEqual(hits, null,
    "the corpus could not be read, so this arm proved nothing — not a pass (the helper said so on stderr)");
  assert.deepEqual(hits, [], `these documents still name Apache:\n  ${hits.join("\n  ")}`);
});

test("#854 the attributions file may REPRODUCE Apache, and may not CLAIM it", () => {
  // The distinction a path exclusion would have thrown away. A dependency's licence text is quoted
  // material and belongs in a fenced block; a sentence outside one that mentions Apache is this
  // product describing itself, which is the thing exists to stop. So every occurrence has to sit
  // inside a fence, and that is checkable rather than asserted.
  // Two shapes are attribution rather than assertion, and both name the package they belong to:
  // a reproduced licence text inside a fence, and the generated metadata row that declares ONE
  // dependency's licence directly under that dependency's own heading. Anything else is prose.
  const src = read(ATTRIBUTIONS).split("\n");
  let fenced = false, heading = null;
  const loose = [];
  for (const [i, line] of src.entries()) {
    if (line.startsWith("```")) { fenced = !fenced; continue; }
    if (!fenced && line.startsWith("## ")) heading = line.slice(3).trim();
    if (fenced || !/apache/i.test(line)) continue;
    const attributed = heading && /^- \*\*Licence declared:\*\* `[^`]+`$/.test(line.trim());
    if (!attributed) loose.push(`${ATTRIBUTIONS}:${i + 1}  ${line.trim().slice(0, 90)}`);
  }
  assert.deepEqual(loose, [],
    `Apache is named outside a reproduced licence block, which reads as a claim about this product:\n  ${loose.join("\n  ")}`);
  assert.equal(fenced, false, "a fence is left open — the scan above cannot tell quoted text from prose");
});


test("#854 INSTALL states the licence the repository actually carries, and what §13 adds", () => {
  const install = read("INSTALL.md");
  assert.match(install, /GNU Affero General Public License v3\.0/);
  assert.doesNotMatch(install, /Apache License 2\.0/);
  // A licence name alone is not the §13 obligation. Someone running this as a service has to learn that
  // their users are owed THEIR instance's source — from the document that told them how to install it.
  assert.match(install, /§13/, "INSTALL names the licence but not the obligation that comes with running it");
});

// ── row 5: the CLI ───────────────────────────────────────────────────────────────────────────────────

test("#854 `--license` answers with the licence AND the running commit", () => {
  // RUN, not read. The flag is the surface; asserting on the source would pass just as well if the flag
  // were unreachable behind an earlier exit.
  const out = execFileSync("node", [join(ROOT, "bin", "start.mjs"), "--license"], { encoding: "utf8", timeout: 20000 });
  const id = productIdentity();
  assert.match(out, /AGPL-3\.0-only/);
  assert.match(out, new RegExp(SOURCE_REPO.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(out, /Commit:/);
  if (id.commit) assert.ok(out.includes(id.commit), "the offer must name the RUNNING commit, not just the repository");
  assert.match(out, /NO WARRANTY/i, "the warranty disclaimer belongs with the licence statement");
  // The British spelling reaches the same place — a licence question answered with "unknown option" is
  // the one failure this flag cannot afford.
  const alt = execFileSync("node", [join(ROOT, "bin", "start.mjs"), "--licence"], { encoding: "utf8", timeout: 20000 });
  assert.equal(alt, out);
});

test("#854 a null commit is stated as unknown, never papered over with a bare repo link", () => {
  // The pair is the point: a surface that renders the repository URL while implying it is the running
  // source is the failure the module was built to prevent, and it can only avoid it if the missing sha
  // is visible. Asserted on the source because a checkout always HAS a commit — the branch is otherwise
  // unreachable in a test, which is exactly why it needs pinning.
  const src = read("bin", "start.mjs");
  assert.match(src, /Commit:\s*\$\{id\.commit \?\? "unknown/,
    "the unknown-commit branch is gone — a null sha would print as blank or as the repo link");
});

// ── row 4: the MCP server ────────────────────────────────────────────────────────────────────────────

test("#854 server_info is reachable by EVERY session kind — an offer a client cannot call is not one", () => {
  const rule = TOOL_SCOPES.server_info;
  assert.ok(rule, "server_info left TOOL_SCOPES — it is then denied to every client and account session");
  assert.equal(rule.clientSafe, true, "a report-link recipient is exactly who §13 is written for");
  assert.equal(rule.accountSafe, true);
  assert.notEqual(rule.crossRun, true, "crossRun denies run-scoped user tokens — the readers this owes");
  assert.notEqual(rule.write, true, "it writes nothing; marking it write would demand an ops token");
});

test("#854 authorize() actually lets each kind through, rather than the flags merely looking right", () => {
  // The flags are an input to authorize(), not the decision. Asserting the flags alone would pass if the
  // function stopped reading them.
  assert.doesNotThrow(() => authorize({ kind: "ops", sub: "portal" }, "server_info", {}));
  assert.doesNotThrow(() => authorize({ kind: "internal", sub: "staff@x" }, "server_info", {}));
  assert.doesNotThrow(() => authorize({ kind: "account", sub: "c@x", accounts: ["a"] }, "server_info", {}));
  assert.doesNotThrow(() => authorize({ kind: "user", runId: "r-1" }, "server_info", {}),
    "the run-scoped report link is the session most likely to be a stranger, and the one §13 names");
});

test("#854 the MCP server exposes it as a tool AND as a resource, and both read the one module", () => {
  const src = read("mcp-server", "server.mjs");
  assert.match(src, /import \{ productIdentity \} from "\.\.\/shared\/product-identity\.mjs"/,
    "the server derives the identity itself again — three surfaces, three chances to disagree");
  assert.match(src, /server_info\(\)\s*\{\s*\n\s*return productIdentity\(\);/,
    "the tool stopped returning the shared answer");
  assert.match(src, /name: "server_info"/, "the tool left the declared schema — undeclared is undiscoverable");
  assert.match(src, /export const ABOUT_URI = "trademark:\/\/about"/);
  assert.match(src, /uri: ABOUT_URI, name: "about this server"/, "the resource is no longer LISTED, so nobody finds it");
  assert.match(src, /req\.params\.uri === ABOUT_URI/, "the resource is listed but not READABLE");
});

test("#854 the about resource answers ABOVE the run gate — it is about the server, not a run", () => {
  const src = read("mcp-server", "server.mjs");
  const readerAt = src.indexOf("req.params.uri === ABOUT_URI");
  const runUriAt = src.indexOf("^trademark:\\/\\/run\\/");
  assert.ok(readerAt > 0 && runUriAt > 0, "one of the two resource branches has moved — re-derive this arm");
  assert.ok(readerAt < runUriAt,
    "the about branch fell below the run-uri parse, so a §13 read now has to satisfy a run binding it "
    + "has nothing to do with");
});

// ── the property all three share ─────────────────────────────────────────────────────────────────────

test("#854 all three network faces read one module, so they cannot report different builds", () => {
  const faces = [
    ["the portal", ["driver", "portal-service.mjs"]],
    ["the MCP server", ["mcp-server", "server.mjs"]],
    ["the CLI", ["bin", "start.mjs"]],
  ];
  for (const [what, p] of faces)
    assert.match(read(...p), /shared\/product-identity\.mjs/,
      `${what} no longer reads the shared identity — the offer it makes can now disagree with the others`);
  // and the module still answers with the things §13 requires
  const id = productIdentity();
  for (const k of ["name", "version", "commit", "sourceRepo", "sourceUrl", "license", "copyright"])
    assert.ok(k in id, `productIdentity lost ${k}`);
  assert.equal(id.license, "AGPL-3.0-only", "the offer names a licence the repository does not declare");
});
