// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// stage-tools.mjs — what one stage's turns are handed: tool servers, allowed tools, skills folder and read grants.
//
// The stage ladder (gateway.mjs runStageLadder) asks this once per stage, before its first attempt, and hands the
// same answer to every turn of the stage, its form repairs included.

import { config } from "../driver.config.mjs";
import { buildGatherMcpConfig, allowedToolsFor, toolGroupsForStage, recordAxisFor, seatWritesForGroups } from "../engine/mcp/gather-config.mjs";
import { GROUP_READING_STAGES } from "../stages.mjs";
import { recordedRegister } from "../engine/run-choices.mjs";

export function stageTools({ engine, name, sessionKey, agent, runDir, correction, excludeTools }) {
  // Two INDEPENDENT engine capability flags (both default ON for an engine that declares neither, so the
  // anthropic engine — which sets neither — behaves exactly as before). A future adapter can opt out of
  // either without the other:
  let gatherMcpConfig, gatherAllowedTools, engineSkillsDir, engineSkillsGrantRoots, engineResolveSkill;
  // — the DECLARATION half of the run-dir read grant. `null` means this stage has no recording
  // row to declare anything, and the adapter treats unknown as "keep the grant" — so a stage the
  // gateway says nothing about is unaffected by that change.
  let gatherSeatWrites = null;
  // (a) Skills plumbing (usesSkillsDir): a CLI-agentic engine resolves the stage prompts' `skills/…` refs
  // against its neutral cwd (a tmpdir) and confines file tools to cwd + --add-dir roots, so hand it the
  // compute-skills dir (config.skillsDir — the driver-co-located tree) + this run's dir so it can absolutize
  // the refs and grant read(skills)/write(runDir). The agent's own workspace is no longer involved.
  if (engine.usesSkillsDir !== false) {
    engineSkillsDir = config.skillsDir;
    engineSkillsGrantRoots = config.skillsGrantRoots;   // layered skills: BOTH roots reach the seat, resolve overlay-first
    engineResolveSkill = (rel) => config.resolveSkillPath(rel);
  }
  // (b) Gather tools (usesGatherMcp): a gather stage gets its tool group's MCP servers + allowedTools;
  // tool-free judgment stages get none (lean context). Both current engines get the SAME claude-shaped
  // mcpConfig; a codex engine translates it to config.toml internally, so gather-config.mjs is untouched.
  if (engine.usesGatherMcp !== false) {
    const groups = toolGroupsForStage(name);
    if (groups.length) {
      // The bound card index rides the same label the grant was resolved from — derived by the SAME
      // declared rule (`perAxis`), never by a second string-sniff that could disagree with it.
      // The register the run recorded names the register tool server and the tools it grants; none recorded, the machine's.
      const register = recordedRegister(runDir);
      const cfg = buildGatherMcpConfig(groups, { sessionKey, agent, runDir, recordAxis: recordAxisFor(name)?.axis,
        bandGroups: GROUP_READING_STAGES.has(name), correctionPositions: correction?.positions ?? null, register });
      gatherMcpConfig = cfg ? JSON.stringify(cfg) : undefined;
      gatherAllowedTools = allowedToolsFor(groups, { register });
      gatherSeatWrites = seatWritesForGroups(groups);   // — the SAME derivation allowedToolsFor uses
      // Per-stage exclusion (copper-lattice re-route): a supplemental-lane register unit loses
      // register_enumerate — its judgment additions go through register_propose_supplemental, so the
      // free-enumerate hand-transcription lane cannot silently return. Group-level removal is
      // infeasible (synthesis + legacy no-plan units share the group); the validator is the backstop.
      if (Array.isArray(excludeTools) && excludeTools.length && gatherAllowedTools) {
        const drop = new Set(excludeTools);
        gatherAllowedTools = gatherAllowedTools.split(" ").filter((t) => !drop.has(t)).join(" ");
      }
    }
  }
  return { gatherMcpConfig, gatherAllowedTools, gatherSeatWrites, engineSkillsDir, engineSkillsGrantRoots, engineResolveSkill };
}
