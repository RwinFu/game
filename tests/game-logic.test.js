import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ENEMY_PROFILES,
  clamp,
  enemyProfileForTime,
  formatClock,
  normalizeVector,
  spawnIntervalForTime,
} from '../src/game-logic.js';

test('clamp keeps values inside inclusive bounds', () => {
  assert.equal(clamp(-2, 0, 1), 0);
  assert.equal(clamp(0.4, 0, 1), 0.4);
  assert.equal(clamp(4, 0, 1), 1);
});

test('movement normalization preserves small input and caps diagonal speed', () => {
  assert.deepEqual(normalizeVector(0, 0), { x: 0, y: 0 });
  assert.deepEqual(normalizeVector(0.5, 0), { x: 0.5, y: 0 });
  const diagonal = normalizeVector(1, 1);
  assert.ok(Math.abs(Math.hypot(diagonal.x, diagonal.y) - 1) < 1e-12);
});

test('spawn pacing gets faster over time, but has a safe lower bound', () => {
  assert.equal(spawnIntervalForTime(0), 1.05);
  assert.ok(spawnIntervalForTime(45) < spawnIntervalForTime(10));
  assert.equal(spawnIntervalForTime(600), 0.46);
});

test('enemy mix ramps up as a run lasts longer', () => {
  assert.equal(enemyProfileForTime(0, 0.99), ENEMY_PROFILES.skimmer);
  assert.equal(enemyProfileForTime(20, 0.8), ENEMY_PROFILES.hunter);
  assert.equal(enemyProfileForTime(50, 0.9), ENEMY_PROFILES.brute);
});

test('clock formatting stays stable at minute boundaries', () => {
  assert.equal(formatClock(0), '00:00');
  assert.equal(formatClock(61.9), '01:01');
  assert.equal(formatClock(3600), '60:00');
});
