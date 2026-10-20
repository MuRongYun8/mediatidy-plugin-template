const fs = require('node:fs');
const path = require('node:path');
process.chdir(path.join(__dirname, '..'));
function compiler() { try { return require('typescript'); } catch { return require('../../frontend/node_modules/typescript'); } }
const action = process.argv[2];
if (action === 'validate') {
  const m = JSON.parse(fs.readFileSync('plugin.json', 'utf8'));
  require('../ui-sdk').validatePage(JSON.parse(fs.readFileSync('ui/page.json','utf8')),m.actions.map(a=>a.id));
  if (m.sdkVersion !== '1' || m.entry !== 'dist/index.js' || !/^[a-z][a-z0-9.-]{2,79}$/.test(m.id)) throw Error('Invalid manifest');
  if (!m.actions.length || !m.permissions.includes('organize.prepare')) throw Error('Missing actions or capabilities');
} else {
  const ts = compiler();
  if (action === 'typecheck') {
    const program = ts.createProgram(['src/worker/index.ts','src/ui/page.ts'], { noEmit: true, strict: true, target: ts.ScriptTarget.ES2017, types: [], module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.Node10 });
    const diagnostics = ts.getPreEmitDiagnostics(program);
    if (diagnostics.length) { console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, { getCurrentDirectory: process.cwd, getCanonicalFileName: x => x, getNewLine: () => '\n' })); process.exit(1); }
  } else if (action === 'build') {
    const output = ts.transpileModule(fs.readFileSync('src/worker/index.ts','utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2017, module: ts.ModuleKind.CommonJS, removeComments: true } });
    const ui = ts.transpileModule(fs.readFileSync('src/ui/page.ts','utf8'), { compilerOptions: {target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS} });
    const moduleUI={exports:{}};new (require('node:vm').Script)(`(function(require,module,exports){${ui.outputText}\n})`).runInNewContext()((id)=>{if(id!=='../../ui-sdk')throw Error('UI build import denied');return require('../ui-sdk')},moduleUI,moduleUI.exports);
    const page=moduleUI.exports.default;require('../ui-sdk').validatePage(page,JSON.parse(fs.readFileSync('plugin.json','utf8')).actions.map(a=>a.id));fs.mkdirSync('ui',{recursive:true});fs.writeFileSync('ui/page.json',JSON.stringify(page,null,2)+'\n');
    fs.mkdirSync('dist', { recursive: true }); fs.writeFileSync('dist/index.js', output.outputText);
  } else throw Error('Unknown command');
}
