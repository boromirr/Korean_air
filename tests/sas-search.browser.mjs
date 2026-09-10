// Offline browser regression: intercept every URL, never contact the airline.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {searchSas} from '../src/sas/search.ts';
const query={origin:'AMS',destination:'CDG',date:'2026-11-04'};
function fixture(destination='CDG') {
  return `<body><button id="one-way">One way</button>
  <input aria-label="From *" placeholder="From" value="Amsterdam AMS">
  <input aria-label="To *" placeholder="To" value="Paris CDG">
  <input aria-label="Outbound date *" placeholder="Outbound date" value="2026-11-04">
  <h4>ONE WAY</h4><h5>1 TRAVELER</h5><p>1 adult</p>
  <button id="search">Search</button><div id="result"></div><script>
  document.getElementById('search').onclick=()=>setTimeout(()=>{
    document.getElementById('result').innerHTML='<div id="award-outbound-flights"><h2><span>AMS</span><span>${destination}</span></h2><ul><li>Tue 03 Nov</li><li>Wed 04 Nov</li><li>Thu 05 Nov</li></ul><div data-testid="award-flight-row-test">06:55 - 08:10<br>Direct, 1h 15m<br>AMS<br>CDG<br>Operated by TEST (AMS-CDG)<br>business<br>48,000 p</div></div>';
  },50);</script></body>`;
}
test('new search navigates again; mismatched result is rejected',async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try {
    const page=await browser.newPage();let requests=0,body=fixture();
    await page.route('**/*',route=>{requests++;return route.fulfill({contentType:'text/html',body});});
    await page.goto('https://www.flysas.com/en/booking/award/');
    const first=await searchSas(page,query,()=>false);
    assert.equal(first.status,'available');assert.equal(first.freshSearch,true);
    assert.equal(first.flights[0].fares[0].points,48000);
    assert.equal(first.flights[0].fares[0].availableSeatCount,null);
    const before=requests;
    const second=await searchSas(page,query,()=>false);
    assert.equal(second.status,'available');assert.ok(requests>before);
    body=fixture('LHR');
    assert.deepEqual(await searchSas(page,query,()=>false),{status:'failed',code:'QUERY_MISMATCH'});
  } finally {await browser.close();}
});
