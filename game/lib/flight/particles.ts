import * as T from 'three';
import type { EffectEvent, Plane } from './battle';

type Particle={position:T.Vector3;velocity:T.Vector3;color:T.Color;age:number;life:number;size:number;drag:number;gravity:number};

/** Shared, pooled point-particle renderer for smoke, impacts, debris and blasts. */
export class ParticleEffects {
  private particles:Particle[]=[];
  private geometry=new T.BufferGeometry();
  private positions=new Float32Array(1200*3);private colors=new Float32Array(1200*3);private sizes=new Float32Array(1200);
  private points:T.Points;
  private smokeClock=new Map<number,number>();
  constructor(private scene:T.Scene,private ground:(x:number,z:number)=>number,private random:()=>number=Math.random){
    this.geometry.setAttribute('position',new T.BufferAttribute(this.positions,3));
    this.geometry.setAttribute('color',new T.BufferAttribute(this.colors,3));
    this.geometry.setAttribute('size',new T.BufferAttribute(this.sizes,1));
    const material=new T.ShaderMaterial({transparent:true,depthWrite:false,vertexColors:true,blending:T.NormalBlending,
      vertexShader:'attribute float size; varying vec3 vColor; void main(){vColor=color; vec4 mv=modelViewMatrix*vec4(position,1.0); gl_PointSize=size*(280.0/max(1.0,-mv.z)); gl_Position=projectionMatrix*mv;}',
      fragmentShader:'varying vec3 vColor; void main(){vec2 p=gl_PointCoord-.5; float d=length(p); if(d>.5)discard; float a=smoothstep(.5,.12,d); gl_FragColor=vec4(vColor,a*.82);}'});
    this.points=new T.Points(this.geometry,material);this.points.frustumCulled=false;scene.add(this.points);
  }
  emit(event:EffectEvent){
    if(event.kind==='hit'){
      const earth=event.position.y<=this.ground(event.position.x,event.position.z)+.3;
      this.burst(event.position,event.velocity.clone().normalize().multiplyScalar(-8),earth?'#b89a68':'#ffd27a',earth?9:6,.18,.55,earth?1.4:.65);
      if(earth)this.smoke(event.position,'#766f60',3,.45,1.1);
    }else if(event.kind==='damage'){
      this.burst(event.position,event.velocity.clone().multiplyScalar(.12),'#4b4034',10,.3,1.8,1.1);
      this.smoke(event.position,'#77736a',4,.55,1.5);
    }else{
      this.burst(event.position,new T.Vector3(0,8,0),'#ffb64e',34,1.2,1.1,3.4);
      this.smoke(event.position,'#4a4943',28,2.2,4.5);
      this.burst(event.position,new T.Vector3(0,12,0),'#3c342b',20,1.8,3.2,1.7);
    }
  }
  emitCockpitDamage(camera:T.Camera,carrierVelocity:T.Vector3){
    camera.updateMatrixWorld();
    const forward=camera.getWorldDirection(new T.Vector3()),right=new T.Vector3(1,0,0).applyQuaternion(camera.quaternion),up=new T.Vector3(0,1,0).applyQuaternion(camera.quaternion);
    for(let i=0;i<30;i++){
      const position=camera.position.clone().addScaledVector(forward,.45+this.random()*.55).addScaledVector(right,(this.random()-.5)*.7).addScaledVector(up,(this.random()-.5)*.42);
      const velocity=carrierVelocity.clone().addScaledVector(forward,-4-this.random()*8).addScaledVector(right,(this.random()-.5)*7).addScaledVector(up,(this.random()-.35)*5);
      const color=new T.Color(i%5===0?'#ffd37a':i%3===0?'#9b9a8c':'#6e4d31');
      this.add(position,velocity,color,.025+this.random()*.045,.18+this.random()*.24,.8,1.5);
    }
  }
  update(dt:number,planes:Plane[]){
    for(const plane of planes){
      const s=plane.sim;if(s.crashed||s.engine==='off')continue;
      const damage=Math.max(1-s.health,(1-s.airframeHealth)*.65),badMix=Math.max(0,.62-s.mixtureEfficiency);
      if(damage<.08&&badMix<.08)continue;
      const rate=2+damage*18+badMix*20,clock=(this.smokeClock.get(plane.id)??0)+dt*rate;
      const count=Math.floor(clock);this.smokeClock.set(plane.id,clock-count);
      const engineXs=s.aircraftType==='bomber'?[-s.spec.span*.18,s.spec.span*.18]:[0];
      for(let i=0;i<count;i++)for(const x of engineXs){
        const pos=new T.Vector3(x,s.aircraftType==='bomber'?.38:.05,-2.05).applyQuaternion(s.orientation).add(s.position);
        const darkness=T.MathUtils.clamp(damage*.85+badMix*.55,0,1),color=new T.Color('#aaa79b').lerp(new T.Color('#292b29'),darkness);
        this.add(pos,s.velocity.clone().multiplyScalar(.72).add(new T.Vector3((this.random()-.5)*.7,.6+this.random(),(this.random()-.5)*.7)),color,.65+damage*1.5,1.6+damage*2,.25,-.12);
      }
    }
    for(let i=this.particles.length-1;i>=0;i--){const p=this.particles[i];p.age+=dt;if(p.age>=p.life){this.particles.splice(i,1);continue;}p.velocity.multiplyScalar(Math.exp(-p.drag*dt));p.velocity.y-=p.gravity*dt;p.position.addScaledVector(p.velocity,dt);const floor=this.ground(p.position.x,p.position.z);if(p.position.y<floor){p.position.y=floor;p.velocity.y=Math.abs(p.velocity.y)*.12;p.velocity.multiplyScalar(.65);}}
    const count=Math.min(this.particles.length,1200);for(let i=0;i<count;i++){const p=this.particles[i],fade=1-p.age/p.life,ii=i*3;this.positions[ii]=p.position.x;this.positions[ii+1]=p.position.y;this.positions[ii+2]=p.position.z;this.colors[ii]=p.color.r*fade;this.colors[ii+1]=p.color.g*fade;this.colors[ii+2]=p.color.b*fade;this.sizes[i]=p.size*(1+p.age/p.life*.9);}
    this.geometry.setDrawRange(0,count);(this.geometry.attributes.position as T.BufferAttribute).needsUpdate=true;(this.geometry.attributes.color as T.BufferAttribute).needsUpdate=true;(this.geometry.attributes.size as T.BufferAttribute).needsUpdate=true;
  }
  reset(){this.particles.length=0;this.smokeClock.clear();this.geometry.setDrawRange(0,0);}
  dispose(){this.points.removeFromParent();this.geometry.dispose();(this.points.material as T.Material).dispose();}
  private burst(position:T.Vector3,base:T.Vector3,color:string,count:number,speed:number,life:number,size:number){for(let i=0;i<count;i++){const velocity=base.clone().add(new T.Vector3(this.random()-.5,this.random()*.8-.15,this.random()-.5).normalize().multiplyScalar(speed*(.35+this.random())));this.add(position,velocity,new T.Color(color),size*(.65+this.random()*.7),life*(.7+this.random()*.6),.5,7);}}
  private smoke(position:T.Vector3,color:string,count:number,size:number,life:number){for(let i=0;i<count;i++)this.add(position,new T.Vector3((this.random()-.5)*2,1+this.random()*3,(this.random()-.5)*2),new T.Color(color),size*(.7+this.random()),life*(.75+this.random()*.5),.35,-.15);}
  private add(position:T.Vector3,velocity:T.Vector3,color:T.Color,size:number,life:number,drag:number,gravity:number){if(this.particles.length>=1200)this.particles.shift();this.particles.push({position:position.clone(),velocity,color,age:0,life,size,drag,gravity});}
}
