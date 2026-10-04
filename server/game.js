'use strict';
// Игровая логика сеанса: участники, этапы, время. Без сети и файлов — только данные.

const crypto = require('node:crypto');
const heroes = require('./heroes');
const adjectives = require('./adjectives.json');

const STAGES = ['program', 'sys', 'sec'];
const COUNTDOWN_MS = 3000;          // отсчёт 3-2-1 перед стартом этапа
const ALLOWED_PENALTIES = [3, 5, 10]; // штрафы, которые бывают в игре (сек)

function createSession(title, now) {
  return {
    id: crypto.randomUUID(),
    title: String(title || '').trim().slice(0, 80) || 'Сеанс',
    createdAt: now,
    endedAt: null,
    open: {},          // этапы, обучение которых ведущая уже открыла
    participants: {},
  };
}

// Имя участника: случайное прилагательное в роде героя + имя героя.
// Прилагательные в пределах сеанса не повторяются, пока не закончится список.
function pickName(session, heroId, random = Math.random) {
  const hero = heroes[heroId];
  const used = new Set(Object.values(session.participants).map(p => p.adjective));
  const free = adjectives.map((_, i) => i).filter(i => !used.has(i));
  const pool = free.length ? free : adjectives.map((_, i) => i);
  const adjective = pool[Math.floor(random() * pool.length)];
  let name = adjectives[adjective][hero.g] + ' ' + hero.n;
  if (!free.length) {
    const same = Object.values(session.participants).filter(p => p.name === name || p.name.startsWith(name + ' ')).length;
    if (same) name += ' ' + (same + 1);
  }
  return { adjective, name };
}

function join(session, heroId, now, random) {
  if (!heroes[heroId]) throw new Error('Неизвестный герой');
  const { adjective, name } = pickName(session, heroId, random);
  const p = {
    id: crypto.randomUUID(),
    hero: heroId,
    adjective,
    name,
    joinedAt: now,
    stage: STAGES[0],
    phase: 'locked', // locked → tutorial → ready → playing → (следующий этап) … → finished
    results: {},
    progress: null,
  };
  enterStage(session, p, STAGES[0], now);
  session.participants[p.id] = p;
  return p;
}

// Что участник делает прямо сейчас — для панели ведущей. at — время последнего действия.
function setProgress(p, pct, detail, now) {
  p.progress = { pct: Math.max(0, Math.min(100, Math.round(pct))), detail: String(detail || '').slice(0, 120), at: now };
}

function isOpen(session, stage) {
  return !!(session.open && session.open[stage]);
}

// Участник подошёл к этапу: в обучение, если ведущая его уже открыла, иначе ждёт.
function enterStage(session, p, stage, now) {
  p.stage = stage;
  p.phase = isOpen(session, stage) ? 'tutorial' : 'locked';
  setProgress(p, 0, '', now);
}

function advance(session, p, now) {
  const next = STAGES[STAGES.indexOf(p.stage) + 1];
  if (next) enterStage(session, p, next, now);
  else { p.stage = null; p.phase = 'finished'; setProgress(p, 100, '', now); }
}

// Ведущая открывает обучение этапа: ждущие переходят в него сразу, остальные — когда дойдут.
function openTutorial(session, stage, now) {
  if (!STAGES.includes(stage)) throw new Error('Неизвестный этап');
  session.open = session.open || {};
  session.open[stage] = true;
  const opened = [];
  for (const p of Object.values(session.participants)) {
    if (p.stage !== stage || p.phase !== 'locked') continue;
    p.phase = 'tutorial';
    setProgress(p, 0, '', now);
    opened.push(p);
  }
  return opened;
}

// Прогресс от клиента принимается только для текущего этапа и только в обучении или игре.
function progress(p, stage, pct, detail, now) {
  if (p.stage !== stage || (p.phase !== 'tutorial' && p.phase !== 'playing')) return false;
  if (!Number.isFinite(pct)) return false;
  setProgress(p, pct, detail, now);
  return true;
}

function ready(p, stage, now) {
  if (p.stage !== stage || p.phase !== 'tutorial') return false;
  p.phase = 'ready';
  setProgress(p, 100, '', now);
  return true;
}

// Запускает этап у всех, кто отправил готовность. Время пойдёт после отсчёта.
function startStage(session, stage, now) {
  const started = [];
  for (const p of Object.values(session.participants)) {
    if (p.stage !== stage || p.phase !== 'ready') continue;
    p.phase = 'playing';
    p.results[stage] = { status: 'playing', startedAt: now + COUNTDOWN_MS, finishedAt: null, penalty: 0, errors: 0 };
    setProgress(p, 0, '', now + COUNTDOWN_MS);
    started.push(p);
  }
  return started;
}

function penalty(p, stage, seconds, now) {
  if (p.stage !== stage || p.phase !== 'playing' || !ALLOWED_PENALTIES.includes(seconds)) return false;
  const r = p.results[stage];
  r.penalty += seconds;
  r.errors += 1;
  if (p.progress) p.progress.at = now;
  return true;
}

function finish(session, p, stage, now) {
  if (p.stage !== stage || p.phase !== 'playing') return null;
  const r = p.results[stage];
  r.finishedAt = Math.max(now, r.startedAt);
  r.status = 'done';
  advance(session, p, now);
  return r;
}

// Ведущая принудительно завершает этап: кто не успел — получает «не завершил».
function stopStage(session, stage, now) {
  const stopped = [];
  for (const p of Object.values(session.participants)) {
    if (p.stage !== stage || p.phase !== 'playing') continue;
    const r = p.results[stage];
    r.finishedAt = Math.max(now, r.startedAt);
    r.status = 'stopped';
    advance(session, p, now);
    stopped.push(p);
  }
  return stopped;
}

// Итоговое время этапа в секундах: фактическое время + штрафы.
function timeSec(r) {
  if (!r || r.finishedAt == null) return null;
  return Math.round((r.finishedAt - r.startedAt) / 1000) + r.penalty;
}

function totalSec(p) {
  if (p.phase !== 'finished') return null;
  let sum = 0;
  for (const s of STAGES) {
    const r = p.results[s];
    if (!r || r.status !== 'done') return null; // в зачёт идут только полностью пройденные игры
    sum += timeSec(r);
  }
  return sum;
}

function publicResults(p) {
  const out = {};
  for (const s of STAGES) {
    const r = p.results[s];
    if (r) out[s] = { ...r, timeSec: timeSec(r) };
  }
  return out;
}

function publicParticipant(p) {
  return {
    id: p.id, name: p.name, hero: p.hero, joinedAt: p.joinedAt,
    stage: p.stage, phase: p.phase, results: publicResults(p), totalSec: totalSec(p), progress: p.progress || null,
  };
}

module.exports = {
  STAGES, COUNTDOWN_MS,
  createSession, join, openTutorial, progress, ready, startStage, penalty, finish, stopStage, timeSec, totalSec, publicParticipant,
};
