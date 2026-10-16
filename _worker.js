// Cloudflare Pages advanced-mode worker. No credentials are included in this file.
import { Buffer } from 'node:buffer';

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

export function handleLanguage(request) {
  if (new URL(request.url).pathname !== '/api/language.js') return null;
  if (!['GET', 'HEAD'].includes(request.method)) {
    const result = response({ error: 'method_not_allowed' }, 405);
    result.headers.set('Allow', 'GET, HEAD');
    return result;
  }
  const language = request.cf?.country === 'UA' ? 'uk' : 'en';
  return new Response(request.method === 'HEAD' ? null : `globalThis.AutoMethodsLanguage?.applyCountryLanguage('${language}');\n`, {
    headers: { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });
}

export default {
  async fetch(request, env) {
    return handleLanguage(request) || await handleFeedback(request, env) || await handleAuth(request, env) || env.ASSETS.fetch(request);
  },
};

const maxFiles = 10;
const maxFileBytes = 20_000_000;
const maxRequestBytes = maxFileBytes + 65_536;
const fileTypes = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'pdf', 'csv', 'txt', 'log', 'json', 'zip', 'docx', 'xlsx', 'mp4', 'webm']);
const emailAddress = value => typeof value === 'string' && value.length <= 254 && /^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(value);
function feedbackConfigured(env) {
  return Boolean(env.RESEND_API_KEY?.startsWith('re_') && emailAddress(env.FEEDBACK_FROM) && emailAddress(env.FEEDBACK_TO) && env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET_KEY);
}

// Encode one small, three-byte-aligned chunk at a time. A 20 MB submission
// must not create several full-size copies of its Base64/JSON representation.
function emailBody(message, files) {
  const encoder = new TextEncoder();
  async function* chunks() {
    yield encoder.encode(JSON.stringify(message).slice(0, -1) + ',"attachments":[');
    for (let index = 0; index < files.length; index++) {
      const file = files[index];
      yield encoder.encode((index ? ',' : '') + '{"filename":' + JSON.stringify(file.name) + ',"content":"');
      for (let offset = 0; offset < file.size; offset += 49_152) {
        const bytes = await file.slice(offset, offset + 49_152).arrayBuffer();
        yield encoder.encode(Buffer.from(bytes).toString('base64'));
      }
      yield encoder.encode('"}');
    }
    yield encoder.encode(']}');
  }
  const iterator = chunks();
  return new ReadableStream({
    async pull(controller) {
      try {
        const { value, done } = await iterator.next();
        if (done) controller.close(); else controller.enqueue(value);
      } catch (error) { controller.error(error); }
    },
    cancel() { return iterator.return(); },
  });
}

