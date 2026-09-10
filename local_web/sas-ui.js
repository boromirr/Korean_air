(() => {
  if(location.protocol!=='http:') return;
  const el=id=>document.getElementById(id);
  const errors={DEPENDENCIES_MISSING:'조회 도구가 설치되지 않았어요. 설치 스크립트를 실행하거나 npm ci를 실행해 주세요.',LOGIN_REQUIRED:'SAS 로그인 또는 검색 화면 확인이 필요해요.',FORM_REQUIRED:'SAS의 영어 보너스 검색 화면에서 출발지·도착지·날짜를 선택해 주세요.',QUERY_MISMATCH:'검색 조건과 결과가 일치하지 않아 가져오지 않았어요. SAS에서 다시 검색해 주세요.',ONE_WAY_REQUIRED:'현재는 편도 검색 결과만 가져올 수 있어요.',ONE_ADULT_REQUIRED:'현재는 성인 1명 검색 결과만 가져올 수 있어요.',ACCESS_RESTRICTED:'SAS에서 보안 확인이나 접속 제한이 표시되어 중단했어요.',SEARCH_FAILED:'SAS 검색을 완료하지 못했어요. 좌석 유무는 확인하지 못했어요.',SEARCH_TIMEOUT:'SAS 응답을 기다리다가 중단했어요. 좌석 유무는 확인하지 못했어요.',UNRECOGNIZED_RESULT:'SAS 좌석 표시를 읽지 못했어요. 좌석 없음으로 처리하지 않았어요.',RESULT_NOT_READY:'SAS에서 먼저 항공편 검색을 완료해 주세요.',DATE_UNAVAILABLE:'SAS에서 선택한 날짜를 지정하지 못했어요.',CANCELLED:'조회를 중단했어요.',BUSY:'이미 진행 중인 SAS 조회가 있어요.',INVALID_QUERY:'서로 다른 공항 코드와 향후 360일 안의 날짜를 입력해 주세요.'};
  let ready=false, running=false, saved=[], timer=null, polling=false;
  const msg=code=>errors[code] || 'SAS 조회 창을 확인하지 못했어요. 로그인·조회 창을 열어 주세요.';
  async function api(path,body){const response=await fetch(path,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});const data=await response.json();if(!response.ok)throw new Error(data.error?.code?msg(data.error.code):'SAS 조회 서버에 연결하지 못했어요.');return data;}
  function controls(){el('sas-search').disabled=!ready||running;el('sas-cancel').disabled=!running;el('sas-open-browser').disabled=running;for(const input of el('sas-form').querySelectorAll('input'))input.disabled=running;}
  function plan(){
    const origin=el('sas-origin').value.trim().toUpperCase(), destinations=[...new Set(el('sas-destinations').value.toUpperCase().split(/[\s,]+/).filter(Boolean))];
    const first=el('sas-start').value,last=el('sas-end').value, start=Date.parse(first+'T12:00:00Z'),end=Date.parse(last+'T12:00:00Z');
    if(!/^[A-Z]{3}$/.test(origin)||!destinations.length||destinations.some(d=>!/^[A-Z]{3}$/.test(d)||d===origin)||!Number.isFinite(start)||!Number.isFinite(end)||end<start)throw new Error('공항 코드와 시작일·종료일을 확인해 주세요.');
    const count=(Math.round((end-start)/86400000)+1)*destinations.length;if(count>20)throw new Error('선택한 범위는 '+count+'개 조합입니다. 한 번에 20개 이하로 줄여 주세요.');
    const items=[];for(let date=start;date<=end;date+=86400000)for(const destination of destinations)items.push({origin,destination,date:new Date(date).toISOString().slice(0,10)});return items;
  }
  function scope(){try{const items=plan();el('sas-scope').textContent=items.length+'개 노선·날짜 조합을 검색합니다. 각 날짜의 표시된 모든 좌석 등급을 가져와요.';}catch(e){el('sas-scope').textContent=e.message;}}
  function node(tag,text,cls){const n=document.createElement(tag);n.textContent=text;if(cls)n.className=cls;return n;}
  function render(){
    const root=el('sas-results');root.replaceChildren();const cabin=el('sas-cabin').value;let available=0;
    for(const result of saved){
      const flights=result.flights.flatMap(f=>f.fares.filter(fare=>cabin==='all'||fare.cabin===cabin).map(fare=>({...f,...fare})));
      available+=flights.length;
      const panel=node('article','','panel');panel.style.cssText='padding:20px;margin-bottom:16px';
      panel.append(node('h3',result.origin+' → '+result.destination+' · '+result.date));
      const stamp=new Date(result.observedAt).toLocaleString('ko-KR');
      panel.append(node('p',(result.freshSearch?'직접 조회한 결과':'이전 결과 · 검색 시각 미확인')+' · 화면을 읽은 시각: '+stamp,'program-hint'));
      if(!result.complete)panel.append(node('p','일부 항공편만 확인한 결과입니다.','stale'));
      if(!flights.length){panel.append(node('p',result.status==='empty'?'이 노선·날짜의 검색 결과에 항공편이 없었어요.':'가져온 결과에서 선택한 등급의 좌석 표시를 찾지 못했어요.'));}
      else {
        const wrap=node('div','');wrap.style.overflowX='auto';const table=node('table','');table.style.cssText='width:100%;border-collapse:collapse;text-align:left;font-size:13px';
        const heading=node('tr','');for(const label of ['출발–도착','운항사·여정','좌석 등급','필요 포인트','잔여 좌석 수'])heading.append(node('th',label));table.append(heading);
        for(const f of flights){const row=node('tr','');for(const value of [f.departureTime+'–'+f.arrivalTime,f.operatedBy,({'economy':'일반석','premium economy':'프리미엄 이코노미','business':'비즈니스','first':'일등석'})[f.cabin],f.points.toLocaleString()+' p','미제공']){const cell=node('td',value);cell.style.cssText='padding:12px 8px 12px 0;border-top:1px solid #e2eaf2';row.append(cell);}row.title=f.itinerary;table.append(row);}wrap.append(table);panel.append(wrap);
      }
      const link=node('a','SAS에서 다시 확인 ↗','source-link');link.href='https://www.flysas.com/en/eurobonus/points/use/partner-award-flights/';link.target='_blank';link.rel='noopener noreferrer';panel.append(link);root.append(panel);
    }
    el('sas-summary').textContent='저장된 노선·날짜 '+saved.length+'개 · 선택 등급의 항공편별 요금 '+available+'개 · 세금·수수료 별도';
    if(!saved.length)root.append(node('div','아직 조회 결과가 없어요. SAS에 로그인한 뒤 위에서 노선과 날짜를 선택해 조회해 주세요.','panel empty'));
  }
  async function load(){try{saved=(await api('/api/sas-results')).results;render();}catch(e){el('sas-summary').textContent=e.message;}}
  function showBrowser(browser) {
    ready=browser?.state==='ready';
    const descriptions={restricted:'SAS에서 접속을 제한해 현재 자동 조회를 할 수 없어요. 좌석 유무는 확인하지 못했습니다.',closed:'SAS 로그인·조회 창을 먼저 열어 주세요.',ready:'SAS 검색 준비 완료',login_required:'앱이 연 SAS 창에서 직접 로그인해 주세요.',form_required:'SAS 창에서 보너스 항공편 검색 화면으로 이동해 주세요.',action_required:'SAS 창에서 보안 확인이 필요해요. 자동 조회는 중단됩니다.',loading:'SAS 화면을 불러오고 있어요.'};
    el('sas-connection').textContent=descriptions[browser?.state] || 'SAS 조회 창을 확인해 주세요.';
    controls();
  }
  async function poll(){
    if(polling)return;polling=true;clearTimeout(timer);
    try{
      const {job,browser}=await api('/api/sas/status');showBrowser(browser);
      if(job){
        running=['queued','running'].includes(job.status);controls();await load();
        const attempted=job.results.length, completed=job.results.filter(r=>['available','empty'].includes(r.status)).length;
        const remaining=job.items.length-attempted;
        el('sas-progress').textContent='확인 완료 '+completed+' / '+job.items.length+'개 · 실패 '+(attempted-completed)+'개 · '+(running?'대기 ': '미조회 ')+remaining+'개'+(job.status==='failed'?' — '+msg(job.code):job.status==='cancelled'?' — 중단됨':job.status==='complete'?' — 완료':job.status==='queued'?' — 다음 검색 대기 중':' — SAS 검색 중');
      }
    }catch(e){el('sas-connection').textContent=e.message;ready=false;controls();}
    finally{polling=false;timer=setTimeout(poll,running?2000:5000);}
  }
  async function open(){
    el('sas-open-browser').disabled=true;el('sas-connection').textContent='SAS 조회용 Chrome을 열고 있어요.';
    try{const result=await api('/api/sas/open',{});showBrowser(result.browser);await poll();}
    catch(e){el('sas-connection').textContent=e.message;}
    finally{controls();}
  }
  window.SasLocal={open};
  async function start(){try{await api('/api/sas/search',{items:plan()});running=true;controls();el('sas-progress').textContent='SAS에서 검색을 시작하고 있어요.';clearTimeout(timer);await poll();}catch(e){el('sas-progress').textContent=e.message;}}
  el('sas-form').addEventListener('submit',e=>{e.preventDefault();void start();});
  el('sas-form').addEventListener('input',scope);
  el('sas-open-browser').addEventListener('click',()=>void open());
  el('sas-connect').addEventListener('click',()=>void poll());
  el('sas-cancel').addEventListener('click',async()=>{try{await api('/api/sas/cancel',{});clearTimeout(timer);running=false;controls();await poll();}catch(e){el('sas-progress').textContent=e.message;}});
  el('sas-cabin').addEventListener('change',render);
  const tomorrow=new Date(Date.now()+86400000).toISOString().slice(0,10);
  for(const id of ['sas-start','sas-end']){el(id).value=tomorrow;el(id).min=new Date().toISOString().slice(0,10);el(id).max=new Date(Date.now()+359*86400000).toISOString().slice(0,10);}
  scope();void load();void poll();
})();
