package dev.carheadsup.protocol.messaging

import dev.carheadsup.protocol.FORBIDDEN_KEYS_FOR_TESTS
import dev.carheadsup.protocol.PhoneWire
import dev.carheadsup.protocol.ProtocolJson
import kotlinx.serialization.json.jsonObject
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.ValueSource
import java.security.MessageDigest

class MessagingNotificationTest {
    private val now = 1_758_620_000_000L
    private val extractor = MessagingNotificationExtractor(ignoredPackages = setOf("dev.carheadsup.companion"))

    private fun whatsApp(
        messages: List<StyleMessage>,
        conversationTitle: String? = null,
        group: Boolean = false,
        key: String = "0|com.whatsapp|1|alice@s.whatsapp.net|10123",
        selfName: String? = "You",
        isGroupSummary: Boolean = false,
    ) = MessagingNotificationContent(
        key = key,
        packageName = "com.whatsapp",
        appLabel = "WhatsApp",
        postTimeMs = now,
        category = "msg",
        isGroupSummary = isGroupSummary,
        isOngoing = false,
        title = conversationTitle ?: messages.lastOrNull()?.senderName,
        text = messages.lastOrNull()?.text,
        conversationTitle = conversationTitle,
        isGroupConversation = group,
        messages = messages,
        selfName = selfName,
    )

    @Test
    fun `one-to-one MessagingStyle chat`() {
        val message =
            extractor.extract(
                whatsApp(
                    listOf(
                        StyleMessage("Alice", "Running late", now - 60_000),
                        StyleMessage(
                            "Alice",
                            "Be there in 10",
                            now - 1_000,
                        ),
                    ),
                ),
                now,
            )!!
        assertEquals("Alice", message.sender)
        assertEquals("WhatsApp", message.app)
        assertEquals("Be there in 10", message.spokenText)
        assertEquals(now - 1_000, message.receivedAtMs)
        assertTrue(message.id.startsWith("msg-"))
    }

    @Test
    fun `group chats name the sender and the group`() {
        val message =
            extractor.extract(
                whatsApp(
                    listOf(StyleMessage("Bob", "Pizza tonight?", now - 500)),
                    conversationTitle = "Family",
                    group = true,
                ),
                now,
            )!!
        assertEquals("Bob @ Family", message.sender)
    }

    @Test
    fun `a group title equal to the sender is not repeated`() {
        val message = extractor.extract(
            whatsApp(listOf(StyleMessage("Bob", "hi", now)), conversationTitle = "Bob", group = true),
            now,
        )!!
        assertEquals("Bob", message.sender)
    }

    @Test
    fun `the user's own reply is not announced`() {
        val replied = whatsApp(
            listOf(
                StyleMessage("Alice", "Dinner?", now - 5_000),
                StyleMessage(
                    null,
                    "Sure!",
                    now - 1_000,
                ),
            ),
        )
        assertNull(extractor.extract(replied, now))
        val namedSelf = whatsApp(listOf(StyleMessage("You", "Sure!", now - 1_000)), selfName = "You")
        assertNull(extractor.extract(namedSelf, now))
    }

    @Test
    fun `summaries, ongoing and old notifications are ignored`() {
        assertNull(extractor.extract(whatsApp(listOf(StyleMessage("Alice", "hi", now)), isGroupSummary = true), now))
        val summary =
            MessagingNotificationContent(
                "k", "com.whatsapp", "WhatsApp", now, "msg", false, false, "WhatsApp", "5 messages from 3 chats",
            )
        assertNull(extractor.extract(summary, now))
        val checking =
            MessagingNotificationContent(
                "k", "com.whatsapp", "WhatsApp", now, null, false, true, "WhatsApp", "Checking for new messages",
            )
        assertNull(extractor.extract(checking, now))
        assertNull(extractor.extract(whatsApp(listOf(StyleMessage("Alice", "old", now - 10 * 60_000))), now))
    }

    @Test
    fun `plain SMS-style notifications use the title, minus counters`() {
        val sms =
            MessagingNotificationContent(
                "0|com.android.mms|123|null|10001", "com.android.mms", "Messages", now, null, false, false,
                "+49 170 1234567 (2 messages)", "Call me back", hasReplyAction = true,
            )
        val message = extractor.extract(sms, now)!!
        assertEquals("+49 170 1234567", message.sender)
        assertEquals("Call me back", message.spokenText)
        val german = sms.copy(title = "Mama (3 Nachrichten)")
        assertEquals("Mama", extractor.extract(german, now)!!.sender)
    }

    @Test
    fun `category msg from an unknown app counts, other apps do not`() {
        val custom =
            MessagingNotificationContent("k", "org.example.chat", "Chatty", now, "msg", false, false, "Carol", "Hello")
        assertEquals("Carol", extractor.extract(custom, now)!!.sender)
        val shop = custom.copy(packageName = "com.shop", category = "promo", title = "50% off")
        assertNull(extractor.extract(shop, now))
        val email = custom.copy(packageName = "com.google.android.gm", category = "email", title = "Boss")
        assertNull(extractor.extract(email, now))
        val call = custom.copy(packageName = "com.whatsapp", category = "call", title = "Incoming voice call")
        assertNull(extractor.extract(call, now))
    }

