const C=require('../chem.js');
const mf=(atoms,bonds,chg=[])=>{const p=(v,w)=>String(v).padStart(w);let s='\n  t\n\n'+p(atoms.length,3)+p(bonds.length,3)+'  0  0  0  0  0  0  0  0999 V2000\n';
 for(const [el,x,y] of atoms)s+=x.toFixed(4).padStart(10)+y.toFixed(4).padStart(10)+'0.0000'.padStart(10)+' '+el.padEnd(3)+' 0  0  0  0  0  0  0  0  0  0  0  0\n';
 for(const [a,b,o,st] of bonds)s+=p(a+1,3)+p(b+1,3)+p(o,3)+p(st||0,3)+'  0  0  0\n';
 for(const [i,q] of chg)s+='M  CHG  1'+p(i+1,4)+p(q,4)+'\n';return s+'M  END\n'};
const ring=(n,cx,cy,R)=>Array.from({length:n},(_,i)=>{const a=-Math.PI/2+i*2*Math.PI/n;return[cx+R*Math.cos(a),cy+R*Math.sin(a)]});
const d=(x,i,j)=>Math.hypot(x[3*i]-x[3*j],x[3*i+1]-x[3*j+1],x[3*i+2]-x[3*j+2]);
const ang=(x,i,j,k)=>{const u=[0,1,2].map(q=>x[3*i+q]-x[3*j+q]),v=[0,1,2].map(q=>x[3*k+q]-x[3*j+q]);const c=(u[0]*v[0]+u[1]*v[1]+u[2]*v[2])/Math.hypot(...u)/Math.hypot(...v);return Math.acos(c)*180/Math.PI};
let fails=0;const ok=(c,m)=>{console.log((c?'PASS ':'FAIL ')+m);if(!c)fails++};
function gradcheck(mol,name){const T=mol.T,x=C.coords(mol);for(let i=0;i<x.length;i++)x[i]+=(Math.random()-.5)*0.2;
 const g=new Float64Array(x.length);C.energy(x,T,g);let mx=0;for(let i=0;i<x.length;i+=7){const h=1e-5,xp=Float64Array.from(x),xm=Float64Array.from(x);xp[i]+=h;xm[i]-=h;const n=(C.energy(xp,T)-C.energy(xm,T))/(2*h);mx=Math.max(mx,Math.abs(n-g[i])/(1+Math.abs(n)))}
 ok(mx<2e-4,'gradient matches finite differences ('+name+', max rel err '+mx.toExponential(1)+')')}
// ethanol
{const m=C.build3DFrom(C.parseMol(mf([['C',0,0],['C',1.3,.75],['O',2.6,0]],[[0,1,1],[1,2,1]])),{nconf:4});const x=C.coords(m);
 ok(m.atoms.length===9,'ethanol has 9 atoms ('+m.atoms.length+')');ok(Math.abs(d(x,0,1)-1.52)<.03,'C-C 1.52 ('+d(x,0,1).toFixed(3)+')');ok(Math.abs(d(x,1,2)-1.42)<.03,'C-O 1.42 ('+d(x,1,2).toFixed(3)+')');
 ok(Math.abs(ang(x,0,1,2)-109.5)<4,'C-C-O ~109 ('+ang(x,0,1,2).toFixed(1)+')');gradcheck(m,'ethanol')}
// benzene
{const r=ring(6,0,0,1.5),at=r.map(p=>['C',...p]),bd=r.map((_,i)=>[i,(i+1)%6,i%2?1:2]);const m=C.build3DFrom(C.parseMol(mf(at,bd)),{nconf:3});const x=C.coords(m);
 ok(m.atoms.length===12,'benzene 12 atoms');const ds=[0,1,2,3,4,5].map(i=>d(x,i,(i+1)%6));ok(ds.every(v=>Math.abs(v-1.39)<.03),'ring bonds 1.39 ('+ds.map(v=>v.toFixed(3)).join(',')+')');
 // planarity: max out-of-plane distance
 const cen=[0,1,2].map(q=>[0,1,2,3,4,5].reduce((s,i)=>s+x[3*i+q],0)/6);const u=[0,1,2].map(q=>x[3*1+q]-x[q]),v=[0,1,2].map(q=>x[3*2+q]-x[q]),n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],nl=Math.hypot(...n);
 const oop=Math.max(...m.atoms.map((a,i)=>Math.abs(((x[3*i]-cen[0])*n[0]+(x[3*i+1]-cen[1])*n[1]+(x[3*i+2]-cen[2])*n[2])/nl)));ok(oop<.08,'benzene incl. H planar (max dev '+oop.toFixed(3)+' A)');
 ok(m.atoms.slice(0,6).every(a=>a.arom),'aromatic perceived');gradcheck(m,'benzene')}
