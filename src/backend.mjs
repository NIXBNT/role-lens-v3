import {generateRubric,evaluateResume,rank} from './inference.mjs';
const json=(d,status=200)=>new Response(JSON.stringify(d),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
const models={questions:'gpt-5.6-sol',reasoning:'low',classification:'gpt-6-luna'};
const method='Weighted average of Decisions scores / 3, scaled to 100. Evidence coverage, not hiring probability.';
export function validateDocument(d){
 if(!d||typeof d.filename!=='string'||d.filename.length>250||!/\.(pdf|md|docx)$/i.test(d.filename)||!Array.isArray(d.sections)||!d.sections.length||d.sections.length>1000)throw Error('Upload a readable PDF, Markdown or DOCX document.');
 if(d.sections.some(s=>typeof s.location!=='string'||s.location.length>100||typeof s.text!=='string'))throw Error('Invalid extracted document.');
 const text=d.sections.map(s=>`[${s.location}]\n${s.text}`).join('\n\n');
 if(text.trim().length<50||text.length>120000)throw Error('Document must contain 50–120,000 characters of readable text.');
 return {filename:d.filename,sections:d.sections,text};
}
export function createBackend({requestOverride}={}){
 const object=async(env,key,fallback)=>await env.store.get(key)??fallback;
 const put=(env,key,data)=>env.store.put(key,data);
 async function list(env,prefix){return Promise.all((await env.store.list(prefix)).map(key=>env.store.get(key)));}
 async function job(env,id){return object(env,`jobs/${id}.json`);}
 async function candidates(env,id){return (await list(env,`candidates/${id}/`)).filter(c=>!c.deleted);}
 async function request(env,endpoint,body){
  if(requestOverride)return requestOverride(endpoint,body);
  if(!env.OPENAI_API_KEY)throw Error('Set OPENAI_API_KEY in your local .env file and restart the app.');
  const r=await fetch(`https://api.openai.com/v1/${endpoint}`,{method:'POST',headers:{Authorization:`Bearer ${env.OPENAI_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(180000)});const data=await r.json();
  if(!r.ok)throw Error(`OpenAI ${endpoint}: ${data.error?.message||`HTTP ${r.status}`}`);return data;
 }
 return async function api(req,env){
  try{
   if(!env.store)throw Error('Persistent storage is not configured.');
   const url=new URL(req.url);const segments=url.pathname.split('/').filter(Boolean);const [,resource,id,child,cid,action]=segments;
   if(req.method!=='GET'&&req.headers.get('Origin')&&req.headers.get('Origin')!==url.origin)return json({error:'Origin rejected.'},403);
   if(resource!=='jobs')return json({error:'Not found'},404);
   if(req.method==='GET'&&!id){const records=await list(env,'jobs/');const jobs=await Promise.all(records.filter(j=>!j.deleted).map(async j=>{const cs=rank(await candidates(env,j.id),j.criteria);return {id:j.id,title:j.title,company:j.company,createdAt:j.createdAt,sourceUrl:j.sourceUrl,criterionCount:j.criteria.length,candidateCount:cs.length,top:cs[0]?{label:cs[0].label,score:cs[0].score}:null};}));return json({jobs});}
   if(req.method==='POST'&&!id){
    if(Number(req.headers.get('Content-Length')||0)>1000000)throw Error('Upload text is too large.');
    const body=await req.json();const role=validateDocument(body.document);const policy=await generateRubric(role,(e,b)=>request(env,e,b));
    const j={id:crypto.randomUUID(),title:String(body.title||policy.title).slice(0,200),company:String(body.company||'Uploaded position').slice(0,150),role,criteria:policy.criteria,models,method,createdAt:new Date().toISOString(),sourceUrl:null};await put(env,`jobs/${j.id}.json`,j);return json({...j,candidates:[]},201);
   }
   const j=await job(env,id);if(!j)return json({error:'Position not found'},404);
   if(req.method==='POST'&&child==='restore'){await put(env,`jobs/${id}.json`,{...j,deleted:false});return json({restored:true});}
   if(j.deleted)return json({error:'Position has been removed'},404);
   if(req.method==='GET'&&!child)return json({...j,candidates:rank(await candidates(env,id),j.criteria)});
   if(req.method==='DELETE'&&!child){await put(env,`jobs/${id}.json`,{...j,deleted:true});return json({removed:true});}
   if(child==='candidates'&&req.method==='POST'&&!cid){
    const body=await req.json();const resume=validateDocument(body.document);const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(resume.text)))).map(n=>n.toString(16).padStart(2,'0')).join('');
    const duplicate=(await candidates(env,id)).find(c=>c.fingerprint===hash||c.filename===resume.filename);if(duplicate)return json({error:'This CV is already in the position. Remove the existing version before replacing it.'},409);
    const candidate=await evaluateResume(resume,j.criteria,(e,b)=>request(env,e,b),{label:typeof body.label==='string'&&body.label.trim()?body.label.trim().slice(0,150):null});
    if((await job(env,id)).deleted)return json({error:'Position was removed while this CV was evaluated. No candidate was added.'},409);
    candidate.fingerprint=hash;candidate.createdAt=new Date().toISOString();await put(env,`candidates/${id}/${candidate.id}.json`,candidate);return json(rank([candidate],j.criteria)[0],201);
   }
   if(child==='candidates'&&cid){const c=await object(env,`candidates/${id}/${cid}.json`);if(!c)return json({error:'Candidate not found'},404);
    if(req.method==='DELETE'&&!action){await put(env,`candidates/${id}/${cid}.json`,{...c,deleted:true});return json({removed:true});}
    if(req.method==='POST'&&action==='restore'){await put(env,`candidates/${id}/${cid}.json`,{...c,deleted:false});return json({restored:true});}
   }
   return json({error:'Not found'},404);
  }catch(e){return json({error:e.message},400);}
 };
}
