import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {optionPrice,impliedVol,rateIntegral,quotedToContinuous,timeTo,calibrate,isotonic,varianceAt,simulate,statistics,validateRateCurve,validateSnapshot} from '../dist/pricing.js';
import {makeDemo} from '../dist/demo.js';
const rates=JSON.parse(fs.readFileSync(new URL('../dist/rates.json',import.meta.url)));
const near=(a,b,tol=1e-9)=>assert.ok(Math.abs(a-b)<tol,`${a} differs from ${b}`);
function setup(){const s=makeDemo(0,rates),q=s.quotes.find(q=>q.strike===s.spot&&q.type==='call');return{s,q,fit:calibrate(s,q.id,rates,.01)};}
test('European benchmark agrees with known Black–Scholes value and put–call parity',()=>{
 const call=optionPrice(100,100,.05,0,.04,'call'),put=optionPrice(100,100,.05,0,.04,'put');
 near(call,10.450583572,2e-5);near(call-put,100-100*Math.exp(-.05));
 near(optionPrice(100,110,.05,.01,0,'put'),110*Math.exp(-.05)-100*Math.exp(-.01));
});
test('IV recovers volatility for both sides and rejects bound violations',()=>{
 for(const type of ['call','put'])for(const strike of [90,100,110]){const price=optionPrice(100,strike,.03,.005,.27**2*.4,type);near(impliedVol(price,100,strike,.03,.005,.4,type),.27,1e-9);}
 assert.throws(()=>impliedVol(101,100,100,.03,0,1,'call'),/bounds/);
});
test('Exact residual time includes fractional days at IST expiry',()=>{near(timeTo('2026-10-27','2026-10-16T10:00:00+05:30')*365,11+5.5/24);near(timeTo('2026-10-27','2026-10-27T15:30:00+05:30'),0);});
test('Rate interpolation preserves discount factors and interval forward integrals',()=>{
 const r={asOf:'2026-10-15',compounding:'continuous',points:[{days:10,ratePct:5},{days:30,ratePct:6}]};
 near(rateIntegral(r,20/365),(.05*10+.06*30)/2/365);
 near(rateIntegral(r,30/365)-rateIntegral(r,10/365),.065*20/365);
 near(quotedToContinuous(.06,'annual',.2),Math.log(1.06));near(quotedToContinuous(.06,'simple',.2),Math.log(1.012)/.2);
 assert.throws(()=>rateIntegral(r,31/365),/cover/);assert.throws(()=>validateRateCurve({...r,points:[{days:30,ratePct:6},{days:10,ratePct:5}]}),/increasing/);
});
test('Selected option AND parity counterpart never influence the fitted value',()=>{
 const {s,q,fit}=setup();const changed=structuredClone(s);
 for(const x of changed.quotes)if(x.expiry===q.expiry&&x.strike===q.strike){x.bid=500;x.ask=600;x.volume=0;}
 const next=calibrate(changed,q.id,rates,.01);near(next.price,fit.price,1e-12);assert.deepEqual(next.nodes,fit.nodes);
 assert.equal(next.audit.filter(x=>x.status==='held-out').length,2);assert.notEqual(next.marketMid,fit.marketMid);
});
test('Liquidity filters reject crossed, stale and untraded quotes; insufficient support fails closed',()=>{
 const {s,q,fit}=setup(),used=fit.audit.filter(x=>x.status==='used');const changed=structuredClone(s);
 changed.quotes.find(x=>x.id===used[0].id).bid=1e6;changed.quotes.find(x=>x.id===used[1].id).quoteTime='2026-10-15T10:00:00+05:30';changed.quotes.find(x=>x.id===used[2].id).volume=0;
 const f=calibrate(changed,q.id,rates,.01);for(const x of used.slice(0,3))assert.equal(f.audit.find(a=>a.id===x.id).status,'rejected');
 changed.quotes.forEach(x=>x.volume=0);assert.throws(()=>calibrate(changed,q.id,rates,.01),/Insufficient liquid data/);
});
test('Stale target midpoint is suppressed without affecting calibration',()=>{
 const {s,q,fit}=setup();q.quoteTime='2026-10-15T10:00:00+05:30';const f=calibrate(s,q.id,rates,.01);assert.equal(f.marketMid,null);near(f.price,fit.price);
});
test('Monotone total variance produces nonnegative forward variance and disables long extrapolation',()=>{
 const nodes=isotonic([{T:.1,w:.01,weight:1},{T:.2,w:.008,weight:1},{T:.3,w:.02,weight:1}]);near(nodes[0].w,.009);near(nodes[1].w,.009);near(varianceAt(nodes,.15),.009);near(varianceAt(nodes,.05),.0045);assert.throws(()=>varianceAt(nodes,.31),/coverage/);
});
test('Time-varying Milstein converges to the deterministic-curve benchmark, reproducibly',()=>{
 const {s}=setup();const q=s.quotes.find(q=>q.expiry==='2026-12-29'&&q.strike===1400&&q.type==='put');const fit=calibrate(s,q.id,rates,.01);
 const a=simulate(fit,{paths:20000,stepDays:1,seed:123}),b=simulate(fit,{paths:20000,stepDays:1,seed:123});
 assert.deepEqual(a.coarse,b.coarse);assert.equal(a.coarse.n,10000);assert.ok(Math.abs(a.coarse.mean-fit.price)<4*a.coarse.se+.01);
 assert.ok(Math.abs(a.difference.mean)<.02);near(a.times.at(-1),fit.T);for(const n of fit.nodes.filter(n=>n.T<fit.T))assert.ok(a.times.includes(n.T));
});
test('Monte Carlo safety limits and pair-based standard errors',()=>{
 const stats=statistics();[1,2,3].forEach(x=>stats.add(x));near(stats.get().se,Math.sqrt(1/3));
 const {fit}=setup();assert.throws(()=>simulate(fit,{paths:1001}),/even/);assert.throws(()=>simulate(fit,{paths:10000,stepDays:0}),/Step size/);
});
test('Snapshot identifiers must be unique',()=>{const {s}=setup();s.quotes.push(s.quotes[0]);assert.throws(()=>validateSnapshot(s),/unique/);});
