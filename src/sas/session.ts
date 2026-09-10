import type {Page} from 'playwright';
import {sasRestriction} from './status.js';
export const SAS_AWARD_URL='https://www.flysas.com/en/eurobonus/points/use/partner-award-flights/';
export async function sasSessionState(page:Page):Promise<{state:string;authenticated?:boolean}> {
  try {
    const url=new URL(page.url());
    const restriction=sasRestriction(await page.locator('body').innerText({timeout:2000}));
    if(restriction)return {state:restriction};
    if(url.hostname==='auth.flysas.com')return {state:'login_required'};
    if(!/(^|\.)flysas\.com$/.test(url.hostname))return {state:'form_required'};
    const authenticated=await page.getByRole('link',{name:/^log out$/i}).first().isVisible() || await page.getByRole('button',{name:/^log out$/i}).first().isVisible();
    const form=await page.getByRole('textbox',{name:'From *',exact:true}).isVisible() && await page.getByRole('textbox',{name:'To *',exact:true}).isVisible();
    if(url.pathname.includes('/booking/award') && (form || await page.getByRole('button',{name:'Edit search',exact:true}).isVisible()))return {state:'ready',authenticated};
    if(url.pathname.includes('partner-award-flights') && await page.locator('#cep-origin-input').isVisible() && await page.locator('#cep-destination-input').isVisible() && await page.getByRole('button',{name:'Search',exact:true}).isVisible())return {state:'ready',authenticated};
    if(authenticated)return {state:'form_required',authenticated:true};
    if(await page.getByRole('button',{name:/^(login|log in|sign in)$/i}).first().isVisible() || await page.getByRole('link',{name:/^(login|log in|sign in)$/i}).first().isVisible())return {state:'login_required'};
    return {state:'form_required'};
  } catch {return {state:'loading'};}
}
export async function prepareSasSession(page:Page) {
  const current=await sasSessionState(page);
  if(['restricted','action_required','login_required'].includes(current.state))return current;
  if(current.state==='ready')return current;
  // A signed-in homepage is not the award form. Open the form in this same session.
  await page.goto(SAS_AWARD_URL,{waitUntil:'domcontentloaded',timeout:45000});
  const deadline=Date.now()+15000;
  do {
    const state=await sasSessionState(page);
    if(['ready','login_required','restricted','action_required'].includes(state.state))return state;
    await page.waitForTimeout(300);
  }while(Date.now()<deadline);
  return sasSessionState(page);
}
export function sasStateError(state:string) {
  if(['restricted','action_required'].includes(state))return 'ACCESS_RESTRICTED';
  if(state==='login_required')return 'LOGIN_REQUIRED';
  if(state==='loading')return 'SEARCH_TIMEOUT';
  if(state==='closed')return 'BROWSER_ERROR';
  return 'FORM_REQUIRED';
}
