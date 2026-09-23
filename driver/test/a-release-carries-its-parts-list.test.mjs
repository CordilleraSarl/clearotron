// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// Every release carries its parts list.
//
// The list is a CycloneDX document written from package-lock.json by scripts/release-sbom.mjs, because
// `npm sbom` refuses this tree over the `uuid` override on the bundled `exceljs` (measured 2026-09-23).
// This file holds the writer to what the list must say, on a made-up lock where every kind of entry is
// present and on the real lock, and holds the release to attaching it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { sbomFor, purlOf, hashesOf } from "../../scripts/release-sbom.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

const LOCK = {
  packages: {
    "": { name: "clearotron", version: "9.9.9" },
    "driver": { name: "clearotron-driver", version: "9.9.9" },
    "vendor/buffers": { version: "0.1.1", license: "AGPL-3.0-only" },
    "node_modules/clearotron-driver": { resolved: "driver", link: true },
    "node_modules/buffers": { resolved: "vendor/buffers", link: true },
    "node_modules/exceljs": { version: "4.4.0", license: "MIT", integrity: "sha512-" + Buffer.from("x".repeat(64)).toString("base64") },
    "node_modules/exceljs/node_modules/uuid": { version: "11.1.1", license: "MIT", integrity: "sha512-" + Buffer.from("y".repeat(64)).toString("base64") },
    "node_modules/@modelcontextprotocol/sdk": { version: "1.29.0", license: "MIT" },
    "node_modules/vite": { version: "7.0.0", license: "MIT", dev: true },
  },
};
const MANIFEST = { name: "clearotron", version: "9.9.9", license: "AGPL-3.0-only", workspaces: ["driver"] };

test("the parts list names what ships and nothing that does not", () => {
  const doc = sbomFor({ lock: LOCK, manifest: MANIFEST });
  assert.equal(doc.bomFormat, "CycloneDX");
  assert.equal(doc.specVersion, "1.5");
  assert.deepEqual(doc.metadata.component, { type: "library", "bom-ref": "pkg:npm/clearotron@9.9.9", name: "clearotron", version: "9.9.9",
    purl: "pkg:npm/clearotron@9.9.9", licenses: [{ expression: "AGPL-3.0-only" }] });
  const names = doc.components.map((c) => `${c.name}@${c.version}`);
  assert.deepEqual(names, ["buffers@0.1.1", "@modelcontextprotocol/sdk@1.29.0", "exceljs@4.4.0", "uuid@11.1.1"],
    "the list is not exactly the runtime packages, the nested one and the vendored one, in a fixed order");
  assert.ok(!names.some((n) => n.startsWith("vite@")), "a dev-only tool is listed as a part of the release");
  assert.ok(!names.some((n) => n.startsWith("clearotron-driver@")), "a workspace, which is this package's own code, is listed as a part");
});

test("a vendored package is listed by where it lives, never as the registry's package of that name", () => {
  const vendored = sbomFor({ lock: LOCK, manifest: MANIFEST }).components.find((c) => c.name === "buffers");
  assert.equal(vendored["bom-ref"], "file:vendor/buffers");
  assert.equal(vendored.purl, undefined, "the vendored replacement carries an npm purl, which names the unlicensed registry package it replaces");
  assert.deepEqual(vendored.properties, [{ name: "clearotron:vendored-path", value: "vendor/buffers" }]);
  assert.deepEqual(vendored.licenses, [{ expression: "AGPL-3.0-only" }]);
});

test("each part carries its purl, its licence, and its hash as hex", () => {
  const doc = sbomFor({ lock: LOCK, manifest: MANIFEST });
  const sdk = doc.components.find((c) => c.name === "@modelcontextprotocol/sdk");
  assert.equal(sdk.purl, "pkg:npm/%40modelcontextprotocol/sdk@1.29.0", "a scoped name's @ is not encoded as the purl spec asks");
  assert.equal(purlOf("exceljs", "4.4.0"), "pkg:npm/exceljs@4.4.0");
  const exceljs = doc.components.find((c) => c.name === "exceljs");
  assert.deepEqual(exceljs.hashes, [{ alg: "SHA-512", content: Buffer.from("x".repeat(64)).toString("hex") }]);
  assert.deepEqual(hashesOf("sha1-" + Buffer.from("ab").toString("base64")), [{ alg: "SHA-1", content: "6162" }]);
  assert.deepEqual(hashesOf(undefined), []);
  assert.deepEqual(exceljs.licenses, [{ expression: "MIT" }]);
});

