// opencode-go-usage — ZCode MCP half.
//
// Watches the OpenCode GO plan quota through the official gateway endpoint
// (`https://opencode.ai/zen/go/v1/usage`). The API key stays in this process:
// the dashboard UI only calls the `opencode_go_usage` tool, never the gateway.
//
// Feature parity with the DSH plugin:
//   - rolling 5h / weekly / monthly quota + reset times
//   - host-side cache with a single in-flight request
//   - /opencode-go command (commands/opencode-go.md) + dashboard panel
//   - update check against the local ZCode marketplace catalog
//   - x-opencode-session diagnostics (ZCode injects the header itself)
//
// Nothing may be written to stdout: it is the JSON-RPC channel.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const PLUGIN_NAME = "opencode-go-usage";
const PLUGIN_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const UI_URI = "ui://opencode-go-usage/dashboard.html";
const DEFAULT_BASE_URL = "https://opencode.ai/zen/go";
const DEFAULT_CACHE_MS = 30_000;
const UPDATE_CHECK_INTERVAL_MS = 24 * 3600_000;
const FETCH_TIMEOUT_MS = 15_000;

const CURRENT_VERSION = readCurrentVersion();

function readCurrentVersion() {
  const manifest = readJson(join(PLUGIN_ROOT, ".zcode-plugin", "plugin.json"));
  return typeof manifest?.version === "string" ? manifest.version : "0.0.0";
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function readText(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function zcodeHome() {
  const fromEnv = process.env.ZCODE_HOME?.trim();
  return fromEnv ? fromEnv : join(homedir(), ".zcode");
}

// ── settings ───────────────────────────────────────────────────────────────

function parseNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function parseBoolean(value, fallback) {
  if (value === undefined || value === null || String(value).trim() === "") return fallback;
  return !/^(0|false|no|off)$/i.test(String(value).trim());
}

function normalizeUsageBase(value) {
  let base = String(value ?? "").trim();
  if (!base) return "";
  base = base.replace(/\/+$/, "");
  base = base.replace(/\/v1$/i, "");
  return base;
}

function usageEndpoint(base) {
  return `${normalizeUsageBase(base) || DEFAULT_BASE_URL}/v1/usage`;
}

/**
 * Find the OpenCode GO API key stored by ZCode's provider settings.
 *
 * ZCode keeps provider entries in `<home>/v2/provider_config.json` under
 * `config.providerConfigRules.providerRules[]`. OpenCode Go ships as three
 * templates (chat / anthropic / responses); any of them carries the same
 * subscription key. We prefer the provider that appears first in
 * `config.providerOrder`, matching the account the user actually selected.
 */
function findProvider() {
  const files = [
    join(zcodeHome(), "v2", "provider_config.json"),
    join(homedir(), ".zcode", "v2", "provider_config.json"),
    join(zcodeHome(), "provider_config.json")
  ];
  const seen = new Set();
  for (const file of files) {
    if (seen.has(file)) continue;
    seen.add(file);
    const json = readJson(file);
    if (json === null) continue;
    const config = json?.config ?? json;
    const rules = config?.providerConfigRules?.providerRules;
    if (!Array.isArray(rules)) continue;
    const order = Array.isArray(config?.providerOrder) ? config.providerOrder : [];
    const rank = (rule) => {
      const id = rule?.providerId ?? rule?.templateId ?? "";
      const index = order.indexOf(id);
      return index === -1 ? Number.MAX_SAFE_INTEGER : index;
    };
    const matches = rules
      .filter((rule) => isOpenCodeGoRule(rule))
      .sort((a, b) => rank(a) - rank(b));
    for (const rule of matches) {
      const key =
        rule?.config?.access?.apiKey ??
        rule?.config?.apiKey ??
        rule?.apiKey;
      if (typeof key !== "string" || key.trim() === "") continue;
      const apiBase =
        rule?.config?.api?.baseUrl ??
        rule?.config?.baseUrl ??
        null;
      return {
        apiKey: key.trim(),
        providerId: rule?.providerId ?? rule?.templateId ?? null,
        baseUrl: typeof apiBase === "string" && apiBase.trim() ? apiBase.trim() : null,
        configPath: file
      };
    }
  }
  return null;
}

function isOpenCodeGoRule(rule) {
  if (!rule || typeof rule !== "object") return false;
  const identity = [rule.providerId, rule.templateId, rule.providerName]
    .filter((value) => typeof value === "string")
    .join(" ");
  return /opencode[-_ ]?go/i.test(identity);
}

function loadSettings() {
  const provider = findProvider();
  const envKey = (process.env.OPENCODE_GO_API_KEY ?? "").trim();
  const apiKey = envKey || provider?.apiKey || "";
  const keySource = envKey ? "env" : provider?.apiKey ? "zcode-provider-config" : "none";

  const envBase = (process.env.OPENCODE_GO_BASE_URL ?? "").trim();
  const baseUrl = normalizeUsageBase(envBase || provider?.baseUrl || DEFAULT_BASE_URL) || DEFAULT_BASE_URL;

  return {
    apiKey,
    keySource,
    baseUrl,
    providerBase: provider?.baseUrl ?? null,
    providerId: provider?.providerId ?? null,
    cacheMs: parseNumber(process.env.OPENCODE_GO_CACHE_MS, DEFAULT_CACHE_MS),
    updateCheck: parseBoolean(process.env.OPENCODE_GO_UPDATE_CHECK, true),
    marketplacePath: (process.env.OPENCODE_GO_MARKETPLACE_PATH ?? "").trim(),
    updateUrl: (process.env.OPENCODE_GO_UPDATE_URL ?? "").trim()
  };
}

// ── usage fetch + cache ────────────────────────────────────────────────────

/** @type {{ at: number, promise: Promise<any> } | null} */
let quotaCache = null;

async function fetchUsage(settings, lang) {
  if (!settings.apiKey) {
    throw new Error(
      lang === "en"
        ? "OpenCode GO: no API key (set it in Settings → Plugins, or configure an OpenCode Go provider in ZCode)"
        : "OpenCode GO: 未配置 API key（请在 设置 → 插件 中填写，或在 ZCode 中配置 OpenCode Go 供应商）"
    );
  }
  let response;
  try {
    response = await fetch(usageEndpoint(settings.baseUrl), {
      headers: {
        Authorization: `Bearer ${settings.apiKey}`,
        Accept: "application/json",
        "User-Agent": `zcode-opencode-go-usage/${CURRENT_VERSION}`
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    });
  } catch (error) {
    const timeout = error?.name === "TimeoutError" || error?.name === "AbortError";
    const cause = error?.cause?.message || error?.cause?.code;
    const detail = timeout
      ? `gateway request timed out after ${FETCH_TIMEOUT_MS / 1000}s`
      : cause
        ? `${error?.message || "fetch failed"}: ${cause}`
        : error?.message || String(error);
    throw new Error(detail);
  }
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`gateway ${response.status}: ${body.slice(0, 300) || response.statusText}`);
  }
  return await response.json();
}

async function getUsage(settings, lang, force) {
  const now = Date.now();
  if (!force && quotaCache !== null && now - quotaCache.at < settings.cacheMs) {
    return { data: await quotaCache.promise, cached: true };
  }
  const promise = fetchUsage(settings, lang);
  quotaCache = { at: now, promise };
  promise.catch(() => {
    if (quotaCache?.promise === promise) quotaCache = null;
  });
  return { data: await promise, cached: false };
}

// ── update check ───────────────────────────────────────────────────────────

/** @type {{ at: number, latest: string | null } | null} */
let updateState = null;
/** @type {Promise<void> | null} */
let updateInFlight = null;

function isNewer(a, b) {
  const pa = String(a).split("-")[0].split(".").map(Number);
  const pb = String(b).split("-")[0].split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const na = Number.isFinite(pa[i]) ? pa[i] : 0;
    const nb = Number.isFinite(pb[i]) ? pb[i] : 0;
    if (na !== nb) return na > nb;
  }
  return false;
}

