import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createBackend} from './src/backend.mjs';
import {FileStore} from './src/store.mjs';
const ROOT=fileURLToPath(new URL('./',import.meta.url));
const BODY_LIMIT=2*1024*1024;
const assets={'/':['index.html','text/html; charset=utf-8'],'/app.js':['app.js','text/javascript'],'/style.css':['style.css','text/css'],'/pdf-worker.mjs':['pdf-worker.mjs','text/javascript']};

export async function createLocalServer({dataDirectory=process.env.DATA_DIR||path.join(ROOT,'.data'),apiKey=process.env.OPENAI_API_KEY,requestOverride}={}) {
  const store=new FileStore(dataDirectory);await store.init();
  const seed=JSON.parse(await fs.readFile(path.join(ROOT,'seed.json'),'utf8'));
  const api=createBackend(seed,{requestOverride});
  const env={store,OPENAI_API_KEY:apiKey};
  const server=http.createServer(async(req,res)=>{
    const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
    try {
      const port=server.address().port;
      const host=req.headers.host;
      if(![`127.0.0.1:${port}`,`localhost:${port}`].includes(host))return send(403,{error:'Local requests only. Use the localhost URL printed by the server.'});
      const origin=`http://${host}`;
      if(req.headers.origin&&req.headers.origin!==origin)return send(403,{error:'Origin rejected.'});
      const url=new URL(req.url,origin);
      if(url.pathname==='/api/health'&&req.method==='GET')return send(200,{status:'ok',version:3,apiKeyConfigured:Boolean(apiKey)});
      if(url.pathname.startsWith('/api/')) {
        if(!['GET','POST','DELETE'].includes(req.method))return send(405,{error:'Method not allowed.'});
        if(req.method==='POST'&&req.headers['content-type']?.split(';')[0].trim()!=='application/json')return send(415,{error:'Send JSON uploads with Content-Type application/json.'});
        if(Number(req.headers['content-length']||0)>BODY_LIMIT)return send(413,{error:'Request exceeds the 2 MB extracted-text limit.'});
        let size=0;const chunks=[];
        for await(const chunk of req) { size+=chunk.length;if(size>BODY_LIMIT){send(413,{error:'Request exceeds the 2 MB extracted-text limit.'});return;}chunks.push(chunk); }
        const request=new Request(url,{method:req.method,headers:req.headers,body:req.method==='GET'?undefined:Buffer.concat(chunks)});
        const response=await api(request,env);
        res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return;
      }
      if(req.method!=='GET')return send(405,{error:'Method not allowed.'});
      const asset=assets[url.pathname];if(!asset)return send(404,{error:'Not found.'});
      let content;try{content=await fs.readFile(path.join(ROOT,'dist',asset[0]));}catch(error){if(error.code==='ENOENT')return send(503,{error:'Browser assets are missing. Run npm run build, then restart.'});throw error;}
      res.writeHead(200,{'Content-Type':asset[1],'X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin','Cache-Control':'no-store'});res.end(content);
    } catch(error) { if(!res.headersSent)send(500,{error:'The local server could not complete this request. Check the terminal for details.'});else res.destroy();console.error(error.message); }
  });
  return server;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const port=Number(process.env.PORT||4183);
  if(!Number.isInteger(port)||port<1||port>65535)throw Error('PORT must be an integer from 1 to 65535.');
  const server=await createLocalServer();
  server.on('error',error=>{console.error(error.code==='EADDRINUSE'?`Port ${port} is in use. Set PORT to a different port.`:error.message);process.exitCode=1;});
  server.listen(port,'127.0.0.1',()=>{
    console.log(`Role Lens v3: http://127.0.0.1:${port}`);
    console.log(process.env.OPENAI_API_KEY?'Live inference is configured.':'Demo results are available. Set OPENAI_API_KEY in .env to evaluate new uploads.');
  });
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>process.exit(0)));
}
