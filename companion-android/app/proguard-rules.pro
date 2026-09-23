# kotlinx.serialization, OkHttp, Compose and AndroidX ship their own consumer rules.
# Keep the generated serializers of the wire protocol explicitly as well: a stripped serializer
# would only fail at runtime, when the first frame from the HUD arrives.
-keepclassmembers @kotlinx.serialization.Serializable class dev.carheadsup.protocol.** {
    *** Companion;
    static *** serializer(...);
}
-keep class dev.carheadsup.protocol.**$$serializer { *; }
