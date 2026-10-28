import test from "node:test";
import assert from "node:assert/strict";
import xterm from "@xterm/xterm";
import { attachWebLinks } from "../src/web-links.js";
import { attachLinks, getSelectedText, findLinkAtEvent, QUOTED_PATH_RE, SPACED_RE } from "../src/links.js";

const click = (ctrlKey = true) => ({ ctrlKey, preventDefault() { this.prevented = true; } });

async function fixture(url = "https://example.com/path?one=1&two=2#section") {
  const term = new xterm.Terminal({ allowProposedApi: true });
  const opened = [], hovered = [], errors = [];
  let left = 0;
  const handler = attachWebLinks(term, {
    open: async (url) => { opened.push(url); },
    hover: (_, url) => hovered.push(url),
    leave: () => left++,
    onError: (e) => errors.push(e),
  });
  await new Promise((resolve) => term.write(`\x1b]8;;${url}\x1b\\Open website\x1b]8;;\x1b\\`, resolve));
  // Exercise xterm's built-in OSC provider, which runs before Mooring's text link provider.
  const provider = term._core._linkProviderService.linkProviders[0];
  const links = await new Promise((resolve) => provider.provideLinks(1, resolve));
  return { term, handler, link: links?.[0], opened, hovered, errors, left: () => left, url };
}

test("OSC 8 Ctrl+Click sends the complete target to the OS opener", async () => {
  const f = await fixture();
  try {
    assert.equal(f.link.text, f.url); // target differs from the displayed label
    const e = click();
    await f.link.activate(e, f.link.text);
    assert.deepEqual(f.opened, [f.url]);
    assert.equal(e.prevented, true);
    assert.equal(f.left(), 1);
  } finally { f.term.dispose(); }
});

test("ordinary clicks stay in the terminal and hover shows the actual target", async () => {
  const f = await fixture();
  try {
    const e = click(false);
    await f.link.activate(e, f.link.text);
    assert.deepEqual(f.opened, []);
    assert.equal(e.prevented, undefined);
    f.link.hover(e, f.link.text);
    assert.deepEqual(f.hovered, [f.url]);
  } finally { f.term.dispose(); }
});

test("failed opener calls are reported instead of becoming unhandled rejections", async () => {
  const term = { options: {} };
  const errors = [];
  const error = new Error("browser could not start");
  const handler = attachWebLinks(term, {
    open: async () => { throw error; }, onError: (e) => errors.push(e),
  });
  await handler.activate(click(), "https://example.com");
  assert.deepEqual(errors, [error]);
});

test("web links reject non-http targets and malformed URLs", async () => {
  const f = await fixture("javascript:alert(1)");
  try {
    assert.equal(f.link, undefined); // xterm also filters non-web OSC links
    for (const url of ["javascript:alert(1)", "file:///etc/passwd", "bad url"]) {
      await f.handler.activate(click(), url);
    }
    assert.deepEqual(f.opened, []);
  } finally { f.term.dispose(); }
});

test("getSelectedText resolves target URI when an OSC 8 link is selected", async () => {
  const term = new xterm.Terminal({ allowProposedApi: true });
  await new Promise((resolve) => term.write("\x1b]8;;https://example.com/target\x1b\\ClickHere\x1b]8;;\x1b\\", resolve));
  term.hasSelection = () => true;
  term.getSelection = () => "ClickHere";
  term.getSelectionPosition = () => ({ start: { x: 0, y: 0 }, end: { x: 9, y: 0 } });

  assert.equal(getSelectedText(term), "https://example.com/target");

  // Selection with trailing spaces still extracts the single URI
  term.getSelectionPosition = () => ({ start: { x: 0, y: 0 }, end: { x: 12, y: 0 } });
  assert.equal(getSelectedText(term), "https://example.com/target");

  term.dispose();
});

test("getSelectedText preserves plain text selections without links", async () => {
  const term = new xterm.Terminal({ allowProposedApi: true });
  await new Promise((resolve) => term.write("plain terminal output", resolve));
  term.hasSelection = () => true;
  term.getSelection = () => "plain terminal output";
  term.getSelectionPosition = () => ({ start: { x: 0, y: 0 }, end: { x: 21, y: 0 } });

  assert.equal(getSelectedText(term), "plain terminal output");
  term.dispose();
});

test("getSelectedText embeds target URI when multi-word selection contains OSC 8 link", async () => {
  const term = new xterm.Terminal({ allowProposedApi: true });
  await new Promise((resolve) => term.write("See \x1b]8;;https://example.com/doc\x1b\\docs\x1b]8;;\x1b\\ now", resolve));
  term.hasSelection = () => true;
  term.getSelection = () => "See docs now";
  term.getSelectionPosition = () => ({ start: { x: 0, y: 0 }, end: { x: 12, y: 0 } });

  assert.equal(getSelectedText(term), "See docs (https://example.com/doc) now");
  term.dispose();
});

test("findLinkAtEvent detects OSC 8 and plain URLs at mouse coordinates", async () => {
  const term = new xterm.Terminal({ allowProposedApi: true, cols: 80, rows: 24 });
  await new Promise((resolve) => term.write("URL: https://example.org and \x1b]8;;https://example.com\x1b\\OSCLink\x1b]8;;\x1b\\", resolve));

  // Mock mouseService getCoords to return [col, row] (1-based)
  term._core._mouseService = {
    getCoords(e) {
      return e.mockCoords;
    }
  };

  // Plain URL at col 10, row 1
  assert.equal(findLinkAtEvent(term, { mockCoords: [10, 1] }, null), "https://example.org");

  // OSC 8 link at col 32, row 1
  assert.equal(findLinkAtEvent(term, { mockCoords: [32, 1] }, null), "https://example.com");

  // Non-link at col 2, row 1
  assert.equal(findLinkAtEvent(term, { mockCoords: [2, 1] }, null), null);

  term.dispose();
});

test("QUOTED_PATH_RE and SPACED_RE match paths with spaces and mixed slashes", () => {
  const line1 = '"C:\\Users\\PhatMT3\\OneDrive - FPT Corporation\\Pictures\\claude\\ss.png"';
  const m1 = [...line1.matchAll(QUOTED_PATH_RE)];
  assert.equal(m1.length, 1);
  assert.equal(m1[0][0], "C:\\Users\\PhatMT3\\OneDrive - FPT Corporation\\Pictures\\claude\\ss.png");

  const line2 = 'C:/Users/PhatMT3/OneDrive - FPT Corporation/Pictures/claude/ss.png';
  const m2 = [...line2.matchAll(SPACED_RE)];
  assert.equal(m2.length, 1);
  assert.equal(m2[0][0], "C:/Users/PhatMT3/OneDrive - FPT Corporation/Pictures/claude/ss.png");

  const line3 = '"/mnt/c/Users/PhatMT3/OneDrive - FPT Corporation/Pictures/claude/ss.png"';
  const m3 = [...line3.matchAll(QUOTED_PATH_RE)];
  assert.equal(m3.length, 1);
  assert.equal(m3[0][0], "/mnt/c/Users/PhatMT3/OneDrive - FPT Corporation/Pictures/claude/ss.png");
});
