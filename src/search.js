// Find in a terminal's output (its 10k-line scrollback plus the screen). Each tab owns its bar,
// docked in its pane: it hides with the tab and goes away with it. Enter / Shift+Enter step
// through matches, Esc closes.
import { SearchAddon } from "@xterm/addon-search";
import { icons } from "./icons.js";
import { translateDom } from "./i18n.js";

const TYPE_DELAY_MS = 90; // a full-scrollback scan per keystroke is wasted while still typing

export function attachSearch(tab) {
  tab.search = new SearchAddon();
  tab.term.loadAddon(tab.search);
}

function decorations() {
  const css = getComputedStyle(document.documentElement);
  const needs = css.getPropertyValue("--needs").trim();
  const c = css.getPropertyValue("--c").trim();
  return {
    matchBackground: `${needs}55`,
    matchBorder: `${needs}00`,
    matchOverviewRuler: needs,
    activeMatchBackground: c,
    activeMatchBorder: c,
    activeMatchColorOverviewRuler: c,
  };
}

export function openSearch(tab) {
  if (tab.searchBar) return tab.searchBar.focus();

  const el = document.createElement("div");
  el.className = "search-bar";
  el.innerHTML = `
    ${icons.search}
    <input type="text" spellcheck="false" data-i18n-placeholder="search.placeholder" data-i18n-label="search.placeholder">
    <span class="sb-count"></span>
    <button class="sb-case" data-i18n-label="search.case" aria-pressed="false">Aa</button>
    <button class="sb-prev" data-i18n-label="search.prev">${icons.chevronUp}</button>
    <button class="sb-next" data-i18n-label="search.next">${icons.chevronDown}</button>
    <button class="sb-close" data-i18n-label="search.close">${icons.x}</button>`;
  translateDom(el);
  tab.el.append(el);
  const input = el.querySelector("input");
  const count = el.querySelector(".sb-count");
  const caseBtn = el.querySelector(".sb-case");
  // keep the text the user selected in the terminal as the starting query
  if (tab.term.hasSelection()) input.value = tab.term.getSelection().split("\n")[0].slice(0, 200);

  let caseSensitive = false;
  let typing = 0;
  const deco = decorations(); // the theme can't change while typing here
  const opts = (incremental = false) => ({ caseSensitive, decorations: deco, incremental });
  const find = (back) => {
    clearTimeout(typing);
    if (!input.value) { tab.search.clearDecorations(); count.textContent = ""; return; }
    const hit = back ? tab.search.findPrevious(input.value, opts()) : tab.search.findNext(input.value, opts());
    if (!hit) count.textContent = "0";
  };
  const sub = tab.search.onDidChangeResults(({ resultIndex, resultCount }) => {
    count.textContent = resultCount ? `${resultIndex + 1}/${resultCount}` : "0";
  });

  input.addEventListener("input", () => {
    clearTimeout(typing);
    if (!input.value) return find();
    typing = setTimeout(() => tab.search.findNext(input.value, opts(true)) || (count.textContent = "0"), TYPE_DELAY_MS);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); find(e.shiftKey); }
    else if (e.key === "Escape") { e.preventDefault(); close(); }
    e.stopPropagation(); // typing here is not for the terminal or the deck's shortcuts
  });
  caseBtn.onclick = () => {
    caseSensitive = !caseSensitive;
    caseBtn.setAttribute("aria-pressed", String(caseSensitive));
    find();
    input.focus();
  };
  el.querySelector(".sb-prev").onclick = () => { find(true); input.focus(); };
  el.querySelector(".sb-next").onclick = () => { find(false); input.focus(); };
  el.querySelector(".sb-close").onclick = () => close();

  function close() {
    clearTimeout(typing);
    sub.dispose();
    tab.search.clearDecorations();
    el.remove();
    tab.searchBar = null;
    tab.term.focus();
  }
  tab.searchBar = { focus: () => { input.focus(); input.select(); } };
  tab.searchBar.focus();
  if (input.value) find();
}
