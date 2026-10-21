const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {runPlugin}=require('../sdk/mock.cjs');
const code=fs.readFileSync(path.join(__dirname,'../dist/index.js'),'utf8');
const files=[{ref:'movie',name:'Film.2024.mkv',path:'movies/Film.2024.mkv'},{ref:'tv',name:'A.Prophet.2026.S01E03.2160p.TX.WEB-DL.DDP5.1.HFR.H.265-FGTWeb.mkv',path:'shows/A.Prophet.2026.S01E03.mkv'}];
const identity=f=>({fileRef:f.ref,title:f.ref==='movie'?'Film':'模型识别的剧名',year:2024,mediaType:f.ref==='movie'?'movie':'tv',season:f.ref==='tv'?2:null,episode:f.ref==='tv'?3:null,multiEpisode:false,reason:'模拟识别结论',tmdbId:f.ref==='movie'?101:202});
const answer=items=>({message:{role:'assistant',content:JSON.stringify({items})},usage:{}});
const tool=(name,args,id='call')=>({message:{role:'assistant',toolCalls:[{id,name,arguments:JSON.stringify(args)}]},usage:{}});
function run(options={}) {
 const drafts=[],chosen=options.files||files;let round=0;
 const result=runPlugin(code,{action:'recognize',files:chosen,input:{profileId:1,instructions:'用户说明'},config:options.config||{},sdkVersion:'1'},{
  'ai.capabilities':()=>typeof options.capabilities==='function'?options.capabilities():options.capabilities||{chat:{available:true,reason:'available'},webSearch:{available:true,reason:'available'},tmdb:{available:true,reason:'available'}},
  'ai.chat':v=>options.chat?options.chat(v,round++):answer((options.items||chosen.map(identity)).slice().reverse()),
  'tmdb.search':options.search||(()=>[]),'tmdb.detail':options.detail||(v=>({id:v.id,mediaType:v.mediaType,title:'TMDB 条目'})),
  'ai.web.search':options.web||(()=>({items:[{title:'公开来源',summary:'公开摘要',url:'https://example.com/show'}],usage:{}})),
  'organize.prepare':p=>{drafts.push(p);return {status:p.tmdbId?'ready':'needs_review'};}
 });return {...result,drafts};
}
test('direct AI answer needs no lookup, keeps mixed file pairing and never submits',()=>{
 const {drafts,calls}=run();assert.deepEqual(drafts.map(d=>[d.fileRef,d.tmdbId,d.season,d.episode]),[['movie',101,undefined,undefined],['tv',202,2,3]]);
 assert.deepEqual(calls.filter(c=>c.name!=='ai.capabilities').map(c=>c.name),['ai.chat','organize.prepare','organize.prepare']);
 const input=JSON.parse(calls.find(c=>c.name==='ai.chat').input.messages[1].content);assert.equal(input.files[1].name,files[1].name);assert.deepEqual(Object.keys(input.files[0]).sort(),['fileRef','name','path']);assert.equal(input.instructions,'用户说明');
});
test('AI can search web then TMDB and choose query words without rewriting',()=>{
 const {calls,drafts}=run({chat:(v,i)=>i===0?tool('web_search',{query:'AI 自己的搜索词 2026'}):i===1?tool('tmdb_search',{query:'AI 找到的中文名',mediaType:'tv'},'tmdb'):answer(files.map(f=>({...identity(f),sources:['https://example.com/show','javascript:alert(1)']})))});
 assert.deepEqual(calls.filter(c=>!['organize.prepare','ai.capabilities'].includes(c.name)).map(c=>c.name),['ai.chat','ai.web.search','ai.chat','tmdb.search','ai.chat']);
 assert.equal(calls.find(c=>c.name==='ai.web.search').input.query,'AI 自己的搜索词 2026');assert.equal(drafts[1].recognition.sources,'https://example.com/show');
 const messages=calls.filter(c=>c.name==='ai.chat')[2].input.messages;assert.equal(messages[2].toolCalls[0].name,'web_search');assert.equal(messages[3].toolCallId,'call');
});
test('AI can query TMDB first, change search words, or request details',()=>{
 const {calls}=run({chat:(_,i)=>i===0?tool('tmdb_search',{query:'first',mediaType:'multi'}):i===1?tool('tmdb_search',{query:'second',mediaType:'tv',year:2026},'second'):i===2?tool('tmdb_detail',{id:202,mediaType:'tv'},'detail'):answer(files.map(identity))});
 assert.deepEqual(calls.filter(c=>c.name==='tmdb.search').map(c=>c.input.query),['first','second']);assert.equal(calls.some(c=>c.name==='ai.web.search'),false);assert.equal(calls.some(c=>c.name==='tmdb.detail'),true);
});
test('missing, duplicate and foreign references cannot replace another file',()=>{
 for(const items of [[identity(files[0])],[identity(files[0]),identity(files[0]),{...identity(files[1]),fileRef:'foreign'}]]){const {drafts}=run({items});assert.equal(drafts[1].tmdbId,0);assert.equal(drafts[1].recognition,undefined);if(items.length>1)assert.equal(drafts[0].tmdbId,0);}
});
test('unknown and unlinked identities retain independent output',()=>{
 const {drafts}=run({items:[{...identity(files[0]),title:'',tmdbId:999,reason:'不认识此作品'},{...identity(files[1]),tmdbId:null}]});
 assert.equal(drafts[0].tmdbId,0);assert.match(drafts[0].reason,/不认识/);assert.equal(drafts[1].recognition.title,'模型识别的剧名');assert.equal(drafts[1].season,2);assert.match(drafts[1].reason,/已识别，待匹配/);
});
test('missing season defaults one, explicit seasons survive, invalid values do not coerce',()=>{
 for(const season of [null,undefined,0,3,-1,'2',10000]){const {drafts}=run({items:[identity(files[0]),{...identity(files[1]),season,episode:null}]});assert.equal(drafts[1].season,season==null?1:season===0||season===3?season:undefined);assert.equal(drafts[1].episode,undefined);assert.equal(drafts[0].season,undefined);}
});
test('AI multi-episode decision is retained without truncating a collection',()=>{
 const {drafts}=run({items:[identity(files[0]),{...identity(files[1]),multiEpisode:true}]});assert.equal(drafts[1].unsupported,true);assert.equal(drafts[1].tmdbId,0);assert.match(drafts[1].reason,/多集合集/);
});
test('tool refusal degrades within six rounds and does not pretend to search',()=>{
 const {calls,drafts}=run({chat:(v,i)=>{if(i===0)return {message:{role:'assistant'},toolsUnavailable:true,usage:{}};assert.equal(v.tools,undefined);return answer(files.map(identity));}});
 assert.equal(calls.filter(c=>c.name==='ai.chat').length,2);assert.equal(calls.some(c=>c.name==='ai.web.search'),false);assert.match(drafts[1].reason,/查询工具不可用/);
});
test('tool failures return to AI without losing direct identification or leaking errors',()=>{
 const marker='FF_CACHE_SECRET_MARKER';const {drafts,calls}=run({web:()=>{throw Error(marker)},chat:(v,i)=>{if(i===0)return tool('web_search',{query:'q'});assert.equal(JSON.stringify(v).includes(marker),false);return answer(files.map(identity));}});
 assert.equal(drafts[1].recognition.title,'模型识别的剧名');assert.equal(JSON.stringify({drafts,calls}).includes(marker),false);
});
test('malicious and unknown tools never dispatch SDK operations',()=>{
 for(const [name,args] of [['organize.submit',{confirmed:true}],['http.request',{url:'http://localhost/ff'}],['tmdb_search',JSON.parse('{"query":"x","mediaType":"tv","__proto__":{"p":true}}')],['tmdb_detail',{id:1,mediaType:'tv',url:'http://localhost'}]]){
  const {calls}=run({chat:(_,i)=>i===0?tool(name,args):answer(files.map(identity))});assert.equal(calls.some(c=>['http.request','organize.submit','tmdb.search','tmdb.detail'].includes(c.name)),false);
 }
});
test('six round limit preserves provisional results and stops further tool work',()=>{
 const {calls,drafts}=run({chat:(_,i)=>({...tool('tmdb_search',{query:'q'+i,mediaType:'tv'},String(i)),message:{...tool('tmdb_search',{query:'q'+i,mediaType:'tv'},String(i)).message,content:JSON.stringify({items:[identity(files[0])]})}})});
 assert.equal(calls.filter(c=>c.name==='ai.chat').length,6);assert.equal(calls.filter(c=>c.name==='tmdb.search').length,5);assert.equal(drafts[0].recognition.title,'Film');assert.equal(drafts[1].tmdbId,0);assert.match(drafts[1].reason,/6 轮上限/);
});
test('100 files are batched at eight with stable refs and no automatic replay',()=>{
 const chosen=Array.from({length:100},(_,i)=>({...files[i%2],ref:String(i)}));
 const {drafts,calls}=run({files:chosen,chat:v=>answer(JSON.parse(v.messages[1].content).files.map(f=>({...identity(f),mediaType:'movie'})))});
 assert.equal(calls.filter(c=>c.name==='ai.chat').length,13);assert.equal(drafts.length,100);assert.equal(new Set(drafts.map(d=>d.fileRef)).size,100);
});
test('full prompt replaces defaults; retired prompts are not appended',()=>{
 const {calls}=run({config:{prompt:'自定义任务',extractionPrompt:'旧提取策略',selectionPrompt:'旧选择策略'}});assert.equal(calls.find(c=>c.name==='ai.chat').input.messages[0].content,'自定义任务');
});
test('timeout and malformed answers still produce editable rows without exposing exceptions',()=>{
 const failed=run({chat:()=>{throw Error('secret')}});assert.equal(failed.drafts.length,2);assert.ok(failed.drafts.every(d=>d.tmdbId===0));assert.equal(JSON.stringify(failed).includes('secret'),false);
 const malformed=run({chat:()=>({message:{role:'assistant',content:'这是某部剧，但无法给出 JSON'},usage:{}})});assert.match(malformed.drafts[0].reason,/这是某部剧/);assert.equal(malformed.drafts[0].tmdbId,0);
});


