// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
// Re-export shim → the canonical HMAC token-minting/authorization lives in shared/scope.mjs,
// shared by both faces (the report's render.mjs mints per-run `user` tokens; this server verifies them).
export * from "../../shared/scope.mjs";
