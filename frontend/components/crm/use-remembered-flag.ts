'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * A yes/no the browser remembers, read the way React wants an external store
 * read.
 *
 * Both writing sheets stand at rest until the operator asks for the work
 * height, and both must come back at that height next time (03/09/2026, owner:
 * « l'espace de lecture de la réponse est trop petit »). localStorage is not
 * React state: it exists before the component, survives it, and is absent on
 * the server — a first render that already knew its value would not match the
 * HTML the server sent. Both sheets used to answer that with a mount effect
 * whose setState is exactly the cascading render the React Compiler rules name
 * (react-hooks/set-state-in-effect, rules turned on 2026-09-07).
 *
 * useSyncExternalStore is the hook for that shape and keeps the same contract:
 * React renders the server snapshot — false, the resting height — for
 * hydration, then swaps to the browser's answer on the commit right after,
 * which is what the effect did by hand.
 *
 * The listeners are module-wide rather than per key: a write is rare (one
 * click) and re-reading one's own key costs a getItem.
 */
const listeners = new Set<() => void>();

function subscribe(notify: () => void): () => void {
  listeners.add(notify);
  return () => {
    listeners.delete(notify);
  };
}

/** A boolean, never a throw: a private window refuses storage outright. */
function read(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

export function useRememberedFlag(key: string): [boolean, (next: boolean) => void] {
  // The snapshot is a primitive, so React compares it by value and a fresh
  // closure per render costs nothing.
  const value = useSyncExternalStore(
    subscribe,
    () => read(key),
    // The server has no storage; it renders the resting state, always.
    () => false,
  );
  const remember = useCallback((next: boolean) => {
    try {
      localStorage.setItem(key, next ? '1' : '0');
    } catch {
      // Nothing to remember; the toggle still works for this sheet.
    }
    for (const notify of listeners) notify();
  }, [key]);
  return [value, remember];
}
