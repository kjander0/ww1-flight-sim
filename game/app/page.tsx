'use client';
import './flight-additions.css';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type { FlightGame, FlightInfo } from '@/lib/flight/game';
import type { NotificationEvent } from '@/lib/flight/battle';
import { AIRCRAFT, type AircraftType } from '@/lib/flight/aircraft';
import { AIRFIELDS, riverX } from '@/lib/flight/terrain';
import {
  ACHIEVEMENTS,
  achievementProgressLabel,
  loadAchievementState,
  observeAchievements,
  saveAchievementState,
  type AchievementState,
} from '@/lib/flight/achievements';

export default function Home() {
  const mount = useRef<HTMLDivElement>(null),
    game = useRef<FlightGame | null>(null);
  const [ready, setReady] = useState(false),
    [error, setError] = useState('');
  const [help, setHelp] = useState(false),
    [paused, setPaused] = useState(false);
  const [hangar, setHangar] = useState(true);
  const [fullscreenPrompt, setFullscreenPrompt] = useState(true);
  const [leftAircraft, setLeftAircraft] = useState(false);
  const [info, setInfo] = useState<FlightInfo | null>(null);
  const [type, setType] = useState<AircraftType>('scout'),
    [field, setField] = useState('0');
  const initialAchievements = useRef<AchievementState | null>(null);
  if (!initialAchievements.current) {
    initialAchievements.current = loadAchievementState(
      typeof window === 'undefined' ? undefined : window.sessionStorage,
    );
  }
  const achievementState = useRef(initialAchievements.current);
  const [achievements, setAchievements] = useState(initialAchievements.current);
  const [celebration, setCelebration] = useState('');
  const [missionIntro, setMissionIntro] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [notifications, setNotifications] = useState<(NotificationEvent & { expiresAt: number })[]>([]);
  const seenNotifications = useRef(new Set<number>());
  const battle = info?.battle;
  const currentAchievement = ACHIEVEMENTS.find(
    (achievement) => !achievements.completed[achievement.id],
  );
  useEffect(() => {
    let disposed = false;
    import('@/lib/flight/game')
      .then(({ FlightGame }) => {
        if (disposed || !mount.current) return;
        try {
          game.current = new FlightGame(mount.current, (_s, _h, _t, i) =>
            setInfo(i),
          );
          setReady(true);
        } catch {
          setError(
            'WebGL2 could not start. Enable hardware acceleration and use a current desktop browser.',
          );
        }
      })
      .catch(() =>
        setError('The simulator could not load. Reload the page to try again.'),
      );
    return () => {
      disposed = true;
      game.current?.dispose();
      game.current = null;
    };
  }, []);
  useEffect(() => {
    if (game.current) game.current.paused = paused || help || hangar;
  }, [paused, help, hangar, ready]);
  useEffect(() => {
    game.current?.previewHangar(hangar ? Number(field) : null);
  }, [hangar, field, ready]);
  useEffect(() => {
    if (!info) return;
    const result = observeAchievements(achievementState.current, {
      started: info.started,
      flightId: info.flightId,
      aircraftType: info.aircraftType,
      grounded: info.grounded,
      crashed: info.crashed,
      altitudeAboveGround: info.altitudeAboveGround,
      rollRadians: info.rollRadians,
      rollControl: info.rollControl,
      loopRotation: info.loopRotation,
      betweenTrees: info.betweenTrees,
      enemyBuildingsBombed: info.battle.enemyBuildingsBombed,
      enemyAircraftStrafed: info.battle.enemyAircraftStrafed,
      enemyAircraftKills: info.battle.enemyAircraftKills,
      enemyAircraftBombed: info.battle.enemyAircraftBombed,
    });
    if (result.state === achievementState.current) return;
    achievementState.current = result.state;
    setAchievements(result.state);
    saveAchievementState(result.state, window.sessionStorage);
    if (result.completed.length) {
      const completed = ACHIEVEMENTS.find(
        (achievement) => achievement.id === result.completed[0],
      );
      if (completed) setCelebration(completed.name);
    }
  }, [info]);
  useEffect(() => {
    if (!celebration) return;
    const timeout = window.setTimeout(() => setCelebration(''), 6000);
    return () => window.clearTimeout(timeout);
  }, [celebration]);
  useEffect(() => {
    if (!missionIntro) return;
    const timeout = window.setTimeout(() => setMissionIntro(false), 3200);
    return () => window.clearTimeout(timeout);
  }, [missionIntro]);
  useEffect(() => {
    const incoming=(info?.battle.notifications??[]).filter(notification=>!seenNotifications.current.has(notification.id));
    if(!incoming.length)return;
    const expiresAt=Date.now()+4200;for(const notification of incoming)seenNotifications.current.add(notification.id);
    setNotifications(current=>[...current,...incoming.map(notification=>({...notification,expiresAt}))].slice(-4));
  },[info?.battle.notifications]);
  useEffect(()=>{
    if(!notifications.length)return;
    const delay=Math.max(0,Math.min(...notifications.map(notification=>notification.expiresAt))-Date.now());
    const timeout=window.setTimeout(()=>setNotifications(current=>current.filter(notification=>notification.expiresAt>Date.now())),delay+20);
    return()=>window.clearTimeout(timeout);
  },[notifications]);
  const enterFullscreen = () => {
    const root = document.documentElement;
    if (typeof root.requestFullscreen === 'function') {
      void root.requestFullscreen().catch(() => undefined);
    }
    setFullscreenPrompt(false);
  };
  return (
    <TooltipProvider>
    <main className={`flight-app ${hangar ? 'hangar-open' : ''}`}>
      <div
        ref={mount}
        className="flight-viewport"
        aria-label="Interactive 3D aircraft cockpit"
      />
      {!hangar && (
        <>
          <aside className="mini-map">
            <NavigationMap info={info} />
          </aside>
          <aside
            className={`current-achievement ${missionIntro ? 'mission-intro' : ''}`}
            aria-label="Current mission"
          >
            <span>CURRENT MISSION</span>
            {currentAchievement ? (
              <AchievementTooltip achievement={currentAchievement}>
                <button type="button"><strong>{currentAchievement.name}</strong></button>
              </AchievementTooltip>
            ) : (
              <strong>All missions complete</strong>
            )}
            {currentAchievement && (
              <small>{achievementProgressLabel(achievements, currentAchievement.id)}</small>
            )}
            {currentAchievement && (
              <p className="mission-intro-details">
                {currentAchievement.description}
              </p>
            )}
          </aside>
          <div className="flight-tools">
            <Button
              variant="ghost"
              disabled={!ready}
              title="Leave the aircraft and enter the hangar"
              onClick={() => {
                setLeftAircraft(game.current?.enterHangar() ?? false);
                setType(info?.aircraftType ?? 'scout');
                setField(String(info?.airfieldIndex ?? 0));
                setHangar(true);
              }}
            >
              HANGAR
            </Button>
          </div>
        </>
      )}
      {celebration && (
        <output className="achievement-celebration" aria-live="polite">
          <span>MISSION COMPLETE</span>
          <strong>{celebration}</strong>
        </output>
      )}
      {!hangar&&notifications.length>0&&(
        <section className="flight-notifications" aria-live="polite" aria-label="Flight notifications">
          {notifications.map(notification=><output key={notification.id} className={`flight-notification ${notification.tone}`}>{notification.text}</output>)}
        </section>
      )}
      {!hangar&&(
        showControls?<aside className="controls-guide" aria-label="Basic flight controls">
          <div><strong>CONTROLS</strong><button type="button" onClick={()=>setShowControls(false)} aria-label="Hide controls">HIDE</button></div>
          <p><kbd>LEFT CLICK</kbd><span>Left hand</span></p>
          <p><kbd>RIGHT CLICK</kbd><span>Right hand</span></p>
          <p><kbd>DRAG</kbd><span>Operate control</span></p>
          <p><kbd>W A S D</kbd><span>Look</span></p>
          <p><kbd>Q / E</kbd><span>Lean</span></p>
        </aside>:<button type="button" className="controls-show" onClick={()=>setShowControls(true)}>CONTROLS</button>
      )}
      {!ready && (
        <output className="loading-flight">
          {error || 'Preparing your aircraft…'}
        </output>
      )}
      <Dialog
        open={ready && fullscreenPrompt}
        onOpenChange={(open) => {
          if (!open) setFullscreenPrompt(false);
        }}
      >
        <DialogContent className="fullscreen-prompt" showCloseButton={false}>
          <DialogTitle>Fly in fullscreen?</DialogTitle>
          <DialogDescription>
            Fullscreen gives the cockpit more room and keeps the flight view clear.
          </DialogDescription>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setFullscreenPrompt(false)}>
              NOT NOW
            </Button>
            <Button onClick={enterFullscreen}>GO FULLSCREEN</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={hangar && (!ready || !fullscreenPrompt)}
        onOpenChange={(v) => {
          if (v || (info?.started && !info.crashed && !leftAircraft))
            setHangar(v);
        }}
      >
        <DialogContent className="flight-manual hangar-menu">
          <DialogTitle>Super Flight WW1</DialogTitle>
          <DialogDescription>
            Choose any aircraft and airfield. Your airfield determines your side,
            and you can change sides whenever you return here. The world continues
            until you refresh the page.
          </DialogDescription>
          <div className="hangar-layout">
          <section className="hangar-primary">
          <section className="hangar-briefing">
            <div>
              <span>FLYING CONDITIONS</span>
              <strong>06:40 · CLEAR · 15°C</strong>
              <small>Light westerly · 7 km/h</small>
            </div>
            <div>
              <span>AIRSPACE</span>
              <strong>
                {battle?.counts.ALLIED ?? 0} ALLIED ·{' '}
                {battle?.counts.CENTRAL ?? 0} CENTRAL
              </strong>
              <small>{battle?.message ?? 'World active until refresh'}</small>
            </div>
          </section>
          <div className="hangar-instructions">
            <strong>QUICK START</strong>
            <span>
              Click cockpit controls · drag levers and the yoke · wind wheels
            </span>
            <small>
              WASD look · Q/E slide · drag yoke sideways to bank, down to climb
            </small>
          </div>
          <h3>Aircraft</h3>
          <RadioGroup
            value={type}
            onValueChange={(v) => setType(v as AircraftType)}
            aria-label="Aircraft"
          >
            {(Object.keys(AIRCRAFT) as AircraftType[]).map((key) => (
              <Label
                className="hangar-choice"
                key={key}
                htmlFor={`plane-${key}`}
              >
                <RadioGroupItem id={`plane-${key}`} value={key} />
                <span>
                  <strong>{AIRCRAFT[key].name}</strong>
                  <small>
                    {AIRCRAFT[key].role}
                    {key === 'bomber' ? ' · TWIN ENGINE' : ''}
                  </small>
                </span>
              </Label>
            ))}
          </RadioGroup>
          <h3>Airfield</h3>
          <RadioGroup
            value={field}
            onValueChange={(v) => setField(String(v))}
            aria-label="Airfield"
          >
            {AIRFIELDS.map((f, i) => (
              <Label className="hangar-choice" key={f.id} htmlFor={f.id}>
                <RadioGroupItem
                  id={f.id}
                  value={String(i)}
                />
                <span>
                  {f.name}
                  <small>{f.team}</small>
                </span>
              </Label>
            ))}
          </RadioGroup>
          <Button
            onClick={() => {
              if (game.current?.startSortie(type, Number(field))) {
                setLeftAircraft(false);
                setMissionIntro(!!currentAchievement);
                setHangar(false);
                setPaused(false);
              }
            }}
            disabled={!ready}
          >
            ENTER AIRCRAFT
          </Button>
          {info?.started && !info.crashed && !leftAircraft && (
            <Button variant="ghost" onClick={() => setHangar(false)}>
              RETURN TO COCKPIT
            </Button>
          )}
          <Button variant="ghost" onClick={() => setHelp(true)}>
            FLIGHT MANUAL
          </Button>
          <small>
            {battle?.message?.includes('PARKING OCCUPIED')
              ? battle.message
              : 'Green halos: friendlies · Red halos: enemies'}
          </small>
          </section>
          <AchievementList state={achievements} />
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={help} onOpenChange={setHelp}>
        <DialogContent className="flight-manual">
          <DialogTitle>Flight manual</DialogTitle>
          <DialogDescription>
            Three water-cooled biplanes with fixed-pitch propellers and a
            complete interactive cockpit. Flight pauses while this manual is open.
          </DialogDescription>
          <dl>
            <dt>Cockpit controls</dt>
            <dd>
              Click buttons and triggers, drag levers, and wind wheels around
              their centres. Either mouse button keeps its own control, letting
              you fly and operate another control together. Settings remain where
              released. Click IGNITION, release BRAKE, and raise the throttle to
              start moving.
            </dd>
            <dt>Taxi, fly & look</dt>
            <dd>
              At low throttle, move the yoke sideways to steer on the ground;
              centre it for the takeoff run. Drag sideways to bank, down to pull
              up, and up to lower the nose. Rudder coordination is automatic.
              WASD looks freely, Q/E slides the pilot sideways, and LEVEL always
              shows the aircraft&apos;s pitch and bank.
            </dd>
            <dt>Engine & fuel</dt>
            <dd>
              Wind the mixture clockwise to enrich it and the radiator clockwise
              to open it; one and a half turns spans each range. Use roughly 85%
              mixture near sea level and lean toward 30% by 2,000 m. An open
              radiator cools better but adds drag. Poor mixture, overheating,
              excessive RPM, or empty fuel can stop or damage the engine. Bullet
              hits have a chance to open cumulative fuel leaks. Land on a friendly
              runway to replenish fuel and ammunition over time.
            </dd>
            <dt>Machine gun</dt>
            <dd>
              Drag the brass cocking handle fully down and release, sight through
              the ring and bead, then hold the trigger. Bullets inherit aircraft
              velocity and are affected by drag and gravity. Sustained fire heats
              the gun, spreading shots and causing jams; let it cool and recock
              after a stoppage. Forward-gun belts contain 100 rounds. The fighter
              has two independently aimed, cocked, and fired guns; use both mouse
              buttons to operate both triggers together.
            </dd>
            <dt>Bomber</dt>
            <dd>
              The two-seat bomber carries four 30 kg bombs and a defensive rear
              gunner. Click BOMB RELEASE once to lift its guard, then once per
              bomb. Bombs cannot be released on the ground; they retain forward
              momentum, so release before the target.
            </dd>
            <dt>Flight, landing & hazards</dt>
            <dd>
              Wind affects airspeed and drift. If STALL appears, lower the nose,
              level the wings, and regain speed. Reduce throttle, flare gently,
              and brake after touchdown. Runways and clear fields are usable;
              hard impacts, ground loops, prop strikes, terrain, trees, buildings,
              water, and leaving the map can destroy the aircraft. Gunfire damages
              the left wing, right wing, tail, or engine according to where it
              lands. A failed component can tear away and degrade the aircraft
              before the remaining airframe finally crashes.
            </dd>
            <dt>Combat, AI & navigation</dt>
            <dd>
              MAP shows you, contacts, and all four airfields. Four allied and
              five enemy AI pilots taxi, take off, dogfight, bomb, land, taxi for
              service, refuel, rearm, repair, and launch again. Pilots scan around
              for contacts, remember aircraft they lose sight of, and react at once
              when hit. There is no score or finishing state:
              air activity and damage continue until the page is refreshed. Enter
              the hangar to change aircraft, airfield, or side. Leaving a live
              aircraft away from a stationary runway forfeits it.
            </dd>
          </dl>
        </DialogContent>
      </Dialog>
    </main>
    </TooltipProvider>
  );
}

