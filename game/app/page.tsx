'use client';
import './flight-additions.css';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import type { FlightGame, FlightInfo } from '@/lib/flight/game';
import { AIRCRAFT, type AircraftType } from '@/lib/flight/aircraft';
import { AIRFIELDS, riverX } from '@/lib/flight/terrain';

export default function Home() {
  const mount = useRef<HTMLDivElement>(null),
    game = useRef<FlightGame | null>(null);
  const [ready, setReady] = useState(false),
    [error, setError] = useState('');
  const [help, setHelp] = useState(false),
    [paused, setPaused] = useState(false);
  const [hangar, setHangar] = useState(true);
  const [leftAircraft, setLeftAircraft] = useState(false);
  const [info, setInfo] = useState<FlightInfo | null>(null);
  const [type, setType] = useState<AircraftType>('scout'),
    [field, setField] = useState('0');
  const aircraft = AIRCRAFT[info?.aircraftType ?? 'scout'];
  const battle = info?.battle;
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
  return (
    <main className={`flight-app ${hangar ? 'hangar-open' : ''}`}>
      <div
        ref={mount}
        className="flight-viewport"
        aria-label="Interactive 3D aircraft cockpit"
      />
      {!hangar && (
        <>
          <output className="minimal-score" aria-label="Team score">
            <span className="allied">ALLIED {battle?.scores.ALLIED ?? 0}</span>
            <i />
            <span className="central">{battle?.scores.CENTRAL ?? 0} CENTRAL</span>
          </output>
          <aside className="mini-map">
            <NavigationMap info={info} />
          </aside>
          <div className="flight-tools">
            {aircraft.bombs > 0 && (
              <Button
                variant="ghost"
                disabled={
                  !ready ||
                  info?.crashed ||
                  !!battle?.winner ||
                  (battle?.bombs ?? 0) === 0
                }
                onClick={() => game.current?.releaseBomb()}
              >
                BOMBS {battle?.bombs ?? 0}
              </Button>
            )}
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
      {battle?.winner && (
        <output className="match-result">
          <h1>
            {battle.winner === 'DRAW'
              ? 'DRAW'
              : battle.winner === battle.team
                ? 'VICTORY'
                : 'DEFEAT'}
          </h1>
          <p>
            ALLIED {battle.scores.ALLIED} — {battle.scores.CENTRAL} CENTRAL
          </p>
          <Button
            onClick={() => {
              setHangar(true);
            }}
          >
            NEW MATCH
          </Button>
        </output>
      )}
      {!ready && (
        <output className="loading-flight">
          {error || 'Preparing your aircraft…'}
        </output>
      )}
      <Dialog
        open={hangar}
        onOpenChange={(v) => {
          if (v || (info?.started && !info.crashed && !leftAircraft))
            setHangar(v);
        }}
      >
        <DialogContent className="flight-manual hangar-menu">
          <DialogTitle>Sortie hangar</DialogTitle>
          <DialogDescription>
            {!info?.started || battle?.winner
              ? 'Choose an airfield and aircraft to begin a race to 100. Your airfield determines your team.'
              : 'Change aircraft and rearm. Your team is locked until this round is complete.'}{' '}
            You start beside the runway.
          </DialogDescription>
          <section className="hangar-briefing">
            <div>
              <span>FLYING CONDITIONS</span>
              <strong>06:40 · CLEAR · 15°C</strong>
              <small>Light westerly · 7 km/h</small>
            </div>
            <div>
              <span>MATCH</span>
              <strong>
                ALLIED {battle?.scores.ALLIED ?? 0} —{' '}
                {battle?.scores.CENTRAL ?? 0} CENTRAL
              </strong>
              <small>{battle?.message ?? 'First team to 100'}</small>
            </div>
          </section>
          <div className="hangar-instructions">
            <strong>QUICK START</strong>
            <span>
              Cock the gun · ignition on · release brake · add throttle · rotate
              at {AIRCRAFT[type].takeoff} km/h
            </span>
            <small>
              WASD looks around · Q/E slide left/right · operate every aircraft
              control in the cockpit
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
                    {AIRCRAFT[key].role} · ROTATE {AIRCRAFT[key].takeoff} KM/H
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
                  disabled={
                    !!info?.started &&
                    !battle?.winner &&
                    f.team !== battle?.team
                  }
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
                setHangar(false);
                setPaused(false);
              }
            }}
            disabled={!ready}
          >
            ENTER AIRCRAFT
          </Button>
          {info?.started && !battle?.winner && !info.crashed && !leftAircraft && (
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
        </DialogContent>
      </Dialog>
      <Dialog open={help} onOpenChange={setHelp}>
        <DialogContent className="flight-manual">
          <DialogTitle>Flight manual</DialogTitle>
          <DialogDescription>
            Three water-cooled biplanes with fixed-pitch propellers and a
            pilot-operated machine gun. Your flight pauses while this manual is
            open.
          </DialogDescription>
          <dl>
            <dt>Start & take off</dt>
            <dd>
              Taxi slowly with low throttle; move the yoke sideways to steer on
              the ground. Center it before accelerating along the runway. Click
              IGNITION. Set mixture near 85%, radiator to 50%. Release BRAKE and
              drag the throttle upward. At 85 km/h in the scout, or 95 km/h in
              the fighter and bomber, drag the yoke down gently to raise the
              nose.
            </dd>
            <dt>Bombs & scoring</dt>
            <dd>
              The bomber carries four 30 kg bombs, two under each wing. The
              first click lifts the square guard over BOMB RELEASE; each later
              click drops one bomb. Release is disabled on the ground. Fly
              level over an enemy airfield, dropping
              before the target to allow for forward travel. Destroying an enemy
              hangar or tower awards 5 points once; every enemy aircraft crash
              awards 5 points, regardless of cause. First team to 100 wins.
              Friendly losses score for the opponent.
            </dd>
            <dt>AI & reinforcements</dt>
            <dd>
              Seven AI pilots join you: three allies and four enemies. Fighters
              intercept and fire bursts; bombers line up bombing passes and have
              rear gunners. AI uses the same flight, engine and projectile
              models. AI pilots start on the apron, taxi, and take off from
              their runway. Replacements return to the apron after eight
              seconds. After a crash, enter the hangar to choose your next
              aircraft without resetting scores.
            </dd>
            <dt>Machine gun</dt>
            <dd>
              Before firing, grab the brass handle on the gun&apos;s right side
              and drag it fully down, then release. Align the rear ring and
              front bead with the target. Click and hold the trigger to fire.
              Tracer rounds show the ballistic path; rounds inherit aircraft
              velocity and lose speed while gravity pulls them down.
            </dd>
            <dt>Heat & jams</dt>
            <dd>
              Sustained fire heats the gun, increasing both shot dispersion and
              the chance of a stoppage. Release the trigger to let it cool. If
              GUN JAMMED appears, cycle the cocking handle fully again before
              firing.
            </dd>
            <dt>Fly & look</dt>
            <dd>
              Drag the yoke sideways to bank, down to pull up, and up to lower
              the nose. Controls stay where released. WASD looks around,
              including fully behind you. Q and E slide the pilot left and right
              inside the cockpit for a clearer view around the gun and fuselage.
              The LEVEL instrument shows aircraft pitch and bank regardless of
              where you look. Automatic rudder coordinates turns.
            </dd>
            <dt>Wind the wheels</dt>
            <dd>
              Grab a wheel and circle its centre. Clockwise makes the mixture
              richer or opens the radiator; anticlockwise leans or closes it.
              One and a half turns covers the full range. Release to retain the
              setting.
            </dd>
            <dt>Engine management</dt>
            <dd>
              Lean the mixture gradually as you climb, watching RPM at steady
              throttle. Opening the radiator increases cooling and aerodynamic
              drag. Close it partway for speed when temperature permits. A cold
              engine needs time to warm up.
            </dd>
            <dt>Stall & landing</dt>
            <dd>
              If STALL appears, push forward, level the wings, and regain
              airspeed. Approach around 95 km/h in the scout or 105 km/h in the
              heavier aircraft, with reduced throttle. Flare gently above the
              grass; brake after touchdown. Clear fields also permit takeoff.
              Trees, buildings, water and hard landings are dangerous.
            </dd>
            <dt>Crashes & navigation</dt>
            <dd>
              Harder crashes break off more pieces and throw your viewpoint from
              the cockpit. HANGAR is always available; leaving away from a
              stationary home runway counts as an aircraft loss. The map shows
              your position and all four airfields. After a match ends, NEW
              MATCH unlocks team selection again.
            </dd>
            <dt>Controls & current scope</dt>
            <dd>
              WASD controls looking; Q and E slide the pilot left and right. Use
              the cockpit for ignition, brakes, flight controls, gun handling
              and bomb release. AI and player losses count equally. Your team
              stays locked for the round. Destroyed buildings stay destroyed
              for the match. Simultaneous winning scores produce a draw.
            </dd>
          </dl>
        </DialogContent>
      </Dialog>
    </main>
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
