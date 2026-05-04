import { zh } from './zh.js';
import { en } from './en.js';

const locales = { zh, en };
let current = 'zh';

export function setLocale(locale) {
  if (locales[locale]) current = locale;
}

export function t(key) {
  return locales[current][key] || locales.en[key] || key;
}

export function getLocale() {
  return current;
}
