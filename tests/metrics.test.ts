import { describe, expect, test } from 'bun:test';
import {
  ActiveTimer,
  baseline,
  emptyRecord,
  formatClock,
  formatMinutes,
  memoryStore,
  pullRequestKey,
  savedMinutes,
  thisWeek,
  updateRecord,
  type PullRequestRecord,
} from '../src/metrics/metrics.ts';

describe('ActiveTimer', () => {
  test('counts only while visible and recently active', () => {
    let now = 0,
      visible = true,
      seconds = 0;
    const timer = new ActiveTimer({ now: () => now, visible: () => visible }, () => seconds++);
    timer.poke();
    timer.tick();
    now = 30_000;
    timer.tick();
    expect(seconds).toBe(2);
    now = 95_000;
    timer.tick(); // idle > 60 s
    expect(seconds).toBe(2);
    timer.poke();
    visible = false;
    timer.tick();
    expect(seconds).toBe(2);
    visible = true;
    timer.tick();
    expect(seconds).toBe(3);
  });
});

const record = (overrides: Partial<PullRequestRecord>): PullRequestRecord => ({ ...emptyRecord('k'), ...overrides });

describe('baseline and savings', () => {
  test('not ready until 3 PRs with ≥5 min in GitHub view', () => {
    const two = [
      record({ githubSeconds: 600, githubLines: 200 }),
      record({ githubSeconds: 900, githubLines: 300 }),
      record({ githubSeconds: 100, githubLines: 999 }),
    ];
    expect(baseline(two)).toEqual({ ready: false, pullRequests: 2, pace: 25 / 5 });
    expect(savedMinutes(record({ mosaicLines: 1000, mosaicSeconds: 60 }), baseline(two))).toBeNull();
  });
  test('pooled pace and saved minutes', () => {
    const measured = baseline([
      record({ githubSeconds: 600, githubLines: 200 }),
      record({ githubSeconds: 600, githubLines: 200 }),
      record({ githubSeconds: 1200, githubLines: 400 }),
    ]);
    expect(measured).toEqual({ ready: true, pullRequests: 3, pace: 5 });
    expect(savedMinutes(record({ mosaicLines: 1000, mosaicSeconds: 600 }), measured)).toBe(40);
  });
  test('this week filter and formatting', () => {
    const now = 10 * 24 * 3600e3;
    expect(
      thisWeek(
        [
          record({ mosaicSeconds: 5, updatedAt: now - 1 }),
          record({ mosaicSeconds: 5, updatedAt: 0 }),
          record({ updatedAt: now }),
        ],
        now,
      ),
    ).toHaveLength(1);
    expect(formatClock(125)).toBe('2:05');
    expect(formatMinutes(63.4)).toBe('1h 03m');
    expect(formatMinutes(-12.2)).toBe('12 min');
    expect(pullRequestKey('Acme', 'Habit-Tracker', 410)).toBe('pr:acme/habit-tracker#410');
  });
  test('updateRecord merges with defaults', async () => {
    const store = memoryStore();
    await updateRecord(store, 'pr:a', stored => {
      stored.mosaicSeconds += 5;
    });
    const updated = await updateRecord(store, 'pr:a', stored => {
      stored.mosaicSeconds += 5;
    });
    expect(updated.mosaicSeconds).toBe(10);
    expect((await store.all('pr:')).length).toBe(1);
  });
});
