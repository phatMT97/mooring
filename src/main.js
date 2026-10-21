import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import "@xterm/xterm/css/xterm.css";
import { invoke, Channel } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow, availableMonitors as getAvailableMonitors, currentMonitor } from "@tauri-apps/api/window";
import { PhysicalPosition, PhysicalSize } from "@tauri-apps/api/dpi";
import { getName, getIdentifier } from "@tauri-apps/api/app";
import { attachLinks } from "./links.js";
import { attachScrub } from "./scrub.js";
import { confirmDialog } from "./confirm.js";
import { icons, hydrateIcons } from "./icons.js";
import { themeById, applyTheme } from "./themes.js";
import { toggleThemePicker } from "./themepicker.js";
import { showTabMenu } from "./tabmenu.js";
import { attachSearch, openSearch } from "./search.js";
import { toggleShortcuts } from "./shortcuts.js";
import { togglePalette } from "./palette.js";
import { t, setLang, defaultLang, translateDom } from "./i18n.js";
import { createAgentRestarter } from "./agent-restart.js";

// One accent per repo (sidebar, header, frame) and a faint tint of it behind the terminal,
// both taken from the current theme (themes.js).
let theme = themeById("mocha");

// a over b, `t` of the way (hex colours)
function mix(a, b, t) {
  const n = (h, i) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16);
  return "#" + [0, 1, 2].map((i) => Math.round(n(b, i) + (n(a, i) - n(b, i)) * t).toString(16).padStart(2, "0")).join("");
}
const IDLE_GLYPH = "✳"; // Claude Code's title glyph when idle; any other leading glyph is its spinner
const DEFAULT_FONT_SIZE = 13;

const win = getCurrentWindow();
const appName = await getName().catch(() => "Mooring"); // "Mooring DEV" for the test build
const appId = await getIdentifier();
const state = { distro: "Ubuntu-24.04", active: null, nextId: 1, tabs: [], sidebar: "pinned", theme: "mocha", lang: null, defaultShell: "wsl", waitingOpen: false, fontSize: DEFAULT_FONT_SIZE, split: null, window: null };
// state.split = { ids: [first, second], dir: "row" | "col", ratio } shows two tabs side by side
// (row) or stacked (col); state.active is the one with focus.
const tabs = new Map(); // id -> runtime tab

// ---- helpers ---------------------------------------------------------------

// `pick` is a tab's own colour (an accent index) and wins over the repo's.
function colorsFor(root, pick = null) {
  if (pick != null) return tinted(theme.accents[pick % theme.accents.length]);
  if (!root) return { accent: theme.ui.text3, tint: theme.ui.layer };
  let h = 2166136261;
  for (const ch of root.toLowerCase()) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const accent = theme.accents[(h >>> 0) % theme.accents.length];
  return tinted(accent);
}

function tinted(accent) {
  return { accent, tint: mix(accent, theme.ui.layer, theme.kind === "light" ? 0.04 : 0.05) };
}

// WSL tabs keep Linux paths: \\wsl.localhost\Ubuntu-24.04\home\me -> /home/me, C:\Users -> /mnt/c/Users
function toLinuxPath(winPath) {
  const m = winPath.match(/^\\\\wsl(?:\.localhost|\$)\\[^\\]+(\\.*)?$/i);
  if (m) return (m[1] || "\\").replaceAll("\\", "/");
  const d = winPath.match(/^([A-Za-z]):(\\.*)?$/);
  if (d) return `/mnt/${d[1].toLowerCase()}${(d[2] || "").replaceAll("\\", "/")}`;
  return null;
}

// and back, for the Windows-side git lookup
function toWinPath(linuxPath) {
  const d = linuxPath.match(/^\/mnt\/([a-z])(\/.*)?$/);
  if (d) return `${d[1].toUpperCase()}:${(d[2] || "\\").replaceAll("/", "\\")}`;
  return `\\\\wsl.localhost\\${state.distro}${linuxPath.replaceAll("/", "\\")}`;
}

function baseName(p) {
  const parts = p.split(/[\\/]+/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : p;
}

function displayTitle(tab) {
  const t = (tab.title || "").replace(/^[^\p{L}\p{N}]+/u, "").trim(); // drop the agent's status glyph
  // A bare shell titles itself "user@host: dir" (bash) or with its exe path (PowerShell): show the folder.
  if (!t || /^\S+@\S+:/.test(t) || /powershell\.exe$/i.test(t)) return baseName(tab.cwd || "~");
  return t;
}

const shellName = (tab, short) => (tab.shell === "wsl" ? "WSL" : short ? "PS" : "PowerShell");

// What a tab is called: its repo, and its title unless that just repeats the repo.
function tabHeading(tab) {
  const repo = tab.root ? baseName(tab.root) : "";
  const name = displayTitle(tab);
  return { repo, name: repo && name === repo ? "" : name, full: [repo, repo && name === repo ? "" : name].filter(Boolean).join(" · ") };
}

let saveTimer = null;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    state.tabs = [...tabs.values()].map(({ id, shell, cwd, title, pinned, color }) => ({ id, shell, cwd, title, pinned, color }));
    invoke("save_state", { json: JSON.stringify(state) });
  }, 300);
}

// ---- tabs ------------------------------------------------------------------

let wslHome = null;

