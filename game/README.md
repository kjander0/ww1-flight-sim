# Super Flight — continuous airspace and achievements

## Current world rules

The airspace is continuous: there are no rounds, points, winners, or terminal match state. Seven AI pilots keep flying, fighting, bombing, and returning as replacements after losses. The selected airfield determines the player's side, and the player may change sides whenever they return to the hangar. Refreshing the page is the way to reset the world.

The hangar shows the full achievement list, while the cockpit view shows the easiest incomplete achievement. Achievement names reveal their requirements on hover. Completion and progress are saved in browser session storage so completed achievements survive a refresh in the same browser tab. The first achievement, **Flight School**, requires a take-off, a climb to 100 m above ground level, and a safe landing in the same flight.

The bomber carries four 30 kg bombs, two beneath each wing. The first cockpit click opens the square BOMB RELEASE guard; subsequent clicks on the exposed button, or the minimal HUD button, drop one at a time while alternating wings. Release is inhibited on the ground and debounced. Bombs inherit aircraft velocity, fall under gravity/drag, sweep terrain/buildings and produce a blast. Released racks disappear and payload mass decreases. Bombed buildings become rubble and lose their intact collision volume, while aircraft inside the lethal blast radius are destroyed.

AI uses the same flight simulation and machine-gun ballistics as the player, with pursuit/lead, bursts, jam clearing, engine management, turning and diving attacks, overshoot attempts, terrain avoidance and bombing passes. Bomber rear gunners have a rear-upper firing arc and hold fire for friendly aircraft in their lane. Aircraft hits use swept moving collision boxes and airframe health. Player gun cocking, heat, dispersion and 250-round belts remain intact.

AI re-enters after an eight-second loss delay; each replacement reuses its roster slot. The hangar selects aircraft and airfield without resetting the world. Ammo, bomb, airframe, and navigation displays read the same continuous world state as physics.

Automated checks cover continuous AI activity, replacements, side changes, Flight School sequencing and persistence, bomb racks/payload, swept hits, friendly-fire inhibition, and model lifecycle. These are headless checks, not a browser playtest or hardware frame-rate benchmark. AI tactics are an initial controller with direct target knowledge, airborne reinforcements and simplified damage; calibrated historical handling, realistic perception and automated runway circuits remain future work.

A browser WW1 free-flight prototype with a generated 10 × 10 km countryside, four 1,060 m airstrips, three water-cooled biplanes, and an interactive 3D cockpit. The scout favours turning, the fighter has greater speed, and the heavier two-seat bomber carries a modelled rear gunner and bomb payload.

## Run

Requires Node 22.13 or later. Use `npm install`, then `npm run dev`. The terminal prints the local preview address. `npm test` runs headless scenarios, `npm run typecheck` checks TypeScript, and `npm run build` produces the deployment build.

## Package for itch.io

Create a static HTML5 release ZIP from PowerShell with:

```powershell
npm run build:itch -- --Version 0.1.0
```

The script writes `releases/super-flight-0.1.0-itch.zip`. The archive has
`index.html` at its root and uses relative asset paths so it can run from an
itch.io HTML Game page. The normal development and deployment builds are
unchanged.

## Fly

- Choose any aircraft and any of the four strips in the hangar; the selected airfield determines your side and can be changed on every visit.
- Click IGNITION, release BRAKE, and drag the throttle upward. Its grip follows the closest reachable mouse position along the lever arc. Left and right mouse buttons each keep a hand on their last selected control; repeat that button anywhere to use the same control again, or click a different control to move that hand. Both buttons can be held together: while one hand is active, the other button keeps its existing binding so you can fly and fire simultaneously.
- Grab a wheel and circle its centre: clockwise enriches mixture or opens radiator. One and a half turns covers the full range. Start with mixture near 85% and radiator near 50%; radiator opening increases both cooling and drag.
- Drag the yoke downward to pull up and sideways to bank.
- Drag yoke sideways to bank. Controls retain their settings. WASD looks around; Q and E slide the pilot left and right inside the cockpit. LEVEL shows aircraft pitch/roll independently of head direction.
- MAP shows heading, position, river and airfields. Altitude is metres above sea level; airfields sit at different elevations.
- Clear fields permit landing and takeoff. Terrain, trees, buildings, water and hard landings can cause crashes. Impact severity determines the number of debris pieces; the pilot viewpoint is thrown out and rolls before settling.
- Enter the hangar after a crash to choose another aircraft. The hangar and flight manual pause simulation; background tabs pause automatically. Engine audio begins after cockpit input.

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

Flight regression checks include all twelve aircraft/airfield departure combinations, soft touchdown followed by re-takeoff for each type, the earlier nose-low field-landing regression, stalls/recovery, energy loss, wind, mixture/thermal response, radiator drag, wheel winding, attitude measurement, collision sweeps, debris settling, prop strikes and ground loops. Still-air departures lift off in 160–163 m for the scout, 183–185 m for the fighter, and 222–225 m for the bomber, reaching 111–163 m terrain clearance at 45 seconds with the scripted controls.

The generated-world test constructs actual geometry with canvas drawing stubbed, checks 256 chunks and four LODs per chunk, matches rendered airfield surfaces to physics heights, and checks runway/approach clearance with bomber collision dimensions. Bomber takeoff trajectories are also checked against the generated scenery. This is geometry/physics validation, not browser visual QA. TypeScript, production build and a local HTTP route response are checked separately.

Map-edge warning and a 700 m out-of-bounds margin precede an aircraft loss. Smoke/leak particles, detailed component damage, AI landing/rearming and advanced tactics remain future work. Bullet cover includes terrain and airfield buildings; decorative trees and village houses are not yet bullet cover. Aircraft still collide with their scenery proxies. Wreckage uses simple visual physics.

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


## Hangar and airfield update

The game opens in an aerial hangar preview. Choose a plane and airfield, then taxi from the east apron using low throttle and sideways yoke steering. Stop on any runway below 2.5 km/h to return safely to the hangar. Changing aircraft or sides preserves the continuous world. AI aircraft and replacements use apron parking, runway queuing, taxi, takeoff and a controlled departure climb.

Friendly aircraft have green camera-facing halos; enemies have red halos, hidden by terrain. The halos update immediately after a side change and fade to a trace inside the 650 m shooting range so they do not obscure nearby aircraft. Head turning wraps through 360 degrees at 1.65 radians/second. Bomb controls appear only on the bomber, with the cockpit label raised toward the pilot.