test('only currently available tools are declared, without a probe request',()=>{
 const capabilities={chat:{available:true,reason:'available'},webSearch:{available:false,reason:'disabled'},tmdb:{available:true,reason:'available'}};
 const {calls}=run({capabilities,chat:v=>{assert.deepEqual(v.tools.map(t=>t.name),['tmdb_search','tmdb_detail']);return answer(files.map(identity));}});
 assert.equal(calls.filter(c=>c.name==='ai.chat').length,1);assert.equal(calls.some(c=>c.name==='ai.web.search'),false);
 const none=run({capabilities:{...capabilities,tmdb:{available:false,reason:'not_granted'}},chat:v=>{assert.equal(v.tools,undefined);return answer(files.map(identity));}});
 assert.equal(none.calls.filter(c=>c.name==='ai.chat').length,1);
});

test('multiple tools in one response are returned together before the next dialogue',()=>{
 const {calls}=run({chat:(v,i)=>{
  if(i===0)return {message:{role:'assistant',toolCalls:[{id:'a',name:'tmdb_search',arguments:JSON.stringify({query:'q',mediaType:'tv'})},{id:'b',name:'tmdb_detail',arguments:JSON.stringify({id:202,mediaType:'tv'})}]},usage:{}};
  assert.equal(v.messages.filter(m=>m.role==='tool').length,2);return answer(files.map(identity));
 }});
 assert.equal(calls.filter(c=>c.name==='ai.chat').length,2);
 assert.deepEqual(calls.filter(c=>['ai.chat','tmdb.search','tmdb.detail'].includes(c.name)).map(c=>c.name),['ai.chat','tmdb.search','tmdb.detail','ai.chat']);
});

