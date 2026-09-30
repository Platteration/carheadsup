package dev.carheadsup.protocol.hazards

import dev.carheadsup.protocol.HazardItem
import dev.carheadsup.protocol.PhoneHazards
import dev.carheadsup.protocol.WireLimits
import dev.carheadsup.protocol.link.ChangeGate
import java.util.EnumMap

/** A phone-side producer of hazards. */
public enum class HazardSource {
    /** Speed cameras from OpenStreetMap. */
    CAMERAS,

    /** Traffic incidents from a traffic service (TomTom). */
    TRAFFIC,
}

/**
 * Merges the hazard lists of the phone's sources into the one `hazards` message the HUD takes:
 * the HUD replaces its whole list with each message, so a source that sent only its own list
 * would wipe the others'. Each source reports its complete current list ([update]; an empty one
 * or [clear] when it has nothing or no longer knows); the merged list — ids unique (the first
 * source wins, in [HazardSource] order), nearest first, at most [limit] — is published when
 * anything but the distances changed, and otherwise every [refreshMs] with fresh distances, so
 * the HUD's copy never expires (it drops hazards not refreshed for two minutes).
 *
 * Thread-safe: sources update from their own threads, and [publish] is called under the lock so
 * that messages leave in the order they were merged.
 *
 * A provider that can be stopped from another thread than the one it updates from reports
 * through a [HazardFeed] ([open]) rather than [update]: once the feed is closed (or a newer one is
 * opened for the source), whatever it still sends is ignored. Otherwise an update racing the
 * provider's stop would put its list back after it was withdrawn, and the aggregator would keep
 * re-sending those hazards, with frozen distances, along with every other source's updates.
 */
public class HazardAggregator(
    private val publish: (PhoneHazards) -> Unit,
    refreshMs: Long = DEFAULT_REFRESH_MS,
    private val limit: Int = WireLimits.HAZARDS,
) {
    private val lists = EnumMap<HazardSource, List<HazardItem>>(HazardSource::class.java)
    private val gate = ChangeGate<Set<HazardItem>>(refreshMs)

    /** Per source, the generation of the feed that counts; none after it was closed. */
    private val generations = EnumMap<HazardSource, Long>(HazardSource::class.java)

    /**
     * A feed for [source]: its list starts empty (whatever an earlier provider of the source left
     * is withdrawn at [nowMs]), and earlier feeds of the source no longer count.
     */
    @Synchronized
    public fun open(source: HazardSource, nowMs: Long): HazardFeed {
        val generation = (generations[source] ?: 0L) + 1
        generations[source] = generation
        update(source, emptyList(), nowMs)
        return HazardFeed(this, source, generation)
    }

    @Synchronized
    internal fun updateFeed(feed: HazardFeed, items: List<HazardItem>, nowMs: Long) {
        if (generations[feed.source] == feed.generation) update(feed.source, items, nowMs)
    }

    @Synchronized
    internal fun closeFeed(feed: HazardFeed, nowMs: Long) {
        if (generations[feed.source] != feed.generation) return
        // No feed of this source counts until the next one is opened.
        generations[feed.source] = feed.generation + 1
        update(feed.source, emptyList(), nowMs)
    }

    /** [source]'s complete current list, at [nowMs] (a monotonic clock). */
    @Synchronized
    public fun update(source: HazardSource, items: List<HazardItem>, nowMs: Long) {
        lists[source] = items
        val merged = merge(lists.values, limit)
        // Distances change with every fix; they go out with the periodic refresh.
        val key = merged.mapTo(HashSet()) { it.copy(distanceM = null) }
        if (gate.shouldSend(key, nowMs)) publish(PhoneHazards(merged))
    }

    /** [source] has nothing (any more): switched off, or its position data stopped. */
    public fun clear(source: HazardSource, nowMs: Long): Unit = update(source, emptyList(), nowMs)

    /** The merged list as it stands. */
    @Synchronized
    public fun current(): List<HazardItem> = merge(lists.values, limit)

    public companion object {
        /** Unchanged lists are re-sent this often (the HUD dead-reckons distances in between). */
        public const val DEFAULT_REFRESH_MS: Long = 5_000

        /** [lists] as one: ids unique (first occurrence wins), nearest first, at most [limit]. */
        public fun merge(lists: Iterable<List<HazardItem>>, limit: Int = WireLimits.HAZARDS): List<HazardItem> = lists
            .flatten()
            .distinctBy { it.id }
            .sortedWith(compareBy(nullsLast<Double>()) { it.distanceM })
            .take(limit)
    }
}

/**
 * One provider's connection to a [HazardAggregator] ([HazardAggregator.open]): its [update]s count
 * until it is [close]d or another feed is opened for the same [source]; after that they are
 * ignored. Thread-safe.
 */
public class HazardFeed internal constructor(
    private val aggregator: HazardAggregator,
    public val source: HazardSource,
    internal val generation: Long,
) {
    /** This provider's complete current list, at [nowMs] (a monotonic clock). */
    public fun update(items: List<HazardItem>, nowMs: Long): Unit = aggregator.updateFeed(this, items, nowMs)

    /** This provider has nothing (any more) for now, e.g. its position data stopped. */
    public fun clear(nowMs: Long): Unit = update(emptyList(), nowMs)

    /** The provider stops: its hazards are withdrawn, and whatever it sends later is ignored. */
    public fun close(nowMs: Long): Unit = aggregator.closeFeed(this, nowMs)
}
