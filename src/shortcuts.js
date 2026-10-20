// The keyboard cheat sheet (F1 / Ctrl+/). Keep in step with handleShortcut() in main.js.
import { t } from "./i18n.js";
import { dismissable } from "./popover.js";

// Each row: [keys, description key]. Keys are " · "-separated alternatives; a part starting
// with "@" is a translation key for prose ("Right-click a tab") rather than a key combo.
const SECTIONS = [
  ["sc.tabs", [
    ["Ctrl+Shift+T", "sc.newTab"],
    ["Ctrl+Shift+W", "sc.closeTab"],
    ["Ctrl+Tab · Ctrl+Shift+Tab", "sc.nextPrev"],
    ["Ctrl+1 … 9", "sc.nth"],
    ["Ctrl+B", "sc.sidebar"],
    ["@sc.k.rightClickTab", "sc.tabMenu"],
    ["@sc.k.drag", "sc.reorder"],
    ["@sc.k.dragToTerm", "sc.share"],
  ]],
  ["sc.split", [
    ["Ctrl+Shift+D", "sc.splitRight"],
    ["Ctrl+Shift+E", "sc.splitDown"],
    ["@sc.k.ctrlClickTab", "sc.splitWith"],
    ["Alt+← → ↑ ↓", "sc.focusOther"],
    ["Ctrl+Shift+R", "sc.rotate"],
    ["Ctrl+Shift+X", "sc.unsplit"],
    ["@sc.k.dragDivider", "sc.ratio"],
  ]],
  ["sc.terminal", [
    ["Ctrl+Shift+F", "sc.find"],
    ["Enter · Shift+Enter", "sc.findStep"],
    ["Ctrl+C @sc.k.withSelection", "sc.copy"],
    ["Ctrl+V · @sc.k.rightClick", "sc.paste"],
    ["Ctrl+Click", "sc.openLink"],
    ["Ctrl+Shift+Click", "sc.reveal"],
    ["Ctrl+= · Ctrl+- · Ctrl+0", "sc.zoom"],
    ["@sc.k.scrub", "sc.scrub"],
  ]],
  ["sc.general", [
    ["Ctrl+Shift+P", "sc.palette"],
    ["F1 · Ctrl+/", "sc.sheet"],
    ["Esc", "sc.esc"],
  ]],
];

// "Ctrl+Shift+T" -> <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>T</kbd>; "@key" -> translated prose
function keysHtml(keys) {
  const esc = (x) => x.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return keys.split(" · ").map((alt) => alt.split(" ").map((part) =>
    part.startsWith("@") ? `<span class="sc-text">${esc(t(part.slice(1)))}</span>`
      : part.split(/(?<=\S)\+(?=\S)/).map((p) => `<kbd>${esc(p)}</kbd>`).join("<i>+</i>")).join(" ")).join("<i>·</i>");
}

let open = null;

export function toggleShortcuts() {
  if (open) return open.close();
  const back = document.createElement("div");
  back.className = "dialog-backdrop";
  back.innerHTML = `<div class="dialog shortcuts" role="dialog" aria-modal="true" aria-labelledby="sc-title">
    <h2 id="sc-title">${t("sc.title")}</h2><div class="sc-cols"></div></div>`;
  const cols = back.querySelector(".sc-cols");
  for (const [title, rows] of SECTIONS) {
    const sec = document.createElement("section");
    sec.innerHTML = `<h3></h3><dl></dl>`;
    sec.querySelector("h3").textContent = t(title);
    const dl = sec.querySelector("dl");
    for (const [keys, what] of rows) {
      const dt = document.createElement("dt");
      dt.innerHTML = keysHtml(keys);
      const dd = document.createElement("dd");
      dd.textContent = t(what);
      dl.append(dt, dd);
    }
    cols.append(sec);
  }
  document.body.append(back);
  // F1 / Ctrl+/ again reach toggleShortcuts() through the deck's shortcut handler
  open = { close: dismissable(back, { inside: (target) => target !== back, onClose: () => (open = null) }) };
}
