/**
 * Конфигурация приложения
 * GAS_API — URL вашего Google Apps Script (Развёртывание → Веб-приложение)
 * AI_API — базовый URL сервера с ИИ (пустая строка = тот же хост, при запуске через node server.js)
 */
window.CONFIG = {
  GAS_API: 'https://script.google.com/macros/s/AKfycbzdUJPckbzpWXsG4GEE5i6slvy2OnnhUecf8IU4zs_rzL1Gg_vCZQGEgju14eZX8ti2uw/exec',
  AI_API: ''  // Оставьте пустым при запуске через node server.js (сайт на том же хосте)
};
