import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpDb = path.join(os.tmpdir(), `tracker-budget-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = tmpDb;
process.env.DAILY_REQUEST_LIMIT = '100';
process.env.BUDGET_HEADSTART = '0';

const { repo } = await import('../src/db/index.js');
const { budgetStatus, canSpend, recordSpend, markDailyThrottled } = await import('../src/scanner/budget.js');

after(() => {
  for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(tmpDb + s); } catch { /* ignore */ } }
});

test('budget: starts fresh with full allowance', () => {
  const s = budgetStatus();
  assert.equal(s.limit, 100);
  assert.equal(s.used, 0);
  assert.equal(s.remaining, 100);
});

test('budget: recordSpend persists and is reflected', () => {
  recordSpend(5);
  assert.equal(budgetStatus().used, 5);
  // persisted in meta, survives a re-read
  assert.equal(Number(repo.getMeta('budget_used', '0')), 5);
});

test('budget: paced allowance limits early-day spending', () => {
  // With headstart 0, paced allowance ≈ limit × fraction-of-day-elapsed. Early
  // in the UTC day that is small, so after spending a chunk we should be paced
  // out (canSpend false) even though the hard cap isn't hit.
  recordSpend(60); // used now 65 of 100
  const s = budgetStatus();
  if (s.pacedAllowance < s.used) {
    assert.equal(canSpend(), false, 'should be paced out when ahead of schedule');
  } else {
    // Late in the UTC day the pace allows it; just assert consistency.
    assert.equal(canSpend(), s.remaining > 0);
  }
});

test('budget: daily throttle marks it spent until reset', () => {
  markDailyThrottled();
  const s = budgetStatus();
  assert.equal(s.spent, true);
  assert.equal(canSpend(), false);
  assert.ok(s.resetInMs > 0);
});
