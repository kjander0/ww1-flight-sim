import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACHIEVEMENT_STORAGE_KEY,
  createAchievementState,
  loadAchievementState,
  observeAchievements,
  saveAchievementState,
} from '../lib/flight/achievements';

const observation = (
  overrides: Partial<Parameters<typeof observeAchievements>[1]> = {},
) => ({
  started: true,
  flightId: 'world:1',
  grounded: true,
  crashed: false,
  altitudeAboveGround: 0,
  ...overrides,
});

test('Flight School requires take-off, 100 m AGL, and a safe landing in order', () => {
  let state = createAchievementState();
  state = observeAchievements(state, observation()).state;
  assert.equal(state.flightSchool.phase, 'awaiting-takeoff');

  state = observeAchievements(state, observation({ grounded: false, altitudeAboveGround: 5 })).state;
  assert.equal(state.flightSchool.phase, 'climb-to-100m');
  state = observeAchievements(state, observation({ grounded: false, altitudeAboveGround: 99.9 })).state;
  assert.equal(state.flightSchool.phase, 'climb-to-100m');
  state = observeAchievements(state, observation({ grounded: false, altitudeAboveGround: 100 })).state;
  assert.equal(state.flightSchool.phase, 'land');

  const result = observeAchievements(state, observation({ grounded: true }), 1234);
  assert.deepEqual(result.completed, ['flight-school']);
  assert.equal(result.state.completed['flight-school'], 1234);
});

test('Flight School resets an incomplete attempt after a crash or aircraft change', () => {
  let state = createAchievementState();
  state = observeAchievements(state, observation({ grounded: false, altitudeAboveGround: 120 })).state;
  assert.equal(state.flightSchool.phase, 'land');
  state = observeAchievements(state, observation({ grounded: true, crashed: true })).state;
  assert.equal(state.flightSchool.phase, 'awaiting-takeoff');
  assert.equal(state.completed['flight-school'], undefined);

  state = observeAchievements(state, observation({ grounded: false })).state;
  state = observeAchievements(state, observation({ flightId: 'world:2', grounded: true })).state;
  assert.equal(state.flightSchool.flightId, 'world:2');
  assert.equal(state.flightSchool.phase, 'awaiting-takeoff');
});

test('achievement completion survives a browser-session storage round trip', () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
  const completed = {
    ...createAchievementState(),
    completed: { 'flight-school': 5678 },
  } as const;
  saveAchievementState(completed, storage);
  assert.ok(values.has(ACHIEVEMENT_STORAGE_KEY));
  assert.equal(loadAchievementState(storage).completed['flight-school'], 5678);
});
