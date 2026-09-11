(() => {
  const desktop = '/browser/vnc.html?autoconnect=true&resize=scale&path=browser/websockify&show_dot=true';
  const link = document.createElement('a');
  link.href = desktop;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.className = 'provider-link cloud-browser-link';
  link.textContent = '항공사 로그인 창 보기 ↗';
  document.querySelector('.topbar').append(link);
  document.querySelector('.local-tag')?.remove();
  const note = document.createElement('p');
  note.className = 'cloud-help';
  note.textContent = '로그인이 필요한 항공사는 로그인·예약 열기를 누른 뒤, 상단의 로그인 창에서 직접 로그인해 주세요. 완료 후 이 화면으로 돌아와 로그인 완료·확인을 누르세요.';
  document.querySelector('#account-actions').after(note);
  const style = document.createElement('style');
  style.textContent = `body{font-size:16px}.intro{padding:22px 0}.intro h1{font-size:28px}.intro p,.program-hint,.field-label,.provider-link,.form-bottom p,.month-range-hint,.footer{font-size:14px}.field input,.field select{font-size:16px}.cloud-browser-link{margin:0;font-size:14px;white-space:nowrap}.cloud-help{font-size:14px;color:#526780;line-height:1.65;margin:12px 0}.intro-note{font-size:14px}.topbar{gap:14px}@media(max-width:640px){.topbar{height:auto;min-height:70px;flex-wrap:wrap;padding:14px 0}.brand{font-size:16px}.cloud-browser-link{width:100%;min-height:44px}.intro{padding:20px 0}.intro h1{font-size:25px}.intro p,.program-hint,.field-label,.provider-link{font-size:14px}.shell{padding:0 14px}.search-panel{padding:18px 14px}#account-actions{gap:8px!important}#account-actions button{flex:1;min-height:44px}.cloud-help{margin-top:12px}.footer-brand{font-size:14px}}`;
  document.head.append(style);
})();
