/** Local browser worker. Login stays in Chrome's local, ignored profile. */
import { type BrowserContext, type Page } from 'playwright';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {sasSessionState,prepareSasSession,sasStateError} from '../src/sas/session.js';
import { openNativeChrome } from '../src/sas/native-chrome.js';
import {searchSasMonth} from '../src/sas/month.js';
import { searchSas, type SasQuery } from '../src/sas/search.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LOGIN_URL = 'https://www.flysas.com/en/eurobonus/points/use/partner-award-flights/';
let native: Awaited<ReturnType<typeof openNativeChrome>> | null = null;
let context: BrowserContext | null = null;
let page: Page | null = null;
let active = false;
let monthActive = false;
let monthTask:ReturnType<typeof searchSasMonth>|null=null;
let generation = 0;
let opening: Promise<void> | null = null;
function output(id: string, result: unknown) { process.stdout.write(JSON.stringify({id,result})+'\n'); }

async function ensureBrowser() {
  if(context && page && !page.isClosed()) return;
  if(opening) return opening;
  opening = (async()=>{
    native = await openNativeChrome(resolve(root,'data/sas-chrome-profile'),{keepRunning:true});
    context = native.context;
    context.on('close',()=>{context=null;page=null;generation++;});
    page=context.pages().find(p=>/^https:\/\/([^/]+\.)?flysas\.com\//.test(p.url())) || await context.newPage();
    if(page.url()==='about:blank')await page.goto(LOGIN_URL,{waitUntil:'domcontentloaded',timeout:45000});
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
  return sasSessionState(p);
}
async function execute(command: {id:string,action:string, query?:unknown}) {
  if(command.action==='status') return monthActive?{state:'searching'}:state();
  if(command.action==='cancel') {
    generation++;
    return {state:'cancelled'};
  }
  if(command.action==='close') {
    generation++; await monthTask?.catch(()=>{});await native?.close();native=null;context=null;page=null;return {state:'closed'};
  }
  if(active) return {status:'failed',code:'BUSY'};
  if(command.action==='confirm-login') {
    active=true;
    try {await ensureBrowser();const p=await findPage();return p?await prepareSasSession(p):{state:'closed'};}finally{active=false;}
  }
  if(command.action==='open') {
    active=true;
    try {await ensureBrowser();await page?.bringToFront();return await state();}
    finally {active=false;}
  }
  if(command.action==='search-month') {
    const queries=command.query as SasQuery[];
    if(!Array.isArray(queries)||!queries.length||queries.length>31||queries.some(q=>!q||!/^[A-Z]{3}$/.test(q.origin)||!/^[A-Z]{3}$/.test(q.destination)||q.origin===q.destination||!/^\d{4}-\d{2}-\d{2}$/.test(q.date)))return {status:'failed',code:'INVALID_QUERY'};
    active=true;const initial=generation;
    try {
      await ensureBrowser();const p=await findPage();
      const status=p?await prepareSasSession(p):{state:'closed'};
      if(status.state!=='ready')return {status:'failed',code:sasStateError(status.state)};
      monthActive=true;
      monthTask=searchSasMonth(context!,queries,()=>generation!==initial,event=>process.stdout.write(JSON.stringify({id:command.id,event})+'\n'));
      return await monthTask;
    }finally{active=false;monthActive=false;monthTask=null;}
  }
  if(command.action!=='search') return {status:'failed',code:'INVALID_QUERY'};
  const query=command.query as {origin?:string,destination?:string,date?:string};
  if(!query || !/^[A-Z]{3}$/.test(query.origin || '') || !/^[A-Z]{3}$/.test(query.destination || '') || query.origin===query.destination || !/^\d{4}-\d{2}-\d{2}$/.test(query.date || '')) return {status:'failed',code:'INVALID_QUERY'};
  active=true;
  const currentGeneration=generation;
  try {
    await ensureBrowser();
    const p0=await findPage();
    const status=p0?await prepareSasSession(p0):{state:'closed'};
    if(status.state!=='ready') return {status:'failed',code:sasStateError(status.state)};
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
input.on('close',()=>{generation++;void (async()=>{await monthTask?.catch(()=>{});await native?.close();process.exit(0);})();});
