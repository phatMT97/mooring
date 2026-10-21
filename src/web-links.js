// OSC 8 links have their own xterm handler, ahead of registered text link providers.
// Route them through the same OS opener as plain URLs instead of browser window.open().
export function attachWebLinks(term, { open, hover, leave, onError = () => {} }) {
  const handler = {
    async activate(e, url) {
      if (!e.ctrlKey) return; // leave ordinary clicks available for text selection
      try {
        if (!["http:", "https:"].includes(new URL(url).protocol)) return;
      } catch { return; }
      e.preventDefault();
      leave?.();
      try {
        await open(url);
      } catch (error) {
        onError(error);
      }
    },
    hover,
    leave,
  };
  term.options.linkHandler = handler;
  return handler;
}
