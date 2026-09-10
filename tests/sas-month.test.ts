import {it,expect,vi,beforeEach} from 'vitest';
import type {BrowserContext,Page} from 'playwright';
vi.mock('../src/sas/search.js',()=>({searchSas:vi.fn()}));
import {searchSas} from '../src/sas/search.js';
import {searchSasMonth,SAS_CONCURRENCY} from '../src/sas/month.js';
const queries=Array.from({length:31},(_,i)=>({origin:'ICN',destination:'NRT',date:'2027-05-'+String(i+1).padStart(2,'0')}));
function context(){const pages: Array<{close:ReturnType<typeof vi.fn>}>=[];return {pages,context:{newPage:async()=>{const p={close:vi.fn(async()=>{})};pages.push(p);return p as unknown as Page;}} as unknown as BrowserContext};}
beforeEach(()=>vi.resetAllMocks());
it('streams 31 verified dates through at most six tabs and closes only those tabs',async()=>{
  const c=context();let active=0,peak=0;const events:any[]=[];
  vi.mocked(searchSas).mockImplementation(async(_p,q)=>{
    active++;peak=Math.max(peak,active);await new Promise(resolve=>setTimeout(resolve,2));active--;
    return {...q,status:'empty',flights:[],complete:true,observedAt:new Date().toISOString(),source:'SAS_EUROBONUS_VISIBLE_RESULTS',freshSearch:true,adults:1,tripType:'ONE_WAY'};
  });
  const result=await searchSasMonth(c.context,queries,()=>false,e=>events.push(e));
  expect(result.status).toBe('complete');expect(result.completed).toBe(31);
  expect(peak).toBe(SAS_CONCURRENCY);expect(c.pages).toHaveLength(SAS_CONCURRENCY);
  expect(events.filter(e=>e.type==='result').map(e=>e.query.date).sort()).toEqual(queries.map(q=>q.date));
  for(const p of c.pages)expect(p.close).toHaveBeenCalledOnce();
});
it('stops launching dates on a restriction; never retries it or fabricates empty dates',async()=>{
  const c=context();const events:any[]=[];
  vi.mocked(searchSas).mockResolvedValue({status:'failed',code:'ACCESS_RESTRICTED'});
  const result=await searchSasMonth(c.context,queries,()=>false,e=>events.push(e));
  expect(result.status).toBe('failed');expect(result.code).toBe('ACCESS_RESTRICTED');expect(result.completed).toBe(0);
  expect(vi.mocked(searchSas).mock.calls.length).toBeLessThanOrEqual(SAS_CONCURRENCY);
  expect(events.filter(e=>e.type==='result')).toHaveLength(1);
  for(const p of c.pages)expect(p.close).toHaveBeenCalledOnce();
});
it('cancellation stops new dates and closes the temporary tabs',async()=>{
  const c=context();let cancel=false;
  vi.mocked(searchSas).mockImplementation(async()=>{cancel=true;return {status:'failed',code:'CANCELLED'};});
  const result=await searchSasMonth(c.context,queries,()=>cancel,()=>{});
  expect(result.status).toBe('cancelled');expect(result.completed).toBe(0);
  expect(vi.mocked(searchSas).mock.calls.length).toBeLessThanOrEqual(SAS_CONCURRENCY);
  for(const p of c.pages)expect(p.close).toHaveBeenCalledOnce();
});
it('recovers one transient failure with a new search before reporting the date',async()=>{
  const c=context(),events:any[]=[];
  vi.mocked(searchSas).mockResolvedValueOnce({status:'failed',code:'SEARCH_FAILED'}).mockResolvedValueOnce({...queries[0]!,status:'empty',flights:[],complete:true,observedAt:new Date().toISOString(),source:'SAS_EUROBONUS_VISIBLE_RESULTS',freshSearch:true,adults:1,tripType:'ONE_WAY'});
  const result=await searchSasMonth(c.context,[queries[0]!],()=>false,e=>events.push(e));
  expect(result.status).toBe('complete');expect(searchSas).toHaveBeenCalledTimes(2);
  expect(events.filter(e=>e.type==='result')).toHaveLength(1);
  expect(events.find(e=>e.type==='result').result.status).toBe('empty');
});
