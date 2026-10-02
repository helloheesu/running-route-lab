export type Screen = 'start' | 'search' | 'refine' | 'distance' | 'loading' | 'results' | 'confirm';
export type HistoryPort = Pick<History, 'state' | 'pushState' | 'replaceState' | 'go'>;
type Entry = { session: string; path: Screen[] };
const key = 'runningPocNavigation';

// Synchronize the app's existing screen flow with real browser history.
// Rebranching after an edit rewinds to the shared parent before pushing, so
// obsolete result screens cannot remain behind a newly confirmed departure.
export function createNavigation(history: HistoryPort, initial: Screen[], onChange: (screen: Screen) => void) {
  const session = `${Date.now()}-${Math.random()}`;
  let path = initial.slice(0, 1);
  let pending: { next: Screen[]; parentLength: number } | null = null;
  const entry = () => ({ ...history.state, [key]: { session, path: [...path] } satisfies Entry });
  history.replaceState(entry(), '');
  const append = (next: Screen[]) => {
    for (let i = path.length; i < next.length; i++) {
      path = next.slice(0, i + 1);
      history.pushState(entry(), '');
    }
  };
  append(initial);
  function navigate(next: Screen[], replaceTop = false, rebranch = false) {
    if (!next.length || pending) return;
    if (replaceTop && next.length === path.length) {
      path = [...next]; history.replaceState(entry(), ''); onChange(path.at(-1)!); return;
    }
    let common = 0;
    while (common < path.length && common < next.length && path[common] === next[common]) common++;
    if (rebranch) common = Math.min(common, next.length - 1);
    if (common === path.length && common === next.length) return;
    if (common < path.length) {
      // All app trails share the start screen, so this never exits the Site.
      pending = { next: [...next], parentLength: Math.max(1, common) };
      history.go(pending.parentLength - path.length);
    } else { append(next); onChange(path.at(-1)!); }
  }
  function pop(state: any) {
    const saved = state?.[key] as Entry | undefined;
    if (!saved) return;
    if (saved.session !== session) {
      // A reload starts a new flow without restoring stale input/results. Skip
      // this app's older flow entries when Back reaches their session boundary.
      if (Array.isArray(saved.path) && saved.path[0] === 'start') history.go(-saved.path.length);
      return;
    }
    path = [...saved.path];
    const operation = pending; pending = null;
    if (operation && path.length === operation.parentLength) append(operation.next);
    onChange(path.at(-1)!);
  }
  return { navigate, pop, back: () => navigate(path.slice(0, -1)), get path() { return [...path]; } };
}
