// opencode-go-usage — dashboard (MCP App).
//
// The page never talks to the OpenCode GO gateway directly: every refresh is
// an MCP tool call handled by the plugin's stdio server, which owns the API
// key and the 30-second cache.

import {
  App,
  applyDocumentTheme,
  applyHostStyleVariables
} from "@modelcontextprotocol/ext-apps";

const VERSION = "0.1.3";
const WINDOWS = [
  { key: "rolling", labelKey: "rolling", hint: null, windowMs: 5 * 3600e3 },
  { key: "weekly", labelKey: "weekly", hint: null, windowMs: 7 * 86400e3 },
  // The monthly window is anchored to the subscription day-of-month, so its
  // real length alternates 28-31 days. 30 days is an approximation; the
  // elapsed fraction is clamped to [0, 1], so it stays correct at the edges
  // and is at most ~3% off mid-window.
  { key: "monthly", labelKey: "monthly", hint: null, windowMs: 30 * 86400e3 }
];

const DICT = {
  zh: {
    title: "OpenCode GO",
    rolling: "滚动窗口 (5h)",
    weekly: "周窗口",
    monthly: "月窗口",
    soon: "即将重置",
    minutes: (n) => `${n}分`,
    hours: (n, m) => `${n}小时${m}分`,
    days: (n, m) => `${n}天${m}小时`,
    elapsedTitle: (pct, rest) => `本窗口时间进度:已流逝 ${pct}%,剩余 ${rest}%`,
    refresh: "刷新",
    loading: "加载中…",
    railTitle: (pct) => `OpenCode GO 月用量 ${pct}%`,
    railPlain: "OpenCode GO",
    updateAvailable: (v) => `新版本 v${v}`,
    updateTitle: "在 设置 → 插件 中刷新市场并更新（不会自动升级）",
    unexpected: "OpenCode GO: 用量服务返回了意外的数据。"
  },
  en: {
    title: "OpenCode GO",
    rolling: "Rolling (5h)",
    weekly: "Weekly",
    monthly: "Monthly",
    soon: "resets soon",
    minutes: (n) => `${n}m`,
    hours: (n, m) => `${n}h${m}m`,
    days: (n, m) => `${n}d${m}h`,
    elapsedTitle: (pct, rest) => `Window time: ${pct}% elapsed, ${rest}% left`,
    refresh: "Refresh",
    loading: "Loading…",
    railTitle: (pct) => `OpenCode GO monthly ${pct}%`,
    railPlain: "OpenCode GO",
    updateAvailable: (v) => `v${v} available`,
    updateTitle: "Refresh the local marketplace and update in Settings → Plugins (no auto-upgrade)",
    unexpected: "OpenCode GO: the usage service returned an unexpected shape."
  }
};

function pickLang(locale) {
  return String(locale || "").toLowerCase().startsWith("zh") ? "zh" : "en";
}

let lang = pickLang(typeof navigator !== "undefined" ? navigator.language : "zh");
let t = DICT[lang];

const state = {
  data: null,
  error: null,
  loading: false
};

const app = new App({ name: "opencode-go-usage", version: VERSION }, {});

app.onhostcontextchanged = () => {
  // The SDK merges partial updates into its context before dispatching, so
  // read the merged value here instead of the partial notification payload.
  applyHost(app.getHostContext());
  render();
};

app.ontoolresult = (params) => {
  consume(params);
  render();
};

function applyHost(context) {
  if (!context) return;
  if (context.theme) applyDocumentTheme(context.theme);
  if (context.styles) applyHostStyleVariables(context.styles);
  if (typeof context.locale === "string" && context.locale) {
    const next = pickLang(context.locale);
    if (next !== lang) {
      lang = next;
      t = DICT[lang];
    }
  }
}

function extractText(result) {
  if (!Array.isArray(result?.content)) return "";
  const block = result.content.find((item) => item?.type === "text" && typeof item.text === "string");
  return block?.text ?? "";
}

