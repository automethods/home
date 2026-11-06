// server/auth-worker.mjs
import { Buffer } from "node:buffer";

// ../CEA/server/fuel-prices.mjs
import { createHash } from "node:crypto";
var fuelPriceUrl = "https://index.minfin.com.ua/ua/markets/fuel/";
function parseFuelPrices(html, retrievedAt = (/* @__PURE__ */ new Date()).toISOString()) {
  const caption = html.match(/Середні ціни на пальне по Україні на(?:&nbsp;|\s)*(\d{2})\.(\d{2})\.(\d{4})/u);
  if (!caption) throw Error("\u041D\u0435 \u0437\u043D\u0430\u0439\u0434\u0435\u043D\u043E \u0434\u0430\u0442\u0443 \u0442\u0430\u0431\u043B\u0438\u0446\u0456 \u0446\u0456\u043D \u041C\u0456\u043D\u0444\u0456\u043D\u0443.");
  const prices = {};
  for (const [key, code] of [["petrol", "a95"], ["diesel", "dt"]]) {
    const row = html.match(new RegExp(`<tr[^>]*>(?:(?!</tr>)[\\s\\S])*?href=['"]/ua/markets/fuel/` + code + `/['"](?:(?!</tr>)[\\s\\S])*?</tr>`));
    const match = row?.[0].match(/<big>\s*(\d+[,.]\d+)\s*<\/big>/);
    const value = Number(match?.[1].replace(",", "."));
    if (!(value > 0 && value < 1e4)) throw Error("\u041D\u0435 \u0437\u043D\u0430\u0439\u0434\u0435\u043D\u043E \u0446\u0456\u043D\u0443 \u043F\u043E\u0442\u0440\u0456\u0431\u043D\u043E\u0433\u043E \u043F\u0430\u043B\u044C\u043D\u043E\u0433\u043E.");
    prices[key] = value;
  }
  return { format: "cea-fuel-prices/2", asOf: `${caption[3]}-${caption[2]}-${caption[1]}`, retrievedAt, currency: "UAH", unit: "UAH/L", region: "\u0423\u043A\u0440\u0430\u0457\u043D\u0430", prices, source: { title: "\u041C\u0456\u043D\u0444\u0456\u043D. \u0421\u0435\u0440\u0435\u0434\u043D\u0456 \u0446\u0456\u043D\u0438 \u043D\u0430 \u043F\u0430\u043B\u044C\u043D\u0435 \u043F\u043E \u0423\u043A\u0440\u0430\u0457\u043D\u0456 (\u0434\u0430\u043D\u0456 \u041A\u043E\u043D\u0441\u0430\u043B\u0442\u0438\u043D\u0433\u043E\u0432\u043E\u0457 \u0433\u0440\u0443\u043F\u0438 \u0410-95)", url: fuelPriceUrl, sha256: createHash("sha256").update(html).digest("hex") } };
}
async function fetchFuelPrices() {
  const response2 = await fetch(fuelPriceUrl, { signal: AbortSignal.timeout(15e3) });
  if (!response2.ok) throw Error("\u041C\u0456\u043D\u0444\u0456\u043D \u0442\u0438\u043C\u0447\u0430\u0441\u043E\u0432\u043E \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u043D\u0438\u0439.");
  return parseFuelPrices(await response2.text());
}

