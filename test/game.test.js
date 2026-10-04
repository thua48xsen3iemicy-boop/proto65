'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const game = require('../server/game');
const adjectives = require('../server/adjectives.json');

const T0 = 1_000_000;

test('имя согласовано с родом героя и не повторяется в сеансе', () => {
  const s = game.createSession('Тест', T0);
  const kitty = game.join(s, 'wonder', T0);
  const cat = game.join(s, 'bat', T0);
  assert.match(kitty.name, /^\S+ая Чудо-кошка$/);
  assert.match(cat.name, /^\S+(ый|ий|ой) Бэт-кот$/);
  for (let i = 0; i < adjectives.length - 2; i++) game.join(s, 'iron', T0);
  const adj = Object.values(s.participants).map(p => p.adjective);
  assert.equal(new Set(adj).size, adjectives.length, 'все прилагательные использованы по одному разу');
  // список исчерпан — имена всё равно различаются
  const extra = [game.join(s, 'iron', T0), game.join(s, 'iron', T0)];
  const names = Object.values(s.participants).map(p => p.name);
  assert.equal(new Set(names).size, names.length);
  assert.ok(extra.every(p => p.name.includes('Железный кот')));
});

test('неизвестный герой отклоняется', () => {
  const s = game.createSession('Тест', T0);
  assert.throws(() => game.join(s, 'dog', T0));
});

test('полный проход: время = фактическое + штрафы, этапы идут по порядку', () => {
  const s = game.createSession('Тест', T0);
  const p = game.join(s, 'flash', T0);
  let now = T0;
  for (const stage of game.STAGES) {
    assert.equal(p.stage, stage);
    assert.equal(game.startStage(s, stage, now).length, 0, 'без готовности этап не стартует');
    assert.ok(game.ready(p, stage));
    assert.equal(game.startStage(s, stage, now).length, 1);
    const startedAt = now + game.COUNTDOWN_MS;
    assert.equal(p.results[stage].startedAt, startedAt);
    assert.ok(game.penalty(p, stage, 5));
    assert.ok(!game.penalty(p, stage, 999), 'произвольный штраф не принимается');
    now = startedAt + 42_000;
    assert.ok(game.finish(p, stage, now));
    assert.equal(game.timeSec(p.results[stage]), 47);
    assert.ok(!game.finish(p, stage, now + 1000), 'повторное завершение игнорируется');
  }
  assert.equal(p.phase, 'finished');
  assert.equal(game.totalSec(p), 47 * 3);
});

test('ведущая завершает этап: кто играл — «не завершил», кто ещё учится — не затронут', () => {
  const s = game.createSession('Тест', T0);
  const a = game.join(s, 'iron', T0);
  const b = game.join(s, 'super', T0);
  game.ready(a, 'program');
  game.startStage(s, 'program', T0);
  const stopped = game.stopStage(s, 'program', T0 + 63_000);
  assert.deepEqual(stopped.map(p => p.id), [a.id]);
  assert.equal(a.results.program.status, 'stopped');
  assert.equal(game.timeSec(a.results.program), 60);
  assert.equal(a.stage, 'sys');
  assert.equal(a.phase, 'tutorial');
  assert.equal(b.phase, 'tutorial');
  assert.equal(b.stage, 'program');
});

test('опоздавшие запускаются отдельным стартом со своим временем', () => {
  const s = game.createSession('Тест', T0);
  const a = game.join(s, 'iron', T0);
  const b = game.join(s, 'bat', T0);
  game.ready(a, 'program');
  game.startStage(s, 'program', T0);
  game.ready(b, 'program');
  game.startStage(s, 'program', T0 + 30_000);
  assert.equal(a.results.program.startedAt, T0 + game.COUNTDOWN_MS);
  assert.equal(b.results.program.startedAt, T0 + 30_000 + game.COUNTDOWN_MS);
});

test('в общий зачёт идёт только полностью пройденная игра', () => {
  const s = game.createSession('Тест', T0);
  const p = game.join(s, 'iron', T0);
  game.ready(p, 'program');
  game.startStage(s, 'program', T0);
  game.stopStage(s, 'program', T0 + 10_000);
  for (const stage of ['sys', 'sec']) {
    game.ready(p, stage);
    game.startStage(s, stage, T0);
    game.finish(p, stage, T0 + 20_000);
  }
  assert.equal(p.phase, 'finished');
  assert.equal(game.totalSec(p), null);
});
