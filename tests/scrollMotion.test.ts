import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { JSDOM } from 'jsdom';
import { installScrollMotion } from '../src/app/components/scrollRevealController.ts';

function setup(html: string, initialReduced = false) {
  const dom = new JSDOM(`<div id="root">${html}</div>`, { pretendToBeVisual: true });
  const view = dom.window;
  const root = view.document.getElementById('root')!;
  let reduced = initialReduced;
  const media = Object.assign(new view.EventTarget(), { get matches() { return reduced; } });
  // Object.assign evaluates getters; use a live matches getter for preference changes.
  Object.defineProperty(media, 'matches', { get: () => reduced });
  Object.defineProperty(view, 'matchMedia', { value: () => media });
  const observers: Observer[] = [];
  class Observer {
    observed = new Set<Element>();
    disconnected = false;
    constructor(private callback: IntersectionObserverCallback) { observers.push(this); }
    observe(element: Element) { this.observed.add(element); }
    unobserve(element: Element) { this.observed.delete(element); }
    disconnect() { this.disconnected = true; this.observed.clear(); }
    intersect(element: Element) { this.callback([{ target: element, isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver); }
  }
  Object.defineProperty(view, 'IntersectionObserver', { configurable: true, value: Observer });
  const finish = (element: Element) => {
    const event = new view.Event('animationend', { bubbles: true });
    Object.defineProperty(event, 'animationName', { value: 'scroll-reveal-in' });
    element.dispatchEvent(event);
  };
  return { root, view, observers, finish,
    preference: (value: boolean) => { reduced = value; media.dispatchEvent(new view.Event('change')); },
    close: () => dom.window.close() };
}

test('sections reveal once and a stale observer callback cannot replay settled content', async () => {
  const app = setup('<section data-reveal><h2>A section</h2></section>');
  const section = app.root.querySelector('section')!;
  const dispose = installScrollMotion(app.root as unknown as HTMLElement);
  try {
    assert.equal(section.dataset.revealState, 'pending');
    app.observers[0].intersect(section);
    assert.equal(section.dataset.revealState, 'revealing');
    app.finish(section);
    assert.equal(section.dataset.revealState, 'visible');
    app.observers[0].intersect(section);
    assert.equal(section.dataset.revealState, 'visible');
    section.append(app.view.document.createElement('p'));
    await setImmediate();
    assert.equal(section.dataset.revealState, 'visible', 'ordinary data changes do not restart a reveal');
  } finally { dispose(); app.close(); }
});

test('new routes, asynchronously loaded cards, and nested scroller groups are registered with bounded stagger', async () => {
  const app = setup('<section data-reveal-group style="overflow:auto;max-height:100px"><article>First</article></section>');
  const dispose = installScrollMotion(app.root as unknown as HTMLElement);
  try {
    const group = app.root.querySelector('section')!;
    const first = group.firstElementChild as HTMLElement;
    app.observers[0].intersect(first); app.finish(first);
    for (let index = 0; index < 7; index++) group.append(app.view.document.createElement('article'));
    await setImmediate();
    const children = [...group.children] as HTMLElement[];
    assert.equal(first.dataset.revealState, 'visible');
    assert.equal(children[1].style.getPropertyValue('--reveal-delay'), '45ms');
    assert.equal(children[7].style.getPropertyValue('--reveal-delay'), '180ms', 'long lists never accumulate long delays');
    const route = app.view.document.createElement('main');
    route.innerHTML = '<header data-reveal>Next route</header>';
    app.root.replaceChildren(route);
    await setImmediate();
    const header = route.querySelector('header')!;
    assert.equal(header.dataset.revealState, 'pending');
    assert.ok(app.observers[0].observed.has(header));
    assert.ok(!app.observers[0].observed.has(first), 'removed route content is released');
  } finally { dispose(); app.close(); }
});

test('keyboard focus makes an offscreen section visible immediately and preserves entered work', () => {
  const app = setup('<section data-reveal><input value="Unsaved song notes"></section>');
  const dispose = installScrollMotion(app.root as unknown as HTMLElement);
  try {
    const input = app.root.querySelector('input')!;
    input.focus();
    assert.equal(app.root.querySelector('section')!.dataset.revealState, 'visible');
    assert.equal(input.value, 'Unsaved song notes');
    assert.equal(app.view.document.activeElement, input);
  } finally { dispose(); app.close(); }
});

test('reduced motion stays visible initially and a live preference change releases pending and active animation', async () => {
  const app = setup('<section data-reveal>One</section>', true);
  const dispose = installScrollMotion(app.root as unknown as HTMLElement);
  try {
    const section = app.root.querySelector('section')!;
    assert.equal(section.dataset.revealState, 'visible');
    assert.equal(app.observers[0].observed.size, 0);
    app.preference(false);
    const next = app.view.document.createElement('section');
    next.dataset.reveal = ''; app.root.append(next);
    await setImmediate();
    assert.equal(next.dataset.revealState, 'pending');
    app.observers[0].intersect(next);
    assert.equal(next.dataset.revealState, 'revealing');
    const pending = next.cloneNode() as HTMLElement;
    app.root.append(pending); await setImmediate();
    assert.equal(pending.dataset.revealState, 'pending');
    app.preference(true);
    assert.equal(next.dataset.revealState, 'visible');
    assert.equal(pending.dataset.revealState, 'visible');
    assert.equal(app.observers[0].observed.size, 0);
  } finally { dispose(); app.close(); }
});

test('document editors, focused sections, alerts and explicit exclusions are never concealed', () => {
  const app = setup('<section data-reveal><div contenteditable="true">Editable contract</div></section><section data-reveal="none"><div data-reveal>Excluded child</div></section><p role="alert" data-reveal>Failure message</p><div data-reveal class="contract-document">Document</div><section data-reveal><input id="focused"></section>');
  app.root.querySelector<HTMLInputElement>('#focused')!.focus();
  const dispose = installScrollMotion(app.root as unknown as HTMLElement);
  try {
    assert.equal(app.observers[0].observed.size, 0);
    assert.equal(app.root.querySelector('.contract-document')!.getAttribute('data-reveal-state'), 'visible');
    assert.equal(app.root.querySelector('[role="alert"]')!.getAttribute('data-reveal-state'), 'visible');
    assert.equal(app.root.querySelector('[data-reveal="none"]')!.getAttribute('data-reveal-state'), null);
    assert.ok(!app.root.querySelector('[data-reveal-state="pending"]'));
  } finally { dispose(); app.close(); }
});

test('unsupported browsers and disposal keep content visible and release all observers', async () => {
  const unsupported = setup('<section data-reveal>Visible fallback</section>');
  Reflect.deleteProperty(unsupported.view, 'IntersectionObserver');
  const noOp = installScrollMotion(unsupported.root as unknown as HTMLElement);
  assert.equal(unsupported.root.querySelector('section')!.dataset.revealState, undefined);
  noOp(); unsupported.close();

  const app = setup('<section data-reveal>Pending</section>');
  const dispose = installScrollMotion(app.root as unknown as HTMLElement);
  const section = app.root.querySelector('section')!;
  dispose();
  try {
    assert.equal(section.dataset.revealState, 'visible');
    assert.equal(app.observers[0].disconnected, true);
    app.observers[0].intersect(section);
    assert.equal(section.dataset.revealState, 'visible');
    const next = app.view.document.createElement('section'); next.dataset.reveal = ''; app.root.append(next);
    await setImmediate();
    assert.equal(next.dataset.revealState, undefined);
  } finally { app.close(); }
});