export async function handleFeedback(request, env, transport = fetch) {
  const url = new URL(request.url);
  if (url.pathname !== '/api/feedback' && url.pathname !== '/api/feedback/config') return null;
  if (url.pathname === '/api/feedback/config') {
    if (request.method !== 'GET') return response({ error: 'method_not_allowed' }, 405);
    return response({ configured: feedbackConfigured(env), siteKey: feedbackConfigured(env) ? env.TURNSTILE_SITE_KEY : '', maxFiles, maxFileBytes });
  }
  if (request.method !== 'POST') return response({ error: 'method_not_allowed' }, 405);
  if (request.headers.get('Origin') !== url.origin) return response({ error: 'invalid_origin' }, 403);
  if (!feedbackConfigured(env)) return response({ error: 'feedback_unconfigured' }, 503);
  if (!request.headers.get('Content-Type')?.startsWith('multipart/form-data;')) return response({ error: 'invalid_input' }, 415);
  if (Number(request.headers.get('Content-Length')) > maxRequestBytes) return response({ error: 'files_too_large' }, 413);
  const token = request.headers.get('X-Turnstile-Token');
  if (!token || token.length > 2048) return response({ error: 'verification_failed' }, 403);
  try {
    // Optional Cloudflare Rate Limiting binding; Turnstile remains mandatory.
    if (env.FEEDBACK_RATE_LIMITER) {
      const limit = await env.FEEDBACK_RATE_LIMITER.limit({ key: request.headers.get('CF-Connecting-IP') || 'unknown' });
      if (!limit.success) return response({ error: 'rate_limit' }, 429);
    }
    const verification = await transport('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({ secret: env.TURNSTILE_SECRET_KEY, response: token, remoteip: request.headers.get('CF-Connecting-IP') || undefined }),
    });
    if (!verification.ok) return response({ error: 'service_unavailable' }, 503);
    const verified = await verification.json();
    if (!verified.success || verified.action !== 'feedback' || verified.hostname !== url.hostname) return response({ error: 'verification_failed' }, 403);

    let bytes = 0;
    let tooLarge = false;
    const bounded = request.body.pipeThrough(new TransformStream({ transform(chunk, controller) {
      bytes += chunk.byteLength;
      if (bytes > maxRequestBytes) { tooLarge = true; throw new Error('files_too_large'); }
      controller.enqueue(chunk);
    } }));
    let input;
    try {
      input = await new Request(request.url, { method: 'POST', headers: request.headers, body: bounded, duplex: 'half' }).formData();
    } catch { return response({ error: tooLarge ? 'files_too_large' : 'invalid_input' }, tooLarge ? 413 : 400); }
    const field = name => typeof input.get(name) === 'string' ? input.get(name).trim() : '';
    if (field('website')) return response({ error: 'invalid_input' }, 400);
    const kind = field('kind');
    const text = field('message');
    const reply = field('reply_email');
    const id = field('submission_id');
    if (!['issue', 'suggestion', 'other'].includes(kind) || !text || text.length > 10_000 || (reply && !emailAddress(reply)) || !/^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(id)) return response({ error: 'invalid_input' }, 400);
    const files = input.getAll('files').filter(file => typeof file !== 'string' && file.name);
    if (files.length > maxFiles) return response({ error: 'too_many_files' }, 400);
    if (files.reduce((sum, file) => sum + file.size, 0) > maxFileBytes) return response({ error: 'files_too_large' }, 413);
    for (const file of files) {
      if (file.name.length > 180 || /[\x00-\x1f\x7f/\\]/.test(file.name) || !fileTypes.has(file.name.split('.').pop().toLowerCase())) return response({ error: 'unsupported_file' }, 400);
    }
    // Never include query strings/fragments, which can contain account tokens.
    let page = '';
    try { const source = new URL(field('page')); if (source.origin === url.origin) page = source.origin + source.pathname; } catch {}
    const version = field('version').replace(/[^\w.\-]/g, '').slice(0, 32);
    const message = {
      from: env.FEEDBACK_FROM, to: [env.FEEDBACK_TO], ...(reply ? { reply_to: reply } : {}),
      subject: `[AutoMethods] ${kind === 'issue' ? 'Issue report' : kind === 'suggestion' ? 'Suggestion' : 'Feedback'} · ${id.slice(0, 8)}`,
      text: `${text}\n\n---\nReply email: ${reply || 'Not supplied'}\nPage: ${page || url.origin}\nVersion: ${version || 'Unknown'}\nLanguage: ${field('language') === 'uk' ? 'uk' : 'en'}\nFiles: ${files.length}\nReference: ${id}`,
    };
    const sent = await transport('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': `feedback/${id}` },
      body: emailBody(message, files), duplex: 'half', signal: AbortSignal.timeout(60_000),
    });
    if (!sent.ok) return response({ error: sent.status === 429 ? 'rate_limit' : 'send_failed' }, sent.status === 429 ? 429 : 502);
    const receipt = await sent.json();
    if (!receipt.id) return response({ error: 'send_failed' }, 502);
    return response({ message: 'feedback_sent', reference: id.slice(0, 8) });
  } catch { return response({ error: 'service_unavailable' }, 503); }
}
