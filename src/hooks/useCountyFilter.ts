import { useSyncExternalStore } from 'react';

// The county chosen on the evaluation pages. Kept outside the components so it stays selected
// when moving between Overview, Financial screening, Eligibility and Scorecard.
let county = '';
const listeners = new Set<() => void>();

export function setCountyFilter(value: string) {
  county = value;
  listeners.forEach((l) => l());
}

export function useCountyFilter(): [string, (value: string) => void] {
  const value = useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    () => county,
    () => '',
  );
  return [value, setCountyFilter];
}
