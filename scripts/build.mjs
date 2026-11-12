import {readFileSync,writeFileSync,mkdirSync,rmSync,cpSync} from 'node:fs';
rmSync('dist',{recursive:true,force:true});mkdirSync('dist/server',{recursive:true});mkdirSync('dist/.openai',{recursive:true});
const api=readFileSync('worker/api.js','utf8').replace('export async function api','async function api');
const page=readFileSync('worker/page.js','utf8').replace('export const page','const page');
const worker=readFileSync('worker/index.js','utf8').replace(/^import .*;\n/gm,'');
writeFileSync('dist/server/index.js',api+'\n'+page+'\n'+worker);
cpSync('.openai/hosting.json','dist/.openai/hosting.json');
console.log('Built Worker and embedded booking page');

mkdirSync('docs',{recursive:true});
const {page:html}=await import('../worker/page.js');
writeFileSync('docs/index.html',html);writeFileSync('docs/.nojekyll','');
