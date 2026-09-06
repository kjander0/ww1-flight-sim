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
            <Button
              variant="ghost"
              disabled={!ready || info?.crashed || !!battle?.winner}
              title="Temporary test control: raise this aircraft 500 metres"
              onClick={() => game.current?.raiseForTesting()}
            >
              +500 M TEST
            </Button>
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
              excessive RPM, or empty fuel can stop or damage the engine.
            </dd>
            <dt>Machine gun</dt>
            <dd>
              Drag the brass cocking handle fully down and release, sight through
              the ring and bead, then hold the trigger. Bullets inherit aircraft
              velocity and are affected by drag and gravity. Sustained fire heats
              the gun, spreading shots and causing jams; let it cool and recock
              after a stoppage. Each belt contains 250 rounds.
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
              water, and leaving the map can destroy the aircraft.
            </dd>
            <dt>Battle, AI & navigation</dt>
            <dd>
              MAP shows you, contacts, and all four airfields. Three allied and
              four enemy AI pilots taxi, take off, dogfight, bomb, and return as
              replacements after losses. Aircraft crashes and each enemy hangar
              or tower destroyed award 5 points; first to 100 wins. Your team is
              locked for the match, damage persists, and simultaneous winning
              scores produce a draw. Respawn or use HANGAR after a loss; leaving
              a live aircraft away from a stationary home runway forfeits it.
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
