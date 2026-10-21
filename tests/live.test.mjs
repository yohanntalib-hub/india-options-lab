import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
import {normaliseChain,feedType,applyFeed,Upstox} from '../dist/live.js';
test('REST chains retain midpoint inputs and disclose timestamp provenance',()=>{
 const q=normaliseChain([{strike_price:100,expiry:'2026-11-24',call_options:{instrument_key:'NSE_FO|1',market_data:{bid_price:4,ask_price:5,bid_qty:20,ask_qty:30,oi:1000,volume:10,ltp:4.7},option_greeks:{iv:20}}}],'2026-11-24','2026-10-16T05:00:00Z')[0];
 assert.equal(q.bid,4);assert.equal(q.ask,5);assert.equal(q.timestampBasis,'receipt');assert.equal(q.providerIV,20);assert.equal(q.type,'call');
});
test('Official protobuf schema encodes and decodes a market book fixture',()=>{
 const context={console,TextDecoder,TextEncoder,Uint8Array,ArrayBuffer,Float32Array,Float64Array,Int32Array,Uint32Array};context.self=context;vm.createContext(context);vm.runInContext(fs.readFileSync(new URL('../dist/vendor/protobuf.min.js',import.meta.url),'utf8'),context);
 const type=feedType(fs.readFileSync(new URL('../dist/vendor/MarketDataFeed.proto',import.meta.url),'utf8'),context.protobuf);
 const data={currentTs:1792126800000,feeds:{'NSE_FO|1':{fullFeed:{marketFF:{ltpc:{ltp:4.8,ltt:1792126800000},marketLevel:{bidAskQuote:[{bidP:4.6,askP:5,bidQ:50,askQ:60}]},oi:9000,vtt:200}}}}};
 const decoded=type.toObject(type.decode(type.encode(type.fromObject(data)).finish()),{longs:Number});const s={underlyingKey:'NSE_EQ|1',quotes:[{id:'NSE_FO|1'}]};
 assert.equal(applyFeed(s,decoded),true);assert.equal(s.quotes[0].bid,4.6);assert.equal(s.quotes[0].ask,5);assert.equal(s.quotes[0].oi,9000);assert.equal(s.quotes[0].volume,200);assert.equal(s.quotes[0].timestampBasis,'feed');assert.equal(s.asOf,new Date(data.currentTs).toISOString());
});
test('Last trade updates do not pretend to refresh the order book',()=>{const s={quotes:[{id:'x',quoteTime:'old',bid:1,ask:2}]};applyFeed(s,{currentTs:1792126800000,feeds:{x:{ltpc:{ltp:1.5}}}});assert.equal(s.quotes[0].quoteTime,'old');assert.equal(s.quotes[0].bid,1);});
test('Disconnect clears the in-memory token',()=>{const c=new Upstox('fixture-token');c.close();assert.equal(c.token,'');assert.equal(c.closed,true);});
