import type {Component,ComponentProps,UINode,UIPage,Binding} from '../../sdk/ui-schema';
const n=<C extends Component>(component:C,props?:ComponentProps[C],children?:UINode[]):UINode=>({component,props,children} as UINode);
const note=(value:string)=>n('Text',{text:value,tone:'muted',size:'sm'});
const when=(node:UINode,path:Binding,op:'truthy'|'falsy'='truthy'):UINode=>({...node,visibleWhen:{path,op}});
export default {version:'1',tabs:[
  {id:'overview',label:'使用说明',content:[n('Card',{title:'AI 识别，按结论整理',description:'识别策略、提示词和页面均来自这个独立插件。'},[
    n('Text',{text:'把原始文件名、相对路径和补充说明交给 AI。AI 自己判断作品和季集，自己决定是否查询资料；识别信息完整后，直接调用 MT 手动整理。'}),
    n('Stack',{direction:'row'},[n('Badge',{text:'选择视频'}),n('Badge',{text:'AI 自主识别'}),n('Badge',{text:'MT 执行整理'})]),
    note('开始前在 MT 配置 AI、TMDB 和整理方案，并为本插件授权目录及方案。直接整理遵循方案的移动、复制、覆盖和清理设置。'),
    note('每批最多 8 个文件，每次最多 100 个视频。AI 直接回答时，每批一次对话。缺少季数默认第一季，明确的第 0 季保留，集号不猜测。'),
    n('Button',{label:'选择文件并开始',action:'newRun'})
  ])]},
  {id:'run',label:'识别与整理',content:[
    n('Stack',{direction:'row'},[n('Button',{label:'新建整理',action:'newRun'}),n('Button',{label:'运行记录',action:'openTab',tab:'history',variant:'outline'}),n('Button',{label:'提示词与授权',action:'openTab',tab:'settings',variant:'ghost'})]),
    when(n('Grid',{columns:2,ratio:'wide-left',gap:'lg'},[
      n('Card',{title:'要整理哪些视频',description:'选择多个文件或目录。目录在 MT 后台扫描，超过 100 个视频时请分批。'},[n('FilePicker')]),
      n('Card',{title:'按哪个方案执行'},[
        n('ProfilePicker',{label:'整理方案',bind:'input.profileId'}),
        n('Textarea',{label:'给 AI 的补充说明（可留空）',bind:'input.instructions',placeholder:'直接告诉 AI 你知道的线索，无需填写搜索词或识别步骤。'}),
        n('Alert',{text:'点击后会按 AI 结论直接整理，请先检查所选文件和方案。不会再进入 MT 识别或草稿确认。'}),
        {...n('Button',{label:'AI 识别并整理',action:'start',actionId:'recognize'}),disabledWhen:{path:'ui.canStart',op:'falsy'}},
        note('仅发送文件名、相对路径和说明；联网工具是否可用取决于你的授权与服务设置。')
      ])]),'ui.showNew'),
    when(n('Progress',{label:'当前进度',bind:'run.progress.completed',total:'run.progress.total'}),'ui.working'),
    when(n('Alert',{bind:'run.error',tone:'danger'}),'run.error'),
    when(n('Alert',{bind:'ui.error',tone:'danger'}),'ui.error'),
    when(n('Card',{title:'本次识别与整理'},[
      n('Stack',{direction:'row'},[note('插件版本'),n('Badge',{bind:'run.pluginVersion'}),n('Status',{bind:'run.status'}),n('Button',{label:'刷新状态',action:'refresh',variant:'outline'}),when(n('Button',{label:'停止后续识别',action:'cancelRun',variant:'outline'}),'ui.working')]),
      n('Grid',{columns:4,gap:'sm'},[
        n('Card',{title:'AI 对话'},[n('Text',{bind:'run.stats.dialogueRounds',size:'xl'})]),n('Card',{title:'实际模型请求'},[n('Text',{bind:'run.stats.modelRequests',size:'xl'})]),
        n('Card',{title:'联网 / TMDB'},[n('Stack',{direction:'row'},[n('Text',{bind:'run.stats.webQueries',size:'xl'}),note('/'),n('Text',{bind:'run.stats.tmdbQueries',size:'xl'})])]),
        n('Card',{title:'缓存命中'},[n('Text',{bind:'run.stats.cacheHits',size:'xl'})])
      ]),
      when(note('请求统计未记录；目录扫描完成后开始识别。'),'run.stats','falsy'),
      note('查询资料后可能继续对话；实际请求包含兼容重发和原生联网。完整识别信息直接入队，未确定的文件留为待处理。'),
      n('Table',{source:'run.result',selectionBind:'input.selectedFileRefs',rowKey:'row.fileRef',columns:[
        {label:'文件',cells:[n('Text',{bind:'row.name',lines:2}),n('Details',{label:'路径、结论与来源'},[n('Text',{bind:'row.path',size:'sm',tone:'muted'}),n('Text',{bind:'row.reason',size:'sm'}),n('Text',{bind:'row.sources',size:'sm',tone:'muted'})])]},
        {label:'AI 识别结论',cells:[n('Text',{bind:'row.title'}),n('Stack',{direction:'row',gap:'sm'},[n('Text',{bind:'row.year',tone:'muted'}),n('Text',{bind:'row.mediaType',format:'mediaType',tone:'muted'})]),n('Stack',{direction:'row',gap:'sm'},[when(note('TMDB'),'row.tmdbId'),n('Text',{bind:'row.tmdbId',tone:'muted'}),n('Text',{bind:'row.seasonEpisode'})]),n('Text',{bind:'row.warning',size:'sm',tone:'warning'})]},
        {label:'整理状态',cells:[n('Status',{bind:'row.status'}),n('Text',{bind:'row.error',size:'sm',tone:'danger'}),when(note('已交给 MT，实际进度见下方业务任务。'),'row.taskRef')]}
      ]}),
      {...n('Button',{label:'重试所选待处理文件',action:'start',actionId:'retry-pending',variant:'outline'}),disabledWhen:{path:'ui.working',op:'truthy'}},
      note('跨页选择后重试；已提交及提交结果不明的文件自动排除。停止识别不会撤销已入队的整理，可在业务任务中单独取消。'),
      n('RunLog')
    ]),'ui.hasRun'),
    when(n('EmptyState',{title:'从一组视频开始',description:'AI 负责识别，MT 按识别参数执行手动整理。每个文件单独对应作品和任务。'}),'ui.hasRun','falsy'),
    n('TaskList')
  ]},
  {id:'history',label:'运行记录',content:[n('RunHistory'),n('TaskList')]},
  {id:'settings',label:'插件设置',content:[n('Card',{title:'识别策略由你决定'},[note('完整提示词可直接编辑，留空使用插件默认值。不会拼接旧的提取、筛选或复核提示词。定时运行同样会直接整理，请检查授权后再启用。')]),n('ConfigForm'),n('ScheduleForm'),n('DataManagement')]}
]} satisfies UIPage;
