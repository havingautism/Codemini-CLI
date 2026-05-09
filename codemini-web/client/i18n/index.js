import { zh } from './zh.js';
import { en } from './en.js';

const locales = { zh, en };
let current = 'zh';

// Load initial locale from localStorage if available
const savedLocale = localStorage.getItem('codemini-ui-language');
if (savedLocale && locales[savedLocale]) {
  current = savedLocale;
}

export function setLocale(locale) {
  if (locales[locale]) {
    current = locale;
    localStorage.setItem('codemini-ui-language', locale);
  }
}

export function t(key) {
  return locales[current][key] || locales.en[key] || key;
}

export function getLocale() {
  return current;
}
