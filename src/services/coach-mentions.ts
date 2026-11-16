export type ActivityMention = { id: string; name: string; powerFile?: boolean };

export function activityLink(activity: ActivityMention) {
  const label = activity.name.replace(/[[\]\\]/g, (char) => `\\${char}`);
  const page = activity.powerFile ? "power" : "activities";
  return `[${label}](/${page}/${encodeURIComponent(activity.id)})`;
}

export function withActivityLinks(text: string, mentions: readonly ActivityMention[]) {
  let message = text;
  const unplaced: ActivityMention[] = [];
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

export function activityIdFromHref(href: string | undefined) {
  const match = href?.match(/^\/activities\/([^/?#]+)$/);
  return match ? decodeURIComponent(match[1]) : null;
}

export function powerFileIdFromHref(href: string | undefined) {
  const match = href?.match(/^\/power\/([^/?#]+)$/);
  return match ? decodeURIComponent(match[1]) : null;
}
