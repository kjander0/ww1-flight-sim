import * as T from 'three';
import { AIRFIELDS, Terrain } from './terrain';
import { FlightSimulation, DT, clamp, optimalMixture, pitchInputForAlpha, type DamageComponent } from './simulation';
import { FORWARD_GUN_ELEVATION, MachineGun, MUZZLE_VELOCITY, REAR_AMMO_CAPACITY, REAR_GUN_MUZZLE_VELOCITY } from './weapons';
import { readAttitude } from './attitude';
import { SceneryCollisions } from './collisions';
import { parkingPosition, runwayAt } from './airfield-ops';
import { AIRCRAFT, type AircraftType } from './aircraft';

export type Team='ALLIED'|'CENTRAL';
export const opponent=(team:Team):Team=>team==='ALLIED'?'CENTRAL':'ALLIED';
export const RESPAWN_DELAY=8, BLAST_KILL_RADIUS=32;
export const FORWARD_GUN_DAMAGE=.18;
export const PLANES_PER_TEAM=6;
export const FUEL_RESTOCK_RATE=1, AMMO_RESTOCK_RATE=4;
export const REAR_GUN_AIM_ERROR=.0045;
export const TARGET_MEMORY_SECONDS=14, AI_SERVICE_SECONDS=12;
export const AI_STUCK_SECONDS=30, AI_STUCK_DISTANCE=8;
export const AI_ESCORT_CHANCE=.5, AI_ESCORT_ALTITUDE=190, AI_ESCORT_LATERAL=240, AI_ESCORT_TRAIL=170;
export type Building={id:string;team:Team;kind:'HANGAR'|'TOWER';position:T.Vector3;bounds:T.Box3;destroyed:boolean};
export type ParkedPlane={id:string;team:Team;type:AircraftType;position:T.Vector3;rotation:T.Quaternion;bounds:T.Box3;health:number;destroyed:boolean};
export type RecoveryStage='none'|'approach'|'final'|'rollout'|'taxi'|'service';
export type Plane={id:number;team:Team;sim:FlightSimulation;gun:MachineGun;secondary:MachineGun;rear:MachineGun;rearAim:T.Vector3;pilotLook:T.Vector3;previous:T.Vector3;rotation:T.Quaternion;generation:number;respawnQueued:boolean;respawnAt:number;mode:string;target:number;decision:number;cooldown:number;runTarget:string;runStage:'approach'|'pass'|'egress'|'dogleg';homeField:number;departure:'waiting'|'taxi'|'lineup'|'takeoff'|'climb'|'flying';escortTarget:number;escortConsidered:boolean;previousHealth:number;evasiveUntil:number;evasiveDirection:number;evasiveDive:number;evasiveTurnAt:number;emergencyField:number;emergencyDirection:-1|1;emergencyStage:'approach'|'final';lastSeenPosition:T.Vector3;lastSeenVelocity:T.Vector3;lastSeenAt:number;targetMemoryUntil:number;underFireUntil:number;sortieStartedAt:number;recoveryField:number;recoveryStage:RecoveryStage;serviceUntil:number;lastMovementPosition:T.Vector3;lastMovementAt:number;lastDamagedBy:number;lastDamagedAt:number;lastDamageGrounded:boolean;lastDamageEnemy:boolean};
export type Bomb={id:number;ownerId:number;team:Team;position:T.Vector3;previous:T.Vector3;velocity:T.Vector3;age:number};
export type Blast={id:number;position:T.Vector3;age:number};
export type EffectEvent={kind:'hit'|'damage'|'muzzle'|'crash'|'explosion';position:T.Vector3;velocity:T.Vector3;intensity:number;targetId?:number;cause?:string};
export type NotificationTone='positive'|'warning';
export type NotificationEvent={id:number;text:string;tone:NotificationTone};
export type BattleInfo={team:Team;counts:Record<Team,number>;bombs:number;ammo:number;health:number;components:Record<DamageComponent,number>;respawn:number;message:string;notifications:NotificationEvent[];flightKills:number;enemyBuildingsBombed:number;enemyAircraftStrafed:number;enemyAircraftKills:number;enemyAircraftBombed:number;contacts:{id:number;team:Team;x:number;z:number}[]};

