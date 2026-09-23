// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// release-sbom.mjs — the parts list attached to every release, written from package-lock.json.
//
//   node scripts/release-sbom.mjs [--out <file>]      # CycloneDX 1.5 JSON; stdout when --out is absent
//
// WHY NOT `npm sbom`. It refuses this tree: `ESBOMPROBLEMS: invalid: uuid@11.1.1 … required by
// exceljs@4.4.0`, on a clean `npm ci` as well, and `npm ls` flags the same edge. That is npm's reading of
// the `uuid` override on the bundled `exceljs`, and an exact-version override is flagged the same way
// (measured 2026-09-23 on npm 10.9.8). The reference tool, `@cyclonedx/cyclonedx-npm`, would add a
// dependency that runs inside a release job. The lock already names every package, its version, its
// integrity and its licence, which is what a parts list is.
//
// WHAT IS LISTED. Every package the lock installs that is not dev-only: the runtime dependencies and
// everything they pull in, and the bundled ones this package carries inside its tarball. A consumer's
// npm resolves the unbundled ones again at install time, so the list is what this release was built and
// tested with, which is what an SBOM of a library can honestly say. Workspace links are this package's
// own files, not parts, and are left out; a vendored package is listed by its path in this tree.
//
// THE SAME LOCK GIVES THE SAME BYTES. No timestamp and no serial number: both are optional in the spec,
// and either would make two runs over one lock differ for no reason a reader can use.
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { isEntrypoint } from "../shared/is-entrypoint.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** `pkg:npm/<name>@<version>`, with a scope's `@` encoded as the purl spec asks. */
export const purlOf = (name, version) => `pkg:npm/${name.startsWith("@") ? `%40${name.slice(1)}` : name}@${version}`;

/** An npm integrity string (`sha512-<base64>`) as CycloneDX hashes, hex-encoded. */
export function hashesOf(integrity) {
  const out = [];
  for (const part of String(integrity ?? "").split(/\s+/).filter(Boolean)) {
    const m = /^(sha512|sha384|sha256|sha1)-(.+)$/.exec(part);
    if (!m) continue;
    const alg = { sha512: "SHA-512", sha384: "SHA-384", sha256: "SHA-256", sha1: "SHA-1" }[m[1]];
    out.push({ alg, content: Buffer.from(m[2], "base64").toString("hex") });
  }
  return out;
}

/**
 * The CycloneDX document for a parsed lockfile and the root manifest. PURE.
 * @param {{ lock: object, manifest: object }} input
 */
export function sbomFor({ lock, manifest }) {
  const byRef = new Map();
  const workspaces = new Set((manifest.workspaces ?? []).map((w) => w.replace(/\/+$/, "")));
  for (const [path, entry] of Object.entries(lock.packages ?? {})) {
    if (!path.startsWith("node_modules/") && !path.includes("/node_modules/")) continue;   // the root and link targets
    if (entry.dev) continue;                                                                 // dev-only tools
    // A LINK TO A WORKSPACE is this package's own code. A link to anything else is code this package
    // carries in its own tree, such as a vendored replacement, and it is listed by where it lives, with no
    // npm purl: that would name the registry's package of the same name, which it is not.
    if (entry.link) {
      const target = lock.packages?.[entry.resolved] ?? {};
      if (workspaces.has(entry.resolved) || !target.version || target.dev) continue;
      const name = path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length);
      const ref = `file:${entry.resolved}`;
      const vendored = { type: "library", "bom-ref": ref, name, version: target.version,
        properties: [{ name: "clearotron:vendored-path", value: entry.resolved }] };
      if (typeof target.license === "string" && target.license) vendored.licenses = [{ expression: target.license }];
      byRef.set(ref, vendored);
      continue;
    }
    const name = entry.name ?? path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length);
    if (!entry.version) continue;
    const ref = purlOf(name, entry.version);
    if (byRef.has(ref)) continue;
    const component = { type: "library", "bom-ref": ref, name, version: entry.version, purl: ref };
    const hashes = hashesOf(entry.integrity);
    if (hashes.length) component.hashes = hashes;
    if (typeof entry.license === "string" && entry.license) component.licenses = [{ expression: entry.license }];
    byRef.set(ref, component);
  }
  const components = [...byRef.values()].sort((a, b) => a["bom-ref"].localeCompare(b["bom-ref"]));
  const root = { type: "library", "bom-ref": purlOf(manifest.name, manifest.version), name: manifest.name, version: manifest.version,
    purl: purlOf(manifest.name, manifest.version) };
  if (manifest.license) root.licenses = [{ expression: manifest.license }];
  return { bomFormat: "CycloneDX", specVersion: "1.5", version: 1, metadata: { component: root }, components };
}

function main() {
  const argv = process.argv.slice(2);
  const i = argv.indexOf("--out");
  const out = i === -1 ? null : argv[i + 1];
  if (i !== -1 && !out) { console.error("release-sbom: --out needs a file."); return 2; }
  let lock, manifest;
  try {
    lock = JSON.parse(readFileSync(join(ROOT, "package-lock.json"), "utf8"));
    manifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  } catch (e) { console.error(`release-sbom: could not read the lock or the manifest: ${e.message}. Could not look.`); return 2; }
  const doc = sbomFor({ lock, manifest });
  if (!doc.components.length) { console.error("release-sbom: the lock lists no runtime package, so there is no parts list to write. Refusing an empty one."); return 1; }
  const text = JSON.stringify(doc, null, 2) + "\n";
  if (out) { writeFileSync(out, text); console.log(`release-sbom: ${doc.components.length} part(s) of ${manifest.name}@${manifest.version} written to ${out}.`); }
  else process.stdout.write(text);
  return 0;
}

if (isEntrypoint(import.meta.url)) process.exitCode = main();
