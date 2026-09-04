// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// The per-user shim that puts the `clearotron` verb on the operator's PATH — where it is written, what
// it contains, and how this install recognises one of its own.
//
//. The owner hit this for real: he was given a command, typed it from his home
// directory, and got `npm error could not determine executable to run`. Not our error, naming no
// product, suggesting no fix. `npx` resolves a local package by walking UP from the current directory
// to find node_modules, so every command this product prints worked only where the reader happened to
// be standing. Owner ruling, 2026-08-26: put the verb on PATH.
//
// WHY A PER-USER SHIM AND NOT `npm link`. `npm link` writes to npm's global prefix, which on a default
// install is `/usr` and refuses without root (recorded, which is why that issue
// stopped at teaching the product to print `npx`). `~/.local/bin` needs no root, is on the PATH that
// every mainstream distribution's login profile builds, and belongs to the operator who ran the install.
//
// WHY THE WRITER AND THE READER LIVE IN ONE FILE. The marker below is the only thing that tells this
// install "I wrote that shim, and it points at ME". If the sentence that writes it and the sentence
// that matches it sat in different files, a change to either would leave the other quietly answering
// the old question — the shape recorded as "a mechanical rename must move both ends".
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The root of THIS install — `<root>/shared/verb-shim.mjs` is this file. */
export const INSTALL_DIR = dirname(dirname(fileURLToPath(import.meta.url)));

/** First line of any shim we wrote. Present in no shim we did not. */
export const SHIM_MARKER = "clearotron install shim v1";

/** The directory the shim goes in, and the shim itself. `null` when the environment names no home. */
export function shimDir(env = process.env) {
  const home = String(env?.HOME ?? "").trim();
  return home ? join(home, ".local", "bin") : null;
}
export function shimPath(env = process.env) {
  const dir = shimDir(env);
  return dir ? join(dir, "clearotron") : null;
}

/**
 * The shim's contents.
 *
 * NODE IS NAMED ABSOLUTELY, ON PURPOSE. The shim is the thing a reader runs from a login shell, a cron
 * line or a unit file, and a service's PATH is not your shell's — the same reasoning bin/onboard.mjs
 * already applies to the engine binary it records. A bare `node` here would make the shim work in the
 * terminal that created it and fail everywhere else, which is the class of failure this file exists to
 * remove rather than relocate.
 */
export function shimBody({ installDir = INSTALL_DIR, nodePath = process.execPath } = {}) {
  return [
    "#!/bin/sh",
    `# ${SHIM_MARKER}`,
    `# install: ${installDir}`,
    "#",
    "# Written by `clearotron install`. Delete this file to remove the verb from your PATH; re-running",
    "# the install writes it again. Nothing else reads it — it is a convenience, not configuration.",
    `exec ${JSON.stringify(nodePath)} ${JSON.stringify(join(installDir, "bin", "clearotron.mjs"))} "$@"`,
    "",
  ].join("\n");
}

/**
 * Read at most `cap` bytes of a file. Unreadable, absent or a directory all throw, and every caller
 * treats a throw as "not one of ours" — the safe direction, because the consequence of guessing wrong
 * is telling a reader to type a bare name that reaches somebody else's copy.
 */
function readHead(path, cap = 4096) {
  const fd = openSync(path, "r");
  try {
    const buf = Buffer.alloc(cap);
    return buf.subarray(0, readSync(fd, buf, 0, cap, 0)).toString("utf8");
  } finally {
    closeSync(fd);
  }
}

/**
 * What sits at `path`: one of ours pointing at `installDir`, one of ours pointing somewhere else, or
 * something that is not ours at all.
 *
 * THE SECOND CASE IS NOT THE FIRST. A box with two installs of this product has one `~/.local/bin/
 * clearotron`, and it names one of them. Treating "a shim exists" as "the bare name reaches me" is
 * exactly the `which` mistake shared/invocation.mjs refuses to make, wearing different clothes.
 */
export function inspectShim(path, { installDir = INSTALL_DIR, read = readHead } = {}) {
  let head;
  try {
    head = read(path);
  } catch {
    return { kind: "absent-or-unreadable", installDir: null };
  }
  if (!head.includes(SHIM_MARKER)) return { kind: "foreign", installDir: null };
  const named = /^# install: (.*)$/m.exec(head)?.[1]?.trim() ?? null;
  // THE INTERPRETER IS BAKED IN AT INSTALL TIME, so it can stop existing without the shim changing.
  // On an nvm box — and `.nvmrc` ships in this package — a node upgrade removes the recorded path, and
  // the shim then fails with `/bin/sh: exec: …/node: not found`: not our error, naming no product,
  // which is the class this whole file was written to remove rather than relocate. Reported so doctor
  // can say so instead of ticking a shim it has not checked can run.
  const exec = /^exec "([^"]+)"/m.exec(head)?.[1] ?? null;
  return {
    kind: named === installDir ? "ours" : "ours-other-install",
    installDir: named,
    interpreter: exec,
    interpreterMissing: exec ? !existsSync(exec) : null,
  };
}

/**
 * Is `dir` on this environment's PATH, and if a `clearotron` is found earlier on it, where?
 *
 * AN EMPTY PATH ENTRY MEANS THE CURRENT DIRECTORY, and it is skipped deliberately: a form that resolves
 * only from where the reader happens to be standing is the defect, not a way of satisfying it.
 */
export function pathPosition(dir, env = process.env, { exists } = {}) {
  const entries = String(env?.PATH ?? "").split(delimiter).filter(Boolean).map((d) => resolve(d));
  const want = dir ? resolve(dir) : null;
  const onPath = want !== null && entries.includes(want);
  let shadowedBy = null;
  if (onPath && exists) {
    for (const d of entries) {
      if (d === want) break;
      if (exists(join(d, "clearotron"))) { shadowedBy = join(d, "clearotron"); break; }
    }
  }
  return { onPath, shadowedBy };
}

/**
 * Write the shim. Returns what happened, and NEVER throws for a reason the install should die on — the
 * install's deliverable is a working install, and a convenience that could not be written is a warning
 * on the way past, not an abort.
 *
 * A FOREIGN FILE AT THAT PATH IS NOT OVERWRITTEN. Somebody else's `clearotron` on this operator's PATH
 * is a fact about their machine; replacing it silently would hijack a name we do not own. It is reported
 * and the advice falls back to a form that names this install explicitly.
 */
export function installShim({ env = process.env, installDir = INSTALL_DIR, nodePath = process.execPath } = {}) {
  if (process.platform === "win32") {
    return { ok: false, reason: "windows", detail: "a POSIX shim would not be runnable here", path: null };
  }
  const path = shimPath(env);
  if (!path) return { ok: false, reason: "no-home", detail: "this environment names no HOME", path: null };

  const found = inspectShim(path, { installDir });
  if (found.kind === "foreign") {
    return { ok: false, reason: "occupied", path, detail: `${path} exists and was not written by this product` };
  }
  const replacing = found.kind === "ours-other-install" ? found.installDir : null;

  const tmp = `${path}.tmp-${process.pid}`;
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(tmp, shimBody({ installDir, nodePath }), { mode: 0o755 });
    chmodSync(tmp, 0o755);
    renameSync(tmp, path);
  } catch (e) {
    try { unlinkSync(tmp); } catch { /* nothing to clean */ }
    return { ok: false, reason: "unwritable", path, detail: `${e?.code ?? ""} ${e?.message ?? e}`.trim() };
  }
  return { ok: true, path, replacing, dir: dirname(path) };
}
