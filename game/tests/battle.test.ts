import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { haloStrength, pointRearGunner } from '../lib/flight/battle-view';
import { AI_ESCORT_ALTITUDE, AI_ESCORT_CHANCE, AI_SERVICE_SECONDS, AI_STUCK_DISTANCE, AI_STUCK_SECONDS, AMMO_RESTOCK_RATE, Battle, BLAST_KILL_RADIUS, FORWARD_GUN_DAMAGE, FUEL_RESTOCK_RATE, PLANES_PER_TEAM, REAR_GUN_AIM_ERROR, RESPAWN_DELAY, TARGET_MEMORY_SECONDS, aircraftHitVolumes, escortPosition, forwardGunDirection, gunHitDamage, pilotScanDirection, rackPosition, rearGunnerIdleDirection, rearGunnerShotDirection, segmentBox, segmentSphere, spottingChance, terrainHit, type Bomb, type Plane } from '../lib/flight/battle';
import { parkingPosition, stoppedRunway, turnHeadYaw } from '../lib/flight/airfield-ops';
import { AIRFIELDS, Terrain } from '../lib/flight/terrain';
import { FlightSimulation, DT } from '../lib/flight/simulation';
import { MachineGun } from '../lib/flight/weapons';
import { BattleView, bombModel } from '../lib/flight/battle-view';
import { WorldView } from '../lib/flight/world';
import { rearGunshotLevel } from '../lib/flight/game';
const terrain=new Terrain();
test('forward gun is elevated slightly above the aircraft centreline',()=>{
  const direction=forwardGunDirection(new T.Quaternion());
  assert.ok(direction.y>0);
  assert.ok(Math.abs(Math.asin(direction.y)*180/Math.PI-.5)<1e-10);
});
test('bomber durability and rear-gun damage use the requested hit counts',()=>{
  assert.equal(gunHitDamage('fighter',false),FORWARD_GUN_DAMAGE);
  assert.equal(gunHitDamage('fighter',true),FORWARD_GUN_DAMAGE*.5);
  assert.equal(gunHitDamage('bomber',false),1/8);
  assert.equal(gunHitDamage('bomber',true),1/16);
  const bomber=new FlightSimulation();bomber.aircraftType='bomber';bomber.reset();
  for(let hit=0;hit<7;hit++)bomber.damage(gunHitDamage('bomber',false));
  assert.equal(bomber.crashed,false);bomber.damage(gunHitDamage('bomber',false));assert.equal(bomber.crashCause,'SHOT DOWN');
});
function random(){let seed=5;return()=>{seed=(Math.imul(seed,1664525)+1013904223)|0;return(seed>>>0)/4294967296;};}
function match(team:'ALLIED'|'CENTRAL'='ALLIED',rng=random()){
  const sim=new FlightSimulation();sim.aircraftType='bomber';sim.spawn.copy(parkingPosition(terrain,team==='ALLIED'?0:2));sim.groundHeightAt=terrain.heightAt;sim.reset();return new Battle(terrain,sim,new MachineGun(rng),team,rng);
}
function ticks(b:Battle,seconds:number){for(let i=0;i<Math.ceil(seconds/DT);i++)b.step();}
test('AI taxis and takes off using physics; head turns wrap and hangar requires a stopped runway',t=>{
  const b=match(),departed=new Set<number>();
  (b as unknown as {stepGun:()=>void}).stepGun=()=>{};
  assert.ok(b.planes.every(p=>p.sim.grounded&&p.sim.velocity.length()===0));
  assert.equal(stoppedRunway(b.planes[0].sim),-1);
  for(let i=0;i<360/DT;i++){b.step();for(const p of b.planes.slice(1))if(p.departure==='flying')departed.add(p.id);}
  t.diagnostic(JSON.stringify(b.planes.slice(1).map(p=>({id:p.id,stage:p.departure,cause:p.sim.crashCause,pos:p.sim.position.toArray().map(Math.round)}))));
  assert.equal(departed.size,11);
  const s=b.planes[0].sim;s.position.x=-2800;assert.equal(stoppedRunway(s),0);s.velocity.z=1;assert.equal(stoppedRunway(s),-1);
  assert.ok(Math.abs(turnHeadYaw(0,1,4)-.31681469)<.00001);
});
test('twelve slots include player, sides can change, and respawns never create extra planes',()=>{
  for(const team of['ALLIED','CENTRAL'] as const){const b=match(team);assert.equal(b.planes.length,12);assert.deepEqual(b.info().counts,{ALLIED:6,CENTRAL:6});assert.equal(b.planes[0].team,team);
    b.planes[4].sim.crash('TEST');b.step();assert.equal(b.info().counts[b.planes[4].team],5);const generation=b.planes[4].generation;ticks(b,7);assert.equal(b.planes[4].generation,generation);ticks(b,1.2);assert.equal(b.planes[4].generation,generation+1);assert.deepEqual(b.info().counts,{ALLIED:6,CENTRAL:6});
    const changed=team==='ALLIED'?'CENTRAL':'ALLIED';b.setPlayerTeam(changed);assert.equal(b.playerTeam,changed);assert.equal(b.planes[0].team,changed);
  }
});
test('four bombs leave alternating wing racks individually with inherited velocity and payload loss',()=>{
  const b=match(),p=b.planes[0];assert.equal(b.release(),false);p.sim.grounded=false;p.sim.position.y=500;p.sim.velocity.set(32,2,-6);const initialMass=p.sim.mass;
  for(let i=0;i<4;i++){const before=p.sim.position.clone();assert.equal(b.release(),true);assert.equal(b.release(),false);assert.equal(p.sim.bombsRemaining,3-i);const bomb=b.bombs.at(-1)!;assert.ok(bomb.position.distanceTo(rackPosition(i,p.sim.spec.span).add(before))<1e-8);assert.deepEqual(bomb.velocity.toArray(),[32,1,-6]);p.cooldown=0;}
  assert.equal(b.release(),false);assert.equal(b.bombs.length,4);assert.equal(initialMass-p.sim.mass,120);
  const y=b.bombs[0].position.y;ticks(b,.5);assert.ok(b.bombs[0].position.y<y);assert.ok(b.bombs[0].velocity.y<0);
  const racks=[0,1,2,3].map(i=>rackPosition(i,14.4));assert.equal(racks.filter(r=>r.x<0).length,2);assert.equal(racks.filter(r=>r.x>0).length,2);
});
test('direct bomb hits destroy hangars and towers without a score system',()=>{
  const b=match(),target=b.buildings.find(t=>t.team==='CENTRAL'&&t.kind==='HANGAR')!;
  const drop=(team:'ALLIED'|'CENTRAL',ownerId=0)=>b.bombs.push({id:999,ownerId,team,position:target.position.clone().add(new T.Vector3(0,20,0)),previous:target.position.clone(),velocity:new T.Vector3(0,-300,0),age:0});
  drop('ALLIED');b.step();assert.equal(target.destroyed,true);assert.equal(b.bombs.length,0);assert.equal(b.blasts.length,1);assert.equal(b.message,'HANGAR DESTROYED');assert.equal(b.info().enemyBuildingsBombed,1);assert.ok(b.info().notifications.some(n=>n.text==='Building destroyed'&&n.tone==='positive'));
  drop('ALLIED');ticks(b,.1);assert.equal(target.destroyed,true);
  const friendly=b.buildings.find(t=>t.team==='ALLIED'&&t.kind==='TOWER')!;b.bombs.push({id:1000,ownerId:0,team:'ALLIED',position:friendly.position.clone().add(new T.Vector3(0,22,0)),previous:friendly.position.clone(),velocity:new T.Vector3(0,-300,0),age:0});b.step();assert.equal(friendly.destroyed,true);assert.equal(b.info().enemyBuildingsBombed,1);assert.ok(b.info().notifications.some(n=>n.text==='Friendly fire'&&n.tone==='warning'));
});
test('each airfield has several parked aircraft that bombs and machine guns can destroy once',()=>{
  const bombMatch=match(),byField=new Map<string,number>();for(const p of bombMatch.parkedPlanes){const field=p.id.split('-')[1];byField.set(field,(byField.get(field)??0)+1);}assert.deepEqual([...byField.values()],[4,4,4,4]);
  const bombTarget=bombMatch.parkedPlanes.find(p=>p.team==='CENTRAL')!,bomb:Bomb={id:43,ownerId:0,team:'ALLIED',position:bombTarget.position.clone(),previous:bombTarget.position.clone(),velocity:new T.Vector3(0,-30,0),age:1};
  (bombMatch as unknown as {explode:(bomb:Bomb)=>void}).explode(bomb);assert.equal(bombTarget.destroyed,true);(bombMatch as unknown as {explode:(bomb:Bomb)=>void}).explode(bomb);assert.equal(bombTarget.destroyed,true);
  const gunMatch=match(),shooter=gunMatch.planes[0],gunTarget=gunMatch.parkedPlanes.find(p=>p.team==='CENTRAL')!,from=gunTarget.position.clone().add(new T.Vector3(0,0,10)),to=gunTarget.position.clone().add(new T.Vector3(0,0,-10));
  const hit=(gunMatch as unknown as {bulletHit:(shooter:Plane,from:T.Vector3,to:T.Vector3)=>number|null}).bulletHit.bind(gunMatch);for(let i=0;i<6;i++)assert.notEqual(hit(shooter,from,to),null);assert.equal(gunTarget.destroyed,true);assert.equal(gunMatch.info().enemyAircraftStrafed,1);hit(shooter,from,to);assert.equal(gunTarget.destroyed,true);assert.equal(gunMatch.info().enemyAircraftStrafed,1);
});
test('a bomb blast destroys every aircraft inside its lethal radius',()=>{
  const b=match(),near=b.planes[PLANES_PER_TEAM],friend=b.planes[1],edge=b.planes[PLANES_PER_TEAM+1],position=new T.Vector3(200,500,200);near.sim.position.copy(position).add(new T.Vector3(BLAST_KILL_RADIUS-1,0,0));friend.sim.position.copy(position).add(new T.Vector3(2,0,0));edge.sim.position.copy(position).add(new T.Vector3(BLAST_KILL_RADIUS+1,0,0));
  const bomb:Bomb={id:44,ownerId:0,team:'ALLIED',position,previous:position.clone(),velocity:new T.Vector3(0,-30,0),age:1};(b as unknown as {explode:(bomb:Bomb)=>void}).explode(bomb);assert.equal(near.sim.crashCause,'BOMB BLAST');assert.equal(friend.sim.crashCause,'BOMB BLAST');assert.equal(edge.sim.crashed,false);assert.equal(b.info().enemyAircraftBombed,1);
});
test('near miss outside blast radius leaves targets intact and high-speed terrain sweep finds ridges',()=>{
  const b=match(),target=b.buildings[8],position=target.position.clone().add(new T.Vector3(60,1,0));b.bombs.push({id:1,ownerId:0,team:'ALLIED',position,previous:position.clone(),velocity:new T.Vector3(0,-300,0),age:0});b.step();assert.equal(target.destroyed,false);
  assert.notEqual(terrainHit(new T.Vector3(-20,5,0),new T.Vector3(20,5,0),(x)=>Math.abs(x)<5?10:0),null);
  assert.equal(segmentBox(new T.Vector3(0,0,10),new T.Vector3(0,0,-10),new T.Box3(new T.Vector3(-1,-1,-1),new T.Vector3(1,1,1))),.45);
  assert.notEqual(segmentSphere(new T.Vector3(-20,0,0),new T.Vector3(20,0,0),2),null);
});
test('crashes queue a delayed respawn while the world continues indefinitely',()=>{
  const b=match(),player=b.planes[0];player.sim.crash('TEST');b.step();assert.equal(player.respawnQueued,true);const crashEffects=b.consumeEffects().filter(effect=>effect.kind==='crash'&&effect.targetId===0);assert.equal(crashEffects.length,1);b.step();assert.equal(b.consumeEffects().filter(effect=>effect.kind==='crash'&&effect.targetId===0).length,0);assert.equal(b.respawnPlayer(),false);ticks(b,8.1);assert.equal(b.respawnPlayer(),true);assert.equal(b.respawnPlayer(),false);assert.equal(player.sim.bombsRemaining,4);
  const time=b.time;b.planes[4].sim.crash('TEST');ticks(b,30);assert.ok(b.time>time);assert.ok(b.planes[4].generation>0);
  player.sim.grounded=false;player.sim.position.y=500;player.cooldown=0;assert.equal(b.release(),true);
});
test('AI stuck watchdog respawns motionless active planes but ignores intentional stops',()=>{
  const b=match(),p=b.planes[1],monitor=(b as unknown as {monitorAIStuck:(plane:Plane)=>void}).monitorAIStuck.bind(b);
  b.time=AI_STUCK_SECONDS*2;p.departure='waiting';monitor(p);assert.equal(p.sim.crashed,false);
  p.departure='taxi';b.time+=AI_STUCK_SECONDS-.1;monitor(p);assert.equal(p.sim.crashed,false);
  p.sim.position.x+=AI_STUCK_DISTANCE;monitor(p);b.time+=AI_STUCK_SECONDS-.1;monitor(p);assert.equal(p.sim.crashed,false);
  b.time+=.2;monitor(p);assert.equal(p.sim.crashCause,'AI STUCK');b.step();assert.equal(p.respawnQueued,true);
  const generation=p.generation;ticks(b,RESPAWN_DELAY+.1);assert.ok(p.generation>generation);
});
test('abandoning the player aircraft queues exactly one replacement',()=>{
  const b=match(),player=b.planes[0];assert.equal(b.retirePlayer(),true);assert.equal(player.sim.crashCause,'ABANDONED AIRCRAFT');const respawnAt=player.respawnAt;assert.equal(player.respawnQueued,true);assert.equal(b.retirePlayer(),true);assert.equal(player.respawnAt,respawnAt);
});
test('existing gun projectiles sweep moving aircraft and attribute an airborne player kill once',()=>{
  const b=match(),shooter=b.planes[0],victim=b.planes[PLANES_PER_TEAM];victim.sim.position.set(0,800,0);victim.sim.orientation.identity();victim.sim.velocity.set(0,0,-35);victim.sim.grounded=false;victim.sim.airframeHealth=.05;
  shooter.gun.projectiles.push({position:new T.Vector3(0,800,6),previous:new T.Vector3(0,800,6),velocity:new T.Vector3(0,0,-650),age:0,tracer:true});b.step();assert.equal(victim.sim.crashCause,'SHOT DOWN');assert.equal(shooter.gun.projectiles.length,0);assert.equal(b.info().enemyAircraftKills,1);assert.equal(b.info().flightKills,1);assert.ok(b.info().notifications.some(n=>n.text==='Enemy aircraft destroyed · Kills 1'&&n.tone==='positive'));b.step();assert.equal(victim.respawnQueued,true);assert.equal(b.info().enemyAircraftKills,1);
});
test('aircraft kill notifications carry a counter that resets for each flight',()=>{
  const b=match(),record=(b as unknown as {recordKill:(label:string)=>void}).recordKill.bind(b);record('Enemy aircraft destroyed');record('Ground aircraft destroyed');assert.equal(b.info().flightKills,2);assert.deepEqual(b.info().notifications.slice(-2).map(n=>n.text),['Enemy aircraft destroyed · Kills 1','Ground aircraft destroyed · Kills 2']);b.beginPlayerFlight();assert.equal(b.info().flightKills,0);record('Enemy aircraft destroyed');assert.equal(b.info().notifications.at(-1)?.text,'Enemy aircraft destroyed · Kills 1');
});
test('hits have a ten-percent leak chance and player leaks report their cumulative count',()=>{
  const b=match('ALLIED',()=>.05),player=b.planes[0],shooter=b.planes[PLANES_PER_TEAM];for(const p of b.planes)if(p!==player&&p!==shooter)p.sim.position.set(3000,800,3000);
  player.sim.position.set(0,800,0);player.previous.copy(player.sim.position);player.rotation.copy(player.sim.orientation);player.sim.grounded=false;shooter.sim.position.set(0,800,30);const hit=(b as unknown as {bulletHit:(shooter:Plane,from:T.Vector3,to:T.Vector3)=>number|null}).bulletHit.bind(b);
  assert.notEqual(hit(shooter,new T.Vector3(0,800,10),new T.Vector3(0,800,-10)),null);assert.equal(player.sim.fuelLeaks,1);
  assert.notEqual(hit(shooter,new T.Vector3(0,800,10),new T.Vector3(0,800,-10)),null);assert.equal(player.sim.fuelLeaks,2);assert.deepEqual(b.info().notifications.slice(-2).map(n=>n.text),['Fuel leak','Fuel leaks ×2']);
  const safe=match('ALLIED',()=>.5),safePlayer=safe.planes[0],safeShooter=safe.planes[PLANES_PER_TEAM];for(const p of safe.planes)if(p!==safePlayer&&p!==safeShooter)p.sim.position.set(3000,800,3000);safePlayer.sim.position.set(0,800,0);safePlayer.previous.copy(safePlayer.sim.position);safePlayer.rotation.copy(safePlayer.sim.orientation);safePlayer.sim.grounded=false;
  (safe as unknown as {bulletHit:(shooter:Plane,from:T.Vector3,to:T.Vector3)=>number|null}).bulletHit(safeShooter,new T.Vector3(0,800,10),new T.Vector3(0,800,-10));assert.equal(safePlayer.sim.fuelLeaks,0);
});
test('friendly runways slowly replenish fuel and every fitted gun',()=>{
  const b=match(),p=b.planes[0],s=p.sim,restock=(b as unknown as {restock:(p:Plane,dt:number)=>void}).restock.bind(b);s.position.set(AIRFIELDS[0].x,terrain.airfieldHeights[0]+1.15,AIRFIELDS[0].z);s.grounded=true;s.fuel=10;p.gun.roundsRemaining=80;p.rear.roundsRemaining=200;
  for(let i=0;i<120;i++)restock(p,DT);assert.ok(Math.abs(s.fuel-(10+FUEL_RESTOCK_RATE*2))<1e-9);assert.equal(p.gun.roundsRemaining,80+AMMO_RESTOCK_RATE*2);assert.equal(p.rear.roundsRemaining,200+AMMO_RESTOCK_RATE*2);assert.equal(b.info().notifications[0].text,'Resupplying');
  const fuel=s.fuel,ammo=p.gun.roundsRemaining;s.position.set(AIRFIELDS[2].x,terrain.airfieldHeights[2]+1.15,AIRFIELDS[2].z);restock(p,1);assert.equal(s.fuel,fuel);assert.equal(p.gun.roundsRemaining,ammo);
});
test('fuel-starved AI abandons combat and glides toward a friendly runway',()=>{
  const b=match(),p=b.planes[5];p.sim.grounded=false;p.sim.position.set(0,600,0);p.sim.velocity.set(0,-2,-38);p.sim.fuel=0;(b as unknown as {flyAI:(p:Plane,dt:number)=>void}).flyAI(p,DT);assert.ok(p.emergencyField>=0);assert.equal(AIRFIELDS[p.emergencyField].team,p.team);assert.ok(['RETURN TO AIRFIELD','FINAL APPROACH','GLIDE RECOVERY'].includes(p.mode));assert.equal(p.gun.trigger,false);
});
test('selected cockpit warnings are amber and edge-triggered',()=>{
  const b=match(),p=b.planes[0],s=p.sim,monitor=(b as unknown as {monitorPlayer:()=>void}).monitorPlayer.bind(b);s.grounded=false;s.fuel=s.spec.fuel*.19;s.engine='running';s.mixtureEfficiency=.4;s.temperature=111;s.rpm=2200;s.stall=true;p.gun.jammed=true;monitor();
  s.fuel=0;s.engine='seized';monitor();const notifications=b.info().notifications,texts=notifications.map(n=>n.text);for(const text of['Fuel low','Bad mixture','Engine overheating','Engine overspeed','Stall','Gun jammed','Fuel empty','Engine seized'])assert.ok(texts.includes(text),text);assert.ok(notifications.every(n=>n.tone==='warning'));
  const count=notifications.length;monitor();assert.equal(b.info().notifications.length,count);
});
test('damaged AI may dive, reverse turns frequently, and return to normal tactics when safe',()=>{
  const b=match('ALLIED',()=>0),ai=b.planes[4];ai.departure='flying';ai.sim.grounded=false;ai.sim.position.set(0,600,0);ai.sim.velocity.set(0,0,-42);ai.sim.airspeed=42;ai.sim.damage(.18);
  const fly=(b as unknown as {flyAI:(p:typeof ai,dt:number)=>void}).flyAI.bind(b);fly(ai,DT);assert.equal(ai.mode,'EVASIVE DIVE');assert.ok(ai.evasiveUntil-b.time>=15&&ai.evasiveUntil-b.time<=25);assert.ok(ai.evasiveTurnAt-b.time>=1&&ai.evasiveTurnAt-b.time<=4);const direction=ai.evasiveDirection;b.time=ai.evasiveTurnAt;fly(ai,DT);assert.equal(ai.evasiveDirection,-direction);assert.ok(ai.evasiveTurnAt-b.time>=1&&ai.evasiveTurnAt-b.time<=4);b.time=ai.evasiveUntil+.1;fly(ai,DT);assert.ok(!ai.mode.startsWith('EVASIVE'));
  const shooter=b.planes[0];shooter.gun.projectiles.push({position:new T.Vector3(0,600,8),previous:new T.Vector3(0,600,8),velocity:new T.Vector3(0,0,-650),age:0,tracer:true});b.step();const effects=b.consumeEffects();assert.ok(effects.some(e=>e.kind==='hit'));assert.ok(effects.some(e=>e.kind==='damage'&&e.targetId===ai.id));
});
test('a damaged AI pilot can choose not to enter an evasive manoeuvre',()=>{
  const b=match('ALLIED',()=>.99),ai=b.planes[4];ai.departure='flying';ai.sim.grounded=false;ai.sim.position.set(0,600,0);ai.sim.velocity.set(0,0,-42);ai.sim.airspeed=42;ai.sim.damage(.18);
  (b as unknown as {flyAI:(p:typeof ai,dt:number)=>void}).flyAI(ai,DT);assert.equal(ai.evasiveUntil,0);assert.ok(!ai.mode.startsWith('EVASIVE'));
});
test('fighter AI has two independent forward guns',()=>{
  const b=match(),fighter=b.planes.find(p=>p.id!==0&&p.sim.aircraftType==='fighter')!;assert.equal(fighter.gun.capacity,100);assert.equal(fighter.secondary.capacity,100);fighter.gun.roundsRemaining=9;fighter.secondary.roundsRemaining=7;fighter.gun.reset();assert.equal(fighter.gun.roundsRemaining,100);assert.equal(fighter.secondary.roundsRemaining,7);
});
void test('scouts and fighters can escort above a friendly bomber until combat takes priority',()=>{
  const b=match('ALLIED',()=>0),escort=b.planes.find(p=>p.team==='ALLIED'&&p.sim.aircraftType==='fighter')!,bomber=b.planes.find(p=>p.team==='ALLIED'&&p.sim.aircraftType==='bomber')!,enemy=b.planes.find(p=>p.team==='CENTRAL')!;
  assert.ok(AI_ESCORT_CHANCE>0&&AI_ESCORT_CHANCE<1);bomber.sim.position.set(400,520,-300);bomber.sim.orientation.identity();bomber.sim.airspeed=39;bomber.sim.grounded=false;bomber.departure='flying';escort.sim.position.set(0,500,0);escort.sim.velocity.set(0,0,-42);escort.sim.airspeed=42;escort.sim.grounded=false;escort.departure='flying';escort.decision=10;
  const station=escortPosition(bomber.sim.position,bomber.sim.orientation,escort.id);assert.ok(station.y>=bomber.sim.position.y+AI_ESCORT_ALTITUDE);assert.ok(Math.hypot(station.x-bomber.sim.position.x,station.z-bomber.sim.position.z)>250);
  const fly=(b as unknown as {flyAI:(plane:Plane,dt:number)=>void}).flyAI.bind(b);fly(escort,DT);assert.equal(escort.escortTarget,bomber.id);assert.equal(escort.mode,'ESCORT BOMBER');
  enemy.sim.position.set(150,540,-350);enemy.sim.velocity.set(0,0,-38);enemy.sim.grounded=false;escort.target=enemy.id;escort.lastSeenPosition.copy(enemy.sim.position);escort.lastSeenVelocity.copy(enemy.sim.velocity);escort.lastSeenAt=b.time;escort.targetMemoryUntil=b.time+TARGET_MEMORY_SECONDS;fly(escort,DT);assert.notEqual(escort.mode,'ESCORT BOMBER');assert.equal(escort.escortTarget,bomber.id);
});
test('rear gunner fires only into clear rear-upper arc and respects own tail and friendlies',()=>{
  const b=match(),bomber=b.planes[3],target=b.planes[PLANES_PER_TEAM];bomber.sim.position.set(0,1000,0);bomber.sim.orientation.identity();bomber.sim.velocity.set(0,0,-40);target.sim.position.set(0,1015,150);target.sim.velocity.set(0,0,-40);
  assert.equal(bomber.rear.muzzleVelocity,600);
  // Keep AI guidance out of this geometry/weapon test.
  const step=(b as unknown as {stepGun:(p:typeof bomber,g:MachineGun,rear:boolean,dt:number)=>void}).stepGun.bind(b);
  for(let i=0;i<20;i++)step(bomber,bomber.rear,true,DT);assert.ok(bomber.rear.roundsFired>0);assert.ok(b.consumeEffects().some(effect=>effect.kind==='muzzle'&&effect.targetId===bomber.id));
  bomber.rear.reset();bomber.rear.cock();target.sim.position.set(0,1000,150);for(let i=0;i<20;i++)step(bomber,bomber.rear,true,DT);assert.equal(bomber.rear.roundsFired,0);
  target.sim.position.set(0,1020,-150);for(let i=0;i<20;i++)step(bomber,bomber.rear,true,DT);assert.equal(bomber.rear.roundsFired,0);
  target.sim.position.set(0,1015,150);const friend=b.planes[1];friend.sim.position.set(0,1007.5,75);for(let i=0;i<20;i++)step(bomber,bomber.rear,true,DT);assert.equal(bomber.rear.roundsFired,0);
});
test('component hit volumes detach individual structures before the aircraft is destroyed',()=>{
  const volumes=aircraftHitVolumes(14.4,1.32);assert.deepEqual(new Set(volumes.map(v=>v.component)),new Set(['leftWing','rightWing','tail','engine']));
  const s=new FlightSimulation();s.aircraftType='fighter';s.reset();const detached=s.damageComponent('leftWing',1);assert.equal(detached,true);assert.equal(s.detachedComponents.has('leftWing'),true);assert.equal(s.componentHealth.rightWing,1);assert.equal(s.crashed,false);assert.ok(s.airframeHealth>0);
  s.engine='seized';s.service();assert.equal(s.detachedComponents.size,0);assert.deepEqual(s.componentHealth,{leftWing:1,rightWing:1,tail:1,engine:1});assert.equal(s.engine,'off');
});
test('pilot perception favours the forward view and being hit creates immediate target memory',()=>{
  const scan=new T.Vector3(0,0,-1);assert.ok(spottingChance(new T.Vector3(0,0,-1),900,scan)>spottingChance(new T.Vector3(1,0,0),900,scan));assert.ok(spottingChance(new T.Vector3(1,0,0),900,scan)>spottingChance(new T.Vector3(0,-.5,1),900,scan));assert.ok(pilotScanDirection(0,2).distanceTo(pilotScanDirection(5,2))>.2);
  const b=match(),victim=b.planes[1],shooter=b.planes[PLANES_PER_TEAM];for(const p of b.planes)if(p!==victim&&p!==shooter)p.sim.position.set(3000,800,3000);victim.sim.position.set(0,800,0);victim.previous.copy(victim.sim.position);victim.sim.grounded=false;shooter.sim.position.set(0,800,30);shooter.sim.velocity.set(0,0,-40);
  (b as unknown as {bulletHit:(shooter:Plane,from:T.Vector3,to:T.Vector3)=>number|null}).bulletHit(shooter,new T.Vector3(0,800,10),new T.Vector3(0,800,-10));assert.equal(victim.target,shooter.id);assert.deepEqual(victim.lastSeenPosition.toArray(),shooter.sim.position.toArray());assert.equal(victim.targetMemoryUntil,b.time+TARGET_MEMORY_SECONDS);assert.ok(victim.underFireUntil>b.time);
});
test('AI completes a landing, taxi, service and relaunch cycle without teleporting',()=>{
  const b=match('ALLIED',()=>.35),p=b.planes.find(candidate=>candidate.team==='CENTRAL'&&candidate.sim.aircraftType==='scout'&&candidate.homeField%2===1)!,field=AIRFIELDS[p.homeField],base=terrain.airfieldHeights[p.homeField],startGeneration=p.generation,stages=new Set<string>();p.departure='flying';p.sim.position.set(field.x,base+85,field.z+1050);p.sim.velocity.set(0,0,-35);p.sim.grounded=false;p.sim.engine='running';p.sim.controls.ignition=true;p.sim.fuel=p.sim.spec.fuel*.2;p.sim.bombsRemaining=0;p.gun.roundsRemaining=4;
  const fly=(b as unknown as {flyAI:(plane:Plane,dt:number)=>void}).flyAI.bind(b),restock=(b as unknown as {restock:(plane:Plane,dt:number)=>void}).restock.bind(b);let completed=false;
  for(let i=0;i<260/DT;i++){b.time+=DT;fly(p,DT);p.sim.step(DT);restock(p,DT);stages.add(p.recoveryStage);if(p.recoveryStage==='none'&&(p.departure as string)==='waiting'&&p.generation>startGeneration){completed=true;break;}if(p.sim.crashed)break;}
  assert.equal(p.sim.crashCause,'');assert.equal(completed,true);for(const stage of['approach','final','rollout','taxi','service'])assert.equal(stages.has(stage),true,stage);assert.equal(p.sim.fuel,p.sim.spec.fuel);assert.equal(p.sim.bombsRemaining,p.sim.spec.bombs);assert.equal(p.gun.roundsRemaining,p.gun.capacity);assert.equal(p.sim.componentHealth.tail,1);assert.ok(AI_SERVICE_SECONDS>=10);
  let relaunched=false;for(let i=0;i<180/DT;i++){b.time+=DT;fly(p,DT);p.sim.step(DT);if(p.departure==='flying'){relaunched=true;break;}if(p.sim.crashed)break;}assert.equal(p.sim.crashCause,'');assert.equal(relaunched,true);
});
void test('rear gunner visibly tracks aim, scans while idle, and gun reports fade with distance',()=>{
  const first=rearGunnerIdleDirection(0,3),later=rearGunnerIdleDirection(4,3);assert.ok(Math.abs(first.length()-1)<1e-12);assert.ok(first.z>0&&later.z>0);assert.ok(first.distanceTo(later)>.1);
  const shotA=rearGunnerShotDirection(later,2,3),shotB=rearGunnerShotDirection(later,3,3);assert.ok(shotA.angleTo(later)>0);assert.ok(shotA.angleTo(later)<REAR_GUN_AIM_ERROR*2);assert.ok(shotA.angleTo(shotB)>0);
  const mount=new T.Group(),gunner=new T.Group();pointRearGunner(mount,gunner,later);const pointed=new T.Vector3(0,0,1).applyQuaternion(mount.quaternion);assert.ok(pointed.distanceTo(later)<1e-10);assert.ok(gunner.quaternion.angleTo(mount.quaternion)>0);
  assert.ok(rearGunshotLevel(2)>.8);assert.ok(rearGunshotLevel(450)>0);assert.equal(rearGunshotLevel(1400),0);
});
test('AI keeps the continuous world active with bombing, gunfire and replacements',t=>{
  const b=match();let maxBombs=0,shots=0;const previousShots=new Map<number,number>();const causes=new Set<string>();
  for(let i=0;i<900/DT;i++){b.step();maxBombs=Math.max(maxBombs,b.bombs.length);assert.ok(b.info().counts.ALLIED<=PLANES_PER_TEAM&&b.info().counts.CENTRAL<=PLANES_PER_TEAM);for(const p of b.planes){assert.ok(p.sim.position.toArray().every(Number.isFinite));if(p.sim.crashCause)causes.add(p.sim.crashCause);const old=previousShots.get(p.id)??0;shots+=Math.max(0,p.gun.roundsFired-old);previousShots.set(p.id,p.gun.roundsFired);}}
  assert.ok(b.time>899);assert.ok(maxBombs>0);assert.ok(b.buildings.some(target=>target.destroyed));assert.ok(shots>30);assert.ok(causes.size>0);
  t.diagnostic(`World active at ${b.time.toFixed(0)} s; ${shots} rounds, ${b.buildings.filter(target=>target.destroyed).length} destroyed buildings; losses: ${[...causes].join(', ')}`);
});
test('battle models, bomb disappearance, crash effects and destroyed building visuals share state',()=>{
  const b=match(),scene=new T.Scene(),old=Object.getOwnPropertyDescriptor(globalThis,'document');
  const context=new Proxy({}, {get:()=>()=>{}});Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement:()=>({width:0,height:0,getContext:()=>context})}});
  let world:WorldView|undefined,view:BattleView|undefined;
  try{world=new WorldView(scene,terrain,b.planes[0].sim.scenery);view=new BattleView(scene,b);view.update(0,1);const before=scene.children.length;
    const camera=new T.PerspectiveCamera();camera.position.copy(b.planes[0].sim.position).add(new T.Vector3(0,.7,0));b.effects.push({kind:'damage',position:b.planes[0].sim.position.clone(),velocity:b.planes[0].sim.velocity.clone(),intensity:.8,targetId:0});assert.equal(view.update(0,1,camera),1);const particlePoints=scene.children.find(child=>child instanceof T.Points) as T.Points;assert.ok(particlePoints.geometry.drawRange.count>=30);b.planes[1].sim.airframeHealth=.35;b.planes[1].sim.engine='off';view.update(.5,1,camera);assert.ok(particlePoints.geometry.drawRange.count>0);
    b.planes[3].sim.crash('TEST');b.step();view.update(DT,1);b.buildings[0].destroyed=true;world.updateBuildings(b.buildings);ticks(b,8.2);view.update(DT,1);view.dispose();view=undefined;assert.ok(scene.children.length<before);
    const model=bombModel(),bounds=new T.Box3().setFromObject(model);assert.ok(bounds.getSize(new T.Vector3()).z>.9);model.traverse(o=>{if(o instanceof T.Mesh){o.geometry.dispose();(o.material as T.Material).dispose();}});
  }finally{view?.dispose();world?.dispose();scene.traverse(o=>{if(o instanceof T.Mesh)o.geometry.dispose();});if(old)Object.defineProperty(globalThis,'document',old);else Reflect.deleteProperty(globalThis,'document');}
});
test('AI departure paths clear the generated trees and airfield buildings',()=>{
  const b=match(),scene=new T.Scene(),old=Object.getOwnPropertyDescriptor(globalThis,'document');
  const context=new Proxy({}, {get:()=>()=>{}});Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement:()=>({width:0,height:0,getContext:()=>context})}});
  const world=new WorldView(scene,terrain,b.planes[0].sim.scenery),departed=new Set<number>();
  (b as unknown as {scenery:typeof b.planes[0]['sim']['scenery']}).scenery=b.planes[0].sim.scenery;
  (b as unknown as {stepGun:()=>void}).stepGun=()=>{};
  try{for(let i=0;i<360/DT&&departed.size<9;i++){b.step();for(const p of b.planes.slice(1)){if(p.departure==='flying')departed.add(p.id);if(!departed.has(p.id))assert.equal(p.sim.crashed,false,`${p.id}: ${p.sim.crashCause}`);}}assert.equal(departed.size,9);}
  finally{world.dispose();if(old)Object.defineProperty(globalThis,'document',old);else Reflect.deleteProperty(globalThis,'document');}
});


void test('aircraft halos fade to a trace inside shooting range',()=>{
  assert.equal(haloStrength(650),.06);
  assert.equal(haloStrength(100),.06);
  assert.ok(haloStrength(1000)>.06);
  assert.ok(Math.abs(haloStrength(1600)-.6)<1e-12);
});
