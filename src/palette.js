// Command palette (Ctrl+Shift+P): type to filter tabs and deck commands, arrows to move,
// Enter to run, Esc to close.
import { dismissable } from "./popover.js";
import { t } from "./i18n.js";

let open = null;

// every typed word must appear somewhere in the label (any order)
const matches = (label, query) => query.toLowerCase().split(/\s+/).every((w) => label.toLowerCase().includes(w));

/** items: [{ label, hint?, color?, run }] */
export function togglePalette(items) {
  if (open) return open.close();
  const back = document.createElement("div");
  back.className = "palette-backdrop";
  back.innerHTML = `<div class="palette" role="dialog" aria-modal="true">
    <input type="text" spellcheck="false" aria-label="">
    <ul role="listbox"></ul></div>`;
  const input = back.querySelector("input");
  const list = back.querySelector("ul");
  input.placeholder = t("palette.placeholder");
  input.setAttribute("aria-label", input.placeholder);
  let shown = [];
  let at = 0;

  function draw() {
    shown = items.filter((it) => matches(`${it.label} ${it.hint ?? ""}`, input.value));
    at = Math.min(at, Math.max(0, shown.length - 1));
    list.replaceChildren(...shown.map((it, i) => {
      const li = document.createElement("li");
      li.setAttribute("role", "option");
      li.className = i === at ? "on" : "";
      li.innerHTML = `<span class="dot"></span><span class="label"></span><span class="hint"></span>`;
      li.style.setProperty("--tc", it.color ?? "transparent");
      li.querySelector(".label").textContent = it.label;
      li.querySelector(".hint").textContent = it.hint ?? "";
      li.onpointerenter = () => { at = i; mark(); };
      li.onclick = () => run(i);
      return li;
    }));
  }
  const mark = () => [...list.children].forEach((li, i) => li.classList.toggle("on", i === at));
  function run(i) {
    const it = shown[i];
    close();
    it?.run();
  }

  input.addEventListener("input", () => { at = 0; draw(); });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      at = (at + (e.key === "ArrowDown" ? 1 : -1) + shown.length) % Math.max(1, shown.length);
      mark();
      list.children[at]?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") {
      e.preventDefault();
      run(at);
    }
  });
  document.body.append(back);
  const close = dismissable(back, { inside: (target) => target !== back, onClose: () => (open = null) });
  open = { close };
  draw();
  input.focus();
}
