const fs=require('fs'),C=require('../chem.js'),D=require('../dock.js');
(async()=>{
const pdb=D.parsePDB(fs.readFileSync(__dirname+'/../data/1iep.pdb','utf8'));const rec=D.prepareReceptor(pdb,{});
const mol=C.prepare(C.parseMol(fs.readFileSync(__dirname+'/../data/imatinib.sdf','utf8')));const lig=D.prepareLigand(mol);
const cry=lig.heavy.map(i=>[mol.atoms[i].x,mol.atoms[i].y,mol.atoms[i].z]);const c=D.centroid(lig.heavy.map(i=>mol.atoms[i]));
const keys=[...new Set(lig.types.filter(Boolean))];const G=await D.buildGrids(rec,{c,s:[26,26,26]},keys,{spacing:0.5});
const S=D.makeScorer(lig,G);const xc=new Float64Array(7+lig.nt);xc[0]=lig.c0[0];xc[1]=lig.c0[1];xc[2]=lig.c0[2];xc[3]=1;
const lo=S.localOpt(xc,80);console.log('crystal relaxed E',lo.E.toFixed(2));
const rm=m=>{let s=0;lig.heavy.forEach((i,k)=>{s+=(m.pos[3*i]-cry[k][0])**2+(m.pos[3*i+1]-cry[k][1])**2+(m.pos[3*i+2]-cry[k][2])**2});return Math.sqrt(s/lig.heavy.length)};
for(const [runs,eff] of [[16,5]]){const t=Date.now();const r=await D.dockLigand(lig,G,{runs,effort:eff,seed:11,modes:9,range:4},{});
 console.log('runs',runs,'effort',eff,(Date.now()-t)/1000+'s','best E',r.modes[0].E.toFixed(2),'aff',r.modes[0].kJ.toFixed(1),'kJ/mol; rmsd to crystal of modes:',r.modes.map(m=>rm(m).toFixed(1)).join(' '))}
})();
