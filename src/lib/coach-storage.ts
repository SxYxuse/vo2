const COACH_DATABASE = "vo2-coach";

export function removeCoachChats() {
  if (typeof indexedDB === "undefined") return Promise.resolve();
  return new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(COACH_DATABASE);
    // A tab with the chat open blocks deletion until it closes; sign-out navigates away anyway.
    request.onsuccess = request.onerror = request.onblocked = () => resolve();
  });
}
