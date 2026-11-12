import {api} from './api.js';
import {page} from './page.js';
export default {
  async fetch(request,env) {
    const path=new URL(request.url).pathname;
    const origin=request.headers.get('Origin');
    const cors=origin==='https://thi-mee.github.io'?{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'GET,POST,DELETE,OPTIONS','Access-Control-Allow-Headers':'Content-Type,X-API-Key,Idempotency-Key','Access-Control-Expose-Headers':'Retry-After','Vary':'Origin'}:{};
    if(request.method==='OPTIONS' && origin==='https://thi-mee.github.io') return new Response(null,{status:204,headers:cors});
    const headers={...cors,'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY'};
    let response;
    if(path==='/' && request.method==='GET') response=new Response(page,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"}});
    else response=await api(request,env);
    const secured=new Response(response.body,response);
    for(const [key,value] of Object.entries(headers)) secured.headers.set(key,value);
    return secured;
  }
};
