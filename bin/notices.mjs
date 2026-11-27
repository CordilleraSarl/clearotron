#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// clearotron notices list | received <id> | absent <id> — the failure notices that still wait, and the receiver's answer
// for one. It reads this install's settings exactly as `clearotron status` does (installNoticeSettings), so the notice
// status names is the one this command lists and answers. Every answer is the lines status prints for what still waits,
// in their approved words, and nothing of the record: no field, recorded reason or code. An answer the record does not
// take exits 4; a command that is not one of the three exits 2 with the usage alone.
import "../shared/env-local.mjs";
import { isEntrypoint } from "../shared/is-entrypoint.mjs";

export async function main(argv = process.argv.slice(2)) {
  const { installNoticeSettings, undeliveredNotices, reconcileNotice, noticeStatusLines } = await import("../driver/notice-delivery.mjs");
  const { invoke } = await import("../shared/invocation.mjs");
  const env = installNoticeSettings();
  const [verb, id] = argv;
  const waiting = () => {
    const lines = noticeStatusLines(undeliveredNotices({ env }), invoke("notices"));
    if (lines.length) process.stdout.write(lines.join("\n") + "\n");
  };
  if (verb === "list" && !id) { waiting(); return 0; }
  if ((verb === "received" || verb === "absent") && id) {
    const r = reconcileNotice(id, verb);
    waiting();
    return r.ok ? 0 : 4;
  }
  process.stderr.write(`${invoke("notices")} list | received <id> | absent <id>\n`);
  return 2;
}

if (isEntrypoint(import.meta.url)) process.exitCode = await main();
