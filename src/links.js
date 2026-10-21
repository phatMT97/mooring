// Ctrl+Click file paths and URLs in the terminal: open with the default app, or
// Ctrl+Shift+Click to reveal the file in Explorer. Only paths that exist are linked.
import { invoke } from "@tauri-apps/api/core";
import { t } from "./i18n.js";
import { attachWebLinks } from "./web-links.js";

const URL_RE = /\bhttps?:\/\/[^\s"'<>`]+[^\s"'<>`.,;:!?)\]]/g;
// paths with a separator (docs/a.md, ./x, ~/x, /abs, C:\x) or bare file names with an extension;
// an optional :line[:col] suffix is matched and dropped
const PATH_RE = /(?:[A-Za-z]:[\\/]|~[\\/]|\.{1,2}[\\/]|[\\/])?(?:[\w.@+\-]+[\\/])*[\w@+\-][\w.@+\-]*\.[A-Za-z0-9]{1,10}(?::\d+(?::\d+)?)?|(?:[A-Za-z]:[\\/]|~[\\/]|\.{1,2}[\\/]|\/)(?:[\w.@+\-]+[\\/]?)+/g;

// Absolute paths whose folders contain spaces ("C:\Users\me\OneDrive - Org\a.png", "/mnt/c/…/My Docs/x.md").
// Spaces make the end ambiguous, so the file name runs only to the first extension followed by a
// boundary; links still appear only for paths that exist.
const SPACED_RE = /[A-Za-z]:\\(?:[^\\\n"'<>|*?:]+\\)+[^\\\n"'<>|*?:]+?\.[A-Za-z0-9]{1,10}(?=$|[\s"'),;!?\]]|\.(?:\s|$))|(?:~|\/mnt\/[a-z]|\/home)\/(?:[^\/\n"'<>|*?:]+\/)+[^\/\n"'<>|*?:]+?\.[A-Za-z0-9]{1,10}(?=$|[\s"'),;!?\]]|\.(?:\s|$))/g;

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
  const webLinks = attachWebLinks(term, {
    open: (url) => invoke("open_path", { path: url, reveal: false }),
    hover: (e, url) => showTip(e, `${t("link.url")} · ${url}`),
    leave: hideTip,
    onError: ctx.onError,
  });
  term.registerLinkProvider({
    async provideLinks(y, callback) {
      const line = term.buffer.active.getLine(y - 1)?.translateToString(true) ?? "";
      const found = [];
      const taken = []; // [start, end) ranges already claimed by URLs

      for (const m of line.matchAll(URL_RE)) {
        taken.push([m.index, m.index + m[0].length]);
        found.push(makeLink(y, m.index, m[0], { url: m[0] }, webLinks, ctx.onError));
      }
      const spaced = [...line.matchAll(SPACED_RE)].filter((m) => m[0].includes(" "));
      const candidates = [...spaced, ...line.matchAll(PATH_RE)].filter(
        (m) => !taken.some(([a, b]) => m.index < b && m.index + m[0].length > a));
      const paths = [];
      await Promise.all(candidates.map(async (m) => {
        const raw = m[0].replace(/:\d+(?::\d+)?$/, "").replace(/[.\\/]+$/, "");
        if (raw.length < 3) return;
        const winPath = await resolve(raw, ctx);
        if (!winPath) return;
        const kind = await pathKind(winPath);
        if (kind) paths.push({ m, link: makeLink(y, m.index, m[0], { path: winPath, kind }, webLinks, ctx.onError) });
      }));
      // a spaced path that exists wins over the fragments of it the plain pattern also found
      for (const { m, link } of paths) {
        const inside = paths.some((o) => o.m !== m && o.m[0].length > m[0].length
          && o.m.index <= m.index && o.m.index + o.m[0].length >= m.index + m[0].length);
        if (!inside) found.push(link);
      }
      callback(found.length ? found : undefined);
    },
  });
}

function makeLink(y, index, text, target, webLinks, onError = () => {}) {
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
    if (/^[A-Za-z]:\//.test(p)) return raw.replaceAll("/", "\\"); // already a Windows path
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
