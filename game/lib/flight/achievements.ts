import type { AircraftType } from './aircraft';

export const ACHIEVEMENTS = [
  {
    id: 'flight-school',
    name: 'Flight School',
    description: 'Take off, climb to at least 100 m above the ground, then land safely.',
  },
  {
    id: 'roll',
    name: 'Roll',
    description: 'Complete a full barrel roll while airborne.',
  },
  {
    id: 'forest-path',
    name: 'Forest Path',
    description: 'Fly between two nearby trees with the aircraft below both treetops.',
  },
  {
    id: 'bombs-away',
    name: 'Bombs Away',
    description: 'Take off in the bomber, then destroy two enemy buildings with your bombs in that flight.',
  },
  {
    id: 'strafe',
    name: 'Strafe',
    description: 'Destroy a grounded enemy aircraft with your machine gun.',
  },
  {
    id: 'first-kill',
    name: 'First Kill',
    description: 'Shoot down an airborne enemy aircraft with your machine gun.',
  },
  {
    id: 'stunt-pilot',
    name: 'Stunt Pilot',
    description: 'Complete a full loop while airborne.',
  },
  {
    id: 'bully',
    name: 'Bully',
    description: 'Kill an AI-piloted enemy aircraft with one of your bombs. Aircraft on a runway count.',
  },
  {
    id: 'ace',
    name: 'Ace',
    description: 'Shoot down five enemy aircraft in one flight without crashing.',
  },
] as const;

export type AchievementId = (typeof ACHIEVEMENTS)[number]['id'];
export type FlightSchoolPhase = 'awaiting-takeoff' | 'climb-to-100m' | 'land';
export type AchievementState = {
  version: 1;
  completed: Partial<Record<AchievementId, number>>;
  flightSchool: { flightId: string | null; phase: FlightSchoolPhase };
  roll: { flightId: string | null; lastRoll: number | null; rotation: number };
  bombsAway: {
    flightId: string | null;
    tookOff: boolean;
    buildingBaseline: number;
    buildingsBombed: number;
  };
  combat: {
    flightId: string | null;
    strafeBaseline: number;
    killBaseline: number;
    bombedAircraftBaseline: number;
    killsThisFlight: number;
  };
  loop: { flightId: string | null; rotation: number };
};

export type AchievementObservation = {
  started: boolean;
  flightId: string;
  aircraftType: AircraftType;
  grounded: boolean;
  crashed: boolean;
  altitudeAboveGround: number;
  rollRadians: number;
  rollControl: number;
  loopRotation: number;
  betweenTrees: boolean;
  enemyBuildingsBombed: number;
  enemyAircraftStrafed: number;
  enemyAircraftKills: number;
  enemyAircraftBombed: number;
};

export const ACHIEVEMENT_STORAGE_KEY = 'super-flight:achievements:v1';