// `show: false` opens it in the background (restore at launch, the new half of a split).
async function openTab({ shell, cwd = "", title = "", pinned = false, color = null, id = state.nextId++, show = true }) {
  state.nextId = Math.max(state.nextId, id + 1);
  const el = document.createElement("div");
  el.className = "term";
  document.getElementById("terminals").append(el);

  const term = new Terminal({
    fontFamily: "'Cascadia Mono', Consolas, monospace",
    fontSize: state.fontSize,
    lineHeight: 1.15,
    scrollback: 10000,
    cursorBlink: true,
    allowProposedApi: true,
    theme: termTheme(theme.ui.layer),
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(el);
  attachScrub(el, term);
  const label = document.createElement("div");
  label.className = "pane-label";
  label.innerHTML = `<span class="pl-repo"></span><span class="pl-title"></span>`;
  el.append(label);

  const tab = { id, shell, cwd, title, pinned, color, el, term, fit, label, root: null, colors: colorsFor(null), status: "idle", webgl: null, painted: null };
  tabs.set(id, tab);
  attachSearch(tab);
  // clicking into the other half of a split moves the focus there
  term.textarea?.addEventListener("focus", () => { if (state.active !== id) activate(id); });
  attachLinks(term, {
    shell: () => tab.shell,
    cwd: () => tab.cwd,
    toWin: toWinPath,
    home: async () => (tab.shell === "wsl" ? (wslHome ??= await invoke("wsl_home", { distro: state.distro })) : null),
  });

  term.onData((data) => {
    if (tab.restarting) return;
    if (data.includes("\r")) tab.atPrompt = false; // a command line was sent
    invoke("pty_write", { id, data }).catch(() => {});
  });
  term.onResize(({ cols, rows }) => invoke("pty_resize", { id, cols, rows }).catch(() => {}));
  term.onTitleChange((t) => onTitle(tab, t));
  term.onBell(() => flagNeeds(tab));
  // OSC 9;9 = cwd report from our bash/PowerShell hooks; other OSC 9 / 777 = agent notifications.
  term.parser.registerOscHandler(9, (data) => {
    if (data.startsWith("9;")) {
      tab.atPrompt = true; // our hooks report the cwd as each prompt is drawn
      tab.agentTool = tab.agentLauncher = null;
      if (!tab.restarting) render();
      setCwd(tab, data.slice(2));
      runQueued(tab);
    }
    else if (!data.startsWith("4;")) flagNeeds(tab);
    return true;
  });
  term.parser.registerOscHandler(777, () => { flagNeeds(tab); return true; });
  // The shells tint their own background (OSC 11); here the deck owns the colours.
  term.parser.registerOscHandler(11, () => true);
  term.parser.registerOscHandler(111, () => true);
  term.attachCustomKeyEventHandler((e) => clipboardKeys(e, tab));
  el.addEventListener("contextmenu", (e) => { e.preventDefault(); paste(tab); });

  if (shell === "wsl" && cwd) tab.cwd = toLinuxPath(cwd) ?? cwd; // older states stored C:\ paths
  if (tab.cwd) await resolveRepo(tab, shell === "wsl" ? toWinPath(tab.cwd) : tab.cwd);
  if (show) activate(id);
  else el.classList.add("measure"); // laid out but invisible, so the shell starts at the right size
  fit.fit();
  el.classList.remove("measure");
  await spawn(tab);
  persist();
  return tab;
}

let restoring = false; // set while the saved tabs are reopened at launch

async function spawn(tab) {
  tab.status = "idle";
  const output = new Channel((bytes) => tab.term.write(new Uint8Array(bytes)));
  await invoke("pty_spawn", {
    output, id: tab.id, shell: tab.shell, cwd: tab.cwd || "", distro: state.distro,
    cols: tab.term.cols, rows: tab.term.rows, restoring, lang: state.lang,
  }).catch((e) => tab.term.write(`\r\n[Mooring] ${t("term.spawnFailed", { e })}\r\n`));
}

// Process identity covers all tools; title glyphs bridge the gap before the next process scan.
function hasAgent(tab) {
  return !!tab.agentTool || (!tab.atPrompt && /^[^\p{L}\p{N}\s]/u.test(tab.title || ""));
}

async function refreshAgents() {
  const json = await invoke("agent_tabs", { distro: state.distro, args: ["running", appId] }).catch(() => "");
  if (!json) return; // an unavailable helper must not erase known identities
  const live = new Map(JSON.parse(json).map((x) => [Number(x.tab), x]));
  let changed = false;
  for (const tab of tabs.values()) {
    if (tab.shell !== "wsl" || tab.restarting) continue;
    const agent = live.get(tab.id);
    const launchers = agent?.launchers ?? (agent?.launcher ? [agent.launcher] : []);
    if (tab.agentTool !== (agent?.tool ?? null) || tab.agentLauncher !== (agent?.launcher ?? null)
      || JSON.stringify(tab.agentLaunchers) !== JSON.stringify(launchers)) {
      tab.agentTool = agent?.tool ?? null;
      tab.agentLauncher = agent?.launcher ?? null;
      tab.agentLaunchers = launchers;
      changed = true;
    }
  }
  if (changed) render();
}

const { restartAgent, restartAll } = createAgentRestarter({
  invoke, tabs, hasAgent, distro: () => state.distro, app: appId, t, toast,
});

async function restartFromUi(tab, launcher = null) {
  try {
    const out = await restartAgent(tab, false, launcher);
    toast(t(out.skipped ? "agent.skippedBusy" : "agent.restarted"));
  } catch (e) { toast(String(e?.message ?? e)); }
  refreshAgents();
}

function agentLabel(tab) {
  return tab.agentTool === "claude" ? (tab.agentLauncher || "claude") : tab.agentTool;
}

function launcherChoices(tab) {
  return ["claude", "codex"].includes(tab?.agentTool) ? (tab.agentLaunchers ?? []) : [];
}

function launcherCommand(tab, launcher) {
  return `${launcher} ${tab.agentTool === "codex" ? "resume" : "--resume"}`;
}

async function closeTab(id) {
  const tab = tabs.get(id);
  if (!tab) return;
  if (tab.status === "working") {
    const ok = await confirmDialog({
      title: t("close.tab.title"),
      body: t("close.tab.body", { name: displayTitle(tab) }),
      confirmLabel: t("close.tab.confirm"),
    });
    if (!ok) return;
  }
  invoke("pty_kill", { id });
  setWebgl(tab, false);
  tab.term.dispose();
  tab.el.remove();
  tabs.delete(id);
  for (const w of [...waiters]) w();
  const partner = state.split?.ids.find((x) => x !== id);
  if (state.split?.ids.includes(id)) state.split = null;
  if (state.active === id) {
    const next = tabs.has(partner) ? partner : [...tabs.keys()].pop();
    if (next) activate(next); else openTab({ shell: state.defaultShell });
  } else {
    layout();
  }
  render();
  persist();
}

function activate(id) {
  const tab = tabs.get(id);
  if (!tab) return;
  // in a split, a tab from outside replaces the half that had the focus
  const split = state.split;
  if (split && !split.ids.includes(id)) split.ids[Math.max(0, split.ids.indexOf(state.active))] = id;
  state.active = id;
  if (tab.status === "needs") tab.status = "idle";
  layout();
  requestAnimationFrame(() => { if (document.activeElement !== tab.term.textarea) tab.term.focus(); });
  render();
  persist();
}

// ---- layout: one tab, or two in a split ------------------------------------

const area = document.getElementById("terminals");
const divider = document.getElementById("divider");

function visibleTabs() {
  return (state.split ? state.split.ids : [state.active]).map((id) => tabs.get(id)).filter(Boolean);
}

// #terminals[data-dir] is what CSS knows of the split (pane positions, divider, header buttons).
function layout() {
  const split = state.split;
  if (split) area.dataset.dir = split.dir;
  else delete area.dataset.dir;
  area.style.setProperty("--ratio", split ? split.ratio : 1);
  const shown = visibleTabs();
  for (const t of tabs.values()) {
    const slot = shown.indexOf(t);
    t.el.classList.toggle("active", slot >= 0);
    t.el.classList.toggle("focused", !!split && t.id === state.active);
    t.el.dataset.slot = slot;
    if (slot >= 0) {
      paintTerm(t);
      setWebgl(t, true);
    }
  }
  fitVisible();
}

let fitFrame = 0;
function fitVisible() {
  cancelAnimationFrame(fitFrame);
  fitFrame = requestAnimationFrame(() => { for (const t of visibleTabs()) t.fit.fit(); });
}

function splitWith(id, dir = state.split?.dir || "row") {
  const cur = state.active;
  if (id === cur || !tabs.has(id)) return;
  state.split = { ids: [cur, id], dir, ratio: 0.5 };
  activate(id);
}

async function splitNew(dir) {
  const cur = tabs.get(state.active);
  if (!cur) return;
  const tab = await openTab({ shell: cur.shell, cwd: cur.cwd, show: false });
  splitWith(tab.id, dir);
}

function unsplit() {
  if (!state.split) return;
  state.split = null;
  activate(state.active);
}

function rotateSplit() {
  if (!state.split) return;
  state.split.dir = state.split.dir === "row" ? "col" : "row";
  layout();
  persist();
}

// focus the other half when the arrow points at it
function focusToward(key) {
  const split = state.split;
  if (!split) return false;
  const i = split.ids.indexOf(state.active);
  const forward = split.dir === "row" ? key === "ArrowRight" : key === "ArrowDown";
  const backward = split.dir === "row" ? key === "ArrowLeft" : key === "ArrowUp";
  if ((forward && i === 0) || (backward && i === 1)) activate(split.ids[1 - i]);
  return forward || backward;
}

divider.addEventListener("pointerdown", (e) => {
  if (e.button !== 0 || !state.split) return;
  e.preventDefault();
  divider.setPointerCapture(e.pointerId);
  divider.classList.add("dragging");
  const move = (ev) => {
    const r = area.getBoundingClientRect();
    const pos = state.split.dir === "row" ? (ev.clientX - r.left) / r.width : (ev.clientY - r.top) / r.height;
    state.split.ratio = Math.min(0.85, Math.max(0.15, pos));
    area.style.setProperty("--ratio", state.split.ratio);
    // refitting reflows the scrollback and makes the app redraw: only once the drag pauses
    clearTimeout(settle);
    settle = setTimeout(fitVisible, 80);
  };
  let settle = 0;
  const up = () => {
    divider.removeEventListener("pointermove", move);
    divider.removeEventListener("pointerup", up);
    divider.classList.remove("dragging");
    clearTimeout(settle);
    fitVisible();
    persist();
    tabs.get(state.active)?.term.focus();
  };
  divider.addEventListener("pointermove", move);
  divider.addEventListener("pointerup", up);
});
divider.addEventListener("dblclick", () => {
  if (!state.split) return;
  state.split.ratio = 0.5;
  layout();
  persist();
});

// ---- rendering speed: GPU (WebGL) for what is on screen --------------------
// Browsers cap live WebGL contexts (~16), so only the last few shown tabs keep one;
// the rest fall back to the DOM renderer, which costs nothing while hidden.

const WEBGL_KEEP = 10;
let webglRecent = [];

// `warm`: getting a background tab ready ahead of time; it never pushes out a tab already in use.
function setWebgl(tab, on, warm = false) {
  if (on) {
    if (warm) {
      if (tab.webgl || tab.noWebgl || webglRecent.length >= WEBGL_KEEP) return;
      webglRecent.push(tab);
    } else {
      webglRecent = [tab, ...webglRecent.filter((t) => t !== tab)];
      for (const old of webglRecent.splice(WEBGL_KEEP)) setWebgl(old, false);
    }
    if (tab.webgl || tab.noWebgl) return;
    try {
      const addon = new WebglAddon();
      addon.onContextLoss(() => { addon.dispose(); tab.webgl = null; });
      tab.term.loadAddon(addon);
      tab.webgl = addon;
    } catch {
      tab.noWebgl = true; // no GPU path here: stay on the DOM renderer
    }
  } else {
    webglRecent = webglRecent.filter((t) => t !== tab);
    tab.webgl?.dispose();
    tab.webgl = null;
  }
}

// After a restore every tab but one is still cold: its first click would pay for a GPU context,
// a glyph atlas in the theme's colours and a refit all at once. Do that work while the app idles,
// one tab at a time, laid out but invisible.
function warmUp(queue = [...tabs.values()]) {
  const tab = queue.shift();
  if (!tab) return;
  requestIdleCallback(() => {
    if (tabs.has(tab.id) && !tab.el.classList.contains("active")) {
      tab.el.classList.add("measure");
      paintTerm(tab);
      setWebgl(tab, true, true);
      tab.fit.fit();
      tab.el.classList.remove("measure");
    }
    warmUp(queue);
  }, { timeout: 1000 });
}

function setFontSize(size) {
  state.fontSize = Math.min(28, Math.max(9, size));
  for (const t of tabs.values()) t.term.options.fontSize = state.fontSize;
  fitVisible();
  persist();
}

async function setCwd(tab, reported) {
  const cwd = tab.shell === "wsl" ? toLinuxPath(reported) ?? reported : reported;
  if (cwd === tab.cwd) return;
  tab.cwd = cwd;
  await resolveRepo(tab, reported);
  render();
  persist();
}

async function resolveRepo(tab, winPath) {
  tab.root = await invoke("repo_root", { path: winPath }).catch(() => null);
  paintTab(tab);
}

function termTheme(background) {
  return { ...theme.term, background, cursorAccent: background };
}

// A tab's colours are cheap and kept current for every tab (the sidebar shows them all).
function paintTab(tab) {
  tab.colors = colorsFor(tab.root, tab.color);
  tab.el.style.setProperty("--tint", tab.colors.tint);
  tab.el.style.setProperty("--tc", tab.colors.accent);
  if (tab.el.classList.contains("active")) paintTerm(tab);
}

// A new xterm theme rebuilds its glyph atlas, so it goes only to tabs on screen; the others
// catch up when shown (layout()).
function paintTerm(tab) {
  const key = `${theme.id} ${tab.colors.tint}`;
  if (tab.painted === key) return;
  tab.painted = key;
  tab.term.options.theme = termTheme(tab.colors.tint);
}

// Switch every layer to theme `id`; `keep` also remembers it (hover previews don't).
function setTheme(id, keep) {
  const first = !document.documentElement.dataset.theme;
  if (theme.id !== id || first) {
    const kind = theme.kind;
    theme = themeById(id);
    applyTheme(theme);
    for (const tab of tabs.values()) paintTab(tab);
    render();
    if (first || kind !== theme.kind) win.setTheme(theme.kind).catch(() => {}); // Mica and the title bar follow light/dark
  }
  if (keep && state.theme !== theme.id) {
    state.theme = theme.id;
    persist();
  }
}

function flagNeeds(tab) {
  if (tab.status === "needs" || (tab.id === state.active && document.hasFocus())) return;
  tab.status = "needs";
  tab.since = Date.now();
  win.requestUserAttention(2).catch(() => {}); // flash the taskbar button
  render();
}

// ---- clipboard and keys the terminal can't express ------------------------------

function paste(tab) {
  invoke("clipboard_read").then((text) => text && tab.term.paste(text)).catch(() => {});
}

function clipboardKeys(e, tab) {
  if (e.type !== "keydown") return true;
  if (tab.restarting) return false;
  const k = e.key.toLowerCase();
  if (e.ctrlKey && k === "c" && tab.term.hasSelection()) {
    invoke("clipboard_write", { text: tab.term.getSelection() }).catch(() => {});
    tab.term.clearSelection();
    return false;
  }
  if (e.ctrlKey && k === "v") { paste(tab); e.preventDefault(); return false; }
  // Ctrl/Shift+Enter: a new line in an agent's prompt instead of sending it. The terminal would
  // send these as a plain Enter; a line feed (Ctrl+J) is what Claude Code, Codex and agy take
  // as "newline here".
  if (e.key === "Enter" && (e.ctrlKey || e.shiftKey) && !e.altKey) {
    invoke("pty_write", { id: tab.id, data: "\n" }).catch(() => {});
    e.preventDefault();
    return false;
  }
  return true;
}

// ---- shortcuts -------------------------------------------------------------

// The deck's keys. Runs in the capture phase on the document (see boot), ahead of xterm and
// any focused input, and a key it takes goes no further. Keep in step with shortcuts.js.
function handleShortcut(e) {
  const k = e.key.toLowerCase();
  const cur = tabs.get(state.active);
  const only = (ctrl, shift, alt) => e.ctrlKey === ctrl && e.shiftKey === shift && e.altKey === alt;
  if (e.key === "F1" || (only(true, false, false) && k === "/")) return toggleShortcuts(), true;
  if (only(true, true, false)) {
    const act = {
      t: () => openSameAs(cur),
      w: () => cur && closeTab(cur.id),
      p: () => openPalette(),
      f: () => searchActive(),
      d: () => splitNew("row"),
      e: () => splitNew("col"),
      r: () => rotateSplit(),
      x: () => unsplit(),
    }[k];
    if (act) return act(), true;
  }
  if (only(false, false, true) && e.key.startsWith("Arrow")) return focusToward(e.key);
  if (only(true, false, false)) {
    if (k === "=" || k === "+") return setFontSize(state.fontSize + 1), true;
    if (k === "-") return setFontSize(state.fontSize - 1), true;
    if (k === "0") return setFontSize(DEFAULT_FONT_SIZE), true;
    if (k === "b") return toggleSidebar(), true;
  }
  if (e.ctrlKey && !e.altKey && (k === "tab" || (!e.shiftKey && /^[1-9]$/.test(k)))) {
    const order = orderedTabs();
    const idx = order.findIndex((x) => x.id === state.active);
    const next = k === "tab" ? order[(idx + (e.shiftKey ? -1 : 1) + order.length) % order.length] : order[Number(k) - 1];
    if (next) activate(next.id);
    return true;
  }
  return false;
}

// "Fix the login bug / WSL · ~/code/api / Working · 4 min"
function tabTooltip(tab) {
  const lines = [displayTitle(tab), [shellName(tab), agentLabel(tab), tab.cwd || "~"].filter(Boolean).join(" · ")];
  const status = { working: "status.working", needs: "status.needs" }[tab.status]
    ?? (hasAgent(tab) ? "status.idle" : null);
  if (status) lines.push(t(status, { time: tab.since ? elapsed(Date.now() - tab.since) : "" }).replace(/ · $/, ""));
  return lines.join("\n");
}

function elapsed(ms) {
  const min = Math.floor(ms / 60000);
  if (min < 1) return t("time.now");
  if (min < 60) return t("time.min", { n: min });
  return t("time.hour", { h: Math.floor(min / 60), m: min % 60 });
}

// Ctrl+Shift+P: every tab, then the deck's commands
function openPalette() {
  const run = (fn) => () => fn();
  togglePalette([
    ...orderedTabs().map((x) => ({
      label: tabHeading(x).full || displayTitle(x),
      hint: `${shellName(x)}${agentLabel(x) ? ` · ${agentLabel(x)}` : ""}${x.status === "working" ? " · ◐" : x.status === "needs" ? " · ●" : ""}`,
      color: x.colors.accent,
      run: () => activate(x.id),
    })),
    ...waiting.map((w) => ({
      label: `${t("waiting.resume")}: ${waitingName(w)}`,
      hint: `${w.tool} · ${baseName(w.cwd)}`,
      run: () => resumeWaiting(w),
    })),
    { label: t("tab.newWsl"), run: run(() => openTab({ shell: "wsl", cwd: tabs.get(state.active)?.shell === "wsl" ? tabs.get(state.active).cwd : "" })) },
    { label: t("tab.newPs"), run: run(() => openTab({ shell: "powershell" })) },
    { label: t("agent.restart"), run: () => restartFromUi(tabs.get(state.active)) },
    ...launcherChoices(tabs.get(state.active)).map((launcher) => ({
      label: t("agent.restartWith", { cmd: launcherCommand(tabs.get(state.active), launcher) }),
      run: () => restartFromUi(tabs.get(state.active), launcher),
    })),
    { label: t("agent.restartAll"), run: () => restartAll().then(refreshAgents).catch((e) => toast(String(e))) },
    { label: t("split.right"), run: run(() => splitNew("row")) },
    { label: t("split.down"), run: run(() => splitNew("col")) },
    ...(state.split ? [{ label: t("split.rotate"), run: run(rotateSplit) }, { label: t("split.off"), run: run(unsplit) }] : []),
    { label: t("search.open"), run: run(searchActive) },
    { label: t("sidebar.toggle"), run: run(toggleSidebar) },
    { label: t("appearance"), run: run(() => themeBtn.click()) },
    { label: t("shortcuts.button"), run: run(toggleShortcuts) },
  ]);
}

// ---- sessions waiting to be resumed (agent-tabs) ----------------------------------------------
// Agents cut off by a shutdown or a closed tab, not reopened yet: listed under the tabs, one click
// to reopen (a tab in its folder running the resume command), ✕ to forget. WSL agents only.

let waiting = [];
let waitingAt = 0;

async function refreshWaiting() {
  waitingAt = Date.now();
  const json = await invoke("agent_tabs", { distro: state.distro, args: ["waiting"] }).catch(() => "");
  try { waiting = json ? JSON.parse(json) : []; } catch { waiting = []; }
  for (const w of waiting) w.root ??= await invoke("repo_root", { path: toWinPath(w.cwd) }).catch(() => null);
  renderWaiting();
}

// Folded to one line by default (the tabs come first); open, the list scrolls within a cap.
function renderWaiting() {
  const box = document.getElementById("waiting");
  box.hidden = !waiting.length;
  box.replaceChildren();
  if (!waiting.length) return;
  const open = !!state.waitingOpen;
  box.classList.toggle("open", open);
  const head = document.createElement("button");
  head.className = "group-head waiting-head";
  head.setAttribute("aria-expanded", String(open));
  head.innerHTML = `${icons.chevronDown}<span class="name"></span><span class="count">${waiting.length}</span>`;
  head.querySelector(".name").textContent = t("waiting.title");
  head.onclick = () => {
    state.waitingOpen = !open;
    persist();
    renderWaiting();
  };
  box.append(head);
  if (!open) return;

  const actions = document.createElement("div");
  actions.className = "waiting-actions";
  actions.innerHTML = `<button class="reopen"></button><button class="forget"></button>`;
  actions.querySelector(".reopen").textContent = t(waiting.length > 1 ? "waiting.all" : "waiting.resume");
  actions.querySelector(".forget").textContent = t(waiting.length > 1 ? "waiting.forgetAll" : "waiting.drop");
  actions.querySelector(".reopen").onclick = async () => {
    for (const w of [...waiting]) await resumeWaiting(w, false);
    refreshWaiting();
  };
  actions.querySelector(".forget").onclick = forgetAllWaiting;
  box.append(actions);

  const list = document.createElement("div");
  list.className = "waiting-list";
  for (const w of waiting) {
    const row = document.createElement("div");
    row.className = "tab waiting";
    row.style.setProperty("--tc", colorsFor(w.root).accent);
    const name = waitingName(w);
    row.innerHTML = `<span class="avatar"><span class="mono"></span></span><span class="label"><span class="title"></span><span class="sub"></span></span>`
      + `<button class="pin" data-i18n-label="waiting.resume">${icons.play}</button><button class="close" data-i18n-label="waiting.drop">${icons.x}</button>`;
    row.querySelector(".mono").textContent = monogram(baseName(w.root || w.cwd));
    row.querySelector(".title").textContent = name;
    row.querySelector(".sub").textContent = `${w.tool} · ${baseName(w.cwd)}`;
    row.title = `${name}\n${w.cwd}\n${w.cmd}`;
    translateDom(row);
    row.onclick = (e) => (e.target.closest(".close") ? dropWaiting(w) : resumeWaiting(w));
    list.append(row);
  }
  box.append(list);
}

const waitingName = (w) => w.title || w.session.slice(0, 8);

async function forgetAllWaiting() {
  const list = [...waiting];
  const ok = await confirmDialog({
    title: t("waiting.forgetAllTitle", { n: list.length }),
    body: t("waiting.forgetAllBody"),
    items: list.map((w) => ({ name: waitingName(w), note: `${w.tool} · ${baseName(w.cwd)}`, color: colorsFor(w.root).accent })),
    confirmLabel: t("waiting.forgetAll"),
  });
  if (!ok) return;
  for (const w of list) await invoke("agent_tabs", { distro: state.distro, args: ["drop", w.session] }).catch(() => "");
  refreshWaiting();
}

// Into a tab already sitting idle at a prompt in that folder (say, a restored tab that came up
// empty) when there is one, else a new tab.
async function resumeWaiting(w, refresh = true) {
  const json = await invoke("agent_tabs", { distro: state.distro, args: ["take", w.session] }).catch(() => "");
  if (json) {
    const { cwd, cmd } = JSON.parse(json);
    const idle = orderedTabs().find((x) => x.shell === "wsl" && x.cwd === cwd && x.atPrompt && !hasAgent(x)
      && x.status !== "exited" && !x.queued && !x.restarting);
    if (idle) {
      idle.atPrompt = false;
      invoke("pty_write", { id: idle.id, data: cmd + "\r" }).catch(() => {});
      activate(idle.id);
    } else {
      queueCommand(await openTab({ shell: "wsl", cwd }), cmd);
    }
  }
  if (refresh) refreshWaiting();
}

async function dropWaiting(w) {
  await invoke("agent_tabs", { distro: state.distro, args: ["drop", w.session] }).catch(() => "");
  refreshWaiting();
}

function openSameAs(cur) {
  return openTab({ shell: cur?.shell ?? state.defaultShell, cwd: cur?.cwd ?? "" });
}

function searchActive() {
  const cur = tabs.get(state.active);
  if (cur) openSearch(cur);
}

// ---- one chat reading another ----------------------------------------------------
// Drop a tab on a terminal (or "bring its context" in its menu): the source agent's latest turns
// and where its full transcript lives are pasted into the target's input, ready for a question.
// Plain text, so claude, codex and agy all read each other. Without a transcript we can read
// (agy, PowerShell, a bare shell) the source terminal's own text goes instead.

async function shareContext(from, to) {
  if (!from || !to || from === to) return;
  const name = tabHeading(from).full;
  // a pasted block runs line by line in a bare PowerShell prompt; bash and the agents take it whole
  if (to.shell === "powershell" && !hasAgent(to)) return toast(t("share.noChat", { name: tabHeading(to).full }));
  let ctx = null;
  if (from.shell === "wsl") {
    const json = await invoke("agent_context", { distro: state.distro, tab: from.id }).catch(() => "");
    try { ctx = json ? JSON.parse(json) : null; } catch { ctx = null; }
  }
  to.term.paste(ctx ? agentContextText(ctx, name, to) : screenText(from, name));
  activate(to.id);
  toast(t(ctx ? "share.done" : "share.screen", { name }));
}

function agentContextText(ctx, name, to) {
  const path = to.shell === "wsl" ? ctx.transcript : toWinPath(ctx.transcript);
  const turns = ctx.turns.map((x) => `[${x.role}]\n${x.text}`).join("\n\n");
  return `<session-context from="${ctx.tool} · ${name}" session="${ctx.session}">\n` +
    `Latest turns of another ${ctx.tool} session${ctx.title ? ` ("${ctx.title}")` : ""}, working in ${ctx.cwd}. ` +
    `Its full transcript (JSONL) is ${path} if you need more.\n\n${turns}\n</session-context> `;
}

// The last `n` lines a tab shows (scrollback included, the empty rows under the cursor not),
// blank runs squeezed.
function lastLines(tab, n) {
  const buf = tab.term.buffer.active;
  const text = (i) => buf.getLine(i)?.translateToString(true) ?? "";
  let end = buf.length;
  while (end > 0 && !text(end - 1).trim()) end--;
  const lines = [];
  for (let i = Math.max(0, end - n); i < end; i++) lines.push(text(i));
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function screenText(from, name) {
  return `<terminal-output from="${shellName(from)} · ${name}">\n${lastLines(from, 300)}\n</terminal-output> `;
}

// ---- Mooring for agents --------------------------------------------------------------------------
// The `mooring` command (agent-tabs/mooring) lets an agent drive the deck it runs in: list tabs,
// open a tab or a split running a command, type into a tab, read what a tab shows or its agent's
// chat, focus or close one. Requests arrive through the inbox folder (lib.rs); `from` is the tab
// the command ran in. A tab is named by id, "self", or "other" (the other half of a split).

function tabInfo(x) {
  return {
    id: x.id, shell: x.shell, cwd: x.cwd, repo: x.root ? baseName(x.root) : null, title: displayTitle(x),
    status: x.status, agent: hasAgent(x), tool: x.agentTool ?? null, launcher: x.agentLauncher ?? null, active: x.id === state.active,
    visible: x.el.classList.contains("active"),
  };
}

function tabRef(ref, from) {
  if (ref === undefined || ref === null || ref === "self") return from;
  if (ref === "other") {
    const ids = state.split?.ids;
    return ids?.includes(from?.id) ? tabs.get(ids.find((x) => x !== from.id)) : null;
  }
  return tabs.get(Number(ref)) ?? null;
}

// Type `command` into a fresh tab once its shell is ready. Our shell hooks report the cwd with
// each prompt; a shell without them gets it after a pause instead.
function queueCommand(tab, command) {
  tab.queued = command;
  setTimeout(() => runQueued(tab), 4000);
}

function runQueued(tab) {
  if (!tab.queued) return;
  const command = tab.queued;
  tab.queued = null;
  tab.atPrompt = false;
  invoke("pty_write", { id: tab.id, data: command + "\r" }).catch(() => {});
}

const waiters = new Set(); // `mooring wait` callbacks, run on every status change and tab close

const AGENT_ACTIONS = {
  async restart({ tab: ref, force, all, launcher }, from) {
    if (all) return restartAll({ force, launcher, from });
    const tab = tabRef(ref, from);
    if (!tab) throw new Error("no such tab");
    if (tab === from) return { id: tab.id, skipped: "self" };
    const out = await restartAgent(tab, force, launcher);
    toast(t(out.skipped ? "agent.skippedBusy" : "agent.restarted"));
    return out;
  },
  whoami(_, from) {
    if (!from) throw new Error("not run from a Mooring tab");
    return tabInfo(from);
  },
  tabs: () => ({ tabs: orderedTabs().map(tabInfo), split: state.split }),

  async new({ shell, cwd, split, command, focus }, from) {
    const base = from ?? tabs.get(state.active);
    const sh = shell === "ps" || shell === "powershell" ? "powershell" : shell === "wsl" ? "wsl" : base?.shell ?? state.defaultShell;
    const tab = await openTab({ shell: sh, cwd: cwd ?? (base?.shell === sh ? base.cwd : ""), show: false });
    if (command) queueCommand(tab, command);
    if (split && base) {
      state.split = { ids: [base.id, tab.id], dir: split === "down" ? "col" : "row", ratio: 0.5 };
      activate(focus ? tab.id : base.id); // the asking agent keeps the keyboard unless told otherwise
    } else if (focus) {
      activate(tab.id);
    } else {
      render();
    }
    return tabInfo(tab);
  },

  send({ tab: ref, text, enter, force }, from) {
    const tab = tabRef(ref, from);
    if (!tab) throw new Error("no such tab");
    if (tab === from) throw new Error("that is your own tab");
    if (tab.restarting) throw new Error(t("agent.alreadyRestarting"));
    if (tab.status === "working" && !force) throw new Error("its agent is working; wait, or pass --force");
    if (text) tab.term.paste(text);
    if (enter) setTimeout(() => {
      if (tab.restarting || tabs.get(tab.id) !== tab) return;
      tab.atPrompt = false;
      invoke("pty_write", { id: tab.id, data: "\r" }).catch(() => {});
    }, 80);
    return { ok: true };
  },

  async read({ tab: ref, lines = 80, chat, last }, from) {
    const tab = tabRef(ref, from);
    if (!tab) throw new Error("no such tab");
    if (chat || last) {
      if (tab.shell !== "wsl") throw new Error("chat history is only readable for WSL tabs");
      const json = await invoke("agent_context", { distro: state.distro, tab: tab.id, last: !!last });
      if (!json) throw new Error("no readable agent chat in that tab");
      return JSON.parse(json);
    }
    return { ...tabInfo(tab), text: lastLines(tab, Math.min(Number(lines) || 80, 2000)) };
  },

  // Resolves once the agent in that tab has finished: if it hasn't started yet, first wait (up to
  // `start` s) for it to start. No polling: onTitle() settles the waiters as the status changes.
  wait({ tab: ref, timeout_s: timeout = 1800, start = 90 }, from) {
    const tab = tabRef(ref, from);
    if (!tab) throw new Error("no such tab");
    if (tab === from) throw new Error("waiting on your own tab would never end");
    const began = Date.now();
    const done = () => ({ ...tabInfo(tab), seconds: Math.round((Date.now() - began) / 1000) });
    return new Promise((resolve, reject) => {
      let started = tab.status === "working";
      let timer = setTimeout(() => finish(new Error("timed out")), (started ? timeout : start) * 1000);
      const watcher = () => {
        if (!tabs.has(tab.id)) return finish(new Error("the tab was closed"));
        if (tab.status === "working") {
          if (!started) {
            started = true;
            clearTimeout(timer);
            timer = setTimeout(() => finish(new Error("timed out")), timeout * 1000);
          }
        } else if (started) {
          finish();
        }
      };
      function finish(err) {
        waiters.delete(watcher);
        clearTimeout(timer);
        err ? reject(err) : resolve(done());
      }
      waiters.add(watcher);
    });
  },

  focus({ tab: ref }, from) {
    const tab = tabRef(ref, from);
    if (!tab) throw new Error("no such tab");
    activate(tab.id);
    return tabInfo(tab);
  },

  split({ tab: ref, dir }, from) {
    const tab = tabRef(ref, from);
    if (!tab || !from || tab === from) throw new Error("name another tab to put beside yours");
    state.split = { ids: [from.id, tab.id], dir: dir === "down" ? "col" : "row", ratio: 0.5 };
    activate(from.id);
    return { split: state.split };
  },

  unsplit() {
    unsplit();
    return { ok: true };
  },

  close({ tab: ref, force }, from) {
    const tab = tabRef(ref, from);
    if (!tab) throw new Error("no such tab");
    if (tab.status === "working" && !force) throw new Error("its agent is working; pass --force to close anyway");
    tab.status = "idle"; // already confirmed here: no dialog
    closeTab(tab.id);
    return { ok: true };
  },

  notify({ text }, from) {
    toast(from ? `${tabHeading(from).full}: ${text}` : text);
    if (from) flagNeeds(from);
    return { ok: true };
  },
};

await listen("mooring-request", async ({ payload: { id, body } }) => {
  let reply;
  try {
    const req = JSON.parse(body);
    const act = AGENT_ACTIONS[req.action];
    if (!act) throw new Error(`unknown action "${req.action}"`);
    reply = { ok: true, result: await act(req, tabs.get(Number(req.from)) ?? null) };
  } catch (e) {
    reply = { ok: false, error: String(e?.message ?? e) };
  }
  invoke("mooring_reply", { id, body: JSON.stringify(reply) }).catch(() => {});
});

let toastTimer = 0;
function toast(text) {
  let el = document.getElementById("toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    el.setAttribute("role", "status");
    document.body.append(el);
  }
  el.textContent = text;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 3500);
}

// ---- rendering -------------------------------------------------------------

// Two-letter monogram for the rail: "textiq-blueprint" -> "TB", "VKey" -> "VK", "code" -> "Co".
function monogram(name) {
  const words = name.split(/[-_.\s]+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  const w = words[0] || "?";
  const caps = w.match(/[A-Z]/g);
  if (caps && caps.length >= 2) return caps[0] + caps[1];
  return w[0].toUpperCase() + (w[1] || "");
}

function avatarHtml(tab) {
  // shell told apart by badge colour (Ubuntu orange / PowerShell blue) plus the "WSL"/"PowerShell" subtitle
  const phase = `--phase:-${Date.now() % 1600}ms`; // re-rendering must not restart the orbit
  return `<span class="avatar ${tab.status}" style="${phase}"><span class="mono"></span><span class="shell-dot ${tab.shell}"></span></span>`;
}

// group keys; shown through groupName() so they follow the language
const PINNED = "\u0000pinned";
const OTHER = "\u0000other";

function groupName(key) {
  return key === PINNED ? t("group.pinned") : key === OTHER ? t("group.other") : key;
}

function groupKey(tab) {
  if (tab.pinned) return PINNED;
  return tab.root ? baseName(tab.root) : OTHER;
}

function orderedTabs() {
  const groups = new Map();
  for (const t of tabs.values()) {
    const k = groupKey(t);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(t);
  }
  // pinned on top; other groups keep the order the user arranged (first member's position)
  return [...groups.entries()]
    .sort(([a], [b]) => (b === PINNED) - (a === PINNED))
    .flatMap(([, list]) => list);
}

// ---- reordering (drag & drop) -----------------------------------------------

function reorder(ids) {
  const entries = ids.map((id) => [id, tabs.get(id)]);
  tabs.clear();
  for (const [id, t] of entries) tabs.set(id, t);
  render();
  persist();
}

// Move `moving` (tab ids, kept in their order) before/after the tab `targetId`.
function moveIds(moving, targetId, after) {
  if (moving.includes(targetId)) return;
  const rest = [...tabs.keys()].filter((id) => !moving.includes(id));
  const at = rest.indexOf(targetId) + (after ? 1 : 0);
  rest.splice(at, 0, ...moving);
  reorder(rest);
}

function togglePin(tab) {
  tab.pinned = !tab.pinned;
  render();
  persist();
}

let drag = null; // { target, el, ghost, startY, over, after } while a pointer drag is in progress
const DRAG_THRESHOLD = 5; // px before a press becomes a drag (so clicks still click)

function membersOf(key) {
  return orderedTabs().filter((t) => groupKey(t) === key).map((t) => t.id);
}

// Pointer-based drag & drop (WebView2's HTML5 DnD is unreliable inside Tauri on Windows).
function wireDrag(el, target) {
  el.dataset.drag = JSON.stringify(target);
  el.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || e.target.closest("button")) return;
    drag = { target, el, startX: e.clientX, startY: e.clientY, ghost: null, over: null, after: false };
    el.setPointerCapture(e.pointerId);
  });
  el.addEventListener("pointermove", (e) => {
    if (!drag || drag.el !== el) return;
    if (!drag.ghost) {
      if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < DRAG_THRESHOLD) return;
      const r = el.getBoundingClientRect();
      drag.ghost = el.cloneNode(true);
      drag.ghost.classList.add("drag-ghost");
      Object.assign(drag.ghost.style, { width: `${r.width}px`, left: `${r.left}px` });
      document.body.append(drag.ghost);
      el.classList.add("dragging");
      drag.offset = { x: e.clientX - r.left, y: e.clientY - r.top };
    }
    // the ghost follows the pointer: down the list to reorder, or out onto a terminal
    drag.ghost.style.left = `${e.clientX - drag.offset.x}px`;
    drag.ghost.style.top = `${e.clientY - drag.offset.y}px`;
    // find the row/head under the pointer (the ghost ignores pointer events)
    const under = document.elementFromPoint(e.clientX, e.clientY);
    const hit = under?.closest("[data-drag]");
    document.querySelectorAll(".drop-before, .drop-after, .drop-into").forEach((n) => n.classList.remove("drop-before", "drop-after", "drop-into"));
    drag.over = hit && hit !== el ? hit : null;
    // a tab dropped on a terminal brings its context into that chat
    drag.into = target.kind === "tab" ? termTabAt(under) : null;
    if (drag.into?.id === target.id) drag.into = null;
    drag.into?.el.classList.add("drop-into");
    if (drag.over) {
      const r = drag.over.getBoundingClientRect();
      const overTarget = JSON.parse(drag.over.dataset.drag);
      drag.after = overTarget.kind === "tab" && e.clientY > r.top + r.height / 2;
      drag.over.classList.add(drag.after ? "drop-after" : "drop-before");
    }
  });
  const finish = () => {
    if (!drag || drag.el !== el) return;
    const { ghost, over, after, into } = drag;
    drag = null;
    el.classList.remove("dragging");
    document.querySelectorAll(".drop-before, .drop-after, .drop-into").forEach((n) => n.classList.remove("drop-before", "drop-after", "drop-into"));
    if (!ghost) return; // it was a click
    ghost.remove();
    suppressClick = true; // the pointerup of a drag must not also activate the row
    setTimeout(() => (suppressClick = false), 0);
    if (into) shareContext(tabs.get(target.id), into);
    else if (over) drop(target, JSON.parse(over.dataset.drag), after);
  };
  el.addEventListener("pointerup", finish);
  el.addEventListener("pointercancel", finish);
}

