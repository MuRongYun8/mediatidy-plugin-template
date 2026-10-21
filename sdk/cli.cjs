#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm'),http=require('node:http'),crypto=require('node:crypto');
const {spawn,spawnSync}=require('node:child_process');
const {createRequire}=require('node:module');
const {contract}=require('./mock.cjs');
const sdkDir=__dirname;
const {isDeepStrictEqual}=require('node:util');
function dependency(name){try{return require(name)}catch{const local=path.resolve(sdkDir,'../frontend/package.json');if(fs.existsSync(local))return createRequire(local)(name);throw Error(`Missing ${name}; install SDK development dependencies first`)}}
function schema(){const bundled=path.join(sdkDir,'ui-schema/index.cjs');return require(fs.existsSync(bundled)?bundled:path.resolve(sdkDir,'../plugin-ui-schema/index.cjs'))}
function readJSON(file){const text=fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'');return JSON.parse(text,(key,value)=>{if(['__proto__','prototype','constructor'].includes(key))throw Error('Unsafe JSON key');return value})}
function inside(root,name){const base=fs.realpathSync(root),full=path.resolve(root,name),resolved=fs.realpathSync(full);const relative=path.relative(base,resolved);if(relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative)||!relative)throw Error('Path outside plugin');if(!fs.statSync(resolved).isFile())throw Error('Plugin assets must be regular files');return resolved}
function check(root){
 const m=readJSON(path.join(root,'plugin.json'));
 if(m.sdkVersion!=='2'||m.entry!=='dist/index.js'||!/^[a-z][a-z0-9.-]{2,79}$/.test(m.id))throw Error('Expected an SDK v2 manifest and dist/index.js');
 const permissions=new Set(contract.methods.map(m=>m.permission).filter(Boolean));permissions.add('organize.submit');
 if(!Array.isArray(m.permissions)||new Set(m.permissions).size!==m.permissions.length||m.permissions.some(p=>!permissions.has(p)))throw Error('Unknown or duplicate capability');
 if(!Array.isArray(m.actions)||!m.actions.length||new Set(m.actions.map(a=>a.id)).size!==m.actions.length)throw Error('Actions must be unique and nonempty');
 const code=fs.readFileSync(inside(root,m.entry),'utf8');if(Buffer.byteLength(code)>524288)throw Error('Worker exceeds 512 KiB');new vm.Script(code);
 if(m.ui){if(m.ui.version!=='1'||m.ui.entry!=='ui/page.json'||m.ui.icon&&m.ui.icon!=='ui/icon.png')throw Error('Unsupported UI resource');schema().validatePage(readJSON(inside(root,m.ui.entry)),m.actions.map(a=>a.id));if(m.ui.icon)inside(root,m.ui.icon)}
 const ts=dependency('typescript'),configPath=path.join(root,'tsconfig.json');
 if(fs.existsSync(configPath)){const raw=ts.readConfigFile(configPath,ts.sys.readFile);if(raw.error)throw Error(ts.flattenDiagnosticMessageText(raw.error.messageText,'\n'));const cfg=ts.parseJsonConfigFileContent(raw.config,ts.sys,root);const program=ts.createProgram(cfg.fileNames,{...cfg.options,noEmit:true});const diagnostics=[...cfg.errors,...ts.getPreEmitDiagnostics(program)];if(diagnostics.length)throw Error(ts.formatDiagnosticsWithColorAndContext(diagnostics,{getCurrentDirectory:()=>root,getCanonicalFileName:x=>x,getNewLine:()=> '\n'}))}
 return m;
}
async function build(root){
 const esbuild=dependency('esbuild');
 fs.mkdirSync(path.join(root,'dist'),{recursive:true});fs.mkdirSync(path.join(root,'ui'),{recursive:true});
 await esbuild.build({entryPoints:[path.join(root,'src/worker/index.ts')],outfile:path.join(root,'dist/index.js'),bundle:true,platform:'neutral',format:'cjs',target:'es2020',logLevel:'silent'});
 const output=await esbuild.build({entryPoints:[path.join(root,'src/ui/page.ts')],write:false,bundle:true,platform:'neutral',format:'cjs',target:'es2020',logLevel:'silent'});
 // Development page sources are trusted author code. The produced JSON is the
 // only UI artifact that an installed plugin can supply to MT.
 const context=vm.createContext({module:{exports:{}}});vm.runInContext(output.outputFiles[0].text,context,{timeout:1000});
 const page=JSON.parse(JSON.stringify(context.module.exports.default));const m=readJSON(path.join(root,'plugin.json'));schema().validatePage(page,m.actions.map(a=>a.id));fs.writeFileSync(path.join(root,'ui/page.json'),JSON.stringify(page,null,2)+'\n');check(root);
}
function crc32(data){let c=0xffffffff;for(const b of data){c^=b;for(let k=0;k<8;k++)c=(c>>>1)^(c&1?0xedb88320:0)}return(c^0xffffffff)>>>0}
function archive(root,m){const names=['plugin.json',m.entry,...(m.ui?[m.ui.entry,...(m.ui.icon?[m.ui.icon]:[])]:[])];let offset=0;const files=[],central=[];for(const name of names){const n=Buffer.from(name),data=fs.readFileSync(inside(root,name)),crc=crc32(data);const h=Buffer.alloc(30);h.writeUInt32LE(0x04034b50);h.writeUInt16LE(20,4);h.writeUInt16LE(0x800,6);h.writeUInt32LE(crc,14);h.writeUInt32LE(data.length,18);h.writeUInt32LE(data.length,22);h.writeUInt16LE(n.length,26);files.push(h,n,data);const d=Buffer.alloc(46);d.writeUInt32LE(0x02014b50);d.writeUInt16LE(20,4);d.writeUInt16LE(20,6);d.writeUInt16LE(0x800,8);d.writeUInt32LE(crc,16);d.writeUInt32LE(data.length,20);d.writeUInt32LE(data.length,24);d.writeUInt16LE(n.length,28);d.writeUInt32LE(offset,42);central.push(d,n);offset+=h.length+n.length+data.length}const end=Buffer.alloc(22),dir=Buffer.concat(central);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(names.length,8);end.writeUInt16LE(names.length,10);end.writeUInt32LE(dir.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...files,dir,end])}
function runtime(){const binary=process.env.MT_PLUGIN_RUNTIME||path.join(sdkDir,'bin',process.platform==='win32'?'mt-plugin-runtime.exe':'mt-plugin-runtime');if(!fs.existsSync(binary))throw Error('Goja runtime missing. Set MT_PLUGIN_RUNTIME to the matching mt-plugin-runtime binary (SDK developer guide).');return binary}
function checkArchive(data){const file=path.join(os.tmpdir(),'mt-plugin-'+crypto.randomUUID()+'.zip');fs.writeFileSync(file,data,{flag:'wx'});try{const result=spawnSync(runtime(),['check-package',file],{encoding:'utf8',windowsHide:true});if(result.status!==0)throw Error(result.stderr||'Host package validation failed')}finally{fs.unlinkSync(file)}}
async function goja(code,scenario){return new Promise((resolve,reject)=>{
 const child=spawn(runtime(),['--plugin-worker-v2'],{windowsHide:true,env:{SystemRoot:process.env.SystemRoot||'',GOMEMLIMIT:'128MiB',GOMAXPROCS:'1'}});let output='',done=false,index=0;const calls=[];const timer=setTimeout(()=>{child.kill();reject(Error('Goja test timed out'))},15000);
 const finish=(err,value)=>{if(done)return;done=true;clearTimeout(timer);child.kill();err?reject(err):resolve(value)};
 child.on('error',e=>finish(e));child.on('exit',()=>{if(!done)finish(Error('Worker exited before a result'))});child.stderr.resume();
 child.stdout.on('data',chunk=>{output+=chunk;if(output.length>4194304)return finish(Error('Worker frame exceeded limit'));let at;while((at=output.indexOf('\n'))>=0){const line=output.slice(0,at);output=output.slice(at+1);let f;try{f=JSON.parse(line)}catch(e){return finish(e)}if(f.type==='call'){calls.push(f.method);const expected=scenario.calls?.[index++];if(!expected||expected.method!==f.method)return finish(Error(`Unexpected call ${f.method}`));if(expected.input!==undefined&&!isDeepStrictEqual(expected.input,f.input))return finish(Error(`Input mismatch for ${f.method}`));child.stdin.write(JSON.stringify({type:'response',id:f.id,result:expected.result??null,...(expected.error?{error:expected.error,failure:{code:'MOCK_FAILURE',message:expected.error,retryable:false}}:{})})+'\n')}else if(f.type==='result'){if(index!==(scenario.calls||[]).length)return finish(Error('Missing expected calls'));if(scenario.result!==undefined&&!isDeepStrictEqual(scenario.result,f.result))return finish(Error('Result mismatch'));finish(null,{result:f.result,calls})}else if(f.type==='error')finish(Error(f.error))}});
 child.stdin.write(JSON.stringify({type:'init',source:code,input:scenario.input})+'\n');
})}
function preview(root,port){const staticRoot=path.join(sdkDir,'preview');if(!fs.existsSync(path.join(staticRoot,'plugin-preview.html')))throw Error('Preview bundle missing; build the SDK preview distribution first');const m=check(root);const server=http.createServer((req,res)=>{try{const url=new URL(req.url,'http://127.0.0.1');const assets={'/preview-data/manifest':'plugin.json','/preview-data/page':m.ui?.entry,'/preview-data/icon':m.ui?.icon,'/preview-data/model':'tests/preview.json'};let file;if(Object.hasOwn(assets,url.pathname)){const name=assets[url.pathname];if(!name){res.writeHead(404);return res.end()}file=inside(root,name)}else{let name=decodeURIComponent(url.pathname).replace(/^\//,'')||'plugin-preview.html';if(name.includes('..')||name.includes('\\'))throw Error('Invalid path');file=inside(staticRoot,name)}res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':file.endsWith('.png')?'image/png':'application/json');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','no-store');res.end(fs.readFileSync(file))}catch{res.writeHead(404);res.end('Not found')}});server.listen(port,'127.0.0.1',()=>console.log(`Preview: http://127.0.0.1:${server.address().port}`));}
async function main(){const [command,arg]=process.argv.slice(2);const root=path.resolve(arg||'.');
 if(command==='init'){if(!arg||fs.existsSync(root))throw Error('init requires a new directory');fs.cpSync(path.join(sdkDir,'starter'),root,{recursive:true,filter:src=>!src.split(path.sep).includes('node_modules')&&!/\.(zip|tgz)$/i.test(src)});fs.mkdirSync(path.join(root,'sdk'),{recursive:true});for(const file of ['index.d.ts','mock.cjs','methods.json'])fs.copyFileSync(path.join(sdkDir,file),path.join(root,'sdk',file));const schemaPath=path.join(sdkDir,'ui-schema/index.d.ts');fs.copyFileSync(fs.existsSync(schemaPath)?schemaPath:path.resolve(sdkDir,'../plugin-ui-schema/index.d.ts'),path.join(root,'sdk/ui-schema.d.ts'));const pkg=readJSON(path.join(root,'package.json'));pkg.devDependencies={'@mediatidy/plugin-sdk':`file:${sdkDir.replaceAll('\\','/')}`};fs.writeFileSync(path.join(root,'package.json'),JSON.stringify(pkg,null,2)+'\n');console.log(`Created ${root}`);return}
 if(command==='build'){await build(root);console.log('Built and type-checked plugin');return}
 if(command==='check'){check(root);console.log('Manifest, UI, worker syntax and types verified');return}
 if(command==='test'){const m=check(root);checkArchive(archive(root,m));const file=path.join(root,'tests/goja.json');const cases=readJSON(file);if(!Array.isArray(cases)||!cases.length)throw Error('Add at least one tests/goja.json scenario');for(const scenario of cases){await goja(fs.readFileSync(path.join(root,m.entry),'utf8'),scenario);console.log(`Goja passed: ${scenario.name||'scenario'}`)}return}
 if(command==='pack'){const m=check(root),data=archive(root,m);checkArchive(data);const file=path.join(root,`${m.id}-${m.version}.zip`);fs.writeFileSync(file,data);console.log(file);return}
 if(command==='preview'){preview(root,Number(process.env.MT_PLUGIN_PREVIEW_PORT||4175));return}
 throw Error('Usage: mt-plugin init <new-dir> | check/build/test/preview/pack [plugin-dir]');
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1});
module.exports={check,build,archive,goja};
