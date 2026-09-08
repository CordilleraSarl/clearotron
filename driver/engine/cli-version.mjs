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
// ── ONE SPAWN PER ENGINE PER RUN ────────────────────────────────────────────────────────────────────
//
// A dispatch is many stages and every stage would otherwise pay. The cache is keyed by the RESOLVED
// binary path rather than by the engine id, because two engines can point at one binary and one engine
// can be repointed mid-run by an operator — keying on the id would then serve a version for a file that
// is no longer the one being spawned.
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
export function probeCliVersion(bin, { run = null, timeoutMs = 5000, cache = CACHE } = {}) {
  if (!bin) return { version: null, probe: "unreadable", why: "no engine binary was resolved" };
  if (cache.has(bin)) return cache.get(bin);
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
  cache.set(bin, result);
  return result;
}

/** Drop the cache. For arms, and for a caller that has just repointed an engine deliberately. */
export function forgetCliVersions(cache = CACHE) { cache.clear(); }
