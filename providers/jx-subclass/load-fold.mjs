// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// load-fold.mjs — build the match index. Idempotent; safe to re-run after any goods change.
import { DatabaseSync } from "node:sqlite";
import { foldZh, GOODS_FOLD_DDL } from "./terms.mjs";

const db = new DatabaseSync("similar-groups.db");
db.exec(GOODS_FOLD_DDL);
db.exec("DELETE FROM goods_fold");
const ins = db.prepare("INSERT OR IGNORE INTO goods_fold VALUES (?,?)");
let n = 0, skipped = 0;
db.exec("BEGIN");
for (const g of db.prepare("SELECT basic_no, name_zh_tw, name_en FROM goods").all()) {
  // Index every name the office gives us, folded. A good with several names gets several rows — the
  // index is for finding, so more doors in is strictly better as long as none of them invents a name.
  for (const name of [g.name_zh_tw]) {
    const f = foldZh(name);
    if (f) { ins.run(g.basic_no, f); n++; } else skipped++;
  }
}
db.exec("COMMIT");
console.log(`goods_fold rows ${n} | goods with no zh name to fold ${skipped}`);
