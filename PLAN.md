# WW1 flight simulator — implementation plan

## Current rules override — iteration 04

The user replaced the six-versus-six runway-destruction battle with ten active aircraft total (five per team, player included) and a race to 100 points. Each enemy aircraft crash awards 10; each enemy hangar/tower destroyed by a bomb awards 10 once. The current implementation connects the existing projectile gun to aircraft damage, adds individually released wing bombs, AI pilots/rear gunners, eight-second reinforcement slots, persistent building destruction, score HUD and win/draw state. AI reinforcement flights start airborne. The older runway-victory and twelve-aircraft descriptions below are historical planning, superseded by these rules.

Headless match scenarios now cover a complete race, gun and bomb scoring, roster caps, respawns and outcome freeze. Browser handling/performance validation, detailed damage, AI perception and runway circuits remain future work.

Status: iteration 02 implemented in `game/`. The flight foundation now has the seeded 10 km terrain, four airfields, three flyable airframes, a navigation map and hangar selection. Circular wheel controls, radiator drag, an attitude indicator, crash debris and a tumbling pilot camera are implemented. Headless scenarios cover all twelve aircraft/airfield takeoff combinations and landing/redeparture. Phase 2 implementation is in place; browser circuits, visual inspection and hardware performance measurement remain. Combat, AI and match victory in Phases 3–5 remain future work. See `game/README.md` for measured checks and current limits.

## 1. Product and initial assumptions

Build a browser-based, first-person WW1 flight combat game with intentionally low-poly models, low-resolution textures, and a usable interactive cockpit. The playable map is 10,000 × 10,000 metres, containing terrain, settlements, vegetation, and four airstrips. Each team owns two airstrips and can have at most six active aircraft, including the player. Destroy both opposing runways to win.

The initial game is single-player with AI teammates and opponents, played on desktop with mouse and keyboard. Multiplayer, mobile controls, and exact historical aircraft reproduction are outside this first implementation. These are scope assumptions, not prerequisites requiring approval.

The player spawns in the cockpit of a randomly selected friendly aircraft on a clear parking/start position at an operational friendly airstrip. Start with the engine off, fuel and ammunition loaded, and controls in sensible starting positions. A short cockpit legend explains ignition, looking, dragging, and firing. After death, offer respawn at an operational friendly strip, subject to the team aircraft limit.

## 2. Major architecture decisions

- **TypeScript + Three.js using WebGL2**, with Vite for development/builds. Keep the simulation independent of rendering and UI. Avoid a large general-purpose game engine or a UI framework inside the frame loop.
- **Custom flight dynamics**, based on aerodynamic forces and moments, with lightweight collision primitives. A general rigid-body engine does not supply aerodynamics and is unnecessary for this aircraft count.
- **Fixed 60 Hz simulation**, interpolated rendering, and a bounded catch-up loop. Pause a single-player match when its tab is hidden instead of simulating a huge elapsed interval on return. Profile fast collisions and add local substeps where needed.
- **SI units internally:** metres, seconds, kilograms, newtons, radians. Display altitude in metres, airspeed in km/h, fuel in litres, temperature in °C, and engine speed in RPM.
- **Generated geometry and textures:** reusable mesh-building functions and seeded pixel texture generators. No external models, texture packs, or fonts are required for the first game.
- **Data-driven aircraft:** one shared simulation and cockpit interaction system, parameterized by dimensions, mass, aerodynamic curves, engine characteristics, weapons, and instrument ranges.
- **Single authoritative world state:** graphics, gauges, smoke, AI, damage, and victory conditions all read the same state. AI uses the same actuators and flight limits as the player.

Suggested module layout:

```text
src/
  app/           startup, settings, match lifecycle
  sim/           fixed tick, atmosphere, flight, engine, ground contact
  world/         seeded terrain, airfields, scenery, spatial queries
  aircraft/      type definitions, procedural meshes, cockpit layouts
  input/         keyboard look, cockpit picking and persistent controls
  combat/        bullets, bombs, turrets, component damage
  ai/            perception, tactics, guidance, engine control
  render/        scene, terrain LOD, instancing, effects, pixel output
  ui/            gauges, bitmap text, help, match result
  audio/         procedural engine, guns, wind and impacts
tests/           simulation and scenario regression tests
```

