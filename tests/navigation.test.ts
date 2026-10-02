import test from 'node:test';
import assert from 'node:assert/strict';
import { createNavigation, type Screen } from '../src/navigation.ts';
function setup(initial: Screen[] = ['start']) {
  const entries: any[] = [null]; let index = 0; const pending: number[] = []; let screen = initial.at(-1)!;
  const history = { get state() { return entries[index]; }, pushState(data: any) { entries.splice(++index); entries.push(data); }, replaceState(data: any) { entries[index] = data; }, go(delta: number) { pending.push(delta); } };
  const nav = createNavigation(history, initial, next => { screen = next; });
  function flush() { while (pending.length) { index += pending.shift()!; assert.ok(index >= 0 && index < entries.length); nav.pop(entries[index]); } }
  return { nav, flush, entries, get screen() { return screen; }, browserBack() { history.go(-1); flush(); }, browserForward() { history.go(1); flush(); } };
}
test('distance → refine → search → start works with either back control', () => {
  const h = setup(); h.nav.navigate(['start','search','refine','distance']);
  h.nav.back(); h.flush(); assert.equal(h.screen, 'refine');
  h.browserBack(); assert.equal(h.screen, 'search');
  h.nav.back(); h.flush(); assert.equal(h.screen, 'start');
  h.browserForward(); assert.equal(h.screen, 'search');
});
test('cancel an origin edit returns to the existing results', () => {
  const h = setup(['start','refine','distance','results']);
  h.nav.navigate([...h.nav.path, 'refine']); h.browserBack();
  assert.equal(h.screen,'results'); assert.equal(h.entries.length,5);
});
test('confirm an edited origin removes obsolete results and duplicate refine entries', () => {
  const h = setup(['start','search','refine','distance','results']);
  h.nav.navigate([...h.nav.path,'refine']);
  h.nav.navigate(['start','search','refine','distance'],false,true); h.flush();
  assert.equal(h.screen,'distance'); assert.equal(h.entries.length,4);
  h.browserBack(); assert.equal(h.screen,'refine');
  h.browserBack(); assert.equal(h.screen,'search');
});
test('a finished loading screen is replaced, not added behind results', () => {
  const h = setup(['start','refine','distance']);
  h.nav.navigate([...h.nav.path,'loading']);
  h.nav.navigate(['start','refine','distance','results'],true);
  h.browserBack(); assert.equal(h.screen,'distance');
  h.browserForward(); assert.equal(h.screen,'results');
});
test('double back while a history traversal is pending does not skip or trap screens', () => {
  const h=setup(['start','refine','distance']); h.nav.back(); h.nav.back(); h.flush();
  assert.equal(h.screen,'refine'); h.nav.back(); h.flush(); assert.equal(h.screen,'start');
});
