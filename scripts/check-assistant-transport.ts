// Test du lot 4 : transport des quatre fournisseurs (fournisseurs SIMULÉS, aucun appel réel). Lancer : npx tsx scripts/check-assistant-transport.ts
import { sanitizeQuestion } from '../src/assistant/pseudonymizer';
import { maskCard } from '../src/assistant/result-mask';
import { EMPTY_CONTEXT } from '../src/assistant/tool-plan';
import { buildPlanPrompt, buildAnswerPrompt, buildRequest, callModelJson, parseJsonObject, ModelError } from '../src/assistant/model-transport';
let ok=0,ko=0; const t=(n:string,c:boolean)=>{c?ok++:(ko++,console.log('ECHEC',n))};
const E=[{id:'55555555-5555-4555-8555-555555555555',firstName:'Paul',lastName:'Mabiala'},{id:'33333333-3333-4333-8333-333333333333',firstName:'Jean',lastName:'Ngoma'}];
const KEY='sk-SECRET-KEY-123';
const cfg=(p:any)=>({provider:p,model:'m-1.2',key:KEY});
const s:any=sanitizeQuestion('Pourquoi le salaire de Paul Mabiala a change en mars 2026 ?',E);
t('sanitize',s.ok);
const plan=buildPlanPrompt({outbound:s.outbound,bindings:s.bindings,employees:E,context:EMPTY_CONTEXT});
const wire=(p:string,text:string,extra:any={})=>p==='anthropic'?{content:[{type:'text',text}],stop_reason:'end_turn',...extra}:p==='google'?{candidates:[{content:{parts:[{text}]},finishReason:'STOP',...extra}]}:{choices:[{message:{content:text},finish_reason:'stop',...extra}]};
const resp=(b:any,status=200)=>new Response(JSON.stringify(b),{status});
const good='{"action":"call_tool","tool":"explain_employee_pay","employee":"E1","period":{"kind":"month","month":3,"year":2026}}';
(async()=>{
for(const p of ['openai','anthropic','google','mistral']){
  let seen:any; const f:any=async(url:string,init:any)=>{seen={url,init};return resp(wire(p,good));};
  const out=await callModelJson(plan,{config:cfg(p),fetcher:f});
  t(p+' parse',out.action==='call_tool'&&out.employee==='E1');
  const raw=seen.url+JSON.stringify(seen.init.headers)+seen.init.body;
  t(p+' hôte',new URL(seen.url).host===({openai:'api.openai.com',anthropic:'api.anthropic.com',google:'generativelanguage.googleapis.com',mistral:'api.mistral.ai'} as any)[p]);
  t(p+' clé hors URL/corps',!seen.url.includes(KEY)&&!seen.init.body.includes(KEY)&&JSON.stringify(seen.init.headers).includes(KEY));
  for(const secret of ['Paul','Mabiala','paul','mabiala',E[0].id,'Ngoma','Konza']) t(p+' sans '+secret,!seen.init.body.includes(secret)&&!seen.url.includes(secret));
  t(p+' redirect error',seen.init.redirect==='error'&&seen.init.method==='POST');
  const b=JSON.parse(seen.init.body);
  if(p==='openai') t('openai champs',b.max_completion_tokens===400&&b.store===false&&b.response_format.type==='json_object'&&/JSON/.test(b.messages[0].content)&&!('max_tokens' in b));
  if(p==='mistral') t('mistral champs',b.max_tokens===400&&b.response_format.type==='json_object'&&/JSON/.test(b.messages[0].content)&&!('store' in b));
  if(p==='google') t('google champs',b.generationConfig.maxOutputTokens===400&&b.generationConfig.responseMimeType==='application/json'&&!!b.systemInstruction&&!seen.url.includes('key='));
  if(p==='anthropic') t('anthropic champs',b.max_tokens===400&&!!b.system&&!('tool_choice' in b)&&!('tools' in b)&&seen.init.headers['anthropic-version']==='2023-06-01');
  // troncature / sortie invalide
  const trunc=p==='anthropic'?{stop_reason:'max_tokens'}:p==='google'?{finishReason:'MAX_TOKENS'}:{finish_reason:'length'};
  const code=async(fn:()=>Promise<any>)=>{try{await fn();return 'ok'}catch(e:any){return e instanceof ModelError?e.code:'other'}};
  t(p+' tronqué',await code(()=>callModelJson(plan,{config:cfg(p),fetcher:(async()=>resp(wire(p,good,trunc)))as any}))==='truncated');
  t(p+' prose',await code(()=>callModelJson(plan,{config:cfg(p),fetcher:(async()=>resp(wire(p,'Bien sûr ! '+good)))as any}))==='invalid_output');
  t(p+' tableau',await code(()=>callModelJson(plan,{config:cfg(p),fetcher:(async()=>resp(wire(p,'[1]')))as any}))==='invalid_output');
  t(p+' vide',await code(()=>callModelJson(plan,{config:cfg(p),fetcher:(async()=>resp(wire(p,'')))as any}))==='invalid_output');
  t(p+' 500 sans fuite',await (async()=>{try{await callModelJson(plan,{config:cfg(p),fetcher:(async()=>new Response('{"error":"LEAK-BODY '+KEY+'"}',{status:500}))as any});return false}catch(e:any){return e.code==='unavailable'&&!e.message.includes('LEAK')&&!e.message.includes(KEY)}})());
  t(p+' réseau',await code(()=>callModelJson(plan,{config:cfg(p),fetcher:(async()=>{throw new Error('ECONNRESET')})as any}))==='unavailable');
  t(p+' trop gros',await code(()=>callModelJson(plan,{config:cfg(p),fetcher:(async()=>new Response('x'.repeat(70000),{status:200}))as any}))==='too_large');
}
t('fences',JSON.stringify(parseJsonObject('```json\n{"a":1}\n```'))==='{"a":1}');
// annulation et délai
const hang:any=(_u:string,init:any)=>new Promise((_,rej)=>init.signal.addEventListener('abort',()=>rej(new Error('abort'))));
const ac=new AbortController(); setTimeout(()=>ac.abort(),30);
let c:any; try{await callModelJson(plan,{config:cfg('openai'),fetcher:hang,signal:ac.signal})}catch(e:any){c=e.code} t('annulé',c==='aborted');
try{await callModelJson(plan,{config:cfg('openai'),fetcher:hang,timeoutMs:40})}catch(e:any){c=e.code} t('timeout',c==='timeout');
const pre=new AbortController(); pre.abort(); try{await callModelJson(plan,{config:cfg('openai'),fetcher:hang,signal:pre.signal})}catch(e:any){c=e.code} t('déjà annulé',c==='aborted');
try{await callModelJson(plan,{config:null})}catch(e:any){c=e.code} t('non configuré',c==='unconfigured');
// garde de sortie
try{buildPlanPrompt({outbound:'salaire de Paul Mabiala',bindings:new Map(),employees:E,context:EMPTY_CONTEXT});c='ok'}catch(e:any){c=e.code} t('plan avec nom refusé',c==='unsafe_input');
try{buildPlanPrompt({outbound:'salaire de E1',bindings:new Map(),employees:E,context:EMPTY_CONTEXT});c='ok'}catch(e:any){c=e.code} t('repère inconnu refusé',c==='unsafe_input');
const card:any={title:'x',period:'novembre 2026',source:'s',metrics:[{label:'Brut de la période',value:12500000,unit:'FCFA'},{label:'Écart brut',value:830000,unit:'FCFA'},{label:'Mois utilisés',value:3}],rows:[{employeeId:E[0].id,label:'Employé 1',detail:'Brut 987654 FCFA',value:456789,unit:'FCFA'}],departments:[{name:'Logistique',initial:10,hires:2,departures:1,final:11}]};
const mk:any=maskCard('top_paid_employees',card,12,s.bindings);
const ans=buildAnswerPrompt({outbound:s.outbound,view:mk.view,bindings:mk.bindings,employees:E});
t('vue sans valeurs',!/12500000|830000|987654|456789|Logistique|novembre/.test(ans.user)&&ans.system.includes('AUCUN chiffre'));
const dirty={...mk.view,metrics:[{...mk.view.metrics[0],label:'brut 12500'}]};
try{buildAnswerPrompt({outbound:s.outbound,view:dirty as any,bindings:mk.bindings,employees:E});c='ok'}catch(e:any){c=e.code} t('vue avec chiffre refusée',c==='unsafe_input');
const dirty2={...mk.view,rows:[{ref:'E1',rank:1,markers:['12500']}]};
try{buildAnswerPrompt({outbound:s.outbound,view:dirty2 as any,bindings:mk.bindings,employees:E});c='ok'}catch(e:any){c=e.code} t('marqueur chiffré refusé',c==='unsafe_input');
// réponse bout en bout simulée
const r=await callModelJson(ans,{config:cfg('anthropic'),fetcher:(async()=>resp(wire('anthropic','{"text":"Pour [[period]], E1 a [[E1.valeur]]."}')))as any}); t('réponse',r.text==='Pour [[period]], E1 a [[E1.valeur]].');
console.log('OK',ok,'KO',ko); process.exit(ko?1:0);
})();