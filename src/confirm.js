// Fluent-style confirmation dialog. Resolves true only on the explicit "confirm" button; Esc and
// "Cancel" resolve false. `safe` names the answer that is highlighted and focused, so Enter picks
// it: "cancel" when confirming would destroy something (the backdrop then cancels too), "confirm"
// when it is the usual choice. Items with a boolean `checked` get a checkbox that updates it.
import { t } from "./i18n.js";
import { dismissable } from "./popover.js";

export function confirmDialog({ title, body, items = [], confirmLabel, cancelLabel = t("dlg.cancel"), safe = "cancel" }) {
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "dialog-backdrop";
    backdrop.innerHTML = `
      <div class="dialog" role="alertdialog" aria-modal="true" aria-labelledby="dlg-title">
        <h2 id="dlg-title"></h2>
        <p class="dlg-body"></p>
        <ul class="dlg-items"></ul>
        <div class="dlg-actions">
          <button class="dlg-confirm"></button>
          <button class="dlg-cancel"></button>
        </div>
      </div>`;
    backdrop.querySelector("h2").textContent = title;
    backdrop.querySelector(".dlg-body").textContent = body;
    const list = backdrop.querySelector(".dlg-items");
    for (const it of items) {
      const li = document.createElement(typeof it.checked === "boolean" ? "label" : "li");
      li.innerHTML = `<span class="dot"></span><span class="name"></span><span class="note"></span>`;
      if (typeof it.checked === "boolean") {
        const box = document.createElement("input");
        box.type = "checkbox";
        box.checked = it.checked;
        box.onchange = () => (it.checked = box.checked);
        li.prepend(box);
        li.className = "pick";
      }
      li.style.setProperty("--tc", it.color);
      li.querySelector(".name").textContent = it.name;
      li.querySelector(".note").textContent = it.note || "";
      if (it.busy) li.classList.add("busy");
      list.append(li);
    }
    if (!items.length) list.remove();
    const confirmBtn = backdrop.querySelector(".dlg-confirm");
    const cancelBtn = backdrop.querySelector(".dlg-cancel");
    confirmBtn.textContent = confirmLabel;
    cancelBtn.textContent = cancelLabel;
    const [primary, other] = safe === "confirm" ? [confirmBtn, cancelBtn] : [cancelBtn, confirmBtn];
    primary.classList.add("primary");
    if (safe === "cancel") other.classList.add("danger");

    let confirmed = false;
    document.body.append(backdrop);
    const close = dismissable(backdrop, {
      inside: (target) => safe === "confirm" || target !== backdrop,
      onClose: () => resolve(confirmed),
    });
    cancelBtn.onclick = close;
    confirmBtn.onclick = () => { confirmed = true; close(); };
    primary.focus();
  });
}
