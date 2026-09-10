// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// A name documented in any env example file is documented.
//
// `scripts/env-classify.mjs` records, for every catalogued variable, whether an example file documents
// it. That population was read from three of the four example files and left out the deployment example,
// the largest, while the production gather in the same module read all four. So every name documented
// only there was recorded as `documented: false`: 159 in the committed classification when that was
// measured, 2026-09-10. The module now names the four files once and reads a row the way the catalogue
// does. These tests drive both halves, which files are read and what counts as a row in them, and then
// hold the one reader that cannot be driven here to the same list.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { gather, classify, exampleNames, ENV_EXAMPLE_FILES } from "../../scripts/env-classify.mjs";
import { catalogueRows } from "../../scripts/env-audit.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** A root `gather` accepts, holding the example files given and nothing else of the kind. */
function rootWith(examples) {
  const root = mkdtempSync(join(tmpdir(), "env-examples-"));
  mkdirSync(join(root, ".github/workflows"), { recursive: true });
  writeFileSync(join(root, ".github/workflows/ci.yml"), "jobs:\n  x:\n    runs-on: ubuntu-latest\n");
  mkdirSync(join(root, "scripts"), { recursive: true });
  for (const f of ["scripts/e2e.mjs", "scripts/test-run.mjs"]) writeFileSync(join(root, f), "// placeholder\n");
  for (const [f, body] of Object.entries(examples)) writeFileSync(join(root, f), body);
  return root;
}

test("a name with a row only in the deployment example is documented, and the classification says so", () => {
  const root = rootWith({
    ".env.example": "CLEAROTRON_EX_SETUP=\n",
    ".env.deployment.example": "# What this one does.\n# CLEAROTRON_EX_DEPLOYMENT_ONLY=\nCLEAROTRON_EX_DEPLOYMENT_SET=1\n",
  });
  const sources = gather({ root, prodList: "" });
  for (const n of ["CLEAROTRON_EX_SETUP", "CLEAROTRON_EX_DEPLOYMENT_ONLY", "CLEAROTRON_EX_DEPLOYMENT_SET"])
    assert.ok(sources.docs.has(n), `${n} has a row in an example file and is missing from the documented population`);

  const { rows } = classify({
    catalogue: ["CLEAROTRON_EX_DEPLOYMENT_ONLY", "CLEAROTRON_EX_NOWHERE"], sources, setup: new Set(), readSites: () => "5",
  });
  const of = (n) => rows.find((r) => r.name === n);
  assert.equal(of("CLEAROTRON_EX_DEPLOYMENT_ONLY").documented, true,
    "documented only in the deployment example, and recorded as undocumented: the defect, back");
  assert.equal(of("CLEAROTRON_EX_NOWHERE").documented, false,
    "a name no example file carries must still read as undocumented, or the field says nothing");
});

test("every example file counts, each one on its own", () => {
  assert.ok(ENV_EXAMPLE_FILES.length >= 4 && ENV_EXAMPLE_FILES.includes(".env.deployment.example"),
    `the example-file list is ${JSON.stringify(ENV_EXAMPLE_FILES)}: it has shrunk, or lost the file that was missing`);
  for (const f of ENV_EXAMPLE_FILES) {
    const name = `CLEAROTRON_EX_ONLY_IN_${f.replace(/\W+/g, "_").replace(/^_+|_+$/g, "").toUpperCase()}`;
    const docs = gather({ root: rootWith({ [f]: `${name}=\n` }), prodList: "" }).docs;
    assert.deepEqual([...docs], [name], `${f}, alone in a tree, should document exactly ${name}`);
  }
});

test("a row here is a row as the catalogue reads it, indented or commented alike", () => {
  const text = [
    "CLEAROTRON_EX_PLAIN=",
    "#CLEAROTRON_EX_TIGHT=1",
    "#   CLEAROTRON_EX_SPACED=",
    "  CLEAROTRON_EX_INDENTED = 2",
    "# effect: deployment",
    "# not a row: CLEAROTRON_EX_PROSE is mentioned here, never assigned",
    "",
  ].join("\n");
  const root = rootWith({ ".env.deployment.example": text });
  const expected = catalogueRows(text).map((r) => r.name);
  assert.ok(expected.length >= 4, `the catalogue's reader found ${expected.length} rows in a four-row file; the comparison below would be empty`);
  assert.deepEqual(exampleNames(root), expected, "the two readers of one file disagree about what a row is");
  assert.ok(!exampleNames(root).includes("CLEAROTRON_EX_PROSE"), "a name mentioned in prose has no row");
});

test("the module names each example file once, and the production gather reads the same list", () => {
  // The production gather needs sudo and a unit directory, so it cannot be driven here. What can be held
  // is that it keeps no list of its own: each file is spelled once as a string in the module, in the list,
  // and both readers are built from it.
  const source = readFileSync(join(REPO, "scripts", "env-classify.mjs"), "utf8");
  for (const f of ENV_EXAMPLE_FILES) {
    const n = source.split(`"${f}"`).length - 1;
    assert.equal(n, 1, `${f} is spelled ${n} times as a string in env-classify.mjs; a second list is a second thing to keep in step`);
  }
  assert.match(source, /const catalogueNames = exampleNames\(\);/, "the production gather's allowlist is not built from the shared list");
  assert.match(source, /docs: set\(exampleNames\(root\)\)/, "the documented population is not built from the shared list");
});

test("on this tree, every name an example file here carries a row for is documented", () => {
  const present = ENV_EXAMPLE_FILES.filter((f) => existsSync(join(REPO, f)));
  assert.ok(present.includes(".env.example"), ".env.example is missing from the tree, and every install ships it");
  const docs = gather().docs;
  const named = present.flatMap((f) => catalogueRows(readFileSync(join(REPO, f), "utf8")).map((r) => r.name));
  assert.ok(named.length >= 20, `only ${named.length} rows across ${present.join(", ")}; the reader has broken, not the files`);
  assert.deepEqual(named.filter((n) => !docs.has(n)), [], "these have a row in an example file on this tree and read as undocumented");
});

test("where the deployment example is present, CLEAROTRON_BOX, which it documents, is documented", (t) => {
  if (!existsSync(join(REPO, ".env.deployment.example"))) { t.skip("the deployment example is not in this tree"); return; }
  assert.ok(gather().docs.has("CLEAROTRON_BOX"), "CLEAROTRON_BOX has a row in the deployment example and reads as undocumented");
});
