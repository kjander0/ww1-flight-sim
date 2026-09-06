import * as T from 'three';
const forward=new T.Vector3(),right=new T.Vector3(),up=new T.Vector3();
export function readAttitude(q:T.Quaternion){forward.set(0,0,-1).applyQuaternion(q);right.set(1,0,0).applyQuaternion(q);up.set(0,1,0).applyQuaternion(q);return{pitch:Math.asin(Math.max(-1,Math.min(1,forward.y))),roll:Math.atan2(right.y,up.y)};}
export function horizonMaterial(){return new T.ShaderMaterial({
  uniforms:{pitch:{value:0},roll:{value:0}},
  vertexShader:'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
  fragmentShader:`varying vec2 vUv;uniform float pitch;uniform float roll;
  void main(){vec2 p=vUv*2.0-1.0;float x=cos(roll)*p.x-sin(roll)*p.y;float h=sin(roll)*p.x+cos(roll)*p.y+pitch*1.5;
  vec3 sky=vec3(.27,.46,.53),earth=vec3(.38,.29,.17);vec3 color=h>0.0?sky:earth;
  if(abs(h)<.017)color=vec3(.9,.86,.67);
  float ladder=abs(mod(h+.1309,.2618)-.1309);if(ladder<.009&&abs(x)<.28&&abs(h)>.08)color=vec3(.79,.79,.67);
  gl_FragColor=vec4(color,1.0);}`
});}
