#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// mcp-registry-listing.mjs — the MCP Registry lists each stable release npm serves, and nothing else.
//
//   node scripts/mcp-registry-listing.mjs plan                  the stables npm serves that the registry does not list
//   node scripts/mcp-registry-listing.mjs publish <publisher>   list each of them, oldest first, and read each back
//
// The registry (registry.modelcontextprotocol.io) is where MCP clients look a server up. It holds metadata
// only, about a package npm already serves, and a version's metadata can never change once it is listed.
// So nothing here reacts to a release: it asks npm which stables it serves and the registry which it
// lists, and lists what is missing. A run that fails is asked again by the next one, and no release ever
// waits for this.
//
// ONE SOURCE SETS BOTH VERSIONS. Every field that names a version comes from npm's manifest for that exact
// version, and so does the name: `mcpName` there is the listing's name. The registry reads `mcpName` from
// npm in turn and refuses a listing that disagrees, so the two cannot drift.
//
// A STABLE WITHOUT `mcpName`. The stables published before the field existed are passed by. One published
// after the first stable that carries it is refused: something stripped it, and listing past it would hide
// that.
//
// A SOURCE THAT CANNOT BE READ IS EXIT 2, never "nothing to list" and never "already listed". The
// registry's 404 for this exact name is an answer: nothing is listed under it yet.
//
// The registry marks the highest version latest whatever order versions arrive in (`registry_service.go`
// at v1.8.1). Missing stables are listed oldest first all the same, so its record reads in release order.
//
// Exit 0: nothing to list, or each one listed and read back.
// Exit 1: a stable after the first carrying `mcpName` lacks it, or a listing failed or did not read back.
// Exit 2: could not look.
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isEntrypoint } from "../shared/is-entrypoint.mjs";

export const SERVER_NAME = "io.github.CordilleraSarl/clearotron";
/** The README banner's alt text, a shipped line. The registry allows 100 characters. */
export const DESCRIPTION = "Clearotron — trademark clearance that shows its work";
export const SCHEMA = "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json";
export const REPOSITORY = Object.freeze({ url: "https://github.com/CordilleraSarl/clearotron", source: "github" });
export const NPM_URL = "https://registry.npmjs.org/clearotron";
export const LISTED_URL = `https://registry.modelcontextprotocol.io/v0.1/servers/${encodeURIComponent(SERVER_NAME)}/versions`;
/** The registry's refusal of a version it already holds (`ErrInvalidVersion`, v1.8.1): already listed. */
const DUPLICATE = /cannot publish duplicate version/;

export class CouldNotLook extends Error {}

const STABLE = /^(\d+)\.(\d+)\.(\d+)$/;
export const isStable = (v) => STABLE.test(v);
const parts = (v) => v.match(STABLE).slice(1).map(Number);
export function compareStable(a, b) {
  const [x, y] = [parts(a), parts(b)];
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
}

/** The listing for one stable npm serves, every field that can come from its manifest taken from it. PURE. */
export function serverJsonFor(manifest) {
  if (manifest?.mcpName !== SERVER_NAME) {
    throw new Error(`${manifest?.name}@${manifest?.version} carries mcpName ${JSON.stringify(manifest?.mcpName ?? null)}, not ${SERVER_NAME}`);
  }
  if (!isStable(manifest.version)) throw new Error(`${manifest.version} is not a stable version`);
  return {
    $schema: SCHEMA,
    name: manifest.mcpName,
    description: DESCRIPTION,
    repository: { ...REPOSITORY },
    version: manifest.version,
    packages: [{
      registryType: "npm",
      identifier: manifest.name,
      version: manifest.version,
      transport: { type: "stdio" },
      packageArguments: [{ type: "positional", value: "mcp" }],
    }],
  };
}

/**
 * Which stables to list. PURE.
 * @param {Record<string, object>} served  npm's manifests, by version
 * @param {Set<string>} listed             the versions the registry lists under the name
 * @returns {{ list: object[], passedBy: string[], refused: string[] }}  `list` oldest first
 */
export function plan(served, listed) {
  const stables = Object.keys(served).filter(isStable).sort(compareStable);
  const first = stables.findIndex((v) => served[v]?.mcpName === SERVER_NAME);
  if (first === -1) return { list: [], passedBy: stables, refused: [] };
  const list = [];
  const refused = [];
  for (const v of stables.slice(first)) {
    if (served[v]?.mcpName !== SERVER_NAME) refused.push(v);
    else if (!listed.has(v)) list.push(served[v]);
  }
  return { list, passedBy: stables.slice(0, first), refused };
}

