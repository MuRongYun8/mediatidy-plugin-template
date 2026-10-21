/// <reference path="../../sdk/index.d.ts" />
export interface Item {
  version:2;file:MTFile;flowKey:string;profileId:number;
  title:string;year:number|null;mediaType:'movie'|'tv'|'unknown';tmdbId:number|null;
  season:number|null;episode:number|null;reason:string;warning:string;sources:string;
  status:string;error:string;retryable:boolean;submissionKey?:string;taskRef?:string;
}
export interface Flow {
  version:2;key:string;refs:string[];profileId:number;instructions:string;
  scanRunId:string;scanTasks:string[];organizeRunId:string;taskRefs:string[];
}