function consume(result) {
  const structured = result?.structuredContent;
  if (structured && structured.usage && typeof structured.usage === "object") {
    state.data = structured;
    state.error = null;
    state.loading = false;
    return;
  }
  const message = structured?.error || extractText(result) || t.unexpected;
  state.data = null;
  state.error = String(message);
  state.loading = false;
}

async function load(force) {
  if (state.loading && !force) return;
  state.loading = true;
  if (view?.type === "full") view.refresh.disabled = true;
  try {
    const result = await app.callServerTool({
      name: "opencode_go_usage",
      arguments: force ? { refresh: true } : {}
    });
    consume(result);
  } catch (error) {
    state.data = null;
    state.error = String(error?.message || error);
    state.loading = false;
  }
  state.loading = false;
  render();
}

// ── data helpers ───────────────────────────────────────────────────────────

function timeElapsedFraction(resetsAt, windowMs) {
  if (!resetsAt || !windowMs) return null;
  const reset = new Date(resetsAt).getTime();
  if (!Number.isFinite(reset)) return null;
  const elapsed = (windowMs - (reset - Date.now())) / windowMs;
  return Math.max(0, Math.min(1, elapsed));
}

function timeUntil(iso) {
  const target = new Date(iso).getTime();
  if (!Number.isFinite(target)) return "";
  const diff = target - Date.now();
  if (diff <= 0) return t.soon;
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return t.minutes(mins);
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t.hours(hours, mins % 60);
  return t.days(Math.floor(hours / 24), hours % 24);
}

function clampPercent(percent) {
  return Math.max(0, Math.min(100, Number(percent) || 0));
}

function fillColor(percent) {
  if (percent >= 90) return "var(--ocg-error)";
  if (percent >= 70) return "var(--ocg-warn)";
  return "var(--ocg-success)";
}

// ── DOM ────────────────────────────────────────────────────────────────────

