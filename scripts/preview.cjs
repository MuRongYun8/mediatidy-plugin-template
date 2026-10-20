// Runs only developer-selected local MT source; no downloaded plugin UI code is
// evaluated by the browser. MT's existing renderer runs against mock adapters.
const fs=require('node:fs'),path=require('node:path'),{spawnSync,spawn}=require('node:child_process');
const template=path.resolve(__dirname,'..');
const mt=path.resolve(process.argv[2]||process.env.MT_SOURCE||path.join(template,'..'));
if(!fs.existsSync(path.join(mt,'frontend/src/plugin-preview.tsx')))throw Error('请传入包含新版插件 UI 的 MT 源码目录：npm run preview -- C:/path/to/MediaTidy');
const build=()=>{const r=spawnSync(process.execPath,[path.join(template,'scripts/dev.cjs'),'build'],{stdio:'inherit'});if(r.status!==0)throw Error('构建失败');};build();
const vite=path.join(mt,'frontend/node_modules/vite/bin/vite.js');if(!fs.existsSync(vite))throw Error('请先在 MT/frontend 安装依赖');
const child=spawn(process.execPath,[vite,'--host','127.0.0.1'],{cwd:path.join(mt,'frontend'),stdio:'inherit',env:{...process.env,MT_PLUGIN_PREVIEW:template}});
let timer;const watcher=fs.watch(path.join(template,'src/ui'),()=>{clearTimeout(timer);timer=setTimeout(()=>{try{build()}catch(e){console.error(e.message)}},200)});
console.log('预览地址：http://127.0.0.1:5173/__plugin-preview/');
child.on('exit',code=>{watcher.close();process.exitCode=code||0});process.on('SIGINT',()=>child.kill());
