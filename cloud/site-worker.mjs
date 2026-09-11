/** Private Sites entrypoint. Airline automation runs only on the Railway service. */
export default {
  async fetch(request, env) {
    let backend, origin;
    try {
      backend = new URL(env.AWARD_BACKEND_ORIGIN);
      origin = new URL(env.AWARD_SITE_ORIGIN).origin;
      if (backend.protocol !== 'https:' || !env.AWARD_GATEWAY_TOKEN || env.AWARD_GATEWAY_TOKEN.length < 32) throw new Error('config');
    } catch {
      return new Response('조회 서버 연결 설정을 확인하고 있습니다. 잠시 후 다시 열어 주세요.', {status:503, headers:{'content-type':'text/plain; charset=utf-8','cache-control':'no-store'}});
    }
    const incoming = new URL(request.url);
    const isUpgrade = request.headers.get('upgrade')?.toLowerCase() === 'websocket';
    if (!['GET','HEAD'].includes(request.method) || isUpgrade) {
      if (request.headers.get('origin') !== origin) return new Response('Forbidden', {status:403});
    }
    if (!['GET','HEAD','POST'].includes(request.method)) return new Response('Method not allowed',{status:405});
    // Never accept a destination URL or gateway credential from the caller.
    backend.pathname = incoming.pathname;
    backend.search = incoming.search;
    const headers = new Headers(request.headers);
    for (const name of ['cookie','authorization','host','x-forwarded-host','x-forwarded-for','x-award-gateway-token']) headers.delete(name);
    headers.set('x-award-gateway-token',env.AWARD_GATEWAY_TOKEN);
    try {
      const response = await fetch(backend, {
        method:request.method, headers, body:['GET','HEAD'].includes(request.method)?undefined:request.body,
        redirect:'manual',
      });
      if (response.status === 101) return response;
      const out = new Headers(response.headers);
      out.delete('set-cookie');
      out.set('cache-control','no-store');
      out.set('referrer-policy','no-referrer');
      out.set('x-content-type-options','nosniff');
      const location = out.get('location');
      if (location) {
        const redirect = new URL(location,backend);
        if (redirect.origin === backend.origin) out.set('location',origin+redirect.pathname+redirect.search+redirect.hash);
      }
      return new Response(response.body,{status:response.status,headers:out});
    } catch {
      return new Response('조회 서버에 연결하지 못했습니다. 잠시 후 새로고침해 주세요. 조회 실패는 좌석 없음과 다릅니다.',{status:503,headers:{'content-type':'text/plain; charset=utf-8','cache-control':'no-store'}});
    }
  },
};
