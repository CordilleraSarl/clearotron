// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// THE VERSION OF THE BINARY THAT SERVED A RUN, captured at dispatch.
//
// The record already says whether the model id the provider reported names a pinned build or an alias it
// may repoint. That answers "did the model move". It cannot answer "did the TOOL move", and the two are
// different questions with the same symptom: a run whose judgment differs from last week's.
//
// Nothing recorded it. Three archived runs were walked for every spelling of a version field and carried
// none — so what served them is not recoverable, and the box could have answered at any time.
//
// ── UNREADABLE IS A VALUE, NOT AN OMISSION ──────────────────────────────────────────────────────────
//
// The whole point of the field is telling three states apart, and only one of them is "we know":
//
//   { version: "2.1.241", probe: "ok" }          the binary answered
//   { version: null, probe: "unreadable", why }  it was asked and could not say
//   (no field at all)                            this record predates the gauge
//
// An omission on failure collapses the middle into the third, and a reader comparing two runs cannot
// tell a tool that would not answer from a record written before anybody asked. That distinction is the
// reason for the field, so failing to write it is failing at the thing rather than at the edge of it.
//
// ── ONE SPAWN PER BUILD, NOT PER PROCESS ────────────────────────────────────────────────────────────
//
// A dispatch is many stages and every stage would otherwise pay. But the cache lives as long as the
// process, and the process is NOT one run: the drainer's watch loop calls the pipeline for job after job
// without exiting. A first version cached there would be reported as fact for every later run in that
// process — including runs served by a binary somebody upgraded in place underneath it.
//
// That is the exact silence this field exists to end, reintroduced by the cache meant to make it cheap,
// and it would have been invisible: the record would carry a version, confidently, and be wrong.
//
// So the key is the path AND what the filesystem says about the file — an in-place upgrade changes the
// modification time and the size, so it misses the cache and is probed again. The path alone is not
// enough (two engines can point at one binary, an engine can be repointed) and the engine id is not
// enough for the same reason.
//
// A file the filesystem cannot describe is NOT CACHED at all. Caching an unreadable probe under a key
// derived from a failed stat would pin the failure for the life of the process, so a binary that
// appeared a moment later would keep reading as absent.
// ── WHAT THIS DEPENDS ON, WHICH IS NOT ENFORCEABLE FROM HERE ────────────────────────────────────────
//
// A probe that can change what it probes is not a probe. This one spawns the engine binary, so it rests
// on `--version` being side-effect-free — true of every real CLI and not something this module can make
// true. It bit immediately: the suite's engine stand-ins fell through to their stage path, and one of
// them counts invocations to decide when to fail, so the probe consumed the failure a retry test was
// measuring and the retry never happened. The symptom was an attempt count off by one, three files away
// from the cause.
//
// The stand-ins now answer `--version` and exit, which is what the binaries they stand in for do. A new
// one that forgets will produce the same off-by-one, so `driver/test/a-run-records-the-tool-that-served-it`
// asserts every engine stand-in answers — the cheap ratchet under a condition that cannot be checked at
// the call site.
import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";

/** Live for the process, keyed by resolved path. A run is one process; a probe is one spawn. */
const CACHE = new Map();

/** The first version-shaped token in the output, or the whole first line when nothing matches. */
export function parseVersion(out) {
  const line = String(out ?? "").split("\n").map((l) => l.trim()).filter(Boolean)[0] ?? "";
  if (!line) return null;
  // These CLIs answer `2.1.241`, `codex-cli 0.5.0`, `claude 2.1.241 (Claude Code)`. Take the first
  // dotted number and keep it; a build that answers in prose is recorded verbatim rather than dropped,
  // because a string somebody can compare beats a null.
  return (line.match(/\b\d+\.\d+(?:\.\d+)?(?:[-+][0-9A-Za-z.-]+)?\b/) ?? [line])[0];
}

/**
 * Probe one binary. PURE apart from the spawn, which is injected so an arm can drive both branches
 * without a binary on the box — the unreadable branch is the one that matters and it cannot be produced
 * on demand from a real install.
 *
 * Never throws. A probe that could take down a dispatch would be a worse defect than the gap it closes.
 */
export function probeCliVersion(bin, { run = null, timeoutMs = 5000, cache = CACHE, stat = statSync } = {}) {
  if (!bin) return { version: null, probe: "unreadable", why: "no engine binary was resolved" };
  let key = null;
  try { const st = stat(bin); key = `${bin}\u0000${st.mtimeMs}:${st.size}`; } catch { /* not cacheable */ }
  if (key && cache.has(key)) return cache.get(key);
  const spawn = run ?? ((b) => execFileSync(b, ["--version"], {
    encoding: "utf8", timeout: timeoutMs, stdio: ["ignore", "pipe", "ignore"],
  }));
  let result;
  try {
    const version = parseVersion(spawn(bin));
    result = version
      ? { version, probe: "ok" }
      // It ran and said nothing a version could be read from. That is not the same as failing to run,
      // and a reader chasing a tool change needs to know which happened.
      : { version: null, probe: "unreadable", why: "the binary answered with no version-shaped token" };
  } catch (e) {
    result = { version: null, probe: "unreadable", why: String(e?.message ?? e).slice(0, 160) };
  }
  if (key) cache.set(key, result);
  return result;
}

/** Drop the cache. For arms, and for a caller that has just repointed an engine deliberately. */
export function forgetCliVersions(cache = CACHE) { cache.clear(); }
