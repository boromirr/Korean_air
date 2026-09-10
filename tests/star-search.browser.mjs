import {test} from 'node:test';import assert from 'node:assert/strict';import {chromium} from 'playwright';import {searchStar} from '../src/partners/star-alliance.ts';
const q={origin:'ICN',destination:'NRT',date:'2027-05-04'};
function fixture(){return `<input id="departureAirport1" value="ICN"><input id="arrivalAirport1" value="NRT"><input id="departureDate1" value="20270502">
<button id="calendar_focus1">날짜 선택</button><div class="ui-datepicker-title">2027. 05</div><table><tr><td data-year="2027" data-month="4"><a data-date="4" href="#" onclick="document.getElementById('departureDate1').value='20270504'">4</a></td></tr></table>
<button onclick="document.getElementById('notice3').style.display='block'">여정변경</button><div id="notice3" style="display:none"><button onclick="this.parentElement.style.display='none'">취소</button><button id="confirm">확인</button></div><span name="departureDate">2027.05.02</span>
<table id="tbl_area1"><tr class="flight"><th class="flight_time"><span class="time">08:25</span><span class="time">10:50</span></th><td class="economy">0석</td></tr></table>
<script>document.getElementById('confirm').onclick=async()=>{const r=await fetch('/I/KR/KO/RedemptionInternationalMultiCityAvailFlight.do',{method:'POST'});const data=await r.json();document.querySelector('[name=departureDate]').textContent='2027.05.04';const td=document.querySelector('#tbl_area1 td');td.innerHTML='2석<input>';td.querySelector('input').setAttribute('flightinfodatas',JSON.stringify(data));document.getElementById('notice3').style.display='none';};</script>`;}
test('reuses the official date change form, waits for fresh results, rejects another date',async()=>{
 const b=await chromium.launch({channel:'chrome',headless:true});try{const p=await b.newPage();p.setDefaultTimeout(3000);let date='20270504';let searches=0;
 await p.route('**/*',async r=>{if(r.request().url().includes('AvailFlight.do')){searches++;return r.fulfill({json:[{departureAirport:'ICN',arrivalAirport:'NRT',departureDate:date,carrierCode:'OZ',flightNo:'102'}]});}return r.fulfill({contentType:'text/html; charset=utf-8',body:fixture()});});
 await p.goto('https://flyasiana.com/I/KR/KO/RedemptionInternationalMultiCityFlightsSelect.do');const result=await searchStar(p,q,()=>false);assert.equal(result.status,'available');assert.equal(result.flights[0].flightNumber,'OZ102');assert.equal(searches,1);
 date='20270502';await p.goto('https://flyasiana.com/I/KR/KO/RedemptionInternationalMultiCityFlightsSelect.do');const wrong=await searchStar(p,q,()=>false);assert.equal(wrong.code,'QUERY_MISMATCH');
 }finally{await b.close();}
});
