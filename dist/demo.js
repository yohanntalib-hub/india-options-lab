import { optionPrice,rateIntegral,timeTo } from './pricing.js';
export const DEMOS=[{symbol:'RELIANCE',exchange:'NSE',spot:1400,increment:25,vol:.24},{symbol:'TCS',exchange:'NSE',spot:3000,increment:50,vol:.21},{symbol:'HDFCBANK',exchange:'BSE',spot:950,increment:20,vol:.23}];
export function makeDemo(index=0,rates){
  const p=DEMOS[index],asOf='2026-10-16T10:00:00+05:30',dividend=.01,quotes=[];
  ['2026-10-27','2026-11-24','2026-12-29'].forEach((expiry,j)=>{
    const T=timeTo(expiry,asOf),R=rateIntegral(rates,T),F=p.spot*Math.exp(R-dividend*T);
    for(let n=-5;n<=5;n++)for(const type of ['call','put']){
      const strike=p.spot+n*p.increment,k=Math.log(strike/F),vol=p.vol+j*.012-.12*k+.8*k*k;
      let mid=optionPrice(p.spot,strike,R,dividend*T,vol*vol*T,type);
      if(n===0&&j===0)mid*=1.035;
      const half=Math.max(.05,mid*.018);
      quotes.push({id:`SYNTHETIC-${p.symbol}-${expiry}-${strike}-${type}`,expiry,strike,type,bid:Math.max(.01,mid-half),ask:mid+half,ltp:mid*1.004,bidQty:500,askQty:500,oi:5000,volume:800,lotSize:1,quoteTime:asOf,timestampBasis:'synthetic'});
    }
  });
  quotes[0].bid=0;quotes[1].ask*=2;
  return {...p,asOf,source:'Synthetic demonstration — not market quotes',synthetic:true,dividend,quotes};
}