let suppressClick = false;

function termTabAt(node) {
  const el = node?.closest(".term.active");
  return el ? [...tabs.values()].find((x) => x.el === el) : null;
}

function drop(source, target, after) {
  const moving = source.kind === "tab" ? [source.id] : membersOf(source.key);
  if (target.kind === "tab") {
    // a whole group dropped on a tab lands next to that tab's group
    const ids = source.kind === "group" ? membersOf(groupKey(tabs.get(target.id))) : [target.id];
    moveIds(moving, after ? ids[ids.length - 1] : ids[0], after);
  } else {
    moveIds(moving, membersOf(target.key)[0], false);
  }
}

function render() {
  const nav = document.getElementById("groups");
  nav.replaceChildren();
  let lastKey = null;
  for (const tab of orderedTabs()) {
    const key = groupKey(tab);
    if (key !== lastKey) {
      lastKey = key;
      const members = [...tabs.values()].filter((t) => groupKey(t) === key);
      const needs = members.filter((t) => t.status === "needs").length;
      const head = document.createElement("div");
      head.className = "group-head";
      head.innerHTML = `${key === PINNED ? icons.pin : `<span class="rule"></span>`}<span class="name"></span><span class="count">${members.length}</span>${needs ? `<span class="needs">${t("group.needs", { n: needs })}</span>` : ""}`;
      head.style.setProperty("--tc", key === PINNED ? theme.ui.text2 : colorsFor(tab.root).accent);
      head.querySelector(".name").textContent = groupName(key);
      if (key === PINNED) head.classList.add("pinned");
      wireDrag(head, { kind: "group", key });
      nav.append(head);
    }
    const row = document.createElement("div");
    row.className = "tab" + (tab.id === state.active ? " active" : state.split?.ids.includes(tab.id) ? " paired" : "");
    row.style.setProperty("--tc", tab.colors.accent);
    row.innerHTML = `${avatarHtml(tab)}<span class="label"><span class="title"></span><span class="sub"></span></span><button class="pin" aria-label="${tab.pinned ? t("tab.unpin") : t("tab.pin")}" title="${tab.pinned ? t("tab.unpin") : t("tab.pin")}">${tab.pinned ? icons.pinOff : icons.pin}</button><button class="close" aria-label="${t("menu.close")}" title="${t("tab.close")}">${icons.x}</button>`;
    row.querySelector(".mono").textContent = monogram(tab.root ? baseName(tab.root) : displayTitle(tab));
    row.querySelector(".title").textContent = displayTitle(tab);
    row.querySelector(".sub").textContent = [shellName(tab), agentLabel(tab), baseName(tab.cwd || "~")].filter(Boolean).join(" · ");
    row.onpointerenter = () => (row.title = tabTooltip(tab)); // built on hover so the time is current
    row.onclick = (e) => {
      if (suppressClick) return;
      if (e.target.closest(".close")) return closeTab(tab.id);
      if (e.target.closest(".pin")) return togglePin(tab);
      if (e.ctrlKey && tab.id !== state.active) { splitWith(tab.id); pane.classList.remove("peek"); return; }
      activate(tab.id);
      pane.classList.remove("peek");
    };
    row.oncontextmenu = (e) => {
      e.preventDefault();
      showTabMenu(e.clientX, e.clientY, {
        accents: theme.accents,
        repoAccent: colorsFor(tab.root).accent,
        color: tab.color,
        pinned: tab.pinned,
        canSplit: tab.id !== state.active && !state.split?.ids.includes(tab.id),
        onShare: tab.id !== state.active ? () => shareContext(tab, tabs.get(state.active)) : null,
        onRestart: tab.shell === "wsl" && hasAgent(tab) ? () => restartFromUi(tab) : null,
        restartLaunchers: launcherChoices(tab),
        launcherCommand: (launcher) => launcherCommand(tab, launcher),
        currentLauncher: tab.agentLauncher,
        onRestartWith: (launcher) => restartFromUi(tab, launcher),
        onSplit: () => splitWith(tab.id),
        onColor: (i) => { tab.color = i; paintTab(tab); render(); persist(); },
        onPin: () => togglePin(tab),
        onClose: () => closeTab(tab.id),
      });
    };
    wireDrag(row, { kind: "tab", id: tab.id });
    nav.append(row);
  }

  if (state.split) {
    for (const x of visibleTabs()) {
      const h = tabHeading(x);
      x.label.firstChild.textContent = h.repo || shellName(x, true);
      x.label.lastChild.textContent = h.name;
    }
  }

  const cur = tabs.get(state.active);
  if (!cur) return;
  const h = tabHeading(cur);
  document.body.style.setProperty("--c", cur.colors.accent);
  // the tab's own title is in the window title and the sidebar; the header adds where it is
  document.getElementById("header-repo").textContent = h.repo;
  document.getElementById("header-cwd").textContent = cur.cwd ? `\u200e${cur.cwd}\u200e` : ""; // LRM keeps "/" in place under rtl
  const title = `[${shellName(cur, true)}] ${h.full} — ${appName}`; // what Alt+Tab shows
  if (title !== windowTitle) win.setTitle((windowTitle = title)).catch(() => {});
}
let windowTitle = "";

