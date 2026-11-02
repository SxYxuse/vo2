/** The browser database earlier builds kept the coach chat in; chats are on the server now. */
const COACH_DATABASE = "vo2-coach";

/** Deletes a coach chat an earlier build left on this device, so the next athlete never sees it. */
export function removeCoachChats() {
  if (typeof indexedDB === "undefined") return Promise.resolve();
  return new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(COACH_DATABASE);
    // A tab with the chat open blocks deletion until it closes; sign-out navigates away anyway.
    request.onsuccess = request.onerror = request.onblocked = () => resolve();
  });
}
