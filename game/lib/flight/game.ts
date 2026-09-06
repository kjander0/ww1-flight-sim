import * as T from 'three';
import { FlightSimulation, DT, clamp } from './simulation';
import { createFuselage, projectThrottleGrip, throttleAngle, throttleAtPointer, WheelWinder } from './cockpit';
import { AIRCRAFT, AircraftType } from './aircraft';
import { AIRFIELDS, Terrain } from './terrain';
import { WorldView } from './world';
import { CrashEffects } from './crash';
import { horizonMaterial, readAttitude } from './attitude';
import { AMMO_CAPACITY, MachineGun } from './weapons';
import { Battle, type BattleInfo, rackPosition } from './battle';
import { BattleView, bombModel } from './battle-view';
import { parkingPosition, stoppedRunway, turnHeadYaw } from './airfield-ops';
export type FlightInfo={started:boolean;canHangar:boolean;aircraftType:AircraftType;airfieldIndex:number;x:number;z:number;heading:number;altitude:number;crashed:boolean;battle:BattleInfo};

type Control = 'throttle' | 'mixture' | 'radiator' | 'yoke' | 'ignition' | 'brake' | 'trigger' | 'cocking' | 'bomb';
type Gauge = { needle: T.Group; max: number; read: () => number };
type MouseButton=0|2;
type Drag={name:Control;x:number;y:number;initial:number;pitch:number;roll:number;id?:number;grabOffset:T.Vector2;direct:boolean;wheel?:WheelWinder};
export function resolveMouseControl<T>(picked:T|null,bound:T|null,chording:boolean){return chording&&bound?bound:picked??bound;}
export class FlightGame {
  private started=false;
  private previewField:number|null=0;
  previewHangar(field:number|null){this.previewField=field;}
  private canHangar(){return !this.started||!!this.battle.winner||stoppedRunway(this.sim)>=0;}
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
  private camera = new T.PerspectiveCamera(60, 1, .025, 12000);
  private target = new T.WebGLRenderTarget(640, 360, { minFilter: T.NearestFilter, magFilter: T.NearestFilter });
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
  private yaw = 0; private pitch = -.23; private frame = 0; private last = 0; private accumulator = 0; private reportTime = 0;
  private prevPosition = new T.Vector3(); private prevRotation = new T.Quaternion(); private look = new T.Quaternion();
  private propeller = new T.Group(); private resizeObserver: ResizeObserver;
  private labels: T.Texture[] = []; private fps = 60;
  readonly gun = new MachineGun();
  private gunTrigger = new T.Group(); private cockingHandle = new T.Group(); private cockTravel = 0; private gunRecoil = 0; private shownRounds = 0;
  private tracerGeometry = new T.BoxGeometry(1, 1, 1); private tracers: T.InstancedMesh;
  private toolLifecycle = new AbortController();
  private audio: AudioContext | null = null; private oscillator: OscillatorNode | null = null; private gain: GainNode | null = null;
  constructor(private mount: HTMLElement, private report: (status: string, hint: string, telemetry: string, info:FlightInfo) => void) {
    this.renderer = new T.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.autoClear = false; this.renderer.outputColorSpace = T.SRGBColorSpace;
    this.renderer.domElement.tabIndex = 0;
    this.renderer.domElement.setAttribute('aria-label', 'Flight simulator. WASD look; I ignition; B brake; X center yoke; C center view. Left and right mouse buttons each bind a hand to a cockpit control; repeat that button to reuse its control.');
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
    this.box(this.aircraft, [1.96, .77, .12], [0, -.065, -.64], panelMaterial);
    this.rod(this.aircraft, [-.98, .34, -.56], [.98, .34, -.56], .045, dark);
    this.label(`${this.sim.spec.name.toUpperCase()}`, 0, .28, -.565, .52);
    const configs: [string, string, number, () => number][] = [
      ['ALTITUDE', 'm', 2000, () => this.sim.position.y], ['AIRSPEED', 'km/h', 240, () => this.sim.indicatedAirspeed * 3.6],
      ['ENGINE', 'RPM', 2400, () => this.sim.rpm], ['COOLANT', '°C', 140, () => this.sim.temperature], ['FUEL', 'litres', this.sim.spec.fuel, () => this.sim.fuel]
    ];
    configs.forEach(([name, unit, max, read], i) => this.gauge(name, unit, max, read, (i<2?i:i+1)*.3-.75, .065, -.56));
    this.attitude=horizonMaterial();const horizon=new T.Mesh(new T.CircleGeometry(.134,40),this.attitude);horizon.position.set(-.15,.065,-.557);this.aircraft.add(horizon);
    const rim=new T.Mesh(new T.TorusGeometry(.135,.009,5,40),brass);rim.position.copy(horizon.position);rim.position.z+=.004;this.aircraft.add(rim);
    const symbol=new T.MeshBasicMaterial({color:'#ecd092'});this.box(this.aircraft,[.08,.009,.003],[-.21,.065,-.55],symbol);this.box(this.aircraft,[.08,.009,.003],[-.09,.065,-.55],symbol);this.box(this.aircraft,[.012,.027,.003],[-.15,.065,-.55],symbol);
    this.label('LEVEL',-.15,-.022,-.547,.13);
    this.label('THROTTLE', -.76, -.22, -.55, .24); this.label('MIXTURE', -.38, -.22, -.55, .24); this.label('RADIATOR', .38, -.22, -.55, .24);
    const lever = new T.Group(); lever.position.set(-.76, -.4, -.48); this.aircraft.add(lever);
    this.rod(lever, [0, 0, 0], [0, .16, .03], .018, brass); this.box(lever, [.12, .06, .055], [0, .16, .03], dark); this.knobs.throttle = lever;
    this.hit('throttle', -.76, -.34, -.39, .23, .28);
    for (const [name, x] of [['mixture', -.38], ['radiator', .38]] as const) {
      const wheel = new T.Group(); wheel.position.set(x, -.34, -.44); this.aircraft.add(wheel);
      wheel.add(new T.Mesh(new T.TorusGeometry(.068, .014, 5, 12), brass));
      this.box(wheel, [.13, .012, .018], [0, 0, 0], brass); this.box(wheel, [.012, .13, .018], [0, 0, 0], brass);
      this.knobs[name] = wheel; this.hit(name, x, -.34, -.40, .24, .22);
    }
    const yoke = new T.Group(); yoke.position.set(0, -.4, -.2); this.aircraft.add(yoke);
    this.rod(yoke, [0, -.25, -.1], [0, .12, 0], .025, dark);
    this.rod(yoke, [-.17, .15, 0], [.17, .15, 0], .024, dark);
    for (const x of [-.17, .17]) this.rod(yoke, [x, .1, 0], [x, .23, 0], .029, timber);
    this.knobs.yoke = yoke; this.hit('yoke', 0, -.27, -.12, .46, .3);
    this.label('IGNITION', .76, -.2, -.54, .25); this.label('BRAKE', .76, -.43, -.54, .22);
    for (const [name, y] of [['ignition', -.29], ['brake', -.49]] as const) {
      const button = new T.Group(); button.position.set(.76, y, -.44);
      const cap = new T.Mesh(new T.CylinderGeometry(.055, .055, .04, 12), name === 'ignition' ? brass : dark); cap.rotation.x = Math.PI / 2; button.add(cap); this.aircraft.add(button); this.knobs[name] = button;
      this.hit(name, .76, y, -.38, .2, .16);
    }
    this.propeller.position.set(0, 0, -3.52); this.box(this.propeller, [.13, 1.8, .08], [0, 0, 0], timber); this.aircraft.add(this.propeller);
    this.buildGun(dark, brass, timber);
    if(spec.bombs>0){this.label('BOMB RELEASE',-.48,-.46,-.32,.30);
    const release=new T.Group();release.position.set(-.48,-.55,-.27);this.box(release,[.12,.065,.045],[0,0,0],this.material('#ad5d34'));this.aircraft.add(release);this.knobs.bomb=release;this.hit('bomb',-.48,-.55,-.23,.22,.11);}
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
    const jacket = new T.Mesh(new T.CylinderGeometry(.062, .062, 2.25, 10), dark); jacket.rotation.x = Math.PI / 2; jacket.position.set(0, .025, -1.66); gun.add(jacket);
    for (let z = -.72; z > -2.65; z -= .18) { const ring = new T.Mesh(new T.TorusGeometry(.066, .009, 5, 10), dark); ring.position.set(0, .025, z); gun.add(ring); }
    this.rod(gun, [0, .025, -2.75], [0, .025, -3.05], .028, dark);
    // Ring-and-bead sight: both are on the true bore line, so gravity and lead still matter.
    const rearSight = new T.Mesh(new T.TorusGeometry(.085, .009, 7, 24), brass); rearSight.position.set(0, .22, .08); gun.add(rearSight);
    this.rod(gun, [0, .135, .08], [0, .22, .08], .007, brass);
    this.rod(gun, [0, .065, -2.83], [0, .22, -2.83], .008, brass);
    const bead = new T.Mesh(new T.SphereGeometry(.018, 8, 6), brass); bead.position.set(0, .22, -2.83); gun.add(bead);
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
    if(!point)return null;const x=point.x-(name==='mixture'?-.38:.38),y=point.y+.34;
    return Math.hypot(x,y)<.02?null:Math.atan2(y,x);
  }
  private contextmenu=(e:MouseEvent)=>e.preventDefault();
  private down = (e: MouseEvent) => {
    if ((e.button!==0&&e.button!==2)||this.paused||this.sim.crashed)return;
    const button=e.button as MouseButton;
    this.renderer.domElement.focus();this.startAudio();const picked=this.pick(e),chording=this.drags.size>0&&!this.drags.has(button),name=resolveMouseControl(picked,this.bindings[button],chording);if(!name)return;if(name===picked)this.bindings[button]=name;e.preventDefault();
    this.placeHand(button,name);
    if (name === 'ignition' || name === 'brake') { this.sim.controls[name] = !this.sim.controls[name]; return; }
    if (name === 'bomb') {this.releaseBomb();return;}
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
      else if (d.name === 'cocking') { this.cockTravel = clamp((e.clientY - d.y) / Math.max(65, this.mount.clientHeight * .12), 0, 1); if (this.cockTravel >= .92) this.gun.cock(); }
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
    const k = e.key.toLowerCase(); if (!'wasdicxbrg'.includes(k) || k.length !== 1) return; e.preventDefault(); this.keys.add(k);
    if (e.repeat) return;
    if (k === 'i') { this.startAudio(); this.sim.controls.ignition = !this.sim.controls.ignition; }
    if (k === 'b') this.sim.controls.brake = !this.sim.controls.brake;
    if (k === 'c') { this.yaw = 0; this.pitch = -.23; }
    if (k === 'x') { this.sim.controls.pitch = 0; this.sim.controls.roll = 0; }
    if (k === 'r') this.reset();
    if (k === 'g') this.releaseBomb();
  };
  private keyup = (e: KeyboardEvent) => { this.keys.delete(e.key.toLowerCase()); };
  private blur = () => { this.keys.clear(); this.up(); };
  private visibility = () => { this.blur(); this.last = 0; this.accumulator = 0; if (document.hidden && this.audio && this.gain) this.gain.gain.setTargetAtTime(0, this.audio.currentTime, .04); };
  private resize = () => { const w = this.mount.clientWidth, h = this.mount.clientHeight; this.renderer.setSize(w, h); this.target.setSize(Math.round(420 * w / h), 420); this.camera.aspect = w / h; this.camera.fov = w / h < 1.3 ? 75 : 60; this.camera.updateProjectionMatrix(); };
  private setSpawn(){this.sim.spawn.copy(parkingPosition(this.terrain,this.airfieldIndex));}
  releaseBomb(){if(this.paused||this.battle.winner)return;if(this.battle.release())this.battle.message=`BOMB AWAY · ${this.sim.bombsRemaining} REMAINING`;else if(this.sim.grounded)this.battle.message='BOMB RELEASE · AIRBORNE ONLY';else if(this.sim.bombsRemaining===0)this.battle.message='NO BOMBS · BOMBER CARRIES FOUR';}
  reset(){if(this.battle.respawnPlayer())this.resetView();}
  private resetView() { this.crashEffects.reset();this.aircraft.visible=true;this.propeller.visible=true;this.cockTravel=0;this.gunRecoil=0;this.shownRounds=0; this.prevPosition.copy(this.sim.position); this.prevRotation.copy(this.sim.orientation); this.yaw = 0; this.pitch = -.23; this.accumulator = 0; this.blur();this.hover=null; }
  startSortie(type:AircraftType,airfieldIndex:number){
    if(!(type in AIRCRAFT)||!Number.isInteger(airfieldIndex)||airfieldIndex<0||airfieldIndex>=AIRFIELDS.length)throw new Error('Invalid aircraft or airfield');
    if(!this.canHangar())return false;
    const fresh=!this.started||!!this.battle.winner;
    if(!fresh&&AIRFIELDS[airfieldIndex].team!==this.battle.playerTeam)return false;
    const parking=parkingPosition(this.terrain,airfieldIndex);
    if(!fresh&&this.battle.planes.slice(1).some(p=>!p.sim.crashed&&p.sim.position.distanceTo(parking)<24)){this.battle.message='PARKING OCCUPIED · CHOOSE OTHER AIRFIELD';return false;}
    this.crashEffects.reset();this.releaseAircraft();this.sim.aircraftType=type;this.airfieldIndex=airfieldIndex;this.setSpawn();this.sim.reset();this.gun.reset();this.resetView();this.buildAircraft();
    if(fresh){this.battleView.dispose();this.battle=new Battle(this.terrain,this.sim,this.gun,AIRFIELDS[airfieldIndex].team,Math.random,this.sim.scenery);this.battleView=new BattleView(this.scene,this.battle);}
    const p=this.battle.planes[0];p.homeField=airfieldIndex;p.rear.reset();p.cooldown=0;p.scored=false;p.generation++;p.previous.copy(this.sim.position);p.rotation.copy(this.sim.orientation);
    this.started=true;this.previewField=null;this.world.updateBuildings(this.battle.buildings);return true;
  }
  private releaseAircraft(){
    const geometries=new Set<T.BufferGeometry>(),materials=new Set<T.Material>();this.aircraft.traverse(o=>{if(o instanceof T.Mesh){geometries.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material])materials.add(m);}});
    geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());this.labels.forEach(t=>t.dispose());this.labels=[];this.aircraft.clear();this.gauges=[];this.hits=[];this.knobs={};this.bombRacks.length=0;this.propeller=new T.Group();this.gunTrigger=new T.Group();this.cockingHandle=new T.Group();this.attitude=null;
  }
  private startAudio() {
    if (!this.audio) { this.audio = new AudioContext(); this.oscillator = this.audio.createOscillator(); this.gain = this.audio.createGain(); const filter = this.audio.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 220; this.oscillator.type = 'sawtooth'; this.oscillator.connect(filter); filter.connect(this.gain); this.gain.connect(this.audio.destination); this.gain.gain.value = 0; this.oscillator.start(); }
    void this.audio.resume();
  }
  private registerTools() {
    type Tool = { name: string; description: string; inputSchema: object; annotations: { readOnlyHint: boolean }; execute: (input: unknown) => unknown };
    const context = (document as Document & { modelContext?: { registerTool: (tool: Tool, options: { signal: AbortSignal }) => void | Promise<void> } }).modelContext;
    if (!context?.registerTool) return;
    const validateEmpty = (input: unknown) => { if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length) throw new Error('Expected an empty object.'); };
    const tools: Tool[] = [
      { name: 'read_flight_instruments', description: 'Read the current aircraft instruments and persistent cockpit controls.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true }, execute: input => { validateEmpty(input); const s = this.sim; return { altitudeMetres: s.position.y, indicatedAirspeedKmh: s.indicatedAirspeed * 3.6, rpm: s.rpm, temperatureC: s.temperature, fuelLitres: s.fuel, stalled: s.stall, crashed: s.crashed, controls: { ...s.controls } }; } },
      { name: 'reset_training_sortie', description: 'Respawn a crashed player after the eight-second countdown, preserving team scores. Available only during an unfinished match.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: false }, execute: async input => { validateEmpty(input); if(!this.sim.crashed||this.battle.winner||this.battle.info().respawn>0)throw new Error('Respawn is available after a crash countdown in an unfinished match.');this.reset(); await new Promise(requestAnimationFrame); return { status: this.sim.crashed?'waiting':'parked', engine: this.sim.engine, fuelLitres: this.sim.fuel }; } }
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
    const active = this.started && this.previewField===null && !this.paused && !document.hidden && !this.battle.winner;
    if (active) {
      this.yaw = turnHeadYaw(this.yaw,(this.keys.has('a') ? 1 : 0) - (this.keys.has('d') ? 1 : 0),elapsed);
      this.pitch = clamp(this.pitch + ((this.keys.has('w') ? 1 : 0) - (this.keys.has('s') ? 1 : 0)) * elapsed*1.65, -1.05, .85);
      this.accumulator += elapsed;
      while (this.accumulator >= DT) { this.prevPosition.copy(this.sim.position); this.prevRotation.copy(this.sim.orientation); this.battle.step(DT); this.accumulator -= DT; }
    } else { this.accumulator = 0; this.prevPosition.copy(this.sim.position); this.prevRotation.copy(this.sim.orientation); this.blur(); }
    this.aircraft.position.lerpVectors(this.prevPosition, this.sim.position, this.accumulator / DT); this.aircraft.quaternion.slerpQuaternions(this.prevRotation, this.sim.orientation, this.accumulator / DT);
    this.look.setFromEuler(new T.Euler(this.pitch, this.yaw, 0, 'YXZ'));
    if(this.previewField!==null)this.aircraft.visible=false;else if(!this.sim.crashed||this.sim.crashCause==='PROP STRIKE')this.aircraft.visible=true;
    if(this.previewField!==null){const f=AIRFIELDS[this.previewField],y=this.terrain.airfieldHeights[this.previewField];this.camera.position.set(f.x+380,y+330,f.z+550);this.camera.lookAt(f.x-70,y,f.z+150);}
    else if(!this.sim.crashed){
      this.camera.position.set(0,.68,1.3).applyQuaternion(this.aircraft.quaternion).add(this.aircraft.position);this.camera.quaternion.copy(this.aircraft.quaternion).multiply(this.look);
    }else{
      if(!this.crashEffects.active){
        this.aircraft.position.copy(this.sim.position);this.aircraft.quaternion.copy(this.sim.orientation);this.aircraft.updateMatrixWorld(true);
        this.camera.position.set(0,.68,1.3).applyQuaternion(this.aircraft.quaternion).add(this.aircraft.position);this.camera.quaternion.copy(this.aircraft.quaternion).multiply(this.look);
        if(this.sim.crashCause==='PROP STRIKE')this.crashEffects.detach(this.propeller,this.sim.impactVelocity,this.sim.impactSpeed);
        else {this.crashEffects.start(this.aircraft,this.sim.impactVelocity,this.sim.impactSpeed,this.camera);this.yaw=0;this.pitch=0;this.look.identity();}
        this.up();this.hover=null;
      }
      if(this.sim.crashCause==='PROP STRIKE'){
        this.camera.position.set(0,.68,1.3).applyQuaternion(this.aircraft.quaternion).add(this.aircraft.position);this.camera.quaternion.copy(this.aircraft.quaternion).multiply(this.look);
        this.crashEffects.update(active?elapsed:0,this.camera);
      }else {this.crashEffects.update(active?elapsed:0,this.camera);this.camera.quaternion.multiply(this.look);}
    }
    this.camera.updateMatrixWorld();
    this.battleView.update(active?elapsed:0,active?this.accumulator/DT:1,this.camera);this.world.updateBuildings(this.battle.buildings);this.bombRacks.forEach((b,i)=>b.visible=i>=this.sim.spec.bombs-this.sim.bombsRemaining);
    for (const g of this.gauges) g.needle.rotation.z = (135 - clamp(g.read() / g.max, 0, 1) * 270) * Math.PI / 180;
    if(this.attitude){const a=readAttitude(this.sim.orientation);this.attitude.uniforms.pitch.value=a.pitch;this.attitude.uniforms.roll.value=a.roll;}
    const c = this.sim.controls;
    this.knobs.throttle!.rotation.x = throttleAngle(c.throttle);
    this.knobs.mixture!.rotation.z = -c.mixture * Math.PI * 3; this.knobs.radiator!.rotation.z = -c.radiator * Math.PI * 3;
    this.knobs.yoke!.rotation.z = -c.roll * .6; this.knobs.yoke!.rotation.x = c.pitch * .45;
    this.knobs.ignition!.position.z = c.ignition ? -.47 : -.44; this.knobs.brake!.position.z = c.brake ? -.44 : -.48;
    this.cockTravel = [...this.drags.values()].some(d=>d.name==='cocking') ? this.cockTravel : Math.max(0, this.cockTravel - elapsed * 5);
    this.cockingHandle.position.z = -.08 + this.cockTravel * .28;
    if (this.gun.roundsFired !== this.shownRounds) { this.shownRounds = this.gun.roundsFired; this.gunRecoil = 1; }
    this.gunRecoil = Math.max(0, this.gunRecoil - elapsed * 18);
    this.gunTrigger.rotation.x = (this.gun.trigger ? -.34 : 0) + this.gunRecoil * .08;
    for(const button of[0,2] as MouseButton[]){const hand=this.hands[button];if(hand.visible){const active=this.drags.has(button);hand.position.z=active?.01:.035;hand.rotation.x=active?.12:0;}}
    this.updateTracers();
    if (active) this.propeller.rotation.z += this.sim.rpm * Math.PI / 30 * elapsed;
    this.cockpit.updateMatrixWorld(true);
    this.renderer.setRenderTarget(this.target); this.renderer.clear(); this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(null); this.renderer.clear(); this.renderer.render(this.screen, this.screenCamera); this.renderer.clearDepth(); this.renderer.render(this.cockpit, this.camera);
    if (this.audio && this.oscillator && this.gain) { this.oscillator.frequency.setTargetAtTime(22 + this.sim.rpm / 14, this.audio.currentTime, .12); this.gain.gain.setTargetAtTime(active && this.sim.engine !== 'off' && !this.sim.crashed ? .018 + c.throttle * .015 : 0, this.audio.currentTime, .12); }
    if (now - this.reportTime > 120) {
      this.reportTime = now; const s = this.sim;
      const status = this.battle.winner ? `${this.battle.winner} · MATCH COMPLETE` : s.crashed ? `CRASHED · ${s.crashCause || 'IMPACT'} · RESPAWN` : this.gun.roundsRemaining === 0 ? 'GUN EMPTY · RESPAWN TO REARM' : this.gun.jammed ? 'GUN JAMMED · CYCLE COCKING HANDLE' : this.gun.heat > .72 ? 'GUN HOT · DISPERSION INCREASING' : Math.max(Math.abs(s.position.x),Math.abs(s.position.z))>4800?'MAP EDGE · TURN BACK':s.stall ? 'STALL · LOWER THE NOSE' : s.temperature > 110 ? 'ENGINE HOT · OPEN RADIATOR' : s.grounded ? (s.engine === 'off' ? 'PARKED · ENGINE OFF' : c.brake ? 'ENGINE ' + s.engine.toUpperCase() + ' · BRAKE SET' : 'GROUND ROLL · TEAM BATTLE') : 'AIRBORNE · TEAM BATTLE';
      const control = [...this.drags.values()][0]?.name ?? this.hover;
      const value = control === 'yoke' ? `PITCH ${Math.round(c.pitch * 100)}% · ROLL ${Math.round(c.roll * 100)}%` : control === 'ignition' ? c.ignition ? 'ON' : 'OFF' : control === 'brake' ? c.brake ? 'SET — CLICK TO RELEASE' : 'RELEASED' : control === 'trigger' ? this.gun.roundsRemaining === 0 ? 'EMPTY' : this.gun.jammed ? 'JAMMED' : this.gun.cocked ? `READY · ${this.gun.roundsRemaining} ROUNDS` : 'NOT COCKED' : control === 'cocking' ? `${this.gun.cocked ? 'ACTION READY' : 'PULL DOWN FULLY'} · ${Math.round(this.cockTravel * 100)}%` : control === 'bomb' ? `${s.bombsRemaining} REMAINING · CLICK OR G TO RELEASE` : control ? Math.round(c[control] * 100) + '%' : '';
      const hint = control ? `${control.toUpperCase()} · ${value}${control==='mixture'||control==='radiator'?' · WIND CLOCKWISE TO INCREASE':control==='throttle'||control==='yoke'?' · DRAG TO ADJUST':control==='cocking'?' · DRAG DOWN AND RELEASE':''}` : s.crashed ? 'Respawn becomes available eight seconds after a crash. Your team score is retained.' : this.gun.roundsRemaining === 0 ? 'Ammunition exhausted. Reset or begin a new sortie to load another belt.' : this.gun.jammed ? 'The gun has jammed. Drag the brass cocking handle fully down, then release.' : !this.gun.cocked ? 'Cock the gun once: drag its brass side handle fully down, then release.' : !c.ignition ? 'Click IGNITION in the cockpit to start your engine.' : c.brake && s.grounded ? 'Release BRAKE, then drag THROTTLE upward.' : s.grounded && s.airspeed*3.6 < s.spec.takeoff ? `Build speed to ${s.spec.takeoff} km/h, then gently pull the yoke toward you.` : 'Sight through the ring and bead · Hold the gun trigger to fire';
      const attitude=readAttitude(s.orientation);
      this.report(status, hint, `${this.fps.toFixed(0)} FPS · 60 Hz physics\nALT ${s.position.y.toFixed(1)} m  IAS ${(s.indicatedAirspeed * 3.6).toFixed(1)} km/h\nAoA ${(s.alpha * 180 / Math.PI).toFixed(1)}°  V/S ${s.velocity.y.toFixed(1)} m/s\nLIFT ${s.lift.toFixed(0)} N  DRAG ${s.drag.toFixed(0)} N\nRADIATOR DRAG ${s.radiatorDrag.toFixed(0)} N\nGROUND LOAD ${(s.groundLoad/9.81).toFixed(2)} g  PROP CLEAR ${Number.isFinite(s.propClearance)?s.propClearance.toFixed(2):'—'} m\nROLL ${(attitude.roll*180/Math.PI).toFixed(0)}° PITCH ${(attitude.pitch*180/Math.PI).toFixed(0)}°\nRPM ${s.rpm.toFixed(0)}  TEMP ${s.temperature.toFixed(1)}°C\nGUN ${this.gun.jammed?'JAMMED':this.gun.cocked?'READY':'SAFE'}  HEAT ${(this.gun.heat*100).toFixed(0)}%  AMMO ${this.gun.roundsRemaining}/${AMMO_CAPACITY}\nFUEL ${s.fuel.toFixed(1)} L  ENGINE ${(s.health * 100).toFixed(0)}%\nPOS ${s.position.x.toFixed(0)}, ${s.position.z.toFixed(0)}`,{started:this.started,canHangar:this.canHangar(),aircraftType:s.aircraftType,airfieldIndex:this.airfieldIndex,x:s.position.x,z:s.position.z,heading:-new T.Euler().setFromQuaternion(s.orientation,'YXZ').y*180/Math.PI,altitude:s.position.y,crashed:s.crashed,battle:this.battle.info()});
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


