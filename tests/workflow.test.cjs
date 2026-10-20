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
    'tmdb.search': ({mediaType}) => [{id:mediaType==='movie'?1010101:2020202,title:'title',mediaType,year:'2024'}],
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
test('one batch failure still creates editable drafts for every file',()=> { const drafts=[]; runPlugin(code,{action:'recognize',files,input:{profileId:1},config:{},sdkVersion:'1'}, {'ai.complete':()=>{throw Error('timeout')},'organize.prepare':p=>{drafts.push(p);return null}}); assert.equal(drafts.length,2);assert.ok(drafts.every(d=>d.tmdbId===0)); });
