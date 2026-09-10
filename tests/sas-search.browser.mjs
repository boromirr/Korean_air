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
  document.getElementById('search').onclick=async()=>{await fetch('/award-api/flights?origin=AMS&destination=CDG&outboundDate=2026-11-04');setTimeout(()=>{
    document.getElementById('result').innerHTML='<div id="award-outbound-flights"><h2><span>AMS</span><span>${destination}</span></h2><ul><li>Tue 03 Nov</li><li>Wed 04 Nov</li><li>Thu 05 Nov</li></ul><div data-testid="award-flight-row-test">06:55 - 08:10<br>Direct, 1h 15m<br>AMS<br>CDG<br>Operated by TEST (AMS-CDG)<br>business<br>48,000 p</div></div>';
  },50);};</script></body>`;
}
test('new search navigates again; mismatched result is rejected',async()=>{
  const browser=await chromium.launch({channel:'chrome',headless:true});
  try {
    const page=await browser.newPage();let requests=0,body=fixture();
    await page.route('**/*',route=>{requests++;if(route.request().url().includes('/award-api/flights'))return route.fulfill({json:{outboundFlights:[{}]}});return route.fulfill({contentType:'text/html',body});});
    await page.goto('https://www.flysas.com/en/booking/award/');
    const first=await searchSas(page,query,()=>false);
    assert.equal(first.status,'available');assert.equal(first.freshSearch,true);
    assert.equal(first.flights[0].fares[0].points,48000);
    assert.equal(first.flights[0].fares[0].availableSeatCount,null);
    const before=requests;
    const second=await searchSas(page,query,()=>false);
    assert.equal(second.status,'available');assert.ok(requests>before);
    body=fixture('LHR');
    const mismatch=await searchSas(page,query,()=>false);assert.equal(mismatch.status,'failed');assert.equal(mismatch.code,'QUERY_MISMATCH');
  } finally {await browser.close();}
});
test('does not treat a temporary empty panel as a completed airline response',async()=>{
 const b=await chromium.launch({channel:'chrome',headless:true});try{const p=await b.newPage();let received=false;
 const body=fixture().replace("await fetch('/award-api/flights?origin=AMS&destination=CDG&outboundDate=2026-11-04');", "document.getElementById('result').innerHTML=\"<p>We couldn't find any flights for the selected dates.</p>\";await fetch('/award-api/flights?origin=AMS&destination=CDG&outboundDate=2026-11-04');");
 await p.route('**/*',async route=>{if(route.request().url().includes('/award-api/flights')){await new Promise(r=>setTimeout(r,300));received=true;return route.fulfill({json:{outboundFlights:[{}]}});}return route.fulfill({contentType:'text/html',body});});
 await p.goto('https://www.flysas.com/en/booking/award/');
 const result=await searchSas(p,query,()=>false);assert.equal(received,true);assert.equal(result.status,'available');assert.equal(result.flights.length,1);
 }finally{await b.close();}
});
