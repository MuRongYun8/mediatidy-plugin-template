const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { runPlugin } = require('../sdk/mock.cjs');
const code = fs.readFileSync(path.join(__dirname,'../dist/index.js'),'utf8');
const files = [ {ref:'movie',name:'Film.2024.mkv',path:'movies/Film.2024.mkv'}, {ref:'tv',name:'Show.S02E03.mkv',path:'shows/Show.S02E03.mkv'} ];
const hint = f => ({fileRef:f.ref,name:f.ref,year:2024,mediaType:f.ref==='movie'?'movie':'tv',season:f.ref==='tv'?2:null,episode:f.ref==='tv'?3:null,multiEpisode:false});
function run(options = {}) {
  let round = 0; const drafts = []; const chosenFiles = options.files || files;
  const {calls,result} = runPlugin(code, { action:'recognize', files:chosenFiles, input:{profileId:1,instructions:'test'},config:{},sdkVersion:'1' }, {
    'ai.complete': () => { round++; return { content: {items:round===1 ? (options.hints || chosenFiles.map(hint)).slice().reverse() : (options.choices || chosenFiles.map(f=>({fileRef:f.ref,tmdbId:f.ref==='movie'?1010101:2020202,mediaType:f.ref==='movie'?'movie':'tv',uncertain:false,reason:'候选一致'}))).slice().reverse()},usage:{} }; },
    'tmdb.search': options.search || (({mediaType}) => [{id:mediaType==='movie'?1010101:2020202,title:'title',mediaType,year:'2024'}]),
    'organize.prepare': p => { drafts.push(p); return {status:'ready'}; },
  }); return {drafts,calls,result};
}
test('mixed files stay paired despite model output order; never submit', () => {
  const {drafts,calls}=run(); assert.deepEqual(drafts.map(d=>[d.fileRef,d.tmdbId,d.season,d.episode]), [['movie',1010101,undefined,undefined],['tv',2020202,2,3]]); assert.equal(calls.some(c=>c.name==='organize.submit'),false);
  const outbound = calls.filter(c=>c.name==='ai.complete').map(c=>JSON.parse(c.input.input)); assert.equal(outbound[0].files[0].name, files[0].name); assert.equal(outbound[0].files[0].size,undefined);
});
test('missing, duplicate or foreign references cannot replace other files',()=> { const {drafts}=run({hints:[hint(files[0]),hint(files[0]),{...hint(files[1]),fileRef:'foreign'}]}); assert.ok(drafts.every(d=>d.tmdbId===0)); });
test('fabricated TMDB ID and uncertain choices remain unresolved',()=> { const {drafts}=run({choices:[{fileRef:'movie',tmdbId:999,mediaType:'movie',uncertain:false,reason:'fake'},{fileRef:'tv',tmdbId:2020202,mediaType:'tv',uncertain:true,reason:'uncertain'}]}); assert.ok(drafts.every(d=>d.tmdbId===0)); });
test('multi episode files are never truncated to a single episode',()=> { const {drafts}=run({files:[{...files[1],name:'Show.S02E03-E04.mkv'}]});assert.equal(drafts[0].unsupported,true);assert.equal(drafts[0].tmdbId,0); });
test('invalid season and episode values are not coerced',()=> { const {drafts}=run({hints:[hint(files[0]),{...hint(files[1]),season:'2',episode:-1}]});assert.equal(drafts[1].season,undefined);assert.equal(drafts[1].episode,undefined); });

test('missing season defaults to one and records the assumption; episode is never guessed',()=> {
  for (const season of [null, undefined]) {
    const {drafts}=run({hints:[hint(files[0]),{...hint(files[1]),season,episode:null}]});
    assert.equal(drafts[1].season,1); assert.equal(drafts[1].episode,undefined);
    assert.match(drafts[1].reason,/未识别到季数，默认第 1 季/);
    assert.equal(drafts[0].season,undefined);
  }
});

test('explicit special or later seasons survive; invalid seasons do not default',()=> {
  for (const season of [0, 3, -1, '1', 10000]) {
    const {drafts}=run({hints:[hint(files[0]),{...hint(files[1]),season}]});
    assert.equal(drafts[1].season,season===0 || season===3 ? season : undefined);
    assert.doesNotMatch(drafts[1].reason,/默认第 1 季/);
  }
});
test('one batch failure still creates editable drafts for every file',()=> { const drafts=[]; runPlugin(code,{action:'recognize',files,input:{profileId:1},config:{},sdkVersion:'1'}, {'ai.complete':()=>{throw Error('timeout')},'organize.prepare':p=>{drafts.push(p);return null}}); assert.equal(drafts.length,2);assert.ok(drafts.every(d=>d.tmdbId===0)); });


