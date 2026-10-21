import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export async function fetchRates() {
  const url='https://www.ccilindia.com/zcyc-parameters';
  const response=await fetch(url,{signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw Error(`CCIL returned ${response.status}`);
  const html=await response.text();
  const rows=[...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
  for(const row of rows){
    const cells=[...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(m=>m[1].replace(/<[^>]+>/g,'').trim());
    if(cells.length!==7||!/^\d{2}-\d{2}-\d{4}$/.test(cells[0]))continue;
    const values=cells.slice(1).map(Number);if(!values.every(Number.isFinite))continue;
    const [d,m,y]=cells[0].split('-');
    return {source:'CCIL NSS zero-coupon curve',sourceUrl:url,asOf:`${y}-${m}-${d}`,retrievedAt:new Date().toISOString(),compounding:'continuous',conventionUnverified:true,
      note:'NSS spot yields from CCIL. Compounding convention must be verified; continuous is an explicit research assumption. Short maturities use the fitted NSS curve, not separately observed daily tenors.',
      nss:Object.fromEntries(['beta0','beta1','beta2','beta3','tau1','tau2'].map((k,i)=>[k,values[i]]))};
  }
  throw Error('CCIL table format changed or no dated NSS row was available. Existing curve was preserved.');
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
  const curve=await fetchRates();
  await writeFile(new URL('../dist/rates.json',import.meta.url),JSON.stringify(curve,null,2));
  console.log(`Saved CCIL curve dated ${curve.asOf}. Compounding assumption remains explicit.`);
}