## 3. World: 10 km × 10 km

Generate a repeatable countryside map from a seed: broad hills, flat farmland, patches of forest, small villages, roads, and a river. Keep terrain plausible for low-altitude navigation and avoid excessive mountains in the first layout.

Use a 1,025 × 1,025 heightfield, approximately 9.77 m between samples. Partition it into 16 × 16 chunks, each covering 625 m. Render nearby chunks with more triangles and distant chunks with fewer; use skirts or stitched edges to prevent cracks. Physics queries use the authoritative heightfield and the same triangle convention as the terrain mesh, independent of visual LOD. Keep airfield surfaces detailed enough to land without distant-LOD artifacts.

Place the two friendly strips on the western side and the two enemy strips on the eastern side, with useful separation and terrain between them. Flatten runway and taxi areas before scattering scenery, blending their edges into surrounding terrain. Initially use roughly 700–900 m grass/dirt runways, then validate length against the loaded bomber's takeoff and landing performance. Strip locations and headings are authored relative to the seeded terrain; all four must remain usable for every supported seed.

Each strip has a hangar group, control/observation tower, windsock, parked scenery, protected spawn slots, and a visible runway condition. Exclude trees and buildings from runway, taxi, and approach corridors. Airfields reserve spawn and takeoff slots so aircraft cannot appear on top of one another.

Use simple ground and obstacle collision: wheels against terrain, aircraft volumes against terrain/building/tree proxies, and broad-phase spatial filtering. Decorative distant trees do not require full mesh collision.

At the map edge, show a return-to-battle warning and a generous grace period; AI turns back before crossing. Do not wrap terrain or teleport an aircraft mid-flight. Returning too late ends that sortie and uses normal respawn rules.

## 4. Retro rendering and procedural assets

The visual direction is early 3D flight simulation: angular silhouettes, canvas wings, simple struts, muted fields, clear team markings, chunky smoke, and readable black-faced instruments.

- Render the world at a selectable low internal resolution, initially around 640 × 360 with aspect-ratio adjustment, then upscale with nearest-neighbour sampling. Offer higher-resolution options. Render cockpit text and essential UI at a separately controlled resolution so pixel styling does not make gauges unreadable.
- Use flat shading, vertex colour, a small material palette, one directional sun, ambient light, and distance fog. Avoid costly postprocessing and full-scene dynamic shadows initially; use simple ground-contact shadows.
- Generate small repeating 16–64 px material tiles for grass, earth, canvas, timber, metal, and smoke, plus an atlas for markings and instrument faces. Use crisp magnification with mipmapped minification for distant surfaces to limit shimmer.
- Build fuselages from tapered cross-sections; wings and tails from simple low-poly extrusions; struts from narrow prisms; wheels from low-sided cylinders. Animate propellers, wheels, control surfaces, and cockpit mechanisms with transforms instead of skeletal rigs.
- Construct hangars, towers, houses, and other scenery from reusable boxes, roof wedges, and simple extrusions. Share geometry/materials and instance repeated scenery by chunk.
- Use two crossed, alpha-tested quads for most trees, with a very simple canopy variant where overhead views expose the crossed planes. Reduce tree density/representation at distance; batch by chunk so visibility culling remains effective.
- Create a small original bitmap glyph atlas for instrument numbers, ammunition, and cockpit labels. Use ordinary HTML text for help/settings, with system font fallbacks.

Aircraft outside the cockpit use distance LOD: detailed nearby model, simplified silhouette farther away, and a small silhouette at extreme range. Preserve visual target readability without displaying targets through terrain.

No supplied assets are needed. Optional authentic sounds or historical insignia can be added later if desired; initial audio can be synthesized with Web Audio after a user gesture.

## 5. Aircraft roster

Start with three WW1-inspired archetypes, available in team-specific colours:

