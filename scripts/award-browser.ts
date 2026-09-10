import {createInterface} from 'node:readline';
import {resolve} from 'node:path';
import type {Page} from 'playwright';
import {openNativeChrome} from '../src/sas/native-chrome.js';
import {sasRestriction} from '../src/sas/status.js';
import {searchSky} from '../src/partners/skyteam.js';
import {searchStar} from '../src/partners/star-alliance.js';
import {searchAsiana} from '../src/partners/asiana.js';
const urls:Record<string,string>={'korean-air':'https://www.koreanair.com/booking/search?bookingType=A&tripType=OW','asiana-club':'https://flyasiana.com/I/KR/KO/MileageSeatSearch.do','star-alliance':'https://flyasiana.com/C/KR/KO/index','skyteam':'https://www.koreanair.com/booking/search?bookingType=S&tripType=RT'};
let native:Awaited<ReturnType<typeof openNativeChrome>>|null=null;const pages=new Map<string,Page>();let busy=false,generation=0;
async function ensure(program:string,navigate=true){
  if(!native){native=await openNativeChrome(resolve('data/partner-chrome-profile'),{keepRunning:true});native.context.on('close',()=>{native=null;pages.clear();generation++;});}
  let p=pages.get(program);if(!p||p.isClosed()){p=await native.context.newPage();pages.set(program,p);if(navigate)await p.goto(urls[program],{waitUntil:'domcontentloaded',timeout:45000});}return p;
}
async function state(program:string){const p=pages.get(program);if(!p||p.isClosed())return {state:'closed'};const body=await p.locator('body').innerText({timeout:2000});if(sasRestriction(body))return {state:'restricted'};if(/\/login|viewLogin/.test(p.url()))return {state:'login_required'};return {state:'ready'};}
async function run(c:any){
  if(!urls[c.program])return {status:'failed',code:'INVALID_QUERY'};
  if(c.action==='status')return state(c.program);
  if(c.action==='cancel'){generation++;return {state:'cancelled'};}
  if(busy)return {status:'failed',code:'BUSY'};busy=true;const initial=generation;
  try{const p=await ensure(c.program,c.action==='open');if(c.action==='open'){await p.bringToFront();return state(c.program);}if((await state(c.program)).state==='restricted')return {status:'failed',code:'ACCESS_RESTRICTED'};
    if(c.program==='asiana-club')return await searchAsiana(p,c.query,()=>generation!==initial);
    if(c.program==='skyteam')return await searchSky(p,c.query,()=>generation!==initial);
    if(c.program==='star-alliance')return await searchStar(p,c.query,()=>generation!==initial);
    return {status:'failed',code:'FORM_REQUIRED'};
  }finally{busy=false;}
}
const input=createInterface({input:process.stdin,crlfDelay:Infinity});input.on('line',line=>{let c:any;try{c=JSON.parse(line);if(typeof c.id!=='string'||line.length>8192)return;}catch{return;}void run(c).then(result=>process.stdout.write(JSON.stringify({id:c.id,result})+'\n')).catch(()=>process.stdout.write(JSON.stringify({id:c.id,result:{status:'failed',code:'BROWSER_ERROR'}})+'\n'));});input.on('close',()=>{if(native)void native.close().finally(()=>process.exit(0));else process.exit(0);});