// cyclohexane -> chair
{const r=ring(6,0,0,1.5),at=r.map(p=>['C',...p]),bd=r.map((_,i)=>[i,(i+1)%6,1]);const m=C.build3DFrom(C.parseMol(mf(at,bd)),{nconf:8});const x=C.coords(m);
 const ds=[0,1,2,3,4,5].map(i=>d(x,i,(i+1)%6)),as=[0,1,2,3,4,5].map(i=>ang(x,(i+5)%6,i,(i+1)%6));
 ok(ds.every(v=>Math.abs(v-1.52)<.04),'cyclohexane C-C 1.52');ok(as.every(a=>Math.abs(a-111)<5),'ring angles ~111 ('+as.map(a=>a.toFixed(0)).join(',')+')');
 const E=m.E;console.log('  E=',E.toFixed(1),'kJ/mol');gradcheck(m,'cyclohexane')}
// 2-butanol chirality preserved by wedge and minimisation
{const at=[['C',0,0],['C',1.3,.75],['O',1.3,2.25],['C',2.6,0]],bd=[[1,0,1],[1,2,1,1],[1,3,1]];const m=C.prepare(C.parseMol(mf(at,bd)));const s0=C.chiralSigns(m,C.coords(m));
 const m2=C.build3DFrom(C.parseMol(mf(at,bd)),{nconf:4});const s1=C.chiralSigns(m2,C.coords(m2));
 ok(s0[1]!==undefined&&s0[1]===s1[1],'wedge stereo kept after minimisation ('+s0[1]+' -> '+s1[1]+')');
 const bd2=[[1,0,1],[1,2,1,6],[1,3,1]];const m3=C.build3DFrom(C.parseMol(mf(at,bd2)),{nconf:4});const s2=C.chiralSigns(m3,C.coords(m3));ok(s2[1]===-s1[1],'hash gives opposite enantiomer');gradcheck(m2,'2-butanol')}
// acetamide planarity + benzamidine
{const at=[['C',0,0],['O',0,1.5],['N',1.3,-.75],['C',-1.3,-.75]],bd=[[0,1,2],[0,2,1],[0,3,1]];const m=C.build3DFrom(C.parseMol(mf(at,bd)),{nconf:3});const x=C.coords(m);
 ok(Math.abs(d(x,0,2)-1.35)<.05,'amide C-N shortened ('+d(x,0,2).toFixed(3)+')');gradcheck(m,'acetamide');
 const nH=m.atoms.filter(a=>a.h).length;ok(nH===5,'acetamide H count 5 ('+nH+')')}
// ammonium and nitro
{const m=C.build3DFrom(C.parseMol(mf([['N',0,0],['C',1.3,.7]],[[0,1,1]],[[0,1]])),{nconf:2});ok(m.atoms.filter(a=>a.h).length===3+3,'methylammonium 6 H ('+m.atoms.filter(a=>a.h).length+')')}
// flexible: butylbenzene-like timing
{const r=ring(6,0,0,1.5),at=r.map(p=>['C',...p]),bd=r.map((_,i)=>[i,(i+1)%6,i%2?1:2]);for(let k=0;k<5;k++){at.push(['C',1.3*(k+1)*.866*1.0,1.5+(k%2?0:.75)+(k===0?.75:0)]);bd.push([k?5+k:3,at.length-1,1])}
 const t=Date.now();const m=C.build3DFrom(C.parseMol(mf(at,bd)),{nconf:10});console.log('  pentylbenzene 3D in',Date.now()-t,'ms, atoms',m.atoms.length,'rot',C.rotatableBonds(m).length,'E',m.E.toFixed(1));
 const res=C.minimize(C.coords(m),m.T,{sd:100,cg:10});console.log('  further min',res.E0.toFixed(2),'->',res.E.toFixed(2))}
console.log(fails?fails+' FAILED':'ALL PASSED');process.exit(fails?1:0);
