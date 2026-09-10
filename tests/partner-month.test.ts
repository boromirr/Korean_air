import {it,expect,vi,beforeEach} from 'vitest';
import type {BrowserContext} from 'playwright';
vi.mock('../src/partners/star-alliance.js',()=>({searchStar:vi.fn()}));
vi.mock('../src/partners/skyteam.js',()=>({searchSky:vi.fn()}));
import {searchStar} from '../src/partners/star-alliance.js';
import {searchSky} from '../src/partners/skyteam.js';
import {searchPartnerMonth} from '../src/partners/month.js';
const makeContext=()=>({newPage:async()=>({close:async()=>{}})}) as unknown as BrowserContext;
beforeEach(()=>vi.resetAllMocks());
it('Star Alliance streams a full month without inter-day sleeps',async()=>{
  let active=0,peak=0;const events:any[]=[];
  vi.mocked(searchStar).mockImplementation(async(_p,q)=>{active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,1));active--;return {...q,status:'empty',cabins:[],flights:[],observedAt:new Date().toISOString()};});
  const queries=Array.from({length:31},(_,i)=>({origin:'ICN',destination:'NRT',date:'2027-05-'+String(i+1).padStart(2,'0'),cabin:'all',direction:'outbound' as const,returnDate:''}));
  const result=await searchPartnerMonth(makeContext(),'star-alliance',queries,()=>false,e=>events.push(e));
  expect(result.status).toBe('complete');expect(result.completed).toBe(31);expect(peak).toBe(6);
  expect(events.filter(e=>e.type==='result')).toHaveLength(31);
});
it('SkyTeam inbound progress uses the returning route and date while retaining its outbound reference',async()=>{
  const q={origin:'ICN',destination:'NRT',date:'2027-05-01',returnDate:'2027-05-15',cabin:'business',direction:'inbound' as const};
  vi.mocked(searchSky).mockResolvedValue({origin:'NRT',destination:'ICN',date:q.returnDate,status:'empty',cabins:[],flights:[],referenceDate:q.date,observedAt:new Date().toISOString()});
  const events:any[]=[];
  const result=await searchPartnerMonth(makeContext(),'skyteam',[q],()=>false,e=>events.push(e));
  expect(result.status).toBe('complete');expect(events[1].query).toEqual({origin:'NRT',destination:'ICN',date:'2027-05-15'});
  expect(vi.mocked(searchSky).mock.calls[0][1]).toEqual(q);
  expect(events[1].result.referenceDate).toBe('2027-05-01');
});
it('does not retry a login failure or security restriction',async()=>{
  vi.mocked(searchStar).mockResolvedValue({status:'failed',code:'LOGIN_REQUIRED'});
  const result=await searchPartnerMonth(makeContext(),'star-alliance',[{origin:'ICN',destination:'NRT',date:'2027-05-01',cabin:'all',returnDate:'',direction:'outbound'}],()=>false,()=>{});
  expect(result.code).toBe('LOGIN_REQUIRED');expect(searchStar).toHaveBeenCalledOnce();
});
