import type {Page} from 'playwright';
import {sasRestriction} from '../sas/status.js';
type Query={origin:string;destination:string;date:string;returnDate:string;cabin:string;direction:'outbound'|'inbound'};
const cabinCodes:Record<string,string>={economy:'Y',business:'C',first:'F'};
async function waitFlights(page:Page,cancelled:()=>boolean,origin:string){
  const deadline=Date.now()+45000;
  while(true){
    if(cancelled())throw new Error('CANCELLED');
    if(await page.locator(`button[aria-label*="출발시간"][aria-label*="출발지 ${origin}"]:visible`).count())return true;
    if(await page.getByText('항공편 운항 스케줄이 없거나 모든 좌석이 매진되었습니다.',{exact:true}).isVisible())return false;
    if(sasRestriction(await page.locator('body').innerText()))throw new Error('ACCESS_RESTRICTED');
    if(Date.now()>deadline)throw new Error('SEARCH_TIMEOUT');await page.waitForTimeout(300);
  }
}
async function chooseDate(page:Page,date:string){
  const [year,month,day]=date.split('-').map(Number),id=`month${year}${String(month).padStart(2,'0')}`;
  for(let i=0;i<7&&!await page.locator('#'+id).isVisible();i++)await page.getByRole('button',{name:'다음 2달',exact:true}).click();
  const cell=page.locator('#'+id+' .ui-datepicker__td').filter({has:page.locator('.ui-datepicker__td-date').filter({hasText:new RegExp('^'+day+'$')})});
  if(!await cell.isVisible()||(await cell.getAttribute('class'))?.includes('-disabled'))throw new Error('DATE_UNAVAILABLE');
  await cell.click();
}
export function parseSkyFlights(labels:string[],origin:string,destination:string,cabin:string){
  return labels.map(label=>{
    const departure=label.match(/출발시간\s+(\d{2}:\d{2}),\s*출발지\s+([A-Z]{3})/),arrival=label.match(/도착시간\s+(\d{2}:\d{2}),\s*도착지\s+([A-Z]{3})/);
    if(!departure||!arrival||departure[2]!==origin||arrival[2]!==destination)throw new Error('QUERY_MISMATCH');
    return {cabin,flightNumber:label.split(',')[0].trim(),departureTime:departure[1],arrivalTime:arrival[1],points:null,availableSeatCount:null};
  });
}
async function searchSkyClass(page:Page,q:Query,cancelled:()=>boolean){
  const targetOrigin=q.direction==='inbound'?q.destination:q.origin,targetDestination=q.direction==='inbound'?q.origin:q.destination;
  try{
    const flights=[];const classes=q.cabin==='all'?Object.keys(cabinCodes):[q.cabin];
    for(const cabin of classes){
      if(!cabinCodes[cabin]||q.date>=q.returnDate)throw new Error('INVALID_QUERY');
      if(cancelled())throw new Error('CANCELLED');
      await page.goto('https://www.koreanair.com/booking/search?bookingType=S&tripType=RT',{waitUntil:'domcontentloaded',timeout:45000});
      if(/\/login/.test(page.url()))throw new Error('LOGIN_REQUIRED');
      if(sasRestriction(await page.locator('body').innerText()))throw new Error('ACCESS_RESTRICTED');
      const cookies=page.getByRole('button',{name:'필수 쿠키만 허용',exact:true});if(await cookies.isVisible())await cookies.click();
      await page.locator('button:visible').filter({hasText:/^출발지\s/}).click();
      await page.getByPlaceholder('도시, 공항').fill('');await page.getByPlaceholder('도시, 공항').pressSequentially(q.origin,{delay:100});await page.getByRole('option').filter({hasText:q.origin}).click();
      await page.locator('button:visible').filter({hasText:/^(To\s*도착지|도착지\s)/}).click();
      await page.getByPlaceholder('도시, 공항').fill('');await page.getByPlaceholder('도시, 공항').pressSequentially(q.destination,{delay:100});await page.getByRole('option').filter({hasText:q.destination}).click();
      await page.locator('button:visible').filter({hasText:'출발일'}).click();
      await chooseDate(page,q.date);await chooseDate(page,q.returnDate);
      // The narrow layout keeps the calendar open until its explicit Select action.
      const selectDates=page.locator('[id^="dialog-calendar"] kds-button_1:visible').filter({hasText:/^\s*선택\s*$/});if(await selectDates.isVisible())await selectDates.click();
      await page.locator('kds-class_1').click();
      const radio=page.locator(`input[type="radio"][value="${cabinCodes[cabin]}"]`);
      const radioId=await radio.getAttribute('id');await page.locator(`label[for="${radioId}"]`).click();
      if(!await radio.isChecked())throw new Error('QUERY_MISMATCH');
      const selectClass=page.locator('#bookingSeatModal kds-button_1:visible').filter({hasText:/^\s*선택\s*$/});if(await selectClass.isVisible())await selectClass.click();
      const closeClass=page.getByRole('button',{name:'저장 및 닫기',exact:true});if(await closeClass.isVisible())await closeClass.click();
      await page.getByText('항공편 검색',{exact:true}).click();
      const deadline=Date.now()+45000;
      while(!page.url().includes('/booking/select-skyteam-award')){
        if(cancelled())throw new Error('CANCELLED');
        if(/\/login/.test(page.url()))throw new Error('LOGIN_REQUIRED');
        const notice=page.getByRole('dialog').filter({hasText:'스카이팀 보너스 일등석 안내'});
        if(await notice.isVisible())await notice.getByRole('button',{name:'확인',exact:true}).click();
        if(sasRestriction(await page.locator('body').innerText()))throw new Error('ACCESS_RESTRICTED');
        if(Date.now()>deadline)throw new Error('SEARCH_TIMEOUT');await page.waitForTimeout(300);
      }
      const buttons=page.locator('button[aria-label*="출발시간"]:visible');
      const hasOutbound=await waitFlights(page,cancelled,q.origin);
      const resultText=await page.locator('body').innerText();
      for(const date of [q.date,q.returnDate]){
        const [year,month,day]=date.split('-').map(Number);
        if(!new RegExp(`${year}년\\s*0?${month}월\\s*0?${day}일`).test(resultText))throw new Error('QUERY_MISMATCH');
      }
      if(!hasOutbound){if(q.direction==='inbound')throw new Error('REFERENCE_UNAVAILABLE');continue;}
      const outLabels=await buttons.evaluateAll(xs=>xs.map(x=>x.getAttribute('aria-label')||''));
      parseSkyFlights(outLabels,q.origin,q.destination,cabin);
      let referenceFlight:string|undefined;
      if(q.direction==='inbound'){
        referenceFlight=outLabels[0].split(',')[0].trim();await buttons.first().click();
        if(!await waitFlights(page,cancelled,q.destination))continue;
      }
      const labels=await buttons.evaluateAll(xs=>xs.map(x=>x.getAttribute('aria-label')||''));
      flights.push(...parseSkyFlights(labels,targetOrigin,targetDestination,cabin).map(f=>({...f,referenceFlight})));
    }
    return {origin:targetOrigin,destination:targetDestination,date:q.direction==='inbound'?q.returnDate:q.date,status:flights.length?'available':'empty',cabins:[...new Set(flights.map(f=>f.cabin))],flights,referenceDate:q.direction==='inbound'?q.date:q.returnDate,observedAt:new Date().toISOString()};
  }catch(e){if(/\/login/.test(page.url()))return {status:'failed',code:'LOGIN_REQUIRED'};if(process.env.AWARD_DEBUG==='1')console.error(e);const code=e instanceof Error?e.message:'';if(code==='REFERENCE_UNAVAILABLE')return {origin:targetOrigin,destination:targetDestination,date:q.returnDate,status:'partial',cabins:[],flights:[],referenceDate:q.date,observedAt:new Date().toISOString(),code};return {status:'failed',code:/^[A-Z_]+$/.test(code)?code:'SEARCH_FAILED'};}
}
export async function searchSky(page:Page,q:Query,cancelled:()=>boolean){
  if(q.cabin!=='all')return searchSkyClass(page,q,cancelled);
  const flights:any[]=[],checkedCabins:string[]=[];let last:any,partialCode:string|undefined;
  for(const cabin of Object.keys(cabinCodes)){
    const r=await searchSkyClass(page,{...q,cabin},cancelled);
    if(r.status==='failed'){
      if(!flights.length)return r;
      return {...last,status:'partial',flights,cabins:[...new Set(flights.map(f=>f.cabin))],checkedCabins,code:r.code};
    }
    last=r;if(r.status==='partial'){partialCode=r.code;continue;}flights.push(...r.flights!);checkedCabins.push(cabin);
  }
  return {...last,status:partialCode?'partial':flights.length?'available':'empty',code:partialCode,flights,cabins:[...new Set(flights.map(f=>f.cabin))],checkedCabins};
}
