import http from 'node:http';
import {Readable} from 'node:stream';
import {database} from '../test/database.js';
import worker from '../worker/index.js';
import {existsSync} from 'node:fs';
const db=database('local.sqlite',!existsSync('local.sqlite'));
const env={DB:db,API_KEY:process.env.API_KEY||'local-demo-key'};
const server=http.createServer(async(req,res)=>{try{const request=new Request('http://127.0.0.1:5173'+req.url,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:Readable.toWeb(req),duplex:'half'}:{})});const response=await worker.fetch(request,env);res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));}catch{res.writeHead(500);res.end('server error');}});
server.listen(5173,'127.0.0.1',()=>console.log('Local: http://127.0.0.1:5173'));
