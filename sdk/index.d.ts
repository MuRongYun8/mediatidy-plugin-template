/** MediaTidy SDK v2. JSON-only synchronous calls in the isolated Goja worker. */
type MTJSON = null | boolean | number | string | MTJSON[] | { [key:string]: MTJSON };
interface MTError { code:string; message:string; retryable:boolean }
interface MTSelection { rootId:string; path:string }
interface MTRoot { id:string; name:string; storageType:'local'|'cloud'; read:boolean; write:boolean; delete:boolean }
interface MTFile extends MTSelection { ref:string; version:string; name:string; size:number; isDir:boolean; modifiedAt:string }
interface MTTask { ref:string; runId:string; kind:string; status:'submitting'|'queued'|'running'|'waiting'|'done'|'failed'|'cancelled'|'interrupted'|'outcome_unknown'; total:number; completed:number; failed:number; error?:MTError; result?:MTJSON; updatedAt:string }
interface MTTaskItem {index:number;status:string;file?:MTFile;quality?:MTQualitySummary;data?:MTJSON;error?:MTError}
interface MTPage<T> {items:T[];nextCursor?:string}
interface MTOffsetPage<T> {items:T[];nextOffset:number}
interface MTRunRequest {action:string;selections?:MTSelection[];input?:Record<string,MTJSON>}
interface MTCompletionEvent {subscriptionId?:string;source?:{kind:string;profileId:number;status:string;total:number;completed:number;failed:number};id:string;instanceId:string;parentRunId:string;childRunId?:string;tasks:MTTask[]}
interface MTInput {action:string;files:MTFile[];input:Record<string,MTJSON>;config:Record<string,MTJSON>;sdkVersion:'2';event?:MTCompletionEvent|null}
interface MTProgress {completed:number;total?:number;message:string}
interface MTCapability {method:string;permission:string;granted:boolean;perRunLimit:number;calls:number}
interface MTRuntime {sdkVersion:'2';instanceId:string;runId:string;action:string;pluginVersion:string;scheduleId:string;parentRunId:string;limits:Record<string,number>}
interface MTResources {roots:MTRoot[];organizeProfileIds:number[];strmProfileIds:number[];notificationChannelIds:string[];http:MTHTTPGrant[]}
interface MTHTTPGrant {url:string;methods:string[];allowPrivate?:boolean}
interface MTStorageEntry {key:string;found:boolean;value?:MTJSON;bytes:number;revision?:string;updatedAt?:string;expiresAt?:string|null}
interface MTStorageWrite {key:string;value:MTJSON;expectedRevision?:string;expiresAt?:string}
type MTStorageOperation = {operation:'get';key:string} | ({operation:'set'} & MTStorageWrite) | {operation:'delete';key:string;expectedRevision?:string};
interface MTStorageUsage {bytes:number;keys:number;quotaBytes:number;quotaKeys:number;valueLimit:number;batchLimit:number}
interface MTFileMutation {operation:'writeText'|'mkdir'|'copy'|'move'|'rename'|'delete';fileRef?:string;destination?:MTSelection;name?:string;text?:string;overwrite?:boolean;recursive?:boolean}
interface MTMutation extends Omit<MTFileMutation,'operation'> {idempotencyKey:string}
interface MTScan extends MTSelection {query?:string;videoOnly?:boolean;limit?:number;idempotencyKey:string}
interface MTDirectory {ref:string;name:string;rootId?:string;path?:string;readable:boolean;writable:boolean;deletable:boolean}
interface MTProfile {id:number;name:string;kind:'organize'|'strm';revision:string;enabled:boolean;source:MTDirectory;destination:MTDirectory;settings:Record<string,MTJSON>;groupProfileIds?:number[]}
interface MTRule {id:string;name:string;family:string;revision:string;enabled:boolean;definition:MTJSON}
interface MTSystemConfig {revision:string;version:string;videoExtensions:string[];metadataExtensions:string[];tmdbLanguage:string;aiEnabled:boolean;aiModel:string;webSearchEnabled:boolean;proxyEnabled:boolean}
interface MTMediaIdentity {title:string;year:number;mediaType:string;seasons:number[];episodes:number[];tmdbId?:number;status:'parsed'|'matched'|'unmatched';aiUsed:boolean}
interface MTCandidate {id:number;title:string;originalTitle:string;year:string;mediaType:'movie'|'tv';overview:string}
interface MTProposal {fileRef:string;profileId:number;tmdbId:number;mediaType:'movie'|'tv';season?:number;episode?:number;reason:string;unsupported?:boolean;recognition?:{title:string;originalTitle?:string;year?:number;sources?:string}}
interface MTDraft extends MTProposal {id:string;revision:string;file:MTFile;media?:MTCandidate;status:string;error?:string;taskRef?:string}
interface MTProfileRun {profileId:number;idempotencyKey:string}
/** Direct single-file execution using the caller's identity; no recognition or draft confirmation. */
interface MTManualOrganize {fileRef:string;profileId:number;tmdbId:number;mediaType:'movie'|'tv';season?:number;episode?:number;idempotencyKey:string}
interface MTQualitySummary {total:number;eligible:boolean;completeness:string;reason:string}
interface MTQualityComparison {first:MTQualitySummary;second:MTQualitySummary;decision:'first'|'second'|'equivalent'|'incomplete'}
interface MTQualityInput {fileRef:string;profileId:number}
interface MTSchedule {id:string;key:string;name:string;kind:'cron'|'once';cron:string;timezone:string;at?:string;enabled:boolean;revision:string;request:MTRunRequest;nextRun?:string}
type MTScheduleCreate = Omit<MTSchedule,'id'|'key'|'revision'|'nextRun'>;
interface MTToolCall {id:string;name:string;arguments:string}
interface MTMessage {role:'system'|'user'|'assistant'|'tool';content?:string;toolCallId?:string;toolCalls?:MTToolCall[]}
interface MTTool {name:string;description:string;parameters:Record<string,MTJSON>}
interface MTAvailability {available:boolean;reason:'available'|'disabled'|'not_configured'|'not_granted'|'unavailable'}
interface MTUsage {input_tokens?:number;output_tokens?:number;total_tokens?:number}
interface MTMetrics {modelRequests:number;nativeWebRequests:number;compatibilityRetries:number;usageIncomplete?:boolean;usage?:MTUsage}
interface MTHTTPInput {url:string;method?:string;body?:string;contentType?:string;headers?:Record<string,string>;responseHeaders?:string[];timeoutMs?:number}

