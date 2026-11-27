// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// codex-catalog.mjs — the models a Codex sign-in offers, read from the program's own catalog, with no model call.
//
// A Codex sign-in does not offer every model: measured on the test box, 2026-11-27, codex-cli 0.162.0 on a ChatGPT
// sign-in refused `gpt-6.2-sol` ("not supported when using Codex with a ChatGPT account"), and `codex debug models`,
// which renders the sign-in's catalog as JSON without asking a model anything, did not list it. So a search whose
// questions need a model the catalog lacks can be stopped before anything is spent, rather than paying for its register
// stages and then failing at its first question.
//
// NULL MEANS NOT KNOWN, never "offers nothing": a program that cannot render its catalog, or renders one this cannot
// read, stops nothing here, and a question it then cannot serve fails with the program's own reason.
import { spawnSync } from "node:child_process";
import { resolveEngineProgram } from "../driver.config.mjs";

/** The model ids the Codex sign-in offers, as a Set, or null where the catalog could not be read. IMPURE (runs the program). */
export function readCodexCatalog({ env = process.env, timeoutMs = 20000, run = spawnSync } = {}) {
  const prog = resolveEngineProgram("openai-agent", { env });
  const bin = prog.resolved ?? prog.bin;
  if (!bin) return null;
  let r;
  try { r = run(bin, ["debug", "models"], { encoding: "utf8", timeout: timeoutMs, env, stdio: ["ignore", "pipe", "ignore"] }); }
  catch { return null; }
  return catalogFrom(r?.status === 0 ? r.stdout : null);
}

/** The model ids in a rendered catalog, or null where it is not one. PURE. */
export function catalogFrom(text) {
  let j;
  try { j = JSON.parse(String(text ?? "")); } catch { return null; }
  const ids = (Array.isArray(j?.models) ? j.models : []).map((m) => m?.slug ?? m?.id).filter((s) => typeof s === "string" && s.trim());
  return ids.length ? new Set(ids) : null;
}
