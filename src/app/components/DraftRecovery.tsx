import { useCallback, useEffect, useState } from 'react';
import { readRecovery, recoveryKey, removeRecovery, writeRecovery, type RecoveryDocument } from '../data/draftRecovery';

export function useDraftRecovery(ownerId: string, scope: string, dirty: boolean, document: RecoveryDocument) {
  const key = ownerId ? recoveryKey(ownerId, scope) : '';
  const read = () => { try { return key ? readRecovery(window.sessionStorage, key) : null; } catch { return null; } };
  const [copy, setCopy] = useState(read);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => { setCopy(read()); }, [key]);
  useEffect(() => {
    if (!key) return;
    if (!dirty) {
      if (!copy) {
        try { removeRecovery(window.sessionStorage, key); } catch { /* Storage may be disabled. */ }
      }
      return;
    }
    try { setUnavailable(!writeRecovery(window.sessionStorage, key, document)); }
    catch { setUnavailable(true); }
  }, [key, dirty, copy, document.templateId, document.name, document.text, document.html, document.baseUpdatedAt]);
  const clear = useCallback(() => {
    try { if (key) removeRecovery(window.sessionStorage, key); } catch { /* Storage may be disabled. */ }
    setCopy(null);
  }, [key]);
  return { copy, clear, unavailable };
}

export function DraftRecoveryNotice({ onRestore, onDiscard, busy = false, changedOnServer = false, documentLabel = 'contract' }: {
  onRestore: () => void;
  onDiscard: () => void;
  busy?: boolean;
  changedOnServer?: boolean;
  documentLabel?: string;
}) {
  return (
    <section role="status" aria-label="Draft recovery" className="rounded-[14px] border border-amber-500/50 bg-amber-500/10 p-4 text-sm">
      <p className="font-semibold">Unsaved edits found in this browser tab</p>
      <p className="mt-1 text-muted-foreground">Restore your working copy to continue editing. It has not been saved to your account.{changedOnServer && ` The saved ${documentLabel} has changed since this copy was made. Review both versions before saving.`}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={onRestore} className="rounded-lg border border-border bg-primary px-3 py-2 text-primary-foreground disabled:opacity-50">Restore unsaved edits</button>
        <button type="button" disabled={busy} onClick={onDiscard} className="rounded-lg border border-border px-3 py-2 disabled:opacity-50">Discard recovery copy</button>
      </div>
    </section>
  );
}
