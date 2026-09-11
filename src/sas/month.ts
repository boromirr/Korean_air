import type {BrowserContext,Page} from 'playwright';
import {searchSas,type SasQuery} from './search.js';
import {awardConcurrency} from '../cloud-runtime.js';
export const SAS_CONCURRENCY=awardConcurrency();
export async function searchSasMonth(context:BrowserContext,queries:SasQuery[],cancelled:()=>boolean,emit:(event:unknown)=>void) {
  let next=0,code:string|undefined,completed=0;
  const pages=new Set<Page>();
  const stopped=()=>cancelled()||Boolean(code);
  const cancellationTimer=setInterval(()=>{if(cancelled())for(const p of pages)void p.close().catch(()=>{});},200);
  try {
    await Promise.all(Array.from({length:Math.min(SAS_CONCURRENCY,queries.length)},async()=>{
      const page=await context.newPage();pages.add(page);
      try {
        while(!stopped() && next<queries.length){
          const query=queries[next++]!;
          emit({type:'searching',query});
          let result=await searchSas(page,query,stopped);
          // One fresh retry for a transient search failure; never retry login,
          // restrictions, or results that do not match the requested date.
          if(!stopped() && result.status==='failed' && ['SEARCH_FAILED','SEARCH_TIMEOUT'].includes(result.code||''))result=await searchSas(page,query,stopped);
          if(cancelled())return;
          if(result.status==='failed'){
            if(!code){code=result.code||'SEARCH_FAILED';emit({type:'result',query,result});}
            return;
          }
          // Preserve verified results that finish while another tab stops the run.
          completed++;emit({type:'result',query,result});
        }
      }catch{if(!code)code='BROWSER_ERROR';}
      finally{pages.delete(page);await page.close().catch(()=>{});}
    }));
    return {status:cancelled()?'cancelled':code?'failed':'complete',code,completed};
  }finally{clearInterval(cancellationTimer);await Promise.all([...pages].map(p=>p.close().catch(()=>{})));}
}
