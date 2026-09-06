export const ACHIEVEMENTS = [
  {
    id: 'flight-school',
    name: 'Flight School',
    description: 'Take off, climb to at least 100 m above the ground, then land safely.',
  },
] as const;

export type AchievementId = (typeof ACHIEVEMENTS)[number]['id'];
export type FlightSchoolPhase = 'awaiting-takeoff' | 'climb-to-100m' | 'land';

export type AchievementState = {
  version: 1;
  completed: Partial<Record<AchievementId, number>>;
  flightSchool: {
    flightId: string | null;
    phase: FlightSchoolPhase;
  };
};

export type AchievementObservation = {
  started: boolean;
  flightId: string;
  grounded: boolean;
  crashed: boolean;
  altitudeAboveGround: number;
};

export const ACHIEVEMENT_STORAGE_KEY = 'super-flight:achievements:v1';

export function createAchievementState(): AchievementState {
  return {
    version: 1,
    completed: {},
    flightSchool: { flightId: null, phase: 'awaiting-takeoff' },
  };
}

export function loadAchievementState(storage?: Pick<Storage, 'getItem'>): AchievementState {
  if (!storage) return createAchievementState();
  try {
    const parsed = JSON.parse(storage.getItem(ACHIEVEMENT_STORAGE_KEY) ?? 'null') as Partial<AchievementState> | null;
    if (!parsed || parsed.version !== 1) return createAchievementState();
    const completed = parsed.completed?.['flight-school'];
    const phase = parsed.flightSchool?.phase;
    return {
      version: 1,
      completed: typeof completed === 'number' ? { 'flight-school': completed } : {},
      flightSchool: {
        flightId: typeof parsed.flightSchool?.flightId === 'string' ? parsed.flightSchool.flightId : null,
        phase: phase === 'climb-to-100m' || phase === 'land' ? phase : 'awaiting-takeoff',
      },
    };
  } catch {
    return createAchievementState();
  }
}

export function saveAchievementState(state: AchievementState, storage?: Pick<Storage, 'setItem'>) {
  try {
    storage?.setItem(ACHIEVEMENT_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Achievements still work for the current page when browser storage is unavailable.
  }
}

export function observeAchievements(
  state: AchievementState,
  observation: AchievementObservation,
  completedAt = Date.now(),
): { state: AchievementState; completed: AchievementId[] } {
  if (!observation.started || state.completed['flight-school']) return { state, completed: [] };

  let flightSchool = state.flightSchool;
  if (flightSchool.flightId !== observation.flightId) {
    flightSchool = { flightId: observation.flightId, phase: 'awaiting-takeoff' };
  }
  if (observation.crashed) {
    const reset = { flightId: observation.flightId, phase: 'awaiting-takeoff' } as const;
    if (flightSchool.phase === reset.phase && state.flightSchool.flightId === reset.flightId) return { state, completed: [] };
    return { state: { ...state, flightSchool: reset }, completed: [] };
  }

  if (flightSchool.phase === 'awaiting-takeoff' && !observation.grounded) {
    flightSchool = { ...flightSchool, phase: 'climb-to-100m' };
  }
  if (flightSchool.phase === 'climb-to-100m' && observation.altitudeAboveGround >= 100) {
    flightSchool = { ...flightSchool, phase: 'land' };
  }
  if (flightSchool.phase === 'land' && observation.grounded) {
    return {
      state: {
        ...state,
        completed: { ...state.completed, 'flight-school': completedAt },
        flightSchool,
      },
      completed: ['flight-school'],
    };
  }
  if (
    flightSchool.flightId === state.flightSchool.flightId &&
    flightSchool.phase === state.flightSchool.phase
  ) return { state, completed: [] };
  return { state: { ...state, flightSchool }, completed: [] };
}

export function flightSchoolProgressLabel(state: AchievementState) {
  if (state.completed['flight-school']) return 'Complete';
  if (state.flightSchool.phase === 'climb-to-100m') return 'Take-off complete · climb to 100 m';
  if (state.flightSchool.phase === 'land') return '100 m reached · land safely';
  return 'Take off';
}