/**
 * The installer normally writes `.zcode-plugin-seed.json`, but URL-based
 * marketplaces may omit it. The installed-plugin registry always records the
 * marketplace id, so it is the fallback for update checks.
 */
function installedMarketplaceId() {
  const root = PLUGIN_ROOT.replace(/\/+$/, "");
  for (const file of [
    join(zcodeHome(), "cli", "plugins", "installed_plugins.json"),
    join(zcodeHome(), "plugins", "installed_plugins.json")
  ]) {
    const json = readJson(file);
    const plugins = Array.isArray(json?.plugins) ? json.plugins : [];
    const matches = plugins.filter((entry) => entry && entry.name === PLUGIN_NAME);
    if (matches.length === 0) continue;
    const exact = matches.find(
      (entry) =>
        typeof entry.installPath === "string" &&
        entry.installPath.replace(/\/+$/, "") === root
    );
    const chosen = exact ?? matches[0];
    if (typeof chosen.marketplace === "string" && chosen.marketplace) return chosen.marketplace;
  }
  return null;
}

function detectMarketplaceId() {
  const seed = readJson(join(PLUGIN_ROOT, ".zcode-plugin-seed.json"));
  return (
    (typeof seed?.marketplace === "string" ? seed.marketplace : null) ?? installedMarketplaceId()
  );
}

