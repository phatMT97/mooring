// Right-click menu for a sidebar tab: recolour it (one of the theme's accents, or back to the
// repo's own), pin, close. Colours are stored as an accent index so they follow theme switches.
import { icons } from "./icons.js";
import { t } from "./i18n.js";
import { dismissable } from "./popover.js";

let open = null;

export function showTabMenu(x, y, { accents, repoAccent, color, pinned, canSplit, onSplit, onShare, onColor, onPin, onClose }) {
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