test('AI identifies Japanese fullwidth episode filenames before any TMDB lookup',()=> {
  const file={ref:'tv',name:'天地人 第２２話「真田幸村参上」 - [1440-1920@KFMVFR.NV7-hevc10_q260_u P7][字].mkv',path:'日本剧/天地人 第２２話.mkv'};
  const identity={...hint(file),name:'天地人',originalTitle:'Tenchijin',aliases:['Ten Chi Jin'],year:2009,season:null,episode:22,reason:'文件名中的剧名和全角集号，结合已有影视知识'};
  const {drafts,calls}=run({files:[file],hints:[identity],search:()=>[]});
  const d=drafts[0];assert.equal(d.recognition.title,'天地人');assert.equal(d.recognition.year,2009);assert.equal(d.mediaType,'tv');assert.equal(d.season,1);assert.equal(d.episode,22);assert.equal(d.tmdbId,0);assert.match(d.reason,/AI 已识别作品.*TMDB 未找到/);
  assert.equal(calls[0].name,'ai.complete');assert.match(calls[0].input.system,/直接依据自身影视知识/);assert.equal(calls.filter(c=>c.name==='ai.complete').length,1);
});

test('AI supplied original titles and aliases are searched without rigid year filtering',()=> {
  const identity={...hint(files[1]),name:'天地人',originalTitle:'Tenchijin',aliases:['Ten Chi Jin'],year:2009,episode:22,season:null};
  const {drafts,calls}=run({files:[files[1]],hints:[identity],search:q=>q.query==='Tenchijin'&&q.year===0?[{id:2020202,title:'天地人',originalTitle:'Tenchijin',year:'2009',mediaType:'tv'}]:[]});
  assert.equal(drafts[0].tmdbId,2020202);assert.equal(drafts[0].episode,22);
  const queries=calls.filter(c=>c.name==='tmdb.search').map(c=>c.input);assert.equal(queries.length,4);assert.ok(queries.some(q=>q.query==='天地人'&&q.year===0));assert.ok(queries.some(q=>q.query==='Tenchijin'&&q.year===0));
  const match=JSON.parse(calls.filter(c=>c.name==='ai.complete')[1].input.input);assert.equal(match.items[0].filename,files[1].name);assert.equal(match.items[0].candidates[0].originalTitle,'Tenchijin');
});

test('TMDB errors keep identification and season/episode with a distinct failure stage',()=> {
  const {drafts}=run({search:()=>{throw Error('network failure')}});
  assert.equal(drafts[1].recognition.title,'tv');assert.equal(drafts[1].season,2);assert.equal(drafts[1].episode,3);assert.match(drafts[1].reason,/TMDB 查询失败/);assert.doesNotMatch(drafts[1].reason,/network failure/);
});

test('matching failure retains the independent AI identification',()=> {
  let round=0;const drafts=[];
  runPlugin(code,{action:'recognize',files,input:{profileId:1},config:{},sdkVersion:'1'}, {'ai.complete':()=>{if(++round===1)return {content:{items:files.map(hint)}};throw Error('bad matching response')},'tmdb.search':({mediaType})=>[{id:20,title:'candidate',originalTitle:'original',mediaType,year:'2024'}],'organize.prepare':p=>{drafts.push(p);return null}});
  assert.equal(drafts[1].recognition.title,'tv');assert.equal(drafts[1].episode,3);assert.match(drafts[1].reason,/条目匹配请求失败/);
});

test('same work reuses query results and an unknown initial type can be resolved by AI',()=> {
  const chosen=[files[1],{...files[1],ref:'tv2'}];const identities=chosen.map(f=>({...hint(f),name:'Shared',originalTitle:'Shared',aliases:['Alias','Other','Last','Ignored'],mediaType:'unknown'}));
  const {drafts,calls}=run({files:chosen,hints:identities,choices:chosen.map(f=>({fileRef:f.ref,tmdbId:20,mediaType:'tv',uncertain:false,reason:'同一作品'})),search:()=>[{id:20,title:'Shared',mediaType:'tv',year:'2024'}]});
  assert.equal(calls.filter(c=>c.name==='tmdb.search').length,4);assert.ok(drafts.every(d=>d.tmdbId===20&&d.mediaType==='tv'));
});
