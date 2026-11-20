const fs=require('fs'),C=require('../chem.js'),D=require('../dock.js');
(async()=>{
const pdb=D.parsePDB(fs.readFileSync(__dirname+'/../data/1iep.pdb','utf8'));const rec=D.prepareReceptor(pdb,{});
const mol=C.prepare(C.parseMol(fs.readFileSync(__dirname+'/../data/imatinib.sdf','utf8')));const lig=D.prepareLigand(mol);
const cry=lig.heavy.map(i=>[mol.atoms[i].x,mol.atoms[i].y,mol.atoms[i].z]);const c=D.centroid(lig.heavy.map(i=>mol.atoms[i]));
const keys=[...new Set(lig.types.filter(Boolean))];const G=await D.buildGrids(rec,{c,s:[26,26,26]},keys,{spacing:0.5});
const rm=m=>{let s=0;lig.heavy.forEach((i,k)=>{s+=(m.pos[3*i]-cry[k][0])**2+(m.pos[3*i+1]-cry[k][1])**2+(m.pos[3*i+2]-cry[k][2])**2});return Math.sqrt(s/lig.heavy.length)};
const cfgs=JSON.parse(process.argv[2]);
for(const o of cfgs){const t=Date.now();const r=await D.dockLigand(lig,G,{modes:20,range:6,...o},{});
 console.log(JSON.stringify(o),((Date.now()-t)/1000).toFixed(1)+'s','best E',r.modes[0].E.toFixed(2),'rmsd top3',r.modes.slice(0,3).map(m=>rm(m).toFixed(1)).join('/'),'min rmsd any mode',Math.min(...r.modes.map(rm)).toFixed(1),'E of that',r.modes.reduce((b,m)=>rm(m)<rm(b)?m:b).E.toFixed(2))}
})();
