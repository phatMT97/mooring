// Line icons from Lucide (ISC licence), inlined so they inherit currentColor.

const svg = (body) =>
  `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;

export const icons = {
  chevronRight: svg(`<path d="m9 6 6 6-6 6"/>`),
  restart: svg(`<path d="M3 11a9 9 0 1 1 2.6 7.4"/><path d="M3 4v7h7"/>`),
  plus: svg(`<path d="M5 12h14"/><path d="M12 5v14"/>`),
  x: svg(`<path d="M18 6 6 18"/><path d="m6 6 12 12"/>`),
  pin: svg(`<path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>`),
  pinOff: svg(`<path d="M12 17v5"/><path d="M15 9.34V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H7.89"/><path d="m2 2 20 20"/><path d="M9 9v1.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h11"/>`),
  share: svg(`<path d="M12 3v12"/><path d="m8 11 4 4 4-4"/><path d="M8 5H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-4"/>`),
  play: svg(`<path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.4-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5z"/>`),
  check: svg(`<path d="M20 6 9 17l-5-5"/>`),
  palette: svg(`<circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/>`),
  search: svg(`<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>`),
  chevronUp: svg(`<path d="m18 15-6-6-6 6"/>`),
  chevronDown: svg(`<path d="m6 9 6 6 6-6"/>`),
  splitRight: svg(`<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M12 3v18"/>`),
  splitDown: svg(`<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 12h18"/>`),
  unsplit: svg(`<rect width="18" height="18" x="3" y="3" rx="2"/>`),
  keyboard: svg(`<path d="M10 8h.01"/><path d="M12 12h.01"/><path d="M14 8h.01"/><path d="M16 12h.01"/><path d="M18 8h.01"/><path d="M6 8h.01"/><path d="M7 16h10"/><path d="M8 12h.01"/><rect width="20" height="16" x="2" y="4" rx="2"/>`),
  panel: svg(`<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/>`),
  moon: svg(`<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>`),
  claude: svg(`<path d="M12 2.5v19M2.5 12h19M5.3 5.3l13.4 13.4M5.3 18.7 18.7 5.3" stroke-width="2.25"/>`),
  agy: svg(`<path d="M12 3c0 4.97 4.03 9 9 9-4.97 0-9 4.03-9 9 0-4.97-4.03-9-9-9 4.97 0 9-4.03 9-9Z" fill="currentColor" stroke="none"/>`),
  codex: svg(`<path d="M22.28 9.82a5.98 5.98 0 0 0-.51-4.91 6.05 6.05 0 0 0-6.51-2.9A6.06 6.06 0 0 0 4.98 4.18a5.98 5.98 0 0 0-4 2.9 6.05 6.05 0 0 0 .74 7.1 5.98 5.98 0 0 0 .51 4.91 6.05 6.05 0 0 0 6.52 2.9A5.98 5.98 0 0 0 13.26 24a6.05 6.05 0 0 0 5.77-4.2 5.99 5.99 0 0 0 4-2.9 6.06 6.06 0 0 0-.75-7.08zm-9.02 12.61a4.48 4.48 0 0 1-2.88-1.04l.14-.08 4.78-2.76a.8.8 0 0 0 .4-.68v-6.74l2.02 1.17a.07.07 0 0 1 .03.05v5.59a4.5 4.5 0 0 1-4.49 4.49zm-9.66-4.13a4.47 4.47 0 0 1-.54-3.01l.15.08 4.78 2.76a.77.77 0 0 0 .78 0l5.84-3.37v2.33a.08.08 0 0 1-.03.06L9.74 19.95a4.5 4.5 0 0 1-6.14-1.65zM2.34 7.9a4.48 4.48 0 0 1 2.37-1.98v5.68a.77.77 0 0 0 .38.68l5.82 3.35-2.02 1.17a.08.08 0 0 1-.07 0l-4.83-2.79A4.5 4.5 0 0 1 2.34 7.87zm16.6 3.85L13.1 8.36l2.02-1.16a.08.08 0 0 1 .07 0l4.83 2.79a4.5 4.5 0 0 1-.68 8.1v-5.67a.79.79 0 0 0-.4-.67zm2.01-3.02l-.14-.09-4.77-2.78a.78.78 0 0 0-.79 0L9.41 9.23V6.9a.07.07 0 0 1 .03-.06l4.83-2.79a4.5 4.5 0 0 1 6.68 4.66zM8.3 12.86l-2.02-1.16a.08.08 0 0 1-.04-.06V6.07a4.5 4.5 0 0 1 7.38-3.45l-.14.08-4.78 2.76a.8.8 0 0 0-.4.68zm1.1-2.36l2.6-1.5 2.61 1.5v3l-2.6 1.5-2.61-1.5Z" fill="currentColor" stroke="none"/>`),
};

// Fill every <i data-icon="name"></i> in the static markup.
export function hydrateIcons(root = document) {
  for (const el of root.querySelectorAll("i[data-icon]")) el.outerHTML = icons[el.dataset.icon];
}
