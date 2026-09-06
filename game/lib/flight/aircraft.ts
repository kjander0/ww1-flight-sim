export const AIRCRAFT = {
  scout: { name: 'Scout S.1', role: 'TURN FIGHTER', dryMass: 675, wingArea: 25, fuel: 55, torque: 470, thrust: 2550, span: 8.8, length: 1, agility: 1, drag: .043, color: '#596247', canvas: '#b7a774', takeoff: 85, bombs: 0 },
  fighter: { name: 'Fighter F.2', role: 'FAST FIGHTER', dryMass: 870, wingArea: 27, fuel: 62.5, torque: 650, thrust: 3350, span: 9.6, length: 1.12, agility: .82, drag: .036, color: '#694c3f', canvas: '#ad9973', takeoff: 95, bombs: 0 },
  bomber: { name: 'Bomber B.3', role: 'TWO-SEAT LIGHT BOMBER', dryMass: 1370, wingArea: 46, fuel: 105, torque: 980, thrust: 5100, span: 14.4, length: 1.32, agility: .57, drag: .053, color: '#3c5150', canvas: '#aca88a', takeoff: 95, bombs: 4 },
} as const;
export type AircraftType = keyof typeof AIRCRAFT;
export type AircraftSpec = typeof AIRCRAFT[AircraftType];
