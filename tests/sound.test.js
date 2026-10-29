import test from "node:test";
import assert from "node:assert/strict";
import { playNeedsSound, initAudio, getAudioContext, resetAudioForTest } from "../src/sound.js";

function createMockAudioContext(initialState = "running") {
  const oscillators = [];
  const gains = [];
  let resumed = false;

  const mockCtx = {
    currentTime: 10,
    state: initialState,
    destination: { id: "dest" },
    resume: async () => {
      resumed = true;
      mockCtx.state = "running";
    },
    createOscillator() {
      const osc = {
        type: "sine",
        frequency: {
          value: 0,
          setValueAtTime(val, time) {
            this.value = val;
            this.time = time;
          },
        },
        connect(target) {
          this.target = target;
        },
        disconnect() {
          this.disconnected = true;
        },
        start(time) {
          this.startTime = time;
        },
        stop(time) {
          this.stopTime = time;
        },
      };
      oscillators.push(osc);
      return osc;
    },
    createGain() {
      const g = {
        gain: {
          value: 0,
          events: [],
          setValueAtTime(val, time) {
            this.events.push(["setValueAtTime", val, time]);
          },
          linearRampToValueAtTime(val, time) {
            this.events.push(["linearRampToValueAtTime", val, time]);
          },
          exponentialRampToValueAtTime(val, time) {
            this.events.push(["exponentialRampToValueAtTime", val, time]);
          },
        },
        connect(target) {
          this.target = target;
        },
        disconnect() {
          this.disconnected = true;
        },
      };
      gains.push(g);
      return g;
    },
    get oscillators() { return oscillators; },
    get gains() { return gains; },
    get isResumed() { return resumed; },
  };

  return mockCtx;
}

test("playNeedsSound returns false when no audio context is available", () => {
  resetAudioForTest();
  const played = playNeedsSound({ now: 1000 });
  assert.equal(played, false);
});

test("playNeedsSound creates correct chime tones and envelopes", () => {
  resetAudioForTest();
  const mockCtx = createMockAudioContext("running");
  const played = playNeedsSound({ context: mockCtx, now: 1000 });

  assert.equal(played, true);
  // 2 fundamental oscillators (D5 587.33, A5 880.00) + 2 harmonic oscillators (1174.66, 1760.00)
  assert.equal(mockCtx.oscillators.length, 4);
  assert.equal(mockCtx.gains.length, 4);

  const [osc1, harm1, osc2, harm2] = mockCtx.oscillators;
  assert.equal(osc1.frequency.value, 587.33);
  assert.equal(osc1.startTime, 10);
  assert.equal(harm1.frequency.value, 587.33 * 2);

  assert.equal(osc2.frequency.value, 880.00);
  assert.equal(osc2.startTime, 10.09);
  assert.equal(harm2.frequency.value, 880.00 * 2);

  // Check envelope on primary note 1
  const events1 = mockCtx.gains[0].gain.events;
  assert.equal(events1[0][0], "setValueAtTime");
  assert.equal(events1[1][0], "linearRampToValueAtTime");
  assert.equal(events1[2][0], "exponentialRampToValueAtTime");
});

test("playNeedsSound throttles multiple rapid calls within cooldownMs", () => {
  resetAudioForTest();
  const mockCtx = createMockAudioContext("running");

  assert.equal(playNeedsSound({ context: mockCtx, cooldownMs: 500, now: 1000 }), true);
  // Second call within 500ms is dropped
  assert.equal(playNeedsSound({ context: mockCtx, cooldownMs: 500, now: 1200 }), false);
  // Third call after 500ms succeeds
  assert.equal(playNeedsSound({ context: mockCtx, cooldownMs: 500, now: 1501 }), true);
});

test("playNeedsSound resumes suspended audio context", async () => {
  resetAudioForTest();
  const mockCtx = createMockAudioContext("suspended");
  assert.equal(mockCtx.isResumed, false);

  playNeedsSound({ context: mockCtx, now: 2000 });
  assert.equal(mockCtx.isResumed, true);
});
