'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const game = require('../server/game');
const adjectives = require('../server/adjectives.json');

const T0 = 1_000_000;

// Сеанс, где ведущая сразу открыла обучение всех этапов.
function openSession() {
  const s = game.createSession('Тест', T0);
  for (const st of game.STAGES) game.openTutorial(s, st, T0);
  return s;
}

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
  const s = openSession();
  const p = game.join(s, 'flash', T0);
  let now = T0;
  for (const stage of game.STAGES) {
    assert.equal(p.stage, stage);
    assert.equal(game.startStage(s, stage, now).length, 0, 'без готовности этап не стартует');
    assert.ok(game.ready(p, stage, now));
    assert.equal(game.startStage(s, stage, now).length, 1);
    const startedAt = now + game.COUNTDOWN_MS;
    assert.equal(p.results[stage].startedAt, startedAt);
    assert.ok(game.penalty(p, stage, 5, now));
    assert.ok(!game.penalty(p, stage, 999, now), 'произвольный штраф не принимается');
    now = startedAt + 42_000;
    assert.ok(game.finish(s, p, stage, now));
    assert.equal(game.timeSec(p.results[stage]), 47);
    assert.ok(!game.finish(s, p, stage, now + 1000), 'повторное завершение игнорируется');
  }
  assert.equal(p.phase, 'finished');
  assert.equal(game.totalSec(p), 47 * 3);
});

test('ведущая завершает этап: кто играл — «не завершил», кто ещё учится — не затронут', () => {
  const s = openSession();
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
  const s = openSession();
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
  const s = openSession();
  const p = game.join(s, 'iron', T0);
  game.ready(p, 'program');
  game.startStage(s, 'program', T0);
  game.stopStage(s, 'program', T0 + 10_000);
  for (const stage of ['sys', 'sec']) {
    game.ready(p, stage);
    game.startStage(s, stage, T0);
    game.finish(s, p, stage, T0 + 20_000);
  }
  assert.equal(p.phase, 'finished');
  assert.equal(game.totalSec(p), null);
});

test('обучение открывает ведущая: до этого участник ждёт, после — опоздавшие входят сразу', () => {
  const s = game.createSession('Тест', T0);
  const a = game.join(s, 'iron', T0);
  assert.equal(a.phase, 'locked');
  assert.ok(!game.ready(a, 'program', T0), 'без открытого обучения готовность не принимается');
  assert.deepEqual(game.openTutorial(s, 'program', T0).map(p => p.id), [a.id]);
  assert.equal(a.phase, 'tutorial');
  const late = game.join(s, 'bat', T0 + 5000);
  assert.equal(late.phase, 'tutorial', 'опоздавший попадает в открытое обучение без ожидания');
  // после этапа 1 следующий этап закрыт, пока ведущая его не откроет
  game.ready(a, 'program', T0);
  game.startStage(s, 'program', T0);
  game.finish(s, a, 'program', T0 + 60_000);
  assert.equal(a.stage, 'sys');
  assert.equal(a.phase, 'locked');
  game.openTutorial(s, 'sys', T0 + 70_000);
  assert.equal(a.phase, 'tutorial');
  assert.throws(() => game.openTutorial(s, 'nope', T0));
});

test('прогресс принимается только по текущему этапу и сбрасывается при переходах', () => {
  const s = openSession();
  const p = game.join(s, 'iron', T0);
  assert.ok(game.progress(p, 'program', 100, 'Задание обучения выполнено', T0 + 1000));
  assert.ok(!game.progress(p, 'sys', 50, 'чужой этап', T0 + 1000));
  game.ready(p, 'program', T0 + 2000);
  assert.ok(!game.progress(p, 'program', 10, 'в ожидании', T0 + 2000), 'в ожидании старта прогресс не принимается');
  game.startStage(s, 'program', T0 + 3000);
  assert.equal(p.progress.pct, 0);
  assert.ok(game.progress(p, 'program', 250, 'x'.repeat(500), T0 + 9000));
  assert.equal(p.progress.pct, 100, 'процент ограничен 0..100');
  assert.equal(p.progress.detail.length, 120, 'описание обрезается');
  assert.ok(!game.progress(p, 'program', NaN, '', T0));
  game.penalty(p, 'program', 5, T0 + 12_000);
  assert.equal(p.progress.at, T0 + 12_000, 'штраф тоже считается действием');
  assert.equal(game.publicParticipant(p).progress.pct, 100);
});
