import { config } from '../config.js';
import { repo } from '../db/index.js';

// ---------------------------------------------------------------------------
// Daily budget guard
//
// Hypixel's developer-key request cap is DAILY and shared across every key on
// the account (a brand-new key shows 0/300 once the account's day is spent). So
// the only way to keep working is to spend that daily budget deliberately:
//   - persist usage across restarts (restarts were the #1 way it got burned),
//   - spread the allowance evenly across the whole UTC day so it never runs out
//     mid-morning,
//   - hard-stop (and mark spent) the moment Hypixel reports a daily throttle.
//
// The guard gates EVERY keyed request. When the budget is exhausted (or paced
// out for the moment) the crawler simply waits — the keyless AH worker keeps
// finding rares regardless.
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;
const utcDay = (t = Date.now()) => Math.floor(t / DAY_MS); // integer UTC day index
const META_DAY = 'budget_day';
const META_USED = 'budget_used';
const META_SPENT = 'budget_spent_until'; // ms epoch we consider the budget gone until

function load() {
  const day = Number(repo.getMeta(META_DAY, '-1'));
  const today = utcDay();
  if (day !== today) {
    // New UTC day -> reset.
    repo.setMeta(META_DAY, String(today));
    repo.setMeta(META_USED, '0');
    repo.setMeta(META_SPENT, '0');
    return { day: today, used: 0, spentUntil: 0 };
  }
  return {
    day,
    used: Number(repo.getMeta(META_USED, '0')) || 0,
    spentUntil: Number(repo.getMeta(META_SPENT, '0')) || 0,
  };
}

export function budgetStatus() {
  const { used, spentUntil } = load();
  const limit = config.budget.dailyLimit;
  const now = Date.now();
  // How far into the UTC day are we (0..1)?
  const dayProgress = (now % DAY_MS) / DAY_MS;
  // Target "should have used by now" if spending evenly across the day.
  const pacedAllowance = Math.ceil(limit * Math.min(1, dayProgress + config.budget.headstart));
  const remaining = Math.max(0, limit - used);
  const msToReset = DAY_MS - (now % DAY_MS);
  const spent = spentUntil > now || remaining <= 0;
  return {
    limit,
    used,
    remaining,
    pacedAllowance,
    pacedRemaining: Math.max(0, pacedAllowance - used),
    spent,
    spentUntil: spentUntil > now ? spentUntil : null,
    resetInMs: msToReset,
    resetInHours: Math.round(msToReset / 3.6e6 * 10) / 10,
  };
}

// Can we spend one request right now? Enforces both the hard daily cap and the
// even-spread pace (so we don't blow the day's budget in the first hour).
export function canSpend() {
  if (!config.budget.enabled) return true;
  const s = budgetStatus();
  if (s.spent) return false;            // daily cap hit (or marked spent by a 429)
  if (s.pacedRemaining <= 0) return false; // ahead of pace — wait a bit
  return true;
}

// Record a successful keyed request against today's budget.
export function recordSpend(n = 1) {
  if (!config.budget.enabled) return;
  const { used } = load();
  repo.setMeta(META_USED, String(used + n));
}

// Hypixel told us the DAILY budget is gone — mark it spent until reset so we
// stop trying immediately (and don't waste a fresh key).
export function markDailyThrottled() {
  const now = Date.now();
  repo.setMeta(META_SPENT, String(now + (DAY_MS - (now % DAY_MS))));
  // Also flag used at limit so status reads as exhausted.
  repo.setMeta(META_USED, String(config.budget.dailyLimit));
}