function knownMarketplaceSource(id) {
  for (const known of [
    join(zcodeHome(), "cli", "plugins", "known_marketplaces.json"),
    join(zcodeHome(), "plugins", "known_marketplaces.json")
  ]) {
    const json = readJson(known);
    const entries = Array.isArray(json?.marketplaces) ? json.marketplaces : [];
    const entry = entries.find((item) => item?.id === id);
    if (entry?.source && typeof entry.source === "object") return entry.source;
  }
  return null;
}

function marketplaceFiles(settings) {
  const files = [];
  const add = (value) => {
    if (!value) return;
    if (!files.includes(value)) files.push(value);
  };
  if (settings.marketplacePath) {
    if (settings.marketplacePath.endsWith(".json")) {
      add(resolve(settings.marketplacePath));
    } else {
      const dir = resolve(settings.marketplacePath);
      add(join(dir, "marketplace.json"));
      add(join(dir, ".claude-plugin", "marketplace.json"));
    }
  }
  // Auto-detect the marketplace this installed copy came from.
  const marketplaceId = detectMarketplaceId();
  if (marketplaceId) {
    // ZCode caches the resolved catalog for every source type (including a
    // GitHub marketplace) under this directory. It is the most reliable
    // offline source for the update check.
    for (const cacheRoot of [
      join(zcodeHome(), "cli", "plugins", "marketplaces", marketplaceId),
      join(zcodeHome(), "plugins", "marketplaces", marketplaceId)
    ]) {
      add(join(cacheRoot, "marketplace.json"));
      add(join(cacheRoot, ".claude-plugin", "marketplace.json"));
    }
    for (const known of [
      join(zcodeHome(), "cli", "plugins", "known_marketplaces.json"),
      join(zcodeHome(), "plugins", "known_marketplaces.json")
    ]) {
      const json = readJson(known);
      const entries = Array.isArray(json?.marketplaces) ? json.marketplaces : [];
      const entry = entries.find((item) => item?.id === marketplaceId);
      const source = entry?.source;
      if (typeof source?.path === "string" && source.path) {
        if (source.source === "file" || source.path.endsWith(".json")) add(resolve(source.path));
        else {
          const dir = resolve(source.path);
          add(join(dir, "marketplace.json"));
          add(join(dir, ".claude-plugin", "marketplace.json"));
        }
      }
    }
  }
  return files;
}

function versionFromManifest(json, baseDir) {
  if (!json || !Array.isArray(json.plugins)) return null;
  const entry = json.plugins.find((item) => item?.name === PLUGIN_NAME);
  if (!entry) return null;
  if (typeof entry.version === "string" && entry.version.trim()) return entry.version.trim();
  const source = entry.source;
  const sourcePath =
    typeof source === "string" ? source : typeof source?.path === "string" ? source.path : null;
  if (sourcePath && baseDir) {
    const dir = isAbsolute(sourcePath) ? sourcePath : resolve(baseDir, sourcePath);
    const manifest = readJson(join(dir, ".zcode-plugin", "plugin.json"));
    if (typeof manifest?.version === "string") return manifest.version;
  }
  return null;
}

function versionFromFile(file) {
  return versionFromManifest(readJson(file), dirname(file));
}

function versionFromMarketplace(settings) {
  for (const file of marketplaceFiles(settings)) {
    const version = versionFromFile(file);
    if (version) return version;
  }
  return null;
}

async function versionFromUrl(url) {
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": `zcode-opencode-go-usage/${CURRENT_VERSION}`
      },
      signal: AbortSignal.timeout(10_000)
    });
    if (!response.ok) return null;
    return versionFromManifest(await response.json().catch(() => null), null);
  } catch {
    return null;
  }
}

