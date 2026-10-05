import { formatClock } from './game-logic.js';
import { SoundManager } from './audio.js';
import { NeonGame } from './game.js';
import './styles.css';

const STORAGE_KEY = 'last-orbit-flight-log-v1';
const $ = (selector) => document.querySelector(selector);
const elements = {
  stage: $('#stage'),
  canvas: $('#gameCanvas'),
  overlay: $('#screenOverlay'),
  overlayKicker: $('#overlayKicker'),
  overlayTitle: $('#overlayTitle'),
  overlayDescription: $('#overlayDescription'),
  overlayHint: $('#overlayHint'),
  primaryAction: $('#primaryAction'),
  phaseLabel: $('#phaseLabel'),
  hud: $('#gameHud'),
  score: $('#scoreValue'),
  time: $('#timeValue'),
  health: $('#healthValue'),
  healthFill: $('#healthFill'),
  healthTrack: $('.health-track'),
  wave: $('#waveValue'),
  fps: $('#fpsLabel'),
  introBest: $('#bestScoreIntro'),
  sideBest: $('#bestScoreSide'),
  totalKills: $('#totalKills'),
  totalRuns: $('#totalRuns'),
  quality: $('#qualitySelect'),
  qualityDescription: $('#qualityDescription'),
  autoAim: $('#autoAim'),
  sound: $('#soundToggle'),
  fullscreen: $('#fullscreenButton'),
  pause: $('#pauseButton'),
  joystickZone: $('#joystickZone'),
  joystickRing: $('.joystick-ring'),
  joystickKnob: $('#joystickKnob'),
  touchFire: $('#touchFire'),
  touchDash: $('#touchDash'),
};

const digits = new Map(Object.entries({ '0': '۰', '1': '۱', '2': '۲', '3': '۳', '4': '۴', '5': '۵', '6': '۶', '7': '۷', '8': '۸', '9': '۹' }));
const numberFormatter = new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 0 });
const toPersianDigits = (value) => String(value).replace(/[0-9]/g, (digit) => digits.get(digit));
const formatNumber = (value) => numberFormatter.format(Math.max(0, Math.floor(value || 0)));
const formatTime = (seconds) => toPersianDigits(formatClock(seconds));

function loadFlightLog() {
  const empty = { bestScore: 0, totalKills: 0, totalRuns: 0, bestTime: 0 };
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (!stored || typeof stored !== 'object') return empty;
    return {
      bestScore: Math.max(0, Number(stored.bestScore) || 0),
      totalKills: Math.max(0, Number(stored.totalKills) || 0),
      totalRuns: Math.max(0, Number(stored.totalRuns) || 0),
      bestTime: Math.max(0, Number(stored.bestTime) || 0),
    };
  } catch {
    return empty;
  }
}

let flightLog = loadFlightLog();
let lastRunWasRecord = false;
const sound = new SoundManager();

function renderFlightLog() {
  elements.introBest.textContent = formatNumber(flightLog.bestScore);
  elements.sideBest.textContent = formatNumber(flightLog.bestScore);
  elements.totalKills.textContent = formatNumber(flightLog.totalKills);
  elements.totalRuns.textContent = formatNumber(flightLog.totalRuns);
}

function saveFlightLog() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(flightLog));
  } catch {
    // Private browsing or storage limits should never prevent a new run.
  }
}

function renderOverlay(phase, run = null, pauseReason = 'manual') {
  const buttonLabel = elements.primaryAction.querySelector('span:first-child');
  elements.overlay.classList.remove('is-paused', 'is-gameover');
  elements.overlayHint.hidden = phase !== 'ready';

  if (phase === 'ready') {
    elements.overlayKicker.textContent = 'آماده‌ی پرتاب';
    elements.overlayTitle.textContent = 'مدار را پس بگیر';
    elements.overlayDescription.textContent = 'سفینه‌ات تنها امید این بخش از کهکشان است. آماده‌ای؟';
    buttonLabel.textContent = 'شروع بازی';
    elements.phaseLabel.textContent = 'آماده‌ی پرتاب';
  } else if (phase === 'paused') {
    elements.overlay.classList.add('is-paused');
    elements.overlayKicker.textContent = pauseReason === 'visibility' ? 'پرواز متوقف شد' : 'مکث';
    elements.overlayTitle.textContent = pauseReason === 'visibility' ? 'برگشتی، خلبان؟' : 'نفس تازه کن';
    elements.overlayDescription.textContent = pauseReason === 'visibility'
      ? 'برای جلوگیری از افت سرعت، بازی هنگام رفتن به پس‌زمینه متوقف شد.'
      : 'کهکشان منتظر می‌ماند. هر وقت آماده بودی ادامه بده.';
    buttonLabel.textContent = 'ادامه‌ی بازی';
    elements.phaseLabel.textContent = 'بازی متوقف است';
  } else if (phase === 'gameover') {
    elements.overlay.classList.add('is-gameover');
    elements.overlayKicker.textContent = lastRunWasRecord ? 'رکورد تازه' : 'پایان پرواز';
    elements.overlayTitle.textContent = 'این دور تموم شد';
    const survived = run ? formatTime(run.elapsed) : '۰۰:۰۰';
    const score = run ? formatNumber(run.score) : '۰';
    elements.overlayDescription.textContent = ` ${survived} دوام آوردی و ${score} امتیاز گرفتی. یک پرواز دیگر؟`;
    buttonLabel.textContent = 'دوباره تلاش کن';
    elements.phaseLabel.textContent = 'پرواز به پایان رسید';
  } else {
    elements.phaseLabel.textContent = 'در حال پرواز';
  }
}

