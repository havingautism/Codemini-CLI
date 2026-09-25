import { zh } from './zh.js';
import { en } from './en.js';

const locales = { zh, en };
let current = 'zh';

// Load initial locale from localStorage if available
const savedLocale = localStorage.getItem('codemini-ui-language');
if (savedLocale && locales[savedLocale]) {
  current = savedLocale;
}

function syncDocumentLocale(locale) {
  document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en';
}

syncDocumentLocale(current);

export function setLocale(locale) {
  if (locales[locale]) {
    current = locale;
    localStorage.setItem('codemini-ui-language', locale);
    syncDocumentLocale(locale);
  }
}

export function t(key) {
  return locales[current][key] || locales.en[key] || key;
}

export function tList(key) {
  const value = locales[current]?.[key] ?? locales.en?.[key];
  if (Array.isArray(value)) return value.map(String);
  if (value == null) return [];
  return [String(value)];
}

export function getLocale() {
  return current;
}
