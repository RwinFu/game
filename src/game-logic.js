export const ENEMY_PROFILES = Object.freeze({
  skimmer: Object.freeze({ type: 'skimmer', radius: 11, speed: 104, hp: 1, damage: 12, score: 100, color: '#ff668f' }),
  hunter: Object.freeze({ type: 'hunter', radius: 14, speed: 142, hp: 2, damage: 17, score: 180, color: '#ffb45e' }),
  brute: Object.freeze({ type: 'brute', radius: 20, speed: 70, hp: 5, damage: 25, score: 360, color: '#b581ff' }),
});

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function normalizeVector(x, y) {
  const length = Math.hypot(x, y);
  if (length === 0 || length <= 1) return { x, y };
  return { x: x / length, y: y / length };
}

export function spawnIntervalForTime(seconds) {
  return clamp(1.05 - Math.max(0, seconds) / 105, 0.46, 1.05);
}

export function enemyProfileForTime(seconds, roll = Math.random()) {
  if (seconds >= 38 && roll > 0.78) return ENEMY_PROFILES.brute;
  if (seconds >= 16 && roll > 0.5) return ENEMY_PROFILES.hunter;
  return ENEMY_PROFILES.skimmer;
}

export function formatClock(seconds) {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}
