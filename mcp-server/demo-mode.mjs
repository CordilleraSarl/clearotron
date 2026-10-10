// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 Cordillera Sàrl. Additional terms under section 7 of the AGPL-3.0 apply — see ADDITIONAL-TERMS.md
//
// demo-mode.mjs — whether this server is serving the demo's sample runs.
//
// `clearotron mcp` decides it and the server reads it, in one process: bin/mcp.mjs sets it before it
// loads the server, and the server reads it as it answers. It is a module and not an environment
// variable because nothing outside this process sets it or reads it, and every environment variable the
// product reads is a setting an operator is told about.
export const demoMode = { on: false };
