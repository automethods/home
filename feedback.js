import { t } from './i18n.js';

const dialog = document.querySelector('#feedback-dialog');
const form = document.querySelector('#feedback-form');
const fields = document.querySelector('#feedback-fields');
const submit = document.querySelector('#feedback-submit');
const status = document.querySelector('#feedback-status');
const close = document.querySelector('[data-feedback-close]');
const filesInput = document.querySelector('#feedback-files');
const summary = document.querySelector('#feedback-file-summary');
const verification = document.querySelector('#feedback-verification');
const extensions = new Set(filesInput.accept.split(',').map(value => value.slice(1)));
const errors = {
  feedback_unconfigured: 'feedbackUnconfigured', files_too_large: 'feedbackTooLarge', too_many_files: 'feedbackTooMany',
  unsupported_file: 'feedbackUnsupported', invalid_input: 'feedbackInvalid', verification_failed: 'feedbackVerifyFailed',
  rate_limit: 'feedbackRateLimit', send_failed: 'feedbackFailed', service_unavailable: 'feedbackFailed',
};
let config;
let loading = false;
let busy = false;
let sent = false;
let message = '';
let isError = false;
let reference = '';
let token = '';
let widget;
let widgetLanguage;
let scriptPromise;
let submissionId = crypto.randomUUID();

function fileError() {
  const files = [...filesInput.files];
  if (files.length > 10) return 'feedbackTooMany';
  if (files.reduce((sum, file) => sum + file.size, 0) > 20_000_000) return 'feedbackTooLarge';
  if (files.some(file => file.name.length > 180 || /[\x00-\x1f\x7f/\\]/.test(file.name) || !extensions.has(file.name.split('.').pop().toLowerCase()))) return 'feedbackUnsupported';
  return '';
}
function render() {
  const validation = fileError();
  fields.disabled = busy;
  fields.hidden = sent;
  submit.hidden = sent;
  submit.disabled = loading || busy || sent || !config?.configured || !token || Boolean(validation);
  submit.textContent = t(busy ? 'feedbackSending' : 'feedbackSend');
  close.disabled = busy;
  status.dataset.error = String(isError || Boolean(validation));
  status.textContent = t(validation || message || (loading ? 'feedbackChecking' : !config?.configured ? 'feedbackUnconfigured' : !token ? 'feedbackVerify' : ''), { reference });
  summary.replaceChildren();
  const files = [...filesInput.files];
  if (files.length) {
    const total = document.createElement('p');
    total.textContent = t('feedbackFileSummary', { count: files.length, size: (files.reduce((sum, file) => sum + file.size, 0) / 1_000_000).toFixed(2) });
    const list = document.createElement('ul');
    for (const file of files) {
      const item = document.createElement('li');
      item.textContent = `${file.name} · ${(file.size / 1_000_000).toFixed(2)} MB`;
      list.append(item);
    }
    summary.append(total, list);
  }
}
function loadTurnstile() {
  if (window.turnstile) return Promise.resolve();
  if (!scriptPromise) scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const failed = () => { clearTimeout(timeout); script.remove(); scriptPromise = undefined; reject(new Error('verification_failed')); };
    const timeout = setTimeout(failed, 15_000);
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.onload = () => { clearTimeout(timeout); resolve(); };
    script.onerror = failed;
    document.head.append(script);
  });
  return scriptPromise;
}
function removeWidget() {
  if (widget !== undefined) window.turnstile?.remove(widget);
  widget = undefined;
  token = '';
}
function mountWidget() {
  removeWidget();
  widgetLanguage = document.documentElement.lang;
  widget = window.turnstile.render(verification, {
    sitekey: config.siteKey, action: 'feedback', theme: 'dark', language: widgetLanguage,
    size: innerWidth < 440 ? 'compact' : 'normal',
    callback(value) { token = value; if (message === 'feedbackVerifyFailed') { message = ''; isError = false; } render(); },
    'expired-callback'() { token = ''; render(); },
    'error-callback'() { token = ''; message = 'feedbackVerifyFailed'; isError = true; render(); },
  });
}
async function show() {
  if (dialog.open) return;
  sent = false; message = ''; isError = false; reference = '';
  const accountEmail = document.querySelector('#account-user');
  if (!form.elements.reply_email.value && !accountEmail.hidden) form.elements.reply_email.value = accountEmail.textContent;
  loading = true;
  render();
  dialog.showModal();
  try {
    const result = await fetch('/api/feedback/config', { cache: 'no-store', credentials: 'same-origin' });
    if (!result.ok) throw new Error('feedback_unconfigured');
    config = await result.json();
    if (config.configured) {
      await loadTurnstile();
      if (dialog.open) mountWidget();
    }
  } catch (error) { message = errors[error.message] || 'feedbackFailed'; isError = true; }
  finally { loading = false; render(); }
}
for (const button of document.querySelectorAll('[data-feedback-open]')) button.addEventListener('click', show);
close.addEventListener('click', () => dialog.close());
dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
dialog.addEventListener('close', () => {
  removeWidget();
  if (sent) { form.reset(); submissionId = crypto.randomUUID(); }
});
form.addEventListener('input', () => { submissionId = crypto.randomUUID(); delete form.dataset.submissionLanguage; message = ''; isError = false; render(); });
form.addEventListener('change', render);
document.addEventListener('languagechange', () => {
  render();
  if (dialog.open && !busy && !sent && widget !== undefined && widgetLanguage !== document.documentElement.lang) mountWidget();
});
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (busy || sent || loading || !config?.configured || !token || fileError()) return;
  // Construct FormData before disabling its fields.
  const data = new FormData(form);
  data.set('submission_id', submissionId);
  data.set('page', location.origin + location.pathname);
  data.set('version', document.querySelector('.header-version').textContent.trim());
  data.set('language', document.documentElement.lang);
  // Keep the same body/reference on a retry, even after switching languages.
  const language = form.dataset.submissionLanguage || document.documentElement.lang;
  form.dataset.submissionLanguage = language;
  data.set('language', language);
  busy = true; message = 'feedbackSending'; isError = false; render();
  try {
    const result = await fetch('/api/feedback', {
      method: 'POST', credentials: 'same-origin', body: data, headers: { 'X-Turnstile-Token': token }, signal: AbortSignal.timeout(120_000),
    });
    const receipt = await result.json().catch(() => ({}));
    if (!result.ok || receipt.message !== 'feedback_sent') throw new Error(receipt.error || 'send_failed');
    sent = true; reference = receipt.reference; message = 'feedbackSent';
    form.reset(); delete form.dataset.submissionLanguage; removeWidget();
  } catch (error) { message = errors[error.message] || 'feedbackFailed'; isError = true; }
  finally {
    busy = false;
    token = '';
    if (!sent && widget !== undefined) window.turnstile.reset(widget);
    render();
  }
});
render();
for (const button of document.querySelectorAll('[data-feedback-open]')) button.disabled = false;
