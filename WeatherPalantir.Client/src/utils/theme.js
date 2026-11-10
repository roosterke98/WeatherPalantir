import { useSyncExternalStore } from 'react';

/**
 * Világos / sötét téma. A választás a <html data-theme> attribútumba kerül (a CSS változók ehhez igazodnak),
 * és a böngészőben megmarad. Ha a felhasználó még nem választott, a rendszer beállítását követi.
 */
const KEY = 'wp-theme';
const listeners = new Set();

function readStored() {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null;
  }
}

const systemTheme = () => (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

let current = readStored() ?? systemTheme();
document.documentElement.dataset.theme = current;

export const getTheme = () => current;

export function setTheme(theme) {
  current = theme;
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* privát mód: csak a munkamenetre érvényes */
  }
  listeners.forEach((l) => l());
}

const subscribe = (l) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** A D3-as ábrák ezt a függőséget használják, hogy témaváltáskor újrarajzolódjanak. */
export const useTheme = () => useSyncExternalStore(subscribe, getTheme);
