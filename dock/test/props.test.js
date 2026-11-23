const Chem=require('../chem.js'),{props}=require('../props.js');
const S=require('./smiles.js');
function toMol(smi){const m=S(smi),L=['\n  t\n',''];let t='\n  t\n\n'+String(m.atoms.length).padStart(3)+String(m.bonds.length).padStart(3)+'  0  0  0  0  0  0  0  0999 V2000\n';
 m.atoms.forEach((a,i)=>{t+=(i*1.2).toFixed(4).padStart(10)+'0.0000'.padStart(10)+'0.0000'.padStart(10)+' '+a.el.padEnd(3)+' 0  0  0  0  0  0  0  0  0  0  0  0\n'});
 m.bonds.forEach(b=>{t+=String(b[0]+1).padStart(3)+String(b[1]+1).padStart(3)+String(b[2]).padStart(3)+'  0  0  0  0\n'});return t+'M  END\n'}
for(const [n,s] of [['ethanol','CCO'],['aspirin','CC(=O)Oc1ccccc1C(=O)O'],['caffeine-ish benzene','c1ccccc1'],['ibuprofen','CC(C)Cc1ccc(cc1)C(C)C(=O)O'],['paracetamol','CC(=O)Nc1ccc(O)cc1'],['nitrobenzene','O=[N+]([O-])c1ccccc1']]){
 try{const mol=Chem.prepare(Chem.parseMol(toMol(s)));const p=props(mol);console.log(n.padEnd(20),'MW',p.mw.toFixed(1),'TPSA',p.tpsa.toFixed(1),'HBD',p.hbd,'HBA',p.hba,'RB',p.rb,'MLOGP',p.logp.toFixed(2),'logS',p.logs.toFixed(2),'Ro5 viol',p.lipinski.violations)}catch(e){console.log(n,'ERR',e.message)}}