export function createBuildings(terrain:Terrain):Building[]{return AIRFIELDS.flatMap((f,index)=>{
  const base=terrain.airfieldHeights[index];return [0,1,2,3].map(i=>{
    const tower=i===3,position=new T.Vector3(f.x+(tower?-95:-105),base,f.z+(tower?-140:240-i*78));
    const extent=new T.Vector3(tower?6.5:16.3,tower?20.3:19,tower?6:17.9);
    return{id:`${index}-${i}`,team:f.team,kind:tower?'TOWER':'HANGAR',position,bounds:new T.Box3(position.clone().sub(new T.Vector3(extent.x,0,extent.z)),position.clone().add(extent)),destroyed:false} as Building;
  });
});}
export function createParkedPlanes(terrain:Terrain):ParkedPlane[]{
  const placements:[[number,number],AircraftType][]=[[[132,-300],'scout'],[[148,-110],'fighter'],[[132,80],'bomber'],[[148,270],'fighter']];
  return AIRFIELDS.flatMap((field,fieldIndex)=>placements.map(([offset,type],slot)=>{
    const spec=AIRCRAFT[type],base=terrain.airfieldHeights[fieldIndex],position=new T.Vector3(field.x+offset[0],base+1.15,field.z+offset[1]);
    const rotation=new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),(slot%2?1:-1)*.055),extent=new T.Vector3(spec.span/2,1.7,4.6*spec.length);
    return{id:`parked-${fieldIndex}-${slot}`,team:field.team,type,position,rotation,bounds:new T.Box3(new T.Vector3(position.x-extent.x,base,position.z-extent.z),new T.Vector3(position.x+extent.x,position.y+extent.y,position.z+extent.z)),health:1,destroyed:false};
  }));
}
export function rackPosition(index:number,span:number){return new T.Vector3((index%2===0?-1:1)*span*(index<2?.22:.32),-.58,-1.4);}
export function segmentBox(a:T.Vector3,b:T.Vector3,box:T.Box3):number|null{
  let near=0,far=1;for(const axis of['x','y','z'] as const){const d=b[axis]-a[axis];if(Math.abs(d)<1e-10){if(a[axis]<box.min[axis]||a[axis]>box.max[axis])return null;}else{const t0=(box.min[axis]-a[axis])/d,t1=(box.max[axis]-a[axis])/d;near=Math.max(near,Math.min(t0,t1));far=Math.min(far,Math.max(t0,t1));if(near>far)return null;}}return near;
}
export function segmentSphere(a:T.Vector3,b:T.Vector3,radius:number):number|null{
  const d=b.clone().sub(a),c=a.lengthSq()-radius*radius;if(c<=0)return 0;const aa=d.lengthSq(),bb=a.dot(d),disc=bb*bb-aa*c;if(aa<1e-12||disc<0)return null;const t=(-bb-Math.sqrt(disc))/aa;return t>=0&&t<=1?t:null;
}
export function terrainHit(a:T.Vector3,b:T.Vector3,height:(x:number,z:number)=>number):number|null{
  const steps=Math.max(1,Math.ceil(a.distanceTo(b)/4));let last=0;
  for(let i=0;i<=steps;i++){const t=i/steps,x=a.x+(b.x-a.x)*t,z=a.z+(b.z-a.z)*t,y=a.y+(b.y-a.y)*t;if(y<=height(x,z)){let lo=last,hi=t;for(let k=0;k<10;k++){const m=(lo+hi)/2;if(a.y+(b.y-a.y)*m<=height(a.x+(b.x-a.x)*m,a.z+(b.z-a.z)*m))hi=m;else lo=m;}return hi;}last=t;}return null;
}
export function forwardGunDirection(orientation:T.Quaternion){
  return new T.Vector3(0,Math.sin(FORWARD_GUN_ELEVATION),-Math.cos(FORWARD_GUN_ELEVATION)).applyQuaternion(orientation);
}
/** A slow, overlapping scan of the rear hemisphere when there is no valid target. */
export function rearGunnerIdleDirection(time:number,planeId=0){
  const yaw=Math.sin(time*.43+planeId*1.71)*.78+Math.sin(time*.17+planeId*.63)*.18;
  const pitch=.2+Math.sin(time*.31+planeId*1.13)*.1;
  const cp=Math.cos(pitch);
  return new T.Vector3(Math.sin(yaw)*cp,Math.sin(pitch),Math.cos(yaw)*cp).normalize();
}
export function rearGunnerShotDirection(aim:T.Vector3,time:number,planeId=0){
  const direction=aim.clone().normalize(),helper=Math.abs(direction.y)<.9?new T.Vector3(0,1,0):new T.Vector3(1,0,0),right=new T.Vector3().crossVectors(direction,helper).normalize(),up=new T.Vector3().crossVectors(right,direction).normalize();
  const horizontal=(Math.sin(time*1.31+planeId*1.77)+Math.sin(time*.47+planeId*.83)*.35)*REAR_GUN_AIM_ERROR,vertical=(Math.cos(time*1.07+planeId*1.19)+Math.sin(time*.61+planeId*2.03)*.3)*REAR_GUN_AIM_ERROR;
  return direction.addScaledVector(right,horizontal).addScaledVector(up,vertical).normalize();
}
export function gunHitDamage(target:AircraftType,rear:boolean){return (target==='bomber'?1/8:FORWARD_GUN_DAMAGE)*(rear?.5:1);}
export function pilotScanDirection(time:number,planeId=0){
  const yaw=Math.sin(time*.29+planeId*1.37)*1.12+Math.sin(time*.11+planeId*.73)*.48;
  const pitch=Math.sin(time*.23+planeId*.91)*.22-.02,cp=Math.cos(pitch);
  return new T.Vector3(Math.sin(yaw)*cp,Math.sin(pitch),-Math.cos(yaw)*cp).normalize();
}
export function spottingChance(localDirection:T.Vector3,distance:number,scanDirection:T.Vector3){
  const direction=localDirection.clone().normalize();
  let chance=-direction.z>.55?.88:Math.abs(direction.x)>.45?.52:.2;
  if(direction.y<-.22)chance*=.55;
  if(scanDirection.dot(direction)>.9)chance+=.24;
  const range=clamp(1-Math.max(0,distance-500)/2700,.12,1);
  if(distance<320)chance=Math.max(chance,.82);
  return clamp(chance*range,.04,.98);
}
/** A loose high-energy station behind and to one side of a bomber. */
export function escortPosition(position:T.Vector3,orientation:T.Quaternion,escortId:number){
  const forward=new T.Vector3(0,0,-1).applyQuaternion(orientation);forward.y=0;if(forward.lengthSq()<1e-6)forward.set(0,0,-1);else forward.normalize();
  const right=new T.Vector3(-forward.z,0,forward.x),side=escortId%2===0?1:-1;
  return position.clone().addScaledVector(right,AI_ESCORT_LATERAL*side).addScaledVector(forward,-AI_ESCORT_TRAIL).setY(position.y+AI_ESCORT_ALTITUDE+(escortId%3)*30);
}
export function aircraftHitVolumes(span:number,length:number){
  const half=span/2;
  return [
    {component:'engine' as const,box:new T.Box3(new T.Vector3(-.85,-.75,-3.8),new T.Vector3(.85,.9,-1.2))},
    {component:'tail' as const,box:new T.Box3(new T.Vector3(-1.65,-.65,.65),new T.Vector3(1.65,1.25,4.65*length))},
    {component:'leftWing' as const,box:new T.Box3(new T.Vector3(-half,-.58,-2.3),new T.Vector3(-.18,1.78,-.48))},
    {component:'rightWing' as const,box:new T.Box3(new T.Vector3(.18,-.58,-2.3),new T.Vector3(half,1.78,-.48))},
    {component:'engine' as const,box:new T.Box3(new T.Vector3(-.72,-.7,-1.2),new T.Vector3(.72,.82,.65))},
  ];
}

