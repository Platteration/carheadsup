import java.util.Properties

pluginManagement {
    repositories {
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        mavenCentral()
        // Google's Maven repository only serves Android artifacts; the content filter keeps
        // Gradle from ever contacting it while resolving the pure-JVM :protocol module.
        google {
            content {
                includeGroupByRegex("androidx\\..*")
                includeGroupByRegex("com\\.android(\\..*)?")
                includeGroupByRegex("com\\.google\\..*")
            }
        }
    }
}

rootProject.name = "carheadsup-companion"

include(":protocol")

/**
 * The Android application needs an Android SDK. It is part of the build only when one is found
 * (`sdk.dir` in local.properties, ANDROID_HOME or ANDROID_SDK_ROOT), so `./gradlew :protocol:test`
 * works on any JDK-only machine. `-Pcarheadsup.app=false` excludes it explicitly.
 */
fun androidSdkDirectory(): File? {
    val localProperties = layout.rootDirectory.file("local.properties").asFile
    val fromLocalProperties =
        if (localProperties.isFile) {
            Properties().apply { localProperties.inputStream().use { load(it) } }.getProperty("sdk.dir")
        } else {
            null
        }
    return listOf(
        fromLocalProperties,
        providers.environmentVariable("ANDROID_HOME").orNull,
        providers.environmentVariable("ANDROID_SDK_ROOT").orNull,
    )
        .filterNotNull()
        .filter { it.isNotBlank() }
        .map { File(it) }
        .firstOrNull { it.isDirectory }
}

val appExplicitlyDisabled = providers.gradleProperty("carheadsup.app").orNull == "false"
val androidSdk = if (appExplicitlyDisabled) null else androidSdkDirectory()
if (androidSdk != null) {
    include(":app")
} else {
    logger.lifecycle(
        "carheadsup: no Android SDK found (local.properties sdk.dir / ANDROID_HOME / " +
            "ANDROID_SDK_ROOT) or -Pcarheadsup.app=false; building :protocol only.",
    )
}
