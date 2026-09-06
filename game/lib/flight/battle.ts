import * as T from 'three';
import { AIRFIELDS, Terrain } from './terrain';
import { FlightSimulation, DT, clamp, optimalMixture, pitchInputForAlpha } from './simulation';
import { MachineGun, MUZZLE_VELOCITY } from './weapons';
import { readAttitude } from './attitude';
import { SceneryCollisions } from './collisions';
import { parkingPosition } from './airfield-ops';
import { AIRCRAFT, type AircraftType } from './aircraft';

export type Team='ALLIED'|'CENTRAL';
export const opponent=(team:Team):Team=>team==='ALLIED'?'CENTRAL':'ALLIED';
export const TARGET_SCORE=100, POINTS_PER_EVENT=5, RESPAWN_DELAY=8, BLAST_KILL_RADIUS=32;
export type Building={id:string;team:Team;kind:'HANGAR'|'TOWER';position:T.Vector3;bounds:T.Box3;destroyed:boolean};
export type ParkedPlane={id:string;team:Team;type:AircraftType;position:T.Vector3;rotation:T.Quaternion;bounds:T.Box3;health:number;destroyed:boolean};
export type Plane={id:number;team:Team;sim:FlightSimulation;gun:MachineGun;rear:MachineGun;previous:T.Vector3;rotation:T.Quaternion;generation:number;scored:boolean;respawnAt:number;mode:string;target:number;decision:number;cooldown:number;runTarget:string;runStage:'approach'|'pass'|'egress'|'dogleg';homeField:number;departure:'waiting'|'taxi'|'lineup'|'takeoff'|'climb'|'flying';previousHealth:number;evasiveUntil:number;evasiveDirection:number};
export type Bomb={id:number;team:Team;position:T.Vector3;previous:T.Vector3;velocity:T.Vector3;age:number};
export type Blast={id:number;position:T.Vector3;age:number};
export type EffectEvent={kind:'hit'|'damage'|'explosion';position:T.Vector3;velocity:T.Vector3;intensity:number};
export type BattleInfo={scores:Record<Team,number>;winner:Team|'DRAW'|null;team:Team;counts:Record<Team,number>;bombs:number;ammo:number;health:number;respawn:number;message:string;contacts:{id:number;team:Team;x:number;z:number}[]};

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

