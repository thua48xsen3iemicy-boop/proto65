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
    finalAt: null,
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
    phase: 'tutorial', // tutorial → ready → playing → (следующий этап) … → finished
    results: {},
  };
  session.participants[p.id] = p;
  return p;
}

function advance(p) {
  const next = STAGES[STAGES.indexOf(p.stage) + 1];
  if (next) { p.stage = next; p.phase = 'tutorial'; }
  else { p.stage = null; p.phase = 'finished'; }
}

function ready(p, stage) {
  if (p.stage !== stage || p.phase !== 'tutorial') return false;
  p.phase = 'ready';
  return true;
}

// Запускает этап у всех, кто отправил готовность. Время пойдёт после отсчёта.
function startStage(session, stage, now) {
  const started = [];
  for (const p of Object.values(session.participants)) {
    if (p.stage !== stage || p.phase !== 'ready') continue;
    p.phase = 'playing';
    p.results[stage] = { status: 'playing', startedAt: now + COUNTDOWN_MS, finishedAt: null, penalty: 0, errors: 0 };
    started.push(p);
  }
  return started;
}

function penalty(p, stage, seconds) {
  if (p.stage !== stage || p.phase !== 'playing' || !ALLOWED_PENALTIES.includes(seconds)) return false;
  const r = p.results[stage];
  r.penalty += seconds;
  r.errors += 1;
  return true;
}

function finish(p, stage, now) {
  if (p.stage !== stage || p.phase !== 'playing') return null;
  const r = p.results[stage];
  r.finishedAt = Math.max(now, r.startedAt);
  r.status = 'done';
  advance(p);
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
    advance(p);
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
    stage: p.stage, phase: p.phase, results: publicResults(p), totalSec: totalSec(p),
  };
}

module.exports = {
  STAGES, COUNTDOWN_MS,
  createSession, join, ready, startStage, penalty, finish, stopStage, timeSec, totalSec, publicParticipant,
};