// ---- status from the agent's title -------------------------------------------

// Agents animate a glyph at the start of the terminal title while they work (Claude: ◐◓◑◒ / braille,
// then "✳" when idle). Spinner frames arrive many times a second, so re-render only on real changes.
function onTitle(tab, title) {
  const before = { status: tab.status, name: displayTitle(tab) };
  tab.title = title;
  const glyph = title.match(/^[^\p{L}\p{N}\s]+/u)?.[0];
  const was = tab.status;
  if (glyph && glyph !== IDLE_GLYPH) {
    tab.status = "working";
  } else if (tab.status === "working") {
    // finished a turn: if you are not looking at it, it now needs you
    const watching = tab.id === state.active && document.hasFocus();
    tab.status = watching ? "idle" : "needs";
    if (!watching) win.requestUserAttention(2).catch(() => {});
  }
  if (tab.status !== was) {
    tab.since = Date.now();
    for (const w of [...waiters]) w();
  }
  const nameChanged = displayTitle(tab) !== before.name;
  if (nameChanged || tab.status !== before.status) render();
  if (nameChanged) persist();
}

// ---- sidebar: pinned or auto-collapsing rail ------------------------------

hydrateIcons();
const pane = document.getElementById("pane");
let peekTimer = null;

function applySidebar() {
  document.body.classList.toggle("sidebar-auto", state.sidebar === "auto");
  pane.classList.remove("peek");
  fitVisible();
}