test('identical successive queries stop early and keep provisional identification',()=>{
 const {calls,drafts}=run({chat:(_,i)=>{const response=tool('tmdb_search',{query:'same AI query',mediaType:'tv'},String(i));response.message.content=JSON.stringify({items:[identity(files[0])]});return response;}});
 assert.equal(calls.filter(c=>c.name==='ai.chat').length,2);assert.equal(calls.filter(c=>c.name==='tmdb.search').length,1);
 assert.equal(drafts[0].recognition.title,'Film');assert.equal(drafts[1].tmdbId,0);assert.match(drafts[1].reason,/连续重复/);
});

test('tool rejection is not reprobed in later batches and file refs accompany each dialogue',()=>{
 const chosen=Array.from({length:9},(_,i)=>({...files[0],ref:String(i)}));
 const {calls}=run({files:chosen,chat:(v,i)=>{
  if(i===0)return {message:{role:'assistant'},toolsUnavailable:true,usage:{}};
  assert.equal(v.tools,undefined);const batch=JSON.parse(v.messages[1].content).files;assert.deepEqual(v.fileRefs,batch.map(f=>f.fileRef));return answer(batch.map(f=>identity({ref:f.fileRef})));
 }});
 assert.equal(calls.filter(c=>c.name==='ai.chat').length,3);
});


test('a search that becomes known unsupported is removed from later tool declarations',()=>{
 let enabled=true;
 const {calls}=run({capabilities:()=>({chat:{available:true,reason:'available'},tmdb:{available:true,reason:'available'},webSearch:{available:enabled,reason:enabled?'available':'unavailable'}}),web:()=>{enabled=false;throw Error('not supported')},chat:(v,i)=>{
  if(i===0)return tool('web_search',{query:'AI query'});
  assert.equal(v.tools.some(t=>t.name==='web_search'),false);return answer(files.map(identity));
 }});
 assert.equal(calls.filter(c=>c.name==='ai.chat').length,2);assert.equal(calls.filter(c=>c.name==='ai.web.search').length,1);
});
