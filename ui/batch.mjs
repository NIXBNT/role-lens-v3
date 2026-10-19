export const MAX_BATCH_FILES=20;

// Sequential processing bounds API usage and preserves earlier successes.
export async function processBatch(files,{process,onState=()=>{},onComplete=()=>{}}){
 if(!files.length||files.length>MAX_BATCH_FILES)throw Error(`Select 1–${MAX_BATCH_FILES} files per batch.`);
 const results=[];
 for(const [index,file] of files.entries()){
  onState({index,file,status:'processing'});
  let result;
  try{result={index,file,status:'success',value:await process(file,index)};}
  catch(error){result={index,file,status:'error',error:error.message||String(error)};}
  results.push(result);onState(result);onComplete(result);
 }
 return results;
}

export function createNotificationLog(storage,{key='role-lens-v3-notifications',limit=100}={}){
 let items=[];
 try{const saved=JSON.parse(storage?.getItem(key)||'[]');if(Array.isArray(saved))items=saved.filter(n=>n&&typeof n.id==='string'&&typeof n.message==='string'&&typeof n.read==='boolean'&&['success','error'].includes(n.status)&&typeof n.createdAt==='string').slice(0,limit);}catch{}
 const save=()=>{try{storage?.setItem(key,JSON.stringify(items));}catch{ /* Browser storage may be disabled; notifications still work in memory. */ }};
 return {
  list:()=>items.map(n=>({...n})),
  add({message,status}){const n={id:crypto.randomUUID(),message,status,read:false,createdAt:new Date().toISOString()};items.unshift(n);items=items.slice(0,limit);save();return n;},
  markRead(){items=items.map(n=>({...n,read:true}));save();},
  clear(){items=[];save();}
 };
}
