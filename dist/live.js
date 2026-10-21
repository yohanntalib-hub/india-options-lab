export function normaliseChain(rows, expiry, receivedAt) {
  const quotes=[];
  for(const row of rows)for(const [name,type] of [['call_options','call'],['put_options','put']]){
    const c=row[name];if(!c?.instrument_key)continue;const m=c.market_data||{};
    quotes.push({id:c.instrument_key,expiry:row.expiry||expiry,strike:Number(row.strike_price),type,bid:Number(m.bid_price),ask:Number(m.ask_price),bidQty:Number(m.bid_qty),askQty:Number(m.ask_qty),ltp:Number(m.ltp),oi:Number(m.oi),volume:Number(m.volume),quoteTime:receivedAt,timestampBasis:'receipt',providerIV:c.option_greeks?.iv});
  }return quotes;
}
export function feedType(schema, protobuf=globalThis.protobuf){
  const clean=schema.replace('import "google/protobuf/wrappers.proto";','message DoubleValue { double value = 1; }').replaceAll('google.protobuf.DoubleValue','DoubleValue');
  return protobuf.parse(clean).root.lookupType('com.upstox.marketdatafeederv3udapi.rpc.proto.FeedResponse');
}
export class Upstox {
  constructor(token){this.token=token;this.ws=null;this.closed=false;this.streamGeneration=0;}
  async get(path,params={}){
    if(this.closed)throw Error('Connection closed');
    const u=new URL(`https://api.upstox.com/${path}`);for(const [k,v]of Object.entries(params))u.searchParams.set(k,v);
    const r=await fetch(u,{headers:{Authorization:`Bearer ${this.token}`,Accept:'application/json'},signal:AbortSignal.timeout(20000)});
    if(!r.ok)throw Error(r.status===401?'Upstox rejected the token. Check its validity.':r.status===429?'Upstox rate limit reached. Wait before refreshing.':`Upstox request failed (${r.status}).`);
    return (await r.json()).data;
  }
  async catalogue(exchange='NSE'){
    const r=await fetch(`https://assets.upstox.com/market-quote/instruments/exchange/${exchange}.json.gz`,{signal:AbortSignal.timeout(45000)});
    if(!r.ok)throw Error('Instrument list is unavailable');
    const raw=new Uint8Array(await r.arrayBuffer());
    const text=raw[0]===31&&raw[1]===139?await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('gzip'))).text():new TextDecoder().decode(raw);
    const all=JSON.parse(text),map=new Map();
    for(const c of all)if(['CE','PE'].includes(c.instrument_type)&&c.underlying_type==='EQUITY'&&c.expiry>Date.now()){
      if(!map.has(c.underlying_key))map.set(c.underlying_key,{symbol:c.underlying_symbol,name:c.name,key:c.underlying_key,exchange,expiries:new Set()});
      // BOD timestamp is converted to its IST calendar date; valuation uses 15:30 IST.
      map.get(c.underlying_key).expiries.add(new Date(c.expiry+19800000).toISOString().slice(0,10));
    }
    return [...map.values()].map(x=>({...x,expiries:[...x.expiries].sort()})).sort((a,b)=>a.symbol.localeCompare(b.symbol));
  }
  async snapshot(instrument){
    const contracts=await this.get('v2/option/contract',{instrument_key:instrument.key});
    const expiries=[...new Set(contracts.map(c=>c.expiry))].filter(d=>Date.parse(`${d}T15:30:00+05:30`)>Date.now()).sort().slice(0,6);
    if(!expiries.length)throw Error('No unexpired options found for this equity');
    const quoteList=[];let spot=null;
    for(const expiry of expiries){
      const rows=await this.get('v2/option/chain',{instrument_key:instrument.key,expiry_date:expiry});
      const at=new Date().toISOString();quoteList.push(...normaliseChain(rows,expiry,at));
      if(rows[0]?.underlying_spot_price>0)spot=Number(rows[0].underlying_spot_price);
    }
    if(!(spot>0))throw Error('Provider did not return a valid underlying spot');
    const contractMap=new Map(contracts.map(c=>[c.instrument_key,c]));
    for(const q of quoteList)q.lotSize=contractMap.get(q.id)?.lot_size||1;
    return{symbol:instrument.symbol,exchange:instrument.exchange,underlyingKey:instrument.key,spot,asOf:new Date().toISOString(),source:'Upstox live connection',synthetic:false,quotes:quoteList};
  }
  async stream(keys,onData,onStatus){
    this.stopStream();
    const generation=this.streamGeneration;
    const data=await this.get('v3/feed/market-data-feed/authorize');
    const u=new URL(data.authorized_redirect_uri);
    if(u.protocol!=='wss:'||!u.hostname.endsWith('.upstox.com'))throw Error('Unexpected WebSocket host');
    const schema=await fetch('./vendor/MarketDataFeed.proto').then(r=>r.text());const type=feedType(schema);
    if(this.closed||generation!==this.streamGeneration)return;
    const socket=new WebSocket(u.href);this.ws=socket;socket.binaryType='arraybuffer';
    socket.onopen=()=>{socket.send(new TextEncoder().encode(JSON.stringify({guid:crypto.randomUUID(),method:'sub',data:{mode:'full',instrumentKeys:[...new Set(keys)].slice(0,1000)}})));onStatus('Streaming connected');};
    socket.onmessage=event=>{try{const msg=type.toObject(type.decode(new Uint8Array(event.data)),{longs:Number,enums:String});onData(msg);}catch{onStatus('Feed decoding failed; refresh the snapshot.');}};
    socket.onerror=()=>onStatus('Stream unavailable; reconnect or refresh the snapshot.');
    socket.onclose=()=>{if(this.ws===socket)onStatus('Stream disconnected; reconnect to resume.');};
  }
  stopStream(){this.streamGeneration++;if(this.ws){this.ws.onclose=null;this.ws.close();this.ws=null;}}
  close(){this.stopStream();this.closed=true;this.token='';}
}
export function applyFeed(snapshot,message){
  const index=new Map(snapshot.quotes.map(q=>[q.id,q]));let changed=false;
  for(const [id,feed]of Object.entries(message.feeds||{})){
    const full=feed.fullFeed?.marketFF||feed.fullFeed?.indexFF||feed.firstLevelWithGreeks;
    const ltpc=feed.ltpc||full?.ltpc;
    if(id===snapshot.underlyingKey&&ltpc?.ltp>0){snapshot.spot=ltpc.ltp;changed=true;}
    const q=index.get(id);if(!q)continue;
    if(ltpc){q.ltp=ltpc.ltp;q.lastTradeTime=ltpc.ltt?new Date(ltpc.ltt).toISOString():null;changed=true;}
    const book=full?.marketLevel?.bidAskQuote?.[0]||full?.firstDepth;
    if(book){q.bid=book.bidP??0;q.ask=book.askP??0;q.bidQty=book.bidQ??0;q.askQty=book.askQ??0;q.quoteTime=new Date(message.currentTs||Date.now()).toISOString();q.timestampBasis='feed';changed=true;}
    if(Number.isFinite(full?.oi))q.oi=full.oi;if(Number.isFinite(full?.vtt))q.volume=full.vtt;
  }
  if(changed)snapshot.asOf=new Date(message.currentTs||Date.now()).toISOString();return changed;
}
