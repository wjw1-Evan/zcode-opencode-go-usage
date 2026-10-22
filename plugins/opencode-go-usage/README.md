<p align="center"><img src="assets/icon-512.png" width="96" height="96" alt="OpenCode GO Usage icon"></p>

# OpenCode GO Usage（ZCode 插件）

在 ZCode 中查看 **OpenCode GO** 订阅用量：5 小时滚动窗口、周窗口、月窗口三条进度条，带重置倒计时和“时间进度”条，并提供 `/opencode-go` 命令。

这是 DSH 插件 [Astervolans/dsh-opencode-go-usage](https://github.com/Astervolans/dsh-opencode-go-usage) 的 ZCode 移植版，功能逐项对应。

## 功能对照

| 上游 DSH 功能 | 本 ZCode 插件 |
| --- | --- |
| 侧边栏用量组件（滚动 / 周 / 月三条进度条 + 重置倒计时） | 工具调用后直接在对话中显示内联卡片，可“固定显示”或“在侧栏打开”；也保留 `ui.surfaces` 侧栏面板。面板宽度小于 230px 时收缩为月用量百分比徽标 |
| 每条用量条下方的时间条（左侧灰色 = 已流逝，右侧蓝色 = 剩余，两者都 5px 高 / 3px 圆角，悬停显示百分比） | 完全一致，颜色 `#5686fe`、几何尺寸与上游相同 |
| `/opencode-go` 聊天命令 | `commands/opencode-go.md`，调用 MCP 工具并原样输出文本 |
| 同源代理 `GET /opencode-go/usage`，浏览器拿不到 API key | MCP stdio 服务器持有 key，面板只通过 `opencode_go_usage` 工具取数；key 不进入页面 |
| 30 秒宿主缓存 + 单飞请求 | 相同；刷新按钮传 `refresh: true` 绕过缓存 |
| 配置 `apiKeyEnv` / `baseUrl` / `cacheMs` / `updateCheck` / `injectSessionHeader` | ZCode `userConfig`：`api_key` / `base_url` / `cache_ms` / `update_check` / `marketplace_path`，见下表 |
| `x-opencode-session` 运行时修复 | **ZCode 已内置**：宿主只对 `https://opencode.ai/zen/go/v1` 请求注入该头。插件不再包装 `fetch`，而是在工具结果的 `sessionHeader` 中报告宿主状态 |
| npm 新版本提示 | 读取本地 ZCode 插件市场目录（自动探测或手动配置），有新版时显示徽标；也可用 `OPENCODE_GO_UPDATE_URL` 指向任意 `{version}` JSON |

## 安装

### 从 GitHub 市场（推荐）

1. 打开 **插件市场 → 添加 → 添加插件市场**，输入 `wjw1-Evan/zcode-opencode-go-usage`（或完整地址 `https://github.com/wjw1-Evan/zcode-opencode-go-usage`）。
2. 在 **个人 → zcode-opencode-go-usage** 中找到 **OpenCode GO Usage**，点击 **安装**。
3. 安装后在 **设置 → 插件 → OpenCode GO 用量** 中确认已启用。通常无需填写 API key：插件会自动读取 ZCode 中已配置的 OpenCode Go 供应商密钥。

也可以使用 CLI：

```bash
zcode plugins marketplace add wjw1-Evan/zcode-opencode-go-usage
zcode plugins install opencode-go-usage@zcode-opencode-go-usage
```

### 从本地目录

1. 打开 **插件市场 → 添加 → 添加插件市场**。
2. 粘贴本仓库根目录（包含 `.claude-plugin/marketplace.json`）。
3. 在 **个人 → zcode-opencode-go-usage** 中安装 **OpenCode GO Usage**。

需要 Node.js 18+。启动脚本会依次查找 `node`、Homebrew / `/usr/local` / Volta / nvm 路径，最后回退到 ZCode Desktop 自带的 Electron 辅助进程。

## 使用

- **内联卡片**：执行 `/opencode-go` 或让 agent 调用工具后，用量卡片会直接在对话中展开。卡片右上角可以 **固定显示**（保持展开）或 **在侧栏打开**。这是默认显示方式，不需要先打开面板。
- **侧栏面板**：也可以在插件面板列表中打开 **OpenCode GO 用量**，面板会保持打开。三条进度条的上方是额度使用率，下方是窗口时间进度：
  - 灰色（左）= 本窗口已流逝时间，向右增长；
  - 蓝色（右）= 剩余时间，向左收缩；
  - 额度条高于时间条 = 消耗快于时间，低于 = 慢于时间。
  - 鼠标悬停时间条可看到“已流逝 / 剩余”百分比。
  - 面板很窄时显示 `82%` 这样的月用量徽标，悬停显示完整标题。
- **命令**：在任意会话输入 `/opencode-go`。加 `refresh` 参数可强制刷新，例如 `/opencode-go refresh`。
- **工具**：`opencode_go_usage`，参数：
  - `refresh?: boolean` — 绕过 30 秒缓存；
  - `lang?: "zh" | "en"` — 文本摘要语言，默认中文。

## 配置

在 **设置 → 插件 → OpenCode GO 用量** 中修改；也可以直接改插件市场的安装配置。

| 键 | 默认值 | 说明 |
| --- | --- | --- |
| `api_key` | 空（敏感） | OpenCode GO API key（`sk-...`，在 <https://opencode.ai/auth> 创建）。留空时自动读取 ZCode 的 `opencode-go-chat` / `opencode-go-messages` / `opencode-go-responses` 供应商条目。 |
| `base_url` | `https://opencode.ai/zen/go` | 网关地址。以 `/v1` 结尾也可以，插件会规范化。 |
| `cache_ms` | `30000` | 宿主侧缓存时间（毫秒）。设为 `0` 可禁用缓存。 |
| `update_check` | `true` | 是否检查本地市场中的新版本（只提示，不自动升级）。 |
| `marketplace_path` | 空 | 可选：市场目录或 `marketplace.json` 路径。留空时根据已安装插件的 `.zcode-plugin-seed.json` 自动探测。 |

高级环境变量（一般不用改）：`OPENCODE_GO_API_KEY`、`OPENCODE_GO_BASE_URL`、`OPENCODE_GO_CACHE_MS`、`OPENCODE_GO_UPDATE_CHECK`、`OPENCODE_GO_MARKETPLACE_PATH`、`OPENCODE_GO_UPDATE_URL`、`ZCODE_NODE`（指定 Node 可执行文件）。

## 工作原理

插件包含两半：

| 部分 | 文件 | 职责 |
| --- | --- | --- |
| MCP 服务器（Node） | `src/server.mjs` → `dist/server.mjs` | 发现 key、请求网关、30 秒缓存、更新检查、注册工具与面板资源 |
| 面板（浏览器） | `src/ui/main.js` → `dist/dashboard.html` | MCP App 页面；启动时调用工具、每 60 秒轮询、每 30 秒刷新时间条、响应宿主主题/语言变化 |

用量接口（官方网关）：

```http
GET https://opencode.ai/zen/go/v1/usage
Authorization: Bearer <key>
```

返回：

```json
{
  "usage": {
    "rolling": { "status": "ok", "percent": 22, "resetsAt": "2026-10-21T20:18:17Z" },
    "weekly":  { "status": "ok", "percent": 88, "resetsAt": "2026-10-26T00:00:00Z" },
    "monthly": { "status": "ok", "percent": 82, "resetsAt": "2026-11-09T01:19:09Z" }
  }
}
```

窗口长度按 `rolling = 5h`、`weekly = 7d`、`monthly = 30d` 计算时间进度。月窗口真实长度会随订阅日在 28–31 天之间变化，所以 30 天是近似值；结果被限制在 `[0, 1]`，窗口边界仍然准确，月中误差最多约 3%。

### 关于 `x-opencode-session`

上游 DSH 插件需要包装 `globalThis.fetch`，因为 DSH 的 `llm-pi-ai` 适配器不发送 `x-opencode-session`，而网关会对缺失该头的聊天请求返回 400。ZCode 的宿主已经对 `opencode.ai/zen/go/v1` 请求自动注入该头，因此本插件不需要（也无法从 MCP 进程）修改宿主的网络层。工具结果的 `sessionHeader` 字段会报告：

```json
{
  "active": true,
  "injectedBy": "zcode-host",
  "provider": "opencode-go-chat",
  "base": "https://opencode.ai/zen/go/v1"
}
```

### 更新检查

服务器读取自己的 `.zcode-plugin/plugin.json` 当前版本，然后：

1. 若配置了 `OPENCODE_GO_UPDATE_URL`，请求该 JSON，读取 `version` 或 `latest`；
2. 否则读取本地市场的 `marketplace.json`（先用手动配置的 `marketplace_path`，再用 `.zcode-plugin-seed.json` + `~/.zcode/cli/plugins/known_marketplaces.json` 自动定位），找到 `opencode-go-usage` 条目并比较版本。

检查结果缓存 24 小时，失败静默。发现新版本时面板显示徽标，命令文本末尾追加提示；插件不会自动升级。

## 安全

- API key 只存在于 MCP 服务器进程内；面板 HTML 和工具结构化结果中都不包含 key。
- 工具结果只暴露 `keySource`（`env` / `zcode-provider-config` / `none`）和网关地址。
- 不会读取或改写 ZCode 的宿主文件；`x-opencode-session` 由宿主处理。
- 网关错误只回显状态码和最多 300 字节的响应体。

## 故障排查

| 现象 | 处理 |
| --- | --- |
| 面板显示“未配置 API key” | 在设置中填写 `api_key`，或在 ZCode 中配置 OpenCode Go 供应商；也可设置 `OPENCODE_GO_API_KEY`。 |
| `gateway 401/403` | key 无效、订阅过期或复制时带了空格。 |
| `gateway 5xx` / 超时 | 网关临时故障，稍后重试。 |
| 面板空白 / 加载中 | 查看 **设置 → 插件** 中 MCP 服务器 `usage` 是否启动；确认 Node 18+ 可用。 |
| 更新徽标不出现 | 确认 `update_check` 为 `true`，并先刷新插件市场；本地开发市场安装后才有 `.zcode-plugin-seed.json`。 |
| `/opencode-go` 没反应 | 确认命令插件已启用；命令会调用 `opencode_go_usage` 工具，检查工具列表中是否存在该工具。 |

## 开发 / 构建

源码在 `plugins/opencode-go-usage/src/`。构建依赖与产物分离：

```bash
cd build
npm install
node build.mjs
```

构建会生成：

- `plugins/opencode-go-usage/dist/server.mjs`（SDK + 服务器打包，含 `createRequire` banner）
- `plugins/opencode-go-usage/dist/dashboard.html`（面板脚本与样式内联）
- `plugins/opencode-go-usage/dist/launch.sh`（Node 启动器）

修改 `src/` 后重新运行构建，并在插件市场中刷新、更新已安装副本。`build/node_modules` 不随插件分发。

## 许可与来源

MIT。功能与视觉设计来自 [Astervolans/dsh-opencode-go-usage](https://github.com/Astervolans/dsh-opencode-go-usage)（上游 [yumusb/dsh-opencode-go-usage](https://github.com/yumusb/dsh-opencode-go-usage)）。ZCode 适配部分为新增实现。
