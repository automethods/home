(function initializeLanguage(root) {
  const storageKey = 'motion-lab-language';
  const automaticKey = 'motion-lab-language-auto';
  const supported = value => value === 'en' || value === 'uk';
  let language;
  let countryFallback = 'en';

  function applyCountryLanguage(countryLanguage = countryFallback) {
    countryFallback = countryLanguage === 'uk' ? 'uk' : 'en';
    let saved;
    let automatic;
    try {
      saved = root.localStorage.getItem(storageKey);
      automatic = root.localStorage.getItem(automaticKey);
    } catch {}
    const preferred = (root.navigator.languages?.length ? root.navigator.languages : [root.navigator.language])
      .map(value => typeof value === 'string' ? value.toLowerCase().split('-')[0] : '')
      .find(supported);
    const manual = supported(saved) && saved !== automatic;
    language = manual ? saved : preferred || countryFallback;
    root.document.documentElement.lang = language;
    root.document.documentElement.dataset.language = language;
    if (!manual) {
      try {
        root.localStorage.setItem(storageKey, language);
        root.localStorage.setItem(automaticKey, language);
      } catch {}
    }
  }

  root.document.addEventListener('click', event => {
    const button = event.target.closest?.('button[data-language], button[data-language-choice]');
    const selected = button?.dataset.language || button?.dataset.languageChoice;
    if (!supported(selected)) return;
    language = selected;
    try {
      root.localStorage.setItem(storageKey, selected);
      root.localStorage.removeItem(automaticKey);
    } catch {}
  }, true);

  root.addEventListener('pageshow', event => {
    if (!event.persisted) return;
    applyCountryLanguage();
    root.VehicleI18n?.setLanguage(language);
    root.document.dispatchEvent(new root.Event('automethodslanguagechange'));
  });

  root.AutoMethodsLanguage = Object.freeze({ get language() { return language; }, applyCountryLanguage });
  applyCountryLanguage();
})(globalThis);
