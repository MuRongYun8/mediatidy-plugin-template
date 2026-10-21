'use strict';
// Uses MT's distributed renderer. No MT source checkout or plugin browser JS.
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),sdk=path.resolve(process.env.MT_PLUGIN_SDK||path.join(root,'sdk'));
if(!fs.existsSync(path.join(sdk,'preview/plugin-preview.html')))throw Error('请将 MT_PLUGIN_SDK 指向含 preview/ 的官方 SDK 开发包，然后运行 npm run preview');
const result=spawnSync(process.execPath,[path.join(sdk,'cli.cjs'),'preview',root],{stdio:'inherit',windowsHide:true});
process.exitCode=result.status??1;