function el(tag, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

let view = null;
let compactMode = null;

function build(compact) {
  const root = document.getElementById("root");
  root.replaceChildren();
  if (compact) {
    const box = el("div", "ocg-compact");
    const text = el("span", "ocg-compact-text");
    box.append(text);
    root.append(box);
    view = { type: "compact", box, text, rows: null };
    return;
  }

  const widget = el("div", "ocg-widget");
  const head = el("div", "ocg-head");
  const mark = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  mark.setAttribute("viewBox", "0 0 32 32");
  mark.setAttribute("aria-hidden", "true");
  mark.classList.add("ocg-mark");
  mark.innerHTML = [
    '<rect width="32" height="32" rx="8" fill="#0B1220"/>',
    '<rect x="7" y="9" width="18" height="4" rx="2" fill="#FFFFFF" opacity=".10"/>',
    '<rect x="7" y="9" width="7" height="4" rx="2" fill="#3FB950"/>',
    '<rect x="7" y="14" width="18" height="4" rx="2" fill="#FFFFFF" opacity=".10"/>',
    '<rect x="7" y="14" width="13" height="4" rx="2" fill="#D29922"/>',
    '<rect x="7" y="19" width="18" height="4" rx="2" fill="#FFFFFF" opacity=".10"/>',
    '<rect x="7" y="19" width="16" height="4" rx="2" fill="#5686FE"/>'
  ].join("");
  const title = el("span", "ocg-title");
  title.textContent = "OpenCode GO";
  const badges = el("span", "ocg-badges");
  const refresh = el("button", "ocg-refresh");
  refresh.type = "button";
  refresh.addEventListener("click", () => load(true));
  head.append(mark, title, badges, refresh);

  const error = el("div", "ocg-err");
  const rows = el("div", "ocg-rows");
  widget.append(head, error, rows);
  root.append(widget);

  view = {
    type: "full",
    widget,
    title,
    badges,
    refresh,
    error,
    rows,
    rowRefs: new Map()
  };
}

function ensureRow(key) {
  const existing = view.rowRefs.get(key);
  if (existing) return existing;

  const row = el("div", "ocg-row");
  const label = el("div", "ocg-row-label");
  const name = document.createElement("b");
  const percent = document.createElement("b");
  label.append(name, percent);

  const meta = el("div", "ocg-meta");
  const bars = el("div", "ocg-bars");
  const track = el("div", "ocg-track");
  const fill = el("div", "ocg-fill");
  track.append(fill);

  const timeTrack = el("div", "ocg-timetrack");
  const elapsed = el("div", "ocg-timeelapsed");
  const remaining = el("div", "ocg-timeremain");
  timeTrack.append(elapsed, remaining);
  bars.append(track, timeTrack);

  const countdown = document.createElement("span");
  meta.append(bars, countdown);
  row.append(label, meta);
  view.rows.append(row);

  const refs = { row, name, percent, fill, timeTrack, elapsed, remaining, countdown };
  view.rowRefs.set(key, refs);
  return refs;
}

function renderFull() {
  view.title.textContent = t.title;
  view.refresh.textContent = t.refresh;
  view.refresh.disabled = state.loading;

  view.badges.replaceChildren();
  const update = state.data?.update;
  if (update?.available && update.latest) {
    const badge = el("span", "ocg-update");
    badge.textContent = t.updateAvailable(update.latest);
    badge.title = t.updateTitle;
    view.badges.append(badge);
  }

  if (state.error) {
    view.error.textContent = state.error;
    view.error.title = state.error;
    view.error.style.display = "";
  } else if (state.data === null) {
    view.error.textContent = t.loading;
    view.error.title = "";
    view.error.style.display = "";
  } else {
    view.error.style.display = "none";
  }

  for (const window of WINDOWS) {
    const data = state.data?.usage?.[window.key];
    const refs = view.rowRefs.get(window.key);
    if (!data || typeof data.percent !== "number") {
      if (refs) refs.row.style.display = "none";
      continue;
    }
    const row = ensureRow(window.key);
    row.row.style.display = "";
    row.name.textContent = t[window.labelKey];
    row.percent.textContent = `${data.percent}%`;
    row.fill.style.width = `${clampPercent(data.percent)}%`;
    row.fill.style.background = fillColor(data.percent);

    const elapsed = timeElapsedFraction(data.resetsAt, window.windowMs);
    if (elapsed === null) {
      row.timeTrack.style.display = "none";
    } else {
      row.timeTrack.style.display = "";
      row.elapsed.style.width = `${elapsed * 100}%`;
      row.remaining.style.width = `${(1 - elapsed) * 100}%`;
      row.timeTrack.title = t.elapsedTitle(
        Math.round(elapsed * 100),
        Math.round((1 - elapsed) * 100)
      );
    }

    row.countdown.textContent =
      data.status === "ok"
        ? data.resetsAt
          ? timeUntil(data.resetsAt)
          : window.hint
            ? window.hint
            : ""
        : String(data.status);
  }
}

function renderCompact() {
  const monthly = state.data?.usage?.monthly;
  const percent = typeof monthly?.percent === "number" ? monthly.percent : null;
  view.text.textContent = percent === null ? "GO" : `${percent}%`;
  view.box.title = state.error
    ? `OpenCode GO: ${state.error}`
    : percent === null
      ? t.railPlain
      : t.railTitle(percent);
}

function render() {
  const compact = window.innerWidth < 230;
  if (compact !== compactMode) {
    compactMode = compact;
    build(compact);
  }
  if (compact) renderCompact();
  else renderFull();
}

// ── lifecycle ──────────────────────────────────────────────────────────────

function start() {
  render();
  app
    .connect()
    .then(() => {
      applyHost(app.getHostContext());
      render();
      if (state.data === null && state.error === null) load(false);
      window.setInterval(() => {
        if (!document.hidden) load(false);
      }, 60_000);
      window.setInterval(() => render(), 30_000);
      window.addEventListener("resize", () => render());
    })
    .catch((error) => {
      state.loading = false;
      state.error = String(error?.message || error);
      render();
    });
}

start();
