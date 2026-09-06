import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { haloStrength } from '../lib/flight/battle-view';
import { Battle, BLAST_KILL_RADIUS, rackPosition, segmentBox, segmentSphere, terrainHit, type Bomb, type Plane } from '../lib/flight/battle';
import { parkingPosition, stoppedRunway, turnHeadYaw } from '../lib/flight/airfield-ops';
import { Terrain } from '../lib/flight/terrain';
import { FlightSimulation, DT } from '../lib/flight/simulation';
import { MachineGun } from '../lib/flight/weapons';
import { BattleView, bombModel } from '../lib/flight/battle-view';
import { WorldView } from '../lib/flight/world';
const terrain=new Terrain();
function random(){let seed=5;return()=>{seed=(Math.imul(seed,1664525)+1013904223)|0;return(seed>>>0)/4294967296;};}
function match(team:'ALLIED'|'CENTRAL'='ALLIED'){
  const sim=new FlightSimulation();sim.aircraftType='bomber';sim.spawn.copy(parkingPosition(terrain,team==='ALLIED'?0:2));sim.groundHeightAt=terrain.heightAt;sim.reset();const rng=random();return new Battle(terrain,sim,new MachineGun(rng),team,rng);
}
function ticks(b:Battle,seconds:number){for(let i=0;i<Math.ceil(seconds/DT);i++)b.step();}
test('AI taxis and takes off using physics; head turns wrap and hangar requires a stopped runway',t=>{
  const b=match(),departed=new Set<number>();
  (b as unknown as {stepGun:()=>void}).stepGun=()=>{};
  assert.ok(b.planes.every(p=>p.sim.grounded&&p.sim.velocity.length()===0));
  assert.equal(stoppedRunway(b.planes[0].sim),-1);
  for(let i=0;i<360/DT;i++){b.step();for(const p of b.planes.slice(1))if(p.departure==='flying')departed.add(p.id);}
  t.diagnostic(JSON.stringify(b.planes.slice(1).map(p=>({id:p.id,stage:p.departure,cause:p.sim.crashCause,pos:p.sim.position.toArray().map(Math.round)}))));
  assert.equal(departed.size,7);
  const s=b.planes[0].sim;s.position.x=-2800;assert.equal(stoppedRunway(s),0);s.velocity.z=1;assert.equal(stoppedRunway(s),-1);
  assert.ok(Math.abs(turnHeadYaw(0,1,4)-.31681469)<.00001);
});
test('eight slots include player, sides can change, and respawns never create extra planes',()=>{
  for(const team of['ALLIED','CENTRAL'] as const){const b=match(team);assert.equal(b.planes.length,8);assert.deepEqual(b.info().counts,{ALLIED:4,CENTRAL:4});assert.equal(b.planes[0].team,team);
    b.planes[4].sim.crash('TEST');b.step();assert.equal(b.info().counts[b.planes[4].team],3);const generation=b.planes[4].generation;ticks(b,7);assert.equal(b.planes[4].generation,generation);ticks(b,1.2);assert.equal(b.planes[4].generation,generation+1);assert.deepEqual(b.info().counts,{ALLIED:4,CENTRAL:4});
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
  const drop=(team:'ALLIED'|'CENTRAL')=>b.bombs.push({id:999,team,position:target.position.clone().add(new T.Vector3(0,20,0)),previous:target.position.clone(),velocity:new T.Vector3(0,-300,0),age:0});
  drop('ALLIED');b.step();assert.equal(target.destroyed,true);assert.equal(b.bombs.length,0);assert.equal(b.blasts.length,1);assert.equal(b.message,'HANGAR DESTROYED');
  drop('ALLIED');ticks(b,.1);assert.equal(target.destroyed,true);
  const friendly=b.buildings.find(t=>t.team==='ALLIED'&&t.kind==='TOWER')!;b.bombs.push({id:1000,team:'ALLIED',position:friendly.position.clone().add(new T.Vector3(0,22,0)),previous:friendly.position.clone(),velocity:new T.Vector3(0,-300,0),age:0});b.step();assert.equal(friendly.destroyed,true);
});
test('each airfield has several parked aircraft that bombs and machine guns can destroy once',()=>{
  const bombMatch=match(),byField=new Map<string,number>();for(const p of bombMatch.parkedPlanes){const field=p.id.split('-')[1];byField.set(field,(byField.get(field)??0)+1);}assert.deepEqual([...byField.values()],[4,4,4,4]);
  const bombTarget=bombMatch.parkedPlanes.find(p=>p.team==='CENTRAL')!,bomb:Bomb={id:43,team:'ALLIED',position:bombTarget.position.clone(),previous:bombTarget.position.clone(),velocity:new T.Vector3(0,-30,0),age:1};
  (bombMatch as unknown as {explode:(bomb:Bomb)=>void}).explode(bomb);assert.equal(bombTarget.destroyed,true);(bombMatch as unknown as {explode:(bomb:Bomb)=>void}).explode(bomb);assert.equal(bombTarget.destroyed,true);
  const gunMatch=match(),shooter=gunMatch.planes[0],gunTarget=gunMatch.parkedPlanes.find(p=>p.team==='CENTRAL')!,from=gunTarget.position.clone().add(new T.Vector3(0,0,10)),to=gunTarget.position.clone().add(new T.Vector3(0,0,-10));
  const hit=(gunMatch as unknown as {bulletHit:(shooter:Plane,from:T.Vector3,to:T.Vector3)=>number|null}).bulletHit.bind(gunMatch);for(let i=0;i<6;i++)assert.notEqual(hit(shooter,from,to),null);assert.equal(gunTarget.destroyed,true);hit(shooter,from,to);assert.equal(gunTarget.destroyed,true);
});
test('a bomb blast destroys every aircraft inside its lethal radius',()=>{
  const b=match(),near=b.planes[4],edge=b.planes[5],position=new T.Vector3(200,500,200);near.sim.position.copy(position).add(new T.Vector3(BLAST_KILL_RADIUS-1,0,0));edge.sim.position.copy(position).add(new T.Vector3(BLAST_KILL_RADIUS+1,0,0));
  const bomb:Bomb={id:44,team:'ALLIED',position,previous:position.clone(),velocity:new T.Vector3(0,-30,0),age:1};(b as unknown as {explode:(bomb:Bomb)=>void}).explode(bomb);assert.equal(near.sim.crashCause,'BOMB BLAST');assert.equal(edge.sim.crashed,false);
});
test('near miss outside blast radius leaves targets intact and high-speed terrain sweep finds ridges',()=>{
  const b=match(),target=b.buildings[8],position=target.position.clone().add(new T.Vector3(60,1,0));b.bombs.push({id:1,team:'ALLIED',position,previous:position.clone(),velocity:new T.Vector3(0,-300,0),age:0});b.step();assert.equal(target.destroyed,false);
  assert.notEqual(terrainHit(new T.Vector3(-20,5,0),new T.Vector3(20,5,0),(x)=>Math.abs(x)<5?10:0),null);
  assert.equal(segmentBox(new T.Vector3(0,0,10),new T.Vector3(0,0,-10),new T.Box3(new T.Vector3(-1,-1,-1),new T.Vector3(1,1,1))),.45);
  assert.notEqual(segmentSphere(new T.Vector3(-20,0,0),new T.Vector3(20,0,0),2),null);
});
test('crashes queue a delayed respawn while the world continues indefinitely',()=>{
  const b=match(),player=b.planes[0];player.sim.crash('TEST');b.step();assert.equal(player.respawnQueued,true);assert.equal(b.respawnPlayer(),false);ticks(b,8.1);assert.equal(b.respawnPlayer(),true);assert.equal(b.respawnPlayer(),false);assert.equal(player.sim.bombsRemaining,4);
  const time=b.time;b.planes[4].sim.crash('TEST');ticks(b,30);assert.ok(b.time>time);assert.ok(b.planes[4].generation>0);
  player.sim.grounded=false;player.sim.position.y=500;player.cooldown=0;assert.equal(b.release(),true);
});
test('abandoning the player aircraft queues exactly one replacement',()=>{
  const b=match(),player=b.planes[0];assert.equal(b.retirePlayer(),true);assert.equal(player.sim.crashCause,'ABANDONED AIRCRAFT');const respawnAt=player.respawnAt;assert.equal(player.respawnQueued,true);assert.equal(b.retirePlayer(),true);assert.equal(player.respawnAt,respawnAt);
});
test('existing gun projectiles sweep moving aircraft and stop on contact',()=>{
  const b=match(),shooter=b.planes[0],victim=b.planes[4];victim.sim.position.set(0,800,0);victim.sim.orientation.identity();victim.sim.velocity.set(0,0,-35);victim.sim.airframeHealth=.17;
  shooter.gun.projectiles.push({position:new T.Vector3(0,800,6),previous:new T.Vector3(0,800,6),velocity:new T.Vector3(0,0,-650),age:0,tracer:true});b.step();assert.equal(victim.sim.crashCause,'SHOT DOWN');assert.equal(shooter.gun.projectiles.length,0);b.step();assert.equal(victim.respawnQueued,true);
});
test('aircraft break evasively after taking fire and impacts feed the shared effects queue',()=>{
  const b=match(),ai=b.planes[4];ai.departure='flying';ai.sim.grounded=false;ai.sim.position.set(0,600,0);ai.sim.velocity.set(0,0,-42);ai.sim.airspeed=42;ai.sim.damage(.18);
  (b as unknown as {flyAI:(p:typeof ai,dt:number)=>void}).flyAI(ai,DT);assert.equal(ai.mode,'EVASIVE BREAK');assert.ok(ai.evasiveUntil>b.time);
  const shooter=b.planes[0];shooter.gun.projectiles.push({position:new T.Vector3(0,600,8),previous:new T.Vector3(0,600,8),velocity:new T.Vector3(0,0,-650),age:0,tracer:true});b.step();const effects=b.consumeEffects();assert.ok(effects.some(e=>e.kind==='hit'));assert.ok(effects.some(e=>e.kind==='damage'));
});
test('rear gunner fires only into clear rear-upper arc and respects own tail and friendlies',()=>{
  const b=match(),bomber=b.planes[3],target=b.planes[4];bomber.sim.position.set(0,1000,0);bomber.sim.orientation.identity();bomber.sim.velocity.set(0,0,-40);target.sim.position.set(0,1015,150);target.sim.velocity.set(0,0,-40);
  // Keep AI guidance out of this geometry/weapon test.
  const step=(b as unknown as {stepGun:(p:typeof bomber,g:MachineGun,rear:boolean,dt:number)=>void}).stepGun.bind(b);
  for(let i=0;i<20;i++)step(bomber,bomber.rear,true,DT);assert.ok(bomber.rear.roundsFired>0);
  bomber.rear.reset();bomber.rear.cock();target.sim.position.set(0,1000,150);for(let i=0;i<20;i++)step(bomber,bomber.rear,true,DT);assert.equal(bomber.rear.roundsFired,0);
  target.sim.position.set(0,1020,-150);for(let i=0;i<20;i++)step(bomber,bomber.rear,true,DT);assert.equal(bomber.rear.roundsFired,0);
  target.sim.position.set(0,1015,150);const friend=b.planes[1];friend.sim.position.set(0,1007.5,75);for(let i=0;i<20;i++)step(bomber,bomber.rear,true,DT);assert.equal(bomber.rear.roundsFired,0);
});
test('AI keeps the continuous world active with bombing, gunfire and replacements',t=>{
  const b=match();let maxBombs=0,shots=0;const previousShots=new Map<number,number>();const causes=new Set<string>();
  for(let i=0;i<900/DT;i++){b.step();maxBombs=Math.max(maxBombs,b.bombs.length);assert.ok(b.info().counts.ALLIED<=4&&b.info().counts.CENTRAL<=4);for(const p of b.planes){assert.ok(p.sim.position.toArray().every(Number.isFinite));if(p.sim.crashCause)causes.add(p.sim.crashCause);const old=previousShots.get(p.id)??0;shots+=Math.max(0,p.gun.roundsFired-old);previousShots.set(p.id,p.gun.roundsFired);}}
  assert.ok(b.time>899);assert.ok(maxBombs>0);assert.ok(b.buildings.some(target=>target.destroyed));assert.ok(shots>30);assert.ok(causes.size>0);
  t.diagnostic(`World active at ${b.time.toFixed(0)} s; ${shots} rounds, ${b.buildings.filter(target=>target.destroyed).length} destroyed buildings; losses: ${[...causes].join(', ')}`);
});
test('battle models, bomb disappearance, crash effects and destroyed building visuals share state',()=>{
  const b=match(),scene=new T.Scene(),old=Object.getOwnPropertyDescriptor(globalThis,'document');
  const context=new Proxy({}, {get:()=>()=>{}});Object.defineProperty(globalThis,'document',{configurable:true,value:{createElement:()=>({width:0,height:0,getContext:()=>context})}});
  let world:WorldView|undefined,view:BattleView|undefined;
  try{world=new WorldView(scene,terrain,b.planes[0].sim.scenery);view=new BattleView(scene,b);view.update(0,1);const before=scene.children.length;
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
  try{for(let i=0;i<360/DT&&departed.size<7;i++){b.step();for(const p of b.planes.slice(1)){if(p.departure==='flying')departed.add(p.id);if(!departed.has(p.id))assert.equal(p.sim.crashed,false,`${p.id}: ${p.sim.crashCause}`);}}assert.equal(departed.size,7);}
  finally{world.dispose();if(old)Object.defineProperty(globalThis,'document',old);else Reflect.deleteProperty(globalThis,'document');}
});


void test('aircraft halos fade to a trace inside shooting range',()=>{
  assert.equal(haloStrength(650),.06);
  assert.equal(haloStrength(100),.06);
  assert.ok(haloStrength(1000)>.06);
  assert.ok(Math.abs(haloStrength(1600)-.6)<1e-12);
});
