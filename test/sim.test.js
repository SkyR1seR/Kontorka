// Прогон полного матча ботами (режим разработчика): матч должен доходить до финала
// и всегда определять ровно один исход (TZ 10.1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/shared/game.js';
import { STAFF } from '../src/shared/content.js';

function runMatch(seed, n = 8, length = 'short') {
  const members = [];
  for (let i = 0; i < n; i++) members.push({ id: `bot${i}`, name: STAFF[i].name, staff: i, isBot: true });
  let result = null;
  const g = new Game({ members, seed, settings: { length, dev: true }, onEnd: (r) => { result = r; } });
  g.start();
  const dt = 1 / 30;
  let steps = 0;
  while (!result && steps < 30 * 60 * 40) { g.tick(dt); steps++; }
  return { g, result, minutes: g.t / 60 };
}

test('матч ботами доходит до финала', () => {
  const stats = [];
  for (let s = 1; s <= 6; s++) {
    const { g, result, minutes } = runMatch(1000 + s, 6 + (s % 7));
    assert.ok(result, 'нет результата');
    assert.ok(['kontorka', 'kontorka_partial', 'vrediteli', 'none'].includes(result.winner));
    stats.push({ seed: s, winner: result.winner, plan: `${result.plan}/${result.planTarget}`, sab: g.incidents.length,
      dec: g.decisions.map((d) => `${d.sanction}${d.correct === null ? '' : d.correct ? '+' : '-'}`).join(','),
      deb: result.debiki, kred: result.krediki, min: minutes.toFixed(1), reason: result.reason });
  }
  console.table(stats);
});
