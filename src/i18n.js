// UI languages. Each one is a JSON file in ./locales named by its code (vi.json, en.json, …) with
// "_name" as the name shown in the picker. To add a language, copy en.json, translate the values
// and rebuild: it is picked up automatically. Missing keys fall back to English.
//
//   t("group.needs", { n: 2 })            -> "2 cần bạn"
//   <button data-i18n-label="split.off">  -> title + aria-label, kept in sync by translateDom()
//   <input data-i18n-placeholder="…">     -> placeholder

const files = import.meta.glob("./locales/*.json", { eager: true, import: "default" });

export const LANGS = Object.entries(files)
  .map(([path, dict]) => ({ code: path.match(/([\w-]+)\.json$/)[1], name: dict._name, dict }))
  .sort((a, b) => a.name.localeCompare(b.name));

const EN = LANGS.find((l) => l.code === "en") || LANGS[0];
let current = EN;

export function setLang(code) {
  current = LANGS.find((l) => l.code === code) || current;
  document.documentElement.lang = current.code;
  translateDom();
  return current.code;
}

export const lang = () => current.code;

// The system language when we have it, else English.
export function defaultLang() {
  const want = (navigator.language || "en").toLowerCase();
  return (LANGS.find((l) => want === l.code || want.startsWith(l.code + "-")) || EN).code;
}

export function t(key, vars) {
  let s = current.dict[key] ?? EN.dict[key] ?? key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  return s;
}

export function translateDom(root = document) {
  for (const el of root.querySelectorAll("[data-i18n-label]")) {
    el.title = t(el.dataset.i18nLabel);
    el.setAttribute("aria-label", el.title);
  }
  for (const el of root.querySelectorAll("[data-i18n-placeholder]")) el.placeholder = t(el.dataset.i18nPlaceholder);
}
