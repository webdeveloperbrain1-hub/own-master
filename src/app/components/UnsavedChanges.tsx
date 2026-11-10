import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useBlocker } from 'react-router';
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from './ui/alert-dialog';

type Guard = { id: symbol; dirty: boolean; busy: boolean; discard: () => void };
type LeaveAction = () => void | Promise<void>;
type GuardContext = {
  register: (guard: Guard) => () => void;
  markClean: (id: symbol) => boolean;
  requestLeave: (action: LeaveAction) => void;
};
const Context = createContext<GuardContext | null>(null);

export function UnsavedChangesProvider({ children }: { children: ReactNode }) {
  const current = useRef<Guard | null>(null);
  const bypass = useRef(false);
  const [guard, setGuard] = useState<Guard | null>(null);
  const [action, setAction] = useState<LeaveAction | null>(null);
  const blocker = useBlocker(useCallback(({ currentLocation, nextLocation }) =>
    !bypass.current && Boolean(current.current?.dirty || current.current?.busy) &&
    (currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search), []));
  const pending = useRef(false);
  pending.current = blocker.state === 'blocked' || Boolean(action);

  const register = useCallback((next: Guard) => {
    current.current = next;
    setGuard(next);
    return () => {
      if (current.current?.id === next.id) {
        current.current = null;
        setGuard(null);
      }
    };
  }, []);
  const markClean = useCallback((id: symbol) => {
    if (current.current?.id === id) {
      current.current.dirty = false;
      current.current.busy = false;
    }
    return pending.current;
  }, []);
  const requestLeave = useCallback((next: LeaveAction) => {
    if (current.current?.dirty || current.current?.busy) setAction(() => next);
    else void next();
  }, []);
  const context = useMemo(() => ({ register, markClean, requestLeave }), [register, markClean, requestLeave]);

  useEffect(() => {
    if (!guard?.dirty && !guard?.busy) return;
    const warn = (event: BeforeUnloadEvent) => {
      if (!current.current?.dirty && !current.current?.busy) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [guard?.dirty, guard?.busy]);

  // A save may finish while a navigation is waiting. Only proceed after success.
  useEffect(() => {
    if (guard?.dirty || guard?.busy) return;
    if (blocker.state === 'blocked') blocker.proceed();
    if (action) {
      setAction(null);
      bypass.current = true;
      void Promise.resolve(action()).finally(() => { bypass.current = false; });
    }
  }, [blocker, guard, action]);

  function stay() {
    setAction(null);
    if (blocker.state === 'blocked') blocker.reset();
  }

  async function leave() {
    if (current.current?.busy) return;
    current.current?.discard();
    setAction(null);
    if (blocker.state === 'blocked') blocker.proceed();
    if (action) {
      // Logout must be confirmed before invalidating the session.
      bypass.current = true;
      try { await action(); } finally { bypass.current = false; }
    }
  }

  return (
    <Context.Provider value={context}>
      {children}
      <AlertDialog open={blocker.state === 'blocked' || Boolean(action)} onOpenChange={(open) => { if (!open) stay(); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{guard?.busy ? 'Your changes are being saved' : 'You have unsaved changes'}</AlertDialogTitle>
            <AlertDialogDescription>
              {guard?.busy ? 'Please wait for saving to finish before leaving.' : 'Stay here to keep editing and save your work, or discard your changes and leave.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={stay}>Stay and edit</AlertDialogCancel>
            <button type="button" disabled={guard?.busy} onClick={() => void leave()} className="rounded-md border border-destructive/50 bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground disabled:opacity-50">
              Discard and leave
            </button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Context.Provider>
  );
}

export function useLeaveConfirmation() {
  const context = useContext(Context);
  if (!context) throw new Error('UnsavedChangesProvider is required.');
  return context.requestLeave;
}

export function useUnsavedChanges(dirty: boolean, busy = false, onDiscard?: () => void) {
  const context = useContext(Context);
  if (!context) throw new Error('UnsavedChangesProvider is required.');
  const { register, markClean } = context;
  const id = useRef(Symbol('editor'));
  const discard = useRef(onDiscard);
  discard.current = onDiscard;
  useLayoutEffect(() => register({ id: id.current, dirty, busy, discard: () => discard.current?.() }), [register, dirty, busy]);
  return useCallback(() => markClean(id.current), [markClean]);
}
