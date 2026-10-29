// Notification chime for tabs that need attention ("need you").

let audioCtx = null;
let lastPlayedAt = 0;

export function getAudioContext() {
  if (typeof window === "undefined") return null;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;
  if (!audioCtx) {
    try {
      audioCtx = new AudioCtx();
    } catch {
      return null;
    }
  }
  return audioCtx;
}

export function resetAudioForTest() {
  audioCtx = null;
  lastPlayedAt = 0;
}

export function initAudio() {
  const ctx = getAudioContext();
  if (ctx && ctx.state === "suspended") {
    ctx.resume().catch(() => {});
  }
}

function playTone(ctx, freq, startTime, duration, peakGain) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = "sine";
  osc.frequency.setValueAtTime(freq, startTime);

  gain.gain.setValueAtTime(0.0001, startTime);
  gain.gain.linearRampToValueAtTime(peakGain, startTime + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start(startTime);
  osc.stop(startTime + duration);

  // Subtle 2nd harmonic (octave higher) for a crisp, bell-like attack
  let harmOsc = null;
  let harmGain = null;
  try {
    harmOsc = ctx.createOscillator();
    harmGain = ctx.createGain();
    harmOsc.type = "sine";
    harmOsc.frequency.setValueAtTime(freq * 2, startTime);

    harmGain.gain.setValueAtTime(0.0001, startTime);
    harmGain.gain.linearRampToValueAtTime(peakGain * 0.18, startTime + 0.012);
    harmGain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration * 0.7);

    harmOsc.connect(harmGain);
    harmGain.connect(ctx.destination);

    harmOsc.start(startTime);
    harmOsc.stop(startTime + duration * 0.7);
  } catch {}

  setTimeout(() => {
    try {
      osc.disconnect();
      gain.disconnect();
      harmOsc?.disconnect();
      harmGain?.disconnect();
    } catch {}
  }, (duration + 0.1) * 1000);
}

/**
 * Plays a pleasant two-tone chime (D5 -> A5) when an agent or background tab needs attention.
 * Throttled to avoid cacophony if multiple background events trigger at once.
 */
export function playNeedsSound({ context = null, cooldownMs = 500, now = Date.now() } = {}) {
  if (now - lastPlayedAt < cooldownMs) return false;
  lastPlayedAt = now;

  try {
    const ctx = context || getAudioContext();
    if (!ctx) return false;

    if (ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }

    const t0 = ctx.currentTime || 0;
    playTone(ctx, 587.33, t0, 0.16, 0.12);
    playTone(ctx, 880.00, t0 + 0.09, 0.26, 0.15);
    return true;
  } catch {
    return false;
  }
}
