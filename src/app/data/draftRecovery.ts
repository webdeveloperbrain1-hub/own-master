export type RecoveryDocument = {
  templateId: string;
  name: string;
  text: string;
  html: string;
  baseUpdatedAt?: string;
};
export type RecoveryCopy = RecoveryDocument & { version: 1; recoveredAt: string };
type RecoveryStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function recoveryKey(owner: string, scope: string) {
  return `own_masters_recovery:${encodeURIComponent(owner)}:${encodeURIComponent(scope)}`;
}

export function readRecovery(storage: RecoveryStorage, key: string): RecoveryCopy | null {
  try {
    const copy = JSON.parse(storage.getItem(key) || 'null');
    if (!copy || copy.version !== 1 ||
      !['templateId', 'name', 'text', 'html', 'recoveredAt'].every((field) => typeof copy[field] === 'string') ||
      !copy.templateId || !Number.isFinite(Date.parse(copy.recoveredAt)) ||
      (copy.baseUpdatedAt !== undefined && typeof copy.baseUpdatedAt !== 'string')) return null;
    return copy;
  } catch { return null; }
}

export function writeRecovery(storage: RecoveryStorage, key: string, document: RecoveryDocument) {
  try {
    storage.setItem(key, JSON.stringify({ ...document, version: 1, recoveredAt: new Date().toISOString() }));
    return true;
  } catch { return false; }
}

export function removeRecovery(storage: RecoveryStorage, key: string) {
  try { storage.removeItem(key); } catch { /* Navigation protection still works without storage. */ }
}