function toggleSidebar() {
  state.sidebar = state.sidebar === "auto" ? "pinned" : "auto";
  applySidebar();
  persist();
}

pane.addEventListener("mouseenter", () => {
  if (state.sidebar !== "auto") return;
  clearTimeout(peekTimer);
  peekTimer = setTimeout(() => pane.classList.add("peek"), 120);
});
pane.addEventListener("mouseleave", () => {
  clearTimeout(peekTimer);
  peekTimer = setTimeout(() => pane.classList.remove("peek"), 250);
});
document.getElementById("toggle").onclick = toggleSidebar;
document.getElementById("rail-new").onclick = () => openSameAs(tabs.get(state.active));

// ---- window geometry: remember size/position between runs ------------------

let geoTimer = null;
function rememberGeometry() {
  clearTimeout(geoTimer);
  geoTimer = setTimeout(async () => {
    const maximized = await win.isMaximized();
    if (maximized) state.window = { ...(state.window || {}), maximized };
    else {
      const [pos, size] = await Promise.all([win.outerPosition(), win.innerSize()]);
      state.window = { x: pos.x, y: pos.y, w: size.width, h: size.height, inner: true, maximized: false };
    }
    persist();
  }, 500);
}

async function restoreGeometry(g) {
  try {
    await placeWindow(g);
  } finally {
    await win.show(); // window starts hidden so it doesn't jump; never leave it that way
  }
  win.onResized(rememberGeometry);
  win.onMoved(rememberGeometry);
}

