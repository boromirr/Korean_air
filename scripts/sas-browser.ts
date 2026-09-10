/** Local browser worker. Login stays in Chrome's local, ignored profile. */
import { type BrowserContext, type Page } from 'playwright';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { sasRestriction } from '../src/sas/status.js';
import { openNativeChrome } from '../src/sas/native-chrome.js';
import { searchSas, type SasQuery } from '../src/sas/search.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LOGIN_URL = 'https://www.flysas.com/en/eurobonus/points/use/partner-award-flights/';
let native: Awaited<ReturnType<typeof openNativeChrome>> | null = null;
let context: BrowserContext | null = null;
let page: Page | null = null;
let active = false;
let generation = 0;
let opening: Promise<void> | null = null;
function output(id: string, result: unknown) { process.stdout.write(JSON.stringify({id,result})+'\n'); }

async function ensureBrowser() {
  if(context && page && !page.isClosed()) return;
  if(opening) return opening;
  opening = (async()=>{
    native = await openNativeChrome(resolve(root,'data/sas-chrome-profile'));
    context = native.context;
    context.on('close',()=>{context=null;page=null;generation++;});
    page=context.pages()[0] || await context.newPage();
    await page.goto(LOGIN_URL,{waitUntil:'domcontentloaded',timeout:45000});
  })();
  try {await opening;} finally {opening=null;}
}
async function findPage() {
  if(!context) return null;
  const pages=context.pages().filter(p=>!p.isClosed());
  // Login may return in a new tab. Never attach to another Chrome profile.
  page=pages.find(p=>/^https:\/\/www\.flysas\.com\/en\/booking\/award\//.test(p.url())) || pages.find(p=>p===page) || pages[0] || null;
  return page;
}
async function state() {
  const p=await findPage();
  if(!p) return {state:'closed'};
  try {
    const body=await p.locator('body').innerText({timeout:2000});
    const restriction=sasRestriction(body);
    if(restriction) return {state:restriction};
    if(p.url().includes('/en/booking/award/') && await p.getByRole('button',{name:'Edit search',exact:true}).isVisible()) return {state:'ready'};
    if(await p.locator('input[placeholder="From"]').count() && await p.locator('input[placeholder="To"]').count() && await p.locator('#one-way').count()) return {state:'ready'};
    if(new URL(p.url()).hostname==='auth.flysas.com' || await p.getByRole('button',{name:/^(login|log in|sign in)$/i}).first().isVisible()) return {state:'login_required'};
    if(p.url().includes('partner-award-flights') && await p.getByRole('button',{name:'Search',exact:true}).isVisible()) return {state:'ready'};
    return {state:'form_required'};
  } catch {return {state:'loading'};}
}
async function execute(command: {action:string, query?:unknown}) {
  if(command.action==='status') return state();
  if(command.action==='cancel') {
    generation++;
    return {state:'cancelled'};
  }
  if(command.action==='close') {
    generation++; await native?.close();native=null;context=null;page=null;return {state:'closed'};
  }
  if(active) return {status:'failed',code:'BUSY'};
  if(command.action==='open') {
    active=true;
    try {await ensureBrowser();await page?.bringToFront();return await state();}
    finally {active=false;}
  }
  if(command.action!=='search') return {status:'failed',code:'INVALID_QUERY'};
  const query=command.query as {origin?:string,destination?:string,date?:string};
  if(!query || !/^[A-Z]{3}$/.test(query.origin || '') || !/^[A-Z]{3}$/.test(query.destination || '') || query.origin===query.destination || !/^\d{4}-\d{2}-\d{2}$/.test(query.date || '')) return {status:'failed',code:'INVALID_QUERY'};
  active=true;
  const currentGeneration=generation;
  try {
    await ensureBrowser();
    const status=await state();
    if(status.state!=='ready') return {status:'failed',code:['action_required','restricted'].includes(status.state)?'ACCESS_RESTRICTED':'LOGIN_REQUIRED'};
    const p=page!;
    const result=await searchSas(p,query as SasQuery,()=>generation!==currentGeneration);
    if(generation!==currentGeneration) return {status:'failed',code:'CANCELLED'};
    return result;
  } finally {active=false;}
}
const input=createInterface({input:process.stdin,crlfDelay:Infinity});
input.on('line',line=>{
  if(Buffer.byteLength(line)>8192) return;
  let value: {id:string,action:string,query?:unknown};
  try {value=JSON.parse(line);if(typeof value.id!=='string' || value.id.length>100 || typeof value.action!=='string')return;}
  catch{return;}
  void execute(value).then(result=>output(value.id,result)).catch(()=>output(value.id,{status:'failed',code:'BROWSER_ERROR'}));
});
input.on('close',()=>{if(native)void native.close().finally(()=>process.exit(0));else process.exit(0);});
