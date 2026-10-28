// Ctrl+Click file paths and URLs in the terminal: open with the default app, or
// Ctrl+Shift+Click to reveal the file in Explorer. Only paths that exist are linked.
import { invoke } from "@tauri-apps/api/core";
import { attachWebLinks } from "./web-links.js";

export const URL_RE = /\bhttps?:\/\/[^\s"'<>`]+[^\s"'<>`.,;:!?)\]]/g;
// Quoted paths: "C:\path with spaces\file.ext", '~/my docs/a.txt', `C:/foo bar/baz`
export const QUOTED_PATH_RE = /(?<=["'`])((?:[A-Za-z]:[\\/]|~[\\/]|\.{1,2}[\\/]|[\\/])[^"'\r\n<>|*?]+?)(?=["'`])/g;
// paths with a separator (docs/a.md, ./x, ~/x, /abs, C:\x) or bare file names with an extension;
// an optional :line[:col] suffix is matched and dropped
const PATH_RE = /(?:[A-Za-z]:[\\/]|~[\\/]|\.{1,2}[\\/]|[\\/])?(?:[\w.@+\-]+[\\/])*[\w@+\-][\w.@+\-]*\.[A-Za-z0-9]{1,10}(?::\d+(?::\d+)?)?|(?:[A-Za-z]:[\\/]|~[\\/]|\.{1,2}[\\/]|\/)(?:[\w.@+\-]+[\\/]?)+/g;

// Absolute paths whose folders contain spaces ("C:\Users\me\OneDrive - Org\a.png", "C:/Users/...", "/mnt/c/…/My Docs/x.md").
// Spaces make the end ambiguous, so the file name runs only to the first extension followed by a
// boundary; links still appear only for paths that exist.
export const SPACED_RE = /[A-Za-z]:[\\/](?:[^\\/\n"'<>|*?:]+[\\/])+[^\\/\n"'<>|*?:]+?\.[A-Za-z0-9]{1,10}(?=$|[\s"'),;!?\]]|\.(?:\s|$))|(?:~|\/mnt\/[a-z]|\/home)\/(?:[^\/\n"'<>|*?:]+\/)+[^\/\n"'<>|*?:]+?\.[A-Za-z0-9]{1,10}(?=$|[\s"'),;!?\]]|\.(?:\s|$))/g;

const kindCache = new Map(); // windows path -> { kind, at }
const CACHE_MS = 5000;

async function pathKind(winPath) {
  const hit = kindCache.get(winPath);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.kind;
  const kind = await invoke("path_kind", { path: winPath }).catch(() => null);
  kindCache.set(winPath, { kind, at: Date.now() });
  return kind;
}

let tooltip = null;
function showTip(e, text) {
  tooltip ??= Object.assign(document.createElement("div"), { className: "link-tip" });
  tooltip.textContent = text;
  tooltip.style.left = `${e.clientX + 12}px`;
  tooltip.style.top = `${e.clientY + 16}px`;
  document.body.append(tooltip);
}
function hideTip() { tooltip?.remove(); }

/**
 * @param term xterm Terminal
 * @param ctx  { shell, cwd, toWin, home, onError }
 */
export function attachLinks(term, ctx) {
  const t = ctx.t || ((k) => k);
  const webLinks = attachWebLinks(term, {
    open: (url) => invoke("open_path", { path: url, reveal: false }),
    hover: (e, url) => showTip(e, `${t("link.url")} · ${url}`),
    leave: hideTip,
    onError: ctx.onError,
  });

  // Synchronous link provider for plain web URLs so hover and double-click selection are immediate
  term.registerLinkProvider({
    provideLinks(y, callback) {
      const line = term.buffer.active.getLine(y - 1)?.translateToString(true) ?? "";
      const found = [];
      for (const m of line.matchAll(URL_RE)) {
        found.push(makeLink(y, m.index, m[0], { url: m[0] }, webLinks, ctx.onError, t));
      }
      callback(found.length ? found : undefined);
    },
  });

  // Asynchronous link provider for local filesystem paths verified against OS
  term.registerLinkProvider({
    async provideLinks(y, callback) {
      const line = term.buffer.active.getLine(y - 1)?.translateToString(true) ?? "";
      const taken = [];
      for (const m of line.matchAll(URL_RE)) {
        taken.push([m.index, m.index + m[0].length]);
      }
      const quoted = [...line.matchAll(QUOTED_PATH_RE)];
      const spaced = [...line.matchAll(SPACED_RE)].filter((m) => m[0].includes(" "));
      const seen = new Set();
      const candidates = [...quoted, ...spaced, ...line.matchAll(PATH_RE)].filter((m) => {
        if (taken.some(([a, b]) => m.index < b && m.index + m[0].length > a)) return false;
        const key = `${m.index}:${m[0].length}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      const paths = [];
      await Promise.all(candidates.map(async (m) => {
        const raw = m[0].replace(/:\d+(?::\d+)?$/, "").replace(/[.\\/]+$/, "");
        if (raw.length < 3) return;
        const winPath = await resolve(raw, ctx);
        if (!winPath) return;
        const kind = await pathKind(winPath);
        if (kind) paths.push({ m, link: makeLink(y, m.index, m[0], { path: winPath, kind }, webLinks, ctx.onError, t) });
      }));
      // a spaced path that exists wins over the fragments of it the plain pattern also found
      const found = [];
      for (const { m, link } of paths) {
        const inside = paths.some((o) => o.m !== m && o.m[0].length > m[0].length
          && o.m.index <= m.index && o.m.index + o.m[0].length >= m.index + m[0].length);
        if (!inside) found.push(link);
      }
      callback(found.length ? found : undefined);
    },
  });
}

