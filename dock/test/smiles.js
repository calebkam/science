/* tiny Kekulé-SMILES reader for tests: B C N O P S F Cl Br I, [..] atoms with H and charge, branches, ring digits, = # */
const VAL={C:4,N:3,O:2,S:2,F:1,Cl:1,Br:1,I:1};
module.exports=function(s){const atoms=[],bonds=[],stack=[],rings={};let prev=-1,ord=1,i=0;
  const add=(el,q,h)=>{atoms.push({el,q:q||0,h:h,expl:h!==undefined});const id=atoms.length-1;if(prev>=0)bonds.push([prev,id,ord]);prev=id;ord=1;return id};
  while(i<s.length){const c=s[i];
    if(c==='('){stack.push(prev);i++}else if(c===')'){prev=stack.pop();i++}
    else if(c==='='){ord=2;i++}else if(c==='#'){ord=3;i++}
    else if(/\d/.test(c)){const d=c;if(rings[d]!==undefined){bonds.push([rings[d].a,prev,rings[d].o>1?rings[d].o:ord]);delete rings[d]}else rings[d]={a:prev,o:ord};ord=1;i++}
    else if(c==='['){const j=s.indexOf(']',i),t=s.slice(i+1,j),m=/^([A-Z][a-z]?)(H(\d*))?([+-]\d*|\+\+|--)?$/.exec(t);let q=0;if(m[4]){q=m[4]==='+'?1:m[4]==='-'?-1:m[4]==='++'?2:m[4]==='--'?-2:parseInt(m[4])}
      add(m[1],q,m[2]?(m[3]?+m[3]:1):0);i=j+1}
    else{if(c==='c'||c==='n'){add(c.toUpperCase());atoms[atoms.length-1].arom=1;i++;continue}
    const el=(s[i+1]&&/[a-z]/.test(s[i+1])&&VAL[c+s[i+1]])?c+s[i+1]:c;add(el);i+=el.length}}
  /* kekulise: every aromatic atom gets exactly one double bond to an aromatic neighbour */
  const ab=bonds.filter(b=>atoms[b[0]].arom&&atoms[b[1]].arom),done=new Set();
  (function solve(k){if(k===ab.length)return atoms.every((a,i)=>!a.arom||done.has(i));
    const [x,y]=ab[k];if(!done.has(x)&&!done.has(y)){done.add(x);done.add(y);ab[k][2]=2;if(solve(k+1))return true;done.delete(x);done.delete(y);ab[k][2]=1}
    return solve(k+1)})(0);
  const deg=atoms.map(()=>0);bonds.forEach(b=>{deg[b[0]]+=b[2];deg[b[1]]+=b[2]});
  atoms.forEach((a,k)=>{if(!a.expl)a.h=Math.max(0,VAL[a.el]-deg[k]);delete a.expl});
  return{atoms,bonds}};
