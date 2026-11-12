#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// secret-scanner-fetch.mjs — put the pinned secret scanner in the current directory, from a kept copy if there is one.
//
//   GITLEAKS_VERSION=… GITLEAKS_SHA256=… GITLEAKS_CACHE_DIR=<dir> node scripts/secret-scanner-fetch.mjs
//
// Every release and CI run used to download the scanner from github.com's release files. Those answered 504 for
// over an hour on 2026-11-08 while everything else on GitHub worked, and a publish waited on them. So the archive
// is kept in an Actions cache and the download is the fallback. Whichever it comes from, it must match the pinned
// hash: a kept copy that does not is ignored, and a download that does not stops the run.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { isEntrypoint } from "../shared/is-entrypoint.mjs";

const ARCHIVE = "gitleaks.tgz";
const matches = (file, sha256) => createHash("sha256").update(readFileSync(file)).digest("hex") === sha256;

export function fetchSecretScanner({ version, sha256, cacheDir, cwd = process.cwd(), log = console.log }) {
  if (!version || !sha256 || !cacheDir) throw new Error("secret-scanner-fetch: GITLEAKS_VERSION, GITLEAKS_SHA256 and GITLEAKS_CACHE_DIR are all required");
  const kept = join(cacheDir, `gitleaks-${version}.tgz`);
  const archive = join(cwd, ARCHIVE);
  if (existsSync(kept) && matches(kept, sha256)) {
    copyFileSync(kept, archive);
    log(`secret-scanner-fetch: using the kept copy of ${version}`);
  } else {
    log(`secret-scanner-fetch: no usable kept copy of ${version}; downloading it`);
    const url = `https://github.com/gitleaks/gitleaks/releases/download/v${version}/gitleaks_${version}_linux_x64.tar.gz`;
    execFileSync("curl", ["-sSfL", "--retry", "5", "--retry-delay", "10", "-o", archive, url], { cwd, stdio: "inherit" });
    if (!matches(archive, sha256)) throw new Error(`secret-scanner-fetch: the download of ${version} does not match the pinned hash`);
    mkdirSync(cacheDir, { recursive: true });
    copyFileSync(archive, kept);
  }
  execFileSync("tar", ["-xzf", ARCHIVE, "gitleaks"], { cwd, stdio: "inherit" });
}

if (isEntrypoint(import.meta.url)) {
  try {
    fetchSecretScanner({ version: process.env.GITLEAKS_VERSION, sha256: process.env.GITLEAKS_SHA256, cacheDir: process.env.GITLEAKS_CACHE_DIR });
  } catch (e) {
    console.error(String(e?.message ?? e));
    process.exitCode = 2;
  }
}
