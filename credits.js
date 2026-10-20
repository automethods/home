import './i18n.js?v=0.5.11';
import views from './assets/credits/views.js';

function render() {
  const view = views[document.documentElement.lang] || views.uk;
  const organisations = document.querySelector('#shared-organisations');
  const openIds = [...organisations.querySelectorAll('details[open]')].map(item => item.id);
  // These fragments are escaped at build time from the local editorial registry.
  organisations.innerHTML = view.organisations;
  for (const id of openIds) {
    const item = document.getElementById(id);
    if (item) item.open = true;
  }
  const about = document.querySelector('#about-project');
  about.querySelector('summary').textContent = view.title;
  about.querySelector('.project-credits').innerHTML = view.about;
  for (const year of about.querySelectorAll('[data-credit-year]')) year.textContent = String(new Date().getFullYear());
}
document.addEventListener('languagechange', render);
render();
