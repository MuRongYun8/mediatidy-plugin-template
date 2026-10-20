const registry = require('./registry.json');
const blocked = new Set(['__proto__', 'prototype', 'constructor']);
const namespaces = new Set(['plugin', 'input', 'config', 'ui', 'run', 'stats', 'row']);
function binding(path) {
  return typeof path === 'string' && path.length <= 200 && path.split('.').length <= 8 && path.split('.').every(x => /^[A-Za-z][A-Za-z0-9_]*$/.test(x) && !blocked.has(x)) && namespaces.has(path.split('.')[0]) && path.includes('.');
}
function resolve(model, path) {
  if (!binding(path)) return undefined;
  let value = model;
  for (const key of path.split('.')) {
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, key)) return undefined;
    value = value[key];
  }
  return value;
}
function matches(model, predicate) {
  if (!predicate) return true;
  const v = resolve(model, predicate.path);
  switch (predicate.op) { case 'eq': return v === predicate.value; case 'ne': return v !== predicate.value; case 'truthy': return !!v; case 'falsy': return !v; default: return false; }
}
function validatePage(page, actions = []) {
  const fail = () => { throw Error('无效或不受支持的插件页面协议'); };
  let count = 0;
  const object = x => x && typeof x === 'object' && !Array.isArray(x);
  const keys = (x, allowed) => { if (!object(x) || Object.keys(x).some(k => blocked.has(k) || !allowed.includes(k))) fail(); };
  function clean(x, depth = 0) {
    if (depth > 40) fail();
    if (x && typeof x === 'object') for (const k of Object.keys(x)) { if (blocked.has(k)) fail(); clean(x[k], depth + 1); }
  }
  clean(page);
  if (new TextEncoder().encode(JSON.stringify(page)).length > 262144) fail();
  function prop(type, v, depth) {
    if (registry.enums[type]) { if (!registry.enums[type].includes(v)) fail(); return; }
    switch (type) {
      case 'text': if (typeof v !== 'string' || v.length > 4000) fail(); break;
      case 'binding': if (!binding(v)) fail(); break;
      case 'editable': if (!binding(v) || !/^(input|config)\.[A-Za-z][A-Za-z0-9_]*$/.test(v)) fail(); break;
      case 'boolean': if (typeof v !== 'boolean') fail(); break;
      case 'actionId': if (typeof v !== 'string' || !actions.includes(v)) fail(); break;
      case 'texts': if (!Array.isArray(v) || !v.length || v.length > 10 || v.some(t => typeof t !== 'string' || t.length > 160)) fail(); break;
      case 'options': if (!Array.isArray(v) || v.length > 50) fail(); for (const o of v) { keys(o, ['label', 'value']); if (typeof o.label !== 'string' || o.label.length > 160 || !['string','number','boolean'].includes(typeof o.value)) fail(); } break;
      case 'tableColumns': if (!Array.isArray(v) || !v.length || v.length > 12) fail(); for (const c of v) { keys(c, ['label','cells']); if (typeof c.label !== 'string' || c.label.length > 160 || !Array.isArray(c.cells) || c.cells.length > 20) fail(); for (const cell of c.cells) node(cell, depth + 1, true); } break;
      default: fail();
    }
  }
  function node(n, depth, cell = false) {
    if (++count > registry.maxNodes || depth > registry.maxDepth) fail();
    keys(n, ['component','props','children','visibleWhen','disabledWhen']);
    if (typeof n.component !== 'string' || !Object.hasOwn(registry.components, n.component) || cell && !registry.cellComponents.includes(n.component)) fail();
    const properties = registry.components[n.component];
    if (n.props) { keys(n.props, Object.keys(properties)); for (const [key,value] of Object.entries(n.props)) prop(properties[key], value, depth); }
    for (const pred of [n.visibleWhen,n.disabledWhen]) if (pred) { keys(pred,['path','op','value']); if (!binding(pred.path) || !['eq','ne','truthy','falsy'].includes(pred.op) || pred.value !== undefined && pred.value !== null && !['string','number','boolean'].includes(typeof pred.value)) fail(); }
    if (n.component === 'Button' && (!n.props?.action || n.props.action === 'start' && !n.props.actionId || n.props.action === 'openTab' && !n.props.tab || ['editDraft','cancelTask'].includes(n.props.action) && !cell)) fail();
    if (n.children !== undefined) { if (!Array.isArray(n.children) || n.children.length > 100) fail(); for (const child of n.children) node(child,depth + 1,cell); }
  }
  keys(page,['version','tabs']);
  if (page.version !== '1' || !Array.isArray(page.tabs) || !page.tabs.length || page.tabs.length > 4) fail();
  const tabs = new Set();
  for (const t of page.tabs) { keys(t,['id','label','content']); if (!registry.enums.tab.includes(t.id) || tabs.has(t.id) || typeof t.label !== 'string' || t.label.length > 80 || !Array.isArray(t.content) || t.content.length > 100) fail(); tabs.add(t.id); for (const n of t.content) node(n,1); }
  function context(n,inResults=false){
    const inside=inResults||n.component==='Results';
    if(['Search','Pagination','SelectionBar'].includes(n.component)&&!inside)fail();
    if(n.component==='Table'&&n.props?.source==='run.drafts'&&!inside)fail();
    if(n.component==='Results'){
      let tables=0;const scan=x=>{if(x.component==='Results'&&x!==n)fail();if(x.component==='Table'){if(x.props?.source!=='run.drafts')fail();tables++}for(const child of x.children||[])scan(child)};scan(n);if(tables!==1)fail();
    }
    for(const child of n.children||[])context(child,inside);
  }
  for(const t of page.tabs)for(const n of t.content)context(n);
  return page;
}
const node = (component, props = {}, children = []) => ({ component, props, children });
const definePage = page => page;
module.exports = { registry, validatePage, resolve, matches, node, definePage };
