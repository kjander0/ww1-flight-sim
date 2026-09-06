import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACHIEVEMENT_STORAGE_KEY,
  achievementProgressLabel,
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
  aircraftType: 'scout' as const,
  grounded: true,
  crashed: false,
  altitudeAboveGround: 0,
  rollRadians: 0,
  rollControl: 0,
  loopRotation: 0,
  betweenTrees: false,
  enemyBuildingsBombed: 0,
  enemyAircraftStrafed: 0,
  enemyAircraftKills: 0,
  enemyAircraftBombed: 0,
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

test('mission completion survives a browser-session storage round trip', () => {
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

test('Roll accumulates wrapped bank rotation only while the pilot applies roll control', () => {
  let state = createAchievementState();
  for (const rollRadians of [0, 1.4, 2.8, -2.1, -.7, .1]) {
    state = observeAchievements(state, observation({ grounded: false, rollRadians, rollControl: 1 })).state;
  }
  assert.ok(state.completed.roll);
  assert.equal(achievementProgressLabel(state, 'roll'), 'Complete');

  let loopOnly = createAchievementState();
  for (const rollRadians of [0, 1.6, 3.1, -1.6, 0]) {
    loopOnly = observeAchievements(loopOnly, observation({ grounded: false, rollRadians, rollControl: 0 })).state;
  }
  assert.equal(loopOnly.completed.roll, undefined);
});

test('Forest Path requires an airborne aircraft between two qualifying trees', () => {
  let state = createAchievementState();
  state = observeAchievements(state, observation({ betweenTrees: true })).state;
  assert.equal(state.completed['forest-path'], undefined);
  const result = observeAchievements(state, observation({ grounded: false, betweenTrees: true }), 2222);
  assert.deepEqual(result.completed, ['forest-path']);
  assert.equal(result.state.completed['forest-path'], 2222);
});

test('Bombs Away requires a bomber takeoff and two player-bombed enemy buildings in one flight', () => {
  let scout = createAchievementState();
  scout = observeAchievements(scout, observation({ grounded: false, enemyBuildingsBombed: 2 })).state;
  assert.equal(scout.completed['bombs-away'], undefined);

  let bomber = createAchievementState();
  bomber = observeAchievements(bomber, observation({ aircraftType: 'bomber', enemyBuildingsBombed: 3 })).state;
  bomber = observeAchievements(bomber, observation({ aircraftType: 'bomber', grounded: false, enemyBuildingsBombed: 3 })).state;
  bomber = observeAchievements(bomber, observation({ aircraftType: 'bomber', grounded: false, enemyBuildingsBombed: 4 })).state;
  assert.equal(achievementProgressLabel(bomber, 'bombs-away'), '1 / 2 enemy buildings bombed');
  const result = observeAchievements(bomber, observation({ aircraftType: 'bomber', grounded: false, enemyBuildingsBombed: 5 }), 3333);
  assert.deepEqual(result.completed, ['bombs-away']);

  let crashed = createAchievementState();
  crashed = observeAchievements(crashed, observation({ aircraftType: 'bomber', grounded: false })).state;
  crashed = observeAchievements(crashed, observation({ aircraftType: 'bomber', grounded: false, enemyBuildingsBombed: 1 })).state;
  crashed = observeAchievements(crashed, observation({ aircraftType: 'bomber', crashed: true, enemyBuildingsBombed: 1 })).state;
  crashed = observeAchievements(crashed, observation({ aircraftType: 'bomber', grounded: false, enemyBuildingsBombed: 2 })).state;
  assert.equal(crashed.completed['bombs-away'], undefined);
});

test('Strafe and First Kill respond only to their attributed combat counters', () => {
  let state = createAchievementState();
  state = observeAchievements(state, observation({ grounded: false })).state;
  state = observeAchievements(state, observation({ grounded: false, enemyAircraftStrafed: 1 }), 4001).state;
  assert.equal(state.completed.strafe, 4001);
  assert.equal(state.completed['first-kill'], undefined);
  state = observeAchievements(state, observation({ grounded: false, enemyAircraftStrafed: 1, enemyAircraftKills: 1 }), 4002).state;
  assert.equal(state.completed['first-kill'], 4002);

  let simultaneousCrash = createAchievementState();
  simultaneousCrash = observeAchievements(simultaneousCrash, observation({ grounded: false })).state;
  simultaneousCrash = observeAchievements(simultaneousCrash, observation({ crashed: true, enemyAircraftKills: 1 }), 4003).state;
  assert.equal(simultaneousCrash.completed['first-kill'], 4003);
});

test('Stunt Pilot requires one continuous full pitch rotation while airborne', () => {
  let state = createAchievementState();
  state = observeAchievements(state, observation({ grounded: false, loopRotation: 0 })).state;
  state = observeAchievements(state, observation({ grounded: false, loopRotation: Math.PI }), 5001).state;
  assert.equal(state.completed['stunt-pilot'], undefined);
  const result = observeAchievements(state, observation({ grounded: false, loopRotation: Math.PI * 1.8 }), 5002);
  assert.equal(result.state.completed['stunt-pilot'], 5002);
  assert.equal(achievementProgressLabel(result.state, 'stunt-pilot'), 'Complete');
});

test('Ace counts five airborne kills in one crash-free flight and resets after a crash', () => {
  let state = createAchievementState();
  state = observeAchievements(state, observation({ grounded: false })).state;
  state = observeAchievements(state, observation({ grounded: false, enemyAircraftKills: 4 })).state;
  assert.equal(state.completed.ace, undefined);
  state = observeAchievements(state, observation({ crashed: true, enemyAircraftKills: 4 })).state;
  state = observeAchievements(state, observation({ flightId: 'world:2', grounded: false, enemyAircraftKills: 4 })).state;
  const result = observeAchievements(state, observation({ flightId: 'world:2', grounded: false, enemyAircraftKills: 9 }), 6001);
  assert.equal(result.state.completed.ace, 6001);
});

test('Bully completes when a player bomb kills an AI-piloted enemy aircraft', () => {
  let state = createAchievementState();
  state = observeAchievements(state, observation({ grounded: false })).state;
  assert.equal(state.completed.bully, undefined);
  const result = observeAchievements(state, observation({ grounded: false, enemyAircraftBombed: 1 }), 7001);
  assert.equal(result.state.completed.bully, 7001);
  assert.equal(achievementProgressLabel(result.state, 'bully'), 'Complete');
});