/** Eight fixed roster slots; the player's slot is never replaced by a ninth plane. */
export class Battle {
  planes:Plane[]=[];buildings:Building[];parkedPlanes:ParkedPlane[];bombs:Bomb[]=[];blasts:Blast[]=[];effects:EffectEvent[]=[];
  scores:Record<Team,number>={ALLIED:0,CENTRAL:0};winner:Team|'DRAW'|null=null;time=0;message='FIRST TEAM TO 100';
  private serial=0;
  constructor(readonly terrain:Terrain,player:FlightSimulation,gun:MachineGun,readonly playerTeam:Team='ALLIED',private random:()=>number=Math.random,private scenery?:SceneryCollisions){
    this.buildings=createBuildings(terrain);
    this.parkedPlanes=createParkedPlanes(terrain);
    if(scenery){for(const target of this.parkedPlanes)scenery.addBox('PARKED AIRCRAFT',target.bounds.min,target.bounds.max);scenery.isEnabled=(kind,bounds)=>!(((kind==='HANGAR'||kind==='TOWER')&&this.buildings.some(b=>b.destroyed&&b.bounds.intersectsBox(bounds)))||(kind==='PARKED AIRCRAFT'&&this.parkedPlanes.some(p=>p.destroyed&&p.bounds.intersectsBox(bounds))));}
    for(let id=0;id<8;id++){
      const team=id<4?playerTeam:opponent(playerTeam),sim=id===0?player:new FlightSimulation();
      if(id!==0){sim.aircraftType=id%4===3?'bomber':id%2===0?'fighter':'scout';sim.groundHeightAt=terrain.heightAt;sim.isWaterAt=(x,z)=>terrain.isWater(x,z);}
      const fields=AIRFIELDS.map((f,i)=>f.team===team?i:-1).filter(i=>i>=0);
      const p:Plane={id,team,sim,gun:id===0?gun:new MachineGun(random),rear:new MachineGun(random),previous:sim.position.clone(),rotation:sim.orientation.clone(),generation:0,scored:false,respawnAt:0,mode:'PATROL',target:-1,decision:0,cooldown:0,runTarget:'',runStage:'approach',homeField:fields[id%2],departure:'waiting',previousHealth:1,evasiveUntil:0,evasiveDirection:1};
      this.planes.push(p);if(id!==0)this.spawn(p);
    }
  }
  surface=(x:number,z:number)=>this.terrain.isWater(x,z)?5:this.terrain.heightAt(x,z);
  private spawn(p:Plane){
    const position=parkingPosition(this.terrain,p.homeField,p.id%4);
    if(this.planes.some(other=>other!==p&&!other.sim.crashed&&other.sim.position.distanceTo(position)<24)){p.respawnAt=this.time+2;return;}
    p.sim.spawn.copy(position);
    const s=p.sim;s.reset();p.gun.reset();p.rear.reset();p.gun.cock();p.rear.cock();p.scored=false;p.generation++;p.target=-1;p.cooldown=0;p.runTarget='';p.runStage='approach';
    p.departure='waiting';p.mode='WAITING FOR RUNWAY';p.previous.copy(s.position);p.rotation.copy(s.orientation);p.previousHealth=1;p.evasiveUntil=0;
  }
  info():BattleInfo{return{scores:{...this.scores},winner:this.winner,team:this.playerTeam,counts:{ALLIED:this.planes.filter(p=>p.team==='ALLIED'&&!p.sim.crashed).length,CENTRAL:this.planes.filter(p=>p.team==='CENTRAL'&&!p.sim.crashed).length},bombs:this.planes[0].sim.bombsRemaining,ammo:this.planes[0].gun.roundsRemaining,health:this.planes[0].sim.airframeHealth,respawn:Math.max(0,this.planes[0].respawnAt-this.time),message:this.message,contacts:this.planes.filter(p=>!p.sim.crashed).map(p=>({id:p.id,team:p.team,x:p.sim.position.x,z:p.sim.position.z}))};}
  respawnPlayer(){const p=this.planes[0];if(this.winner||!p.sim.crashed||!p.scored||this.time<p.respawnAt)return false;if(this.planes.slice(1).some(o=>!o.sim.crashed&&o.sim.position.distanceTo(p.sim.spawn)<24))return false;p.sim.reset();p.gun.reset();p.rear.reset();p.scored=false;p.generation++;p.previous.copy(p.sim.position);p.rotation.copy(p.sim.orientation);return true;}
  retirePlayer(cause='ABANDONED AIRCRAFT'){
    if(this.winner)return false;const p=this.planes[0];if(!p.sim.crashed)p.sim.crash(cause);this.recordCrashes();this.decideWinner();return true;
  }
  release(p=this.planes[0]){
    const s=p.sim;if(this.winner||s.crashed||s.grounded||s.bombsRemaining<=0||p.cooldown>0)return false;
    const index=s.spec.bombs-s.bombsRemaining,position=rackPosition(index,s.spec.span).applyQuaternion(s.orientation).add(s.position);
    this.bombs.push({id:++this.serial,team:p.team,position,previous:position.clone(),velocity:s.velocity.clone().add(new T.Vector3(0,-1,0)),age:0});s.bombsRemaining--;p.cooldown=.3;return true;
  }
  private award(team:Team,reason:string){this.scores[team]=Math.min(TARGET_SCORE,this.scores[team]+POINTS_PER_EVENT);this.message=`${team} +${POINTS_PER_EVENT} · ${reason}`;}
  private recordCrashes(){for(const p of this.planes)if(p.sim.crashed&&!p.scored){p.scored=true;p.respawnAt=this.time+RESPAWN_DELAY;this.award(opponent(p.team),'ENEMY AIRCRAFT LOST');}}
  private decideWinner(){if(this.scores.ALLIED>=100&&this.scores.CENTRAL>=100)this.winner='DRAW';else if(this.scores.ALLIED>=100)this.winner='ALLIED';else if(this.scores.CENTRAL>=100)this.winner='CENTRAL';}
  step(dt=DT){
    if(this.winner)return;this.time+=dt;
    for(const p of this.planes){p.cooldown=Math.max(0,p.cooldown-dt);if(p.sim.crashed&&p.id!==0&&p.scored&&this.time>=p.respawnAt)this.spawn(p);p.previous.copy(p.sim.position);p.rotation.copy(p.sim.orientation);if(p.id!==0&&!p.sim.crashed)this.flyAI(p,dt);this.scenery?.setAircraftScale(p.sim.spec.span/8.8,p.sim.spec.length);p.sim.step(dt);
      if(p.id!==0&&!p.sim.crashed&&this.scenery){const hit=this.scenery.sweep(p.previous,p.sim.position,p.rotation,p.sim.orientation);if(hit){p.sim.position.lerpVectors(p.previous,p.sim.position,hit.time);p.sim.crash(hit.kind);}}
      if(Math.max(Math.abs(p.sim.position.x),Math.abs(p.sim.position.z))>5700)p.sim.crash('LEFT BATTLE');}
    for(const p of this.planes){this.stepGun(p,p.gun,false,dt);if(p.sim.aircraftType==='bomber')this.stepGun(p,p.rear,true,dt);}
    for(let i=0;i<this.planes.length;i++)for(let j=i+1;j<this.planes.length;j++){const a=this.planes[i],b=this.planes[j];if(a.sim.crashed||b.sim.crashed)continue;if(segmentSphere(a.previous.clone().sub(b.previous),a.sim.position.clone().sub(b.sim.position),2)!==null){a.sim.crash('MID-AIR COLLISION');b.sim.crash('MID-AIR COLLISION');}}
    for(let i=this.bombs.length-1;i>=0;i--){const b=this.bombs[i];b.previous.copy(b.position);b.velocity.multiplyScalar(Math.exp(-.012*dt));b.velocity.y-=9.81*dt;b.position.addScaledVector(b.velocity,dt);b.age+=dt;
      let hit=terrainHit(b.previous,b.position,this.surface);for(const building of this.buildings)if(!building.destroyed){const t=segmentBox(b.previous,b.position,building.bounds);if(t!==null&&(hit===null||t<hit))hit=t;}
      for(const target of this.parkedPlanes)if(!target.destroyed){const t=segmentBox(b.previous,b.position,target.bounds);if(t!==null&&(hit===null||t<hit))hit=t;}
      if(hit!==null){b.position.lerpVectors(b.previous,b.position,hit);this.explode(b);this.bombs.splice(i,1);}else if(b.age>90)this.bombs.splice(i,1);
    }
    for(const blast of this.blasts)blast.age+=dt;this.blasts=this.blasts.filter(b=>b.age<5);
    this.recordCrashes();this.decideWinner();
  }
  private explode(b:Bomb){
    this.blasts.push({id:++this.serial,position:b.position.clone(),age:0});if(this.blasts.length>32)this.blasts.shift();
    this.pushEffect({kind:'explosion',position:b.position.clone(),velocity:b.velocity.clone(),intensity:1});
    for(const building of this.buildings){if(building.destroyed)continue;if(building.bounds.distanceToPoint(b.position)<=22){building.destroyed=true;if(building.team!==b.team)this.award(b.team,`${building.kind} DESTROYED`);}}
    for(const target of this.parkedPlanes)if(!target.destroyed&&target.bounds.distanceToPoint(b.position)<BLAST_KILL_RADIUS)this.destroyParked(target,b.team,'BOMBED');
    for(const p of this.planes)if(!p.sim.crashed&&p.sim.position.distanceTo(b.position)<BLAST_KILL_RADIUS)p.sim.crash('BOMB BLAST');
  }
  private destroyParked(target:ParkedPlane,attacker:Team,reason:string){
    if(target.destroyed)return;target.destroyed=true;target.health=0;this.pushEffect({kind:'explosion',position:target.position.clone(),velocity:new T.Vector3(),intensity:.65});if(target.team!==attacker)this.award(attacker,`PARKED AIRCRAFT ${reason}`);
  }
  private bulletHit(shooter:Plane,from:T.Vector3,to:T.Vector3){
    let first=terrainHit(from,to,this.surface),victim:Plane|undefined,parkedVictim:ParkedPlane|undefined;
    for(const building of this.buildings){const box=building.bounds.clone();if(building.destroyed)box.max.y=box.min.y+1.5;const t=segmentBox(from,to,box);if(t!==null&&(first===null||t<first)){first=t;victim=undefined;parkedVictim=undefined;}}
    for(const target of this.parkedPlanes){const box=target.bounds.clone();if(target.destroyed)box.max.y=box.min.y+.65;const t=segmentBox(from,to,box);if(t!==null&&(first===null||t<first)){first=t;victim=undefined;parkedVictim=target.destroyed?undefined:target;}}
    for(const p of this.planes){if(p===shooter||p.sim.crashed)continue;
      const inv=p.sim.orientation.clone().invert(),a=from.clone().sub(p.previous).applyQuaternion(inv),b=to.clone().sub(p.sim.position).applyQuaternion(inv);
      const boxes=[new T.Box3(new T.Vector3(-.7,-.7,-3.6),new T.Vector3(.7,.7,4.5*p.sim.spec.length)),new T.Box3(new T.Vector3(-p.sim.spec.span/2,-.5,-2.25),new T.Vector3(p.sim.spec.span/2,-.1,-.55)),new T.Box3(new T.Vector3(-p.sim.spec.span/2,1.25,-2.25),new T.Vector3(p.sim.spec.span/2,1.7,-.55))];
      for(const box of boxes){const t=segmentBox(a,b,box);if(t!==null&&(first===null||t<first)){first=t;victim=p;parkedVictim=undefined;}}
    }
    if(victim&&first!==null){victim.sim.damage(.18);this.pushEffect({kind:'damage',position:from.clone().lerp(to,first),velocity:victim.sim.velocity.clone(),intensity:.8});}
    else if(parkedVictim&&first!==null){parkedVictim.health-=.18;this.pushEffect({kind:'damage',position:from.clone().lerp(to,first),velocity:new T.Vector3(),intensity:.8});if(parkedVictim.health<=0)this.destroyParked(parkedVictim,shooter.team,'DESTROYED');}
    return first;
  }
  private stepGun(p:Plane,gun:MachineGun,rear:boolean,dt:number){
    const s=p.sim;const direction=new T.Vector3(0,0,-1).applyQuaternion(s.orientation);let muzzle=new T.Vector3(.34,.505,-3.6).applyQuaternion(s.orientation).add(s.position);
    if(rear){gun.trigger=false;muzzle=new T.Vector3(.22,.7,2.7).applyQuaternion(s.orientation).add(s.position);
      const target=this.planes.filter(e=>e.team!==p.team&&!e.sim.crashed).sort((a,b)=>a.sim.position.distanceToSquared(s.position)-b.sim.position.distanceToSquared(s.position))[0];
      if(target){const delta=target.sim.position.clone().sub(muzzle),dist=delta.length(),local=delta.clone().applyQuaternion(s.orientation.clone().invert());
        if(dist<450&&local.z>40&&Math.abs(local.x)<local.z*1.5&&local.y>Math.max(8,local.z*.06)&&local.y<local.z){direction.copy(delta).addScaledVector(target.sim.velocity.clone().sub(s.velocity),dist/MUZZLE_VELOCITY).normalize();gun.trigger=gun.heat<.55&&this.time%2.5<1.2;}
      }
      if((gun.jammed||!gun.cocked)&&this.time%4<dt)gun.cock();
    }
    if(gun.trigger&&(p.id!==0||rear)){
      // AI holds fire when a friendly crosses its firing lane.
      const end=muzzle.clone().addScaledVector(direction,rear?450:650);
      for(const friend of this.planes)if(friend!==p&&friend.team===p.team&&!friend.sim.crashed){if(segmentSphere(muzzle.clone().sub(friend.sim.position),end.clone().sub(friend.sim.position),6)!==null){gun.trigger=false;break;}}
    }
    if(s.crashed)gun.trigger=false;
    gun.step(dt,{muzzle,direction,aircraftVelocity:s.velocity,groundHeightAt:this.surface,sweep:(a,b)=>this.bulletHit(p,a,b)});
    for(const impact of gun.consumeImpacts())this.pushEffect({kind:'hit',position:impact.position,velocity:impact.velocity,intensity:impact.tracer?.8:.5});
  }
  consumeEffects(){return this.effects.splice(0);}
  private pushEffect(effect:EffectEvent){this.effects.push(effect);if(this.effects.length>128)this.effects.shift();}
  private flyAI(p:Plane,dt:number){
    const s=p.sim,c=s.controls,a=readAttitude(s.orientation),forward=new T.Vector3(0,0,-1).applyQuaternion(s.orientation);
    c.ignition=true;c.brake=false;c.mixture=optimalMixture(s.position.y);c.radiator=s.temperature>95?.9:.45;c.throttle=1;
    if(p.departure!=='flying'){this.departAI(p);return;}
    if(s.airframeHealth<p.previousHealth-.001){p.evasiveUntil=this.time+3.2+this.random()*2.4;p.evasiveDirection=this.random()<.5?-1:1;p.target=-1;p.decision=.7;}p.previousHealth=s.airframeHealth;
    if((p.gun.jammed||!p.gun.cocked)&&this.time%3<dt)p.gun.cock();p.gun.trigger=false;
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
      p.decision-=dt;if(p.decision<=0){p.decision=.8+this.random()*.4;const targets=this.planes.filter(e=>e.team!==p.team&&!e.sim.crashed);p.target=targets.sort((a,b)=>a.sim.position.distanceToSquared(s.position)-b.sim.position.distanceToSquared(s.position))[0]?.id??-1;}
      const target=this.planes[p.target];if(target&&!target.sim.crashed){const delta=target.sim.position.clone().sub(s.position),distance=delta.length();goal.copy(target.sim.position).addScaledVector(target.sim.velocity,Math.min(3,distance/90));
        const aim=delta.clone().addScaledVector(target.sim.velocity.clone().sub(s.velocity),distance/MUZZLE_VELOCITY);aim.y+=.5*9.81*(distance/MUZZLE_VELOCITY)**2;
        if(distance<950&&s.position.y>this.surface(s.position.x,s.position.z)+170){goal.copy(s.position).add(aim);aimPitch=Math.atan2(aim.y,Math.hypot(aim.x,aim.z));}
        if(distance<650&&forward.dot(aim.normalize())>.997&&p.gun.heat<.6)p.gun.trigger=this.time%2<.9;
        if(distance<140&&forward.dot(delta.clone().normalize())<-.7&&s.airspeed>34){desiredSpeed=30;p.mode='FORCE OVERSHOOT';}
        else if(s.position.y>target.sim.position.y+100){p.mode='DIVING ATTACK';}
        else if(distance<800){p.mode='TURN FIGHT';}
      }
    }
    if(this.time<p.evasiveUntil){
      const right=new T.Vector3(1,0,0).applyQuaternion(s.orientation),up=new T.Vector3(0,1,0);
      goal.copy(s.position).addScaledVector(forward,520).addScaledVector(right,430*p.evasiveDirection).addScaledVector(up,110+70*Math.sin(this.time*3+p.id));
      desiredSpeed=50;p.mode='EVASIVE BREAK';p.gun.trigger=false;
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
  private departAI(p:Plane){
    const s=p.sim,c=s.controls,field=AIRFIELDS[p.homeField],base=this.terrain.airfieldHeights[p.homeField];p.gun.trigger=false;c.pitch=0;c.roll=0;
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
    if(s.position.y>base+140){p.departure='flying';}
  }
}