| Type | Flight role | Equipment |
| --- | --- | --- |
| Scout | Light, tight-turning fighter; loses speed in hard turns | Forward machine guns |
| Fast fighter | Heavier, faster aircraft suited to diving attacks and climbs | Forward machine guns |
| Two-seat light bomber | Slower, stable aircraft with larger inertia and useful bomb load | Forward gun, AI rear gunner, bombs |

Use fictionalized water-cooled engine configurations across the roster so mixture and radiator management work consistently. Exact historical types would require individual research, including exceptions such as rotary engines without radiators. Each archetype receives its own mass/inertia, wing area, lift/drag curves, power curve, fuel capacity, ammunition, bomb load, and damage limits. Fuel use and bomb release change aircraft mass.

## 6. Flight model and ground handling

Maintain position, velocity, quaternion orientation, angular velocity, mass, and inertia. Compute air-relative velocity as aircraft velocity minus local wind. From this obtain dynamic pressure, angle of attack, and sideslip; apply lift, drag, thrust, gravity, and control/damping moments.

Use `q = 0.5 * density * airspeed²`, `lift = q * wingArea * CL`, and `drag = q * wingArea * CD`. Aircraft-specific coefficient curves include a smooth post-stall lift drop and drag rise. Induced drag increases with lift demand, so a hard turn costs energy. Control authority depends on airflow and falls away at low speed. Include sensible propwash contribution where it matters for starting and takeoff handling.

Stalls depend on angle of attack, not a single speed threshold: a steep pull can stall at high airspeed. Model buffet, reduced response, nose drop, and recovery by unloading and regaining airflow. Introduce asymmetric wing lift only after the basic flight model is stable. Full spin certification is beyond the initial fidelity target.

**No manual yaw:** retain yaw dynamics with automatic rudder coordination and sideslip damping. Roll and aerodynamic lift produce the turn; do not directly steer heading from the yoke. Tailwheel ground steering uses a small assisted response from lateral yoke input while on the ground. This is an explicit realism concession. Include a parking/wheel brake control for starting, stopping, and landing rollout.

Wind consists of a prevailing vector, gradual altitude variation, and bounded seeded gusts. It affects airspeed, drift, takeoff/landing, projectiles, and smoke. Avoid random per-frame impulses. Instrument airspeed reflects air-relative motion, so a tailwind does not magically increase lift.

Ground handling includes main-wheel and tail contact, spring/damper suspension, rolling resistance, braking, and damaging hard landings. Sweep fast-moving collision volumes or substep contact to avoid passing through terrain. Test ground stability with engines both on and off.

The target is physically grounded game flight, not a validated training simulator. Tune against documented envelopes when real aircraft types are selected; until then, label archetype specifications as design targets.

## 7. Interactive cockpit

The cockpit is an actual 3D model. WASD changes head pitch/yaw within useful limits, independent of aircraft controls. Provide a recenter action. Mouse dragging uses raycast-selected, generously sized invisible hit regions around the visible mechanisms.

| Control | Interaction | On release |
| --- | --- | --- |
| Throttle lever | Drag along its travel; clamp to 0–100% | Retains setting |
| Mixture wheel | Drag to rotate through lean/rich range | Retains setting |
| Yoke | Horizontal drag controls roll; vertical drag controls pitch | Both axes retain setting |
| Radiator wheel | Drag to rotate from closed to open | Retains setting |
| Ignition | Click button/switch to start or stop | Retains on/off state |
| Shoot | Hold button to fire forward guns | Stops firing |
| Bomb release | Click for one bomb, with release debounce | Returns to unpressed |
| Brake | Click to latch/release parking brake; support braking during rollout | Clearly indicates state |

Capture the pointer for the duration of a drag, including outside the original hit region. Release/cancel/focus loss ends interaction safely without resetting lever, wheel, or yoke settings. End momentary firing on focus loss. Show a subtle hover label and setting feedback when interacting. Drag deltas must stay predictable if the player looks around. A deliberate yoke-center action is useful because the requested yoke does not spring back automatically.

