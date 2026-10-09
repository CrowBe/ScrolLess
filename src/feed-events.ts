/** Feed changed in a way that needs a full reload (e.g. mark all read). */
export const FEED_CHANGED = 'scrolless:feed-changed';
/** Read/save state changed for individual items; counts need refreshing. */
export const ITEM_STATE_CHANGED = 'scrolless:item-state-changed';

export function emit(event: string): void {
  window.dispatchEvent(new CustomEvent(event));
}
