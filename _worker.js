// Cloudflare Pages advanced-mode worker. No credentials are included in this file.
const accessCookie = 'am_access';
const refreshCookie = 'am_refresh';

function response(data, status = 200, cookies = []) {
  const headers = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store', Vary: 'Cookie', 'Referrer-Policy': 'no-referrer' });
  for (const cookie of cookies) headers.append('Set-Cookie', cookie);
  return new Response(JSON.stringify(data), { status, headers });
}
function cookie(name, value, age, request) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${secure}`;
}
function clearCookies(request) {
  return [cookie(accessCookie, '', 0, request), cookie(refreshCookie, '', 0, request)];
}
function sessionCookies(session, request) {
  return [cookie(accessCookie, session.access_token, session.expires_in || 3600, request),
    cookie(refreshCookie, session.refresh_token, 30 * 24 * 3600, request)];
}
function readCookies(request) {
  const values = {};
  for (const part of (request.headers.get('Cookie') || '').split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    try { values[part.slice(0, separator).trim()] = decodeURIComponent(part.slice(separator + 1)); } catch {}
  }
  return values;
}
function publicUser(user) { return user?.id ? { id: user.id, email: user.email || '' } : null; }
function configured(env) {
  try { return new URL(env.SUPABASE_URL).protocol === 'https:' && env.SUPABASE_PUBLISHABLE_KEY?.startsWith('sb_publishable_'); } catch { return false; }
}
function authError(status, data) {
  const code = data?.error_code || data?.code;
  if (status === 429) return 'rate_limit';
  if (code === 'invalid_credentials') return 'invalid_credentials';
  if (code === 'email_not_confirmed') return 'email_not_confirmed';
  if (code === 'weak_password') return 'weak_password';
  if (code === 'signup_disabled') return 'signup_disabled';
  return 'auth_failed';
}

export async function handleAuth(request, env, transport = fetch) {
  const url = new URL(request.url);
  const path = url.pathname;
  const callback = path === '/auth/confirm';
  if (path !== '/api/session' && !path.startsWith('/api/auth/') && !callback) return null;
  const redirect = (result, cookies = []) => {
    // An explicit empty fragment also drops legacy Supabase token fragments.
    const headers = new Headers({ Location: `/?account=${result}#`, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
    for (const value of cookies) headers.append('Set-Cookie', value);
    return new Response(null, { status: 303, headers });
  };
  if (!configured(env)) return callback ? redirect('unconfigured') : response({ configured: false, user: null, error: 'auth_unconfigured' }, path === '/api/session' ? 200 : 503);
  async function api(endpoint, method = 'GET', body, token) {
    const headers = { apikey: env.SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const result = await transport(`${env.SUPABASE_URL.replace(/\/$/, '')}/auth/v1/${endpoint}`, {
      method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10000),
    });
    const data = await result.json().catch(() => ({}));
    return { ok: result.ok, status: result.status, data };
  }
  async function session() {
    const values = readCookies(request);
    if (values[accessCookie]) {
      const verified = await api('user', 'GET', undefined, values[accessCookie]);
      if (verified.ok && publicUser(verified.data)) return { user: publicUser(verified.data), token: values[accessCookie], cookies: [] };
      if (verified.status >= 500) throw new Error('provider_unavailable');
    }
    if (values[refreshCookie]) {
      const refreshed = await api('token?grant_type=refresh_token', 'POST', { refresh_token: values[refreshCookie] });
      if (refreshed.ok && refreshed.data.access_token && refreshed.data.refresh_token && publicUser(refreshed.data.user)) {
        return { user: publicUser(refreshed.data.user), token: refreshed.data.access_token, cookies: sessionCookies(refreshed.data, request) };
      }
      if (refreshed.status >= 500) throw new Error('provider_unavailable');
    }
    return { user: null, token: null, cookies: values[accessCookie] || values[refreshCookie] ? clearCookies(request) : [] };
  }
  try {
    if (path === '/api/session' && request.method === 'GET') {
      const current = await session();
      return response({ configured: true, user: current.user }, 200, current.cookies);
    }
    if (callback && request.method === 'GET') {
      const type = url.searchParams.get('type');
      const token_hash = url.searchParams.get('token_hash');
      if (!token_hash || token_hash.length > 512 || !['email', 'recovery'].includes(type)) return redirect('linkExpired');
      const verified = await api('verify', 'POST', { token_hash, type });
      if (!verified.ok || !verified.data.access_token || !verified.data.refresh_token) return redirect('linkExpired');
      return redirect(type === 'recovery' ? 'reset' : 'confirmed', sessionCookies(verified.data, request));
    }
    if (request.method !== 'POST') return response({ error: 'method_not_allowed' }, 405);
    if (request.headers.get('Origin') !== url.origin) return response({ error: 'invalid_origin' }, 403);
    if (!request.headers.get('Content-Type')?.startsWith('application/json')) return response({ error: 'invalid_input' }, 415);
    if (Number(request.headers.get('Content-Length')) > 8192) return response({ error: 'invalid_input' }, 413);
    const text = await request.text();
    if (text.length > 8192) return response({ error: 'invalid_input' }, 413);
    let input;
    try { input = JSON.parse(text); } catch { return response({ error: 'invalid_input' }, 400); }
    if (!input || typeof input !== 'object') return response({ error: 'invalid_input' }, 400);

    if (path === '/api/auth/signout') {
      const current = await session().catch(() => ({ token: null }));
      // Local logout must clear cookies even if the provider is temporarily unavailable.
      if (current.token) await api('logout?scope=local', 'POST', {}, current.token).catch(() => {});
      return response({ user: null }, 200, clearCookies(request));
    }
    if (path === '/api/auth/password') {
      if (typeof input.password !== 'string' || input.password.length < 8 || input.password.length > 128) return response({ error: 'weak_password' }, 400);
      const current = await session();
      if (!current.user) return response({ error: 'session_expired' }, 401, current.cookies);
      const updated = await api('user', 'PUT', { password: input.password }, current.token);
      return updated.ok ? response({ user: publicUser(updated.data) }, 200, current.cookies) : response({ error: authError(updated.status, updated.data) }, 400, current.cookies);
    }
    if (!['/api/auth/signin', '/api/auth/signup', '/api/auth/recover'].includes(path)) return response({ error: 'not_found' }, 404);
    const email = typeof input.email === 'string' ? input.email.trim() : '';
    if (!email.includes('@') || email.length > 254) return response({ error: 'invalid_input' }, 400);
    const redirectTo = encodeURIComponent(`${url.origin}/auth/confirm`);
    if (path === '/api/auth/recover') {
      const result = await api(`recover?redirect_to=${redirectTo}`, 'POST', { email });
      return result.ok ? response({ message: 'reset_sent' }) : response({ error: authError(result.status, result.data) }, result.status === 429 ? 429 : 400);
    }
    const password = input.password;
    if (typeof password !== 'string' || password.length < (path.endsWith('signup') ? 8 : 1) || password.length > 128) return response({ error: 'weak_password' }, 400);
    const endpoint = path.endsWith('signup') ? `signup?redirect_to=${redirectTo}` : 'token?grant_type=password';
    const result = await api(endpoint, 'POST', { email, password });
    if (!result.ok) return response({ error: authError(result.status, result.data) }, result.status === 429 ? 429 : 400);
    if (result.data.access_token && result.data.refresh_token && publicUser(result.data.user)) {
      return response({ user: publicUser(result.data.user) }, 200, sessionCookies(result.data, request));
    }
    if (path.endsWith('signup')) return response({ message: 'confirmation_sent' });
    return response({ error: 'auth_failed' }, 502);
  } catch {
    return callback ? redirect('linkExpired') : response({ error: 'service_unavailable' }, 503);
  }
}

export default {
  async fetch(request, env) {
    return await handleAuth(request, env) || env.ASSETS.fetch(request);
  },
};
