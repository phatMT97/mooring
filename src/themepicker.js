// Appearance popover: language, the shell of a fresh tab, then a card per theme with a miniature of the deck. Hovering a
// card previews it live, clicking keeps it; leaving the popover, Esc or clicking outside falls
// back to the kept theme.
import { THEMES } from "./themes.js";
import { icons } from "./icons.js";
import { t, LANGS, lang } from "./i18n.js";
import { dismissable } from "./popover.js";

let open = null; // the popover while shown

export function toggleThemePicker(anchor, { current, preview, commit, onLang, shell, onShell, sound, onSound }) {
  if (open) return open.close();

  const pop = document.createElement("div");
  pop.className = "theme-pop";
  pop.setAttribute("role", "dialog");
  let kept = current();

  function build() {
    pop.setAttribute("aria-label", t("appearance"));
    pop.innerHTML = `
      <div class="tp-section">${t("picker.language")}</div>
      <div class="tp-langs" role="radiogroup"></div>
      <div class="tp-section">${t("picker.defaultShell")}</div>
      <div class="tp-langs tp-shells" role="radiogroup"></div>
      ${sound && onSound ? `
      <div class="tp-section">${t("picker.sound")}</div>
      <div class="tp-langs tp-sounds" role="radiogroup"></div>` : ""}
      <div class="tp-section">${t("picker.theme")} · ${t("picker.dark")}</div><div class="tp-grid dark"></div>
      <div class="tp-section">${t("picker.theme")} · ${t("picker.light")}</div><div class="tp-grid light"></div>`;

    for (const l of LANGS) {
      const b = document.createElement("button");
      b.className = "tp-lang" + (l.code === lang() ? " on" : "");
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", String(l.code === lang()));
      b.textContent = l.name;
      b.onclick = () => { onLang(l.code); build(); };
      pop.querySelector(".tp-langs").append(b);
    }

    for (const [code, name] of [["wsl", "WSL"], ["powershell", "PowerShell"]]) {
      const b = document.createElement("button");
      b.className = "tp-lang" + (code === shell() ? " on" : "");
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", String(code === shell()));
      b.textContent = name;
      b.onclick = () => { onShell(code); build(); };
      pop.querySelector(".tp-shells").append(b);
    }

    if (sound && onSound) {
      for (const [val, label] of [[true, t("picker.soundOn")], [false, t("picker.soundOff")]]) {
        const b = document.createElement("button");
        b.className = "tp-lang" + (val === sound() ? " on" : "");
        b.setAttribute("role", "radio");
        b.setAttribute("aria-checked", String(val === sound()));
        b.textContent = label;
        b.onclick = () => { onSound(val); build(); };
        pop.querySelector(".tp-sounds").append(b);
      }
    }

    for (const th of THEMES) {
      const card = document.createElement("button");
      card.className = "tp-card" + (th.id === kept ? " on" : "");
      card.dataset.id = th.id;
      const a = th.accents;
      card.innerHTML = `
        <span class="tp-mock" style="background:${th.ui.side}">
          <span class="tp-side">
            <i style="background:${a[0]}"></i><i style="background:${a[1]}"></i><i style="background:${a[2]}"></i>
          </span>
          <span class="tp-term" style="background:${th.ui.layer};box-shadow:inset 0 2px 0 ${a[4]}">
            <b style="width:70%;background:${th.term.foreground}"></b>
            <b style="width:45%;background:${a[2]}"></b>
            <b style="width:58%;background:${a[4]}"></b>
            <b style="width:30%;background:${a[3]}"></b>
          </span>
        </span>
        <span class="tp-name">${th.name}<span class="tp-check">${icons.check}</span></span>`;
      card.onpointerenter = () => preview(th.id);
      card.onfocus = () => preview(th.id);
      card.onclick = () => {
        kept = th.id;
        commit(th.id);
        for (const c of pop.querySelectorAll(".tp-card")) c.classList.toggle("on", c.dataset.id === kept);
      };
      pop.querySelector(`.tp-grid.${th.kind}`).append(card);
    }
  }
  build();
  pop.onpointerleave = () => preview(kept);

  const r = anchor.getBoundingClientRect();
  pop.style.left = `${Math.max(8, r.left)}px`;
  pop.style.top = `${r.bottom + 6}px`;
  document.body.append(pop);
  // keep it on screen when the sidebar is a narrow rail or the window is short
  const pr = pop.getBoundingClientRect();
  if (pr.right > innerWidth - 8) pop.style.left = `${Math.max(8, innerWidth - 8 - pr.width)}px`;
  if (pr.bottom > innerHeight - 8) pop.style.maxHeight = `${innerHeight - 8 - pr.top}px`;

  // a press on the anchor is the toggle's own: it closes through toggleThemePicker()
  const close = dismissable(pop, {
    inside: (target) => pop.contains(target) || anchor.contains(target),
    onClose: () => { preview(kept); anchor.classList.remove("on"); open = null; },
  });
  anchor.classList.add("on");
  open = { close };
  pop.querySelector(".tp-card.on")?.focus({ preventScroll: true });
}
