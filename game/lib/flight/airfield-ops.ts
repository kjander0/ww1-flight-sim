import { Vector3 } from 'three';
import { AIRFIELDS, Terrain } from './terrain';
import type { FlightSimulation } from './simulation';
export const parkingPosition=(terrain:Terrain,field:number,slot=0)=>new Vector3(AIRFIELDS[field].x+82,terrain.airfieldHeights[field]+1.15,AIRFIELDS[field].z+440-slot*90);
export function runwayAt(s:FlightSimulation){return !s.crashed&&s.grounded?AIRFIELDS.findIndex(f=>Math.abs(s.position.x-f.x)<31&&Math.abs(s.position.z-f.z)<520):-1;}
export function stoppedRunway(s:FlightSimulation){return s.velocity.length()<.7?runwayAt(s):-1;}
export const turnHeadYaw=(yaw:number,input:number,dt:number)=>Math.atan2(Math.sin(yaw+input*dt*1.65),Math.cos(yaw+input*dt*1.65));
