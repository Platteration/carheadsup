// Build plugins live on the root buildscript classpath so that the Kotlin and Android Gradle
// plugins share one class loader (KGP must see AGP's classes). The Android Gradle Plugin is only
// resolved when settings.gradle.kts included :app, i.e. when an Android SDK is available.
buildscript {
    repositories {
        mavenCentral()
        google {
            content {
                includeGroupByRegex("androidx\\..*")
                includeGroupByRegex("com\\.android(\\..*)?")
                includeGroupByRegex("com\\.google\\..*")
            }
        }
    }
    dependencies {
        classpath(libs.kotlin.gradlePlugin)
        classpath(libs.kotlin.serializationPlugin)
        if (findProject(":app") != null) {
            classpath(libs.android.gradlePlugin)
            classpath(libs.kotlin.composeCompilerPlugin)
        }
    }
}