// ../CEA/server/exchange-rates.mjs
import { createHash as createHash2 } from "node:crypto";
var exchangeUrl = "https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?json";
function parseExchangeRates(raw, retrievedAt = (/* @__PURE__ */ new Date()).toISOString(), url = exchangeUrl) {
  const rows = JSON.parse(raw), rates = { UAH: 1 }, dates = [];
  for (const cc of ["EUR", "USD"]) {
    const match = rows.filter((r2) => r2.cc === cc);
    if (match.length !== 1) throw Error("\u041D\u0435\u043C\u0430\u0454 \u043E\u0434\u043D\u043E\u0437\u043D\u0430\u0447\u043D\u043E\u0433\u043E \u043A\u0443\u0440\u0441\u0443 " + cc);
    const r = match[0];
    if (!Number.isFinite(r.rate) || r.rate <= 0 || r.rate >= 1e5 || !/^\d{2}\.\d{2}\.\d{4}$/.test(r.exchangedate)) throw Error("\u041D\u0435\u0432\u0456\u0440\u043D\u0438\u0439 \u043A\u0443\u0440\u0441 \u041D\u0411\u0423.");
    rates[cc] = r.rate;
    dates.push(r.exchangedate.split(".").reverse().join("-"));
  }
  if (dates[0] !== dates[1]) throw Error("\u041A\u0443\u0440\u0441\u0438 \u043C\u0430\u044E\u0442\u044C \u0440\u0456\u0437\u043D\u0456 \u0434\u0430\u0442\u0438.");
  return { format: "cea-exchange-rates/1", asOf: dates[0], retrievedAt, rates, source: { title: "\u041D\u0430\u0446\u0456\u043E\u043D\u0430\u043B\u044C\u043D\u0438\u0439 \u0431\u0430\u043D\u043A \u0423\u043A\u0440\u0430\u0457\u043D\u0438. \u041E\u0444\u0456\u0446\u0456\u0439\u043D\u0438\u0439 \u043A\u0443\u0440\u0441 \u0433\u0440\u0438\u0432\u043D\u0456 \u0449\u043E\u0434\u043E \u0456\u043D\u043E\u0437\u0435\u043C\u043D\u0438\u0445 \u0432\u0430\u043B\u044E\u0442", url, sha256: createHash2("sha256").update(raw).digest("hex") } };
}
async function fetchExchangeRates() {
  const day = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Kyiv", year: "numeric", month: "2-digit", day: "2-digit" }).format(/* @__PURE__ */ new Date());
  const url = "https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?date=" + day.replaceAll("-", "") + "&json";
  const response2 = await fetch(url, { signal: AbortSignal.timeout(15e3) });
  if (!response2.ok) throw Error("\u041D\u0411\u0423 \u0442\u0438\u043C\u0447\u0430\u0441\u043E\u0432\u043E \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u043D\u0438\u0439.");
  const rates = parseExchangeRates(await response2.text(), (/* @__PURE__ */ new Date()).toISOString(), url);
  if (rates.asOf !== day) throw Error("\u041D\u0411\u0423 \u043F\u043E\u0432\u0435\u0440\u043D\u0443\u0432 \u043A\u0443\u0440\u0441 \u0434\u043B\u044F \u0456\u043D\u0448\u043E\u0457 \u0434\u0430\u0442\u0438.");
  return rates;
}

