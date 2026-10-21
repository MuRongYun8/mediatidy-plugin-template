# 插件开发指南（v1）

## 从模板开始

复制独立仓库 <https://github.com/MuRongYun8/mediatidy-plugin-template>。MT 主仓库也保留同名目录，便于统一验证与嵌入官方示例。默认就是可运行的 AI 识别整理插件。

1. 修改 `plugin.json` 的 id、name、author、version。自定义插件应改成自己的唯一 ID，如 `example.ai-organize`，不要复用官方 ID。
2. 保留 `sdkVersion: "1"` 与 `entry: "dist/index.js"`，只申请真正需要的权限。
3. 修改 `src/worker/index.ts` 的提示词、提取规则和候选选择。插件不得提交自动整理。
4. 本地运行：

   ```sh
   npm install --ignore-scripts
   npm run check
   ```

   依次检查类型、清单、构建与 mock 测试。开发依赖仅 TypeScript；dist 不依赖 Node。MT 主仓库内开发可复用 frontend 的 TypeScript，不必另装。

5. 提交源代码、清单、SDK 固定快照、测试、锁文件和 **dist/index.js**。发布版本标签，保证该提交能直接安装；MT 不构建源码。
6. MT「插件中心 → 从仓库安装」，填写 GitHub/Gitee 仓库根地址及标签，依次读取信息、审阅权限和资源、完成安装。安装初始停用，点击“配置并启用”。完整用户与开发 Wiki 随模板位于 `docs/wiki/README.md`。

官方模板只申请文件、AI、TMDB、草稿、用户确认提交和所属任务权限，默认没有通知、STRM 或 HTTP 权限。AI 需在 MT 系统设置中预先启用；TMDB 和整理方案也使用 MT 配置。

## 运行模型

```ts
module.exports.run = function (input: MTInput) {
  // input = {action, files, input, config, sdkVersion}
  // 所有 mt 方法都是同步 JSON RPC，不要使用 async/await、Promise、Node API。
  mt.log({ level: 'info', message: '开始识别' });
  return [{ message: '完成' }];
};
```

宿主接收动作后在独立队列扫描所选文件；`input.files` 是去重后的安全文件列表，`ref` 是当前运行内的不透明引用，不能自行构造或跨运行复用。传给模型只挑选 name、path 与 ref 和用户说明，不发送 size、完整宿主路径、授权配置或其他 SDK 结果。

Goja 同步调用便于固定计算预算、RPC 次数和取消语义。不要写无限循环或自建并发。模板每批 8 文件、最多 6 轮自主管理的模型对话；每运行 ai.chat 与 ai.complete 合计最多 78 次（旧 complete 单方法仍最多 32 次），公开搜索最多 32 次。长操作放宿主能力调用中；支持取消的宿主请求使用工作进程运行上下文。工作进程不能用定时器绕过执行预算。

## 清单和界面

`actions` 定义按钮与字段；`config` 为持久配置。字段类型：text、textarea、number、boolean、files、profile；key 为小写字母开头、其后字母数字下划线，2–64 字符。文件选择不写进 input 字段值，而放运行请求 selections。profile 字段从授权方案中选择 ID。必填值由服务端再次校验。

`columns: [{key,label}]` 定义通用结果表，run 返回对象数组即可。宿主用文本渲染，HTML 不会执行。整理预览由 MT 固定界面呈现，插件不能替换确认弹窗、注入前端 JS 或声称已经确认。

权限名称与方法见 `sdk/index.d.ts`。目录、方案、通知通道和 HTTP 地址由管理员在安装/配置界面绑定；脚本不能扩大范围。更改版本、授权或配置会取消活动识别并使旧草稿需要重新识别。

## 常见能力

```ts
const roots = mt.files.roots(); // 只有 id/name，无物理路径
const page = mt.files.list({rootId: roots[0].id, path: '.', page: 1});
const output = mt.ai.complete({system: '返回 JSON', input: '{}', schema: {type: 'object'}});
const candidates = mt.tmdb.search({query: '作品名', mediaType: 'tv', year: 2024});
const episodes = mt.tmdb.season({id: 12345, season: 1});
mt.organize.prepare({fileRef: input.files[0].ref, profileId: 1, tmdbId: 12345,
  mediaType: 'tv', season: 1, episode: episodes[0], reason: '实际候选一致'});
```

