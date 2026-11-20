const fs=require('fs'),C=require('../chem.js'),D=require('../dock.js');
(async()=>{
const t0=Date.now(),lap=m=>console.log(((Date.now()-t0)/1000).toFixed(1)+'s',m);
const pdb=D.parsePDB(fs.readFileSync(__dirname+'/../data/1iep.pdb','utf8'));const rec=D.prepareReceptor(pdb,{});
const cnt={};for(let k=0;k<rec.n;k++){const t=rec.meta[k].el+(rec.HY[k]?'H':'')+(rec.DN[k]?'D':'')+(rec.AC[k]?'A':'');cnt[t]=(cnt[t]||0)+1}
lap('receptor heavy atoms '+rec.n+' H in file: '+rec.fileHasH+' '+JSON.stringify(cnt));
const mol=C.prepare(C.parseMol(fs.readFileSync(__dirname+'/../data/imatinib.sdf','utf8')));
console.log('ligand atoms',mol.atoms.length,'heavy',mol.nHeavy,'bonds',mol.bonds.length,'aromatic atoms',mol.atoms.filter(a=>a.arom).length);
const lig=D.prepareLigand(mol);console.log('torsions',lig.nt,'types',[...new Set(lig.types.filter(Boolean))].join(' '),'intra pairs',lig.pairs.length,'intraRef',lig.intraRef.toFixed(2));
const cry=lig.heavy.map(i=>[mol.atoms[i].x,mol.atoms[i].y,mol.atoms[i].z]);
const c=D.centroid(lig.heavy.map(i=>mol.atoms[i]));const box={c,s:[26,26,26]};
const keys=[...new Set(lig.types.filter(Boolean))];
const G=await D.buildGrids(rec,box,keys,{spacing:0.5});lap('grids built, near atoms '+G.nNear+' dims '+G.dim.join('x'));
const S=D.makeScorer(lig,G);
// gradient check on random pose near crystal
const x0=new Float64Array(7+lig.nt);x0[0]=c[0];x0[1]=c[1];x0[2]=c[2];x0[3]=1;for(let k=0;k<lig.nt;k++)x0[7+k]=(Math.random()-.5)*0.5;
const g=new Float64Array(6+lig.nt);S.evaluate(x0,g);let worst=0;
for(let i=0;i<g.length;i++){const h=1e-4,d=new Float64Array(g.length);d[i]=1;const xp=new Float64Array(x0.length),xm=new Float64Array(x0.length);
 // apply via localOpt internals not exposed: emulate translation & torsion only; rotation check via small quaternion
 if(i<3){xp.set(x0);xm.set(x0);xp[i]+=h;xm[i]-=h}else if(i>=6){xp.set(x0);xm.set(x0);xp[7+i-6]+=h;xm[7+i-6]-=h}else continue;
 const n=(S.evaluate(xp)-S.evaluate(xm))/(2*h);worst=Math.max(worst,Math.abs(n-g[i])/(1+Math.abs(n)))}
console.log('score gradient (trans+torsion) max rel err',worst.toExponential(1),'E',S.evaluate(x0).toFixed(2));
// crystal pose score
const xc=new Float64Array(7+lig.nt);xc[0]=lig.c0[0];xc[1]=lig.c0[1];xc[2]=lig.c0[2];xc[3]=1;
const Ec=S.evaluate(xc);console.log('crystal pose: inter',S.sc.inter.toFixed(2),'intra',S.sc.intra.toFixed(2),' -> affinity',((S.sc.inter+S.sc.intra-lig.intraRef)/(1+D.W.rot*lig.nt)*4.184).toFixed(1),'kJ/mol');
const lo=S.localOpt(xc,60);S.evaluate(lo.x);console.log('crystal pose relaxed in grid: E',lo.E.toFixed(2),'inter',S.sc.inter.toFixed(2));
const res=await D.dockLigand(lig,G,{runs:8,seed:3},{progress:(f)=>{}});lap('docking done: '+res.modes.length+' modes, steps/run '+res.steps);
const rm=m=>{let s=0;lig.heavy.forEach((i,k)=>{s+=(m.pos[3*i]-cry[k][0])**2+(m.pos[3*i+1]-cry[k][1])**2+(m.pos[3*i+2]-cry[k][2])**2});return Math.sqrt(s/lig.heavy.length)};
res.modes.forEach(m=>console.log(' mode',m.rank,'aff',m.kJ.toFixed(1),'kJ/mol ('+m.kcal.toFixed(2)+' kcal) rmsd-best',m.rmsd.toFixed(2),'rmsd-crystal',rm(m).toFixed(2)));
const it=D.interactions(lig,rec,res.modes[0].pos);console.log('top mode H-bonds:',it.hbonds.slice(0,6).map(h=>h.lig+'-'+h.res+':'+h.atom+' '+h.d.toFixed(2)).join('; '),'| hydrophobic',it.hydrophobic);
// pockets
const t1=Date.now();const pk=D.findPockets(rec);console.log('pockets',pk.length,'in',Date.now()-t1,'ms');
pk.forEach((p,i)=>console.log(' pocket',i+1,'pts',p.size,'center',p.center.map(v=>v.toFixed(1)).join(','),'dist to ligand',Math.hypot(...p.center.map((v,q)=>v-c[q])).toFixed(1)));
})().catch(e=>{console.error(e);process.exit(1)});
