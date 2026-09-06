import * as T from 'three';
import { FlightSimulation, DT, clamp } from './simulation';
import { createFuselage, projectThrottleGrip, THROTTLE_BASE_Y, throttleAngle, throttleAtPointer, WheelWinder } from './cockpit';
import { AIRCRAFT, AircraftType } from './aircraft';
import { AIRFIELDS, Terrain } from './terrain';
import { WorldView } from './world';
import { CrashEffects } from './crash';
import { horizonMaterial, readAttitude } from './attitude';
import { AMMO_CAPACITY, MachineGun } from './weapons';
import { Battle, type BattleInfo, rackPosition } from './battle';
import { BattleView, bombModel } from './battle-view';
import { parkingPosition, stoppedRunway, turnHeadYaw } from './airfield-ops';
export type FlightInfo={started:boolean;flightId:string;canHangar:boolean;aircraftType:AircraftType;airfieldIndex:number;x:number;z:number;heading:number;altitude:number;altitudeAboveGround:number;grounded:boolean;crashed:boolean;battle:BattleInfo};

type Control = 'throttle' | 'mixture' | 'radiator' | 'yoke' | 'ignition' | 'brake' | 'trigger' | 'cocking' | 'bomb';
type Gauge = { needle: T.Group; max: number; read: () => number };
type MouseButton=0|2;
type Drag={name:Control;x:number;y:number;initial:number;pitch:number;roll:number;id?:number;grabOffset:T.Vector2;direct:boolean;wheel?:WheelWinder};
const PILOT_FORWARD_OFFSET=1.0;
const CONTROL_WHEEL_Y=-.30;
export const BRAKE_SHAKE_RPM=1400;
export function overspeedShakeAmount(indicatedKmh:number,limitKmh:number){return clamp((indicatedKmh-limitKmh)/70,0,1.5);}
export function raiseAircraftForTesting(sim:FlightSimulation,metres=500){if(sim.crashed||metres<=0)return false;sim.position.y+=metres;sim.grounded=false;return true;}
export function resolveMouseControl<T>(picked:T|null,bound:T|null,chording:boolean){return chording&&bound?bound:picked??bound;}
export function movePilotLateral(current:number,input:number,dt:number){return clamp(current+input*dt*.48,-.38,.38);}
export function bombButtonAction(coverOpen:boolean):'open'|'release'{return coverOpen?'release':'open';}
export function gunBarrelAppearance(heat:number){
  const glow=clamp((heat-.2)/.8,0,1),orange=glow*glow;
  return {color:[.106+glow*.894,.141+glow*.18,.125-glow*.095] as const,emissive:[glow,.08*glow+.32*orange,.01*glow] as const,intensity:.2+glow*1.8};
}
export function brakeButtonPose(on:boolean,rpm:number,now:number){
  const warning=on&&rpm>BRAKE_SHAKE_RPM;
  return {x:.76+(warning?Math.sin(now*.075)*.014:0),y:-.45+(warning?Math.cos(now*.11)*.009:0),z:on?-.48:-.44,rotation:warning?Math.sin(now*.13)*.09:0};
}
export class FlightGame {
  private started=false;
  private readonly worldId=`${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  private sortieNumber=0;
  private flightId=`${this.worldId}:0`;
  private previewField:number|null=0;
  previewHangar(field:number|null){this.previewField=field;}
  private canHangar(){return true;}
  readonly sim = new FlightSimulation();
  readonly terrain = new Terrain();
  private world: WorldView; private crashEffects: CrashEffects;
  readonly bombRacks:T.Group[]=[];
  battle:Battle;private battleView:BattleView;
  airfieldIndex=0;
  private attitude: T.ShaderMaterial | null=null;
  paused = false;
  private renderer: T.WebGLRenderer;
  private scene = new T.Scene(); private cockpit = new T.Scene(); private aircraft = new T.Group();
  private camera = new T.PerspectiveCamera(70, 1, .025, 7000);
  private target = new T.WebGLRenderTarget(1067, 600, { minFilter: T.NearestFilter, magFilter: T.NearestFilter });
  private screen = new T.Scene(); private screenCamera = new T.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private ray = new T.Raycaster(); private pointer = new T.Vector2();
  private hits: T.Object3D[] = []; private gauges: Gauge[] = [];
  private knobs: Partial<Record<Control, T.Group>> = {}; private keys = new Set<string>();
  private drags=new Map<MouseButton,Drag>();
  private bindings:Record<MouseButton,Control|null>={0:null,2:null};
  private hands:Record<MouseButton,T.Group>={0:new T.Group(),2:new T.Group()};
  private handAnchors:Partial<Record<Control,T.Object3D>>={};
  private dragTarget = new T.Vector2();
  private hover: Control | null = null;
  private yaw = 0; private pitch = -.23;private pilotLateral=0; private frame = 0; private last = 0; private accumulator = 0; private reportTime = 0;
  private prevPosition = new T.Vector3(); private prevRotation = new T.Quaternion(); private look = new T.Quaternion();
  private shakeOffset=new T.Vector3();private shakeRotation=new T.Quaternion();private shakeEuler=new T.Euler(0,0,0,'YXZ');
  private propeller = new T.Group(); private resizeObserver: ResizeObserver;
  private labels: T.Texture[] = []; private fps = 60;
  readonly gun = new MachineGun();
  private gunTrigger = new T.Group(); private cockingHandle = new T.Group(); private gunBarrelMaterial:T.MeshStandardMaterial|null=null;private cockTravel = 0;private cockRatchet=0; private gunRecoil = 0; private shownRounds = 0;private shownAmmo=-1;private ammoTexture:T.CanvasTexture|null=null;private bombCover=new T.Group();private bombCoverOpen=false;private bombHand:MouseButton|null=null;private heardBlasts=new Set<number>();
  private tracerGeometry = new T.BoxGeometry(1, 1, 1); private tracers: T.InstancedMesh;
  private toolLifecycle = new AbortController();
  private audio: AudioContext | null = null; private oscillators: OscillatorNode[] = []; private gain: GainNode | null = null; private engineNoise: AudioBufferSourceNode | null=null;private noiseGain:GainNode|null=null;private noiseBuffer:AudioBuffer|null=null;private blastNoiseBuffer:AudioBuffer|null=null;
  constructor(private mount: HTMLElement, private report: (status: string, hint: string, telemetry: string, info:FlightInfo) => void) {
    this.renderer = new T.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.autoClear = false; this.renderer.outputColorSpace = T.SRGBColorSpace;
    this.renderer.domElement.tabIndex = 0;
    this.renderer.domElement.setAttribute('aria-label', 'Flight simulator. WASD looks around; Q and E slide the pilot left and right within the cockpit. All aircraft controls are operated in the cockpit. Left and right mouse buttons each bind a hand to a cockpit control; repeat that button to reuse its control.');
    mount.appendChild(this.renderer.domElement);
    this.scene.background = new T.Color('#abb9a4'); this.scene.fog = new T.Fog('#abb9a4', 1600, 6500);
    for (const scene of [this.scene, this.cockpit]) {
      scene.add(new T.HemisphereLight('#f4eed2', '#45513a', 2.3));
      const sun = new T.DirectionalLight('#ffe4b5', 2.7); sun.position.set(-150, 250, 60); scene.add(sun);
    }
    this.screen.add(new T.Mesh(new T.PlaneGeometry(2, 2), new T.MeshBasicMaterial({ map: this.target.texture, depthTest: false, depthWrite: false })));
    this.tracers = new T.InstancedMesh(this.tracerGeometry, new T.MeshBasicMaterial({ color: '#ffd66b', transparent: true, opacity: .95, depthWrite: false }), 128);
    this.tracers.count = 0;
    this.tracers.frustumCulled = false; this.scene.add(this.tracers);
    this.sim.aircraftType=(Object.keys(AIRCRAFT) as AircraftType[])[Math.floor(Math.random()*3)];
    this.airfieldIndex=Math.floor(Math.random()*2);
    this.sim.groundHeightAt=this.terrain.heightAt;this.sim.isWaterAt=(x,z)=>this.terrain.isWater(x,z);
    this.setSpawn();this.sim.reset();
    this.world=new WorldView(this.scene,this.terrain,this.sim.scenery);
    this.battle=new Battle(this.terrain,this.sim,this.gun,AIRFIELDS[this.airfieldIndex].team,Math.random,this.sim.scenery);this.battleView=new BattleView(this.scene,this.battle);
    this.crashEffects=new CrashEffects(this.scene,this.terrain.heightAt);
    this.buildAircraft(); this.cockpit.add(this.aircraft);
    this.prevPosition.copy(this.sim.position); this.prevRotation.copy(this.sim.orientation);
    this.resizeObserver = new ResizeObserver(this.resize); this.resizeObserver.observe(mount); this.resize();
    const canvas = this.renderer.domElement;
    canvas.addEventListener('mousedown',this.down);window.addEventListener('mousemove',this.move);window.addEventListener('mouseup',this.up);
    canvas.addEventListener('pointerdown',this.touchDown);canvas.addEventListener('pointermove',this.touchMove);canvas.addEventListener('pointerup',this.touchUp);canvas.addEventListener('pointercancel',this.touchUp);canvas.addEventListener('lostpointercapture',this.touchUp);canvas.addEventListener('contextmenu',this.contextmenu);
    window.addEventListener('keydown', this.keydown); window.addEventListener('keyup', this.keyup); window.addEventListener('blur', this.blur);
    document.addEventListener('visibilitychange', this.visibility);
    this.registerTools();
    this.frame = requestAnimationFrame(this.animate);
  }
  private material(color: string) { return new T.MeshLambertMaterial({ color, flatShading: true }); }
  private box(parent: T.Object3D, size: number[], position: number[], material: T.Material) {
    const mesh = new T.Mesh(new T.BoxGeometry(size[0], size[1], size[2]), material); mesh.position.set(position[0], position[1], position[2]); parent.add(mesh); return mesh;
  }
  private rod(parent: T.Object3D, start: number[], end: number[], width: number, material: T.Material) {
    const a = new T.Vector3(...start), b = new T.Vector3(...end), delta = b.clone().sub(a);
    const mesh = new T.Mesh(new T.CylinderGeometry(width, width, delta.length(), 5), material);
    mesh.position.copy(a).add(b).multiplyScalar(.5); mesh.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), delta.normalize()); parent.add(mesh); return mesh;
  }
  private texture(width: number, height: number, draw: (c: CanvasRenderingContext2D) => void) {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d')!; draw(ctx);
    const texture = new T.CanvasTexture(canvas); texture.colorSpace = T.SRGBColorSpace; texture.magFilter = T.NearestFilter;
    this.labels.push(texture); return texture;
  }
  private label(text: string, x: number, y: number, z: number, width = .25, parent: T.Object3D = this.aircraft) {
    const map = this.texture(256, 48, c => { c.fillStyle = '#242820'; c.fillRect(0, 0, 256, 48); c.fillStyle = '#d7d0ab'; c.font = 'bold 24px monospace'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(text, 128, 25); });
    const mesh = new T.Mesh(new T.PlaneGeometry(width, width * 48 / 256), new T.MeshBasicMaterial({ map })); mesh.position.set(x, y, z); parent.add(mesh); return mesh;
  }
  private buildAircraft() {
    const spec=this.sim.spec,span=spec.span/8.8;
    const canvas = this.material(spec.canvas), olive = this.material(spec.color), timber = this.material('#70472b'), dark = this.material('#1b2420'), brass = this.material('#b2a06a');
    const wood = this.texture(64, 64, c => { c.fillStyle = '#68472d'; c.fillRect(0, 0, 64, 64); for (let i = 0; i < 32; i++) { c.fillStyle = i % 2 ? '#755436' : '#5b3f2a'; c.fillRect(0, i * 2, 64, 1); } });
    const panelMaterial = new T.MeshLambertMaterial({ map: wood });
    const fuselage=createFuselage(olive);fuselage.children[2].scale.y=spec.length;fuselage.children[2].position.z+=1.35*(spec.length-1);this.aircraft.add(fuselage);
    this.box(this.aircraft, [1.8, .06, 2.5], [0, -.7, .5], dark);
    this.box(this.aircraft, [8.5*span, .095, 1.6], [0, -.3, -1.4], canvas);
    this.box(this.aircraft, [spec.span, .10, 1.55], [0, 1.48, -1.4], canvas);
    this.box(this.aircraft, [2.5*span, .07, .85], [0, -.32, 4.1*spec.length], canvas);
    this.box(this.aircraft, [.07, 1.0, .85], [0, .1, 4.1*spec.length], olive);
    for(const x of[-spec.span*.33,spec.span*.33]){
      if(AIRFIELDS[this.airfieldIndex].team==='ALLIED')for(const [radius,color]of[[.49,'#294963'],[.33,'#e3dec1'],[.16,'#a44f39']] as const){const mark=new T.Mesh(new T.CircleGeometry(radius,20),this.material(color));mark.rotation.x=-Math.PI/2;mark.position.set(x,1.54+( .5-radius)*.008,-1.4);this.aircraft.add(mark);}
      else {this.box(this.aircraft,[.95,.012,.3],[x,1.54,-1.4],dark);this.box(this.aircraft,[.3,.014,1.1],[x,1.54,-1.4],dark);}
    }
    if(this.sim.aircraftType==='bomber'){
      for(const x of[-spec.span*.18,spec.span*.18]){
        this.box(this.aircraft,[.72,.58,1.72],[x,.38,-1.72],olive);
      }
      const ring=new T.Mesh(new T.TorusGeometry(.42,.045,6,18),dark);ring.rotation.x=Math.PI/2;ring.position.set(0,.11,2.35);this.aircraft.add(ring);
      this.box(this.aircraft,[.32,.46,.24],[0,.24,2.35],this.material('#534735'));
      const head=new T.Mesh(new T.IcosahedronGeometry(.14,1),this.material('#9d7859'));head.position.set(0,.61,2.35);this.aircraft.add(head);
      this.rod(this.aircraft,[.22,.35,2.5],[.22,.48,3.4],.034,dark);
      for(let i=0;i<spec.bombs;i++){const bomb=bombModel();bomb.position.copy(rackPosition(i,spec.span));this.aircraft.add(bomb);this.bombRacks.push(bomb);}
    }
    for (const sign of [-1, 1]) {
      this.rod(this.aircraft, [sign * .4, -.5, -1.4], [sign * .76, -.77, -1.3], .045, dark);
      const wheel = new T.Mesh(new T.CylinderGeometry(.38, .38, .12, 12), dark);
      wheel.rotation.z = Math.PI / 2; wheel.position.set(sign * .76, -.77, -1.3); this.aircraft.add(wheel);
    }
    for (const sign of [-1, 1]) {
      this.box(this.aircraft, [.12, .6, 2.8], [sign * .98, -.24, .2], timber);
      this.rod(this.aircraft, [sign * .94, .1, 1.2], [sign * .94, .23, -.86], .07, timber);
      for (const z of [-1.95, -.85]) { this.rod(this.aircraft, [sign * 3.15*span, -.25, z], [sign * 3.15*span, 1.43, z], .035, timber); this.rod(this.aircraft, [sign * .5, .16, z], [sign * .85, 1.43, z], .025, dark); }
      this.rod(this.aircraft, [sign * .85, 1.4, -1.95], [sign * 3.15*span, -.25, -.85], .008, dark);
      this.rod(this.aircraft, [sign * .85, -.25, -1.95], [sign * 3.15*span, 1.4, -.85], .008, dark);
    }
    this.box(this.aircraft, [1.96, .98, .12], [0, -.17, -.64], panelMaterial);
    this.rod(this.aircraft, [-.98, .34, -.56], [.98, .34, -.56], .045, dark);
    this.label(`${this.sim.spec.name.toUpperCase()}`, 0, .28, -.565, .52);
    const configs: [string, string, number, () => number][] = [
      ['ALTITUDE', 'm', 2000, () => this.sim.position.y], ['AIRSPEED', 'km/h', Math.max(240,Math.ceil((this.sim.spec.overspeed+40)/20)*20), () => this.sim.indicatedAirspeed * 3.6],
      ['ENGINE', 'RPM', 2400, () => this.sim.rpm], ['COOLANT', '°C', 140, () => this.sim.temperature], ['FUEL', 'litres', this.sim.spec.fuel, () => this.sim.fuel]
    ];
    configs.forEach(([name, unit, max, read], i) => this.gauge(name, unit, max, read, (i<2?i:i+1)*.3-.75, .065, -.56));
    this.attitude=horizonMaterial();const horizon=new T.Mesh(new T.CircleGeometry(.134,40),this.attitude);horizon.position.set(-.15,.065,-.557);this.aircraft.add(horizon);
    const rim=new T.Mesh(new T.TorusGeometry(.135,.009,5,40),brass);rim.position.copy(horizon.position);rim.position.z+=.004;this.aircraft.add(rim);
    const symbol=new T.MeshBasicMaterial({color:'#ecd092'});this.box(this.aircraft,[.08,.009,.003],[-.21,.065,-.55],symbol);this.box(this.aircraft,[.08,.009,.003],[-.09,.065,-.55],symbol);this.box(this.aircraft,[.012,.027,.003],[-.15,.065,-.55],symbol);
    this.label('LEVEL',-.15,-.022,-.547,.13);
    this.label('THROTTLE', -.76, -.22, -.55, .24); this.label('MIXTURE', -.38, -.22, -.55, .24); this.label('RADIATOR', .38, -.22, -.55, .24);
    const lever = new T.Group(); lever.position.set(-.76, THROTTLE_BASE_Y, -.48); this.aircraft.add(lever);
    this.rod(lever, [0, 0, 0], [0, .16, .03], .018, brass); this.box(lever, [.12, .06, .055], [0, .16, .03], dark); this.knobs.throttle = lever;
    this.hit('throttle', -.76, -.30, -.39, .23, .28);
    for (const [name, x] of [['mixture', -.38], ['radiator', .38]] as const) {
      const wheel = new T.Group(); wheel.position.set(x, CONTROL_WHEEL_Y, -.44); this.aircraft.add(wheel);
      wheel.add(new T.Mesh(new T.TorusGeometry(.068, .014, 5, 12), brass));
      this.box(wheel, [.13, .012, .018], [0, 0, 0], brass); this.box(wheel, [.012, .13, .018], [0, 0, 0], brass);
      this.knobs[name] = wheel; this.hit(name, x, CONTROL_WHEEL_Y, -.40, .24, .22);
    }
    const yoke = new T.Group(); yoke.position.set(0, -.4, -.2); this.aircraft.add(yoke);
    this.rod(yoke, [0, -.25, -.1], [0, .12, 0], .025, dark);
    this.rod(yoke, [-.17, .15, 0], [.17, .15, 0], .024, dark);
    for (const x of [-.17, .17]) this.rod(yoke, [x, .1, 0], [x, .23, 0], .029, timber);
    this.knobs.yoke = yoke; this.hit('yoke', 0, -.27, -.12, .46, .3);
    this.label('IGNITION', .76, -.2, -.54, .25); this.label('BRAKE', .76, -.43, -.54, .22);
    for (const [name, y] of [['ignition', -.25], ['brake', -.45]] as const) {
      const button = new T.Group(); button.position.set(.76, y, -.44);
      const cap = new T.Mesh(new T.CylinderGeometry(.055, .055, .04, 12), name === 'ignition' ? brass : dark); cap.rotation.x = Math.PI / 2; button.add(cap); this.aircraft.add(button); this.knobs[name] = button;
      this.hit(name, .76, y, -.38, .2, .16);
    }
    this.propeller.position.set(0,0,0);
    if(this.sim.aircraftType==='bomber')for(const x of[-spec.span*.18,spec.span*.18]){const spinner=new T.Group();spinner.position.set(x,.38,-2.65);this.propeller.add(spinner);this.box(spinner,[.12,1.8,.07],[0,0,0],timber);}
    else {const spinner=new T.Group();spinner.position.set(0,0,-3.52);this.propeller.add(spinner);this.box(spinner,[.13,1.8,.08],[0,0,0],timber);}
    this.aircraft.add(this.propeller);
    this.buildGun(dark, brass, timber);
    if(spec.bombs>0){this.label('BOMB RELEASE',-.48,-.46,-.32,.30);
    const release=new T.Group();release.position.set(-.48,-.51,-.27);this.box(release,[.12,.065,.045],[0,0,0],this.material('#ad5d34'));this.aircraft.add(release);this.knobs.bomb=release;this.hit('bomb',-.48,-.51,-.23,.22,.11);
    this.bombCover=new T.Group();this.bombCover.position.set(-.48,-.44,-.235);this.box(this.bombCover,[.17,.14,.028],[0,-.07,0],this.material('#586057'));this.rod(this.bombCover,[-.1,0,0],[.1,0,0],.014,brass);this.aircraft.add(this.bombCover);}
    this.buildHands();
  }

  private handAnchor(control:Control){
    const parent:T.Object3D=this.knobs[control]??this.aircraft;
    const anchor=new T.Group();
    const positions:Partial<Record<Control,[number,number,number]>>={
      throttle:[0,.18,.07],mixture:[0,0,.07],radiator:[0,0,.07],yoke:[0,.17,.08],ignition:[0,0,.07],brake:[0,0,.07],
      trigger:[0,-.04,.04],cocking:[.16,0,.04],bomb:[0,0,.07]
    };
    anchor.position.set(...(positions[control]??[0,0,.07]));parent.add(anchor);this.handAnchors[control]=anchor;
  }
  private buildHands(){
    this.handAnchors={};
    for(const control of ['throttle','mixture','radiator','yoke','ignition','brake','trigger','cocking'] as Control[])this.handAnchor(control);
    if(this.knobs.bomb)this.handAnchor('bomb');
    const skin=this.material('#b98561'),cuff=this.material('#6e7967');
    for(const button of [0,2] as MouseButton[]){
      const hand=new T.Group();
      this.box(hand,[.13,.15,.055],[0,0,0],skin);
      for(let i=0;i<4;i++)this.rod(hand,[-.045+i*.03,.06,.005],[-.045+i*.03,.16,.012],.012,skin);
      this.rod(hand,[button===0?.075:-.075,.015,.005],[button===0?.13:-.13,.085,.012],.014,skin);
      this.box(hand,[.15,.08,.065],[0,-.105,-.005],cuff);hand.scale.setScalar(.82);hand.visible=false;this.aircraft.add(hand);this.hands[button]=hand;
    }
  }
  private placeHand(button:MouseButton,control:Control){
    const anchor=this.handAnchors[control],hand=this.hands[button];if(!anchor)return;
    anchor.add(hand);hand.position.set(button===0?-.045:.045,0,.035);hand.rotation.set(0,0,button===0?-.12:.12);hand.visible=true;
  }
  private buildGun(dark: T.Material, brass: T.Material, timber: T.Material) {
    const gun = new T.Group(); gun.position.set(.34, .48, -.55); this.aircraft.add(gun);
    this.box(gun, [.19, .19, .72], [0, 0, -.2], dark);
    this.gunBarrelMaterial=new T.MeshStandardMaterial({color:'#1b2420',emissive:'#000000',roughness:.62,metalness:.55,flatShading:true});
    const jacket = new T.Mesh(new T.CylinderGeometry(.062, .062, 2.25, 10), this.gunBarrelMaterial); jacket.rotation.x = Math.PI / 2; jacket.position.set(0, .025, -1.66); gun.add(jacket);
    for (let z = -.72; z > -2.65; z -= .18) { const ring = new T.Mesh(new T.TorusGeometry(.066, .009, 5, 10), this.gunBarrelMaterial); ring.position.set(0, .025, z); gun.add(ring); }
    this.rod(gun, [0, .025, -2.75], [0, .025, -3.05], .028, this.gunBarrelMaterial);
    // Ring-and-bead sight: both are on the true bore line, so gravity and lead still matter.
    const rearSight = new T.Mesh(new T.TorusGeometry(.085, .009, 7, 24), brass); rearSight.position.set(0, .22, .08); gun.add(rearSight);
    this.rod(gun, [0, .135, .08], [0, .22, .08], .007, brass);
    this.rod(gun, [0, .065, -2.83], [0, .22, -2.83], .008, brass);
    const bead = new T.Mesh(new T.SphereGeometry(.018, 8, 6), brass); bead.position.set(0, .22, -2.83); gun.add(bead);
    this.box(gun,[.29,.13,.025],[0,.02,.18],dark);
    this.ammoTexture=this.texture(192,80,c=>this.paintAmmo(c));const counter=new T.Mesh(new T.PlaneGeometry(.25,.1),new T.MeshBasicMaterial({map:this.ammoTexture}));counter.position.set(0,.02,.195);gun.add(counter);this.shownAmmo=this.gun.roundsRemaining;
    this.gunTrigger = new T.Group(); this.gunTrigger.position.set(-.13, -.08, .12); gun.add(this.gunTrigger);
    this.rod(this.gunTrigger, [0, .05, 0], [0, -.08, .02], .014, brass);
    const guard = new T.Mesh(new T.TorusGeometry(.075, .009, 5, 14, Math.PI), dark); guard.rotation.z = Math.PI / 2; guard.position.set(-.01, -.02, .015); this.gunTrigger.add(guard);
    this.cockingHandle = new T.Group(); this.cockingHandle.position.set(.14, .08, -.08); gun.add(this.cockingHandle);
    this.rod(this.cockingHandle, [0, 0, 0], [.12, 0, 0], .018, brass);
    const grip = new T.Mesh(new T.CylinderGeometry(.032, .032, .15, 8), timber); grip.rotation.z = Math.PI / 2; grip.position.x = .16; this.cockingHandle.add(grip);
    this.knobs.trigger=this.gunTrigger;this.knobs.cocking=this.cockingHandle;
    this.hit('trigger', .20, .37, -.34, .24, .25);
    this.hit('cocking', .55, .58, -.55, .26, .25);
  }
  private paintAmmo(c:CanvasRenderingContext2D){c.fillStyle='#111715';c.fillRect(0,0,192,80);c.strokeStyle='#8f8058';c.lineWidth=5;c.strokeRect(3,3,186,74);c.fillStyle='#aaa181';c.font='bold 16px monospace';c.textAlign='left';c.fillText('ROUNDS',12,21);c.fillStyle=this.gun.roundsRemaining<50?'#ef8665':'#ead58e';c.font='bold 43px monospace';c.textAlign='right';c.fillText(String(this.gun.roundsRemaining).padStart(3,'0'),178,66);}
  private updateAmmoDisplay(){if(!this.ammoTexture||this.shownAmmo===this.gun.roundsRemaining)return;this.shownAmmo=this.gun.roundsRemaining;this.paintAmmo((this.ammoTexture.image as HTMLCanvasElement).getContext('2d')!);this.ammoTexture.needsUpdate=true;}
  private gauge(name: string, unit: string, max: number, read: () => number, x: number, y: number, z: number) {
    const radius = .134;
    const map = this.texture(256, 256, c => {
      c.fillStyle = '#151e1c'; c.fillRect(0, 0, 256, 256); c.strokeStyle = '#596051'; c.lineWidth = 7; c.beginPath(); c.arc(128, 128, 118, 0, Math.PI * 2); c.stroke();
      const angle = (v: number) => (-225 + v / max * 270) * Math.PI / 180;
      if (unit === 'RPM' || unit === '°C') { c.strokeStyle = unit === 'RPM' ? '#7fa76e' : '#b96043'; c.lineWidth = 10; c.beginPath(); c.arc(128, 128, 104, angle(unit === 'RPM' ? 1550 : 110), angle(unit === 'RPM' ? 1950 : 140)); c.stroke(); }
      for (let i = 0; i <= 12; i++) { const a = angle(max * i / 12); c.strokeStyle = '#d0cbb2'; c.lineWidth = i % 3 === 0 ? 3 : 2; c.beginPath(); c.moveTo(128 + Math.cos(a) * 91, 128 + Math.sin(a) * 91); c.lineTo(128 + Math.cos(a) * 103, 128 + Math.sin(a) * 103); c.stroke(); if (i % 3 === 0) { c.font = '19px monospace'; c.fillStyle = '#e4dec2'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(String(Math.round(max * i / 12)), 128 + Math.cos(a) * 73, 128 + Math.sin(a) * 73); } }
      c.textAlign = 'center'; c.fillStyle = '#e7dcc0'; c.font = 'bold 17px monospace'; c.fillText(name, 128, 165); c.font = '17px monospace'; c.fillStyle = '#a9b09c'; c.fillText(unit, 128, 186);
    });
    const face = new T.Mesh(new T.CircleGeometry(radius, 40), new T.MeshBasicMaterial({ map })); face.position.set(x, y, z); this.aircraft.add(face);
    const rim = new T.Mesh(new T.TorusGeometry(radius, .009, 5, 40), this.material('#9a8b61')); rim.position.set(x, y, z + .002); this.aircraft.add(rim);
    const needle = new T.Group(); needle.position.set(x, y, z + .007); this.aircraft.add(needle);
    this.box(needle, [.008, radius * .67, .002], [0, radius * .26, 0], new T.MeshBasicMaterial({ color: '#e1bc77' }));
    const hub = new T.Mesh(new T.CircleGeometry(.012, 12), new T.MeshBasicMaterial({ color: '#bcaa75' })); hub.position.set(x, y, z + .012); this.aircraft.add(hub);
    this.gauges.push({ needle, max, read });
  }
  private hit(name: Control, x: number, y: number, z: number, width: number, height: number) {
    const mesh = new T.Mesh(new T.PlaneGeometry(width, height), new T.MeshBasicMaterial({ visible: false, side: T.DoubleSide })); mesh.position.set(x, y, z); mesh.userData.control = name; this.aircraft.add(mesh); this.hits.push(mesh);
  }
  private pick(e: MouseEvent): Control | null {
    const r = this.renderer.domElement.getBoundingClientRect(); this.pointer.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1);
    this.ray.setFromCamera(this.pointer, this.camera); return this.ray.intersectObjects(this.hits, false)[0]?.object.userData.control ?? null;
  }
  private wheelAngle(name:'mixture'|'radiator') {
    const ray=this.ray.ray.clone().applyMatrix4(this.aircraft.matrixWorld.clone().invert());
    const point=ray.intersectPlane(new T.Plane(new T.Vector3(0,0,1),.44),new T.Vector3());
    if(!point)return null;const x=point.x-(name==='mixture'?-.38:.38),y=point.y-CONTROL_WHEEL_Y;
    return Math.hypot(x,y)<.02?null:Math.atan2(y,x);
  }
  private contextmenu=(e:MouseEvent)=>e.preventDefault();
  private down = (e: MouseEvent) => {
    if ((e.button!==0&&e.button!==2)||this.paused||this.sim.crashed)return;
    const button=e.button as MouseButton;
    this.renderer.domElement.focus();this.startAudio();const picked=this.pick(e),chording=this.drags.size>0&&!this.drags.has(button),name=resolveMouseControl(picked,this.bindings[button],chording);if(!name)return;if(name===picked)this.bindings[button]=name;e.preventDefault();if(this.bombHand===button&&name!=='bomb'){this.bombCoverOpen=false;this.bombHand=null;}if(name==='cocking'){this.cockRatchet=0;this.playRatchet(0);}else this.playClick(name==='trigger'?'trigger':'light');
    this.placeHand(button,name);
    if (name === 'ignition' || name === 'brake') { this.sim.controls[name] = !this.sim.controls[name]; return; }
    if (name === 'bomb') {this.bombHand=button;if(bombButtonAction(this.bombCoverOpen)==='open'){this.bombCoverOpen=true;return;}this.releaseBomb(false);return;}
    const grabOffset = new T.Vector2();
    if (name === 'throttle'&&!!picked) {
      const rect = this.renderer.domElement.getBoundingClientRect();
      projectThrottleGrip(this.sim.controls.throttle, this.aircraft.matrixWorld, this.camera, rect.width, rect.height, grabOffset);
      grabOffset.x -= e.clientX - rect.left; grabOffset.y -= e.clientY - rect.top;
    }
    const initial = name === 'yoke' || name === 'trigger' || name === 'cocking' ? 0 : this.sim.controls[name];
    const id=e instanceof PointerEvent?e.pointerId:undefined;
    this.drags.set(button,{name,x:e.clientX,y:e.clientY,initial,pitch:this.sim.controls.pitch,roll:this.sim.controls.roll,id,grabOffset,direct:!!picked,wheel:picked&&(name==='mixture'||name==='radiator')?new WheelWinder(this.wheelAngle(name)):undefined});this.syncTrigger();
  };
  private move = (e: MouseEvent) => {
    if (this.paused || this.sim.crashed) { this.up(); return; }
    if(this.drags.size){
     for(const d of this.drags.values()){
      const scale = Math.max(140, this.mount.clientHeight * .28);
      if (d.name === 'yoke') { this.sim.controls.roll = clamp(d.roll + (e.clientX - d.x) / scale * 2, -1, 1); this.sim.controls.pitch = clamp(d.pitch + (e.clientY - d.y) / scale * 2, -1, 1); }
      else if (d.name === 'throttle'&&d.direct) {
        const rect = this.renderer.domElement.getBoundingClientRect();
        this.dragTarget.set(e.clientX - rect.left + d.grabOffset.x, e.clientY - rect.top + d.grabOffset.y);
        this.sim.controls.throttle = throttleAtPointer(this.dragTarget, this.aircraft.matrixWorld, this.camera, rect.width, rect.height);
      } else if(d.name==='throttle')this.sim.controls.throttle=clamp(d.initial-(e.clientY-d.y)/scale,0,1);
      else if ((d.name === 'mixture' || d.name === 'radiator')&&d.wheel) {this.pick(e);this.sim.controls[d.name]=d.wheel.update(this.wheelAngle(d.name),this.sim.controls[d.name]);}
      else if(d.name==='mixture'||d.name==='radiator')this.sim.controls[d.name]=clamp(d.initial-(e.clientY-d.y)/scale,0,1);
      else if (d.name === 'cocking') { const was=this.cockTravel;this.cockTravel = clamp((e.clientY - d.y) / Math.max(65, this.mount.clientHeight * .12), 0, 1);const tooth=Math.floor(this.cockTravel*7);if(tooth!==this.cockRatchet&&this.cockTravel<.92){this.cockRatchet=tooth;this.playRatchet(tooth);}if(this.cockTravel >= .92){this.gun.cock();if(was<.92)this.playCocking();} }
     }
    } else this.hover = this.pick(e);
    this.renderer.domElement.style.cursor = this.drags.size ? 'grabbing' : this.hover ? 'grab' : 'default';
  };
  private syncTrigger(){this.gun.trigger=[...this.drags.values()].some(d=>d.name==='trigger');}
  private up = (e?:MouseEvent) => {const finished=e&&(e.button===0||e.button===2)?[this.drags.get(e.button as MouseButton)].filter(Boolean) as Drag[]:[...this.drags.values()];if(e&&(e.button===0||e.button===2))this.drags.delete(e.button as MouseButton);else this.drags.clear();this.syncTrigger();if(!this.drags.size)for(const d of finished)if(d.id!==undefined&&this.renderer.domElement.hasPointerCapture(d.id))this.renderer.domElement.releasePointerCapture(d.id);};
  private touchDown=(e:PointerEvent)=>{if(e.pointerType==='mouse')return;this.down(e);if(this.drags.has(0))this.renderer.domElement.setPointerCapture(e.pointerId);};
  private touchMove=(e:PointerEvent)=>{if(e.pointerType!=='mouse')this.move(e);};
  private touchUp=(e:PointerEvent)=>{if(e.pointerType!=='mouse')this.up(e);};
  private keydown = (e: KeyboardEvent) => {
    if (this.paused || (e.target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'BUTTON'].includes(e.target.tagName))) return;
    const k = e.key.toLowerCase(); if (!'wasdqe'.includes(k) || k.length !== 1) return; e.preventDefault(); this.keys.add(k);
  };
  private keyup = (e: KeyboardEvent) => { this.keys.delete(e.key.toLowerCase()); };
  private blur = () => { this.keys.clear(); this.up(); };
  private visibility = () => { this.blur(); this.last = 0; this.accumulator = 0; if (document.hidden && this.audio && this.gain) this.gain.gain.setTargetAtTime(0, this.audio.currentTime, .04); };
  private resize = () => { const w = this.mount.clientWidth, h = this.mount.clientHeight; this.renderer.setSize(w, h); this.target.setSize(Math.round(600 * w / h), 600); this.camera.aspect = w / h; this.camera.fov = w / h < 1.3 ? 75 : 70; this.camera.updateProjectionMatrix(); };
  private setSpawn(){this.sim.spawn.copy(parkingPosition(this.terrain,this.airfieldIndex));}
  raiseForTesting(){if(!raiseAircraftForTesting(this.sim))return false;this.prevPosition.copy(this.sim.position);return true;}
  releaseBomb(sound=true){if(this.paused)return;if(sound){this.startAudio();this.playClick('heavy');}if(this.battle.release())this.battle.message=`BOMB AWAY · ${this.sim.bombsRemaining} REMAINING`;else if(this.sim.grounded)this.battle.message='BOMB RELEASE · AIRBORNE ONLY';else if(this.sim.bombsRemaining===0)this.battle.message='NO BOMBS · BOMBER CARRIES FOUR';}
  enterHangar(){
    if(!this.started)return false;const runway=stoppedRunway(this.sim),safe=runway>=0;
    if(!safe)this.battle.retirePlayer();this.blur();return !safe;
  }
  private resetView() { this.crashEffects.reset();this.aircraft.visible=true;this.propeller.visible=true;this.cockTravel=0;this.cockRatchet=0;this.gunRecoil=0;this.shownRounds=0;this.bombCoverOpen=false;this.bombHand=null;this.heardBlasts.clear(); this.prevPosition.copy(this.sim.position); this.prevRotation.copy(this.sim.orientation); this.yaw = 0; this.pitch = -.23;this.pilotLateral=0; this.accumulator = 0; this.blur();this.hover=null; }
  startSortie(type:AircraftType,airfieldIndex:number){
    if(!(type in AIRCRAFT)||!Number.isInteger(airfieldIndex)||airfieldIndex<0||airfieldIndex>=AIRFIELDS.length)throw new Error('Invalid aircraft or airfield');
    const parking=parkingPosition(this.terrain,airfieldIndex);
    if(this.battle.planes.slice(1).some(p=>!p.sim.crashed&&p.sim.position.distanceTo(parking)<24)){this.battle.message='PARKING OCCUPIED · CHOOSE OTHER AIRFIELD';return false;}
    this.crashEffects.reset();this.releaseAircraft();this.sim.aircraftType=type;this.airfieldIndex=airfieldIndex;this.setSpawn();this.sim.reset();this.gun.reset();this.resetView();this.buildAircraft();
    this.battle.setPlayerTeam(AIRFIELDS[airfieldIndex].team);
    const p=this.battle.planes[0];p.homeField=airfieldIndex;p.rear.reset();p.cooldown=0;p.respawnQueued=false;p.generation++;p.previous.copy(this.sim.position);p.rotation.copy(this.sim.orientation);
    this.flightId=`${this.worldId}:${++this.sortieNumber}`;
    this.started=true;this.previewField=null;this.world.updateBuildings(this.battle.buildings);return true;
  }
  private releaseAircraft(){
    const geometries=new Set<T.BufferGeometry>(),materials=new Set<T.Material>();this.aircraft.traverse(o=>{if(o instanceof T.Mesh){geometries.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material])materials.add(m);}});
    geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());this.labels.forEach(t=>t.dispose());this.labels=[];this.aircraft.clear();this.gauges=[];this.hits=[];this.knobs={};this.bombRacks.length=0;this.propeller=new T.Group();this.gunTrigger=new T.Group();this.cockingHandle=new T.Group();this.gunBarrelMaterial=null;this.bombCover=new T.Group();this.attitude=null;this.ammoTexture=null;this.shownAmmo=-1;
  }
  private startAudio() {
    if (!this.audio) {
      this.audio = new AudioContext();this.gain=this.audio.createGain();this.gain.gain.value=0;const compressor=this.audio.createDynamicsCompressor();compressor.threshold.value=-18;compressor.ratio.value=5;this.gain.connect(compressor);compressor.connect(this.audio.destination);
      const filter=this.audio.createBiquadFilter();filter.type='lowpass';filter.frequency.value=520;filter.Q.value=.7;filter.connect(this.gain);
      for(const [type,level] of [['sawtooth',.42],['square',.11],['triangle',.24]] as const){const oscillator=this.audio.createOscillator(),g=this.audio.createGain();oscillator.type=type;g.gain.value=level;oscillator.connect(g);g.connect(filter);oscillator.start();this.oscillators.push(oscillator);}
      this.noiseBuffer=this.audio.createBuffer(1,this.audio.sampleRate*2,this.audio.sampleRate);const data=this.noiseBuffer.getChannelData(0);let brown=0;for(let i=0;i<data.length;i++){brown=(brown+(Math.random()*2-1)*.16)/1.02;data[i]=brown*.65;}
      this.blastNoiseBuffer=this.audio.createBuffer(1,this.audio.sampleRate*2,this.audio.sampleRate);const blastData=this.blastNoiseBuffer.getChannelData(0);for(let i=0;i<blastData.length;i++)blastData[i]=Math.random()*2-1;
      this.engineNoise=this.audio.createBufferSource();this.engineNoise.buffer=this.noiseBuffer;this.engineNoise.loop=true;this.noiseGain=this.audio.createGain();const noiseFilter=this.audio.createBiquadFilter();noiseFilter.type='bandpass';noiseFilter.frequency.value=135;noiseFilter.Q.value=.8;this.noiseGain.gain.value=.13;this.engineNoise.connect(noiseFilter);noiseFilter.connect(this.noiseGain);this.noiseGain.connect(filter);this.engineNoise.start();
    }
    void this.audio.resume();
  }
  private playClick(weight:'light'|'heavy'|'trigger'){
    if(!this.audio)return;const now=this.audio.currentTime,osc=this.audio.createOscillator(),gain=this.audio.createGain(),filter=this.audio.createBiquadFilter();filter.type='bandpass';filter.Q.value=2.5;
    const heavy=weight==='heavy';osc.type=weight==='trigger'?'square':'triangle';osc.frequency.setValueAtTime(heavy?135:weight==='trigger'?410:270,now);osc.frequency.exponentialRampToValueAtTime(heavy?58:110,now+.035);filter.frequency.value=heavy?520:1100;gain.gain.setValueAtTime(heavy?.12:.07,now);gain.gain.exponentialRampToValueAtTime(.0001,now+(heavy?.085:.045));osc.connect(filter);filter.connect(gain);gain.connect(this.audio.destination);osc.start(now);osc.stop(now+(heavy?.09:.05));
  }
  private mechanicalNoise(when:number,duration:number,frequency:number,q:number,volume:number,type:BiquadFilterType='bandpass'){
    if(!this.audio||!this.noiseBuffer)return;const source=this.audio.createBufferSource(),filter=this.audio.createBiquadFilter(),gain=this.audio.createGain();source.buffer=this.noiseBuffer;source.playbackRate.value=.8+Math.random()*.35;filter.type=type;filter.frequency.value=frequency;filter.Q.value=q;gain.gain.setValueAtTime(volume,when);gain.gain.exponentialRampToValueAtTime(.0001,when+duration);source.connect(filter);filter.connect(gain);gain.connect(this.audio.destination);source.start(when,Math.random(),duration+.012);
  }
  private playRatchet(tooth:number){
    if(!this.audio)return;const now=this.audio.currentTime;this.mechanicalNoise(now,.026,760+tooth*55,1.1,.075);this.mechanicalNoise(now+.006,.012,2050-tooth*45,2.8,.105,'highpass');
  }
  private playCocking(){
    if(!this.audio)return;const now=this.audio.currentTime;this.mechanicalNoise(now,.065,390,.7,.22,'lowpass');this.mechanicalNoise(now+.008,.028,1850,2.2,.13,'highpass');
    // Quiet, inharmonic resonances suggest steel ringing without forming a musical interval.
    for(const [frequency,volume,decay]of[[1687,.026,.085],[2311,.018,.12]] as const){const tone=this.audio.createOscillator(),gain=this.audio.createGain();tone.type='sine';tone.frequency.value=frequency;gain.gain.setValueAtTime(volume,now+.012);gain.gain.exponentialRampToValueAtTime(.0001,now+.012+decay);tone.connect(gain);gain.connect(this.audio.destination);tone.start(now+.012);tone.stop(now+.025+decay);}
  }
  private playGunshot(heat:number){
    if(!this.audio||!this.noiseBuffer)return;const now=this.audio.currentTime,source=this.audio.createBufferSource(),filter=this.audio.createBiquadFilter(),gain=this.audio.createGain(),body=this.audio.createOscillator(),bodyGain=this.audio.createGain(),crack=this.audio.createOscillator(),crackGain=this.audio.createGain();source.buffer=this.noiseBuffer;source.playbackRate.value=.82-heat*.22+Math.random()*.08;filter.type='bandpass';filter.frequency.value=880-heat*390;filter.Q.value=.72;gain.gain.setValueAtTime(.34+heat*.06,now);gain.gain.exponentialRampToValueAtTime(.0001,now+.085+heat*.05);source.connect(filter);filter.connect(gain);gain.connect(this.audio.destination);body.type=heat>.65?'sawtooth':'square';body.frequency.setValueAtTime(105-heat*34+Math.random()*10,now);body.frequency.exponentialRampToValueAtTime(42,now+.065);bodyGain.gain.setValueAtTime(.2,now);bodyGain.gain.exponentialRampToValueAtTime(.0001,now+.075);body.connect(bodyGain);bodyGain.connect(this.audio.destination);crack.type='triangle';crack.frequency.setValueAtTime(1450-heat*420,now);crack.frequency.exponentialRampToValueAtTime(520,now+.022);crackGain.gain.setValueAtTime(.15,now);crackGain.gain.exponentialRampToValueAtTime(.0001,now+.03);crack.connect(crackGain);crackGain.connect(this.audio.destination);source.start(now,Math.random());source.stop(now+.15);body.start(now);body.stop(now+.08);crack.start(now);crack.stop(now+.035);
  }
  private playExplosion(distance:number){
    if(!this.audio||!this.blastNoiseBuffer)return;const now=this.audio.currentTime,level=clamp(1-distance/2000,.05,1),bus=this.audio.createGain(),delay=this.audio.createDelay(1),feedback=this.audio.createGain();bus.gain.value=level;delay.delayTime.value=.29+Math.min(.16,distance/9000);feedback.gain.value=.27;bus.connect(this.audio.destination);bus.connect(delay);delay.connect(this.audio.destination);delay.connect(feedback);feedback.connect(delay);
    const noise=(when:number,duration:number,frequency:number,q:number,volume:number,type:BiquadFilterType='bandpass')=>{const source=this.audio!.createBufferSource(),filter=this.audio!.createBiquadFilter(),gain=this.audio!.createGain();source.buffer=this.blastNoiseBuffer;filter.type=type;filter.frequency.value=frequency;filter.Q.value=q;gain.gain.setValueAtTime(volume,when);gain.gain.exponentialRampToValueAtTime(.0001,when+duration);source.connect(filter);filter.connect(gain);gain.connect(bus);source.start(when,Math.random()*.35,duration+.01);};
    // Report, expanding gas roar, then a long granular tail.
    noise(now,.105,1150,.55,.5,'highpass');noise(now,.82,175,.5,.48,'lowpass');noise(now+.035,1.55,760,.65,.15);
    const boom=this.audio.createOscillator(),boomGain=this.audio.createGain();boom.type='sine';boom.frequency.setValueAtTime(54,now);boom.frequency.exponentialRampToValueAtTime(19,now+1.2);boomGain.gain.setValueAtTime(.38,now);boomGain.gain.exponentialRampToValueAtTime(.0001,now+1.35);boom.connect(boomGain);boomGain.connect(bus);boom.start(now);boom.stop(now+1.4);
    for(let i=0;i<14;i++){const t=.08+Math.random()*1.45,fade=1-t/1.7;noise(now+t,.018+Math.random()*.045,1450+Math.random()*2600,1.2+Math.random()*2,.055*fade,'highpass');}
    // Two softer, darker reports keep the echo from sounding like a single delay tap.
    noise(now+.42,.32,260,.7,.15,'lowpass');noise(now+.86,.4,210,.65,.08,'lowpass');
    window.setTimeout(()=>{bus.disconnect();delay.disconnect();feedback.disconnect();},4000);
  }
  private registerTools() {
    type Tool = { name: string; description: string; inputSchema: object; annotations: { readOnlyHint: boolean }; execute: (input: unknown) => unknown };
    const context = (document as Document & { modelContext?: { registerTool: (tool: Tool, options: { signal: AbortSignal }) => void | Promise<void> } }).modelContext;
    if (!context?.registerTool) return;
    const validateEmpty = (input: unknown) => { if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length) throw new Error('Expected an empty object.'); };
    const tools: Tool[] = [
      { name: 'read_flight_instruments', description: 'Read the current aircraft instruments and persistent cockpit controls.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true }, execute: input => { validateEmpty(input); const s = this.sim,indicatedAirspeedKmh=s.indicatedAirspeed*3.6; return { altitudeMetres: s.position.y, indicatedAirspeedKmh,overspeedLimitKmh:s.spec.overspeed,criticalSpeedKmh:s.criticalSpeedKmh,overspeedShake:overspeedShakeAmount(indicatedAirspeedKmh,s.spec.overspeed), rpm: s.rpm, temperatureC: s.temperature, fuelLitres: s.fuel, stalled: s.stall, crashed: s.crashed, controls: { ...s.controls } }; } }
    ];
    for (const tool of tools) try { void Promise.resolve(context.registerTool(tool, { signal: this.toolLifecycle.signal })).catch(() => {}); } catch { /* Optional browser capability; flight remains available. */ }
  }
  private updateTracers() {
    const center = new T.Vector3(), direction = new T.Vector3(), rotation = new T.Quaternion(), scale = new T.Vector3(), matrix = new T.Matrix4();
    let n = 0;
    for (const p of this.battle.planes.flatMap(p=>[...p.gun.projectiles,...p.rear.projectiles])) {
      if (!p.tracer || n >= 128) continue;
      direction.copy(p.velocity).normalize();
      // Grow the streak from the muzzle; never draw a tail farther back than
      // the round could have travelled since it was fired.
      const desiredLength = Math.max(24, p.previous.distanceTo(p.position) * 2.5);
      const travelledDistance = p.age * p.velocity.length();
      const length = Math.max(.25, Math.min(desiredLength, travelledDistance));
      center.copy(p.position).addScaledVector(direction, -length * .5);
      rotation.setFromUnitVectors(new T.Vector3(0, 0, 1), direction);
      scale.set(.075, .075, length);
      matrix.compose(center, rotation, scale);
      this.tracers.setMatrixAt(n, matrix);
      n++;
    }
    this.tracers.count = n; this.tracers.instanceMatrix.needsUpdate = true;
  }
  private animate = (now: number) => {
    this.frame = requestAnimationFrame(this.animate);
    const elapsed = this.last ? Math.min((now - this.last) / 1000, .1) : 0; this.last = now;
    if (elapsed > 0) this.fps += (1 / elapsed - this.fps) * .04;
    const active = this.started && this.previewField===null && !this.paused && !document.hidden;
    if (active) {
      this.yaw = turnHeadYaw(this.yaw,(this.keys.has('a') ? 1 : 0) - (this.keys.has('d') ? 1 : 0),elapsed);
      this.pitch = clamp(this.pitch + ((this.keys.has('w') ? 1 : 0) - (this.keys.has('s') ? 1 : 0)) * elapsed*1.65, -1.05, .85);
      this.pilotLateral=movePilotLateral(this.pilotLateral,(this.keys.has('e')?1:0)-(this.keys.has('q')?1:0),elapsed);
      this.accumulator += elapsed;
      while (this.accumulator >= DT) { this.prevPosition.copy(this.sim.position); this.prevRotation.copy(this.sim.orientation); this.battle.step(DT); this.accumulator -= DT; }
    } else { this.accumulator = 0; this.prevPosition.copy(this.sim.position); this.prevRotation.copy(this.sim.orientation); this.blur(); }
    this.aircraft.position.lerpVectors(this.prevPosition, this.sim.position, this.accumulator / DT); this.aircraft.quaternion.slerpQuaternions(this.prevRotation, this.sim.orientation, this.accumulator / DT);
    this.look.setFromEuler(new T.Euler(this.pitch, this.yaw, 0, 'YXZ'));
    if(this.previewField!==null)this.aircraft.visible=false;else if(!this.sim.crashed||this.sim.crashCause==='PROP STRIKE')this.aircraft.visible=true;
    if(this.previewField!==null){const f=AIRFIELDS[this.previewField],y=this.terrain.airfieldHeights[this.previewField];this.camera.position.set(f.x+380,y+330,f.z+550);this.camera.lookAt(f.x-70,y,f.z+150);}
    else if(!this.sim.crashed){
      this.camera.position.set(this.pilotLateral,.68,PILOT_FORWARD_OFFSET).applyQuaternion(this.aircraft.quaternion).add(this.aircraft.position);this.camera.quaternion.copy(this.aircraft.quaternion).multiply(this.look);
    }else{
      if(!this.crashEffects.active){
        this.aircraft.position.copy(this.sim.position);this.aircraft.quaternion.copy(this.sim.orientation);this.aircraft.updateMatrixWorld(true);
        this.camera.position.set(this.pilotLateral,.68,PILOT_FORWARD_OFFSET).applyQuaternion(this.aircraft.quaternion).add(this.aircraft.position);this.camera.quaternion.copy(this.aircraft.quaternion).multiply(this.look);
        if(this.sim.crashCause==='PROP STRIKE')this.crashEffects.detach(this.propeller,this.sim.impactVelocity,this.sim.impactSpeed);
        else {this.crashEffects.start(this.aircraft,this.sim.impactVelocity,this.sim.impactSpeed,this.camera);this.yaw=0;this.pitch=0;this.look.identity();}
        this.up();this.hover=null;
      }
      if(this.sim.crashCause==='PROP STRIKE'){
        this.camera.position.set(this.pilotLateral,.68,PILOT_FORWARD_OFFSET).applyQuaternion(this.aircraft.quaternion).add(this.aircraft.position);this.camera.quaternion.copy(this.aircraft.quaternion).multiply(this.look);
        this.crashEffects.update(active?elapsed:0,this.camera);
      }else {this.crashEffects.update(active?elapsed:0,this.camera);this.camera.quaternion.multiply(this.look);}
    }
    if(active&&!this.sim.crashed){
      const shake=overspeedShakeAmount(this.sim.indicatedAirspeed*3.6,this.sim.spec.overspeed);
      if(shake>0){
        this.shakeOffset.set(Math.sin(now*.091)+Math.sin(now*.173)*.45,Math.cos(now*.117)+Math.sin(now*.209)*.35,Math.sin(now*.151)*.4).multiplyScalar(.018*shake).applyQuaternion(this.aircraft.quaternion);
        this.camera.position.add(this.shakeOffset);
        this.shakeEuler.set(Math.sin(now*.137)*.006*shake,Math.cos(now*.163)*.004*shake,Math.sin(now*.103)*.007*shake,'YXZ');this.shakeRotation.setFromEuler(this.shakeEuler);
        this.camera.quaternion.multiply(this.shakeRotation);
      }
    }
    this.camera.updateMatrixWorld();
    const activeBlasts=new Set<number>();for(const blast of this.battle.blasts){activeBlasts.add(blast.id);if(!this.heardBlasts.has(blast.id)){this.heardBlasts.add(blast.id);this.playExplosion(this.camera.position.distanceTo(blast.position));}}if(this.heardBlasts.size>64)for(const id of this.heardBlasts)if(!activeBlasts.has(id))this.heardBlasts.delete(id);
    this.battleView.update(active?elapsed:0,active?this.accumulator/DT:1,this.camera);this.world.updateBuildings(this.battle.buildings);this.bombRacks.forEach((b,i)=>b.visible=i>=this.sim.spec.bombs-this.sim.bombsRemaining);
    for (const g of this.gauges) g.needle.rotation.z = (135 - clamp(g.read() / g.max, 0, 1) * 270) * Math.PI / 180;
    if(this.attitude){const a=readAttitude(this.sim.orientation);this.attitude.uniforms.pitch.value=a.pitch;this.attitude.uniforms.roll.value=a.roll;}
    const c = this.sim.controls;
    this.knobs.throttle!.rotation.x = throttleAngle(c.throttle);
    this.knobs.mixture!.rotation.z = -c.mixture * Math.PI * 3; this.knobs.radiator!.rotation.z = -c.radiator * Math.PI * 3;
    this.knobs.yoke!.rotation.z = -c.roll * .6; this.knobs.yoke!.rotation.x = c.pitch * .45;
    this.knobs.ignition!.position.z = c.ignition ? -.47 : -.44;
    const brakePose=brakeButtonPose(c.brake,this.sim.rpm,now);this.knobs.brake!.position.set(brakePose.x,brakePose.y,brakePose.z);this.knobs.brake!.rotation.z=brakePose.rotation;
    this.cockTravel = [...this.drags.values()].some(d=>d.name==='cocking') ? this.cockTravel : Math.max(0, this.cockTravel - elapsed * 5);
    const needsCock=this.gun.trigger&&(!this.gun.cocked||this.gun.jammed),shake=needsCock?Math.sin(now*.075)*.014:0;this.cockingHandle.position.set(.14+shake,.08+(needsCock?Math.cos(now*.11)*.009:0),-.08+this.cockTravel*.28);this.cockingHandle.rotation.z=needsCock?Math.sin(now*.13)*.09:0;
    if(this.bombCover.parent){const targetRotation=this.bombCoverOpen?-2.25:0;this.bombCover.rotation.x+=(targetRotation-this.bombCover.rotation.x)*Math.min(1,elapsed*18);}
    if (this.gun.roundsFired !== this.shownRounds) { this.shownRounds = this.gun.roundsFired; this.gunRecoil = 1;this.playGunshot(this.gun.heat); }
    if(this.gunBarrelMaterial){const appearance=gunBarrelAppearance(this.gun.heat);this.gunBarrelMaterial.color.setRGB(...appearance.color);this.gunBarrelMaterial.emissive.setRGB(...appearance.emissive);this.gunBarrelMaterial.emissiveIntensity=appearance.intensity;}
    this.updateAmmoDisplay();
    this.gunRecoil = Math.max(0, this.gunRecoil - elapsed * 18);
    this.gunTrigger.rotation.x = (this.gun.trigger ? -.34 : 0) + this.gunRecoil * .08;
    for(const button of[0,2] as MouseButton[]){const hand=this.hands[button];if(hand.visible){const active=this.drags.has(button);hand.position.z=active?.01:.035;hand.rotation.x=active?.12:0;}}
    this.updateTracers();
    if (active) for(const spinner of this.propeller.children)spinner.rotation.z += this.sim.rpm * Math.PI / 30 * elapsed;
    this.cockpit.updateMatrixWorld(true);
    this.renderer.setRenderTarget(this.target); this.renderer.clear(); this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(null); this.renderer.clear(); this.renderer.render(this.screen, this.screenCamera); this.renderer.clearDepth(); this.renderer.render(this.cockpit, this.camera);
    if (this.audio&&this.gain&&this.oscillators.length) {const base=18+this.sim.rpm/29,rough=1-this.sim.health*.65-this.sim.mixtureEfficiency*.18;this.oscillators[0].frequency.setTargetAtTime(base,this.audio.currentTime,.08);this.oscillators[1].frequency.setTargetAtTime(base*2.01+(this.sim.aircraftType==='bomber'?1.8:0),this.audio.currentTime,.1);this.oscillators[2].frequency.setTargetAtTime(base*.503,this.audio.currentTime,.14);if(this.noiseGain)this.noiseGain.gain.setTargetAtTime(.09+c.throttle*.08+Math.max(0,rough)*.14,this.audio.currentTime,.12);this.gain.gain.setTargetAtTime(active&&this.sim.engine!=='off'&&!this.sim.crashed?.075+c.throttle*.055:0,this.audio.currentTime,.12);}
    if (now - this.reportTime > 120) {
      this.reportTime = now; const s = this.sim;
      const status = s.crashed ? `CRASHED · ${s.crashCause || 'IMPACT'} · ENTER HANGAR` : this.gun.roundsRemaining === 0 ? 'GUN EMPTY · ENTER HANGAR TO REARM' : this.gun.jammed ? 'GUN JAMMED · CYCLE COCKING HANDLE' : this.gun.heat > .72 ? 'GUN HOT · DISPERSION INCREASING' : Math.max(Math.abs(s.position.x),Math.abs(s.position.z))>4800?'MAP EDGE · TURN BACK':s.stall ? 'STALL · LOWER THE NOSE' : s.temperature > 110 ? 'ENGINE HOT · OPEN RADIATOR' : s.grounded ? (s.engine === 'off' ? 'PARKED · ENGINE OFF' : c.brake ? 'ENGINE ' + s.engine.toUpperCase() + ' · BRAKE SET' : 'GROUND ROLL · OPEN AIRSPACE') : 'AIRBORNE · OPEN AIRSPACE';
      const control = [...this.drags.values()][0]?.name ?? this.hover;
      const value = control === 'yoke' ? `PITCH ${Math.round(c.pitch * 100)}% · ROLL ${Math.round(c.roll * 100)}%` : control === 'ignition' ? c.ignition ? 'ON' : 'OFF' : control === 'brake' ? c.brake ? 'SET — CLICK TO RELEASE' : 'RELEASED' : control === 'trigger' ? this.gun.roundsRemaining === 0 ? 'EMPTY' : this.gun.jammed ? 'JAMMED' : this.gun.cocked ? `READY · ${this.gun.roundsRemaining} ROUNDS` : 'NOT COCKED' : control === 'cocking' ? `${this.gun.cocked ? 'ACTION READY' : 'PULL DOWN FULLY'} · ${Math.round(this.cockTravel * 100)}%` : control === 'bomb' ? `${s.bombsRemaining} REMAINING · CLICK TO RELEASE` : control ? Math.round(c[control] * 100) + '%' : '';
      const hint = control ? `${control.toUpperCase()} · ${value}${control==='mixture'||control==='radiator'?' · WIND CLOCKWISE TO INCREASE':control==='throttle'||control==='yoke'?' · DRAG TO ADJUST':control==='cocking'?' · DRAG DOWN AND RELEASE':''}` : s.crashed ? 'Enter the hangar to choose another aircraft or airfield.' : this.gun.roundsRemaining === 0 ? 'Ammunition exhausted. Enter the hangar to rearm.' : this.gun.jammed ? 'The gun has jammed. Drag the brass cocking handle fully down, then release.' : !this.gun.cocked ? 'Cock the gun once: drag its brass side handle fully down, then release.' : !c.ignition ? 'Click IGNITION in the cockpit to start your engine.' : c.brake && s.grounded ? 'Release BRAKE, then drag THROTTLE upward.' : 'Sight through the ring and bead · Hold the gun trigger to fire';
      const attitude=readAttitude(s.orientation);
      const altitudeAboveGround=Math.max(0,s.position.y-this.terrain.heightAt(s.position.x,s.position.z)-1.15);
      this.report(status, hint, `${this.fps.toFixed(0)} FPS · 60 Hz physics\nALT ${s.position.y.toFixed(1)} m  IAS ${(s.indicatedAirspeed * 3.6).toFixed(1)} km/h  LIMIT ${s.spec.overspeed} km/h\nAoA ${(s.alpha * 180 / Math.PI).toFixed(1)}°  LOAD ${s.loadFactor.toFixed(2)} g  V/S ${s.velocity.y.toFixed(1)} m/s\nLIFT ${s.lift.toFixed(0)} N  DRAG ${s.drag.toFixed(0)} N\nQ ${s.dynamicPressure.toFixed(0)} Pa  ELEV ${(s.effectiveElevator*100).toFixed(0)}%  RADIATOR DRAG ${s.radiatorDrag.toFixed(0)} N\nGROUND LOAD ${(s.groundLoad/9.81).toFixed(2)} g  PROP CLEAR ${Number.isFinite(s.propClearance)?s.propClearance.toFixed(2):'—'} m\nROLL ${(attitude.roll*180/Math.PI).toFixed(0)}° PITCH ${(attitude.pitch*180/Math.PI).toFixed(0)}°\nRPM ${s.rpm.toFixed(0)}  TEMP ${s.temperature.toFixed(1)}°C\nGUN ${this.gun.jammed?'JAMMED':this.gun.cocked?'READY':'SAFE'}  HEAT ${(this.gun.heat*100).toFixed(0)}%  AMMO ${this.gun.roundsRemaining}/${AMMO_CAPACITY}\nFUEL ${s.fuel.toFixed(1)} L  ENGINE ${(s.health * 100).toFixed(0)}%\nPOS ${s.position.x.toFixed(0)}, ${s.position.z.toFixed(0)}`,{started:this.started,flightId:this.flightId,canHangar:this.canHangar(),aircraftType:s.aircraftType,airfieldIndex:this.airfieldIndex,x:s.position.x,z:s.position.z,heading:-new T.Euler().setFromQuaternion(s.orientation,'YXZ').y*180/Math.PI,altitude:s.position.y,altitudeAboveGround,grounded:s.grounded,crashed:s.crashed,battle:this.battle.info()});
    }
  };
  dispose() {
    this.battleView.dispose();
    this.crashEffects.dispose();this.world.dispose();
    this.toolLifecycle.abort();
    cancelAnimationFrame(this.frame); this.resizeObserver.disconnect(); this.blur();
    const canvas=this.renderer.domElement;canvas.removeEventListener('mousedown',this.down);window.removeEventListener('mousemove',this.move);window.removeEventListener('mouseup',this.up);
    canvas.removeEventListener('pointerdown',this.touchDown);canvas.removeEventListener('pointermove',this.touchMove);canvas.removeEventListener('pointerup',this.touchUp);canvas.removeEventListener('pointercancel',this.touchUp);canvas.removeEventListener('lostpointercapture',this.touchUp);canvas.removeEventListener('contextmenu',this.contextmenu);
    window.removeEventListener('keydown', this.keydown); window.removeEventListener('keyup', this.keyup); window.removeEventListener('blur', this.blur); document.removeEventListener('visibilitychange', this.visibility);
    const geometries = new Set<T.BufferGeometry>(), materials = new Set<T.Material>();
    for (const scene of [this.scene, this.cockpit, this.screen]) scene.traverse(o => { if (o instanceof T.Mesh) { geometries.add(o.geometry); for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.add(m); } });
    geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); this.labels.forEach(t => t.dispose()); this.tracerGeometry.dispose(); this.target.dispose(); this.renderer.dispose(); canvas.remove(); void this.audio?.close();
  }
}


