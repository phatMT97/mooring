import test from "node:test";
import assert from "node:assert/strict";
import xterm from "@xterm/xterm";
import { backgroundAction, createTerminalViews } from "../src/terminal-views.js";

const minute = 60 * 1000;
const hiddenTab = (extra = {}) => ({
  shell: "wsl", status: "idle", visible: false, hiddenSince: 0, ...extra,
});

test("restored tabs can rest without ever having been activated", () => {
  const tab = hiddenTab({ sessionId: "saved-session" });
  assert.equal(backgroundAction(tab, 3 * minute), null);
  assert.equal(backgroundAction(tab, 3 * minute + 1), "freeze");
  assert.equal(backgroundAction({ ...tab, frozen: true }, 4 * minute), null);
  assert.equal(backgroundAction({ ...tab, frozen: true }, 26 * minute), "hibernate");
});

test("both visible split panes and working agents are excluded from background actions", () => {
  for (const extra of [{ visible: true }, { status: "working" }, { hibernated: true }, { hiddenSince: null }]) {
    assert.equal(backgroundAction(hiddenTab({ sessionId: "session", ...extra }), 30 * minute), null);
  }
  assert.equal(backgroundAction(hiddenTab({ shell: "powershell" }), 4 * minute), null);
  assert.equal(backgroundAction(hiddenTab(), 26 * minute), "freeze");
});

test("the background clock starts on hide, survives unrelated layouts, and resets on reveal", () => {
  const container = { append(el) { el.parentElement = this; } };
  const tab = hiddenTab({
    visible: true, hiddenSince: null,
    term: { element: {} },
    el: { remove() { this.parentElement = null; } },
  });
  const views = createTerminalViews({ container });
  views.hide(tab, 30 * minute);
  views.hide(tab, 32 * minute);
  assert.equal(backgroundAction(tab, 33 * minute), null);
  assert.equal(backgroundAction(tab, 33 * minute + 1), "freeze");
  views.show(tab);
  assert.equal(backgroundAction(tab, 60 * minute), null);
  views.hide(tab, 60 * minute);
  assert.equal(backgroundAction(tab, 61 * minute), null);
});

test("unmounted xterm buffers still parse Unicode, titles, cwd reports, and notifications", async () => {
  const term = new xterm.Terminal({ allowProposedApi: true });
  const events = [];
  term.onTitleChange((title) => events.push(["title", title]));
  term.onBell(() => events.push(["bell"]));
  term.parser.registerOscHandler(9, (data) => { events.push(["cwd", data]); return true; });
  const data = new TextEncoder().encode("Xin chào\r\n\x1b]0;idle agent\x07\x1b]9;9;/home/me/repo\x07\x07");
  try {
    // Split in the middle of a UTF-8 character, as a PTY stream can.
    await new Promise((resolve) => term.write(data.subarray(0, 7), resolve));
    await new Promise((resolve) => term.write(data.subarray(7), resolve));
    assert.equal(term.element, undefined);
    assert.equal(term.buffer.active.getLine(0).translateToString(true), "Xin chào");
    assert.deepEqual(events, [["title", "idle agent"], ["cwd", "9;/home/me/repo"], ["bell"]]);
  } finally { term.dispose(); }
});
