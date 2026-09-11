import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../cloud/site-worker.mjs';
const env = {AWARD_SITE_ORIGIN:'https://owner.example',AWARD_BACKEND_ORIGIN:'https://backend.example',AWARD_GATEWAY_TOKEN:'a'.repeat(48)};
test('configuration is fail-closed',async()=>{
  assert.equal((await worker.fetch(new Request('https://owner.example/'),{})).status,503);
});
test('cross-origin mutations and websocket connections are refused',async()=>{
  for(const request of [new Request('https://owner.example/api/search',{method:'POST',headers:{origin:'https://other.example'}}),new Request('https://owner.example/browser/websockify',{headers:{upgrade:'websocket',origin:'https://other.example'}})]) {
    assert.equal((await worker.fetch(request,env)).status,403);
  }
});
test('upstream is fixed and private credentials never pass through from caller',async()=>{
  const previous=globalThis.fetch;
  let observed;
  globalThis.fetch=async(url,options)=>{observed={url:String(url),options};return new Response('ok',{headers:{'set-cookie':'private=value','content-type':'text/plain'}});};
  try {
    const r=await worker.fetch(new Request('https://owner.example/api/search?next=https://other.example',{method:'POST',headers:{origin:env.AWARD_SITE_ORIGIN,cookie:'owner-session=private',authorization:'Bearer private','x-award-gateway-token':'injected'},body:'{}'}),env);
    assert.equal(observed.url,'https://backend.example/api/search?next=https://other.example');
    assert.equal(observed.options.headers.get('cookie'),null);
    assert.equal(observed.options.headers.get('authorization'),null);
    assert.equal(observed.options.headers.get('x-award-gateway-token'),env.AWARD_GATEWAY_TOKEN);
    assert.equal(observed.options.redirect,'manual');
    assert.equal(r.headers.get('set-cookie'),null);
    assert.equal(await r.text(),'ok');
  } finally {globalThis.fetch=previous;}
});