    @Test
    fun `missed calls and other app notifications are not messages (android-18)`() {
        val missedCall =
            MessagingNotificationContent(
                "k1", "com.whatsapp", "WhatsApp", now, "missed_call", false, false, "Alice", "Missed voice call",
            )
        assertNull(extractor.extract(missedCall, now))
        for (category in listOf("reminder", "event", "recommendation", "status", "promo", "err")) {
            assertNull(extractor.extract(missedCall.copy(category = category), now), category)
        }
        // A known messaging app without MessagingStyle, category or reply action: not a message.
        val joined =
            MessagingNotificationContent(
                "k2", "org.telegram.messenger", "Telegram", now, null, false, false, "Bob joined Telegram!", "Say hi",
            )
        assertNull(extractor.extract(joined, now))
        // The same app with a reply action (or category msg) is one.
        assertEquals("Bob", extractor.extract(joined.copy(title = "Bob", hasReplyAction = true), now)!!.sender)
        assertEquals("Bob", extractor.extract(joined.copy(title = "Bob", category = "msg"), now)!!.sender)
    }

    @Test
    fun `own app and title equal to the app name are ignored`() {
        val own =
            MessagingNotificationContent(
                "k", "dev.carheadsup.companion", "carheadsup", now, "msg", false, false, "HUD", "connected",
            )
        assertNull(extractor.extract(own, now))
        val appNamed =
            MessagingNotificationContent(
                "k", "org.telegram.messenger", "Telegram", now, null, false, false, "Telegram", "New login",
            )
        assertNull(extractor.extract(appNamed, now))
    }

    @ParameterizedTest
    @ValueSource(
        strings = [
            "3 new messages", "5 messages from 3 chats", "2 Nachrichten aus 2 Chats", "4 neue Nachrichten",
            "12 unread messages", "1 message",
        ],
    )
    fun `summary texts`(text: String) {
        assertTrue(MessagingNotificationExtractor.isSummary(text))
    }

    @ParameterizedTest
    @ValueSource(strings = ["Alice", "3 Musketeers", "Messages", "Meet at 5"])
    fun `not summaries`(text: String) {
        assertFalse(MessagingNotificationExtractor.isSummary(text))
    }

    @Test
    fun `ids are stable for re-posts and change with new messages`() {
        val first = whatsApp(listOf(StyleMessage("Alice", "Hi", now - 2_000)))
        val repost = first.copy(postTimeMs = now + 5_000)
        val next =
            whatsApp(listOf(StyleMessage("Alice", "Hi", now - 2_000), StyleMessage("Alice", "Hello?", now - 100)))
        val a = extractor.extract(first, now)!!
        assertEquals(a.id, extractor.extract(repost, now)!!.id)
        assertNotEquals(a.id, extractor.extract(next, now)!!.id)
        assertNotEquals(a.id, extractor.extract(first.copy(key = "other-chat"), now)!!.id)
    }

    @Test
    fun `message ids cannot be recomputed from the message (android-17)`() {
        val content = whatsApp(listOf(StyleMessage("Alice", "ok", now)))
        val id = extractor.extract(content, now)!!.id
        // Whoever sees the id knows the app, roughly the time and the sender: with an unkeyed
        // digest, hashing likely short replies would give the text away.
        val sha = MessageDigest.getInstance("SHA-256")
        for (part in listOf(content.packageName, content.key, now.toString(), "Alice", "ok")) {
            sha.update(part.toByteArray(Charsets.UTF_8))
            sha.update(0)
        }
        val unkeyed = "msg-" + sha.digest().take(10).joinToString("") { "%02x".format(it) }
        assertNotEquals(unkeyed, id)
        // Keyed with a secret that stays on the phone: another key, another id; same key, same id.
        val keyA = ByteArray(32) { it.toByte() }
        val keyB = ByteArray(32) { (it + 1).toByte() }
        val withA = MessagingNotificationExtractor(idKey = keyA).extract(content, now)!!.id
        assertEquals(withA, MessagingNotificationExtractor(idKey = keyA).extract(content, now)!!.id)
        assertNotEquals(withA, MessagingNotificationExtractor(idKey = keyB).extract(content, now)!!.id)
        assertTrue(Regex("msg-[0-9a-f]{20}").matches(withA))
    }

    @Test
    fun `message content never leaves the phone`() {
        val secret = "the vault code is 4711"
        val message = extractor.extract(whatsApp(listOf(StyleMessage("Alice", secret, now))), now)!!
        assertFalse(message.id.contains("4711"))
        assertFalse(message.toString().contains(secret))
        val wire = PhoneWire.encode(message.toPhoneMessage(readingAloud = true))!!
        assertFalse(wire.contains(secret))
        val keys = ProtocolJson.parseToJsonElement(wire).jsonObject.keys.map { it.lowercase() }
        assertTrue(keys.none { it in FORBIDDEN_KEYS_FOR_TESTS }, keys.toString())
        assertTrue(wire.contains("\"readingAloud\":true"))
    }

    @Test
    fun `spoken text is trimmed and bounded`() {
        val long = extractor.extract(whatsApp(listOf(StyleMessage("Alice", "  " + "a".repeat(2_000), now))), now)!!
        assertEquals(500, long.spokenText!!.length)
        val empty = extractor.extract(whatsApp(listOf(StyleMessage("Alice", "   ", now))), now)!!
        assertNull(empty.spokenText)
    }

    @Test
    fun `recent ids suppress repeats within the TTL and forget old ones`() {
        val recent = RecentMessageIds(capacity = 3, ttlMs = 1_000)
        assertTrue(recent.firstSeen("a", 0))
        assertFalse(recent.firstSeen("a", 500))
        assertTrue(recent.firstSeen("a", 2_000)) // expired
        assertTrue(recent.firstSeen("b", 2_000))
        assertTrue(recent.firstSeen("c", 2_000))
        assertTrue(recent.firstSeen("d", 2_000)) // evicts "a"
        assertTrue(recent.firstSeen("a", 2_100))
        assertFalse(recent.firstSeen("d", 2_100))
    }
}
