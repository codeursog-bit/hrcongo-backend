import { readFile, realpath, stat } from 'fs/promises';
import { resolve, relative, isAbsolute } from 'path';
import { TraceMap, originalPositionFor } from '@jridgewell/trace-mapping';
import { safeIncidentStack } from './incident-privacy';

/** Local private archives only: no fetching URLs, no source contents returned. */
export async function decodeIncidentStack(stack:string|undefined,version:string|null):Promise<string|undefined>{
  const root=process.env.INCIDENTS_SOURCE_MAPS_DIR;
  if(!root||!stack||!version||! /^[a-zA-Z0-9._-]{1,100}$/.test(version)||version==='.'||version==='..')return stack;
  const inside=(base:string,file:string)=>{const rel=relative(base,file);return rel!==''&&!rel.startsWith('..')&&!isAbsolute(rel)};
  try {
    const base=await realpath(resolve(root));
    const release=await realpath(resolve(base,version));
    if(!inside(base,release))return stack;
    const lines=await Promise.all(stack.split('\n').slice(0,30).map(async line=>{
      const frame=line.match(/\(([^()]+):(\d+):(\d+)\)$/);if(!frame)return line;
      try {
        const url=new URL(frame[1],'https://local.invalid');
        const filename=decodeURIComponent(url.pathname).replace(/^\//,'');
        if(!filename.endsWith('.js')||filename.includes('\\'))return line;
        const candidate=resolve(release,filename+'.map');if(!inside(release,candidate))return line;
        const actual=await realpath(candidate);if(!inside(release,actual))return line;
        if((await stat(actual)).size>8*1024*1024)return line;
        const position=originalPositionFor(new TraceMap(JSON.parse(await readFile(actual,'utf8'))),{line:Number(frame[2]),column:Math.max(0,Number(frame[3])-1)});
        if(!position.source||!position.line)return line;
        const source=position.source.replace(/^webpack:\/\/[^/]*\//,'').replace(/^\.\//,'');
        if(!/^[\w./@()\[\] -]+\.(?:tsx?|jsx?|mjs|cjs)$/.test(source)||source.includes('..'))return line;
        return line.replace(frame[0],`(${source}:${position.line}:${(position.column??0)+1})`);
      } catch{return line;}
    }));
    return safeIncidentStack(lines.join('\n'));
  }catch{return stack;}
}