async function versionFromSource(source) {
  if (!source || typeof source !== "object") return null;
  if (source.source === "url" && typeof source.url === "string") {
    return versionFromUrl(source.url);
  }
  if (source.source === "github" && typeof source.repo === "string") {
    const ref = typeof source.ref === "string" && source.ref ? source.ref : "HEAD";
    for (const path of [".claude-plugin/marketplace.json", "marketplace.json"]) {
      const version = await versionFromUrl(
        `https://raw.githubusercontent.com/${source.repo}/${ref}/${path}`
      );
      if (version) return version;
    }
    return null;
  }
  if (typeof source.path === "string" && source.path) {
    if (source.source === "file" || source.path.endsWith(".json")) {
      return versionFromFile(resolve(source.path));
    }
    const dir = resolve(source.path);
    return (
      versionFromFile(join(dir, "marketplace.json")) ??
      versionFromFile(join(dir, ".claude-plugin", "marketplace.json"))
    );
  }
  return null;
}

async function latestVersion(settings) {
  if (settings.updateUrl) {
    const response = await fetch(settings.updateUrl, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10_000)
    });
    if (!response.ok) return null;
    const json = await response.json().catch(() => null);
    const version = json?.version ?? json?.latest;
    return typeof version === "string" ? version : null;
  }
  // Prefer the marketplace's live source over a possibly stale cache.
  const marketplaceId = detectMarketplaceId();
  const source = marketplaceId ? knownMarketplaceSource(marketplaceId) : null;
  if (source) {
    const version = await versionFromSource(source);
    if (version) return version;
  }
  return versionFromMarketplace(settings);
}

function kickUpdateCheck(settings) {
  if (!settings.updateCheck) return;
  const now = Date.now();
  if (updateInFlight !== null) return;
  if (updateState !== null && now - updateState.at < UPDATE_CHECK_INTERVAL_MS) return;
  updateInFlight = (async () => {
    let latest = null;
    try {
      latest = await latestVersion(settings);
    } catch {
      // offline / unreadable marketplace — keep the previous result
      latest = updateState?.latest ?? null;
    }
    // A null result means "no source / offline"; retry sooner than a
    // successful check so a transient failure does not hide updates for a day.
    updateState =
      latest === null
        ? {
            at: Date.now() - UPDATE_CHECK_INTERVAL_MS + 5 * 60_000,
            latest: updateState?.latest ?? null
          }
        : { at: Date.now(), latest };
  })()
    .catch(() => {
      updateState = {
        at: Date.now() - UPDATE_CHECK_INTERVAL_MS + 5 * 60_000,
        latest: updateState?.latest ?? null
      };
    })
    .finally(() => {
      updateInFlight = null;
    });
}

function updateInfo(settings) {
  if (!settings.updateCheck || updateState?.latest == null) {
    return { current: CURRENT_VERSION, available: false, latest: null };
  }
  const available = isNewer(updateState.latest, CURRENT_VERSION);
  return {
    current: CURRENT_VERSION,
    available,
    latest: available ? updateState.latest : null
  };
}

// ── session header diagnostics ─────────────────────────────────────────────

function isOpenCodeGoBase(value) {
  try {
    const url = new URL(value);
    return url.hostname === "opencode.ai" && url.pathname.replace(/\/+$/, "") === "/zen/go/v1";
  } catch {
    return false;
  }
}

/**
 * ZCode itself adds `x-opencode-session` to chat requests whose base URL is
 * `https://opencode.ai/zen/go/v1` (verified in the host bundle). The plugin
 * therefore reports the host-managed state instead of patching fetch.
 */
function sessionInfo(settings) {
  const base = settings.providerBase || `${settings.baseUrl}/v1`;
  const active = isOpenCodeGoBase(base) || isOpenCodeGoBase(`${settings.baseUrl}/v1`);
  return {
    active,
    injectedBy: active ? "zcode-host" : null,
    provider: settings.providerId,
    base,
    note: active
      ? "ZCode injects x-opencode-session for OpenCode GO chat requests; no host files are patched."
      : "The configured base URL is not the OpenCode GO gateway, so the host session-header rule does not apply."
  };
}

// ── text rendering ─────────────────────────────────────────────────────────

const WINDOW_LABELS = {
  rolling: { zh: "滚动窗口 (5h)", en: "Rolling (5h)" },
  weekly: { zh: "周窗口", en: "Weekly" },
  monthly: { zh: "月窗口", en: "Monthly" }
};

