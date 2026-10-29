/** The browser database the coach chat is kept in, one conversation per athlete. */
export const COACH_DATABASE = "vo2-coach";

/** Deletes every coach chat on this device, so the next athlete on it never sees one. */
export function removeCoachChats() {
  if (typeof indexedDB === "undefined") return Promise.resolve();
  return new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(COACH_DATABASE);
    // A tab with the chat open blocks deletion until it closes; sign-out navigates away anyway.
    request.onsuccess = request.onerror = request.onblocked = () => resolve();
  });
}
