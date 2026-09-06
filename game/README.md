# Super Flight — iteration 02

A browser WW1 free-flight prototype with a generated 10 × 10 km countryside, four 1,060 m airstrips, three water-cooled biplanes, and an interactive 3D cockpit. The scout favours turning, the fighter has greater speed, and the heavier two-seat bomber carries a modelled rear gunner and bomb payload.

## Run

Requires Node 22.13 or later. Use `npm install`, then `npm run dev`. The terminal prints the local preview address. `npm test` runs headless scenarios, `npm run typecheck` checks TypeScript, and `npm run build` produces the deployment build.

## Fly

- Initial spawn chooses a random aircraft and Allied airfield. HANGAR lets you select any aircraft and any of the four strips for free flight.
- Click IGNITION (or I), release BRAKE (or B), and drag the throttle upward. Its grip follows the closest reachable mouse position along the lever arc.
- Grab a wheel and circle its centre: clockwise enriches mixture or opens radiator. One and a half turns covers the full range. Start with mixture near 85% and radiator near 50%; radiator opening increases both cooling and drag.
- At about 85 km/h in the scout, or 95 km/h in the fighter/bomber, drag the yoke downward gently to pull up. About 35% pitch works for the scripted departure.
- Drag yoke sideways to bank. Controls retain their settings; X centers the yoke. WASD looks around and C recenters. LEVEL shows aircraft pitch/roll independently of head direction.
- MAP shows heading, position, river and airfields. Altitude is metres above sea level; airfields sit at different elevations.
- Clear fields permit landing and takeoff. Terrain, trees, buildings, water and hard landings can cause crashes. Impact severity determines the number of debris pieces; the pilot viewpoint is thrown out and rolls before settling.
- R / Reset Sortie restores the selected aircraft and strip. Pause, help and hangar stop simulation; background tabs pause automatically. Engine audio begins after cockpit input.

## Implemented

- Fixed 60 Hz force-based flight model with interpolated rendering, angle-of-attack stalls, damped control rates, automatic turn coordination and wind.
- Data-driven scout, fast fighter and light bomber with different mass, wing area, span, engine power, fuel capacity and agility. Bomber payload contributes to mass.
- Torque/load RPM, altitude-dependent mixture, gradual heating/cooling, aerodynamic radiator drag, finite fuel and accumulated overheat/overspeed engine damage.
- Six cockpit instruments: altitude, indicated airspeed, pitch/bank level, RPM, coolant temperature and fuel. Optional numeric telemetry includes radiator drag.
- Persistent pointer controls with capture, cancel/focus-loss handling and circular wheel winding, including angle-wrap/hub handling.
- Seeded 1,025 × 1,025 heightfield shared by ground physics and rendering. Terrain is divided into 256 chunks with four LODs and skirts; airfields are flattened and blended into the surrounding hills.
- Four airfields, river valley, villages/roads, team markings, procedural signs and instanced crossed-quad trees in spatial batches. Runways and extended approaches exclude trees.
- Ground contact and rolling friction, braking, damaging touchdowns, swept aircraft/scenery collisions and spatial broad-phase filtering. Aircraft collision width adapts to the wider bomber.
- Severity-scaled crash fragmentation (12–96 box fragments derived from the airframe), ballistic motion, bounce/friction and sleeping. Pilot-camera ejection/tumble; reset clears effects and restores the aircraft.
- Two-pass rendering: world at 420 pixels vertically with nearest-neighbour upscale, cockpit separately for readable text. Models, textures, instrument faces and signs are generated at runtime without external assets.
- Optional feature-detected WebMCP instrument readback and sortie reset, sharing actual game state.

## Validation and limits

33 automated tests pass. They include all twelve aircraft/airfield departure combinations, soft touchdown followed by re-takeoff for each type, the earlier nose-low field-landing regression, stalls/recovery, energy loss, wind, mixture/thermal response, radiator drag, wheel winding, attitude measurement, collision sweeps, debris settling and reset. Still-air departures lift off in 160–163 m for the scout, 183–185 m for the fighter, and 222–225 m for the bomber, reaching 111–163 m terrain clearance at 45 seconds with the scripted controls.

The generated-world test constructs actual geometry with canvas drawing stubbed, checks 256 chunks and four LODs per chunk, matches rendered airfield surfaces to physics heights, and checks runway/approach clearance with bomber collision dimensions. Bomber takeoff trajectories are also checked against the generated scenery. This is geometry/physics validation, not browser visual QA. TypeScript, production build and a local HTTP route response are checked separately.

This remains free flight. Working guns/bomb release, gunner AI, opponents, smoke/leak effects, component combat damage and runway-based victory remain later phases in ../PLAN.md. Map-edge warning exists; boundary enforcement does not. The bomber's gunner and bombs are currently visual airframe details and payload, not functional weapons.

Flight coefficients are gameplay parameters, not verified historical aircraft data. Ground contact uses a terrain non-penetration constraint rather than separate wheel suspension; terrain strikes are checked at the aircraft centre/gear, while scenery uses overlapping swept spheres. The larger airframes use slightly conservative collision radii. Debris uses boxes and a single ground radius per piece. Manual full circuits, cockpit visual checks and hardware performance benchmarking have not been recorded for this iteration. Optional WebMCP tools remain unverified in a supporting browser.

## Structure

- `lib/flight/simulation.ts`: SI-unit flight and engine simulation.
- `lib/flight/aircraft.ts`: the three aircraft profiles.
- `lib/flight/terrain.ts`, `world.ts`: authoritative terrain, LOD meshes and scenery.
- `lib/flight/game.ts`: aircraft/cockpit generation, input, rendering and audio.
- `lib/flight/cockpit.ts`, `attitude.ts`: control math, open fuselage and level gauge.
- `lib/flight/collisions.ts`, `crash.ts`: swept scenery collisions and crash effects.
- `app/page.tsx`: game interface, hangar, map and flight manual.
- `tests/`: headless regression scenarios.

The Sites scaffold supplies React/Vinext and Vite. Rendering and simulation run on the client; the server wrapper delivers the app.