// Put the window back where it was, but always fully inside a monitor's work area (above the taskbar).
async function placeWindow(g) {
  const monitors = await getAvailableMonitors();
  const area = (m) => m.workArea ?? { position: m.position, size: m.size };
  const [outer, inner] = await Promise.all([win.outerSize(), win.innerSize()]);
  // title bar + borders; positions are outer, setSize() is inner
  const deco = { w: outer.width - inner.width, h: outer.height - inner.height };
  const want = g?.w
    ? { x: g.x, y: g.y, w: g.inner ? g.w : g.w - deco.w, h: g.inner ? g.h : g.h - deco.h } // old states saved the outer size
    : null;
  let target = want && monitors.find((m) => {
    const { position: p, size: s } = area(m);
    return want.x + 40 >= p.x && want.y >= p.y && want.x + 40 < p.x + s.width && want.y + 40 < p.y + s.height;
  });
  target ??= (await currentMonitor()) ?? monitors[0];
  if (!target) return;
  const { position: p, size: s } = area(target);
  const w = Math.min(want?.w ?? inner.width, s.width - deco.w);
  const h = Math.min(want?.h ?? inner.height, s.height - deco.h);
  const ow = w + deco.w;
  const oh = h + deco.h;
  const x = want ? Math.min(Math.max(want.x, p.x), p.x + s.width - ow) : p.x + Math.round((s.width - ow) / 2);
  const y = want ? Math.min(Math.max(want.y, p.y), p.y + s.height - oh) : p.y + Math.round((s.height - oh) / 2);
  await win.setSize(new PhysicalSize(w, h));
  await win.setPosition(new PhysicalPosition(x, y));
  if (g?.maximized) await win.maximize();
}

