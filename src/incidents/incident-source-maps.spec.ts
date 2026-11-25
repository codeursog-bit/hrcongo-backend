import { mkdtemp, mkdir, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { decodeIncidentStack } from './incident-source-maps';
describe('Source maps privées',()=>{
  let root:string;const previous=process.env.INCIDENTS_SOURCE_MAPS_DIR;
  beforeAll(async()=>{root=await mkdtemp(join(tmpdir(),'konza-incident-maps-'));process.env.INCIDENTS_SOURCE_MAPS_DIR=root;await mkdir(join(root,'build-test','_next','static'),{recursive:true});await writeFile(join(root,'build-test','_next','static','app.js.map'),JSON.stringify({version:3,sources:['components/Employee.tsx'],names:[],mappings:'AAAA',sourcesContent:['SECRET_SOURCE_NEVER_RETURNED']}))});
  afterAll(async()=>{if(previous===undefined)delete process.env.INCIDENTS_SOURCE_MAPS_DIR;else process.env.INCIDENTS_SOURCE_MAPS_DIR=previous;await rm(root,{recursive:true,force:true})});
  const stack='Error: failed\n    at render (https://app.test/_next/static/app.js:1:1)';
  it('décode une archive locale sans exposer son contenu',async()=>{const result=await decodeIncidentStack(stack,'build-test');expect(result).toContain('components/Employee.tsx:1:1');expect(result).not.toContain('SECRET_SOURCE')});
  it('garde la pile originale si la version manque ou tente une traversée',async()=>{for(const version of ['../build-test','missing',null])expect(await decodeIncidentStack(stack,version)).toBe(stack)});
  it('ne suit pas le chemin fourni hors de l’archive',async()=>{const bad='Error: failed\n    at render (https://evil.test/%2e%2e%2fsecret.js:1:1)';expect(await decodeIncidentStack(bad,'build-test')).toBe(bad)});
});