function renderStats(stats) {
  elements.score.textContent = formatNumber(stats.score);
  elements.time.textContent = formatTime(stats.elapsed);
  const healthPercent = Math.round((stats.health / stats.maxHealth) * 100);
  elements.health.textContent = `${formatNumber(healthPercent)}٪`;
  elements.healthFill.style.width = `${healthPercent}%`;
  elements.healthTrack.setAttribute('aria-valuenow', String(healthPercent));
  elements.healthTrack.classList.toggle('is-critical', healthPercent <= 30);
  elements.wave.textContent = toPersianDigits(String(stats.wave).padStart(2, '0'));
  elements.fps.textContent = `${formatNumber(stats.fps)} فریم`;
}

function qualityNote(value) {
  const notes = {
    auto: 'تنظیم خودکار برای اجرای روان',
    high: 'نورپردازی و افکت‌های کامل',
    balanced: 'تعادل میان جزئیات و سرعت',
    smooth: 'وضوح کمتر، بیشترین روانی',
  };
  elements.qualityDescription.textContent = notes[value] || notes.auto;
}

const game = new NeonGame(elements.canvas, {
  onStats: renderStats,
  onPhaseChange: (phase, run, pauseReason) => {
    if (phase === 'gameover') lastRunWasRecord = Boolean(run && run.score > flightLog.bestScore);
    else if (phase === 'playing') lastRunWasRecord = false;
    document.body.dataset.phase = phase;
    elements.overlay.hidden = phase === 'playing';
    elements.hud.hidden = phase === 'ready';
    renderOverlay(phase, run, pauseReason);
  },
  onSound: (name) => sound.play(name),
  onGameOver: (run) => {
    lastRunWasRecord = run.score > flightLog.bestScore;
    flightLog.totalRuns += 1;
    flightLog.totalKills += run.kills;
    flightLog.bestScore = Math.max(flightLog.bestScore, run.score);
    flightLog.bestTime = Math.max(flightLog.bestTime, run.elapsed);
    saveFlightLog();
    renderFlightLog();
    renderOverlay('gameover', run);
  },
});

elements.primaryAction.addEventListener('click', () => {
  sound.unlock();
  if (game.phase === 'paused') game.resume();
  else if (game.phase === 'ready' || game.phase === 'gameover') game.start();
});

elements.quality.addEventListener('change', (event) => {
  game.setQuality(event.currentTarget.value);
  qualityNote(event.currentTarget.value);
});

elements.autoAim.addEventListener('change', (event) => game.setAutoAim(event.currentTarget.checked));

elements.sound.addEventListener('click', () => {
  sound.setEnabled(!sound.enabled);
  elements.sound.setAttribute('aria-pressed', String(sound.enabled));
  elements.sound.setAttribute('aria-label', sound.enabled ? 'خاموش کردن صدا' : 'روشن کردن صدا');
  elements.sound.title = sound.enabled ? 'صدا روشن است' : 'صدا خاموش است';
});

elements.pause.addEventListener('click', () => game.pause('manual'));

elements.fullscreen.addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await elements.stage.requestFullscreen();
  } catch {
    elements.fullscreen.title = 'تمام‌صفحه در این مرورگر در دسترس نیست';
  }
});

document.addEventListener('fullscreenchange', () => {
  const fullscreen = Boolean(document.fullscreenElement);
  elements.fullscreen.setAttribute('aria-label', fullscreen ? 'خروج از تمام‌صفحه' : 'نمایش تمام‌صفحه');
  elements.fullscreen.title = fullscreen ? 'خروج از تمام‌صفحه' : 'تمام‌صفحه';
});

let joystickPointer = null;
function moveJoystick(event) {
  const rect = elements.joystickRing.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const maxDistance = Math.max(18, rect.width * 0.32);
  let dx = event.clientX - centerX;
  let dy = event.clientY - centerY;
  const distance = Math.hypot(dx, dy);
  if (distance > maxDistance) {
    dx = (dx / distance) * maxDistance;
    dy = (dy / distance) * maxDistance;
  }
  elements.joystickKnob.style.transform = `translate(${dx}px, ${dy}px)`;
  game.setTouchMove(dx / maxDistance, dy / maxDistance);
}

function releaseJoystick(event) {
  if (joystickPointer === null || (event && event.pointerId !== joystickPointer)) return;
  joystickPointer = null;
  game.setTouchMove(0, 0);
  elements.joystickKnob.style.transform = 'translate(0, 0)';
}

elements.joystickZone.addEventListener('pointerdown', (event) => {
  event.preventDefault();
  joystickPointer = event.pointerId;
  elements.joystickZone.setPointerCapture(event.pointerId);
  moveJoystick(event);
});
elements.joystickZone.addEventListener('pointermove', (event) => {
  if (event.pointerId === joystickPointer) moveJoystick(event);
});
elements.joystickZone.addEventListener('pointerup', releaseJoystick);
elements.joystickZone.addEventListener('pointercancel', releaseJoystick);
elements.joystickZone.addEventListener('lostpointercapture', releaseJoystick);

elements.touchFire.addEventListener('pointerdown', (event) => {
  event.preventDefault();
  elements.touchFire.setPointerCapture(event.pointerId);
  game.setTouchFire(true);
});
const releaseFire = () => game.setTouchFire(false);
elements.touchFire.addEventListener('pointerup', releaseFire);
elements.touchFire.addEventListener('pointercancel', releaseFire);
elements.touchFire.addEventListener('lostpointercapture', releaseFire);
elements.touchDash.addEventListener('pointerdown', (event) => {
  event.preventDefault();
  game.requestDash();
});

renderFlightLog();
qualityNote(elements.quality.value);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL }).catch(() => {
    // Offline support is best-effort. It is not required to play.
  });
}