interface MTBusinessRecord {ref:string;profileId:number;kind:string;status:string;fileName?:string;title?:string;year?:string;tmdbId?:number;mediaType?:string;season?:number;episode?:number;total?:number;completed?:number;failed?:number;reason?:string;createdAt:string}

interface MTEventSubscription {id:string;instanceId:string;name:string;kind:"organize"|"strm";profileId:number;enabled:boolean;revision:string;lastError?:string;request:MTRunRequest}

interface MTSDK {
  ai: {
    capabilities(): {chat:MTAvailability;webSearch:MTAvailability;tmdb:MTAvailability};
    chat(input: {messages:MTMessage[];tools?:MTTool[];fileRefs?:string[]}): {message:MTMessage;usage:MTUsage;toolsUnavailable?:boolean;metrics:MTMetrics};
    complete(input: {system:string;input:string;schema?:Record<string,MTJSON>}): {content:MTJSON;usage:MTUsage};
    web: {
      search(input: {query:string}): {items:{title:string;summary:string;url:string}[];usage:MTUsage;metrics:MTMetrics};
    };
  };
  config: {
    get(): Record<string,MTJSON>;
  };
  files: {
    batch(input: {idempotencyKey:string;items:MTFileMutation[]}): MTTask;
    copy(input: MTMutation): MTTask;
    delete(input: MTMutation): MTTask;
    list(input: MTSelection & {page:number}): {items:MTFile[];hasMore:boolean};
    mkdir(input: MTMutation): MTTask;
    move(input: MTMutation): MTTask;
    readText(input: {ref:string}): {text:string;version:string};
    rename(input: MTMutation): MTTask;
    roots(): MTRoot[];
    scan(input: MTScan): MTTask;
    search(input: MTScan): MTTask;
    stat(input: MTSelection): MTFile;
    writeText(input: MTMutation): MTTask;
  };
  http: {
    request(input: MTHTTPInput): {status:number;headers:Record<string,string>;body:string};
  };
  log(input: {level?:'info'|'warn'|'error';message:string}): boolean;
  media: {
    parse(input: {name:string}): MTMediaIdentity;
    recognize(input: {fileRef:string}): MTMediaIdentity;
  };
  notification: {
    send(input: {channelId:string;title:string;content:string}): boolean;
  };
  organize: {
    manual: {
      prepare(input: MTProposal): MTDraft | {items:MTDraft[]};
      prepareBatch(input: {items:MTProposal[]}): {items:MTDraft[]};
      run(input: MTManualOrganize): MTTask;
    };
    profile(input: {id:number}): MTProfile;
    profiles(): MTProfile[];
    run(input: MTProfileRun): MTTask;
  };
  quality: {
    compare(input: MTQualityInput & {otherRef:string}): MTQualityComparison;
    evaluate(input: MTQualityInput): MTQualitySummary;
    evaluateBatch(input: {fileRefs:string[];profileId:number}): {items:{fileRef:string;summary?:MTQualitySummary;error?:MTError}[];interrupted:boolean};
    prepare(input: {fileRefs:string[];profileId:number;idempotencyKey:string}): MTTask;
    upgrade(input: MTQualityInput & {otherRef:string}): {comparison:MTQualityComparison;shouldUpgrade:boolean};
  };
  records: {
    list(input: {kind:'organize'|'failure'|'strm';profileId:number;cursor?:string;limit?:number}): MTPage<MTBusinessRecord>;
  };
  rules: {
    effective(input: {profileId:number;mediaType?:'movie'|'tv';categoryPath?:string;categoryRuleKey?:string}): {profile:MTProfile;rules:MTRule[];selection:{namingRuleId:string;qualityRuleId:string;routedRuleId:string};revision:string};
    get(input: {id:string;family?:string}): MTRule;
    list(input: {family?:string;offset?:number;limit?:number}): MTOffsetPage<MTRule>;
  };
  runtime: {
    capabilities(): MTCapability[];
    checkpoint(): boolean;
    info(): MTRuntime;
    progress(input: MTProgress): boolean;
    resources(): MTResources;
    result(input: {value:MTJSON}): boolean;
  };
  secrets: {
    get(input: {key:string}): {value:string};
  };
  storage: {
    batch(input: {operations:MTStorageOperation[]}): MTStorageEntry[];
    delete(input: {key:string;expectedRevision?:string}): MTStorageEntry;
    get(input: {key:string;expectedRevision?:string}): MTStorageEntry;
    list(input: {prefix?:string;cursor?:string;limit?:number;values?:boolean}): MTPage<MTStorageEntry>;
    set(input: MTStorageWrite): MTStorageEntry;
    usage(): MTStorageUsage;
  };
  strm: {
    cleanup(input: MTProfileRun): MTTask;
    preview(input: MTProfileRun): MTTask;
    profile(input: {id:number}): MTProfile;
    profiles(): MTProfile[];
    run(input: MTProfileRun): MTTask;
    verify(input: MTProfileRun): MTTask;
  };
  system: {
    config(): MTSystemConfig;
    info(): {version:string;sdkVersion:'2'};
  };
  tasks: {
    cancel(input: {ref:string}): boolean;
    get(input: {ref:string}): MTTask;
    items(input: {ref:string;offset?:number;limit?:number}): MTOffsetPage<MTTaskItem>;
    list(input: {cursor?:string;limit?:number}): MTPage<MTTask>;
    wait(input: {refs:string[];completion?:MTRunRequest}): {waiting:boolean};
  };
  tmdb: {
    detail(input: {id:number;mediaType:'movie'|'tv'}): MTCandidate;
    search(input: {query:string;mediaType:'movie'|'tv';year?:number}): MTCandidate[];
    season(input: {id:number;season:number}): number[];
  };
  triggers: {
    events: {
      create(input: Omit<MTEventSubscription,'id'|'instanceId'|'revision'>): MTEventSubscription;
      delete(input: {id:string}): boolean;
      list(): MTEventSubscription[];
      pause(input: {id:string}): MTEventSubscription;
      update(input: MTEventSubscription): MTEventSubscription;
    };
    schedules: {
      create(input: MTScheduleCreate): MTSchedule;
      delete(input: {id:string}): boolean;
      list(): MTSchedule[];
      pause(input: {id:string}): MTSchedule;
      update(input: MTSchedule): MTSchedule;
    };
  };
}
declare const mt: MTSDK;
declare const module: {exports:{run:(input:MTInput)=>MTJSON | object}};
