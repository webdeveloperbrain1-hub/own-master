/** One observer for the app, including content added after a route/data change. */
export function installScrollMotion(root: HTMLElement): () => void {
  const view = root.ownerDocument.defaultView;
  if (!view || !('IntersectionObserver' in view)) return () => {};

  const reduced = view.matchMedia?.('(prefers-reduced-motion: reduce)');
  const seen = new WeakSet<HTMLElement>();
  const active = new Set<HTMLElement>();
  const timers = new Map<HTMLElement, number>();
  const documentContent = '[contenteditable="true"], .contract-document, canvas, iframe';
  let disposed = false;

  function finish(element: HTMLElement) {
    element.dataset.revealState = 'visible';
    element.style.removeProperty('--reveal-delay');
    observer.unobserve(element);
    active.delete(element);
    const timer = timers.get(element);
    if (timer !== undefined) view!.clearTimeout(timer);
    timers.delete(element);
  }

  function reveal(element: HTMLElement) {
    if (disposed || !element.isConnected || element.dataset.revealState !== 'pending') return;
    if (reduced?.matches) { finish(element); return; }
    observer.unobserve(element);
    element.dataset.revealState = 'revealing';
    // Release the animation even if an extension suppresses animationend.
    const delay = Number.parseInt(element.style.getPropertyValue('--reveal-delay')) || 0;
    timers.set(element, view!.setTimeout(() => finish(element), 650 + delay));
  }

  const observer = new view.IntersectionObserver((entries) => {
    for (const entry of entries) if (entry.isIntersecting) reveal(entry.target as HTMLElement);
  }, { rootMargin: '0px 0px -24px 0px', threshold: 0 });

  function register(element: HTMLElement, delay = 0) {
    if (seen.has(element) || element.dataset.reveal === 'none' || element.closest('[data-reveal="none"]')) return;
    seen.add(element);
    // Documents retain their own layout. Keyboard focus is never concealed.
    const focus = root.ownerDocument.activeElement;
    if (reduced?.matches || element.matches('[role="alert"], [role="dialog"]') ||
      element.matches(documentContent) || element.querySelector(documentContent) ||
      (focus && element.contains(focus)) || element.getBoundingClientRect().bottom < 0) {
      element.dataset.revealState = 'visible';
      return;
    }
    element.dataset.revealState = 'pending';
    element.style.setProperty('--reveal-delay', `${delay}ms`);
    active.add(element);
    observer.observe(element);
  }

  function group(element: Element) {
    Array.from(element.children).forEach((child, index) => {
      if (!(child instanceof view!.HTMLElement)) return;
      if (!child.hasAttribute('data-reveal')) child.dataset.reveal = '';
      register(child, Math.min(index, 4) * 45);
    });
  }

  function scan(element: Element) {
    // Groups go first so explicit children inherit the group's stagger delay.
    if (element.hasAttribute('data-reveal-group')) group(element);
    element.querySelectorAll('[data-reveal-group]').forEach(group);
    if (element instanceof view!.HTMLElement && element.hasAttribute('data-reveal')) register(element);
    element.querySelectorAll<HTMLElement>('[data-reveal]').forEach((child) => register(child));
  }

  const mutations = new view.MutationObserver((records) => {
    const changedGroups = new Set<Element>();
    const added = new Set<Element>();
    for (const record of records) {
      // Scan only the affected group/subtree, never on every scroll event.
      if (record.target instanceof view!.Element && record.target.hasAttribute('data-reveal-group')) changedGroups.add(record.target);
      for (const node of record.addedNodes) if (node instanceof view!.Element) added.add(node);
    }
    changedGroups.forEach(group);
    added.forEach(scan);
    for (const element of active) if (!element.isConnected) finish(element);
  });

  function onAnimationEnd(event: Event) {
    const animation = event as AnimationEvent;
    if (animation.animationName === 'scroll-reveal-in' && animation.target instanceof view!.HTMLElement)
      finish(animation.target);
  }

  function onFocus(event: Event) {
    if (!(event.target instanceof view!.Element)) return;
    let element: Element | null = event.target;
    while (element && root.contains(element)) {
      if (element instanceof view!.HTMLElement && active.has(element)) finish(element);
      element = element.parentElement;
    }
  }

  function onPreferenceChange() {
    if (reduced?.matches) for (const element of [...active]) finish(element);
  }

  scan(root);
  mutations.observe(root, { childList: true, subtree: true });
  root.addEventListener('animationend', onAnimationEnd);
  root.addEventListener('focusin', onFocus);
  reduced?.addEventListener?.('change', onPreferenceChange);

  return () => {
    disposed = true;
    mutations.disconnect();
    for (const element of [...active]) finish(element);
    observer.disconnect();
    root.removeEventListener('animationend', onAnimationEnd);
    root.removeEventListener('focusin', onFocus);
    reduced?.removeEventListener?.('change', onPreferenceChange);
  };
}
