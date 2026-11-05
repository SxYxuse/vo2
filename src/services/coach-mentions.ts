/** An activity, or a ride's power file (`powerFile`) brought in from the Power page. */
export type ActivityMention = { id: string; name: string; powerFile?: boolean };

/** How a reference to an activity or power file reads in the coach chat: a link to its page. */
export function activityLink(activity: ActivityMention) {
  const label = activity.name.replace(/[[\]\\]/g, (char) => `\\${char}`);
  const page = activity.powerFile ? "power" : "activities";
  return `[${label}](/${page}/${encodeURIComponent(activity.id)})`;
}

/**
 * The message the coach receives: each `@Name` the athlete picked becomes a link to that
 * activity, and a pick whose text was edited away is added at the end, so it still counts.
 */
export function withActivityLinks(text: string, mentions: readonly ActivityMention[]) {
  let message = text;
  const unplaced: ActivityMention[] = [];
  // Longest names first, so "@Morning Run" can't claim the start of "@Morning Run 2".
  const longestFirst = [...mentions].sort((a, b) => b.name.length - a.name.length);
  for (const mention of longestFirst) {
    const token = `@${mention.name}`;
    const at = message.indexOf(token);
    if (at === -1) {
      unplaced.push(mention);
      continue;
    }
    message = message.slice(0, at) + activityLink(mention) + message.slice(at + token.length);
  }
  if (!unplaced.length) return message;
  return [message.trimEnd(), unplaced.map(activityLink).join(" ")].filter(Boolean).join("\n\n");
}

/** The activity a chat link points to, or null for any other link. */
export function activityIdFromHref(href: string | undefined) {
  const match = href?.match(/^\/activities\/([^/?#]+)$/);
  return match ? decodeURIComponent(match[1]) : null;
}

/** The power file a chat link points to, or null for any other link. */
export function powerFileIdFromHref(href: string | undefined) {
  const match = href?.match(/^\/power\/([^/?#]+)$/);
  return match ? decodeURIComponent(match[1]) : null;
}