export function createAchievementState(): AchievementState {
  return {
    version: 1,
    completed: {},
    flightSchool: { flightId: null, phase: 'awaiting-takeoff' },
    roll: { flightId: null, lastRoll: null, rotation: 0 },
    bombsAway: {
      flightId: null,
      tookOff: false,
      buildingBaseline: 0,
      buildingsBombed: 0,
    },
    combat: { flightId: null, strafeBaseline: 0, killBaseline: 0, bombedAircraftBaseline: 0, killsThisFlight: 0 },
    loop: { flightId: null, rotation: 0 },
  };
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

export function loadAchievementState(storage?: StorageLike): AchievementState {
  const fallback = createAchievementState();
  if (!storage) return fallback;
  try {
    const parsed = JSON.parse(storage.getItem(ACHIEVEMENT_STORAGE_KEY) ?? 'null') as Partial<AchievementState> | null;
    if (!parsed || parsed.version !== 1) return fallback;
    for (const achievement of ACHIEVEMENTS) {
      const completedAt = parsed.completed?.[achievement.id];
      if (typeof completedAt === 'number' && Number.isFinite(completedAt)) fallback.completed[achievement.id] = completedAt;
    }
    const flightSchool = parsed.flightSchool;
    if (flightSchool && typeof flightSchool.flightId === 'string' && ['awaiting-takeoff', 'climb-to-100m', 'land'].includes(flightSchool.phase)) {
      fallback.flightSchool = { flightId: flightSchool.flightId, phase: flightSchool.phase };
    }
    const roll = parsed.roll;
    if (roll && typeof roll.flightId === 'string') {
      fallback.roll = {
        flightId: roll.flightId,
        lastRoll: typeof roll.lastRoll === 'number' && Number.isFinite(roll.lastRoll) ? roll.lastRoll : null,
        rotation: typeof roll.rotation === 'number' && Number.isFinite(roll.rotation) ? roll.rotation : 0,
      };
    }
    const bombsAway = parsed.bombsAway;
    if (bombsAway && typeof bombsAway.flightId === 'string') {
      fallback.bombsAway = {
        flightId: bombsAway.flightId,
        tookOff: bombsAway.tookOff === true,
        buildingBaseline: Number.isFinite(bombsAway.buildingBaseline) ? bombsAway.buildingBaseline : 0,
        buildingsBombed: Number.isFinite(bombsAway.buildingsBombed) ? bombsAway.buildingsBombed : 0,
      };
    }
    const combat = parsed.combat;
    if (combat && typeof combat.flightId === 'string') {
      fallback.combat = {
        flightId: combat.flightId,
        strafeBaseline: Number.isFinite(combat.strafeBaseline) ? combat.strafeBaseline : 0,
        killBaseline: Number.isFinite(combat.killBaseline) ? combat.killBaseline : 0,
        bombedAircraftBaseline: Number.isFinite(combat.bombedAircraftBaseline) ? combat.bombedAircraftBaseline : 0,
        killsThisFlight: Number.isFinite(combat.killsThisFlight) ? combat.killsThisFlight : 0,
      };
    }
    const loop = parsed.loop;
    if (loop && typeof loop.flightId === 'string') {
      fallback.loop = {
        flightId: loop.flightId,
        rotation: Number.isFinite(loop.rotation) ? loop.rotation : 0,
      };
    }
    return fallback;
  } catch {
    return fallback;
  }
}

export function saveAchievementState(state: AchievementState, storage?: StorageLike) {
  try {
    storage?.setItem(ACHIEVEMENT_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Progress still works for this page view if session storage is unavailable.
  }
}

const wrappedAngleDelta = (from: number, to: number) => Math.atan2(Math.sin(to - from), Math.cos(to - from));

export function observeAchievements(
  state: AchievementState,
  observation: AchievementObservation,
  completedAt = Date.now(),
): { state: AchievementState; completed: AchievementId[] } {
  if (!observation.started) return { state, completed: [] };
  let next = state;
  const completed: AchievementId[] = [];
  const mutate = () => {
    if (next === state) next = {
      ...state,
      completed: { ...state.completed },
      flightSchool: { ...state.flightSchool },
      roll: { ...state.roll },
      bombsAway: { ...state.bombsAway },
      combat: { ...state.combat },
      loop: { ...state.loop },
    };
  };
  const complete = (id: AchievementId) => {
    if (next.completed[id]) return;
    mutate();
    next.completed[id] = completedAt;
    completed.push(id);
  };

  if (!next.completed['flight-school']) {
    if (next.flightSchool.flightId !== observation.flightId) {
      mutate();
      next.flightSchool = { flightId: observation.flightId, phase: 'awaiting-takeoff' };
    }
    if (observation.crashed) {
      if (next.flightSchool.phase !== 'awaiting-takeoff') {
        mutate();
        next.flightSchool.phase = 'awaiting-takeoff';
      }
    } else if (!observation.grounded && next.flightSchool.phase === 'awaiting-takeoff') {
      mutate();
      next.flightSchool.phase = observation.altitudeAboveGround >= 100 ? 'land' : 'climb-to-100m';
    } else if (!observation.grounded && observation.altitudeAboveGround >= 100 && next.flightSchool.phase === 'climb-to-100m') {
      mutate();
      next.flightSchool.phase = 'land';
    } else if (observation.grounded && next.flightSchool.phase === 'land') {
      complete('flight-school');
    }
  }

  if (!next.completed.roll) {
    if (next.roll.flightId !== observation.flightId || observation.crashed || observation.grounded) {
      const reset = { flightId: observation.flightId, lastRoll: observation.rollRadians, rotation: 0 };
      if (next.roll.flightId !== reset.flightId || next.roll.lastRoll !== reset.lastRoll || next.roll.rotation !== 0) {
        mutate();
        next.roll = reset;
      }
    } else {
      const lastRoll = next.roll.lastRoll;
      const delta = lastRoll === null || Math.abs(observation.rollControl) < .35
        ? 0
        : wrappedAngleDelta(lastRoll, observation.rollRadians);
      mutate();
      next.roll.lastRoll = observation.rollRadians;
      next.roll.rotation += delta;
      if (Math.abs(next.roll.rotation) >= Math.PI * 1.78) complete('roll');
    }
  }

  if (!next.completed['forest-path'] && !observation.grounded && !observation.crashed && observation.betweenTrees) {
    complete('forest-path');
  }

  if (!next.completed['bombs-away']) {
    if (next.bombsAway.flightId !== observation.flightId) {
      mutate();
      next.bombsAway = {
        flightId: observation.flightId,
        tookOff: false,
        buildingBaseline: observation.enemyBuildingsBombed,
        buildingsBombed: 0,
      };
    }
    if (observation.crashed) {
      if (next.bombsAway.tookOff || next.bombsAway.buildingBaseline !== observation.enemyBuildingsBombed || next.bombsAway.buildingsBombed !== 0) {
        mutate();
        next.bombsAway.tookOff = false;
        next.bombsAway.buildingBaseline = observation.enemyBuildingsBombed;
        next.bombsAway.buildingsBombed = 0;
      }
    } else if (observation.aircraftType === 'bomber') {
      if (!observation.grounded && !next.bombsAway.tookOff) {
        mutate();
        next.bombsAway.tookOff = true;
      }
      const buildingsBombed = Math.max(0, observation.enemyBuildingsBombed - next.bombsAway.buildingBaseline);
      if (buildingsBombed !== next.bombsAway.buildingsBombed) {
        mutate();
        next.bombsAway.buildingsBombed = buildingsBombed;
      }
      if (next.bombsAway.tookOff && next.bombsAway.buildingsBombed >= 2) complete('bombs-away');
    }
  }

  if (next.combat.flightId !== observation.flightId) {
    mutate();
    next.combat = {
      flightId: observation.flightId,
      strafeBaseline: observation.enemyAircraftStrafed,
      killBaseline: observation.enemyAircraftKills,
      bombedAircraftBaseline: observation.enemyAircraftBombed,
      killsThisFlight: 0,
    };
  }
  const hasNewAirborneKill = observation.enemyAircraftKills > next.combat.killBaseline;
  if (!next.completed['first-kill'] && hasNewAirborneKill) complete('first-kill');
  if (observation.crashed) {
    if (next.combat.killBaseline !== observation.enemyAircraftKills || next.combat.killsThisFlight !== 0) {
      mutate();
      next.combat.killBaseline = observation.enemyAircraftKills;
      next.combat.killsThisFlight = 0;
    }
  } else {
    const killsThisFlight = Math.max(0, observation.enemyAircraftKills - next.combat.killBaseline);
    if (killsThisFlight !== next.combat.killsThisFlight) {
      mutate();
      next.combat.killsThisFlight = killsThisFlight;
    }
  }
  if (!next.completed.strafe && observation.enemyAircraftStrafed > next.combat.strafeBaseline) complete('strafe');
  if (!next.completed.bully && observation.enemyAircraftBombed > next.combat.bombedAircraftBaseline) complete('bully');
  if (!next.completed.ace && !observation.crashed && next.combat.killsThisFlight >= 5) complete('ace');

  if (!next.completed['stunt-pilot']) {
    if (next.loop.flightId !== observation.flightId || observation.crashed || observation.grounded) {
      if (next.loop.flightId !== observation.flightId || next.loop.rotation !== 0) {
        mutate();
        next.loop = { flightId: observation.flightId, rotation: 0 };
      }
    } else if (next.loop.rotation !== observation.loopRotation) {
      mutate();
      next.loop.rotation = observation.loopRotation;
      if (Math.abs(next.loop.rotation) >= Math.PI * 1.78) complete('stunt-pilot');
    }
  }

  return { state: next, completed };
}

export function achievementProgressLabel(state: AchievementState, id: AchievementId) {
  if (state.completed[id]) return 'Complete';
  if (id === 'flight-school') {
    return state.flightSchool.phase === 'awaiting-takeoff'
      ? 'Take off'
      : state.flightSchool.phase === 'climb-to-100m'
        ? 'Climb to 100 m above ground'
        : 'Land safely';
  }
  if (id === 'roll') return `${Math.min(100, Math.round(Math.abs(state.roll.rotation) / (Math.PI * 2) * 100))}% of roll`;
  if (id === 'forest-path') return 'Find a narrow gap between two trees';
  if (id === 'bombs-away') return state.bombsAway.tookOff
    ? `${Math.min(2, state.bombsAway.buildingsBombed)} / 2 enemy buildings bombed`
    : 'Take off in the bomber';
  if (id === 'strafe') return 'Destroy a grounded enemy aircraft';
  if (id === 'first-kill') return 'Shoot down an airborne enemy aircraft';
  if (id === 'stunt-pilot') return `${Math.min(100, Math.round(Math.abs(state.loop.rotation) / (Math.PI * 2) * 100))}% of loop`;
  if (id === 'bully') return 'Bomb an AI-piloted enemy aircraft';
  return `${Math.min(5, state.combat.killsThisFlight)} / 5 kills without crashing`;
}