Instrument faces use a cached atlas; needles move as geometry rather than redrawing textures every frame. Show altitude above sea level in metres, fuel in litres, indicated airspeed in km/h, RPM, coolant temperature in °C, ammunition remaining, and bombs remaining where fitted. Mark RPM's useful operating range green and temperature's dangerous range red. Add clear team/runway status without obstructing the forward view.

## 8. Engine management

Model stopped, cranking, running, damaged, and seized states. Ignition needs fuel and a viable mixture. Use a fixed-pitch propeller model: engine RPM comes from torque versus propeller load and rotational inertia, rather than being set directly by throttle.

- Throttle requests engine torque and increases fuel consumption/heat under load.
- Air density changes with altitude. Mixture controls fuel relative to available air; best-power mixture moves leaner as altitude increases.
- Poor mixture reduces useful torque and can cause rough running or a cutout. Give a subtle exhaust smoke cue for poor mixture as requested, strongest for rich mixture; this feedback is deliberately simplified for gameplay.
- Adjusting mixture toward best power raises available RPM at a fixed throttle and comparable flight condition. The green RPM range indicates a healthy operating range; mixture alone cannot force that range at idle or under every propeller load.
- Temperature integrates generated heat minus cooling over time. Opening the radiator improves cooling, especially with airflow, and adds modest drag. Do not instantly change temperature when the wheel turns.
- Excess temperature or sustained overspeed accumulates damage, reducing output and eventually causing failure. Fuel leaks drain the actual tank; engine damage and smoke share the same component state.

Make the first aircraft forgiving enough to learn while retaining a meaningful cost for prolonged overheating and poor mixture. AI manages these same systems, with bounded reaction speed.

## 9. Combat, damage, and effects

Forward guns fire projectiles with muzzle velocity, gravity, lifetime, ammunition consumption, and aircraft velocity inherited at launch. Sweep each projectile segment against collision volumes and terrain to prevent tunnelling. Tracers are a visible subset of real bullets, not separate hitscan damage. Gun convergence, spread, range, and rate of fire are data-driven.

Aircraft have a small set of damageable components: engine, fuel tank, wings/control surfaces, and crew. Damage affects flight and engine behaviour, not only an abstract health bar. Use simplified collision volumes distinct from render meshes.

The bomber's rear gunner is automatic, with restricted traverse/elevation, finite ammunition, reaction delay, and imperfect lead. Check line of fire against its own fuselage/tail and friendly aircraft. Forward cockpit ammunition and rear-gunner ammunition remain separate, clearly labelled when shown.

Bombs inherit carrier velocity and fall under gravity with modest drag. A small fixed bombsight/downward aiming reference and free look support a deliberate bombing pass. Bombs damage runway segments only when the impact/blast is sufficiently close. Craters/scorch marks show where damage occurred. Runway damage is persistent for the match; bullets cannot cheaply substitute for bombing.

Each runway has a normalized operational capacity derived from damaged segments. A configured threshold disables it for spawning; destruction of both enemy runways wins. Resolve simultaneous destruction explicitly as a draw. Disabled strips remain physical surfaces, with crater collision simplified and capped for performance.

Use pooled effects for tracers, muzzle flashes, smoke, fire, fuel droplets, impact dust, bomb blasts, and debris. Emit according to elapsed simulation time, cap particle counts, and reduce distant effects. Most effects use camera-facing quads; tracers use short streak geometry. Visual particles do not determine hits or damage.

## 10. AI and battle lifecycle

Use a layered controller rather than scripting aircraft positions:

1. **Perception:** limited visual range, field of view, terrain occlusion, reaction delay, and short target memory. Avoid omniscient targeting.
2. **Tactical selection:** score interception, turning engagement, diving attack, climb/extension, overshoot attempt, disengagement, and runway bombing using distance, angles, relative speed, altitude, damage, and energy.
3. **Guidance:** turn the selected tactic into desired bank, pitch, speed, and firing opportunities.
4. **Control:** drive the same yoke, throttle, mixture, radiator, and weapon interfaces used by the player, with finite actuator rates and stall/terrain avoidance.

