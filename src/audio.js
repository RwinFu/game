const SOUND_PRESETS = {
  shoot: { start: 760, end: 360, duration: 0.075, volume: 0.018, wave: 'triangle' },
  hit: { start: 210, end: 92, duration: 0.16, volume: 0.045, wave: 'sawtooth' },
  dash: { start: 420, end: 980, duration: 0.22, volume: 0.035, wave: 'sine' },
  pop: { start: 520, end: 1040, duration: 0.12, volume: 0.026, wave: 'triangle' },
  pickup: { start: 660, end: 1320, duration: 0.24, volume: 0.032, wave: 'sine' },
};

export class SoundManager {
  constructor() {
    this.enabled = true;
    this.context = null;
  }

  unlock() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    try {
      if (!this.context) this.context = new AudioContextClass();
      if (this.context.state === 'suspended') void this.context.resume();
    } catch {
      this.context = null;
    }
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
  }

  play(name) {
    if (!this.enabled || !this.context || this.context.state !== 'running') return;
    const preset = SOUND_PRESETS[name];
    if (!preset) return;

    try {
      const now = this.context.currentTime;
      const oscillator = this.context.createOscillator();
      const gain = this.context.createGain();
      oscillator.type = preset.wave;
      oscillator.frequency.setValueAtTime(preset.start, now);
      oscillator.frequency.exponentialRampToValueAtTime(preset.end, now + preset.duration);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(preset.volume, now + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + preset.duration);
      oscillator.connect(gain);
      gain.connect(this.context.destination);
      oscillator.start(now);
      oscillator.stop(now + preset.duration + 0.01);
    } catch {
      // Audio is an optional enhancement; gameplay must keep working if a
      // browser blocks Web Audio or cannot allocate a short-lived oscillator.
    }
  }
}
