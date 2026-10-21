export const DAY = 86400000;
export const YEAR = 365 * DAY;
export const expiryTime = date => Date.parse(`${date}T15:30:00+05:30`);
export const timeTo = (expiry, asOf) => Math.max(0, (expiryTime(expiry) - Date.parse(asOf)) / YEAR);
const require = (test, message) => { if (!test) throw Error(message); };

export function cdf(x) {
  if (x === 0) return .5;
  const t = 1 / (1 + .2316419 * Math.abs(x));
  const tail = Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI) * t *
    (.319381530 + t * (-.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x > 0 ? 1 - tail : tail;
}
export function optionPrice(spot, strike, R, Q, variance, type = 'call') {
  const s = spot * Math.exp(-Q), k = strike * Math.exp(-R);
  if (variance <= 1e-16) return Math.max(type === 'call' ? s - k : k - s, 0);
  const root = Math.sqrt(variance), d1 = (Math.log(spot / strike) + R - Q + variance / 2) / root;
  return Math.max(0, type === 'call' ? s * cdf(d1) - k * cdf(d1 - root) : k * cdf(root - d1) - s * cdf(-d1));
}
export function impliedVol(price, spot, strike, R, Q, T, type) {
  require(T > 0 && price > 0 && spot > 0 && strike > 0, 'Invalid IV inputs');
  const lower = optionPrice(spot, strike, R, Q, 0, type), upper = type === 'call' ? spot * Math.exp(-Q) : strike * Math.exp(-R);
  require(price > lower + 1e-8 && price < upper - 1e-8, 'Price outside strict no-arbitrage bounds');
  let lo = .0001, hi = 3;
  require(optionPrice(spot, strike, R, Q, hi * hi * T, type) >= price, 'IV exceeds 300% cap');
  for (let i = 0; i < 65; i++) { const mid = (lo + hi) / 2; if (optionPrice(spot, strike, R, Q, mid * mid * T, type) < price) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}
// NSS supplies a spot yield. Discount convention remains an explicit input.
export function nssYield(p, T) {
  const a = T / p.tau1, b = T / p.tau2;
  const f = x => Math.abs(x) < 1e-8 ? 1 - x / 2 : -Math.expm1(-x) / x;
  return (p.beta0 + p.beta1 * f(a) + p.beta2 * (f(a) - Math.exp(-a)) + p.beta3 * (f(b) - Math.exp(-b))) / 100;
}
export function quotedToContinuous(rate, convention, T) {
  if (convention === 'continuous') return rate;
  if (convention === 'annual') return Math.log1p(rate);
  if (convention === 'semiannual') return 2 * Math.log1p(rate / 2);
  if (convention === 'simple') return T > 0 ? Math.log1p(rate * T) / T : rate;
  throw Error('Choose a recognised rate compounding convention.');
}
export function rateIntegral(curve, T) {
  require(Number.isFinite(T) && T >= 0, 'Invalid rate maturity'); if (T === 0) return 0;
  if (curve.nss) return quotedToContinuous(nssYield(curve.nss, T), curve.compounding, T) * T;
  const pts = curve.points; require(Array.isArray(pts) && pts.length > 0, 'Rate curve is empty');
  const points = [{t:0, R:0}, ...pts.map(p => ({t:p.days / 365, R:quotedToContinuous(p.ratePct / 100, curve.compounding, p.days / 365) * p.days / 365}))];
  require(T <= points.at(-1).t + 1e-10, 'Rate curve does not cover this expiry. Add a longer maturity.');
  for (let i = 1; i < points.length; i++) if (T <= points[i].t) { const a = points[i - 1], b = points[i]; return a.R + (b.R - a.R) * (T - a.t) / (b.t - a.t); }
  return points.at(-1).R;
}
export function validateRateCurve(curve) {
  require(curve && ['continuous','annual','semiannual','simple'].includes(curve.compounding), 'Invalid rate convention');
  require(Number.isFinite(Date.parse(curve.asOf)), 'Rate curve needs a valid as-of date');
  if (curve.nss) {
    require(['beta0','beta1','beta2','beta3','tau1','tau2'].every(k=>Number.isFinite(curve.nss[k])), 'Invalid NSS parameters');
    require(curve.nss.tau1 > 0 && curve.nss.tau2 > 0, 'NSS decay parameters must be positive');
  } else {
    require(Array.isArray(curve.points) && curve.points.length >= 1 && curve.points.length <= 100, 'Rate curve needs 1–100 points');
    curve.points.forEach((p,i)=>require(Number.isFinite(p.days) && p.days > 0 && p.days <= 3650 && Number.isFinite(p.ratePct) && p.ratePct > -50 && p.ratePct < 100 && (!i || p.days > curve.points[i-1].days), 'Rate points require increasing positive days and valid percentage rates'));
  }
  return curve;
}
export function validateSnapshot(s) {
  require(s && typeof s.symbol === 'string' && s.symbol.length < 100 && ['NSE','BSE'].includes(s.exchange), 'Snapshot needs symbol and exchange');
  require(Number.isFinite(s.spot) && s.spot > 0 && s.spot < 1e8, 'Snapshot needs a positive spot');
  require(Number.isFinite(Date.parse(s.asOf)), 'Snapshot needs a valid valuation timestamp');
  require(Array.isArray(s.quotes) && s.quotes.length > 0 && s.quotes.length <= 20000, 'Snapshot needs 1–20,000 option quotes');
  const ids = new Set();
  s.quotes.forEach(q => {
    require(typeof q.id === 'string' && q.id.length < 160 && !ids.has(q.id), 'Quote identifiers must be unique'); ids.add(q.id);
    require(/^\d{4}-\d{2}-\d{2}$/.test(q.expiry) && Number.isFinite(expiryTime(q.expiry)) && Number.isFinite(q.strike) && q.strike > 0 && ['call','put'].includes(q.type), 'Invalid contract fields');
  }); return s;
}
const median = xs => { const a=[...xs].sort((a,b)=>a-b); return a.length % 2 ? a[(a.length-1)/2] : (a[a.length/2-1]+a[a.length/2])/2; };
// Weighted isotonic regression on total variance; every adjustment is retained.
export function isotonic(points) {
  const blocks=[];
  points.forEach((p,i)=>{ blocks.push({start:i,end:i,weight:p.weight,total:p.w*p.weight});
    while(blocks.length>1 && blocks.at(-2).total/blocks.at(-2).weight > blocks.at(-1).total/blocks.at(-1).weight){
      const b=blocks.pop(), a=blocks.pop();blocks.push({start:a.start,end:b.end,weight:a.weight+b.weight,total:a.total+b.total});
    }
  });
  const fitted=points.map(p=>({...p})); for(const b of blocks) for(let i=b.start;i<=b.end;i++) fitted[i].w=b.total/b.weight; return fitted;
}
export function varianceAt(nodes, T) {
  require(T >= 0 && T <= nodes.at(-1).T + 1e-10, 'Insufficient maturity coverage: extrapolation beyond the fitted expiries is disabled.');
  if (T === 0) return 0; let a={T:0,w:0};
  for(const b of nodes) { if(T <= b.T) return a.w+(b.w-a.w)*(T-a.T)/(b.T-a.T); a=b; } return nodes.at(-1).w;
}
export function calibrate(snapshot, targetId, rates, dividend = 0, filters = {}) {
  validateSnapshot(snapshot); validateRateCurve(rates);
  require(Number.isFinite(dividend) && dividend >= -.1 && dividend <= .3, 'Dividend yield must be between −10% and 30%');
  const target=snapshot.quotes.find(q=>q.id===targetId); require(target,'Select an available contract');
  const T=timeTo(target.expiry,snapshot.asOf); require(T>0,'This contract has expired');
  const settings={maxSpread:.20,minOI:100,minVolume:1,maxAgeSeconds:120,maxLogMoneyness:.08,minStrikes:3,...filters};
  const audit=[], byExpiry=new Map();
  for(const q of snapshot.quotes){
    const a={...q,status:'rejected',reason:''};audit.push(a);
    if(q.expiry===target.expiry && q.strike===target.strike){a.status='held-out';a.reason='Selected strike and expiry: both call and put excluded';continue;}
    const t=timeTo(q.expiry,snapshot.asOf); if(t<=0){a.reason='Expired';continue;}
    if(![q.bid,q.ask].every(Number.isFinite)||q.bid<=0||q.ask<q.bid){a.reason='Missing, zero or crossed bid/ask';continue;}
    a.mid=(q.bid+q.ask)/2; a.relativeSpread=(q.ask-q.bid)/a.mid;
    if(a.relativeSpread>settings.maxSpread){a.reason='Bid/ask spread too wide';continue;}
    if(!(q.oi>=settings.minOI)||!(q.volume>=settings.minVolume)){a.reason='Insufficient open interest or trading volume';continue;}
    if(!(q.bidQty>0)||!(q.askQty>0)){a.reason='Missing displayed bid/ask quantity';continue;}
    const age=(Date.parse(snapshot.asOf)-Date.parse(q.quoteTime))/1000;
    if(!Number.isFinite(age)||age>settings.maxAgeSeconds||age < -5){a.reason='Missing or stale quote timestamp';continue;}
    let R;try{R=rateIntegral(rates,t);}catch{a.reason='Rate curve does not cover expiry';continue;}
    const F=snapshot.spot*Math.exp(R-dividend*t); a.logMoneyness=Math.log(q.strike/F);
    if(Math.abs(a.logMoneyness)>settings.maxLogMoneyness){a.reason='Outside the near-forward calibration band';continue;}
    if(q.type!==(q.strike>=F?'call':'put')){a.reason='Use OTM side only at this strike';continue;}
    try{a.iv=impliedVol(a.mid,snapshot.spot,q.strike,R,dividend*t,t,q.type);}catch(e){a.reason=e.message;continue;}
    a.status='candidate';a.reason='';a.T=t;
    if(!byExpiry.has(q.expiry))byExpiry.set(q.expiry,[]);byExpiry.get(q.expiry).push(a);
  }
  const raw=[];
  for(const [expiry,quotes] of byExpiry){
    const m=median(quotes.map(q=>q.iv)), mad=median(quotes.map(q=>Math.abs(q.iv-m)));
    let accepted=quotes.filter(q=>{if(Math.abs(q.iv-m)>Math.max(.05,4*mad)){q.status='rejected';q.reason='IV outlier within expiry';return false;}return true;});
    const unique=new Map(); for(const q of accepted){const old=unique.get(q.strike);if(!old||q.relativeSpread<old.relativeSpread)unique.set(q.strike,q);}
    for(const q of accepted)if(unique.get(q.strike)!==q){q.status='rejected';q.reason='Duplicate strike';}
    accepted=[...unique.values()];
    if(accepted.length<settings.minStrikes){accepted.forEach(q=>{q.status='rejected';q.reason='Fewer than three usable strikes at this expiry';});continue;}
    let sum=0,weight=0;
    for(const q of accepted){const w=1/(.02+Math.abs(q.logMoneyness))/(.02+q.relativeSpread);sum+=w*q.iv*q.iv*q.T;weight+=w;q.status='used';q.reason='Used in maturity estimate';}
    const t=accepted[0].T,w=sum/weight;
    raw.push({expiry,T:t,w,rawW:w,rawVol:Math.sqrt(w/t),weight:accepted.length,count:accepted.length,minStrike:Math.min(...accepted.map(q=>q.strike)),maxStrike:Math.max(...accepted.map(q=>q.strike))});
  }
  raw.sort((a,b)=>a.T-b.T); require(raw.length>=2,'Insufficient liquid data: at least two expiries with three usable strikes each are required.');
  const nodes=isotonic(raw),variance=varianceAt(nodes,T),R=rateIntegral(rates,T);
  const price=optionPrice(snapshot.spot,target.strike,R,dividend*T,variance,target.type),warnings=[];
  if(T<nodes[0].T-1e-10)warnings.push('Expiry precedes the first fitted node: constant forward variance is assumed from today to that node.');
  if(nodes.some(p=>Math.abs(p.w-p.rawW)>1e-10))warnings.push('Total variance decreased across observed expiries. Isotonic smoothing adjusted the curve; inspect raw and fitted nodes.');
  if(Math.abs(Math.log(target.strike/(snapshot.spot*Math.exp(R-dividend*T))))>.05)warnings.push('This strike is away from the forward price. A maturity-only curve does not capture the volatility smile.');
  if(snapshot.quotes.some(q=>q.timestampBasis==='receipt'))warnings.push('REST times are retrieval times. The chain response does not include bid/ask timestamps; exchange-level quote freshness cannot be independently verified.');
  const rateAge=(Date.parse(snapshot.asOf)-Date.parse(rates.asOf))/DAY;
  if(rateAge>4)warnings.push(`Rate curve is ${Math.floor(rateAge)} calendar days old.`);
  if(rateAge < -1)warnings.push('Rate curve postdates the quote snapshot. This run is a scenario, not a historical backtest.');
  if(rates.conventionUnverified)warnings.push('CCIL quote compounding is unconfirmed by the source page. The selected conversion is an explicit research assumption.');
  warnings.push('Dividend yield is an assumption; cash dividends and corporate actions are not automatically incorporated.');
  const targetAge=(Date.parse(snapshot.asOf)-Date.parse(target.quoteTime))/1000;
  const marketValid=[target.bid,target.ask].every(Number.isFinite)&&target.bid>0&&target.ask>=target.bid&&Number.isFinite(targetAge)&&targetAge>=-5&&targetAge<=settings.maxAgeSeconds;
  if(!marketValid)warnings.push('The selected contract has no valid, sufficiently recent two-sided quote. The midpoint comparison is unavailable.');
  return {snapshot,target,rates,dividend,T,nodes,audit,settings,variance,R,price,effectiveVol:Math.sqrt(variance/T),effectiveRate:R/T,forward:snapshot.spot*Math.exp(R-dividend*T),marketMid:marketValid?(target.bid+target.ask)/2:null,warnings};
}
export function normalGenerator(seed) {
  let state=seed>>>0,spare=null;
  const uniform=()=>{state=(state+0x6D2B79F5)>>>0;let t=state;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};
  return()=>{if(spare!==null){const z=spare;spare=null;return z;}const r=Math.sqrt(-2*Math.log(1-uniform())),a=2*Math.PI*uniform();spare=r*Math.sin(a);return r*Math.cos(a);};
}
export const milsteinStep=(s,r,q,v,dt,dw)=>s*(1+(r-q)*dt+v*dw+.5*v*v*(dw*dw-dt));
export function statistics(){let n=0,mean=0,m2=0;return{add(x){n++;const d=x-mean;mean+=d/n;m2+=d*(x-mean);},get(){const se=n>1?Math.sqrt(Math.max(0,m2)/(n-1)/n):0;return{n,mean,se,low:mean-1.96*se,high:mean+1.96*se};}};}
export function simulate(fit,{paths=10000,stepDays=1,seed=42}={},progress=()=>{}) {
  require(Number.isInteger(paths)&&paths>=1000&&paths<=100000&&paths%2===0,'Use an even path count between 1,000 and 100,000');
  require(Number.isFinite(stepDays)&&stepDays>=.05&&stepDays<=7,'Step size must be between 0.05 and 7 calendar days');
  require(Number.isInteger(seed)&&seed>=0&&seed<=4294967295,'Seed must be a 32-bit unsigned integer');
  const {T,nodes,rates,dividend,snapshot,target}=fit;
  const grid=[0,T,...nodes.filter(n=>n.T<T).map(n=>n.T)];
  if(rates.points)grid.push(...rates.points.map(p=>p.days/365).filter(t=>t<T));
  for(let t=stepDays/365;t<T;t+=stepDays/365)grid.push(t);
  grid.sort((a,b)=>a-b);const times=grid.filter((x,i)=>!i||x-grid[i-1]>1e-12);
  require(paths*(times.length-1)*2<=25000000,'Reduce paths or increase step size (25 million fine-grid update limit)');
  const coefficients=times.slice(1).map((b,i)=>{const a=times[i],mid=(a+b)/2,dt=b-a;return{dt,v:Math.sqrt(Math.max(0,(varianceAt(nodes,b)-varianceAt(nodes,a))/dt)),r:(rateIntegral(rates,b)-rateIntegral(rates,a))/dt,r1:(rateIntegral(rates,mid)-rateIntegral(rates,a))/(dt/2),r2:(rateIntegral(rates,b)-rateIntegral(rates,mid))/(dt/2)};});
  const rng=normalGenerator(seed),coarse=statistics(),fine=statistics(),diff=statistics(),discount=Math.exp(-fit.R),lines=[],start=performance.now();
  const payoff=s=>Math.max(target.type==='call'?s-target.strike:target.strike-s,0)*discount;
  for(let p=0;p<paths/2;p++){
    let c1=snapshot.spot,c2=c1,f1=c1,f2=c1;const line=p<12?[c1]:null;
    for(const c of coefficients){const h=c.dt/2,w1=rng()*Math.sqrt(h),w2=rng()*Math.sqrt(h);
      c1=milsteinStep(c1,c.r,dividend,c.v,c.dt,w1+w2);c2=milsteinStep(c2,c.r,dividend,c.v,c.dt,-w1-w2);
      f1=milsteinStep(milsteinStep(f1,c.r1,dividend,c.v,h,w1),c.r2,dividend,c.v,h,w2);
      f2=milsteinStep(milsteinStep(f2,c.r1,dividend,c.v,h,-w1),c.r2,dividend,c.v,h,-w2);
      require([c1,c2,f1,f2].every(s=>Number.isFinite(s)&&s>0),'Non-positive simulated price. Reduce time step; paths are not clipped.');if(line)line.push(c1);
    }
    const a=(payoff(c1)+payoff(c2))/2,b=(payoff(f1)+payoff(f2))/2;coarse.add(a);fine.add(b);diff.add(b-a);if(line)lines.push(line);if(p%250===0)progress(2*p/paths);
  }
  const result={coarse:coarse.get(),fine:fine.get(),difference:diff.get(),lines,times,paths,steps:coefficients.length,seed,stepDays,runtimeMs:performance.now()-start,warnings:[]};
  if(Math.abs(result.difference.mean)>Math.max(1e-8,1.96*result.difference.se))result.warnings.push('A time-step effect is detectable; try a smaller step.');
  if(Math.abs(result.coarse.mean-fit.price)>Math.max(1e-8,1.96*result.coarse.se))result.warnings.push('Analytical price is outside the sampling interval; sampling variation or discretisation may explain the difference.');
  if(result.coarse.mean===0&&fit.price>1e-8)result.warnings.push('No simulated payoff was positive. Zero sample error does not establish a zero option value.');
  progress(1);return result;
}
