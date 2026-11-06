import { EXTENT, VERTICAL_SCALE, heightAt, findLandmarks } from '/shared/terrain.js';

/** Renderer WebGL puro: ningún CDN ni framework externo es necesario. */
const VS_TERRAIN = `
attribute vec3 aPosition; attribute vec3 aNormal; attribute vec3 aColor;
uniform mat4 uViewProjection; uniform mat4 uView;
varying vec3 vColor; varying float vDistance;
void main(){
  vec4 view = uView * vec4(aPosition, 1.0);
  gl_Position = uViewProjection * vec4(aPosition, 1.0);
  vDistance = -view.z;
  float light = max(dot(normalize(aNormal), normalize(vec3(0.44,0.94,0.27))), 0.0);
  vColor = aColor * (0.72 + 0.36 * light);
}`;
const FS_TERRAIN = `
precision mediump float; varying vec3 vColor; varying float vDistance;
void main(){
  float fog = smoothstep(88.0,180.0,vDistance) * 0.24;
  gl_FragColor = vec4(mix(vColor, vec3(0.91,0.96,0.96),fog),1.0);
}`;
const VS_LINES = `attribute vec3 aPosition; uniform mat4 uViewProjection;
void main(){gl_Position=uViewProjection * vec4(aPosition,1.0);}`;
const FS_LINES = `precision mediump float; uniform vec4 uColor;
void main(){gl_FragColor=uColor;}`;
const VS_POINTS = `
attribute vec3 aPosition;attribute vec3 aColor;attribute float aSize;
uniform mat4 uViewProjection;uniform mat4 uView;
varying vec3 vColor;
void main(){
  vec4 view=uView*vec4(aPosition,1.0);
  gl_Position=uViewProjection*vec4(aPosition,1.0);
  gl_PointSize=clamp(aSize*135.0/max(18.0,-view.z),5.0,38.0);
  vColor=aColor;
}`;
const FS_POINTS = `
precision mediump float;varying vec3 vColor;
void main(){
  float r=length(gl_PointCoord-vec2(.5));
  if(r>.485)discard;
  vec3 c=mix(vColor,vec3(1.0),0.38*(1.0-smoothstep(0.05,0.48,r)));
  float ring=1.0-smoothstep(.38,.48,r);
  gl_FragColor=vec4(c,ring);
}`;

function shader(gl, type, text) {
  const s = gl.createShader(type);
  gl.shaderSource(s, text);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}