function AchievementTooltip({
  achievement,
  children,
}: {
  achievement: (typeof ACHIEVEMENTS)[number];
  children: React.ReactElement;
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent side="left">{achievement.description}</TooltipContent>
    </Tooltip>
  );
}

function AchievementList({ state }: { state: AchievementState }) {
  return (
    <aside className="achievement-list" aria-label="Missions">
      <div className="achievement-list-heading">
        <span>MISSIONS</span>
        <small>
          {ACHIEVEMENTS.filter((achievement) => state.completed[achievement.id]).length}/
          {ACHIEVEMENTS.length}
        </small>
      </div>
      <p>Hover over a name to see its requirements.</p>
      <ul>
        {ACHIEVEMENTS.map((achievement) => {
          const complete = !!state.completed[achievement.id];
          return (
            <li key={achievement.id} className={complete ? 'complete' : ''}>
              <span aria-hidden="true">{complete ? '✓' : '○'}</span>
              <AchievementTooltip achievement={achievement}>
                <button type="button">{achievement.name}</button>
              </AchievementTooltip>
              <small>{complete ? 'COMPLETE' : 'IN PROGRESS'}</small>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
const chart = (v: number) => (v + 5000) / 50;
const riverPath = Array.from({ length: 101 }, (_, i) => {
  const z = -5000 + i * 100;
  return `${i ? 'L' : 'M'}${chart(riverX(z))},${chart(z)}`;
}).join(' ');
function NavigationMap({ info }: { info: FlightInfo | null }) {
  return (
    <svg
      className="navigation-map"
      viewBox="-8 -12 216 224"
      aria-label="Navigation map: Allied airfields west, Central airfields east. North is up."
    >
      <rect width="200" height="200" fill="#243a2a" stroke="#86977b" />
      {[50, 100, 150].map((p) => (
        <path key={p} d={`M${p} 0V200 M0 ${p}H200`} stroke="#859b7540" />
      ))}
      <path d={riverPath} stroke="#77a6ad" fill="none" strokeWidth="2" />
      {AIRFIELDS.map((f) => (
        <g
          key={f.id}
          transform={`translate(${chart(f.x)},${chart(f.z)})`}
          fill={f.team === 'ALLIED' ? '#d5ce93' : '#e99776'}
        >
          <rect x="-2" y="-10" width="4" height="20" />
          <text textAnchor="middle" y="20">
            {f.name}
          </text>
        </g>
      ))}
      {info?.battle.contacts
        .filter((p) => p.id !== 0)
        .map((p) => (
          <circle
            key={p.id}
            cx={chart(p.x)}
            cy={chart(p.z)}
            r="2.5"
            fill={p.team === 'ALLIED' ? '#75c6df' : '#ef805b'}
          />
        ))}
      {info && (
        <g
          transform={`translate(${chart(Math.max(-5000, Math.min(5000, info.x)))},${chart(Math.max(-5000, Math.min(5000, info.z)))}) rotate(${info.heading})`}
        >
          <path
            d="M0 -6L4 5L0 3L-4 5Z"
            fill={info.crashed ? '#fa8a55' : '#fff9dc'}
            stroke="#17221c"
            strokeWidth=".8"
          />
        </g>
      )}
      <text x="100" y="-4" textAnchor="middle">
        N ↑
      </text>
      <text x="0" y="212">
        0
      </text>
      <text x="100" y="212" textAnchor="middle">
        5
      </text>
      <text x="200" y="212" textAnchor="end">
        10 km
      </text>
    </svg>
  );
}
