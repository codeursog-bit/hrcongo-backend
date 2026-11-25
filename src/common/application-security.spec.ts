import {readFileSync} from 'fs';
import {resolve} from 'path';
import {runInNewContext} from 'vm';
import {GUARDS_METADATA} from '@nestjs/common/constants';
import {BonusTemplatesController} from '../bonus-templates/bonus-templates.controller';
import {RolesGuard} from '../auth/guards/roles.guard';
describe('Protections transversales',()=>{
 it('ne met jamais les pages privées en cache, même hors ligne',async()=>{
  const events:any={},put=jest.fn(),cache={match:jest.fn(),put},fetcher=jest.fn().mockRejectedValue(new Error('offline'));
  runInNewContext(readFileSync(resolve(__dirname,'../../../frontend/public/sw.js'),'utf8'),{self:{location:{origin:'https://app.test'},addEventListener:(name:string,fn:any)=>events[name]=fn,skipWaiting:jest.fn()},caches:{open:async()=>cache},fetch:fetcher,URL,Response});
  let response:any;events.fetch({request:{method:'GET',url:'https://app.test/paie/secret',mode:'navigate'},respondWith:(value:any)=>response=value});
  expect((await response).status).toBe(503);expect(put).not.toHaveBeenCalled();
 });
 it('protège l’import des primes par le guard de rôles',()=>{expect(Reflect.getMetadata(GUARDS_METADATA,BonusTemplatesController.prototype.importPresets)).toContain(RolesGuard)});
});