/**
 * Returns the selected terminal text, resolving OSC 8 hyperlinks so target URIs
 * are preserved when copying instead of dropping them or copying only visible labels.
 */
export function getSelectedText(term) {
  if (!term.hasSelection()) return "";
  const raw = term.getSelection();
  const sel = term.getSelectionPosition();
  if (!sel) return raw;

  const oscService = term._core?._oscLinkService;
  const buffer = term.buffer?.active;
  if (!oscService || !buffer) return raw;

  const { start, end } = sel;

  // 1. Check if selection is entirely within a single OSC 8 link
  let singleUrl = null;
  let hasOsc = false;
  let hasNonOscChar = false;

  for (let y = start.y; y <= end.y; y++) {
    const line = buffer.getLine(y);
    if (!line) continue;
    const x0 = (y === start.y) ? start.x : 0;
    const x1 = (y === end.y) ? end.x : line.length;
    for (let x = x0; x < x1; x++) {
      const cell = line.getCell(x);
      if (!cell) continue;
      const urlId = cell.hasExtendedAttrs() ? cell.extended?.urlId : null;
      if (urlId) {
        hasOsc = true;
        const uri = oscService.getLinkData(urlId)?.uri;
        if (uri) {
          if (!singleUrl) singleUrl = uri;
          else if (singleUrl !== uri) hasNonOscChar = true;
        }
      } else if (cell.getChars().trim()) {
        hasNonOscChar = true;
      }
    }
  }

  if (hasOsc && !hasNonOscChar && singleUrl) {
    return singleUrl;
  }

  // 2. If the selection spans multiple words/lines containing OSC 8 links, resolve link runs
  if (hasOsc) {
    const lines = [];
    for (let y = start.y; y <= end.y; y++) {
      const line = buffer.getLine(y);
      if (!line) continue;
      const x0 = (y === start.y) ? start.x : 0;
      const x1 = (y === end.y) ? end.x : line.translateToString(true).length;
      let lineStr = "";
      let currentUrlId = null;
      let currentLabel = "";

      const flushLink = () => {
        if (currentUrlId) {
          const uri = oscService.getLinkData(currentUrlId)?.uri;
          if (uri) {
            lineStr += (currentLabel.trim() && currentLabel !== uri) ? `${currentLabel} (${uri})` : uri;
          } else {
            lineStr += currentLabel;
          }
          currentUrlId = null;
          currentLabel = "";
        }
      };

      for (let x = x0; x < x1; x++) {
        const cell = line.getCell(x);
        if (!cell) continue;
        const urlId = cell.hasExtendedAttrs() ? cell.extended?.urlId : null;
        if (urlId) {
          if (currentUrlId && currentUrlId !== urlId) {
            flushLink();
          }
          currentUrlId = urlId;
          currentLabel += cell.getChars();
        } else {
          flushLink();
          lineStr += cell.getChars();
        }
      }
      flushLink();
      lines.push(lineStr);
    }
    return lines.join("\n");
  }

  return raw;
}

