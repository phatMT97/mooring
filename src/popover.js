// Shared dismissal for menus, popovers and dialogs: Esc, a press outside `el` (or on its own
// backdrop) and window blur close it. Returns close(); onClose runs once, after removal.

export function dismissable(el, { onClose = () => {}, inside = (target) => el.contains(target), blur = false } = {}) {
  let done = false;
  const onKey = (e) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    close();
  };
  const onDown = (e) => { if (!inside(e.target)) close(); };
  function close() {
    if (done) return;
    done = true;
    document.removeEventListener("keydown", onKey, true);
    document.removeEventListener("pointerdown", onDown, true);
    window.removeEventListener("blur", close);
    el.remove();
    onClose();
  }
  document.addEventListener("keydown", onKey, true);
  document.addEventListener("pointerdown", onDown, true);
  if (blur) window.addEventListener("blur", close);
  return close;
}