/** Twelve fixed roster slots; the player's slot is never replaced by a thirteenth plane. */
export class Battle {
  planes:Plane[]=[];buildings:Building[];parkedPlanes:ParkedPlane[];bombs:Bomb[]=[];blasts:Blast[]=[];effects:EffectEvent[]=[];
  notifications:NotificationEvent[]=[];
  time=0;message='AIRSPACE ACTIVE';flightKills=0;enemyBuildingsBombed=0;enemyAircraftStrafed=0;enemyAircraftKills=0;enemyAircraftBombed=0;
  private serial=0;private notificationSerial=0;private lastFriendlyFire=-Infinity;
  private servicing=new Set<number>();private fuelRestocked=new Set<number>();private ammoRestocked=new Set<number>();
  private ammoRestockProgress=new Map<MachineGun,number>();
  private warningState={fuelLow:false,fuelEmpty:false,badMixture:false,overheating:false,overspeed:false,stall:false,seized:false,rightJammed:false,leftJammed:false};
  constructor(readonly terrain:Terrain,player:FlightSimulation,gun:MachineGun,public playerTeam:Team='ALLIED',private random:()=>number=Math.random,private scenery?:SceneryCollisions,secondaryGun=new MachineGun(random)){
    this.buildings=createBuildings(terrain);
    this.parkedPlanes=createParkedPlanes(terrain);
    if(scenery){for(const target of this.parkedPlanes)scenery.addBox('PARKED AIRCRAFT',target.bounds.min,target.bounds.max);scenery.isEnabled=(kind,bounds)=>!(((kind==='HANGAR'||kind==='TOWER')&&this.buildings.some(b=>b.destroyed&&b.bounds.intersectsBox(bounds)))||(kind==='PARKED AIRCRAFT'&&this.parkedPlanes.some(p=>p.destroyed&&p.bounds.intersectsBox(bounds))));}
    for(let id=0;id<PLANES_PER_TEAM*2;id++){
      const team=id<PLANES_PER_TEAM?playerTeam:opponent(playerTeam),sim=id===0?player:new FlightSimulation();
      if(id!==0){sim.aircraftType=id%4===3?'bomber':id%2===0?'fighter':'scout';sim.groundHeightAt=terrain.heightAt;sim.isWaterAt=(x,z)=>terrain.isWater(x,z);}
      const fields=AIRFIELDS.map((f,i)=>f.team===team?i:-1).filter(i=>i>=0);
      const p:Plane={id,team,sim,gun:id===0?gun:new MachineGun(random),secondary:id===0?secondaryGun:new MachineGun(random),rear:new MachineGun(random,REAR_GUN_MUZZLE_VELOCITY,REAR_AMMO_CAPACITY),rearAim:rearGunnerIdleDirection(0,id),pilotLook:pilotScanDirection(0,id),previous:sim.position.clone(),rotation:sim.orientation.clone(),generation:0,respawnQueued:false,respawnAt:0,mode:'PATROL',target:-1,decision:0,cooldown:0,runTarget:'',runStage:'approach',homeField:fields[id%2],departure:'waiting',escortTarget:-1,escortConsidered:false,previousHealth:1,evasiveUntil:0,evasiveDirection:1,evasiveDive:.5,evasiveTurnAt:0,emergencyField:-1,emergencyDirection:1,emergencyStage:'approach',lastSeenPosition:new T.Vector3(),lastSeenVelocity:new T.Vector3(),lastSeenAt:0,targetMemoryUntil:0,underFireUntil:0,sortieStartedAt:0,recoveryField:-1,recoveryStage:'none',serviceUntil:0,lastMovementPosition:sim.position.clone(),lastMovementAt:0,lastDamagedBy:-1,lastDamagedAt:-Infinity,lastDamageGrounded:false,lastDamageEnemy:false};
      this.planes.push(p);if(id!==0)this.spawn(p);
    }
  }
  surface=(x:number,z:number)=>this.terrain.isWater(x,z)?5:this.terrain.heightAt(x,z);
  private spawn(p:Plane){
    const position=parkingPosition(this.terrain,p.homeField,p.id%PLANES_PER_TEAM);
    if(this.planes.some(other=>other!==p&&!other.sim.crashed&&other.sim.position.distanceTo(position)<24)){p.respawnAt=this.time+2;return;}
    p.sim.spawn.copy(position);
    const s=p.sim;s.reset();p.gun.reset();p.secondary.reset();p.rear.reset();p.gun.cock();p.secondary.cock();p.rear.cock();p.respawnQueued=false;p.generation++;p.target=-1;p.cooldown=0;p.runTarget='';p.runStage='approach';
    p.departure='waiting';p.mode='WAITING FOR RUNWAY';p.escortTarget=-1;p.escortConsidered=false;p.rearAim.copy(rearGunnerIdleDirection(this.time,p.id));p.pilotLook.copy(pilotScanDirection(this.time,p.id));p.previous.copy(s.position);p.rotation.copy(s.orientation);p.previousHealth=1;p.evasiveUntil=0;p.evasiveTurnAt=0;p.emergencyField=-1;p.emergencyStage='approach';p.lastSeenPosition.set(0,0,0);p.lastSeenVelocity.set(0,0,0);p.lastSeenAt=0;p.targetMemoryUntil=0;p.underFireUntil=0;p.sortieStartedAt=this.time;p.recoveryField=-1;p.recoveryStage='none';p.serviceUntil=0;p.lastMovementPosition.copy(s.position);p.lastMovementAt=this.time;p.lastDamagedBy=-1;p.lastDamagedAt=-Infinity;p.lastDamageGrounded=false;p.lastDamageEnemy=false;
  }
  info():BattleInfo{return{team:this.playerTeam,counts:{ALLIED:this.planes.filter(p=>p.team==='ALLIED'&&!p.sim.crashed).length,CENTRAL:this.planes.filter(p=>p.team==='CENTRAL'&&!p.sim.crashed).length},bombs:this.planes[0].sim.bombsRemaining,ammo:this.planes[0].gun.roundsRemaining,health:this.planes[0].sim.airframeHealth,components:{...this.planes[0].sim.componentHealth},respawn:Math.max(0,this.planes[0].respawnAt-this.time),message:this.message,notifications:[...this.notifications],flightKills:this.flightKills,enemyBuildingsBombed:this.enemyBuildingsBombed,enemyAircraftStrafed:this.enemyAircraftStrafed,enemyAircraftKills:this.enemyAircraftKills,enemyAircraftBombed:this.enemyAircraftBombed,contacts:this.planes.filter(p=>!p.sim.crashed).map(p=>({id:p.id,team:p.team,x:p.sim.position.x,z:p.sim.position.z}))};}
  setPlayerTeam(team:Team){this.playerTeam=team;this.planes[0].team=team;}
  beginPlayerFlight(){this.flightKills=0;}
  respawnPlayer(){const p=this.planes[0];if(!p.sim.crashed||!p.respawnQueued||this.time<p.respawnAt)return false;if(this.planes.slice(1).some(o=>!o.sim.crashed&&o.sim.position.distanceTo(p.sim.spawn)<24))return false;p.sim.reset();p.gun.reset();p.secondary.reset();p.rear.reset();p.respawnQueued=false;p.generation++;p.previous.copy(p.sim.position);p.rotation.copy(p.sim.orientation);p.emergencyField=-1;return true;}
  retirePlayer(cause='ABANDONED AIRCRAFT'){
    const p=this.planes[0];if(!p.sim.crashed)p.sim.crash(cause);this.recordCrashes();return true;
  }
  release(p=this.planes[0]){
    const s=p.sim;if(s.crashed||s.grounded||s.bombsRemaining<=0||p.cooldown>0)return false;
    const index=s.spec.bombs-s.bombsRemaining,position=rackPosition(index,s.spec.span).applyQuaternion(s.orientation).add(s.position);
    this.bombs.push({id:++this.serial,ownerId:p.id,team:p.team,position,previous:position.clone(),velocity:s.velocity.clone().add(new T.Vector3(0,-1,0)),age:0});s.bombsRemaining--;p.cooldown=.3;return true;
  }
  private recordCrashes(){for(const p of this.planes)if(p.sim.crashed&&!p.respawnQueued){p.respawnQueued=true;p.respawnAt=this.time+RESPAWN_DELAY;if(p.lastDamagedBy===0&&p.lastDamageEnemy&&this.time-p.lastDamagedAt<30&&!['BOMB BLAST','MID-AIR COLLISION'].includes(p.sim.crashCause)){if(p.lastDamageGrounded){this.enemyAircraftStrafed++;this.recordKill('Ground aircraft destroyed');}else{this.enemyAircraftKills++;this.recordKill('Enemy aircraft destroyed');}}p.lastDamagedBy=-1;if(p.sim.crashCause!=='ABANDONED AIRCRAFT')this.pushEffect({kind:'crash',position:p.sim.position.clone(),velocity:p.sim.impactVelocity.clone(),intensity:clamp(p.sim.impactSpeed/45,.35,1.4),targetId:p.id,cause:p.sim.crashCause});}}
  step(dt=DT){
    this.time+=dt;
    for(const p of this.planes){p.cooldown=Math.max(0,p.cooldown-dt);if(p.sim.crashed&&p.id!==0&&p.respawnQueued&&this.time>=p.respawnAt)this.spawn(p);p.previous.copy(p.sim.position);p.rotation.copy(p.sim.orientation);if(p.id!==0&&!p.sim.crashed)this.flyAI(p,dt);this.scenery?.setAircraftScale(p.sim.spec.span/8.8,p.sim.spec.length);p.sim.step(dt);
      if(p.id!==0&&!p.sim.crashed&&this.scenery){const hit=this.scenery.sweep(p.previous,p.sim.position,p.rotation,p.sim.orientation);if(hit){p.sim.position.lerpVectors(p.previous,p.sim.position,hit.time);p.sim.crash(hit.kind);}}
      if(p.id!==0&&!p.sim.crashed)this.monitorAIStuck(p);
      if(Math.max(Math.abs(p.sim.position.x),Math.abs(p.sim.position.z))>5700)p.sim.crash('LEFT BATTLE');}
    for(const p of this.planes){this.stepGun(p,p.gun,false,dt,.34);if(p.sim.aircraftType==='fighter')this.stepGun(p,p.secondary,false,dt,-.34);if(p.sim.aircraftType==='bomber')this.stepGun(p,p.rear,true,dt);}
    for(let i=0;i<this.planes.length;i++)for(let j=i+1;j<this.planes.length;j++){const a=this.planes[i],b=this.planes[j];if(a.sim.crashed||b.sim.crashed)continue;if(segmentSphere(a.previous.clone().sub(b.previous),a.sim.position.clone().sub(b.sim.position),2)!==null){a.sim.crash('MID-AIR COLLISION');b.sim.crash('MID-AIR COLLISION');}}
    for(let i=this.bombs.length-1;i>=0;i--){const b=this.bombs[i];b.previous.copy(b.position);b.velocity.multiplyScalar(Math.exp(-.012*dt));b.velocity.y-=9.81*dt;b.position.addScaledVector(b.velocity,dt);b.age+=dt;
      let hit=terrainHit(b.previous,b.position,this.surface);for(const building of this.buildings)if(!building.destroyed){const t=segmentBox(b.previous,b.position,building.bounds);if(t!==null&&(hit===null||t<hit))hit=t;}
      for(const target of this.parkedPlanes)if(!target.destroyed){const t=segmentBox(b.previous,b.position,target.bounds);if(t!==null&&(hit===null||t<hit))hit=t;}
      if(hit!==null){b.position.lerpVectors(b.previous,b.position,hit);this.explode(b);this.bombs.splice(i,1);}else if(b.age>90)this.bombs.splice(i,1);
    }
    for(const p of this.planes)this.restock(p,dt);
    for(const blast of this.blasts)blast.age+=dt;this.blasts=this.blasts.filter(b=>b.age<5);
    this.recordCrashes();
    this.monitorPlayer();
  }
  private explode(b:Bomb){
    this.blasts.push({id:++this.serial,position:b.position.clone(),age:0});if(this.blasts.length>32)this.blasts.shift();
    this.pushEffect({kind:'explosion',position:b.position.clone(),velocity:b.velocity.clone(),intensity:1});
    for(const building of this.buildings){if(building.destroyed)continue;if(building.bounds.distanceToPoint(b.position)<=22){building.destroyed=true;if(b.ownerId===0){if(building.team!==b.team){this.enemyBuildingsBombed++;this.notify('Building destroyed','positive');}else this.noteFriendlyFire();}this.message=`${building.kind} DESTROYED`;}}
    for(const target of this.parkedPlanes)if(!target.destroyed&&target.bounds.distanceToPoint(b.position)<BLAST_KILL_RADIUS)this.destroyParked(target,b.team,'BOMBED',b.ownerId);
    for(const p of this.planes)if(!p.sim.crashed&&p.sim.position.distanceTo(b.position)<BLAST_KILL_RADIUS){if(b.ownerId===0&&p.id!==0){if(p.team!==b.team){this.enemyAircraftBombed++;this.recordKill('Enemy aircraft destroyed');}else this.noteFriendlyFire();}p.sim.crash('BOMB BLAST');}
  }
  private destroyParked(target:ParkedPlane,attacker:Team,reason:string,ownerId=-1){
    if(target.destroyed)return;target.destroyed=true;target.health=0;if(ownerId===0){if(attacker!==target.team){if(reason==='DESTROYED')this.enemyAircraftStrafed++;this.recordKill('Ground aircraft destroyed');}else this.noteFriendlyFire();}this.pushEffect({kind:'explosion',position:target.position.clone(),velocity:new T.Vector3(),intensity:.65});this.message=`PARKED AIRCRAFT ${reason}`;
  }
  private bulletHit(shooter:Plane,from:T.Vector3,to:T.Vector3,rear=false){
    let first=terrainHit(from,to,this.surface),victim:Plane|undefined,victimComponent:DamageComponent|undefined,parkedVictim:ParkedPlane|undefined;
    for(const building of this.buildings){const box=building.bounds.clone();if(building.destroyed)box.max.y=box.min.y+1.5;const t=segmentBox(from,to,box);if(t!==null&&(first===null||t<first)){first=t;victim=undefined;parkedVictim=undefined;}}
    for(const target of this.parkedPlanes){const box=target.bounds.clone();if(target.destroyed)box.max.y=box.min.y+.65;const t=segmentBox(from,to,box);if(t!==null&&(first===null||t<first)){first=t;victim=undefined;parkedVictim=target.destroyed?undefined:target;}}
    for(const p of this.planes){if(p===shooter||p.sim.crashed)continue;
      const inv=p.sim.orientation.clone().invert(),a=from.clone().sub(p.previous).applyQuaternion(inv),b=to.clone().sub(p.sim.position).applyQuaternion(inv);
      for(const hitbox of aircraftHitVolumes(p.sim.spec.span,p.sim.spec.length)){if(p.sim.detachedComponents.has(hitbox.component))continue;const t=segmentBox(a,b,hitbox.box);if(t!==null&&(first===null||t<first)){first=t;victim=p;victimComponent=hitbox.component;parkedVictim=undefined;}}
    }
    if(victim&&victimComponent&&first!==null){const wasGrounded=victim.sim.grounded,damage=gunHitDamage(victim.sim.aircraftType,rear),detached=victim.sim.damageComponent(victimComponent,damage);if(victim.team!==shooter.team){victim.target=shooter.id;victim.lastSeenPosition.copy(shooter.sim.position);victim.lastSeenVelocity.copy(shooter.sim.velocity);victim.lastSeenAt=this.time;victim.targetMemoryUntil=this.time+TARGET_MEMORY_SECONDS;victim.underFireUntil=this.time+12;victim.decision=.15;}if(shooter.id===0){victim.lastDamagedBy=0;victim.lastDamagedAt=this.time;victim.lastDamageGrounded=wasGrounded;victim.lastDamageEnemy=victim.team!==shooter.team;if(!victim.lastDamageEnemy)this.noteFriendlyFire();}if((victimComponent==='engine'||victimComponent==='tail')&&this.random()<.1){victim.sim.fuelLeaks++;if(victim.id===0)this.notify(victim.sim.fuelLeaks===1?'Fuel leak':`Fuel leaks ×${victim.sim.fuelLeaks}`,'warning');}if(detached){const label=victimComponent==='leftWing'?'Left wing':victimComponent==='rightWing'?'Right wing':victimComponent==='tail'?'Tail':'Engine';this.message=`${label.toUpperCase()} LOST`;if(victim.id===0)this.notify(`${label} torn away`,'warning');}this.pushEffect({kind:'damage',position:from.clone().lerp(to,first),velocity:victim.sim.velocity.clone(),intensity:detached?1.25:.8,targetId:victim.id});}
    else if(parkedVictim&&first!==null){if(shooter.id===0&&parkedVictim.team===shooter.team)this.noteFriendlyFire();parkedVictim.health-=gunHitDamage(parkedVictim.type,rear);this.pushEffect({kind:'damage',position:from.clone().lerp(to,first),velocity:new T.Vector3(),intensity:.8});if(parkedVictim.health<=0)this.destroyParked(parkedVictim,shooter.team,'DESTROYED',shooter.id);}
    return first;
  }
  private notify(text:string,tone:NotificationTone){
    this.notifications.push({id:++this.notificationSerial,text,tone});if(this.notifications.length>32)this.notifications.shift();
  }
  private recordKill(label:string){this.flightKills++;this.notify(`${label} · Kills ${this.flightKills}`,'positive');}
  private noteFriendlyFire(){if(this.time-this.lastFriendlyFire<4)return;this.lastFriendlyFire=this.time;this.notify('Friendly fire','warning');}
  private restock(p:Plane,dt:number){
    if(p.id!==0&&p.recoveryStage==='service'){
      if(p.serviceUntil<=0)p.serviceUntil=this.time+AI_SERVICE_SECONDS;
      if(this.time>=p.serviceUntil){const s=p.sim;s.service();for(const gun of[p.gun,p.secondary,p.rear]){gun.reset();gun.cock();}p.homeField=p.recoveryField;p.recoveryField=-1;p.recoveryStage='none';p.emergencyField=-1;p.departure='waiting';p.escortTarget=-1;p.escortConsidered=false;p.sortieStartedAt=this.time;p.serviceUntil=0;p.generation++;p.previousHealth=1;p.mode='SERVICED · WAITING FOR RUNWAY';}
      return;
    }
    const field=runwayAt(p.sim),friendly=field>=0&&AIRFIELDS[field].team===p.team;
    if(!friendly){this.servicing.delete(p.id);this.fuelRestocked.delete(p.id);this.ammoRestocked.delete(p.id);return;}
    const s=p.sim,guns=[p.gun,...(s.aircraftType==='fighter'?[p.secondary]:[]),...(s.aircraftType==='bomber'?[p.rear]:[])];
    const needsFuel=s.fuel<s.spec.fuel-.001,needsAmmo=guns.some(g=>g.roundsRemaining<g.capacity);
    if((needsFuel||needsAmmo)&&!this.servicing.has(p.id)){this.servicing.add(p.id);if(p.id===0)this.notify('Resupplying','positive');}
    const beforeFuel=s.fuel;s.fuel=Math.min(s.spec.fuel,s.fuel+FUEL_RESTOCK_RATE*dt);
    if(beforeFuel<s.spec.fuel-.001&&s.fuel>=s.spec.fuel-.001&&!this.fuelRestocked.has(p.id)){this.fuelRestocked.add(p.id);if(p.id===0)this.notify('Fuel replenished','positive');}
    const hadMissingAmmo=needsAmmo;
    for(const gun of guns)if(gun.roundsRemaining<gun.capacity){const progress=(this.ammoRestockProgress.get(gun)??0)+AMMO_RESTOCK_RATE*dt,rounds=Math.floor(progress+1e-9);this.ammoRestockProgress.set(gun,progress-rounds);if(rounds>0)gun.roundsRemaining=Math.min(gun.capacity,gun.roundsRemaining+rounds);}
    if(hadMissingAmmo&&guns.every(g=>g.roundsRemaining>=g.capacity)&&!this.ammoRestocked.has(p.id)){this.ammoRestocked.add(p.id);if(p.id===0)this.notify('Ammunition replenished','positive');}
  }
  private monitorPlayer(){
    const p=this.planes[0],s=p.sim,w=this.warningState;if(s.crashed){for(const key of Object.keys(w) as (keyof typeof w)[])w[key]=false;return;}
    const warn=(condition:boolean,key:keyof typeof w,text:string,resetCondition=!condition)=>{if(condition&&!w[key]){w[key]=true;this.notify(text,'warning');}else if(resetCondition)w[key]=false;};
    const empty=s.fuel<=0;warn(empty,'fuelEmpty','Fuel empty',s.fuel>s.spec.fuel*.05);
    warn(s.fuel>0&&s.fuel<=s.spec.fuel*.2,'fuelLow','Fuel low',s.fuel>s.spec.fuel*.3);
    warn(s.engine==='running'&&s.mixtureEfficiency<.55,'badMixture','Bad mixture',s.engine!=='running'||s.mixtureEfficiency>.62);
    warn(s.temperature>110,'overheating','Engine overheating',s.temperature<105);
    warn(s.engine==='running'&&s.rpm>2100,'overspeed','Engine overspeed',s.rpm<2050);
    warn(s.stall,'stall','Stall');
    warn(s.engine==='seized','seized','Engine seized');
    warn(p.gun.jammed,'rightJammed',s.aircraftType==='fighter'?'Right gun jammed':'Gun jammed');
    warn(s.aircraftType==='fighter'&&p.secondary.jammed,'leftJammed','Left gun jammed');
  }
  private monitorAIStuck(p:Plane){
    // Queued and serviced aircraft are deliberately stationary. Every other AI
    // state is expected to make progress, including taxiing and landing rollout.
    if(p.departure==='waiting'||p.recoveryStage==='service'){
      p.lastMovementPosition.copy(p.sim.position);p.lastMovementAt=this.time;return;
    }
    if(p.sim.position.distanceToSquared(p.lastMovementPosition)>=AI_STUCK_DISTANCE*AI_STUCK_DISTANCE){
      p.lastMovementPosition.copy(p.sim.position);p.lastMovementAt=this.time;return;
    }
    if(this.time-p.lastMovementAt>=AI_STUCK_SECONDS)p.sim.crash('AI STUCK');
  }
  private stepGun(p:Plane,gun:MachineGun,rear:boolean,dt:number,lateral=.34){
    const s=p.sim;const direction=forwardGunDirection(s.orientation),muzzle=new T.Vector3(lateral,.505,-3.6).applyQuaternion(s.orientation).add(s.position);
    if(rear){gun.trigger=false;p.rearAim.copy(rearGunnerIdleDirection(this.time,p.id));
      const pivot=new T.Vector3(.22,.48,2.45).applyQuaternion(s.orientation).add(s.position);
      const target=this.planes.filter(e=>e.team!==p.team&&!e.sim.crashed).sort((a,b)=>a.sim.position.distanceToSquared(s.position)-b.sim.position.distanceToSquared(s.position)).find(e=>{const delta=e.sim.position.clone().sub(pivot),dist=delta.length(),local=delta.applyQuaternion(s.orientation.clone().invert());if(dist>=450||local.z<=40||Math.abs(local.x)>=local.z*1.5||local.y<=Math.max(8,local.z*.06)||local.y>=local.z)return false;return e.id===p.target||dist<180||this.random()<dt*1.35;});
      if(target){const delta=target.sim.position.clone().sub(pivot),dist=delta.length();
        direction.copy(delta).addScaledVector(target.sim.velocity.clone().sub(s.velocity),dist/REAR_GUN_MUZZLE_VELOCITY).normalize();p.rearAim.copy(direction).applyQuaternion(s.orientation.clone().invert()).normalize();gun.trigger=gun.heat<.55&&this.time%2.5<1.2;
      }
      direction.copy(rearGunnerShotDirection(p.rearAim,this.time,p.id)).applyQuaternion(s.orientation).normalize();
      muzzle.copy(pivot).addScaledVector(direction,1.05);
      if((gun.jammed||!gun.cocked)&&this.time%4<dt)gun.cock();
    }
    if(gun.trigger&&(p.id!==0||rear)){
      // AI holds fire when a friendly crosses its firing lane.
      const end=muzzle.clone().addScaledVector(direction,rear?450:650);
      for(const friend of this.planes)if(friend!==p&&friend.team===p.team&&!friend.sim.crashed){if(segmentSphere(muzzle.clone().sub(friend.sim.position),end.clone().sub(friend.sim.position),6)!==null){gun.trigger=false;break;}}
    }
    if(s.crashed)gun.trigger=false;
    const roundsBefore=gun.roundsFired;
    gun.step(dt,{muzzle,direction,aircraftVelocity:s.velocity,groundHeightAt:this.surface,sweep:(a,b)=>this.bulletHit(p,a,b,rear)});
    const fired=gun.roundsFired-roundsBefore;if(fired>0)this.pushEffect({kind:'muzzle',position:muzzle.clone(),velocity:direction.clone(),intensity:Math.min(1,fired*.7),targetId:p.id});
    for(const impact of gun.consumeImpacts())this.pushEffect({kind:'hit',position:impact.position,velocity:impact.velocity,intensity:impact.tracer?.8:.5});
  }
  consumeEffects(){return this.effects.splice(0);}
  private pushEffect(effect:EffectEvent){this.effects.push(effect);if(this.effects.length>128)this.effects.shift();}
  private updatePerception(p:Plane,dt:number){
    p.decision-=dt;
    if(p.decision<=0){
      p.decision=.65+this.random()*.55;
      const s=p.sim,inverse=s.orientation.clone().invert(),scan=pilotScanDirection(this.time,p.id),candidates=this.planes.filter(e=>e.team!==p.team&&!e.sim.crashed).sort((a,b)=>a.sim.position.distanceToSquared(s.position)-b.sim.position.distanceToSquared(s.position));
      let spotted:Plane|undefined;
      for(const candidate of candidates){const delta=candidate.sim.position.clone().sub(s.position),distance=delta.length();if(distance>3200)continue;const local=delta.applyQuaternion(inverse),base=spottingChance(local,distance,scan),engaged=candidate.id===p.target&&this.time<p.targetMemoryUntil;const chance=clamp(base+(engaged?.18:0)+(this.time<p.underFireUntil&&engaged?.25:0),0,.995);if(this.random()<chance){spotted=candidate;break;}}
      if(spotted){p.target=spotted.id;p.lastSeenPosition.copy(spotted.sim.position);p.lastSeenVelocity.copy(spotted.sim.velocity);p.lastSeenAt=this.time;p.targetMemoryUntil=this.time+TARGET_MEMORY_SECONDS;}
      else if(this.time>=p.targetMemoryUntil)p.target=-1;
    }
    const remembered=this.time<p.targetMemoryUntil&&p.target>=0;
    const look=remembered?p.lastSeenPosition.clone().sub(p.sim.position).applyQuaternion(p.sim.orientation.clone().invert()).normalize():pilotScanDirection(this.time,p.id);
    p.pilotLook.lerp(look,Math.min(1,dt*(remembered?4:1.8))).normalize();
  }
  private shouldRecover(p:Plane){
    const s=p.sim,forwardGuns=[p.gun,...(s.aircraftType==='fighter'?[p.secondary]:[])],lowAmmo=forwardGuns.every(g=>g.roundsRemaining<g.capacity*.16),structural=Math.min(s.componentHealth.leftWing,s.componentHealth.rightWing,s.componentHealth.tail,s.componentHealth.engine)<.42;
    return s.fuel<s.spec.fuel*.28||lowAmmo||(s.aircraftType==='bomber'&&s.bombsRemaining===0&&this.time-p.sortieStartedAt>45)||structural||this.time-p.sortieStartedAt>260+p.id*17;
  }
  private beginRecovery(p:Plane,emergency=false){
    const fields=AIRFIELDS.map((f,i)=>({f,i})).filter(({f})=>f.team===p.team).sort((a,b)=>Math.hypot(p.sim.position.x-a.f.x,p.sim.position.z-a.f.z)-Math.hypot(p.sim.position.x-b.f.x,p.sim.position.z-b.f.z));
    p.recoveryField=fields[0].i;p.recoveryStage='approach';p.emergencyField=p.recoveryField;p.emergencyDirection=1;p.emergencyStage='approach';p.target=-1;p.targetMemoryUntil=0;p.serviceUntil=0;if(emergency)p.underFireUntil=0;
  }
  private escortBomber(p:Plane){
    if(p.sim.aircraftType==='bomber')return undefined;
    const assigned=this.planes[p.escortTarget];
    if(assigned&&assigned.team===p.team&&assigned.sim.aircraftType==='bomber'&&!assigned.sim.crashed)return assigned;
    if(p.escortTarget>=0){p.escortTarget=-1;p.escortConsidered=false;}
    if(p.escortConsidered)return undefined;
    const bombers=this.planes.filter(candidate=>candidate!==p&&candidate.team===p.team&&candidate.sim.aircraftType==='bomber'&&!candidate.sim.crashed&&(candidate.id!==0||!candidate.sim.grounded));
    if(!bombers.length)return undefined;
    p.escortConsidered=true;
    if(this.random()>=AI_ESCORT_CHANCE)return undefined;
    const bomber=bombers.sort((a,b)=>a.sim.position.distanceToSquared(p.sim.position)-b.sim.position.distanceToSquared(p.sim.position))[0];
    p.escortTarget=bomber.id;return bomber;
  }
  private flyAI(p:Plane,dt:number){
    const s=p.sim,c=s.controls,a=readAttitude(s.orientation),forward=new T.Vector3(0,0,-1).applyQuaternion(s.orientation);
    if((s.fuel<=0||s.componentHealth.engine<=0)&&p.recoveryStage==='none')this.beginRecovery(p,true);
    if(p.recoveryStage!=='none'){this.landAI(p);return;}
    c.ignition=true;c.brake=false;c.mixture=optimalMixture(s.position.y);c.radiator=s.temperature>95?.9:.45;c.throttle=1;
    if(p.departure!=='flying'){this.departAI(p);return;}
    this.updatePerception(p,dt);
    if(this.shouldRecover(p)&&this.time>=p.underFireUntil){this.beginRecovery(p);this.landAI(p);return;}
    if(s.airframeHealth<p.previousHealth-.001&&(this.time<p.evasiveUntil||this.random()<.68)){p.evasiveUntil=this.time+15+this.random()*10;p.evasiveDirection=this.random()<.5?-1:1;p.evasiveDive=.35+this.random()*.65;p.evasiveTurnAt=this.time+1+this.random()*3;p.decision=.35;}p.previousHealth=s.airframeHealth;
    for(const gun of[p.gun,...(s.aircraftType==='fighter'?[p.secondary]:[])]){if((gun.jammed||!gun.cocked)&&this.time%3<dt)gun.cock();gun.trigger=false;}
    const goal=new T.Vector3(0,500,0);let desiredSpeed=42,aimPitch:number|undefined;p.mode='INTERCEPT';
    const buildings=this.buildings.filter(b=>b.team!==p.team&&!b.destroyed);
    if(s.aircraftType==='bomber'&&s.bombsRemaining>0&&buildings.length){
      let b=this.buildings.find(b=>b.id===p.runTarget);
      if(!b||(b.destroyed&&p.runStage==='approach')){b=buildings.sort((a,b)=>a.position.distanceToSquared(s.position)-b.position.distanceToSquared(s.position))[0];p.runTarget=b.id;p.runStage='approach';}
      const direction=p.team==='ALLIED'?1:-1;goal.copy(b.position);goal.y+=240;desiredSpeed=39;p.mode='BOMB RUN';
      if(p.runStage==='dogleg'){goal.x-=direction*1600;goal.z+=1000;if(Math.hypot(s.position.x-goal.x,s.position.z-goal.z)<220)p.runStage='approach';}
      else if(p.runStage==='approach'){goal.x-=direction*1100;if(Math.hypot(s.position.x-goal.x,s.position.z-goal.z)<180)p.runStage='pass';}
      else{goal.x+=direction*1100;
        const vy=s.velocity.y,fall=(vy+Math.sqrt(vy*vy+2*9.81*Math.max(1,s.position.y-b.bounds.max.y)))/9.81,impact=s.position.clone().addScaledVector(s.velocity,(1-Math.exp(-.012*fall))/.012);
        if(p.runStage==='pass'&&Math.hypot(impact.x-b.position.x,impact.z-b.position.z)<22&&Math.abs(a.roll)<.25&&Math.abs(a.pitch)<.25&&this.release(p))p.runStage='egress';
        if((s.position.x-b.position.x)*direction>900){p.runTarget=buildings.find(t=>!t.destroyed)?.id??'';p.runStage='dogleg';}
      }
    }else{
      const target=this.planes[p.target],remembered=target&&!target.sim.crashed&&this.time<p.targetMemoryUntil;if(remembered){const age=Math.min(4,this.time-p.lastSeenAt),known=p.lastSeenPosition.clone().addScaledVector(p.lastSeenVelocity,age),delta=known.clone().sub(s.position),distance=delta.length();goal.copy(known);
        const fresh=this.time-p.lastSeenAt<1.35,aim=delta.clone().addScaledVector(fresh?target.sim.velocity.clone().sub(s.velocity):p.lastSeenVelocity.clone().sub(s.velocity),distance/MUZZLE_VELOCITY);aim.y+=.5*9.81*(distance/MUZZLE_VELOCITY)**2;
        if(distance<950&&s.position.y>this.surface(s.position.x,s.position.z)+170){goal.copy(s.position).add(aim);aimPitch=Math.atan2(aim.y,Math.hypot(aim.x,aim.z))-FORWARD_GUN_ELEVATION;}
        if(fresh&&distance<650&&forward.dot(aim.normalize())>.997)for(const gun of[p.gun,...(s.aircraftType==='fighter'?[p.secondary]:[])])if(gun.heat<.6)gun.trigger=this.time%2<.9;
        if(distance<140&&forward.dot(delta.clone().normalize())<-.7&&s.airspeed>34){desiredSpeed=30;p.mode='FORCE OVERSHOOT';}
        else if(s.position.y>target.sim.position.y+100){p.mode='DIVING ATTACK';}
        else if(distance<800){p.mode='TURN FIGHT';}
        else p.mode=fresh?'INTERCEPT':'SEARCH LAST CONTACT';
      }else{
        const bomber=this.escortBomber(p);
        if(bomber){const station=escortPosition(bomber.sim.position,bomber.sim.orientation,p.id),distance=s.position.distanceTo(station);goal.copy(station);desiredSpeed=clamp(bomber.sim.airspeed+4+(distance-300)*.018,36,56);p.mode='ESCORT BOMBER';}
        else p.mode='PATROL / SCANNING';
      }
    }
    if(this.time<p.evasiveUntil){
      const right=new T.Vector3(1,0,0).applyQuaternion(s.orientation),up=new T.Vector3(0,1,0);
      if(this.time>=p.evasiveTurnAt){p.evasiveDirection*=-1;p.evasiveDive=.35+this.random()*.65;p.evasiveTurnAt=this.time+1+this.random()*3;}
      const clearance=s.position.y-this.surface(s.position.x,s.position.z),diving=clearance>230;
      goal.copy(s.position).addScaledVector(forward,430).addScaledVector(right,440*p.evasiveDirection).addScaledVector(up,diving?-Math.min(90+150*p.evasiveDive,clearance*.45):95+55*Math.sin(this.time*4+p.id));
      desiredSpeed=diving?58:50;p.mode=diving?'EVASIVE DIVE':'EVASIVE BREAK';p.gun.trigger=false;p.secondary.trigger=false;
    }
    // Look ahead at terrain before choosing bank/pitch. Keep low-speed recovery coordinated.
    const floor=Math.max(this.surface(s.position.x,s.position.z),this.surface(s.position.x+forward.x*300,s.position.z+forward.z*300))+95;
    goal.y=Math.max(floor,goal.y);
    if(Math.max(Math.abs(s.position.x),Math.abs(s.position.z))>4300){goal.set(0,Math.max(floor,500),0);p.mode='RETURN';}
    for(const other of this.planes)if(other!==p&&!other.sim.crashed&&other.sim.position.distanceTo(s.position)<65){goal.y+=70+(p.id%2)*40;p.mode='SEPARATE';}
    const delta=goal.clone().sub(s.position),heading=Math.atan2(-forward.x,-forward.z),desiredHeading=Math.atan2(-delta.x,-delta.z),error=Math.atan2(Math.sin(desiredHeading-heading),Math.cos(desiredHeading-heading));
    const maxBank=s.aircraftType==='bomber'?.45:.68;
    let bank=clamp(error*1.3,-maxBank,maxBank);if(s.airspeed<32)bank=clamp(bank,-.3,.3);
    c.roll=clamp((a.roll-bank)*2.8+s.rates.z*1.3,-1,1);
    const flightAngle=Math.atan2(s.velocity.y,Math.hypot(s.velocity.x,s.velocity.z));
    const desiredClimb=clamp((goal.y-s.position.y)*.022,-5,5);
    const desiredAngle=clamp(Math.asin(clamp(desiredClimb/Math.max(25,s.airspeed),-.3,.3)),-.16,.16);
    const density=1.225*Math.exp(-s.position.y/8500),neededCl=s.mass*9.81/(.5*density*Math.max(24,s.airspeed)**2*s.spec.wingArea*Math.max(.65,Math.cos(a.roll)));
    let alpha=clamp((neededCl-.24)/4.7+(desiredAngle-flightAngle)*.8,.015,.21);
    if(s.airspeed<28||s.stall){alpha=.06;c.roll=clamp(a.roll*3,-1,1);p.mode='RECOVER';}
    if(aimPitch!==undefined)alpha=clamp(aimPitch-flightAngle,-.04,.22);
    c.pitch=pitchInputForAlpha(alpha,s.dynamicPressure);
    c.throttle=clamp(.9+(desiredSpeed-s.airspeed)*.065,.25,1);if(Math.abs(a.roll)>.35||goal.y>s.position.y+30)c.throttle=1;
    if(s.position.y<floor-30){c.throttle=1;c.roll=clamp(a.roll*3,-1,1);c.pitch=Math.max(c.pitch,.48);p.mode='TERRAIN AVOIDANCE';}
  }
  private landAI(p:Plane){
    const s=p.sim,c=s.controls;c.ignition=s.fuel>0&&s.componentHealth.engine>0;c.mixture=optimalMixture(s.position.y);c.radiator=1;p.gun.trigger=false;p.secondary.trigger=false;p.rear.trigger=false;
    if(p.recoveryField<0)this.beginRecovery(p,true);
    const field=AIRFIELDS[p.recoveryField],base=this.terrain.airfieldHeights[p.recoveryField];
    if(p.recoveryStage==='rollout'){
      c.throttle=0;c.pitch=0;c.roll=clamp((s.position.x-field.x)*.035,-.2,.2);c.brake=s.groundSpeed<24;p.mode='LANDING ROLLOUT';if(s.groundSpeed<1.8){p.recoveryStage=c.ignition?'taxi':'service';if(p.recoveryStage==='service')p.serviceUntil=this.time+AI_SERVICE_SECONDS;}return;
    }
    if(p.recoveryStage==='taxi'){
      const parking=parkingPosition(this.terrain,p.recoveryField,p.id%PLANES_PER_TEAM),delta=parking.clone().sub(s.position),distance=Math.hypot(delta.x,delta.z),forward=new T.Vector3(0,0,-1).applyQuaternion(s.orientation),heading=Math.atan2(-forward.x,-forward.z),wanted=Math.atan2(-delta.x,-delta.z),error=Math.atan2(Math.sin(wanted-heading),Math.cos(wanted-heading)),speed=Math.hypot(s.velocity.x,s.velocity.z),targetSpeed=clamp(distance*.12,1.1,4.5);
      c.pitch=0;c.roll=clamp(-error*2.6,-.82,.82);c.throttle=distance<18?0:clamp(.08+(targetSpeed-speed)*.04,0,.2);c.brake=speed>targetSpeed+.45||distance<18;p.mode='TAXI TO SERVICE';if(distance<18&&speed<1.35){p.recoveryStage='service';p.serviceUntil=this.time+AI_SERVICE_SECONDS;c.throttle=0;c.brake=true;}return;
    }
    if(p.recoveryStage==='service'){c.throttle=0;c.brake=true;c.pitch=0;c.roll=0;p.mode='REFUEL · REARM · REPAIR';return;}
    if(s.grounded){p.recoveryStage='rollout';c.throttle=0;c.brake=false;p.mode='LANDING ROLLOUT';return;}
    c.brake=false;const approach=new T.Vector3(field.x,base+85,field.z+850);if(p.recoveryStage==='approach'&&Math.hypot(s.position.x-approach.x,s.position.z-approach.z)<110){p.recoveryStage='final';p.emergencyStage='final';}
    const goal=p.recoveryStage==='approach'?approach:new T.Vector3(field.x,base+1.2,field.z-420);p.mode=p.recoveryStage==='approach'?'RETURN TO AIRFIELD':'FINAL APPROACH';
    const attitude=readAttitude(s.orientation),forward=new T.Vector3(0,0,-1).applyQuaternion(s.orientation),delta=goal.clone().sub(s.position),heading=Math.atan2(-forward.x,-forward.z),wanted=Math.atan2(-delta.x,-delta.z),error=Math.atan2(Math.sin(wanted-heading),Math.cos(wanted-heading));
    let bank=clamp(error*1.25,-.38,.38);if(s.airspeed<27)bank=clamp(bank,-.22,.22);c.roll=clamp((attitude.roll-bank)*2.8+s.rates.z*1.3,-1,1);
    const flightAngle=Math.atan2(s.velocity.y,Math.hypot(s.velocity.x,s.velocity.z)),desiredClimb=clamp((goal.y-s.position.y)*.028,-4.2,2.5),desiredAngle=clamp(Math.asin(clamp(desiredClimb/Math.max(22,s.airspeed),-.24,.18)),-.14,.11);
    const density=1.225*Math.exp(-s.position.y/8500),neededCl=s.mass*9.81/(.5*density*Math.max(23,s.airspeed)**2*s.spec.wingArea*Math.max(.72,Math.cos(attitude.roll)));let alpha=clamp((neededCl-.24)/4.7+(desiredAngle-flightAngle)*.8,.025,.2);
    if(s.airspeed<24||s.stall){alpha=.045;c.roll=clamp(attitude.roll*3,-1,1);p.mode='GLIDE RECOVERY';}c.pitch=pitchInputForAlpha(alpha,s.dynamicPressure);
    const desiredSpeed=p.recoveryStage==='final'?31:35;c.throttle=c.ignition?clamp(.3+(desiredSpeed-s.airspeed)*.06,0,.7):0;
    const lookAhead=this.surface(s.position.x+forward.x*180,s.position.z+forward.z*180),clearance=p.recoveryStage==='final'?2.4:18;if(s.position.y<lookAhead+clearance){c.roll=clamp(attitude.roll*3,-1,1);c.pitch=Math.max(c.pitch,.36);}
  }
  private departAI(p:Plane){
    const s=p.sim,c=s.controls,field=AIRFIELDS[p.homeField],base=this.terrain.airfieldHeights[p.homeField];p.gun.trigger=false;p.secondary.trigger=false;c.pitch=0;c.roll=0;
    if(p.departure==='waiting'){
      c.throttle=0;c.brake=true;p.mode='WAITING FOR RUNWAY';
      const busy=this.planes.some(o=>o!==p&&!o.sim.crashed&&((o.id!==0&&o.homeField===p.homeField&&['taxi','lineup','takeoff','climb'].includes(o.departure))||(Math.abs(o.sim.position.x-field.x)<42&&Math.abs(o.sim.position.z-field.z)<650&&o.sim.position.y<base+45)));
      if(!busy&&this.time>p.id*2)p.departure='taxi';return;
    }
    c.brake=false;
    if(p.departure==='taxi'||p.departure==='lineup'){
      p.mode='TAXI TO RUNWAY';
      const waypoint=new T.Vector3(field.x,base,s.position.z-90);
      const delta=waypoint.sub(s.position),forward=new T.Vector3(0,0,-1).applyQuaternion(s.orientation),heading=Math.atan2(-forward.x,-forward.z),wanted=Math.atan2(-delta.x,-delta.z),error=Math.atan2(Math.sin(wanted-heading),Math.cos(wanted-heading));
      c.roll=clamp(-error*2.5,-.85,.85);const speed=Math.hypot(s.velocity.x,s.velocity.z);c.throttle=clamp(.12+(5-speed)*.035,0,.28);c.brake=speed>6;
      if(p.departure==='taxi'&&Math.abs(s.position.x-field.x)<8&&s.position.z<s.spawn.z-65)p.departure='lineup';
      if(p.departure==='lineup'&&Math.abs(s.position.x-field.x)<6&&Math.abs(heading)<.09){p.departure='takeoff';c.roll=0;}
      return;
    }
    if(p.departure==='takeoff'){
      p.mode='TAKEOFF';c.throttle=1;
      const heading=new T.Euler().setFromQuaternion(s.orientation,'YXZ').y;
      c.roll=clamp(heading*1.5+(s.position.x-field.x)*.015,-.1,.1);c.pitch=s.indicatedAirspeed*3.6>s.spec.takeoff?.36:0;
      if(!s.grounded&&s.position.y>base+4)p.departure='climb';return;
    }
    p.mode='DEPARTURE CLIMB';c.throttle=1;
    const attitude=readAttitude(s.orientation),climbPitch=clamp((s.indicatedAirspeed-25)*.016,.03,.18);
    const flightAngle=Math.atan2(s.velocity.y,Math.hypot(s.velocity.x,s.velocity.z));
    const density=1.225*Math.exp(-s.position.y/8500);
    const neededCl=s.mass*9.81/(.5*density*Math.max(24,s.airspeed)**2*s.spec.wingArea);
    const climbAlpha=clamp((neededCl-.24)/4.7+(climbPitch-flightAngle)*.8,.015,.18);
    c.pitch=clamp(pitchInputForAlpha(climbAlpha,s.dynamicPressure),-.4,.65);c.roll=clamp(attitude.roll*3,-.4,.4);
    if(s.grounded)p.departure='takeoff';
    if(s.position.y>base+140){p.departure='flying';p.sortieStartedAt=this.time;}
  }
}


