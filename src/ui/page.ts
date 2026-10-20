import { definePage, node as n, type UINode } from '../../ui-sdk';

const text = (text:string):UINode => n('Text',{text,tone:'muted'});
const when = (node:UINode,path:'ui.showNew'|'ui.hasRun'|'ui.working',op:'truthy'|'falsy'='truthy'):UINode => ({...node,visibleWhen:{path,op}});
export default definePage({version:'1',tabs:[
  {id:'overview',label:'概览',content:[n('Card',{title:'让复杂文件名变成可靠的整理草稿'},[
    text('作品名称、原名、年份和季集全部由插件中的 AI 判断。TMDB 仅用于匹配整理所需条目；匹配失败仍保留 AI 识别结果，MT 不调用核心识别流程。'),
    n('Steps',{labels:['选择文件','AI 识别','核验修正','确认整理'],bind:'ui.step'}),
    n('Alert',{text:'需要已启用的 AI、TMDB 和整理方案。文件名、相对路径及补充说明会发送至你配置的模型服务。'}),
    n('Button',{label:'新建识别',action:'newRun'})])]},
  {id:'run',label:'运行',content:[
    n('Stack',{direction:'row'},[n('Button',{label:'新建识别',action:'newRun'}),n('Button',{label:'运行记录',action:'openTab',tab:'history',variant:'outline'}),n('Button',{label:'插件设置',action:'openTab',tab:'settings',variant:'ghost'})]),
    n('Steps',{labels:['选择文件','AI 识别','核验修正','确认整理'],bind:'ui.step'}),
    when(n('Grid',{columns:2,ratio:'wide-left',gap:'lg'},[
      n('Card',{title:'选择要识别的视频',description:'可选择多个文件或目录；MT 扫描后最多接受 100 个视频。'},[n('FilePicker')]),
      n('Card',{title:'整理方式与识别提示'},[
        n('ProfilePicker',{label:'整理方案',bind:'input.profileId'}),
        n('Textarea',{label:'识别补充说明',bind:'input.instructions',placeholder:'例如：这些文件来自同一部剧；也可保留为空。'}),
        n('Alert',{text:'不发送文件内容、下载地址或宿主完整路径；识别不会自动提交整理。',tone:'muted'}),
        {...n('Button',{label:'开始 AI 识别',action:'start',actionId:'recognize'}),disabledWhen:{path:'ui.canStart',op:'falsy'}},
        {...text('请选择文件或目录及整理方案后开始。'),visibleWhen:{path:'ui.canStart',op:'falsy'}}])]),'ui.showNew'),
    when(n('Progress',{label:'识别与核验进度',bind:'stats.drafts',total:'stats.files'}),'ui.working'),
    when(n('Grid',{columns:4,gap:'sm'},[
      n('Metric',{label:'全部文件',bind:'stats.files',filter:'all'}),n('Metric',{label:'可整理',bind:'stats.ready',tone:'success',filter:'ready'}),
      n('Metric',{label:'待处理',bind:'stats.review',tone:'warning',filter:'needs_review'}),n('Metric',{label:'已提交',bind:'stats.submitted',tone:'primary',filter:'submitted'})]),'ui.hasRun'),
    when(n('Results',{title:'识别结果 · 核验后再整理'},[
      n('Stack',{direction:'row'},[n('Button',{label:'刷新状态',action:'refresh',variant:'outline'}),{...n('Button',{label:'取消识别',action:'cancelRun',variant:'outline'}),visibleWhen:{path:'ui.working',op:'truthy'}},n('Button',{label:'仅重试待处理项',action:'retry',variant:'outline'})]),
      n('Search',{placeholder:'搜索文件、作品或错误…'}),
      n('Table',{source:'run.drafts',selectable:true,columns:[
        {label:'文件',cells:[n('Text',{bind:'row.file.name',lines:2}),n('Details',{label:'文件详情与 AI 依据'},[
          text('完整文件名'),n('Text',{bind:'row.file.name'}),text('相对路径'),n('Text',{bind:'row.file.path'}),text('AI 依据'),n('Text',{bind:'row.reason'}),text('整理方案'),n('Text',{bind:'row.profile.name'}),n('Text',{bind:'row.profile.destination'})])]},
        {label:'AI 识别作品与季集',cells:[n('Text',{bind:'row.media.title'}),{...n('Text',{bind:'row.recognition.title'}),visibleWhen:{path:'row.media.title',op:'falsy'}},{...n('Stack',{},[{...n('Text',{text:'AI 识别 · 条目待匹配',tone:'warning'}),visibleWhen:{path:'row.recognition.title',op:'truthy'}}]),visibleWhen:{path:'row.tmdbId',op:'falsy'}},n('Stack',{direction:'row',gap:'sm'},[n('Text',{bind:'row.media.year',tone:'muted'}),{...n('Text',{bind:'row.recognition.year',tone:'muted'}),visibleWhen:{path:'row.media.year',op:'falsy'}},n('Text',{bind:'row.mediaType',format:'mediaType',tone:'muted'})]),n('Stack',{direction:'row',gap:'sm'},[{...text('TMDB'),visibleWhen:{path:'row.tmdbId',op:'truthy'}},{...n('Text',{bind:'row.tmdbId',tone:'muted'}),visibleWhen:{path:'row.tmdbId',op:'truthy'}},n('Text',{bind:'row.seasonEpisode'})])]},
        {label:'核验与整理状态',cells:[n('Status',{bind:'row.displayStatus'}),n('Text',{bind:'row.error',tone:'danger'}),n('Text',{bind:'row.reason',format:'defaultSeason',tone:'warning'})]},
        {label:'操作',cells:[{...n('Button',{label:'修正',action:'editDraft',variant:'outline'}),visibleWhen:{path:'row.canEdit',op:'truthy'}},{...n('Button',{label:'取消整理',action:'cancelTask',variant:'ghost'}),visibleWhen:{path:'row.canCancel',op:'truthy'}}]}
      ]}),n('Pagination'),n('SelectionBar'),n('RunLog')]),'ui.hasRun'),
    when(n('EmptyState',{title:'从选择一组视频开始',description:'识别结果会逐步出现在这里。待处理项可以修正；核验通过后仍需你确认。'}),'ui.hasRun','falsy')
  ]},
  {id:'history',label:'运行记录',content:[n('RunHistory')]},
  {id:'settings',label:'设置',content:[n('ConfigForm'),n('ScheduleForm')]}
]});
