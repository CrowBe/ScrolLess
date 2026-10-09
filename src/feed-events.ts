/** Legacy IndexedDB feed changed (device relay, retention, local read/save). */
export const IDB_UPDATED = 'scrolless:idb-updated';
/** Host feed changed in a way that needs a full reload (e.g. mark all read). */
export const HOST_FEED_CHANGED = 'scrolless:host-feed-changed';
/** Host read/save state changed for individual items; counts need refreshing. */
export const HOST_STATE_CHANGED = 'scrolless:host-state-changed';

export function emit(event: string): void {
  window.dispatchEvent(new CustomEvent(event));
}