function program(gl, vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, shader(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, shader(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  return p;
}
function buffer(gl, target, data, usage = gl.STATIC_DRAW) {
  const b = gl.createBuffer();
  gl.bindBuffer(target, b);
  gl.bufferData(target, data, usage);
  return b;
}
function normalize(v) {
  const n = Math.hypot(...v) || 1;
  return v.map((x) => x / n);
}
function cross(a, b) { return [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]]; }
function dot(a, b) { return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]; }
function lookAt(eye, center) {
  const z = normalize(eye.map((v,i) => v-center[i]));
  const x = normalize(cross([0,1,0],z));
  const y = cross(z,x);
  return new Float32Array([x[0],y[0],z[0],0,x[1],y[1],z[1],0,x[2],y[2],z[2],0,-dot(x,eye),-dot(y,eye),-dot(z,eye),1]);
}
function perspective(fov, aspect, near, far) {
  const f = 1 / Math.tan(fov / 2);
  return new Float32Array([f/aspect,0,0,0, 0,f,0,0, 0,0,(far+near)/(near-far),-1, 0,0,(2*far*near)/(near-far),0]);
}
function multiply(a, b) {
  const out = new Float32Array(16);
  for (let col=0;col<4;col++) for(let row=0;row<4;row++) {
    let sum=0;
    for(let k=0;k<4;k++)sum+=a[k*4+row]*b[col*4+k];
    out[col*4+row]=sum;
  }
  return out;
}
function hexRGB(hex) {
  const t=hex.replace('#','');
  return [parseInt(t.slice(0,2),16)/255,parseInt(t.slice(2,4),16)/255,parseInt(t.slice(4,6),16)/255];
}
function mix(a,b,t){return a.map((v,i)=>v+(b[i]-v)*t);}
// Colores del relieve, en sintonía con el tema claro: jade, salvia y arena.
const PALETTE = [
  [0,  [0.31,0.69,0.67]],
  [4,  [0.37,0.76,0.68]],
  [11, [0.41,0.76,0.57]],
  [19, [0.66,0.80,0.56]],
  [28, [0.91,0.83,0.60]],
  [39, [0.97,0.88,0.70]],
  [47, [1.00,0.95,0.84]],
];
function heightColor(h) {
  for(let i=1;i<PALETTE.length;i++) if(h<=PALETTE[i][0]) {
    const [low,a]=PALETTE[i-1]; const [high,b]=PALETTE[i];
    return mix(a,b,(h-low)/(high-low));
  }
  return PALETTE[PALETTE.length-1][1];
}
function createMesh(gl) {
  const n=128, size=n+1;
  const vertices=new Float32Array(size*size*9);
  for(let j=0;j<size;j++) for(let i=0;i<size;i++) {
    const x=-EXTENT+i*2*EXTENT/n, z=-EXTENT+j*2*EXTENT/n;
    const h=heightAt(x,z), y=h*VERTICAL_SCALE;
    const slopeX=(heightAt(x+.17,z)-heightAt(x-.17,z))/.34*VERTICAL_SCALE;
    const slopeZ=(heightAt(x,z+.17)-heightAt(x,z-.17))/.34*VERTICAL_SCALE;
    const norm=normalize([-slopeX,1,-slopeZ]);
    const col=heightColor(h);
    vertices.set([x,y,z,...norm,...col],(j*size+i)*9);
  }
  const indices=new Uint16Array(n*n*6);
  let a=0;
  for(let j=0;j<n;j++)for(let i=0;i<n;i++){
    const v=j*size+i;
    indices.set([v,v+size,v+1,v+1,v+size,v+size+1],a);
    a+=6;
  }
  return {vb:buffer(gl,gl.ARRAY_BUFFER,vertices),ib:buffer(gl,gl.ELEMENT_ARRAY_BUFFER,indices),count:indices.length};
}
function createGrid() {
  const points=[];
  for(let v=-30;v<=30;v+=5)points.push(-30,-.42,v,30,-.42,v,v,-.42,-30,v,-.42,30);
  const bounds=[[-30,-30],[30,-30],[30,30],[-30,30]];
  for(let i=0;i<4;i++){
    const a=bounds[i],b=bounds[(i+1)%4];
    points.push(a[0],-.4,a[1],b[0],-.4,b[1]);
  }
  return new Float32Array(points);
}

export const AGENT_COLORS = ['#5578cc','#e28d52','#895dc1','#2e9ca8','#d66b81','#829733','#2f957d','#a45e89'];
export function agentColor(player, meId) {
  if(player.id===meId) return '#0b786b';
  const hash=[...player.id].reduce((v,c)=>((v*31+c.charCodeAt(0))>>>0),7);
  return AGENT_COLORS[hash%AGENT_COLORS.length];
}

