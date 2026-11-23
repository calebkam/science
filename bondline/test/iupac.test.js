const {name}=require('../iupac.js'),P=require('./smiles.js');
const T=[
['C','methane'],['CC','ethane'],['CCC','propane'],['CCCC','butane'],['CC(C)C','2-methylpropane'],['CC(C)(C)C','2,2-dimethylpropane'],
['CCCCCC','hexane'],['CC(C)CC(C)(C)C','2,2,4-trimethylpentane'],['CCC(CC)CC','3-ethylpentane'],
['C=C','ethene'],['CC=C','prop-1-ene'],['C=CC=C','buta-1,3-diene'],['CC#C','prop-1-yne'],['CCC=CC','pent-2-ene'],
['CO','methanol'],['CCO','ethanol'],['CC(C)O','propan-2-ol'],['CCCO','propan-1-ol'],['OCCO','ethane-1,2-diol'],['OCC(O)CO','propane-1,2,3-triol'],
['CCl','chloromethane'],['ClCCl','dichloromethane'],['ClC(Cl)Cl','trichloromethane'],['ClCCCl','1,2-dichloroethane'],['CC(Cl)CBr','1-bromo-2-chloropropane'],
['CC=O','acetaldehyde'],['CCC=O','propanal'],['CC(=O)C','propan-2-one'],['CCC(=O)CC','pentan-3-one'],['CC(=O)CC(C)=O','pentane-2,4-dione'],
['CC(=O)O','acetic acid'],['CCC(=O)O','propanoic acid'],['OC(=O)CCC(=O)O','butanedioic acid'],['OC=O','formic acid'],['CC(C)C(=O)O','2-methylpropanoic acid'],
['CC(=O)OC','methyl acetate'],['CCOC(=O)C','ethyl acetate'],['CCC(=O)OCC','ethyl propanoate'],
['CC(N)=O','acetamide'],['CCC(=O)N','propanamide'],['CC(=O)NC','N-methylacetamide'],['CC#N','acetonitrile'],['CCCC#N','butanenitrile'],
['CN','methanamine'],['CCN','ethanamine'],['CC(C)N','propan-2-amine'],['CNC','N-methylmethanamine'],['CN(C)C','N,N-dimethylmethanamine'],['NCCN','ethane-1,2-diamine'],
['COC','methoxymethane'],['CCOCC','ethoxyethane'],['COCCOC','1,2-dimethoxyethane'],
['CCS','ethanethiol'],['C[N+](=O)[O-]','nitromethane'],['CCCC[N+](=O)[O-]','1-nitrobutane'],
['C1CCCCC1','cyclohexane'],['C1CC1','cyclopropane'],['C1CCCC1','cyclopentane'],['CC1CCCCC1','methylcyclohexane'],['OC1CCCCC1','cyclohexanol'],
['C1=CCCCC1','cyclohexene'],['C1=CC=CCC1','cyclohexa-1,3-diene'],['CC1=CCCCC1','1-methylcyclohex-1-ene'],
['C1=CC=CC=C1','benzene'],['Cc1ccccc1','methylbenzene'],

['Oc1ccccc1','phenol'],['Nc1ccccc1','aniline'],['OC(=O)c1ccccc1','benzoic acid'],['O=Cc1ccccc1','benzaldehyde'],['N#Cc1ccccc1','benzonitrile'],['NC(=O)c1ccccc1','benzamide'],
['Clc1ccccc1','chlorobenzene'],['Clc1ccc(Cl)cc1','1,4-dichlorobenzene'],['Cc1ccc(O)cc1','4-methylphenol'],['Cc1ccccc1C','1,2-dimethylbenzene'],['COc1ccccc1','methoxybenzene'],
['CCc1ccccc1','ethylbenzene'],['C=Cc1ccccc1','ethenylbenzene'],['Oc1ccccc1O','benzene-1,2-diol'],['CC(=O)c1ccccc1','1-phenylethan-1-one'],['OCc1ccccc1','phenylmethanol'],
['COC(=O)c1ccccc1','methyl benzoate'],['CC(=O)Oc1ccccc1C(=O)O','2-(acetyloxy)benzoic acid'],['Nc1ccc(O)cc1','4-aminophenol'],['O=[N+]([O-])c1ccccc1','nitrobenzene'],
['OC(=O)CC(O)(CC(=O)O)C(=O)O','2-hydroxypropane-1,2,3-tricarboxylic acid'],['CC(C)CO','2-methylpropan-1-ol'],['CC(C)(C)O','2-methylpropan-2-ol'],
['CCCCC(CC)CO','2-ethylhexan-1-ol'],['CC(C)Cc1ccc(C(C)C(=O)O)cc1','2-[4-(2-methylpropyl)phenyl]propanoic acid'],
['OC(=O)C(N)C','2-aminopropanoic acid'],['CC(O)C(=O)O','2-hydroxypropanoic acid'],['OCC(=O)O','hydroxyacetic acid'],['ClCC(=O)O','chloroacetic acid'],
['NCCCCN','butane-1,4-diamine'],['CCN(CC)CC','N,N-diethylethanamine'],['CCNC','N-methylethanamine'],['CN(C)c1ccccc1','N,N-dimethylaniline'],
['C1CCC(CC1)C(=O)O','cyclohexanecarboxylic acid'],['OC1CCCCC1O','cyclohexane-1,2-diol'],['CC1CCC(C)CC1','1,4-dimethylcyclohexane'],['O=C1CCCCC1','cyclohexanone'],
['C=CCO','prop-2-en-1-ol'],['C=CC(=O)O','prop-2-enoic acid'],['CC=CC=O','but-2-enal'],['C#CCO','prop-2-yn-1-ol'],['CC(C)=C','2-methylprop-1-ene'],
['CC(=O)CC(=O)O','3-oxobutanoic acid'],['O=CCCC(=O)O','4-oxobutanoic acid'],['CCOC(=O)CC(=O)OCC','diethyl propanedioate'],['CC(C)OC(C)C','2-(propan-2-yloxy)propane'],
['FC(F)(F)C(=O)O','trifluoroacetic acid'],['CC(C)(C)c1ccccc1','tert-butylbenzene'],['CCCCCCCC','octane'],['C(C)(C)(C)CC(C)C','2,2,4-trimethylpentane'],
['BrCC(Br)CBr','1,2,3-tribromopropane'],['CCC(C)CC(C)C','2,4-dimethylhexane'],['CCCC(C)(C)CC','3,3-dimethylhexane'],
];
const K=(s)=>s.replace(/c/g,'C');
let bad=0;
for(const [smi,exp] of T){let s=smi;
  /* aromatic lowercase -> Kekulé */ 
  const r=name(P(s)),got=r.name||('ERR '+r.error+(r.detail?' '+r.detail:''));
  if(got!==exp){bad++;console.log('x',smi.padEnd(22),'got:',got,' want:',exp)}}
console.log(T.length-bad+'/'+T.length+' ok');
