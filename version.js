const APP_VERSION = { hash: "3c46f7f", date: "2026-06-18", label: "3c46f7f · 2026-06-18" };
(function () {
  function inject() {
    document.querySelectorAll('[data-version]').forEach(function (el) {
      el.textContent = APP_VERSION.label;
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject);
  } else {
    inject();
  }
})();