export class Terrain3D {
  constructor(canvas, labelLayer) {
    this.canvas=canvas; this.labels=labelLayer;
    this.gl=canvas.getContext('webgl',{antialias:true,alpha:true,preserveDrawingBuffer:false});
    this.players=[]; this.meId=null; this.positions=new Map(); this.labelNodes=new Map();
    this.spin=false;this.trails=true;
    // Zoom inicial 1.5× respecto a la cámara original de distancia 104.
    this.homeDistance=104/1.5;
    this.theta=-0.64;this.phi=1.09;this.distance=this.homeDistance;
    this.targetTheta=this.theta;this.targetPhi=this.phi;this.targetDistance=this.distance;
    this.isDragging=false;
    this.landmarks=findLandmarks();
    if(!this.gl){
      this.ctx=canvas.getContext('2d');
      if(!this.ctx){this.error='No hay un renderizador gráfico disponible';return;}
      this.softwareMesh=this.createSoftwareMesh(62);
      this.summitLabel=document.createElement('div');
      this.summitLabel.className='landmark-label';
      this.summitLabel.textContent='◆ CIMA GLOBAL';
      this.labels.appendChild(this.summitLabel);
    } else {
      try { this.initialize(); } catch(error) { console.error(error); this.error='Error al iniciar WebGL'; return; }
    }
    this.installInteractions();
    this.resizeObserver=new ResizeObserver(()=>this.resize());
    this.resizeObserver.observe(canvas.parentElement);
    this.resize();
    this.animate=()=>{this.render();requestAnimationFrame(this.animate);};
    requestAnimationFrame(this.animate);
  }
  initialize(){
    const gl=this.gl;
    this.terrainP=program(gl,VS_TERRAIN,FS_TERRAIN);
    this.lineP=program(gl,VS_LINES,FS_LINES);
    this.pointP=program(gl,VS_POINTS,FS_POINTS);
    this.mesh=createMesh(gl);
    this.grid=createGrid();this.gridBuf=buffer(gl,gl.ARRAY_BUFFER,this.grid);
    this.dynamicBuf=gl.createBuffer();
    this.markerBuf=gl.createBuffer();
    const {summit}=this.landmarks;
    this.landmarkVertices=new Float32Array([
      // Sin puntos en los valles. El único marcador geográfico es la cima.
      summit.x,(summit.h*VERTICAL_SCALE)+5,summit.z,.85,.54,.20,16,
    ]);
    this.landmarkBuf=buffer(gl,gl.ARRAY_BUFFER,this.landmarkVertices);
    gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);
    this.summitLabel=document.createElement('div');this.summitLabel.className='landmark-label';this.summitLabel.textContent='◆ CIMA GLOBAL';this.labels.appendChild(this.summitLabel);
  }
  installInteractions(){
    this.canvas.addEventListener('pointerdown',(e)=>{this.isDragging=true;this.lastX=e.clientX;this.lastY=e.clientY;this.canvas.setPointerCapture(e.pointerId);});
    this.canvas.addEventListener('pointerup',()=>{this.isDragging=false;});
    this.canvas.addEventListener('pointercancel',()=>{this.isDragging=false;});
    this.canvas.addEventListener('pointermove',(e)=>{
      if(!this.isDragging)return;
      const dx=e.clientX-this.lastX,dy=e.clientY-this.lastY;
      this.targetTheta-=dx*.008;this.targetPhi=Math.max(.27,Math.min(1.48,this.targetPhi-dy*.006));
      this.lastX=e.clientX;this.lastY=e.clientY;
    });
    this.canvas.addEventListener('wheel',(e)=>{
      e.preventDefault();this.targetDistance=Math.max(35,Math.min(178,this.targetDistance*Math.exp(e.deltaY*.001)));
    },{passive:false});
    this.canvas.addEventListener('dblclick',()=>this.home());
  }
  home(){this.targetTheta=-.64;this.targetPhi=1.09;this.targetDistance=this.homeDistance;}
  setPlayers(players,meId){
    this.players=players;this.meId=meId;
    const current=new Set(players.filter((p)=>p.x!==null).map((p)=>p.id));
    for(const [id,node] of this.labelNodes)if(!current.has(id)){node.remove();this.labelNodes.delete(id);this.positions.delete(id);}
    for(const p of players){
      if(p.x===null)continue;
      if(!this.positions.has(p.id))this.positions.set(p.id,{x:p.x,z:p.z});
      if(!this.labelNodes.has(p.id)){
        const div=document.createElement('div');div.className='agent-label';this.labels.appendChild(div);this.labelNodes.set(p.id,div);
      }
      const div=this.labelNodes.get(p.id);
      div.classList.toggle('mine',p.id===this.meId);
      div.replaceChildren(document.createTextNode((p.id===this.meId?'★ ':'')+p.name));
      const small=document.createElement('small');small.textContent=p.participating?`${p.bestHeight.toFixed(1)} m de récord`:'LISTO';div.appendChild(small);
    }
  }
  resize(){
    const rect=this.canvas.getBoundingClientRect();
    const dpr=Math.min(2,window.devicePixelRatio||1);
    const w=Math.max(1,Math.round(rect.width*dpr)),h=Math.max(1,Math.round(rect.height*dpr));
    if(this.canvas.width!==w||this.canvas.height!==h){this.canvas.width=w;this.canvas.height=h;}
    if(this.gl)this.gl.viewport(0,0,w,h);
  }
  setAttrib(program,bufferObject,name,size,stride=0,offset=0){
    const gl=this.gl,loc=gl.getAttribLocation(program,name);
    if(loc<0)return;
    gl.bindBuffer(gl.ARRAY_BUFFER,bufferObject);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc,size,gl.FLOAT,false,stride,offset);
  }
  setMatrix(program,matrix,view){
    const gl=this.gl;
    gl.uniformMatrix4fv(gl.getUniformLocation(program,'uViewProjection'),false,matrix);
    const loc=gl.getUniformLocation(program,'uView');
    if(loc)gl.uniformMatrix4fv(loc,false,view);
  }
  drawLines(verts,mode,color,vp){
    const gl=this.gl;
    if(verts.length<6)return;
    gl.useProgram(this.lineP);
    gl.bindBuffer(gl.ARRAY_BUFFER,this.dynamicBuf);
    gl.bufferData(gl.ARRAY_BUFFER,verts,gl.DYNAMIC_DRAW);
    this.setAttrib(this.lineP,this.dynamicBuf,'aPosition',3);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.lineP,'uViewProjection'),false,vp);
    gl.uniform4fv(gl.getUniformLocation(this.lineP,'uColor'),color);
    gl.drawArrays(mode,0,verts.length/3);
  }
  drawPoints(buf,count,vp,view){
    const gl=this.gl;
    gl.useProgram(this.pointP);this.setMatrix(this.pointP,vp,view);
    this.setAttrib(this.pointP,buf,'aPosition',3,28,0);
    this.setAttrib(this.pointP,buf,'aColor',3,28,12);
    this.setAttrib(this.pointP,buf,'aSize',1,28,24);
    gl.drawArrays(gl.POINTS,0,count);
  }
  project(x,y,z,mvp,rect){
    const w=mvp[3]*x+mvp[7]*y+mvp[11]*z+mvp[15];
    if(w<=0)return null;
    const px=(mvp[0]*x+mvp[4]*y+mvp[8]*z+mvp[12])/w;
    const py=(mvp[1]*x+mvp[5]*y+mvp[9]*z+mvp[13])/w;
    if(Math.abs(px)>1.1||Math.abs(py)>1.1)return null;
    return {x:(px*.5+.5)*rect.width,y:(1-(py*.5+.5))*rect.height};
  }
  createSoftwareMesh(n){
    const cells=[];
    const stride=2*EXTENT/n;
    for(let j=0;j<n;j++)for(let i=0;i<n;i++){
      const x=-EXTENT+i*stride,z=-EXTENT+j*stride;
      const h1=heightAt(x,z),h2=heightAt(x+stride,z),h3=heightAt(x+stride,z+stride),h4=heightAt(x,z+stride);
      const average=(h1+h2+h3+h4)/4;
      const slopeX=(h2+h3-h1-h4)/(2*stride)*VERTICAL_SCALE;
      const slopeZ=(h3+h4-h1-h2)/(2*stride)*VERTICAL_SCALE;
      const light=Math.max(.05,dot(normalize([-slopeX,1,-slopeZ]),normalize([.44,.94,.27])));
      const color=heightColor(average).map(v=>Math.min(1,v*(.72+.36*light)));
      cells.push({x,z,average,vertices:[[x,h1*VERTICAL_SCALE,z],[x+stride,h2*VERTICAL_SCALE,z],[x+stride,h3*VERTICAL_SCALE,z+stride],[x,h4*VERTICAL_SCALE,z+stride]],color:`rgb(${color.map(v=>Math.round(v*255)).join(',')})`});
    }
    return cells;
  }
  renderSoftware(){
    const ctx=this.ctx;
    if(!ctx)return;
    if(this.spin&&!this.isDragging)this.targetTheta+=.0015;
    this.theta+=(this.targetTheta-this.theta)*.13;
    this.phi+=(this.targetPhi-this.phi)*.13;
    this.distance+=(this.targetDistance-this.distance)*.12;
    const radius=this.distance*Math.sin(this.phi);
    const eye=[radius*Math.sin(this.theta),12+this.distance*Math.cos(this.phi),radius*Math.cos(this.theta)];
    const view=lookAt(eye,[0,10,0]),proj=perspective(Math.PI/3.55,this.canvas.width/this.canvas.height,.8,330),vp=multiply(proj,view);
    const rect=this.canvas.getBoundingClientRect();
    const dpr=this.canvas.width/Math.max(1,rect.width);
    ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.clearRect(0,0,rect.width,rect.height);
    const project=(x,y,z)=>this.project(x,y,z,vp,rect);
    const cells=this.softwareMesh;
    // Algoritmo del pintor: las caras lejanas se dibujan primero.
    cells.sort((a,b)=>{
      const ca=[a.x+.5, a.average*VERTICAL_SCALE, a.z+.5];
      const cb=[b.x+.5, b.average*VERTICAL_SCALE, b.z+.5];
      return (Math.hypot(...ca.map((v,i)=>v-eye[i]))<Math.hypot(...cb.map((v,i)=>v-eye[i])))?1:-1;
    });
    ctx.lineJoin='round';
    for(const cell of cells){
      const corners=cell.vertices.map(v=>project(...v));
      if(corners.some(c=>!c))continue;
      ctx.beginPath();ctx.moveTo(corners[0].x,corners[0].y);
      for(let i=1;i<corners.length;i++)ctx.lineTo(corners[i].x,corners[i].y);
      ctx.closePath();ctx.fillStyle=cell.color;ctx.fill();
      ctx.strokeStyle='rgba(21,76,75,.075)';ctx.lineWidth=.5;ctx.stroke();
    }
    const summit=this.landmarks.summit;
    const low=project(summit.x,summit.h*VERTICAL_SCALE+.3,summit.z),high=project(summit.x,summit.h*VERTICAL_SCALE+7,summit.z);
    if(low&&high){
      ctx.strokeStyle='#be8844';ctx.lineWidth=1.7;ctx.beginPath();ctx.moveTo(low.x,low.y);ctx.lineTo(high.x,high.y);ctx.stroke();
      ctx.fillStyle='#c08c49';ctx.beginPath();ctx.arc(high.x,high.y,4.5,0,Math.PI*2);ctx.fill();
    }
    for(const p of this.players){
      if(p.x===null)continue;
      const c=agentColor(p,this.meId);
      const smooth=this.positions.get(p.id)||{x:p.x,z:p.z};
      smooth.x+=(p.x-smooth.x)*.13;smooth.z+=(p.z-smooth.z)*.13;
      this.positions.set(p.id,smooth);
      if(this.trails&&p.path.length>1){
        ctx.beginPath();let started=false;
        for(const [x,z] of p.path){
          const pt=project(x,heightAt(x,z)*VERTICAL_SCALE+.6,z);
          if(!pt)continue;
          if(!started){ctx.moveTo(pt.x,pt.y);started=true;}else ctx.lineTo(pt.x,pt.y);
        }
        ctx.strokeStyle=c;ctx.lineWidth=p.id===this.meId?2.4:1.5;ctx.globalAlpha=.86;ctx.stroke();ctx.globalAlpha=1;
      }
      const y=heightAt(smooth.x,smooth.z)*VERTICAL_SCALE+1.6;
      const pt=project(smooth.x,y,smooth.z),labelPt=project(smooth.x,y+3.0,smooth.z);
      if(pt){
        ctx.shadowColor=c;ctx.shadowBlur=14;
        ctx.fillStyle=c;ctx.beginPath();ctx.arc(pt.x,pt.y,p.id===this.meId?8:6,0,Math.PI*2);ctx.fill();
        ctx.shadowBlur=0;ctx.strokeStyle='#ffffff';ctx.lineWidth=1.5;ctx.stroke();
      }
      const label=this.labelNodes.get(p.id);
      if(label){label.style.display=labelPt?'block':'none';if(labelPt){label.style.left=`${labelPt.x}px`;label.style.top=`${labelPt.y}px`;}}
    }
    const summitLabel=project(summit.x,summit.h*VERTICAL_SCALE+8,summit.z);
    this.summitLabel.style.display=summitLabel?'block':'none';
    if(summitLabel){this.summitLabel.style.left=`${summitLabel.x}px`;this.summitLabel.style.top=`${summitLabel.y}px`;}
  }
  render(){
    const gl=this.gl;if(!gl){this.renderSoftware();return;}
    const w=this.canvas.width,h=this.canvas.height;
    if(w<2||h<2)return;
    if(this.spin&&!this.isDragging)this.targetTheta+=.0015;
    this.theta+=(this.targetTheta-this.theta)*.13;
    this.phi+=(this.targetPhi-this.phi)*.13;
    this.distance+=(this.targetDistance-this.distance)*.12;
    const radius=this.distance*Math.sin(this.phi);
    const eye=[radius*Math.sin(this.theta),12+this.distance*Math.cos(this.phi),radius*Math.cos(this.theta)];
    const view=lookAt(eye,[0,10,0]),proj=perspective(Math.PI/3.55,w/h,.8,330),vp=multiply(proj,view);
    gl.viewport(0,0,w,h);
    gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);

    gl.useProgram(this.terrainP);
    this.setAttrib(this.terrainP,this.mesh.vb,'aPosition',3,36,0);
    this.setAttrib(this.terrainP,this.mesh.vb,'aNormal',3,36,12);
    this.setAttrib(this.terrainP,this.mesh.vb,'aColor',3,36,24);
    this.setMatrix(this.terrainP,vp,view);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,this.mesh.ib);
    gl.drawElements(gl.TRIANGLES,this.mesh.count,gl.UNSIGNED_SHORT,0);

    gl.enable(gl.BLEND);
    this.drawLines(this.grid,gl.LINES,[.55,.73,.72,.23],vp);
    const summit=this.landmarks.summit;
    this.drawLines(new Float32Array([summit.x,summit.h*VERTICAL_SCALE+.5,summit.z,summit.x,summit.h*VERTICAL_SCALE+5,summit.z]),gl.LINES,[.75,.49,.22,.95],vp);
    if(this.trails)for(const p of this.players){
      if(!p.path||p.path.length<2)continue;
      const c=hexRGB(agentColor(p,this.meId));
      const points=[];
      for(const [x,z] of p.path) points.push(x,heightAt(x,z)*VERTICAL_SCALE+.32,z);
      this.drawLines(new Float32Array(points),gl.LINE_STRIP,[...c,.85],vp);
    }
    gl.depthMask(false);
    this.drawPoints(this.landmarkBuf,this.landmarkVertices.length/7,vp,view);
    const points=[];
    const rect=this.canvas.getBoundingClientRect();
    for(const p of this.players){
      if(p.x===null)continue;
      const smooth=this.positions.get(p.id)||{x:p.x,z:p.z};
      smooth.x+=(p.x-smooth.x)*.13;
      smooth.z+=(p.z-smooth.z)*.13;
      this.positions.set(p.id,smooth);
      const altitude=heightAt(smooth.x,smooth.z)*VERTICAL_SCALE+1.65;
      const rgb=hexRGB(agentColor(p,this.meId));
      points.push(smooth.x,altitude,smooth.z,...rgb,p.id===this.meId?15:11);
      const pos=this.project(smooth.x,altitude+3.2,smooth.z,vp,rect);
      const label=this.labelNodes.get(p.id);
      if(label){
        label.style.display=pos?'block':'none';
        if(pos){label.style.left=`${pos.x}px`;label.style.top=`${pos.y}px`;}
      }
    }
    if(points.length){
      gl.bindBuffer(gl.ARRAY_BUFFER,this.markerBuf);
      gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(points),gl.DYNAMIC_DRAW);
      this.drawPoints(this.markerBuf,points.length/7,vp,view);
    }
    gl.depthMask(true);
    const peakPos=this.project(summit.x,summit.h*VERTICAL_SCALE+7,summit.z,vp,rect);
    if(peakPos){this.summitLabel.style.display='block';this.summitLabel.style.left=`${peakPos.x}px`;this.summitLabel.style.top=`${peakPos.y}px`;}
    else this.summitLabel.style.display='none';
  }
}
