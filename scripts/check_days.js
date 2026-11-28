// Fails if the daily prompts repeat too soon: a prompt twice in one day, or again within REST days.
// Simulates the next 400 days with the real dayPrompts() from src/template.html.
const fs=require('fs');
const src=fs.readFileSync(__dirname+'/../src/template.html','utf8');
const grab=(a,b)=>{const i=src.indexOf(a),j=src.indexOf(b,i);if(i<0||j<0)throw new Error('missing '+a);return src.slice(i,j)};
const code=grab('const CATS=','\n',0)+'\n'+grab('function rng(','function newGame');if(!code.includes('function dayPrompts'))throw new Error('dayPrompts not found');
const {CATS,dayPrompts}=new Function(code+';return {CATS,dayPrompts}')();
const REST=3,DAYS=400,FIRST=3;// days 1-2 were played before this rule
const last={};let bad=0;const cat={};CATS.forEach(([c,ids])=>ids.forEach(id=>cat[id]=c));
for(let d=1;d<=DAYS;d++){const qs=dayPrompts(d);
  if(qs.length!==7){console.log(`day ${d}: ${qs.length} prompts`);bad++}
  if(new Set(qs).size!==qs.length){console.log(`day ${d}: duplicate in ${qs}`);bad++}
  qs.forEach(id=>{if(!cat[id]){console.log(`day ${d}: unknown prompt ${id}`);bad++}
    if(d>=FIRST&&last[id]&&d-last[id]<=REST){console.log(`day ${d}: ${id} repeats from day ${last[id]}`);bad++}
    last[id]=d});
  if(d<=6)console.log(`day ${d}: ${qs.join(', ')}`)}
if(bad){console.log(`${bad} problem(s)`);process.exit(1)}
console.log(`daily prompts: ${DAYS} days, no prompt within ${REST} days of its last use`);
