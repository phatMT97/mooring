// Right-click menu for a sidebar tab: recolour it (one of the theme's accents, or back to the
// repo's own), pin, close. Colours are stored as an accent index so they follow theme switches.
import { icons } from "./icons.js";
import { t } from "./i18n.js";
import { dismissable } from "./popover.js";

let open = null;

export function showTabMenu(x, y, { accents, repoAccent, color, pinned, canSplit, onSplit, onShare, onColor, onPin, onClose, onRestart, restartLaunchers = [], currentLauncher, launcherCommand, onRestartWith }) {
  open?.close();
  const menu = document.createElement("div");
  menu.className = "tab-menu";
  menu.setAttribute("role", "menu");
  menu.innerHTML = `
    <div class="tm-label">${t("menu.color")}</div>
    <div class="tm-swatches"></div>
    <button class="tm-item tm-reset" role="menuitem"><span class="tm-dot" style="background:${repoAccent}"></span>${t("menu.repoColor")}<span class="tm-tick">${icons.check}</span></button>
    <div class="tm-sep"></div>
    ${onShare ? `<button class="tm-item tm-share" role="menuitem">${icons.share}${t("menu.share")}</button>` : ""}
    ${onRestart ? `<div class="tm-restart-group">
      <button class="tm-item tm-restart" role="menuitem">${icons.restart}${t("agent.restart")}</button>
      ${restartLaunchers.length ? `<button class="tm-item tm-launchers" role="menuitem" aria-label="${t("agent.chooseLauncher")}" title="${t("agent.chooseLauncher")}" aria-haspopup="menu" aria-expanded="false">${icons.chevronRight}</button>
        <div class="tab-menu tm-submenu" role="menu" aria-label="${t("agent.chooseLauncher")}" hidden>
          <div class="tm-label">${t("agent.chooseLauncher")}</div>
          ${restartLaunchers.map((launcher) => `<button class="tm-item tm-restart-with${launcher === currentLauncher ? " on" : ""}" data-launcher="${launcher}" role="menuitemradio" aria-checked="${launcher === currentLauncher}"><span>${launcherCommand(launcher)}</span><span class="tm-tick">${icons.check}</span></button>`).join("")}
        </div>` : ""}
    </div>` : ""}
    ${canSplit ? `<button class="tm-item tm-split" role="menuitem">${icons.splitRight}${t("menu.split")}<kbd>Ctrl+Click</kbd></button>` : ""}
    <button class="tm-item tm-pin" role="menuitem">${pinned ? icons.pinOff : icons.pin}${pinned ? t("tab.unpin") : t("tab.pin")}</button>
    <button class="tm-item tm-close" role="menuitem">${icons.x}${t("menu.close")}</button>`;
  const sw = menu.querySelector(".tm-swatches");
  accents.forEach((c, i) => {
    const b = document.createElement("button");
    b.className = "tm-swatch" + (color === i ? " on" : "");
    b.style.setProperty("--sw", c);
    b.setAttribute("aria-label", t("menu.colorN", { n: i + 1 }));
    b.innerHTML = icons.check;
    b.onclick = () => { close(); onColor(i); };
    sw.append(b);
  });
  if (color == null) menu.querySelector(".tm-reset").classList.add("on");
  menu.querySelector(".tm-reset").onclick = () => { close(); onColor(null); };
  if (onShare) menu.querySelector(".tm-share").onclick = () => { close(); onShare(); };
  if (onRestart) menu.querySelector(".tm-restart").onclick = () => { close(); onRestart(); };
  menu.querySelectorAll(".tm-restart-with").forEach((b) => {
    b.onclick = () => { close(); onRestartWith(b.dataset.launcher); };
  });
  const group = menu.querySelector(".tm-restart-group");
  const toggle = menu.querySelector(".tm-launchers");
  const submenu = menu.querySelector(".tm-submenu");
  if (submenu) {
    const choices = [...submenu.querySelectorAll("button")];
    const showLaunchers = (show) => {
      submenu.hidden = !show;
      toggle.setAttribute("aria-expanded", String(show));
      if (!show) return;
      const anchor = group.getBoundingClientRect();
      const bounds = submenu.getBoundingClientRect();
      // Flip left near the right edge, and lift the flyout when the window is short.
      const left = anchor.right + bounds.width <= innerWidth - 8 ? anchor.right : anchor.left - bounds.width;
      submenu.style.left = `${Math.max(8, Math.min(left, innerWidth - bounds.width - 8)) - anchor.left}px`;
      submenu.style.top = `${Math.max(8, Math.min(anchor.top, innerHeight - bounds.height - 8)) - anchor.top}px`;
    };
    group.onpointerenter = () => showLaunchers(true);
    group.onpointerleave = () => { if (!group.contains(document.activeElement)) showLaunchers(false); };
    group.onfocusout = (e) => { if (!group.contains(e.relatedTarget)) showLaunchers(false); };
    toggle.onclick = () => {
      showLaunchers(true);
      choices[0]?.focus();
    };
    group.onkeydown = (e) => {
      if (e.key === "ArrowRight") {
        e.preventDefault();
        e.stopPropagation();
        showLaunchers(true);
        choices[0]?.focus();
      } else if (e.key === "ArrowLeft" && !submenu.hidden) {
        e.preventDefault();
        e.stopPropagation();
        showLaunchers(false);
        toggle.focus();
      } else if (submenu.contains(e.target) && ["ArrowUp", "ArrowDown"].includes(e.key)) {
        e.preventDefault();
        e.stopPropagation();
        const at = choices.indexOf(document.activeElement);
        choices[(at + (e.key === "ArrowDown" ? 1 : -1) + choices.length) % choices.length]?.focus();
      }
    };
  }
  if (canSplit) menu.querySelector(".tm-split").onclick = () => { close(); onSplit(); };
  menu.querySelector(".tm-pin").onclick = () => { close(); onPin(); };
  menu.querySelector(".tm-close").onclick = () => { close(); onClose(); };

  document.body.append(menu);
  const r = menu.getBoundingClientRect();
  menu.style.left = `${Math.min(x, innerWidth - r.width - 8)}px`;
  menu.style.top = `${Math.min(y, innerHeight - r.height - 8)}px`;

  const close = dismissable(menu, { blur: true, onClose: () => (open = null) });
  open = { close };
  menu.querySelector(".tm-swatch.on, .tm-reset.on")?.focus({ preventScroll: true });
}
