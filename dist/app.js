import { calibrate, rateIntegral, varianceAt, timeTo, validateRateCurve, validateSnapshot } from './pricing.js';
import { DEMOS, makeDemo } from './demo.js';
import { Upstox, applyFeed } from './live.js';

const $ = id => document.getElementById(id);
const put = (id, value) => { $(id).textContent = value; };
const money = n => Number.isFinite(n) ? new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:2}).format(n) : '—';
const smallMoney = n => Number.isFinite(n) ? new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',minimumFractionDigits:4,maximumFractionDigits:4}).format(n) : '—';
const pct = n => Number.isFinite(n) ? `${(n*100).toFixed(2)}%` : '—';
const dateTime = value => Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false})+' IST' : 'unavailable';
const state = {mode:'demo',snapshot:null,rates:null,bundled:null,fit:null,client:null,catalogue:[],worker:null,simulation:null,runFit:null,generation:0,streamTimer:null};
function message(text,kind=''){put('notice',text);$('notice').className=`notice ${kind}`;}
function options(id,values,selected){const el=$(id);el.replaceChildren(...values.map(x=>{const o=document.createElement('option');o.value=String(x.value??x);o.textContent=String(x.label??x);return o;}));if(values.some(x=>String(x.value??x)===String(selected)))el.value=String(selected);}
function row(values,classes=[]){const tr=document.createElement('tr');values.forEach((v,i)=>{const td=document.createElement('td');td.textContent=v;if(classes[i])td.className=classes[i];tr.append(td);});return tr;}
function invalidateSimulation(){state.worker?.terminate();state.worker=null;state.simulation=null;state.runFit=null;$('simulationResults').hidden=true;$('progress').hidden=true;put('simulationStatus','READY');put('runSimulation','Run simulation ↗');}
function clearResults(error=''){
 state.fit=null;for(const id of ['marketMid','modelPrice','priceDifference','effectiveVol','differencePct','usedCount','rateDetail'])put(id,'—');
 for(const id of ['volChart','rateChart','nodeRows','auditRows','warnings'])$(id).replaceChildren();
 put('marketSpread','Bid — / Ask —');put('lastPrice','Last traded —');put('auditCount','');
 $('fitError').hidden=!error;put('fitError',error);$('runSimulation').disabled=true;$('exportReport').disabled=true;
}
const NS='http://www.w3.org/2000/svg';
function svgElement(name,attrs={},text){const n=document.createElementNS(NS,name);for(const [k,v]of Object.entries(attrs))n.setAttribute(k,String(v));if(text!==undefined)n.textContent=text;return n;}
function chart(id,series,{yFormat=v=>v.toFixed(1),xLabel='Days from valuation',title='Curve'}={}){
 const container=$(id),W=720,H=220,L=54,R=18,TOP=17,B=39;
 const all=series.flatMap(s=>s.points).filter(p=>Number.isFinite(p.x)&&Number.isFinite(p.y));if(!all.length){container.replaceChildren();return;}
 const maxX=Math.max(...all.map(p=>p.x),1);let minY=Math.min(...all.map(p=>p.y)),maxY=Math.max(...all.map(p=>p.y));const pad=Math.max((maxY-minY)*.18,Math.abs(maxY)*.04,.05);minY-=pad;maxY+=pad;
 const x=v=>L+v/maxX*(W-L-R),y=v=>TOP+(maxY-v)/(maxY-minY)*(H-TOP-B);
 const svg=svgElement('svg',{viewBox:`0 0 ${W} ${H}`,role:'img','aria-label':title});svg.append(svgElement('title',{},title));
 for(let i=0;i<4;i++){const v=minY+(maxY-minY)*i/3;svg.append(svgElement('line',{x1:L,y1:y(v),x2:W-R,y2:y(v),stroke:'#e8ece4','stroke-dasharray':'3 4'}));svg.append(svgElement('text',{x:L-10,y:y(v)+3,'text-anchor':'end'},yFormat(v)));}
 for(let i=0;i<5;i++){const v=maxX*i/4;svg.append(svgElement('text',{x:x(v),y:H-22,'text-anchor':'middle'},v.toFixed(0)));}
 svg.append(svgElement('text',{x:(W+L-R)/2,y:H-3,'text-anchor':'middle'},xLabel));
 series.forEach(s=>{if(!s.dots)svg.append(svgElement('path',{d:s.points.map((p,i)=>`${i?'L':'M'}${x(p.x).toFixed(2)},${y(p.y).toFixed(2)}`).join(' '),fill:'none',stroke:s.color||'#176f5d','stroke-width':s.width||2.3,opacity:s.opacity||1}));if(s.dots||s.markers)for(const p of s.points){const c=svgElement('circle',{cx:x(p.x),cy:y(p.y),r:s.dots?4.5:3,fill:s.dots?'#fff':s.color||'#176f5d',stroke:s.color||'#176f5d','stroke-width':1.7});c.append(svgElement('title',{},`${p.x.toFixed(2)} days: ${yFormat(p.y)}`));svg.append(c);}});
 container.replaceChildren(svg);
}
function targetId(){return state.snapshot?.quotes.find(q=>q.expiry===$('expiry').value&&q.type===$('optionType').value&&q.strike===Number($('strike').value))?.id;}
function updateContracts(reset=false){
 const s=state.snapshot;if(!s)return;const expiries=[...new Set(s.quotes.filter(q=>timeTo(q.expiry,s.asOf)>0).map(q=>q.expiry))].sort();
 options('expiry',expiries,reset?expiries[0]:$('expiry').value);updateStrikes(reset);
 put('spot',money(s.spot));put('snapshotTime',`${s.source||'Imported snapshot'} · Valuation: ${dateTime(s.asOf)}`);
}
function updateStrikes(reset=false){const s=state.snapshot;if(!s)return;const strikes=[...new Set(s.quotes.filter(q=>q.expiry===$('expiry').value&&q.type===$('optionType').value).map(q=>q.strike))].sort((a,b)=>a-b);const selected=reset?strikes.reduce((a,b)=>Math.abs(b-s.spot)<Math.abs(a-s.spot)?b:a,strikes[0]):Number($('strike').value);options('strike',strikes,selected);}
function showRates(){put('rateDate',state.rates.asOf);put('rateSource',state.rates.source||'Custom rate curve');$('compounding').value=state.rates.compounding;}
function renderFit({live=false}={}){
 if(!state.snapshot)return;if(!live)invalidateSimulation();
 put('spot',money(state.snapshot.spot));put('snapshotTime',`${state.snapshot.source||'Imported snapshot'} · Valuation: ${dateTime(state.snapshot.asOf)}`);
 const maturity=timeTo($('expiry').value,state.snapshot.asOf);put('maturity',`${(maturity*365).toFixed(3)} calendar days remaining · expiry at 15:30 IST`);
 try{state.fit=calibrate(state.snapshot,targetId(),state.rates,Number($('dividend').value)/100);}catch(e){clearResults(e.message);return;}
 const f=state.fit;$('fitError').hidden=true;$('runSimulation').disabled=!!state.worker;$('exportReport').disabled=false;
 put('marketMid',money(f.marketMid));put('modelPrice',money(f.price));put('marketSpread',`Bid ${money(f.target.bid)} / Ask ${money(f.target.ask)}`);put('lastPrice',`Last traded ${money(f.target.ltp)} · ${f.snapshot.synthetic?'synthetic':'quote time '+dateTime(f.target.quoteTime)}`);
 put('priceDifference',f.marketMid===null?'—':`${f.price-f.marketMid>=0?'+':''}${money(f.price-f.marketMid)}`);put('differencePct',f.marketMid>0?`${((f.price/f.marketMid-1)*100).toFixed(2)}% of market midpoint`:'No usable market midpoint');
 put('effectiveVol',`${pct(f.effectiveVol)} effective volatility · ${pct(f.effectiveRate)} zero rate`);
 const used=f.audit.filter(q=>q.status==='used').length;put('usedCount',`${used} QUOTES · ${f.nodes.length} EXPIRIES`);
 const max=f.nodes.at(-1).T,points=Array.from({length:100},(_,i)=>{const t=max*(i+1)/100;return{x:t*365,y:Math.sqrt(varianceAt(f.nodes,t)/t)*100};});
 chart('volChart',[{points,markers:false},{points:f.nodes.map(n=>({x:n.T*365,y:n.rawVol*100})),dots:true,color:'#8d9885'}],{yFormat:v=>`${v.toFixed(1)}%`,title:'Annualised implied volatility by remaining calendar days'});
 $('nodeRows').replaceChildren(...f.nodes.map(n=>row([n.expiry,(n.T*365).toFixed(2),pct(n.rawVol),pct(Math.sqrt(n.w/n.T)),n.count])));
 const ratePoints=Array.from({length:60},(_,i)=>{const t=max*(i+1)/60;return{x:t*365,y:rateIntegral(f.rates,t)/t*100};});
 chart('rateChart',[{points:ratePoints}],{yFormat:v=>`${v.toFixed(2)}%`,title:'Continuously compounded zero rate by remaining calendar days'});
 put('rateDetail',`${f.rates.asOf} curve · ACT/365 · ${pct(f.effectiveRate)} continuously compounded zero rate for ${(f.T*365).toFixed(3)} days. Interval forward rates drive simulation.`);
 const warnings=[...(f.snapshot.synthetic?['Synthetic option quotes: use this mode to inspect the method, not to infer real market values.']:[]),...f.warnings];
 $('warnings').replaceChildren(...warnings.map(w=>{const li=document.createElement('li');li.textContent=w;return li;}));
 $('auditRows').replaceChildren(...f.audit.sort((a,b)=>({ 'held-out':0,used:1,rejected:2}[a.status]-{'held-out':0,used:1,rejected:2}[b.status])).map(q=>row([q.expiry,q.strike,q.type,q.status,pct(q.iv),q.reason],['','','',`status-${q.status}`])));put('auditCount',`${f.audit.length} contracts`);
 if(live&&state.simulation)put('simulationStatus','FROZEN SNAPSHOT');
}
function stopLive(){state.generation++;clearTimeout(state.streamTimer);state.streamTimer=null;state.client?.close();state.client=null;put('streamStatus','Disconnected');}
function loadDemo(index=0){stopLive();state.mode='demo';$('dataMode').value='demo';$('liveControls').hidden=true;busy(false);options('equity',DEMOS.map((s,i)=>({value:i,label:`${s.symbol} · ${s.exchange}`})),index);state.snapshot=makeDemo(index,state.bundled);$('dividend').value='1';put('modeBadge','SYNTHETIC DEMO');$('modeBadge').className='badge';updateContracts(true);renderFit();message('Demonstration · These option quotes and spot prices are synthetic, frozen at 16 October 2026, 10:00 IST. Interest rates are separate inputs; inspect their source and observation date.');}
function busy(on){for(const id of ['equity','exchange','expiry','strike','optionType','refreshQuotes'])$(id).disabled=on;}
async function startStream(generation){
 const s=state.snapshot;if(!s||state.mode!=='live')return;
 const nearest=[...s.quotes].sort((a,b)=>Math.abs(Math.log(a.strike/s.spot))-Math.abs(Math.log(b.strike/s.spot)));
 const keys=[s.underlyingKey,targetId(),...nearest.map(q=>q.id)].filter(Boolean);
 try{await state.client.stream(keys,message=>{if(generation!==state.generation||state.mode!=='live')return;if(applyFeed(state.snapshot,message)&&!state.streamTimer)state.streamTimer=setTimeout(()=>{state.streamTimer=null;renderFit({live:true});},2000);},status=>{if(generation===state.generation)put('streamStatus',status);});}
 catch(e){if(generation===state.generation)put('streamStatus',`Streaming unavailable: ${e.message} Snapshot remains available.`);}
}
async function loadLiveEquity(){
 const client=state.client;if(!client)return;const generation=++state.generation;clearTimeout(state.streamTimer);state.streamTimer=null;client.stopStream();invalidateSimulation();clearResults();state.snapshot=null;busy(true);message('Loading option chains across available expiries…');
 try{const instrument=state.catalogue.find(x=>x.key===$('equity').value);if(!instrument)throw Error('No optionable equity is available on this exchange.');const s=await client.snapshot(instrument);if(generation!==state.generation)return;validateSnapshot(s);state.snapshot=s;updateContracts(true);renderFit();message('Upstox market data · Price estimates refresh with incoming quotes. REST quote times indicate retrieval time; streaming also depends on exchange hours and account permissions.','live');await startStream(generation);}
 catch(e){if(generation===state.generation){clearResults(e.message);message(e.message,'error');}}
 finally{if(generation===state.generation)busy(false);}
}
async function loadCatalogue(){
 if(!state.client)return;const client=state.client,generation=++state.generation;client.stopStream();clearTimeout(state.streamTimer);state.streamTimer=null;state.snapshot=null;invalidateSimulation();clearResults();busy(true);message(`Loading ${$('exchange').value} optionable equities…`);
 try{const list=await client.catalogue($('exchange').value);if(generation!==state.generation)return;state.catalogue=list;options('equity',list.map(x=>({value:x.key,label:x.symbol})));if(!list.length)throw Error('The provider lists no unexpired equity options for this exchange.');await loadLiveEquity();}
 catch(e){if(generation===state.generation){message(e.message,'error');clearResults(e.message);busy(false);}}
}
function download(name,data){const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);}
async function readJSON(file){if(!file)throw Error('No file selected');if(file.size>5*1024*1024)throw Error('Use a JSON file smaller than 5 MB.');return JSON.parse(await file.text());}

