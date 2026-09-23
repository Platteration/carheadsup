package dev.carheadsup.protocol

/** Keys the HUD rejects on `message` frames (core `FORBIDDEN_MESSAGE_KEYS`). */
internal val FORBIDDEN_KEYS_FOR_TESTS: List<String> =
    listOf(
        "body", "text", "content", "message", "messages", "preview", "snippet", "subject", "bigtext", "subtext",
        "summarytext",
    )
