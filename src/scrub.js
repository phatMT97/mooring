// A joystick-style scroll handle on the terminal's right edge. Full-screen TUIs like Claude Code
// run in the alternate screen, which has no scrollback for a normal scrollbar to move; the handle
// replays mouse-wheel input instead, so it scrolls whatever a real wheel would.
// Pull it further to scroll faster; it springs back on release. Double-click jumps to the bottom.

import { translateDom } from "./i18n.js";

const TICK_MS = 40;
const SPEED_UNIT_PX = 30; // pulling this far scrolls ~6 lines/s; speed grows with the square of the pull
const MAX_LINES_PER_SEC = 600;

export function attachScrub(container, term) {
  const track = document.createElement("div");
  track.className = "scrub";
  track.innerHTML = `<div class="knob" data-i18n-label="scrub.tip"></div>`;
  translateDom(track);
  container.append(track);
  const knob = track.firstElementChild;

  let startY = 0;
  let pull = 0; // raw distance dragged, may go past the track for more speed
  let carry = 0; // fractional lines not yet scrolled, so slow pulls still move smoothly
  let timer = null;

  // Replay it as a mouse wheel over the screen: xterm then does exactly what a real wheel does
  // (scrollback in a shell, mouse reports or arrow keys in full-screen apps like Claude Code).
  // One wheel notch per line: apps in mouse mode treat every wheel event as a single step,
  // so speed comes from how many events are sent, not from their size.
  function scroll(lines) {
    if (!lines) return;
    const screen = term.element?.querySelector(".xterm-screen");
    if (!screen) return;
    const r = screen.getBoundingClientRect();
    const init = {
      deltaY: Math.sign(lines),
      deltaMode: WheelEvent.DOM_DELTA_LINE,
      clientX: r.left + r.width / 2,
      clientY: r.top + r.height / 2,
      bubbles: true,
      cancelable: true,
    };
    for (let i = 0; i < Math.abs(lines); i++) screen.dispatchEvent(new WheelEvent("wheel", init));
  }

  function tick() {
    const units = Math.abs(pull) / SPEED_UNIT_PX;
    const perSec = Math.min(MAX_LINES_PER_SEC, units * units * 6);
    carry += Math.sign(pull) * perSec * (TICK_MS / 1000);
    const lines = Math.trunc(carry);
    carry -= lines;
    scroll(lines);
  }

  knob.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    knob.setPointerCapture(e.pointerId);
    startY = e.clientY;
    pull = 0;
    carry = 0;
    track.classList.add("active");
    timer = setInterval(tick, TICK_MS);
  });
  knob.addEventListener("pointermove", (e) => {
    if (!timer) return;
    pull = e.clientY - startY;
    const half = track.clientHeight / 2 - knob.clientHeight / 2;
    knob.style.transform = `translateY(${Math.max(-half, Math.min(half, pull))}px)`; // the knob stays on the track
  });
  const release = () => {
    clearInterval(timer);
    timer = null;
    pull = 0;
    knob.style.transform = "";
    track.classList.remove("active");
    term.focus();
  };
  knob.addEventListener("pointerup", release);
  knob.addEventListener("pointercancel", release);
  knob.addEventListener("dblclick", () => {
    if (term.buffer.active.type === "normal") term.scrollToBottom();
    else scroll(400); // the app clamps at its bottom
    term.focus();
  });
}
