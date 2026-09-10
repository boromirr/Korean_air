import type {BrowserContext,Page} from 'playwright';
import {searchStar} from './star-alliance.js';
import {searchSky} from './skyteam.js';
type Query=Parameters<typeof searchSky>[1];
export async function searchPartnerMonth(context:BrowserContext,program:string,queries:Query[],cancelled:()=>boolean,emit:(event:unknown)=>void){
  let next=0,code:string|undefined,completed=0;
  const pages=new Set<Page>(),stopped=()=>cancelled()||Boolean(code);
  const cancellationTimer=setInterval(()=>{if(cancelled())for(const p of pages)void p.close().catch(()=>{});},200);
  try{
    await Promise.all(Array.from({length:Math.min(6,queries.length)},async()=>{
      const page=await context.newPage();pages.add(page);
      try{
        while(!stopped()&&next<queries.length){
          const q=queries[next++]!;
          const query={origin:program==='skyteam'&&q.direction==='inbound'?q.destination:q.origin,destination:program==='skyteam'&&q.direction==='inbound'?q.origin:q.destination,date:program==='skyteam'&&q.direction==='inbound'?q.returnDate:q.date};
          emit({type:'searching',query});
          const search=()=>program==='skyteam'?searchSky(page,q,stopped):searchStar(page,q,stopped);
          let result=await search();
          if(!stopped()&&result.status==='failed'&&['SEARCH_FAILED','SEARCH_TIMEOUT'].includes(result.code||''))result=await search();
          if(cancelled())return;
          if(result.status==='failed'||(result.status==='partial'&&result.code!=='REFERENCE_UNAVAILABLE')){
            if(!code){code=result.code||'SEARCH_FAILED';emit({type:'result',query,result});}return;
          }
          completed++;emit({type:'result',query,result});
        }
      }catch{if(!code)code='BROWSER_ERROR';}
      finally{pages.delete(page);await page.close().catch(()=>{});}
    }));
    return {status:cancelled()?'cancelled':code?'failed':'complete',code,completed};
  }finally{clearInterval(cancellationTimer);await Promise.all([...pages].map(p=>p.close().catch(()=>{})));}
}
