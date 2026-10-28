// Keep hidden terminals' buffers live without mounting every renderer and stylesheet.
export function createTerminalViews({ container, onOpen = () => {} }) {
  let dimensions = null;

  function mount(tab) {
    if (tab.el.parentElement !== container) container.append(tab.el);
    if (!tab.term.element) {
      tab.term.open(tab.el);
      onOpen(tab);
    }
  }

  function fit(tab) {
    tab.fit.fit();
    dimensions = { cols: tab.term.cols, rows: tab.term.rows };
  }

  return {
    show(tab) {
      tab.visible = true;
      tab.hiddenSince = null;
      mount(tab);
    },
    hide(tab, now = Date.now()) {
      if (tab.visible !== false || tab.hiddenSince == null) tab.hiddenSince = now;
      tab.visible = false;
      tab.el.remove();
    },
    prepare(tab) {
      if (tab.term.element) {
        fit(tab);
      } else if (dimensions) {
        tab.term.resize(dimensions.cols, dimensions.rows);
      } else {
        // Measure one terminal for the whole restore, so every PTY starts at a real size.
        tab.el.classList.add("measure");
        try {
          mount(tab);
          fit(tab);
        } finally {
          tab.el.classList.remove("measure");
          tab.el.remove();
        }
      }
    },
    fit,
  };
}

export function backgroundAction(tab, now = Date.now()) {
  if (tab.visible || tab.hibernated || tab.status === "working" || tab.hiddenSince == null) return null;
  const hiddenMs = now - tab.hiddenSince;
  if (hiddenMs > 25 * 60 * 1000 && tab.sessionId) return "hibernate";
  if (hiddenMs > 3 * 60 * 1000 && !tab.frozen && tab.shell === "wsl") return "freeze";
  return null;
}
