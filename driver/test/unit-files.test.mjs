// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// second pass — THE WALK THAT FINDS EVERY UNIT FILE, wherever in the tree it sits.
//
// The lookup behind the inventory, the drift arm and the ratchet was `driver/systemd/`, hardcoded in
// three places. Four tracked unit files live elsewhere, so three inventory entries could state as FACT
// that no tracked file existed while the file sat one directory over, and nothing could contradict them.
//
// The tests here are about the ways a walk lies quietly:
//   · it returns [] because the root was wrong                → an ERROR, never an empty result
//   · it returns [] because a prune ate the directory         → caught by the git cross-check next door
//   · it finds one basename twice and picks a winner          → REPORTED, never resolved

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { findUnitFiles, unitFilePath, PRUNED_DIRS, UNIT_SUFFIXES, MAX_DEPTH } from "../unit-files.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const scratch = () => mkdtempSync(join(process.env.TMPDIR || tmpdir(), "unit-files-"));

test("#685 the walk finds unit files outside driver/systemd/, which is the whole point", () => {
  const w = findUnitFiles(ROOT);
  assert.equal(w.error, null);
  // Named, not counted: a count assertion passes on the wrong four files.
  for (const [file, dir] of [
    ["prelim-driver.service", "driver/systemd"],
    ["client-mcp.service", "mcp-server/remote"],
    ["client-mcp-apikey.service", "mcp-server/remote"],
    ["trademark-artifacts-http.service", "mcp-server/remote"],
    ["courtlistener-mcp.service", "providers/oauth-mcp-bridge/systemd"],
  ]) {
    assert.ok(w.files.includes(file), `${file} is tracked and the walk did not find it`);
    assert.equal(unitFilePath(w, file), `${dir}/${file}`, `${file} must resolve to its real path`);
  }
});

test("#685 an unreadable root is an ERROR, not an empty list", () => {
  const w = findUnitFiles(join(ROOT, "no-such-directory-anywhere"));
  assert.match(w.error, /walk could not start/);
  assert.deepEqual(w.files, []);
  // The pairing is the point: a caller that reads `files.length === 0` as "nothing unaccounted for"
  // turns a wrong path into a green check, which is the failure mode this repo keeps paying for.
  assert.ok(w.error && w.files.length === 0, "empty AND explained, so a caller can tell which zero it has");
});

test("#685 an unreadable subtree is recorded, so a hole cannot pass as an absence", () => {
  const root = scratch();
  try {
    mkdirSync(join(root, "open"));
    writeFileSync(join(root, "open", "a.service"), "[Unit]\n");
    mkdirSync(join(root, "shut"));
    writeFileSync(join(root, "shut", "b.service"), "[Unit]\n");
    chmodSync(join(root, "shut"), 0o000);
    const w = findUnitFiles(root);
    if (process.getuid?.() === 0) {
      assert.deepEqual(w.files, ["a.service", "b.service"], "running as root, nothing is unreadable");
    } else {
      assert.deepEqual(w.files, ["a.service"]);
      assert.match(w.error, /could not read shut/, "b.service is missing and the walk says why");
    }
  } finally {
    try { chmodSync(join(root, "shut"), 0o755); } catch { /* already readable */ }
    rmSync(root, { recursive: true, force: true });
  }
});

test("#685 a basename at two paths is REPORTED, never silently resolved", () => {
  const root = scratch();
  try {
    for (const d of ["one", "two"]) {
      mkdirSync(join(root, d));
      writeFileSync(join(root, d, "twin.service"), "[Unit]\n");
    }
    const w = findUnitFiles(root);
    assert.deepEqual(w.collisions, ["twin.service"]);
    assert.deepEqual(w.paths.get("twin.service"), ["one/twin.service", "two/twin.service"],
      "both paths survive, so the message can name them");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("#685 node_modules is pruned — a dependency's unit file is not a unit this repo ships", () => {
  const root = scratch();
  try {
    mkdirSync(join(root, "node_modules", "somepkg"), { recursive: true });
    writeFileSync(join(root, "node_modules", "somepkg", "vendor.service"), "[Unit]\n");
    mkdirSync(join(root, "systemd"));
    writeFileSync(join(root, "systemd", "ours.service"), "[Unit]\n");
    const w = findUnitFiles(root);
    assert.deepEqual(w.files, ["ours.service"]);
    assert.ok(PRUNED_DIRS.includes("node_modules") && PRUNED_DIRS.includes(".git"));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("#685 every unit kind systemd loads is in scope, so a new kind is found and not skipped", () => {
  const root = scratch();
  try {
    for (const s of UNIT_SUFFIXES) writeFileSync(join(root, `x${s}`), "[Unit]\n");
    writeFileSync(join(root, "notes.md"), "not a unit\n");
    const w = findUnitFiles(root);
    assert.equal(w.files.length, UNIT_SUFFIXES.length);
    assert.ok(!w.files.includes("notes.md"));
    for (const s of [".service", ".timer", ".path"]) assert.ok(UNIT_SUFFIXES.includes(s));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("#685 the depth cap RECORDS what it refused to walk, rather than truncating quietly", () => {
  // A cap that returns silently is a walk that stops finding files and says nothing — the exact shape
  // this module exists to refuse, hiding inside the guard meant to keep it safe.
  const root = scratch();
  try {
    let deep = root;
    for (let i = 0; i <= MAX_DEPTH + 1; i++) { deep = join(deep, `d${i}`); mkdirSync(deep); }
    writeFileSync(join(deep, "buried.service"), "[Unit]\n");
    writeFileSync(join(root, "shallow.service"), "[Unit]\n");
    const w = findUnitFiles(root);
    assert.deepEqual(w.files, ["shallow.service"], "the buried one is genuinely not found");
    assert.match(w.error, new RegExp(`deeper than ${MAX_DEPTH} levels`),
      "and the walk says a subtree was skipped, so its absence is not read as a pass");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("#685 a tree with no unit file returns an empty list and NO error — the caller decides", () => {
  const root = scratch();
  try {
    writeFileSync(join(root, "README.md"), "nothing here\n");
    const w = findUnitFiles(root);
    assert.deepEqual(w.files, []);
    assert.equal(w.error, null, "a genuinely unit-free tree is a real answer; the caller says whether it "
      + "is a plausible one for the repo it just walked");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
