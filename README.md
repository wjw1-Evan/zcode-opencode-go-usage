# zcode-opencode-go-usage

A [ZCode](https://zcode.z.ai) plugin that shows your **OpenCode GO** subscription quota: rolling 5-hour, weekly and monthly usage bars with reset countdowns and a time-elapsed bar under each row, plus an `/opencode-go` command.

This is a ZCode port of the DSH plugin [Astervolans/dsh-opencode-go-usage](https://github.com/Astervolans/dsh-opencode-go-usage) (itself a fork of [yumusb/dsh-opencode-go-usage](https://github.com/yumusb/dsh-opencode-go-usage)). The settings, HTTP routes and command behavior are adapted to ZCode's plugin model.

中文文档：[plugins/opencode-go-usage/README.md](plugins/opencode-go-usage/README.md)

## Features

- **Usage panel** — an MCP App panel with three rows: rolling 5h, weekly, monthly. Each row has a quota bar, a reset countdown, and a time bar underneath.
- **Time bars** — gray on the left is time already elapsed (grows rightward), blue on the right is time remaining (shrinks leftward). Both bars are 5px high with 3px radii, matching the upstream widget exactly. Hover for the elapsed/remaining percentages.
- **Compact badge** — when the panel is narrower than 230px, it collapses to the monthly percentage badge.
- **`/opencode-go` command** — prints the same numbers as text in any conversation.
- **Key never reaches the UI** — the MCP stdio server resolves the key from the plugin config, `OPENCODE_GO_API_KEY`, or ZCode's own OpenCode Go provider entry, calls the gateway, and returns only the usage data. The dashboard calls a tool; it never sees the key or talks to the gateway.
- **30s cache** — one in-flight request and a host-side TTL; the refresh button bypasses it.
- **Update hint** — compares the installed version with the local ZCode marketplace catalog (works for GitHub marketplaces too) and shows a badge when a newer version exists. It never self-upgrades.
- **`x-opencode-session` diagnostics** — ZCode already injects this header for `https://opencode.ai/zen/go/v1` chat requests, so the DSH fetch patch is unnecessary. The tool reports the host-managed state under `sessionHeader`.
- **Bilingual UI** — follows the host locale; the tool accepts `lang: "zh" | "en"`.

## Install

### From the ZCode plugin marketplace

1. Open **Plugin Marketplace → Add → Add Plugin Marketplace**.
2. Enter `wjw1-Evan/zcode-opencode-go-usage` (or the full URL `https://github.com/wjw1-Evan/zcode-opencode-go-usage`).
3. Open **Personal → zcode-opencode-go-usage → OpenCode GO Usage** and click **Install**.
4. Confirm the plugin is enabled under **Settings → Plugins**. An API key is normally not required: the plugin reads the key from your existing OpenCode Go provider entry.

### CLI

```bash
zcode plugins marketplace add wjw1-Evan/zcode-opencode-go-usage
zcode plugins install opencode-go-usage@zcode-opencode-go-usage
```

Requires Node.js 18+. The launcher searches `node`, Homebrew, `/usr/local`, Volta and nvm paths, then falls back to ZCode Desktop's bundled Electron helper.

## Usage

- **Panel** — open **OpenCode GO Usage** from the plugin panels. The upper bar in each row is quota used; the lower bar is the window clock. Gray = elapsed, blue = remaining. When the usage bar is above the clock, you are burning quota faster than time.
- **Command** — type `/opencode-go` in any conversation. Add `refresh` to bypass the cache, e.g. `/opencode-go refresh`.
- **Tool** — `opencode_go_usage` with optional `refresh: boolean` and `lang: "zh" | "en"`.

## Configuration

| Key | Default | Description |
| --- | --- | --- |
| `api_key` | empty (sensitive) | OpenCode GO API key (`sk-...`, create one at <https://opencode.ai/auth>). When empty, the plugin reads the key from ZCode's `opencode-go-chat` / `opencode-go-messages` / `opencode-go-responses` provider entry. |
| `base_url` | `https://opencode.ai/zen/go` | Gateway base URL. A trailing `/v1` is accepted and normalized. |
| `cache_ms` | `30000` | Host-side cache TTL in milliseconds. Set to `0` to disable caching. |
| `update_check` | `true` | Check the local marketplace for a newer version (hint only). |
| `marketplace_path` | empty | Optional marketplace directory or `marketplace.json` path. When empty, the plugin auto-detects the source from `.zcode-plugin-seed.json` and the marketplace cache. |

Advanced environment variables: `OPENCODE_GO_API_KEY`, `OPENCODE_GO_BASE_URL`, `OPENCODE_GO_CACHE_MS`, `OPENCODE_GO_UPDATE_CHECK`, `OPENCODE_GO_MARKETPLACE_PATH`, `OPENCODE_GO_UPDATE_URL`, `ZCODE_NODE`.

## How it works

The plugin has two halves:

| Part | File | Role |
| --- | --- | --- |
| MCP server (Node) | `plugins/opencode-go-usage/src/server.mjs` → `dist/server.mjs` | Resolves the key, calls `GET https://opencode.ai/zen/go/v1/usage`, caches for 30s, checks for updates, registers the tool and the dashboard resource. |
| Dashboard (browser) | `plugins/opencode-go-usage/src/ui/main.js` → `dist/dashboard.html` | MCP App page. Loads usage through the tool, polls every 60s, ticks the time bars every 30s, follows host theme and locale. |

The API response shape:

```json
{
  "usage": {
    "rolling": { "status": "ok", "percent": 22, "resetsAt": "2026-10-21T20:18:17Z" },
    "weekly":  { "status": "ok", "percent": 88, "resetsAt": "2026-10-26T00:00:00Z" },
    "monthly": { "status": "ok", "percent": 82, "resetsAt": "2026-11-09T01:19:09Z" }
  }
}
```

Window lengths are `rolling = 5h`, `weekly = 7d`, `monthly = 30d`. The monthly window is anchored to the subscription day-of-month, so 30 days is an approximation; the elapsed fraction is clamped to `[0, 1]`.

## Security

- The API key exists only in the MCP server process. The dashboard HTML and the structured tool result never contain it.
- Tool results expose only `keySource` (`env` / `zcode-provider-config` / `none`) and the gateway URL.
- The plugin does not patch ZCode host files. `x-opencode-session` is injected by ZCode itself.
- Gateway errors echo at most 300 bytes of the response body.

## Development

Source lives in `plugins/opencode-go-usage/src/`. Build dependencies are isolated in `build/`:

```bash
cd build
npm install
node build.mjs
```

This produces `dist/server.mjs`, `dist/dashboard.html`, `dist/launch.sh`, and regenerates `THIRD_PARTY_NOTICES.txt` from the packages actually bundled.

## License and acknowledgements

MIT. The feature set and visual design come from [Astervolans/dsh-opencode-go-usage](https://github.com/Astervolans/dsh-opencode-go-usage) (upstream [yumusb/dsh-opencode-go-usage](https://github.com/yumusb/dsh-opencode-go-usage)). The ZCode adaptation is new code. Bundled third-party licenses are in [plugins/opencode-go-usage/THIRD_PARTY_NOTICES.txt](plugins/opencode-go-usage/THIRD_PARTY_NOTICES.txt).
