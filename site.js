import { t } from './i18n.js';

const dialog = document.querySelector('#account-dialog');
const form = document.querySelector('#account-form');
const submit = document.querySelector('#account-submit');
const status = document.querySelector('#account-status');
const switchButton = document.querySelector('#account-switch');
const forgot = document.querySelector('#account-forgot');
const feedback = document.querySelector('#account-feedback');
document.querySelector('#copyright-year').textContent = String(new Date().getFullYear());
let action = 'signin';
let configured = false;
let checking = true;
let busy = false;
let message = '';
let isError = false;
let feedbackKey = '';

const descriptions = { signin: 'signInDescription', signup: 'signUpDescription', recover: 'recoverDescription', reset: 'resetDescription' };
const headings = { signin: 'signIn', signup: 'signUp', recover: 'recoverPassword', reset: 'newPassword' };
const errors = {
  auth_unconfigured: 'authUnconfigured', invalid_credentials: 'authInvalidCredentials', email_not_confirmed: 'authEmailNotConfirmed',
  weak_password: 'authWeakPassword', signup_disabled: 'authSignupDisabled', rate_limit: 'authRateLimit',
  session_expired: 'authSessionExpired', service_unavailable: 'authUnavailable', invalid_input: 'authInvalidInput',
};
function render() {
  dialog.querySelector('[data-account-heading]').textContent = t(headings[action]);
  document.querySelector('#account-description').textContent = t(descriptions[action]);
  const hasPassword = action !== 'recover';
  const confirmation = action === 'signup' || action === 'reset';
  document.querySelector('#account-email-field').hidden = action === 'reset';
  document.querySelector('#account-password-field').hidden = !hasPassword;
  document.querySelector('#account-confirm-field').hidden = !confirmation;
  document.querySelector('#account-password-hint').hidden = !confirmation;
  form.elements.email.required = action !== 'reset';
  form.elements.email.autocomplete = action === 'signup' ? 'email' : 'username';
  form.elements.password.required = hasPassword;
  form.elements.password.minLength = confirmation ? 8 : 1;
  form.elements.password.autocomplete = confirmation ? 'new-password' : 'current-password';
  form.elements.confirmation.required = confirmation;
  forgot.hidden = action !== 'signin';
  switchButton.textContent = t(action === 'signin' ? 'createAccount' : 'backSignIn');
  switchButton.disabled = forgot.disabled = busy;
  submit.disabled = !configured || checking || busy;
  submit.textContent = t(busy ? 'authWorking' : action === 'recover' ? 'sendResetLink' : action === 'reset' ? 'savePassword' : headings[action]);
  status.dataset.error = String(isError);
  status.textContent = t(message || (checking ? 'authChecking' : !configured ? 'authUnconfigured' : ''));
  feedback.textContent = feedbackKey ? t(feedbackKey) : '';
}
function setUser(user) {
  const label = document.querySelector('#account-user');
  label.hidden = !user;
  label.textContent = user?.email || '';
  label.title = user?.email || '';
  for (const button of document.querySelectorAll('[data-account-action]')) button.hidden = Boolean(user);
  document.querySelector('#account-signout').hidden = !user;
}
async function request(path, body) {
  const result = await fetch(path, { method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store',
    headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  const data = await result.json();
  if (!result.ok) throw new Error(data.error || 'auth_failed');
  return data;
}
async function refreshSession() {
  checking = true;
  render();
  try {
    const data = await request('/api/session');
    configured = data.configured === true;
    setUser(data.user);
    return data.user;
  } catch {
    configured = false;
    return null;
  } finally { checking = false; render(); }
}
function show(mode) {
  action = mode;
  message = '';
  isError = false;
  form.elements.password.value = form.elements.confirmation.value = '';
  render();
  if (!dialog.open) dialog.showModal();
}
for (const button of document.querySelectorAll('[data-account-action]')) {
  button.addEventListener('click', () => { show(button.dataset.accountAction); refreshSession(); });
}
document.querySelector('[data-account-close]').addEventListener('click', () => dialog.close());
dialog.addEventListener('close', () => { form.reset(); message = ''; });
switchButton.addEventListener('click', () => show(action === 'signin' ? 'signup' : 'signin'));
forgot.addEventListener('click', () => show('recover'));
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (busy || !configured || checking) return;
  if ((action === 'signup' || action === 'reset') && form.elements.password.value !== form.elements.confirmation.value) {
    message = 'authPasswordMismatch'; isError = true; render(); form.elements.confirmation.focus(); return;
  }
  busy = true; message = ''; isError = false; render();
  const submittedAction = action;
  try {
    const endpoint = submittedAction === 'reset' ? 'password' : submittedAction;
    const data = await request(`/api/auth/${endpoint}`, { email: form.elements.email.value, password: form.elements.password.value });
    form.elements.password.value = form.elements.confirmation.value = '';
    if (data.user) {
      setUser(data.user);
      if (dialog.open) dialog.close();
      if (submittedAction === 'reset') { feedbackKey = 'authPasswordSaved'; feedback.hidden = false; }
    } else {
      message = data.message === 'reset_sent' ? 'authResetSent' : 'authConfirmationSent';
    }
  } catch (error) {
    message = errors[error.message] || 'authFailed'; isError = true;
  } finally { busy = false; render(); }
});
document.querySelector('#account-signout').addEventListener('click', async event => {
  const button = event.currentTarget;
  button.disabled = true;
  try { await request('/api/auth/signout', {}); setUser(null); feedback.hidden = true; }
  catch { show('signin'); message = 'authUnavailable'; isError = true; render(); }
  finally { button.disabled = false; }
});
document.addEventListener('languagechange', render);
render();
const user = await refreshSession();
const url = new URL(location.href);
const result = url.searchParams.get('account');
if (result) {
  url.searchParams.delete('account');
  history.replaceState(null, '', url.pathname + url.search + url.hash);
  if (result === 'signin') show('signin');
  else if (result === 'reset' && user) show('reset');
  else if (result === 'confirmed' && user) { feedbackKey = 'authEmailConfirmed'; feedback.hidden = false; render(); }
  else { show('signin'); message = result === 'unconfigured' ? 'authUnconfigured' : 'authLinkExpired'; isError = true; render(); }
}