test("on the real lock: every runtime package is listed with a hash and a licence, no dev package is, and two runs give the same bytes", (t) => {
  const lock = JSON.parse(read("package-lock.json"));
  const manifest = JSON.parse(read("package.json"));
  const doc = sbomFor({ lock, manifest });
  assert.ok(doc.components.length > 50, `only ${doc.components.length} parts: the writer is not reading the lock`);
  const runtime = Object.entries(lock.packages).filter(([k, v]) => k.includes("node_modules/") && !v.dev && !v.link && v.version);
  const listed = new Set(doc.components.map((c) => `${c.name}@${c.version}`));
  const nameOf = (k, v) => v.name ?? k.slice(k.lastIndexOf("node_modules/") + "node_modules/".length);
  const missing = runtime.map(([k, v]) => `${nameOf(k, v)}@${v.version}`).filter((n) => !listed.has(n));
  assert.deepEqual(missing, [], "runtime packages in the lock are missing from the parts list");
  const dev = new Set(Object.entries(lock.packages).filter(([k, v]) => k.includes("node_modules/") && v.dev).map(([k, v]) => `${nameOf(k, v)}@${v.version}`));
  const runtimeNames = new Set(runtime.map(([k, v]) => `${nameOf(k, v)}@${v.version}`));
  assert.deepEqual([...listed].filter((n) => dev.has(n) && !runtimeNames.has(n)), [], "a dev-only package is listed as a part of the release");
  assert.deepEqual(doc.components.filter((c) => c.purl && !c.hashes).map((c) => c.name), [], "a registry part carries no hash");
  assert.deepEqual(doc.components.filter((c) => !c.licenses).map((c) => c.name), [], "a part carries no licence");

  const dir = mkdtempSync(join(tmpdir(), "sbom-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const run = (out) => spawnSync(process.execPath, [join(ROOT, "scripts", "release-sbom.mjs"), "--out", out], { encoding: "utf8" });
  for (const n of [1, 2]) assert.equal(run(join(dir, `${n}.json`)).status, 0);
  assert.equal(readFileSync(join(dir, "1.json"), "utf8"), readFileSync(join(dir, "2.json"), "utf8"), "two runs over one lock wrote different bytes");
});

test("each publishing job writes the parts list, keeps it with the bytes, and attaches it to the entry", () => {
  const workflow = read(".github/workflows/release.yml");
  for (const name of ["publish", "publish-awaited"]) {
    const start = workflow.indexOf(`\n  ${name}:\n`);
    const rest = workflow.slice(start + 1);
    const text = rest.slice(0, rest.slice(1).search(/\n {2}[a-z][a-z-]*:\n/) + 1);
    assert.match(text, /run: node scripts\/release-sbom\.mjs --out "release-artefacts\/clearotron-\$\{\{ steps\.what\.outputs\.version \}\}\.cdx\.json"/,
      `${name} writes no parts list`);
    const keep = text.slice(text.indexOf("- name: Keep the published bytes for the scheduled entry job"));
    assert.match(keep.slice(0, keep.indexOf("\n\n")), /release-artefacts\/clearotron-\$\{\{ steps\.what\.outputs\.version \}\}\.cdx\.json/,
      `${name} does not keep the parts list with the bytes, so an entry written later would carry none`);
    const creates = text.match(/gh release create "v\$VERSION"[^\n]*/g) ?? [];
    assert.equal(creates.length, 4, `${name}: expected four places that create an entry, found ${creates.length}`);
    for (const line of creates) assert.match(line, /^gh release create "v\$VERSION" "\$SBOM" /, `${name} creates an entry without the parts list: ${line}`);
  }
});