function renderUsageText(data, lang) {
  const zh = lang !== "en";
  const usage = data?.usage;
  if (!usage || typeof usage !== "object") {
    return zh ? "OpenCode GO: 网关返回了意外的数据结构。" : "OpenCode GO: unexpected response shape.";
  }
  const lines = [zh ? "OpenCode GO 套餐用量:" : "OpenCode GO plan usage:"];
  for (const [key, labels] of Object.entries(WINDOW_LABELS)) {
    const window = usage[key];
    if (!window || typeof window.percent !== "number") continue;
    const status = window.status === "ok" ? (zh ? "正常" : "ok") : window.status;
    const resets = window.resetsAt
      ? zh
        ? `重置于 ${new Date(window.resetsAt).toLocaleString("zh-CN")}`
        : `resets at ${new Date(window.resetsAt).toLocaleString("en-US")}`
      : "";
    lines.push(`  ${zh ? labels.zh : labels.en}: ${window.percent}% (${status})${resets ? `, ${resets}` : ""}`);
  }
  return lines.join("\n");
}

function updateHint(lang) {
  const update = updateInfo(loadSettings());
  if (!update.available || update.latest === null) return "";
  return lang === "en"
    ? `\n\nUpdate available: v${update.latest} — refresh the local marketplace and update in Settings → Plugins.`
    : `\n\n发现新版本 v${update.latest} — 在 设置 → 插件 中刷新市场并更新。`;
}

// ── MCP server ─────────────────────────────────────────────────────────────

const server = new McpServer({ name: "opencode-go-usage", version: CURRENT_VERSION });

server.registerTool(
  "opencode_go_usage",
  {
    title: "OpenCode GO plan usage",
    description:
      "Read the OpenCode GO subscription quota: rolling 5-hour, weekly and monthly windows, each with its usage percent, status and reset time. Returns a text summary plus structured usage data. The result renders as an inline usage card by default; the same dashboard is also available in the side pane.",
    inputSchema: {
      refresh: z
        .boolean()
        .optional()
        .describe("Bypass the server-side cache and fetch fresh data from the OpenCode GO gateway."),
      lang: z
        .enum(["zh", "en"])
        .optional()
        .describe("Language for the text summary. Defaults to zh (Chinese).")
    },
    annotations: {
      title: "OpenCode GO plan usage",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true
    },
    _meta: {
      ui: {
        resourceUri: UI_URI,
        visibility: ["model", "app"],
        surface: "dashboard",
        preferredDisplayMode: "inline",
        showInline: true,
        prefersBorder: true
      }
    }
  },
  async ({ refresh, lang } = {}) => {
    const language = lang === "en" ? "en" : "zh";
    const settings = loadSettings();
    kickUpdateCheck(settings);
    try {
      const { data, cached } = await getUsage(settings, language, refresh === true);
      const text = renderUsageText(data, language) + updateHint(language);
      return {
        content: [{ type: "text", text }],
        structuredContent: {
          usage: data?.usage ?? null,
          update: updateInfo(settings),
          sessionHeader: sessionInfo(settings),
          fetchedAt: new Date().toISOString(),
          cached,
          keySource: settings.keySource,
          gateway: { baseUrl: settings.baseUrl }
        }
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        isError: true,
        content: [{ type: "text", text: message }],
        structuredContent: {
          error: message,
          update: updateInfo(settings),
          sessionHeader: sessionInfo(settings),
          keySource: settings.keySource,
          gateway: { baseUrl: settings.baseUrl }
        }
      };
    }
  }
);

let dashboardHtml = null;
function readDashboard() {
  if (dashboardHtml === null) {
    dashboardHtml =
      readText(join(PLUGIN_ROOT, "dist", "dashboard.html")) ??
      "<!doctype html><meta charset=\"utf-8\"><body>OpenCode GO dashboard is missing. Rebuild the plugin.</body>";
  }
  return dashboardHtml;
}

server.registerResource(
  "opencode-go-dashboard",
  UI_URI,
  {
    title: "OpenCode GO Usage",
    description: "OpenCode GO plan usage dashboard (rolling 5h, weekly, monthly).",
    mimeType: "text/html;profile=mcp-app",
    _meta: {
      ui: {
        preferredDisplayMode: "inline",
        showInline: true,
        prefersBorder: true
      }
    }
  },
  async (uri) => ({
    contents: [
      {
        uri: uri.href,
        mimeType: "text/html;profile=mcp-app",
        text: readDashboard()
      }
    ]
  })
);

// Prime the update check without blocking startup.
kickUpdateCheck(loadSettings());

const transport = new StdioServerTransport();
await server.connect(transport);