// ---- boot ------------------------------------------------------------------

await listen("pty-exit", ({ payload: id }) => {
  const tab = tabs.get(id);
  if (!tab) return;
  tab.status = "exited";
  tab.term.write(`\r\n\x1b[2m[${t("term.exited")}]\x1b[0m\r\n`);
  const sub = tab.term.onKey(({ domEvent }) => {
    if (domEvent.key === "Enter") { sub.dispose(); spawn(tab); render(); }
  });
  render();
});

// Re-fit whenever the terminal area changes size: window resize, sidebar pin/unpin, maximise.
new ResizeObserver(fitVisible).observe(area);

document.addEventListener("keydown", (e) => {
  if (!handleShortcut(e)) return;
  e.preventDefault();
  e.stopPropagation();
}, true);

// It's an app, not a page: no WebView context menu (Back/Refresh/Print…) and no browser keys
// that would reload the page (killing every shell) or print it. Terminals have already seen the
// key by the time it bubbles here, so Ctrl+R / Ctrl+P still reach bash and Claude.
document.addEventListener("contextmenu", (e) => e.preventDefault());
document.addEventListener("keydown", (e) => {
  const k = e.key.toLowerCase();
  if (k === "f5" || k === "f3" || k === "f7" || (e.ctrlKey && ["r", "p", "f", "g", "j", "u", "s", "o"].includes(k))) e.preventDefault();
});
document.querySelectorAll("#new-buttons button").forEach((b) => {
  b.onclick = () => {
    const cur = tabs.get(state.active);
    const shell = b.dataset.shell;
    openTab({ shell, cwd: cur && cur.shell === shell ? cur.cwd : "" });
  };
});