`organize.prepare` 允许生成 `needs_review` 草稿，以便显示缺失候选或异常项；未通过校验不能提交。缺少文件引用或方案授权不会产生有效整理。模板遇到多集合集传 `unsupported:true`，MT 禁止其提交。普通电影不要填写 season/episode。

`organize.submit` 虽可声明为用户确认权限，但脚本中没有该方法。只有 MT 登录界面的确认 API 可提交草稿。不要自行请求 MT 登录接口、制造用户确认或规避封存检查。

`storage.get/set/delete({key,...})` 存取插件私有 KV，key 使用小写字母、数字、点或连字符，3–80 字符。缺失返回 null。不要保存宿主密钥或全局缓存。`config.get()` 返回当前插件配置快照。升级不运行迁移脚本，配置变化应提供默认值并保持兼容。

`tasks.list()` 返回当前宿主会话内本插件创建的任务摘要，`tasks.cancel({id})` 只能取消所属任务。重启后任务编号不能用作所有权凭据，旧记录必须去 MT 任务中心核对。

`notification.send({channelId,title,content})` 只投递到授权通道；`strm.run({profileId})` 只触发授权方案。HTTP 按 URL 和方法授权，不能任意加鉴权头，也无法访问 MT/ff/元数据服务。自定义模型统一使用 `ai.chat` 或 `ai.complete`，不通过 HTTP 保存或请求模型密钥。

## 错误、重试和调试

能力拒绝/失败会抛出 Error，建议按文件 catch，生成可修正草稿并继续处理其他文件。错误提示应解释下一步，不输出原始模型响应或凭据。`mt.log` 受数量/长度限制，运行记录展示能力名和成功/失败状态；不要将文件全路径或外部服务完整错误堆栈写日志。

测试使用固定候选与模拟模型：

```js
const {runPlugin} = require('./sdk/mock.cjs');
const {calls, result} = runPlugin(code, input, {
  'tmdb.search': () => [{id: 12345, title: '测试', mediaType: 'movie', year: '2024'}],
  'organize.prepare': proposal => ({status: 'ready'})
});
```

mock 用于可信本地开发，不是生产安全沙箱。应覆盖错序、漏项、重复引用、虚构 ID、超时、缺失季集和多集合集。Go 后端另测实际子进程、权限与确认边界。不要用真实云盘或真实凭据作为测试依赖。

识别可取消并仅重试待处理文件；新批次保持与已入队任务隔离。确认提交若超时，先刷新；`submission_unknown` 不可自动重试。定时识别会持久化待确认草稿，不自动整理，需提示模型调用费用。资源上限和完整 API 见 [系统设计](plugins-design.md)。

## SDK 与分发同步

MT 主仓库 `plugin-sdk/` 是唯一类型和 mock 来源；模板 `sdk/` 是生成的 1.0.0 快照，禁止单独手改。修改主仓库后依次运行：

```sh
node scripts/sync-plugin-template.cjs --sdk-only
cd mediatidy-plugin-template
npm run check
cd ..
node scripts/sync-plugin-template.cjs
```

Go 测试会校验模板 dist、内置副本与 SDK 快照逐字节一致。远程独立仓库只分发模板目录的内容，包含固定快照，因此无需 checkout 整个 MT；更新 SDK 必须先升级主仓库再生成快照并发布模板新标签。不兼容 SDK 主版本应另行发布，v1 宿主拒绝安装。

组件页面、Logo、资源安装与 FF 摘要能力的当前契约见 [组件协议 v1](plugins-component-protocol.md)。


## 请求优化与可观测性

SDK v1 增加只读 ai.capabilities()，仅返回当前插件获准的对话、联网和 TMDB 可用状态与固定原因码，不探测或暴露配置。模板仅声明可用工具，资料足够时每批一次结束；每批最多 8 文件，不强制查询顺序，不增加 AI 复核。

宿主对成功的公开搜索和 TMDB 查询使用运行内缓存，键顺序规范化但查询文本不改写；失败不缓存，命中仍校验授权、安装修订、许可证和当前服务状态并计配额，键和值合计最多 4 MiB。缓存不持久化、不跨插件/运行，MT 最终核验独立执行。

Run.stats 是宿主维护的可选统计，记录批次、对话轮次、实际查询、缓存命中、实际模型请求、原生联网、兼容重发及服务报告用量。传输层在失败时也报告请求数，不采信插件自报用量；旧记录显示未记录，缺失用量显示未知。默认值升级仅替换未修改的旧默认，完整自定义配置保留。FF 缓存及凭据不进入上述 DTO、日志或缓存。
