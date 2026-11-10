import { useCallback, useEffect, useState } from 'react';
import { recoveryKey } from '../data/draftRecovery';

export type ProjectWorkingCopy = {
  title: string;
  lyrics: string;
  note: string;
  detailsDirty: boolean;
  audioFileName: string;
  baseUpdatedAt?: string;
};

function readCopy(key: string): ProjectWorkingCopy | null {
  try {
    const copy = JSON.parse(window.sessionStorage.getItem(key) || 'null');
    if (!copy || copy.version !== 1 ||
      !['title', 'lyrics', 'note', 'audioFileName'].every((field) => typeof copy[field] === 'string') ||
      typeof copy.detailsDirty !== 'boolean' ||
      (copy.baseUpdatedAt !== undefined && typeof copy.baseUpdatedAt !== 'string')) return null;
    return copy;
  } catch { return null; }
}

// Mount the editor with an account/project key so a different song cannot inherit its drafts.
export function useProjectRecovery(ownerId: string, scope: string, dirty: boolean, working: ProjectWorkingCopy) {
  const key = ownerId ? recoveryKey(ownerId, `song-project:${scope}`) : '';
  const [copy, setCopy] = useState(() => key ? readCopy(key) : null);
  const [unavailable, setUnavailable] = useState(false);
  const clear = useCallback(() => {
    try { if (key) window.sessionStorage.removeItem(key); } catch { /* Navigation protection remains active. */ }
    setCopy(null);
  }, [key]);
  useEffect(() => {
    if (!key || copy) return;
    try {
      if (dirty) window.sessionStorage.setItem(key, JSON.stringify({ ...working, version: 1 }));
      else window.sessionStorage.removeItem(key);
      setUnavailable(false);
    } catch { setUnavailable(true); }
  }, [key, copy, dirty, working.title, working.lyrics, working.note, working.detailsDirty, working.audioFileName, working.baseUpdatedAt]);
  return { copy, clear, unavailable };
}

export function ProjectRecoveryWarning({ unavailable }: { unavailable: boolean }) {
  return unavailable ? <p role="alert" className="text-sm text-amber-700 dark:text-amber-200">
    Recovery is unavailable in this browser. Save your project edits before refreshing or closing this tab.
  </p> : null;
}
