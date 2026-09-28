export interface BusiestTopic {
  readonly topic: string;
  readonly count: number;
  /** The bar's width as a percentage of the busiest topic's, not of the
   * total: the list is a comparison between these topics, and against a
   * total the busiest one would be a sliver whenever there are many. */
  readonly share: number;
}

/**
 * The noisiest topics on a connection, for the panel's little bar list.
 *
 * Fed from the session counters rather than from `MessageStoreService`,
 * which prunes each topic at `maxMessagesPerTopic`: derived from the store,
 * every busy topic would tie at the cap and the ranking would go flat exactly
 * when it starts being worth reading.
 */
export function busiestTopics(
  perTopic: ReadonlyMap<string, number>,
  limit: number,
): readonly BusiestTopic[] {
  if (limit <= 0) {
    return [];
  }
  const ranked = [...perTopic]
    // Ties break on the topic name so the list holds still: ordering them by
    // whatever the map happened to return would reshuffle the rows on every
    // message, which is unreadable in a live panel.
    .sort(([topicA, a], [topicB, b]) =>
      b - a !== 0 ? b - a : topicA.localeCompare(topicB),
    )
    .slice(0, limit);

  const busiest = ranked[0]?.[1] ?? 0;
  return ranked.map(([topic, count]) => ({
    topic,
    count,
    share: busiest === 0 ? 0 : (count / busiest) * 100,
  }));
}
