'use strict';
// Хранение сеансов: один JSON-файл на сеанс в <dataDir>/sessions.
// Запись атомарная (временный файл + rename) и с небольшой задержкой, чтобы не писать на каждый клик.

const fs = require('node:fs');
const path = require('node:path');

const SAVE_DELAY_MS = 300;

class Store {
  constructor(dataDir) {
    this.dir = path.join(dataDir, 'sessions');
    this.sessions = new Map();
    this.pending = new Map();
  }

  load() {
    fs.mkdirSync(this.dir, { recursive: true });
    for (const f of fs.readdirSync(this.dir)) {
      if (!f.endsWith('.json')) continue;
      try {
        const s = JSON.parse(fs.readFileSync(path.join(this.dir, f), 'utf8'));
        this.sessions.set(s.id, s);
      } catch (e) {
        console.error('Не удалось прочитать сеанс', f, e.message);
      }
    }
    return this;
  }

  active() {
    for (const s of this.sessions.values()) if (!s.endedAt) return s;
    return null;
  }

  get(id) { return this.sessions.get(id) || null; }

  add(session) {
    this.sessions.set(session.id, session);
    this.saveNow(session);
  }

  list() {
    return [...this.sessions.values()].sort((a, b) => b.createdAt - a.createdAt);
  }

  save(session) {
    if (this.pending.has(session.id)) return;
    this.pending.set(session.id, setTimeout(() => this.saveNow(session), SAVE_DELAY_MS));
  }

  saveNow(session) {
    clearTimeout(this.pending.get(session.id));
    this.pending.delete(session.id);
    const file = path.join(this.dir, session.id + '.json');
    fs.writeFileSync(file + '.tmp', JSON.stringify(session, null, 1));
    fs.renameSync(file + '.tmp', file);
  }

  flush() {
    for (const id of [...this.pending.keys()]) this.saveNow(this.sessions.get(id));
  }
}

module.exports = { Store };