document.getElementById("keys-btn").onclick = () => toggleShortcuts();
document.getElementById("hb-search").onclick = searchActive;
document.getElementById("hb-split-right").onclick = () => splitNew("row");
document.getElementById("hb-split-down").onclick = () => splitNew("col");
document.getElementById("hb-rotate").onclick = () => rotateSplit();
document.getElementById("hb-unsplit").onclick = () => unsplit();

const saved = JSON.parse((await invoke("load_state")) || "null");
state.fontSize = saved?.fontSize || state.fontSize;
// an existing setup predates the language choice and was Vietnamese
state.lang = setLang(saved?.lang || (saved ? "vi" : defaultLang()));
state.sidebar = saved?.sidebar || state.sidebar;
state.defaultShell = saved?.defaultShell || state.defaultShell;
state.waitingOpen = !!saved?.waitingOpen;
state.theme = saved?.theme || "mocha";
setTheme(state.theme);
const themeBtn = document.getElementById("theme-btn");
themeBtn.onclick = () => toggleThemePicker(themeBtn, {
  current: () => state.theme,
  preview: (id) => setTheme(id),
  commit: (id) => setTheme(id, true),
  shell: () => state.defaultShell,
  onShell: (shell) => {
    state.defaultShell = shell;
    persist();
  },
  onLang: (code) => {
    state.lang = setLang(code); // relabels everything marked data-i18n-*
    render(); // the sidebar is built with t()
    persist();
  },
});
state.window = saved?.window || null;
applySidebar();
await restoreGeometry(state.window);

// Closing the window kills every shell in it: ask first while agents are running.
let closingConfirmed = false;
win.onCloseRequested(async (event) => {
  if (closingConfirmed) return;
  const agents = orderedTabs().filter(hasAgent);
  if (!agents.length) return;
  event.preventDefault();
  const busy = agents.filter((t) => t.status === "working").length;
  const ok = await confirmDialog({
    title: busy ? t("close.app.busyTitle", { n: busy }) : t("close.app.openTitle", { n: agents.length }),
    body: busy ? t("close.app.busyBody") : t("close.app.idleBody"),
    items: agents.map((x) => ({
      name: tabHeading(x).full,
      note: x.status === "working" ? t("close.app.noteWorking") : x.status === "needs" ? t("close.app.noteNeeds") : "",
      busy: x.status === "working",
      color: x.colors.accent,
    })),
    confirmLabel: t("close.app.confirm"),
  });
  if (ok) {
    closingConfirmed = true;
    await win.destroy();
  }
});
// Last session's tabs come back only if asked to; otherwise one fresh tab of the shell last used.
// (Agents cut off then stay queued in agent-tabs either way: `agent-resume` picks one up later.)
// Resolves to the tabs to reopen (each has a checkbox, all ticked); none means a fresh tab.
function askRestore(list) {
  const agents = list.filter(hasAgent).length;
  const items = list.map((x) => ({
    name: displayTitle(x),
    note: hasAgent(x) ? "agent" : shellName(x),
    color: x.shell === "wsl" ? "var(--wsl)" : "var(--ps)",
    checked: true,
  }));
  return confirmDialog({
    title: t("restore.title", { n: list.length }),
    body: agents ? t("restore.bodyAgents", { n: agents }) : t("restore.body"),
    items,
    confirmLabel: t("restore.yes"),
    cancelLabel: t("restore.no"),
    safe: "confirm",
  }).then((ok) => (ok ? list.filter((_, i) => items[i].checked) : []));
}

state.distro = saved?.distro || state.distro;
// ids of tabs not reopened stay retired: their agent sessions are filed under them, and a new tab
// with a recycled id would pick one up when it is next restored
state.nextId = Math.max(saved?.nextId ?? 1, ...(saved?.tabs ?? []).map((x) => x.id + 1));
const reopen = saved?.tabs?.length ? await askRestore(saved.tabs) : [];
if (reopen.length) {
  const wanted = saved.active;
  // all at once: each waits on a git lookup and a shell start, none on the others
  restoring = true;
  await Promise.all(reopen.map((t) => openTab({ ...t, show: false })));
  restoring = false;
  const split = saved.split;
  if (split?.ids?.length === 2 && split.ids.every((id) => tabs.has(id)) && split.ids[0] !== split.ids[1]) {
    state.split = { ids: [...split.ids], dir: split.dir === "col" ? "col" : "row", ratio: Number(split.ratio) || 0.5 };
  }
  activate(tabs.has(wanted) ? wanted : tabs.keys().next().value);
  warmUp();
  setTimeout(refreshWaiting, 12000); // after restored tabs had their turn to claim
} else {
  await openTab({ shell: state.defaultShell });
}
refreshWaiting();
refreshAgents();
setInterval(() => refreshAgents().catch(() => {}), 5000);
// keep the list current: when the window comes back to the front, and once a minute
window.addEventListener("focus", () => { if (Date.now() - waitingAt > 5000) refreshWaiting(); });
setInterval(refreshWaiting, 60000);
