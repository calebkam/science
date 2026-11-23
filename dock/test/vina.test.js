/* Regression against AutoDock Vina 1.2.7 (1IEP / imatinib): crystal pose -12.51 kcal/mol, redock top -13.26 kcal/mol */
const fs=require('fs'),C=require('../chem.js'),D=require('../dock.js');
(async()=>{
const rec=D.prepareReceptor(D.parsePDB(fs.readFileSync(__dirname+'/../data/1iep.pdb','utf8')).filter(a=>!a.het),{});
const mol=C.prepare(C.parseMol(fs.readFileSync(__dirname+'/../data/imatinib.sdf','utf8')));const lig=D.prepareLigand(mol);
const c=D.centroid(lig.heavy.map(i=>mol.atoms[i]));const keys=[...new Set(lig.types.filter(Boolean))];
const G=await D.buildGrids(rec,{c,s:[26,26,26]},keys,{spacing:0.375});
const ex=D.makeScorer(lig,G,true),x=new Float64Array(7+lig.nt);x.set([lig.c0[0],lig.c0[1],lig.c0[2],1]);ex.evaluate(x,null);
const crystal=(ex.sc.inter+ex.sc.intra-lig.intraRef)/(1+D.W.rot*lig.nt);console.log('crystal',crystal.toFixed(3),'(Vina -12.513)');
if(Math.abs(crystal+12.513)>0.15)throw new Error('crystal energy off');
const r=await D.dockLigand(lig,G,{runs:32,seed:2},{});const top=r.modes[0].kcal;console.log('redock top',top.toFixed(2),'(Vina -13.26)');
if(top>-12.9||top<-13.8)throw new Error('redock off');console.log('ALL PASSED');})();
