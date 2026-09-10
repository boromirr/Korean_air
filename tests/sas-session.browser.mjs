import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {sasSessionState,prepareSasSession,sasStateError} from '../src/sas/session.ts';
test('signed-in homepage opens award form in the same session; login and missing form differ',async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try{
    const p=await browser.newPage();let mode='ready',requests=0;
    await p.route('**/*',async r=>{
      requests++;
      const path=new URL(r.request().url()).pathname;
      const body=path==='/en'?'<a href="/auth/logout">Log out</a>':mode==='ready'?'<input id="cep-origin-input"><input id="cep-destination-input"><button>Search</button><a href="/auth/logout">Log out</a>':'<button>Log in</button>';
      await r.fulfill({contentType:'text/html',body});
    });
    await p.goto('https://www.flysas.com/en');
    assert.deepEqual(await sasSessionState(p),{state:'form_required',authenticated:true});
    assert.deepEqual(await prepareSasSession(p),{state:'ready',authenticated:true});
    assert.equal(new URL(p.url()).pathname,'/en/eurobonus/points/use/partner-award-flights/');
    mode='login';await p.goto('https://www.flysas.com/en/booking/award/');
    const before=requests;
    assert.equal((await prepareSasSession(p)).state,'login_required');
    assert.equal(requests,before);
    assert.equal(sasStateError('form_required'),'FORM_REQUIRED');
    assert.equal(sasStateError('login_required'),'LOGIN_REQUIRED');
    await p.route('**/*',r=>r.fulfill({contentType:'text/html',body:'Access denied'}));
    await p.goto('https://www.flysas.com/en');
    assert.equal((await prepareSasSession(p)).state,'restricted');
  }finally{await browser.close();}
});