// server/cea-api.mjs
var snapshots = /* @__PURE__ */ new Map();
async function handleCeaEconomics(request, loaders = { fuel: fetchFuelPrices, exchange: fetchExchangeRates }) {
  const path = new URL(request.url).pathname;
  const key = path === "/api/fuel-prices" ? "fuel" : path === "/api/exchange-rates" ? "exchange" : null;
  if (!key) return null;
  const headers = { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
  if (request.method !== "GET") return new Response(JSON.stringify({ error: "method_not_allowed" }), { status: 405, headers });
  try {
    const saved = snapshots.get(key);
    const value = saved && Date.now() - saved.time < 3e5 ? saved.value : await loaders[key]();
    if (value !== saved?.value) snapshots.set(key, { time: Date.now(), value });
    return new Response(JSON.stringify(value), { headers });
  } catch {
    return new Response(JSON.stringify({ error: "source_unavailable" }), { status: 502, headers });
  }
}

// server/auth-worker.mjs
var accessCookie = "am_access";
var refreshCookie = "am_refresh";
function response(data, status = 200, cookies = []) {
  const headers = new Headers({ "Content-Type": "application/json", "Cache-Control": "no-store", Vary: "Cookie", "Referrer-Policy": "no-referrer" });
  for (const cookie2 of cookies) headers.append("Set-Cookie", cookie2);
  return new Response(JSON.stringify(data), { status, headers });
}
function cookie(name, value, age, request) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${secure}`;
}
function clearCookies(request) {
  return [cookie(accessCookie, "", 0, request), cookie(refreshCookie, "", 0, request)];
}
function sessionCookies(session, request) {
  return [
    cookie(accessCookie, session.access_token, session.expires_in || 3600, request),
    cookie(refreshCookie, session.refresh_token, 30 * 24 * 3600, request)
  ];
}
function readCookies(request) {
  const values = {};
  for (const part of (request.headers.get("Cookie") || "").split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    try {
      values[part.slice(0, separator).trim()] = decodeURIComponent(part.slice(separator + 1));
    } catch {
    }
  }
  return values;
}
function publicUser(user) {
  return user?.id ? { id: user.id, email: user.email || "" } : null;
}
function configured(env) {
  try {
    return new URL(env.SUPABASE_URL).protocol === "https:" && env.SUPABASE_PUBLISHABLE_KEY?.startsWith("sb_publishable_");
  } catch {
    return false;
  }
}
function authError(status, data) {
  const code = data?.error_code || data?.code;
  if (status === 429) return "rate_limit";
  if (code === "invalid_credentials") return "invalid_credentials";
  if (code === "email_not_confirmed") return "email_not_confirmed";
  if (code === "weak_password") return "weak_password";
  if (code === "signup_disabled") return "signup_disabled";
  return "auth_failed";
}
async function handleAuth(request, env, transport = fetch) {
  const url = new URL(request.url);
  const path = url.pathname;
  const callback = path === "/auth/confirm";
  if (path !== "/api/session" && !path.startsWith("/api/auth/") && !callback) return null;
  const redirect = (result, cookies = []) => {
    const headers = new Headers({ Location: `/?account=${result}#`, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
    for (const value of cookies) headers.append("Set-Cookie", value);
    return new Response(null, { status: 303, headers });
  };
  if (!configured(env)) return callback ? redirect("unconfigured") : response({ configured: false, user: null, error: "auth_unconfigured" }, path === "/api/session" ? 200 : 503);
  async function api(endpoint, method = "GET", body, token) {
    const headers = { apikey: env.SUPABASE_PUBLISHABLE_KEY, "Content-Type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    const result = await transport(`${env.SUPABASE_URL.replace(/\/$/, "")}/auth/v1/${endpoint}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : void 0,
      signal: AbortSignal.timeout(1e4)
    });
    const data = await result.json().catch(() => ({}));
    return { ok: result.ok, status: result.status, data };
  }
  async function session() {
    const values = readCookies(request);
    if (values[accessCookie]) {
      const verified = await api("user", "GET", void 0, values[accessCookie]);
      if (verified.ok && publicUser(verified.data)) return { user: publicUser(verified.data), token: values[accessCookie], cookies: [] };
      if (verified.status >= 500) throw new Error("provider_unavailable");
    }
    if (values[refreshCookie]) {
      const refreshed = await api("token?grant_type=refresh_token", "POST", { refresh_token: values[refreshCookie] });
      if (refreshed.ok && refreshed.data.access_token && refreshed.data.refresh_token && publicUser(refreshed.data.user)) {
        return { user: publicUser(refreshed.data.user), token: refreshed.data.access_token, cookies: sessionCookies(refreshed.data, request) };
      }
      if (refreshed.status >= 500) throw new Error("provider_unavailable");
    }
    return { user: null, token: null, cookies: values[accessCookie] || values[refreshCookie] ? clearCookies(request) : [] };
  }
  try {
    if (path === "/api/session" && request.method === "GET") {
      const current = await session();
      return response({ configured: true, user: current.user }, 200, current.cookies);
    }
    if (callback && request.method === "GET") {
      const type = url.searchParams.get("type");
      const token_hash = url.searchParams.get("token_hash");
      if (!token_hash || token_hash.length > 512 || !["email", "recovery"].includes(type)) return redirect("linkExpired");
      const verified = await api("verify", "POST", { token_hash, type });
      if (!verified.ok || !verified.data.access_token || !verified.data.refresh_token) return redirect("linkExpired");
      return redirect(type === "recovery" ? "reset" : "confirmed", sessionCookies(verified.data, request));
    }
    if (request.method !== "POST") return response({ error: "method_not_allowed" }, 405);
    if (request.headers.get("Origin") !== url.origin) return response({ error: "invalid_origin" }, 403);
    if (!request.headers.get("Content-Type")?.startsWith("application/json")) return response({ error: "invalid_input" }, 415);
    if (Number(request.headers.get("Content-Length")) > 8192) return response({ error: "invalid_input" }, 413);
    const text = await request.text();
    if (text.length > 8192) return response({ error: "invalid_input" }, 413);
    let input;
    try {
      input = JSON.parse(text);
    } catch {
      return response({ error: "invalid_input" }, 400);
    }
    if (!input || typeof input !== "object") return response({ error: "invalid_input" }, 400);
    if (path === "/api/auth/signout") {
      const current = await session().catch(() => ({ token: null }));
      if (current.token) await api("logout?scope=local", "POST", {}, current.token).catch(() => {
      });
      return response({ user: null }, 200, clearCookies(request));
    }
    if (path === "/api/auth/password") {
      if (typeof input.password !== "string" || input.password.length < 8 || input.password.length > 128) return response({ error: "weak_password" }, 400);
      const current = await session();
      if (!current.user) return response({ error: "session_expired" }, 401, current.cookies);
      const updated = await api("user", "PUT", { password: input.password }, current.token);
      return updated.ok ? response({ user: publicUser(updated.data) }, 200, current.cookies) : response({ error: authError(updated.status, updated.data) }, 400, current.cookies);
    }
    if (!["/api/auth/signin", "/api/auth/signup", "/api/auth/recover"].includes(path)) return response({ error: "not_found" }, 404);
    const email = typeof input.email === "string" ? input.email.trim() : "";
    if (!email.includes("@") || email.length > 254) return response({ error: "invalid_input" }, 400);
    const redirectTo = encodeURIComponent(`${url.origin}/auth/confirm`);
    if (path === "/api/auth/recover") {
      const result2 = await api(`recover?redirect_to=${redirectTo}`, "POST", { email });
      return result2.ok ? response({ message: "reset_sent" }) : response({ error: authError(result2.status, result2.data) }, result2.status === 429 ? 429 : 400);
    }
    const password = input.password;
    if (typeof password !== "string" || password.length < (path.endsWith("signup") ? 8 : 1) || password.length > 128) return response({ error: "weak_password" }, 400);
    const endpoint = path.endsWith("signup") ? `signup?redirect_to=${redirectTo}` : "token?grant_type=password";
    const result = await api(endpoint, "POST", { email, password });
    if (!result.ok) return response({ error: authError(result.status, result.data) }, result.status === 429 ? 429 : 400);
    if (result.data.access_token && result.data.refresh_token && publicUser(result.data.user)) {
      return response({ user: publicUser(result.data.user) }, 200, sessionCookies(result.data, request));
    }
    if (path.endsWith("signup")) return response({ message: "confirmation_sent" });
    return response({ error: "auth_failed" }, 502);
  } catch {
    return callback ? redirect("linkExpired") : response({ error: "service_unavailable" }, 503);
  }
}
function handleLanguage(request) {
  if (new URL(request.url).pathname !== "/api/language.js") return null;
  if (!["GET", "HEAD"].includes(request.method)) {
    const result = response({ error: "method_not_allowed" }, 405);
    result.headers.set("Allow", "GET, HEAD");
    return result;
  }
  const language = request.cf?.country === "UA" ? "uk" : "en";
  return new Response(request.method === "HEAD" ? null : `globalThis.AutoMethodsLanguage?.applyCountryLanguage('${language}');
`, {
    headers: { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }
  });
}
var auth_worker_default = {
  async fetch(request, env) {
    return await handleCeaEconomics(request) || await handleProjectDownloads(request, env) || handleLanguage(request) || await handleFeedback(request, env) || await handleAuth(request, env) || env.ASSETS.fetch(request);
  }
};
var maxFiles = 10;
var maxFileBytes = 2e7;
var maxRequestBytes = maxFileBytes + 65536;
var fileTypes = /* @__PURE__ */ new Set(["png", "jpg", "jpeg", "webp", "gif", "pdf", "csv", "txt", "log", "json", "zip", "docx", "xlsx", "mp4", "webm"]);
var emailAddress = (value) => typeof value === "string" && value.length <= 254 && /^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(value);
function feedbackConfigured(env) {
  return Boolean(env.RESEND_API_KEY?.startsWith("re_") && emailAddress(env.FEEDBACK_FROM) && emailAddress(env.FEEDBACK_TO) && env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET_KEY);
}
function emailBody(message, files) {
  const encoder = new TextEncoder();
  async function* chunks() {
    yield encoder.encode(JSON.stringify(message).slice(0, -1) + ',"attachments":[');
    for (let index = 0; index < files.length; index++) {
      const file = files[index];
      yield encoder.encode((index ? "," : "") + '{"filename":' + JSON.stringify(file.name) + ',"content":"');
      for (let offset = 0; offset < file.size; offset += 49152) {
        const bytes = await file.slice(offset, offset + 49152).arrayBuffer();
        yield encoder.encode(Buffer.from(bytes).toString("base64"));
      }
      yield encoder.encode('"}');
    }
    yield encoder.encode("]}");
  }
  const iterator = chunks();
  return new ReadableStream({
    async pull(controller) {
      try {
        const { value, done } = await iterator.next();
        if (done) controller.close();
        else controller.enqueue(value);
      } catch (error) {
        controller.error(error);
      }
    },
    cancel() {
      return iterator.return();
    }
  });
}
async function handleFeedback(request, env, transport = fetch) {
  const url = new URL(request.url);
  if (url.pathname !== "/api/feedback" && url.pathname !== "/api/feedback/config") return null;
  if (url.pathname === "/api/feedback/config") {
    if (request.method !== "GET") return response({ error: "method_not_allowed" }, 405);
    return response({ configured: feedbackConfigured(env), siteKey: feedbackConfigured(env) ? env.TURNSTILE_SITE_KEY : "", maxFiles, maxFileBytes });
  }
  if (request.method !== "POST") return response({ error: "method_not_allowed" }, 405);
  if (request.headers.get("Origin") !== url.origin) return response({ error: "invalid_origin" }, 403);
  if (!feedbackConfigured(env)) return response({ error: "feedback_unconfigured" }, 503);
  if (!request.headers.get("Content-Type")?.startsWith("multipart/form-data;")) return response({ error: "invalid_input" }, 415);
  if (Number(request.headers.get("Content-Length")) > maxRequestBytes) return response({ error: "files_too_large" }, 413);
  const token = request.headers.get("X-Turnstile-Token");
  if (!token || token.length > 2048) return response({ error: "verification_failed" }, 403);
  try {
    if (env.FEEDBACK_RATE_LIMITER) {
      const limit = await env.FEEDBACK_RATE_LIMITER.limit({ key: request.headers.get("CF-Connecting-IP") || "unknown" });
      if (!limit.success) return response({ error: "rate_limit" }, 429);
    }
    const verification = await transport("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(1e4),
      body: JSON.stringify({ secret: env.TURNSTILE_SECRET_KEY, response: token, remoteip: request.headers.get("CF-Connecting-IP") || void 0 })
    });
    if (!verification.ok) return response({ error: "service_unavailable" }, 503);
    const verified = await verification.json();
    if (!verified.success || verified.action !== "feedback" || verified.hostname !== url.hostname) return response({ error: "verification_failed" }, 403);
    let bytes = 0;
    let tooLarge = false;
    const bounded = request.body.pipeThrough(new TransformStream({ transform(chunk, controller) {
      bytes += chunk.byteLength;
      if (bytes > maxRequestBytes) {
        tooLarge = true;
        throw new Error("files_too_large");
      }
      controller.enqueue(chunk);
    } }));
    let input;
    try {
      input = await new Request(request.url, { method: "POST", headers: request.headers, body: bounded, duplex: "half" }).formData();
    } catch {
      return response({ error: tooLarge ? "files_too_large" : "invalid_input" }, tooLarge ? 413 : 400);
    }
    const field = (name) => typeof input.get(name) === "string" ? input.get(name).trim() : "";
    if (field("website")) return response({ error: "invalid_input" }, 400);
    const kind = field("kind");
    const text = field("message");
    const reply = field("reply_email");
    const id = field("submission_id");
    if (!["issue", "suggestion", "other"].includes(kind) || !text || text.length > 1e4 || reply && !emailAddress(reply) || !/^[a-f\d]{8}(-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(id)) return response({ error: "invalid_input" }, 400);
    const files = input.getAll("files").filter((file) => typeof file !== "string" && file.name);
    if (files.length > maxFiles) return response({ error: "too_many_files" }, 400);
    if (files.reduce((sum, file) => sum + file.size, 0) > maxFileBytes) return response({ error: "files_too_large" }, 413);
    for (const file of files) {
      if (file.name.length > 180 || /[\x00-\x1f\x7f/\\]/.test(file.name) || !fileTypes.has(file.name.split(".").pop().toLowerCase())) return response({ error: "unsupported_file" }, 400);
    }
    let page = "";
    try {
      const source = new URL(field("page"));
      if (source.origin === url.origin) page = source.origin + source.pathname;
    } catch {
    }
    const version = field("version").replace(/[^\w.\-]/g, "").slice(0, 32);
    const message = {
      from: env.FEEDBACK_FROM,
      to: [env.FEEDBACK_TO],
      ...reply ? { reply_to: reply } : {},
      subject: `[AutoMethods] ${kind === "issue" ? "Issue report" : kind === "suggestion" ? "Suggestion" : "Feedback"} \xB7 ${id.slice(0, 8)}`,
      text: `${text}

---
Reply email: ${reply || "Not supplied"}
Page: ${page || url.origin}
Version: ${version || "Unknown"}
Language: ${field("language") === "uk" ? "uk" : "en"}
Files: ${files.length}
Reference: ${id}`
    };
    const sent = await transport("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": `feedback/${id}` },
      body: emailBody(message, files),
      duplex: "half",
      signal: AbortSignal.timeout(6e4)
    });
    if (!sent.ok) return response({ error: sent.status === 429 ? "rate_limit" : "send_failed" }, sent.status === 429 ? 429 : 502);
    const receipt = await sent.json();
    if (!receipt.id) return response({ error: "send_failed" }, 502);
    return response({ message: "feedback_sent", reference: id.slice(0, 8) });
  } catch {
    return response({ error: "service_unavailable" }, 503);
  }
}
async function handleProjectDownloads(request, env, transport = fetch) {
  let path;
  try {
    path = decodeURIComponent(new URL(request.url).pathname);
  } catch {
    return new Response("Invalid URL", { status: 400 });
  }
  const project = path.match(/^\/projects\/(automobile|mechanics|machine-elements|detali-mashyn|tea|engine|ice|cea)\/(.*)$/i);
  if (!project) return null;
  const relative = project[2];
  const document = /^(?:downloads|docs)(?:\/|$)/i.test(relative) || /\.pdf(?:\/|$)/i.test(relative) || /^(?:build|examples)(?:\/|$)/i.test(relative) && !/\.(?:json|csv)$/i.test(relative);
  if (!document) return null;
  const sessionRequest = new Request(new URL("/api/session", request.url), { headers: request.headers });
  const session = await handleAuth(sessionRequest, env, transport), data = await session.json();
  if (!data.configured || !data.user?.id) return response({ error: "signin_required" }, 401, session.headers.getSetCookie());
  const result = await env.ASSETS.fetch(request), headers = new Headers(result.headers);
  headers.set("Cache-Control", "private, no-store");
  headers.set("Vary", "Cookie");
  for (const value of session.headers.getSetCookie()) headers.append("Set-Cookie", value);
  return new Response(result.body, { status: result.status, headers });
}
var handleMechanicsDownloads = handleProjectDownloads;
export {
  auth_worker_default as default,
  handleAuth,
  handleFeedback,
  handleLanguage,
  handleMechanicsDownloads,
  handleProjectDownloads
};
