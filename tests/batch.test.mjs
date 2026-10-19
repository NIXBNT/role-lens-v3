import test from 'node:test';
import assert from 'node:assert/strict';
import {processBatch,createNotificationLog} from '../ui/batch.mjs';

for(const kind of ['position','candidate'])test(`${kind} batch processes every file, preserves successes and reports individual failures`,async()=>{
 const files=['first.md','broken.pdf','last.docx'].map(name=>({name}));const events=[],notices=[];let active=0;
 const results=await processBatch(files,{
  process:async file=>{assert.equal(active++,0);await Promise.resolve();active--;if(file.name==='broken.pdf')throw Error('Unreadable PDF');return {id:file.name};},
  onState:r=>events.push([r.file.name,r.status]),onComplete:r=>notices.push([r.file.name,r.status])
 });
 assert.deepEqual(results.map(r=>r.status),['success','error','success']);assert.equal(results[2].value.id,'last.docx');
 assert.deepEqual(events,files.flatMap((f,i)=>[[f.name,'processing'],[f.name,i===1?'error':'success']]));
 assert.deepEqual(notices,[['first.md','success'],['broken.pdf','error'],['last.docx','success']]);
});
test('batch rejects empty or over-limit selections before processing',async()=>{let calls=0;for(const files of [[],Array(21).fill({name:'x'})])await assert.rejects(processBatch(files,{process:()=>{calls++;}}),/1–20/);assert.equal(calls,0);});
test('notification history survives reload, tracks unread state and is bounded and clearable',()=>{
 const values=new Map();const storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)};
 const log=createNotificationLog(storage,{limit:2});log.add({message:'First finished',status:'success'});log.add({message:'Second failed',status:'error'});log.add({message:'Third finished',status:'success'});
 const reopened=createNotificationLog(storage,{limit:2});assert.deepEqual(reopened.list().map(n=>n.message),['Third finished','Second failed']);assert.ok(reopened.list().every(n=>!n.read));
 reopened.markRead();assert.ok(createNotificationLog(storage,{limit:2}).list().every(n=>n.read));reopened.clear();assert.deepEqual(createNotificationLog(storage).list(),[]);
});
test('notifications work in memory when browser storage is blocked or corrupt',()=>{
 const broken={getItem(){throw Error('Disabled');},setItem(){throw Error('Disabled');}};
 const log=createNotificationLog(broken);log.add({message:'Finished',status:'success'});assert.equal(log.list().length,1);
 const corrupt=createNotificationLog({getItem:()=>'{broken'});assert.deepEqual(corrupt.list(),[]);
});