$('connectOpen').onclick=()=>{$('connectDialog').showModal();$('token').focus();};$('connectClose').onclick=()=>{$('token').value='';$('connectDialog').close();};$('connectDialog').addEventListener('close',()=>{$('token').value='';$('dataMode').value=state.mode;});
$('connectForm').onsubmit=async e=>{e.preventDefault();const token=$('token').value.trim();if(!token)return;stopLive();state.client=new Upstox(token);state.mode='live';$('token').value='';$('connectDialog').close();$('dataMode').value='live';$('liveControls').hidden=false;put('modeBadge','UPSTOX');$('modeBadge').className='badge live';await loadCatalogue();};
$('dataMode').onchange=()=>{if($('dataMode').value==='demo')loadDemo();else if($('dataMode').value==='live'){$('connectDialog').showModal();$('token').focus();}else{$('snapshotFile').click();$('dataMode').value=state.mode;}};
$('equity').onchange=()=>state.mode==='demo'?loadDemo(Number($('equity').value)):state.mode==='live'?loadLiveEquity():null;
$('exchange').onchange=loadCatalogue;$('refreshQuotes').onclick=loadLiveEquity;$('disconnect').onclick=()=>loadDemo();
for(const id of ['expiry','optionType'])$(id).onchange=()=>{updateStrikes();renderFit();if(state.mode==='live')startStream(state.generation);};
$('strike').onchange=()=>{renderFit();if(state.mode==='live')startStream(state.generation);};$('dividend').onchange=()=>renderFit();
$('compounding').onchange=()=>{state.rates={...state.rates,compounding:$('compounding').value};renderFit();};
$('refreshRates').disabled=!['localhost','127.0.0.1'].includes(location.hostname);
$('refreshRates').onclick=async()=>{const button=$('refreshRates');button.disabled=true;try{const r=await fetch('/api/rates');if(!r.ok)throw Error('CCIL refresh failed. Retaining the current curve.');state.rates=validateRateCurve(await r.json());showRates();renderFit();message(`Loaded CCIL curve dated ${state.rates.asOf}. Recalculated using the new rate curve.`);}catch(e){message(e.message,'error');}finally{button.disabled=false;}};
$('resetRates').onclick=()=>{state.rates=structuredClone(state.bundled);showRates();renderFit();};
$('applyRates').onclick=()=>{try{const points=$('ratePoints').value.trim().split(/\n/).map(line=>{const [days,ratePct,...rest]=line.split(',').map(x=>Number(x.trim()));if(rest.length)throw Error('Use exactly two columns: days, rate %.');return{days,ratePct};});state.rates=validateRateCurve({source:'User-entered maturity curve',asOf:$('customRateDate').value,compounding:$('compounding').value,points});showRates();renderFit();message('Custom interest-rate curve applied. Its rates are user inputs, not verified market observations.');}catch(e){message(e.message,'error');}};
$('importRates').onclick=()=>$('rateFile').click();$('rateFile').onchange=async()=>{try{const raw=await readJSON($('rateFile').files[0]);const source=raw.rates||raw;state.rates=validateRateCurve(source);showRates();renderFit();message('Imported interest-rate curve. Verify the source, observation date and compounding convention.');}catch(e){message(e.message,'error');}finally{$('rateFile').value='';}};
$('importSnapshot').onclick=()=>$('snapshotFile').click();$('snapshotFile').onchange=async()=>{try{const raw=await readJSON($('snapshotFile').files[0]);const s=validateSnapshot(raw.snapshot||raw);const r=raw.rates?validateRateCurve(raw.rates):state.rates;stopLive();state.snapshot=s;state.rates=r;state.mode='import';$('dataMode').value='import';$('liveControls').hidden=true;options('equity',[{value:s.symbol,label:`${s.symbol} · ${s.exchange}`}]);if(Number.isFinite(raw.dividend))$('dividend').value=String(raw.dividend*100);put('modeBadge',s.synthetic?'IMPORTED DEMO':'IMPORTED SNAPSHOT');$('modeBadge').className='badge';showRates();updateContracts(true);if(raw.targetId){const q=s.quotes.find(q=>q.id===raw.targetId);if(q){$('expiry').value=q.expiry;$('optionType').value=q.type;updateStrikes();$('strike').value=String(q.strike);}}renderFit();message('Imported snapshot · Prices are frozen at its valuation timestamp. Data provenance is supplied by the file and has not been independently verified.');}catch(e){message(e.message,'error');}finally{$('snapshotFile').value='';}};
$('exportSnapshot').onclick=()=>{if(state.snapshot)download(`${state.snapshot.symbol}-snapshot.json`,{schemaVersion:1,snapshot:state.snapshot,rates:state.rates,dividend:Number($('dividend').value)/100,targetId:targetId()});};
$('exportReport').onclick=()=>{if(!state.fit)return;const f=state.fit;download(`${f.snapshot.symbol}-research-run.json`,{schemaVersion:1,method:'Held-out near-forward IV maturity curve + deterministic-curve European pricing + Milstein Monte Carlo',exportedAt:new Date().toISOString(),snapshot:f.snapshot,rates:f.rates,dividend:f.dividend,targetId:f.target.id,calibration:{settings:f.settings,nodes:f.nodes,audit:f.audit,price:f.price,marketMid:f.marketMid,variance:f.variance,R:f.R,warnings:f.warnings},simulation:state.simulation?{snapshotAsOf:state.runFit.snapshot.asOf,target:state.runFit.target,analyticalBenchmark:state.runFit.price,result:state.simulation}:null});};
$('runSimulation').onclick=()=>{
 if(!state.fit)return;invalidateSimulation();const fit=structuredClone(state.fit);state.runFit=fit;const worker=new Worker('./worker.js',{type:'module'});state.worker=worker;$('runSimulation').disabled=true;$('progress').hidden=false;$('progress').value=0;put('simulationStatus','SIMULATING');put('runSimulation','Calculating…');
 const fail=messageText=>{worker.terminate();state.worker=null;$('runSimulation').disabled=!state.fit;$('progress').hidden=true;put('runSimulation','Run simulation ↗');put('simulationStatus','COULD NOT RUN');message(messageText,'error');};
 worker.onerror=()=>fail('The simulation worker could not start. Reload and try again.');
 worker.onmessage=({data})=>{if(data.type==='progress'){$('progress').value=data.progress;return;}if(data.type==='error'){fail(data.message);return;}worker.terminate();state.worker=null;state.simulation=data.result;const r=data.result;$('progress').hidden=true;$('runSimulation').disabled=!state.fit;put('runSimulation','Run simulation ↗');put('simulationStatus',state.mode==='live'?'FROZEN SNAPSHOT':'COMPLETE');$('simulationResults').hidden=false;put('mcPrice',money(r.coarse.mean));put('mcInterval',`${money(r.coarse.low)} – ${money(r.coarse.high)}`);put('mcDelta',`${r.difference.mean>=0?'+':''}${smallMoney(r.difference.mean)}`);put('mcDetails',`${r.paths.toLocaleString('en-IN')} paths · ${r.steps} time steps · seed ${r.seed} · ${(r.runtimeMs/1000).toFixed(2)} s. Frozen at ${dateTime(fit.snapshot.asOf)}. Analytical benchmark for this run: ${money(fit.price)}. Half-step estimate: ${money(r.fine.mean)}.`);put('mcWarnings',r.warnings.join(' '));chart('pathChart',r.lines.map(points=>({points:points.map((y,i)=>({x:r.times[i]*365,y})),width:1.2,color:'#176f5d',opacity:.35})),{yFormat:v=>`₹${Math.round(v)}`,title:'Twelve illustrative simulated underlying price paths'});};
 worker.postMessage({fit,options:{paths:Number($('paths').value),stepDays:Number($('stepDays').value),seed:Number($('seed').value)}});
};
for(const id of ['paths','stepDays','seed'])$(id).onchange=()=>{invalidateSimulation();$('runSimulation').disabled=!state.fit;};
window.addEventListener('beforeunload',()=>{stopLive();state.worker?.terminate();});
try{const r=await fetch('./rates.json');if(!r.ok)throw Error('Bundled rate curve could not be loaded.');state.bundled=validateRateCurve(await r.json());state.rates=structuredClone(state.bundled);$('customRateDate').value=state.rates.asOf;showRates();loadDemo();}catch(e){message(e.message,'error');clearResults(e.message);}
