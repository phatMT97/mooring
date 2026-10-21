import test from "node:test";
import assert from "node:assert/strict";
import xterm from "@xterm/xterm";
import { attachWebLinks } from "../src/web-links.js";

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
