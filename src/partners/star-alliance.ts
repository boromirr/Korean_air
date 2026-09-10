import type {Page} from 'playwright';
import {sasRestriction} from '../sas/status.js';
export async function searchStar(page:Page,q:{origin:string;destination:string;date:string},cancelled:()=>boolean){
  try {
    const reuse=page.url().includes('RedemptionInternationalMultiCityFlightsSelect') && await page.locator('#tbl_area1').isVisible() && await page.locator('#departureAirport1').inputValue()===q.origin && await page.locator('#arrivalAirport1').inputValue()===q.destination;
    if(!reuse){
    await page.goto('https://flyasiana.com/I/KR/KO/RedemptionStarAllianceRegistTravel.do',{waitUntil:'domcontentloaded',timeout:45000});
    if(/viewLogin|\/index/.test(page.url()))throw new Error('LOGIN_REQUIRED');
    if(sasRestriction(await page.locator('body').innerText()))throw new Error('ACCESS_RESTRICTED');
    for(const [field,code] of [['Departure',q.origin],['Arrival',q.destination]]){
      await page.locator('a#txt'+field+'Airport1').click();
      await page.locator('#txtStarAirport').fill(code);await page.locator('#txtStarAirport').press('Enter');
      await page.locator(`li[airport="${code}"]:visible a`).click();
    }
    }
    if(cancelled())throw new Error('CANCELLED');
    const oldNotice=page.locator('#notice3');if(await oldNotice.isVisible())await oldNotice.getByRole('button',{name:'취소',exact:true}).click();
    if(!await page.locator('.ui-datepicker-title:visible').count())await page.locator(reuse?'#calendar_focus1':'#sCalendar1').click();
    const target=new Date(q.date+'T12:00:00Z');
    for(let i=0;i<14;i++){
      const text=await page.locator('.ui-datepicker-title:visible').first().innerText();const match=text.match(/(20\d{2})\.\s*(\d+)/);if(!match)throw new Error('DATE_UNAVAILABLE');
      const delta=(target.getUTCFullYear()-Number(match[1]))*12+target.getUTCMonth()+1-Number(match[2]);if(delta===0||delta===1)break;
      await page.getByRole('link',{name:delta>0?'다음달':'이전달',exact:true}).click();
    }
    await page.locator(`td[data-year="${target.getUTCFullYear()}"][data-month="${target.getUTCMonth()}"] a[data-date="${target.getUTCDate()}"]`).click();
    if(!reuse)await page.getByRole('link',{name:'전체',exact:true}).click();
    if(await page.locator('#departureAirport1').inputValue()!==q.origin||await page.locator('#arrivalAirport1').inputValue()!==q.destination||await page.locator('#departureDate1').inputValue()!==q.date.replace(/-/g,''))throw new Error('QUERY_MISMATCH');
    let notice='';const handler=async(d:any)=>{notice=d.message();await d.dismiss().catch(()=>{});};page.on('dialog',handler);
    try{
      let fresh=false;
      const received=(response:any)=>{if(response.url().includes('RedemptionInternationalMultiCityAvailFlight.do') && response.status()===200)fresh=true;};
      page.on('response',received);
      try{
      await page.getByRole('button',{name:reuse?'여정변경':'항공권 조회',exact:true}).click();
      const deadline=Date.now()+90000;
      while(!fresh || !await page.locator('#tbl_area1').isVisible() || (reuse && !(await page.locator('[name=departureDate]').allTextContents()).some(t=>t.includes(q.date.replace(/-/g,'.'))))){
        if(cancelled())throw new Error('CANCELLED');
        if(sasRestriction(await page.locator('body').innerText()))throw new Error('ACCESS_RESTRICTED');
        if(notice)throw new Error('SEARCH_FAILED');
        const confirmChange=page.locator('#notice3').getByRole('button',{name:'확인',exact:true});if(await confirmChange.isVisible())await confirmChange.click();
        const proceed=page.getByRole('button',{name:'예매 진행',exact:true});if(await proceed.isVisible())await proceed.click();
        if(Date.now()>deadline)throw new Error('SEARCH_TIMEOUT');await page.waitForTimeout(500);
      }
      }finally{page.off('response',received);}
    }finally{page.off('dialog',handler);}
    if(!(await page.locator('[name=departureDate]').first().innerText()).includes(q.date.replace(/-/g,'.')))throw new Error('QUERY_MISMATCH');
    const raw=await page.locator('#tbl_area1 tr.flight').evaluateAll(rows=>rows.map(row=>({time:[...row.querySelectorAll('.flight_time .time')].map(e=>e.textContent?.trim()),fares:[...row.querySelectorAll('td')].map(td=>({class:td.className,seats:(td as HTMLElement).innerText,info:td.querySelector('input[flightinfodatas]')?.getAttribute('flightinfodatas')}))})));
    if(!raw.length)throw new Error('UNRECOGNIZED_RESULT');
    const flights=[];
    for(const row of raw)for(const fare of row.fares){
      const match=fare.seats.trim().match(/^(\d+)석$/);if(!match)throw new Error('UNRECOGNIZED_RESULT');if(Number(match[1])===0)continue;
      const segments=JSON.parse(fare.info||'[]');if(!segments.length||segments[0].departureAirport!==q.origin||segments.at(-1).arrivalAirport!==q.destination||!segments[0].departureDate.startsWith(q.date.replace(/-/g,'')))throw new Error('QUERY_MISMATCH');
      const cabin=fare.class.includes('economy')?'economy':fare.class.includes('business')?'business':fare.class.includes('first')?'first':null;if(!cabin)throw new Error('UNRECOGNIZED_RESULT');
      flights.push({cabin,departureTime:row.time[0],arrivalTime:row.time.at(-1),flightNumber:segments.map((s:any)=>s.carrierCode+s.flightNo).join(' / '),points:null,availableSeatCount:Number(match[1])});
    }
    return {...q,status:flights.length?'available':'empty',cabins:[...new Set(flights.map(f=>f.cabin))],flights,observedAt:new Date().toISOString()};
  }catch(e){if(process.env.AWARD_DEBUG==='1')console.error(e);const code=e instanceof Error?e.message:'';return {status:'failed',code:/^[A-Z_]+$/.test(code)?code:'SEARCH_FAILED'};}
}