/**
 * Checks if a mouse event in the terminal landed on an OSC 8 link or URL.
 */
export function findLinkAtEvent(term, e, parentEl) {
  const mouseService = term._core?._mouseService;
  if (!mouseService) return null;
  const coords = mouseService.getCoords(e, parentEl, term.cols, term.rows, true);
  if (!coords) return null;
  const [col, row] = coords;
  const buffer = term.buffer?.active;
  const line = buffer?.getLine(row - 1);
  if (!line) return null;

  // 1. Check OSC 8 link
  const cell = line.getCell(col - 1);
  const urlId = cell?.hasExtendedAttrs() ? cell.extended?.urlId : null;
  if (urlId) {
    const uri = term._core?._oscLinkService?.getLinkData(urlId)?.uri;
    if (uri) return uri;
  }

  // 2. Check plain text URL on this line
  const text = line.translateToString(true);
  for (const m of text.matchAll(URL_RE)) {
    const start = m.index;
    const end = m.index + m[0].length;
    if (col - 1 >= start && col - 1 < end) {
      return m[0];
    }
  }

  // 3. Check quoted or spaced file paths on this line
  for (const m of [...text.matchAll(QUOTED_PATH_RE), ...text.matchAll(SPACED_RE)]) {
    const start = m.index;
    const end = m.index + m[0].length;
    if (col - 1 >= start && col - 1 < end) {
      return m[0];
    }
  }

  return null;
}

function makeLink(y, index, text, target, webLinks, onError = () => {}, t = (k) => k) {
  const tip = target.url
    ? t("link.url")
    : target.kind === "dir"
      ? t("link.dir")
      : t("link.file");
  return {
    range: { start: { x: index + 1, y }, end: { x: index + text.length, y } },
    text,
    decorations: { pointerCursor: true, underline: true },
    activate(e) {
      if (target.url) return webLinks.activate(e, target.url);
      if (!e.ctrlKey) return; // plain clicks stay text selection
      return invoke("open_path", { path: target.path, reveal: e.shiftKey && target.kind !== "dir" }).catch(onError);
    },
    hover: (e) => target.url ? webLinks.hover(e, target.url) : showTip(e, tip),
    leave: hideTip,
  };
}

async function resolve(raw, ctx) {
  const cwd = ctx.cwd();
  if (ctx.shell() === "wsl") {
    let p = raw.replaceAll("\\", "/");
    if (/^[A-Za-z]:\//.test(p)) return normalize(raw.replaceAll("/", "\\"), "\\"); // already a Windows path
    if (p.startsWith("~/")) {
      const home = await ctx.home();
      if (!home) return null;
      p = home + p.slice(1);
    } else if (!p.startsWith("/")) {
      if (!cwd) return null;
      p = `${cwd.replace(/\/$/, "")}/${p}`;
    }
    return ctx.toWin(normalize(p, "/"));
  }
  let p = raw.replaceAll("/", "\\");
  if (/^[A-Za-z]:\\/.test(p)) return normalize(p, "\\");
  if (p.startsWith("~\\")) return null; // no home lookup for PowerShell tabs yet
  if (!cwd) return null;
  p = `${cwd.replace(/\\$/, "")}\\${p}`;
  return normalize(p, "\\");
}

// collapse "." and ".." segments
function normalize(p, sep) {
  const head = sep === "/" ? (p.startsWith("/") ? "/" : "") : (p.match(/^[A-Za-z]:\\|^\\\\/)?.[0] ?? "");
  const out = [];
  for (const part of p.slice(head.length).split(sep)) {
    if (!part || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return head + out.join(sep);
}
