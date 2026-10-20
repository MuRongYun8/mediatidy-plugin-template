/** MediaTidy SDK v1. Calls are synchronous JSON RPC inside the isolated worker. */
interface MTFile { ref: string; name: string; path: string; rootId: string; size: number; isDir: boolean; modifiedAt: string }
interface MTCandidate { id: number; title: string; originalTitle: string; year: string; mediaType: 'movie' | 'tv'; overview: string }
interface MTProposal { fileRef: string; profileId: number; tmdbId: number; mediaType: string; season?: number; episode?: number; reason: string; unsupported?: boolean }
interface MTProfile { id: number; name: string; destination: string; transferType: string; storageType: string; enabled: boolean }
interface MTTask { id: number; status: string; error?: string; total?: number; completed?: number; failed?: number }
interface MTInput { action: string; files: MTFile[]; input: Record<string, unknown>; config: Record<string, unknown>; sdkVersion: '1' }
interface MTQualitySummary { total: number; eligible: boolean }
interface MTSDK {
 quality: {
  evaluate(input:{fileRef:string;profileId:number}):MTQualitySummary;
  compare(input:{fileRef:string;otherRef:string;profileId:number}):{first:MTQualitySummary;second:MTQualitySummary;decision:'first'|'second'|'equivalent'};
 };
  files: {
    roots(): { id: string; name: string }[];
    list(input: { rootId: string; path: string; page: number }): { items: MTFile[]; hasMore: boolean };
    stat(input: { rootId: string; path: string }): MTFile;
  };
  ai: { complete(input: { system: string; input: string; schema?: Record<string, unknown> }): { content: unknown; usage: Record<string, number> } };
  tmdb: {
    search(input: { query: string; mediaType: string; year?: number }): MTCandidate[];
    detail(input: { id: number; mediaType: string }): MTCandidate;
    season(input: { id: number; season: number }): number[];
  };
  organize: { profiles(): MTProfile[]; prepare(input: MTProposal): unknown };
  tasks: { list(): MTTask[]; cancel(input: { id: number }): boolean };
  storage: { get(input: { key: string }): unknown; set(input: { key: string; value: unknown }): boolean; delete(input: { key: string }): boolean };
  config: { get(): Record<string, unknown> };
  notification: { send(input: { channelId: string; title: string; content: string }): boolean };
  strm: { run(input: { profileId: number }): MTTask };
  http: { request(input: { url: string; method?: string; body?: string; contentType?: string }): { status: number; body: string } };
  log(input: { level?: 'info' | 'warn' | 'error'; message: string }): boolean;
}
declare const mt: MTSDK;
declare const module: { exports: { run: (input: MTInput) => unknown } };
