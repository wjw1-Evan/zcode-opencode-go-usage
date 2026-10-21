---
description: 显示 OpenCode GO 订阅用量（5 小时滚动 / 周 / 月）
argument-hint: "[refresh]"
---

Use the `opencode_go_usage` tool from the `opencode-go-usage` MCP server to read the current OpenCode GO quota.

- If `$ARGUMENTS` contains `refresh`, or the user asks for fresh data, pass `refresh: true`.
- Pass `lang: "en"` when the user is writing in English; otherwise omit it (the tool defaults to Chinese).
- Print the tool's text content verbatim, keeping its line breaks and numbers. Do not reformat the bars or add a second summary.
- If the tool returns an error, show the error text and the likely fix (missing or invalid OpenCode GO API key, or the subscription has lapsed).
