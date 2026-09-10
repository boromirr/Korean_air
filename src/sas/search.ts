import type { Page } from 'playwright';
import { parseSasRow } from './parser.js';
import { sasRestriction } from './status.js';
export interface SasQuery {origin:string;destination:string;date:string}
async function check(page:Page,cancelled:()=>boolean) {
  if(cancelled())throw new Error('CANCELLED');
  const decline=page.getByRole('dialog').getByRole('button',{name:'Decline',exact:true});
  if(await decline.isVisible())await decline.click();
  const restriction=sasRestriction(await page.locator('body').innerText({timeout:3000}));
  if(restriction)throw new Error('ACCESS_RESTRICTED');
  if(new URL(page.url()).hostname==='auth.flysas.com')throw new Error('LOGIN_REQUIRED');
}
async function airport(page:Page,name:string,code:string) {
  const field=page.getByRole('textbox',{name:name+' *',exact:true});
  if(new RegExp('\\b'+code+'$').test(await field.inputValue()))return;
  await field.fill('');await field.pressSequentially(code);
  await page.waitForFunction(code=>[...document.querySelectorAll('div')].some(e=>e.getClientRects().length&&e.children.length===0&&e.textContent?.trim()===code&&!e.closest('#award-outbound-flights')&&e.parentElement?.querySelector('s4s-icon')),code,{timeout:15000});
  const label=await page.evaluate(code=>{
    const match=[...document.querySelectorAll('div')].find(e=>e.getClientRects().length&&e.children.length===0&&e.textContent?.trim()===code&&!e.closest('#award-outbound-flights')&&e.parentElement?.querySelector('s4s-icon'));
    return match?.parentElement ? [...match.parentElement.querySelectorAll('div')].find(e=>e.children.length===0 && e.textContent?.trim()!==code)?.textContent?.trim() || '' : '';
  },code);
  if(!label)throw new Error('AIRPORT_NOT_FOUND');
  await page.getByText(label,{exact:true}).click();
  if(!new RegExp('\\b'+code+'$').test(await field.inputValue()))throw new Error('QUERY_MISMATCH');
}
async function date(page:Page,value:string) {
  const input=page.getByRole('textbox',{name:'Outbound date *',exact:true});
  if(await input.inputValue()===value)return;
  await page.locator('label').filter({hasText:/^Outbound date\s*\*$/}).click();
  const target=new Date(value+'T12:00:00Z');
  for(let i=0;i<14;i++) {
    const heading=page.getByRole('heading',{name:/^[A-Z][a-z]+ 20\d{2}$/}).first();
    const title=await heading.innerText();const shown=new Date('1 '+title+' 12:00:00 GMT');
    const delta=(target.getUTCFullYear()-shown.getUTCFullYear())*12+target.getUTCMonth()-shown.getUTCMonth();
    if(!delta)break;
    if(!Number.isFinite(delta))throw new Error('DATE_UNAVAILABLE');
    await page.locator('button.react-datepicker__arrow-button').filter({has:page.locator('s4s-icon[name="in--arrow-'+(delta>0?'right':'left')+'"]')}).click();
  }
  const prefix=new Intl.DateTimeFormat('en-US',{timeZone:'UTC',weekday:'long',month:'long',day:'numeric'}).format(target);
  await page.getByRole('gridcell',{name:new RegExp('^Choose '+prefix+'(?:st|nd|rd|th), '+target.getUTCFullYear()+'$')}).click();
  await page.getByRole('button',{name:'Save',exact:true}).click();
  if(await input.inputValue()!==value)throw new Error('DATE_UNAVAILABLE');
}
export async function searchSas(page:Page,q:SasQuery,cancelled:()=>boolean) {
  try {
    await check(page,cancelled);
    // Start a new official search document every time; never reuse an old result page.
    const url=new URL('https://www.flysas.com/en/booking/award/');
    for(const [key,value] of Object.entries({origin:q.origin,destination:q.destination,outboundDate:q.date,adults:'1',children:'0',infants:'0'}))url.searchParams.set(key,value);
    await page.goto(url.href,{waitUntil:'domcontentloaded',timeout:45000});
    const form=page.getByRole('textbox',{name:'From *',exact:true});
    const edit=page.getByRole('button',{name:'Edit search',exact:true});
    const readyBy=Date.now()+45000;
    while(!await form.isVisible() && !await edit.isVisible()) {
      await check(page,cancelled);
      const ok=page.getByRole('button',{name:'Ok',exact:true});
      if(await ok.isVisible() && /something went wrong/i.test(await page.locator('body').innerText()))await ok.click();
      if(Date.now()>readyBy)throw new Error('SEARCH_TIMEOUT');
      await page.waitForTimeout(500);
    }
    await check(page,cancelled);
    if(await form.isVisible()) {
      await page.locator('#one-way').click();
      await airport(page,'From',q.origin);await airport(page,'To',q.destination);await date(page,q.date);
      await check(page,cancelled);
      await page.getByRole('button',{name:'Search',exact:true}).click();
    }
    const empty=page.getByText("We couldn't find any flights for the selected dates.",{exact:true});
    const end=Date.now()+90000;
    while(Date.now()<end) {
      await check(page,cancelled);
      if(await page.locator('[data-testid^="award-flight-row-"]').count() || await empty.isVisible())break;
      if(/something went wrong/i.test(await page.locator('body').innerText()))throw new Error('SEARCH_FAILED');
      await page.waitForTimeout(500);
    }
    for(let i=0;i<15;i++) {
      const more=page.getByRole('button',{name:/^Show more flights/});if(!await more.isVisible())break;
      await check(page,cancelled);
      const count=await page.locator('[data-testid^="award-flight-row-"]').count();await more.click();
      await page.waitForFunction(n=>document.querySelectorAll('[data-testid^="award-flight-row-"]').length>n,count,{timeout:10000});
    }
    await check(page,cancelled);
    if(await edit.isVisible())await edit.click();
    const result=await page.evaluate(()=>{
      const root=document.getElementById('award-outbound-flights');
      const inputs=[...document.querySelectorAll('input')].filter(e=>Boolean(e.getClientRects().length));
      return {origin:inputs.find(e=>e.placeholder==='From')?.value.match(/\b([A-Z]{3})$/)?.[1],destination:inputs.find(e=>e.placeholder==='To')?.value.match(/\b([A-Z]{3})$/)?.[1],date:inputs.find(e=>e.placeholder==='Outbound date')?.value,
        oneWay:[...document.querySelectorAll('h4')].some(e=>e.textContent?.trim().toUpperCase()==='ONE WAY'),
        oneTraveler:[...document.querySelectorAll('h5')].some(e=>e.textContent?.trim().toUpperCase()==='1 TRAVELER') && /\b1 adult\b/i.test(document.body.innerText),
        route:root?[...root.querySelectorAll('h2 span')].map(e=>e.textContent?.trim()).filter(t=>/^[A-Z]{3}$/.test(t||'')).join('-'):'',
        shownDate:(root?.querySelector('ul li:nth-child(2)') as HTMLElement)?.innerText?.trim(),
        rows:root?[...root.querySelectorAll('[data-testid^="award-flight-row-"]')].filter(e=>Boolean(e.getClientRects().length)).map(e=>(e as HTMLElement).innerText):[]};
    });
    if(['origin','destination','date'].some(k=>result[k as keyof typeof result]!==q[k as keyof SasQuery])||!result.oneWay||!result.oneTraveler)throw new Error('QUERY_MISMATCH');
    const expected=new Intl.DateTimeFormat('en-GB',{timeZone:'UTC',weekday:'short',day:'2-digit',month:'short'}).format(new Date(q.date+'T12:00:00Z')).replace(/,/g,'');
    if(result.rows.length && (result.route!==q.origin+'-'+q.destination || result.shownDate?.replace(/\s+/g,' ')!==expected))throw new Error('QUERY_MISMATCH');
    if(!result.rows.length && !await empty.isVisible())throw new Error('SEARCH_TIMEOUT');
    return {...q,status:result.rows.length?'available':'empty',flights:result.rows.map(parseSasRow),complete:!await page.getByRole('button',{name:/^Show more flights/}).isVisible(),
      observedAt:new Date().toISOString(),source:'SAS_EUROBONUS_VISIBLE_RESULTS',freshSearch:true,adults:1,tripType:'ONE_WAY'};
  } catch(error) {const code=error instanceof Error?error.message:'';return {status:'failed',code:/^[A-Z_]+$/.test(code)?code:'SEARCH_FAILED'};}
}
