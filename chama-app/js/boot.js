/* boot.js — start the app and register the service worker (https only). */
(function () {
'use strict';
window.App.start();
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
  window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function (e) { console.warn('Service worker not registered:', e.message); }); });
}
})();
