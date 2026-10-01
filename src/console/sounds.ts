/**
 * Small synthesized cues for the mic (no audio files): a soft rising two-note chime when listening
 * starts and a falling one when it stops. Quiet, short, and silent where audio is unavailable.
 */
let ctx: AudioContext | null = null;

function tone(freq: number, at: number, dur: number, gain: number) {
  if (!ctx) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  const f = ctx.createBiquadFilter();
  o.type = 'sine';
  o.frequency.setValueAtTime(freq, at);
  f.type = 'lowpass';
  f.frequency.value = 2400;
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(gain, at + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(f).connect(g).connect(ctx.destination);
  o.start(at);
  o.stop(at + dur + 0.02);
  // A faint octave shimmer gives it a glassy, premium feel.
  const o2 = ctx.createOscillator();
  const g2 = ctx.createGain();
  o2.type = 'triangle';
  o2.frequency.setValueAtTime(freq * 2, at);
  g2.gain.setValueAtTime(0.0001, at);
  g2.gain.exponentialRampToValueAtTime(gain * 0.18, at + 0.02);
  g2.gain.exponentialRampToValueAtTime(0.0001, at + dur * 0.8);
  o2.connect(g2).connect(ctx.destination);
  o2.start(at);
  o2.stop(at + dur);
}

export function micCue(kind: 'start' | 'stop') {
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx ??= new AC();
    if (ctx.state === 'suspended') void ctx.resume();
    const t = ctx.currentTime + 0.01;
    if (kind === 'start') {
      tone(659.25, t, 0.16, 0.08); // E5
      tone(987.77, t + 0.085, 0.24, 0.07); // B5
    } else {
      tone(880, t, 0.14, 0.06); // A5
      tone(587.33, t + 0.075, 0.22, 0.05); // D5
    }
  } catch {
    /* no audio, no problem */
  }
}
