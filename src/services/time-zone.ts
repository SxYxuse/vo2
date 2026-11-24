export function isTimeZone(timeZone: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone });
    return true;
  } catch {
    return false;
  }
}

export function localTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}