Track specific mechanical energy using altitude and airspeed. A diving attack spends altitude for speed; a climb spends speed for altitude. The scout favours sustainable turns; the faster fighter favours diving passes and extensions. An overshoot attempt requires a close pursuer and enough stall margin; do not apply it blindly. Bomber AI prioritizes runway passes and defensive routing while its gunner handles rear threats.

Give takeoff, approach, landing, stall recovery, and collision/terrain avoidance their own guidance states. Run tactical decisions around 5–10 Hz, distribute expensive perception checks over frames, and run flight control with the fixed simulation tick.

The match director reserves roles and spawn slots. Initially target four fighters and two bombers per team, counting the player's assigned type and replacing that roster slot rather than adding a thirteenth aircraft. Spawn replacements after a configurable delay only at operational friendly airfields; queue when slots/runways are busy. Ensure bomber replacements continue so a match remains winnable. Teammates must attempt bombing even when the player flies a fighter.

## 11. Performance targets and measurement

Targets are provisional until measured on the user's hardware:

- Aim for 60 FPS at the default retro resolution on a typical integrated-GPU desktop/laptop, with a 30 FPS fallback quality preset.
- Start with a visible-scene budget around 250 draw calls, 250k triangles, and 2,000 active visual particles. Profile CPU time, GPU time where available, memory, and frame-time spikes rather than relying on counts alone.
- Keep all twelve aircraft physically simulated; reduce visual LOD and tactical/perception frequency at distance, not the accuracy of an aircraft currently fighting.
- Pool projectiles/effects, reuse vectors and buffers, avoid per-frame texture generation, and batch static scenery by chunk/material.
- Generate terrain/assets at startup, showing progress if needed. Move expensive generation into a worker only if profiling shows startup or regeneration blocking input.
- Use frustum culling, terrain LOD, fog, and view distance settings. Keep distant silhouettes readable enough for interception.
- Benchmark a repeatable worst-case scenario with all twelve aircraft, several fires, gunfire, bombs, and a forested airfield in view. Record the actual device, browser, settings, and frame-time percentiles before claiming a performance result.

## 12. Delivery sequence and completion checks

### Phase 1 — Flight and cockpit proof

Create the application skeleton, one scout, one test strip on flat ground, fixed-tick simulation, basic atmosphere, and a complete interactive cockpit. Implement engine start, persistent controls, force-based lift/drag, ground contact, stalls, and landing. Add a development telemetry overlay for forces, angle of attack, airspeed, and tick timing.

Complete when the player can start, take off, turn, climb, deliberately stall, recover, and land; all cockpit controls retain the requested settings; and the plane remains stable while parked. This is the first playable milestone.

### Phase 2 — Full world and visual assets

Implement the seeded 10 km map, terrain LOD, all four strips, scenery, crossed-quad trees, retro rendering, and aircraft/cockpit generation tools. Add the fast fighter and bomber with distinct parameters, seating, and instruments.

Complete when all four strips are reachable and usable, map seams do not crack, scenery does not block approaches, and all three types can complete a flight and landing.

### Phase 3 — Engine consequences and combat

Finish mixture/altitude response, radiator thermal behaviour, engine failure, guns, bombs, component damage, rear gunner, effects, and sound. Connect runway damage to visible state.

Complete when poor mixture reduces power and produces feedback, cooling responds over time, overheating damages the engine, ammunition/bombs are finite, swept hits work at speed, and runway bombing can disable a strip.

### Phase 4 — AI and complete match

Build takeoff/navigation/landing before combat tactics, then add perception, energy-aware fighting, bombing runs, team role allocation, replacement spawning, player random spawn/respawn, and win/draw screens.

Complete when a full 6-versus-6 match can run from ground starts to a runway-based result, rear gunners respect firing arcs, aircraft do not exceed the cap, and both teams can make progress without player intervention.

### Phase 5 — Tune, verify, and package

