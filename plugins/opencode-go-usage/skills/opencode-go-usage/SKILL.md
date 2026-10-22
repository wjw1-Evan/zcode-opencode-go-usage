---
name: opencode-go-usage
description: Show the OpenCode GO subscription quota and open the usage dashboard. Use when the user asks about OpenCode GO usage, quota, limits, remaining plan usage, rolling 5-hour / weekly / monthly windows, or when a reset happens.
---

# OpenCode GO Usage

The plugin exposes one MCP tool and one dashboard resource:

- `opencode_go_usage` (server `opencode-go-usage`) returns the current quota for the rolling 5-hour, weekly and monthly windows, plus reset times, cache state, update availability and session-header diagnostics. Calling it from the model renders the usage card inline in the conversation; the card has "固定显示 / Keep expanded" and "在侧栏打开 / Open in side pane" actions.
- The dashboard resource (`ui://opencode-go-usage/dashboard.html`) renders the same data as three usage bars with time-elapsed bars, reset countdowns and a refresh button. It is also available as a side-pane panel.

## How to answer

1. Call `opencode_go_usage`. Pass `refresh: true` only when the user explicitly asks for fresh data; otherwise the server's 30-second cache is fine.
2. Pass `lang: "en"` for English-speaking users; omit it for Chinese (default).
3. Print the tool's text content as-is. If the user asks for an interpretation, explain that the lower bar in each row is the window clock: gray = elapsed, blue = remaining, so a usage bar above the clock means the plan is being consumed faster than time is passing.
4. Mention the dashboard panel once when it is useful ("可在插件面板中查看同样的进度条"), but do not repeat it every time.

## Rules

- Never print, echo or ask for the API key. The server reads it from the plugin config, `OPENCODE_GO_API_KEY`, or the ZCode OpenCode Go provider entry, and never returns it.
- Do not try to fetch `https://opencode.ai/zen/go/v1/usage` yourself; the server owns the request, cache and error mapping.
- ZCode already injects the `x-opencode-session` header for OpenCode Go chat requests. Do not patch host files; the tool reports the host-managed status under `sessionHeader`.

## Failures

- "未配置 API key" / "no API key": the user has no OpenCode GO key in the plugin settings and no `opencode-go-*` provider in ZCode. Ask them to add the key at <https://opencode.ai/auth>, then either fill **设置 → 插件 → OpenCode GO 用量 → API key** or configure the OpenCode Go provider.
- `gateway 401/403`: the key is invalid or the subscription lapsed.
- `gateway 5xx` or a timeout: the gateway is temporarily unavailable; retry later.