async function readJson(url, fetchImpl, who) {
  let res;
  try {
    res = await fetchImpl(url, { headers: { accept: "application/json" } });
  } catch (e) {
    throw new CouldNotLook(`${who} did not answer: ${e.message}`);
  }
  if (res.status === 404) return null;
  if (res.status !== 200) throw new CouldNotLook(`${who} answered ${res.status}`);
  try {
    return await res.json();
  } catch {
    throw new CouldNotLook(`${who} answered with something that is not JSON`);
  }
}

/** npm's manifests for every version it serves. */
export async function readServed(fetchImpl = fetch) {
  const body = await readJson(NPM_URL, fetchImpl, "npm");
  if (!body?.versions || typeof body.versions !== "object") throw new CouldNotLook("npm's answer names no versions");
  return body.versions;
}

/** The versions the registry lists under the exact name: empty when it has never listed it. */
export async function readListed(fetchImpl = fetch) {
  const body = await readJson(LISTED_URL, fetchImpl, "the MCP Registry");
  if (body === null) return new Set();
  if (!Array.isArray(body?.servers)) throw new CouldNotLook("the MCP Registry's answer lists no servers");
  if (body.metadata?.nextCursor) throw new CouldNotLook("the MCP Registry's answer is paged, and this reads one page");
  const listed = new Set();
  for (const s of body.servers) {
    if (s?.server?.name !== SERVER_NAME) throw new CouldNotLook(`the MCP Registry answered for ${JSON.stringify(s?.server?.name)}`);
    listed.add(s.server.version);
  }
  return listed;
}

/** Hand one listing to the publisher. A refusal as a duplicate means it is already there. */
export function publishOne(manifest, publisher, run = spawnSync) {
  const dir = mkdtempSync(join(tmpdir(), "mcp-registry-"));
  try {
    const file = join(dir, "server.json");
    writeFileSync(file, JSON.stringify(serverJsonFor(manifest), null, 2) + "\n");
    const r = run(publisher, ["publish", file], { encoding: "utf8" });
    const said = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();
    if (r.status === 0) return { ok: true, said };
    if (DUPLICATE.test(said)) return { ok: true, duplicate: true, said };
    return { ok: false, said: said || String(r.error?.message ?? `exit ${r.status}`) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export async function main(argv, { fetchImpl = fetch, run = spawnSync, output = process.env.GITHUB_OUTPUT, log = console.log, warn = console.error } = {}) {
  const [cmd, publisher] = argv;
  if (!(cmd === "plan" || (cmd === "publish" && publisher))) {
    warn("usage: mcp-registry-listing.mjs plan | publish <publisher>");
    return 2;
  }
  let p;
  try {
    p = plan(await readServed(fetchImpl), await readListed(fetchImpl));
  } catch (e) {
    if (!(e instanceof CouldNotLook)) throw e;
    warn(`mcp-registry: could not look: ${e.message}`);
    return 2;
  }
  if (p.passedBy.length) log(`mcp-registry: passed by, published before mcpName: ${p.passedBy.join(", ")}`);
  if (p.refused.length) {
    warn(`mcp-registry: REFUSED. These stables came after the first that carries mcpName and do not carry it: ${p.refused.join(", ")}`);
    return 1;
  }
  log(p.list.length ? `mcp-registry: to list, oldest first: ${p.list.map((m) => m.version).join(", ")}` : "mcp-registry: nothing to list");
  if (output) appendFileSync(output, `count=${p.list.length}\n`);
  if (cmd === "plan") return 0;

  for (const manifest of p.list) {
    const r = publishOne(manifest, publisher, run);
    if (!r.ok) {
      warn(`mcp-registry: ${manifest.version} was not listed: ${r.said}`);
      return 1;
    }
    let listed;
    try {
      listed = await readListed(fetchImpl);
    } catch (e) {
      if (!(e instanceof CouldNotLook)) throw e;
      warn(`mcp-registry: could not read ${manifest.version} back: ${e.message}`);
      return 2;
    }
    if (!listed.has(manifest.version)) {
      warn(`mcp-registry: the publisher ${r.duplicate ? "called" : "reported"} ${manifest.version} ${r.duplicate ? "a duplicate" : "listed"}, and the registry does not list it`);
      return 1;
    }
    log(`mcp-registry: ${manifest.version} ${r.duplicate ? "was already listed" : "listed"}, and read back`);
  }
  return 0;
}

if (isEntrypoint(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
