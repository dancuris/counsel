/**
 * The tab a panel belongs to, shared by the page and the tab strip.
 *
 * This lived inside `CollapsibleSections` while every panel was handed to it as
 * a child and it picked which ones to show. That meant all three tabs were
 * server-rendered and serialized on every load: standing on Work, the page
 * still shipped Follow-ups, Meetings and the whole activity timeline. Most of
 * its 242 KB was content nobody was looking at.
 *
 * The page now builds only the active tab, which means it has to know the
 * mapping too - hence a shared module rather than a component constant.
 */
export const APP_TABS = [
  // Three, because you are never doing two of these at once. Working a role is
  // judging it and producing the documents, one continuous task. Every human
  // interaction is the second. The timeline is the third, and it is a thing you
  // consult rather than work in.
  // `prep` sits with the documents, not with the people.
  //
  // It was under Talk on the reasoning that it is about a conversation, and
  // Dan read that as wrong the moment he looked for it. He is right: these
  // tabs sort by **kind of thing**, not by topic. Interview prep is generated,
  // versioned, downloadable as .docx and .pdf, and filed to Drive - which is
  // the description of every other item on Work and of nothing on Talk. Being
  // about an interview makes it adjacent to meetings; being a document makes
  // it one of these.
  { id: "work", label: "Work", panels: ["status", "jd", "evaluation", "documents", "prep", "formanswers", "files"] },
  { id: "talk", label: "Talk", panels: ["messages", "contacts", "meetings", "notes", "followups"] },
  { id: "history", label: "History", panels: ["activity"] },
] as const;

export type AppTabId = (typeof APP_TABS)[number]["id"];

export const APP_TAB_IDS = APP_TABS.map((t) => t.id) as readonly AppTabId[];

/** Anything unrecognised falls back to Work rather than rendering nothing. */
export function resolveTab(value: string | undefined): AppTabId {
  return APP_TAB_IDS.includes(value as AppTabId) ? (value as AppTabId) : "work";
}

/**
 * Whether a panel belongs to the active tab.
 *
 * Unclaimed ids fall into Work, so adding a panel and forgetting to file it
 * still shows it somewhere rather than hiding it silently.
 */
export function panelInTab(panelId: string, tab: AppTabId): boolean {
  const claimed = APP_TABS.some((t) => (t.panels as readonly string[]).includes(panelId));
  if (!claimed) return tab === "work";
  const active = APP_TABS.find((t) => t.id === tab);
  return Boolean(active && (active.panels as readonly string[]).includes(panelId));
}
