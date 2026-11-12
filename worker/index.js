import { FRONTEND_ORIGIN } from '../shared/config.js';
import { api } from './api.js';
import { page } from './page.js';

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
};
const PAGE_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};

function corsHeaders(origin) {
  if (origin !== FRONTEND_ORIGIN) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,X-API-Key,Idempotency-Key',
    'Access-Control-Expose-Headers': 'Retry-After',
    Vary: 'Origin',
  };
}

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    const origin = request.headers.get('Origin');
    const headers = { ...SECURITY_HEADERS, ...corsHeaders(origin) };

    if (request.method === 'OPTIONS' && origin === FRONTEND_ORIGIN) {
      return new Response(null, { status: 204, headers });
    }

    const response =
      path === '/' && request.method === 'GET'
        ? new Response(page, { headers: PAGE_HEADERS })
        : await api(request, env);
    const secured = new Response(response.body, response);
    for (const [key, value] of Object.entries(headers)) secured.headers.set(key, value);
    return secured;
  },
};