Tune flight envelopes and difficulty, profile the worst-case scene, add quality settings, refine cockpit readability, and complete the production build. Provide browser compatibility handling and a clear WebGL2-unavailable message. Select hosting/deployment during implementation; the simulation needs only static hosting and no backend for this initial scope.

Complete when the test scenarios below pass, performance is measured on an identified device, and a complete match is playable from the production build.

## 13. Verification strategy

Automate meaningful simulation checks independently of WebGL:

- Equivalent inputs at different render frame rates produce comparable trajectories at the same simulation tick.
- Lift/drag respond to airspeed, density, and angle of attack; post-stall lift drops; excessive load can cause an accelerated stall.
- With engine off in still air, total mechanical energy does not grow spuriously; numerical drift stays within a documented tolerance.
- Wind changes drift and air-relative forces correctly; parked aircraft do not sink or gain energy from suspension.
- Mixture optimum shifts with altitude; radiator cooling takes time; overheating damage and fuel leaks persist.
- High-speed bullets/bombs do not skip thin targets; gunner arcs and self-occlusion are enforced.
- Team counts include the player and reserved spawns; disabled runways cannot spawn aircraft; both destroyed runways produce exactly one match result.

During interactive validation, exercise click/drag/release outside a hit region, focus loss, looking while dragging, gauge readability, takeoff/landing, stall recovery, bomber aiming, AI terrain avoidance, and a complete match. Use scripted seeded scenarios for reproducibility without promising bit-identical results across browsers. Capture diagnostic telemetry for failures and tune against behaviour, not only passing equations.

## 14. Main risks and mitigations

- **Flight feel:** physical formulas alone do not guarantee a controllable aircraft. Prove handling in Phase 1 before building a large combat layer.
- **Persistent mouse yoke:** retaining deflection can require constant correction. Use sensitivity limits, clear neutral markings, and an explicit center action while preserving release behaviour.
- **Yaw omission:** automatic coordination limits historical fidelity and some manoeuvres. Keep the compromise explicit and avoid claiming full spin/slip realism.
- **Engine usability:** RPM depends on more than mixture. Keep gauge zones honest and explain mixture response briefly in cockpit help.
- **AI scope:** basic safe flying must precede tactics. Reuse tested flight controllers and add manoeuvres one at a time with observable entry/exit conditions.
- **Large-map performance:** scenery draw calls, transparency, and effects are likely bigger costs than the twelve aircraft. Batch/cull early and measure before adding complexity.

## 15. Technical references

- [Three.js WebGLRenderer](https://threejs.org/docs/pages/WebGLRenderer.html) — confirms the renderer's WebGL2 requirement.
- [Three.js InstancedMesh](https://threejs.org/docs/pages/InstancedMesh.html) — shared geometry/material rendering for repeated scenery.
- [NASA lift equation](https://www1.grc.nasa.gov/beginners-guide-to-aeronautics/lift-equation/) — aerodynamic force formulation.
- [NASA inclination effects on lift](https://www.grc.nasa.gov/WWW/k-12/VirtualAero/BottleRocket/airplane/incline.html) — angle-of-attack dependence and stall behaviour.

These support the foundations; numerical aircraft coefficients, balance, performance budgets, and engine curves above are proposed design choices requiring implementation and validation.


## Current airfield revision

Implemented hangar-first aircraft selection with aerial airfield preview, apron taxi starts, stopped-runway aircraft changes retaining match state, runway-based AI departure/replacement queues, green/red aircraft halos, bomber-only release controls and unrestricted faster head turning. Scoring is now 5 points per aircraft loss or enemy building destroyed. The active roster is ten (five per team). Earlier runway-destruction and airborne-reinforcement proposals are superseded.

Forward guns now fire at 600 RPM from 100-round belts with every third round a tracer. Fighters carry mirrored, independently operated forward guns. The lighter Scout has slightly stronger control response while retaining a lower speed limit than the Fighter. Damage-triggered AI evasive manoeuvres last 15–25 seconds and change held turn/dive direction every 1–4 seconds.

