package dev.carheadsup.companion.location

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationManager
import android.os.Looper
import android.util.Log
import androidx.core.content.ContextCompat
import androidx.core.location.LocationListenerCompat
import androidx.core.location.LocationManagerCompat
import androidx.core.location.LocationRequestCompat
import dev.carheadsup.protocol.PhoneLocation

/**
 * GPS fixes at 1 Hz from the platform `LocationManager` (no Google Play services). Each fix is
 * handed to [onFix]; [toPhoneLocation] turns it into the HUD's `location` message.
 */
class LocationFeed(context: Context, private val onFix: (Location) -> Unit) {
    private val appContext = context.applicationContext
    private val manager = appContext.getSystemService(LocationManager::class.java)
    private var running = false

    private val listener = LocationListenerCompat { location -> onFix(location) }

    /** Starts GPS updates; false without the location permission or a GPS provider. */
    @SuppressLint("MissingPermission")
    fun start(): Boolean {
        if (running) return true
        if (ContextCompat.checkSelfPermission(appContext, Manifest.permission.ACCESS_FINE_LOCATION) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            return false
        }
        if (manager == null || !manager.allProviders.contains(LocationManager.GPS_PROVIDER)) return false
        val request =
            LocationRequestCompat.Builder(INTERVAL_MS)
                .setMinUpdateIntervalMillis(INTERVAL_MS)
                .setQuality(LocationRequestCompat.QUALITY_HIGH_ACCURACY)
                .build()
        return try {
            LocationManagerCompat.requestLocationUpdates(
                manager,
                LocationManager.GPS_PROVIDER,
                request,
                listener,
                Looper.getMainLooper(),
            )
            running = true
            true
        } catch (e: SecurityException) {
            Log.w(TAG, "Location permission revoked", e)
            false
        }
    }

    fun stop() {
        if (!running) return
        LocationManagerCompat.removeUpdates(manager, listener)
        running = false
    }

    companion object {
        private const val TAG = "LocationFeed"
        private const val INTERVAL_MS = 1_000L

        fun toPhoneLocation(location: Location): PhoneLocation = PhoneLocation(
            lat = location.latitude,
            lon = location.longitude,
            accuracyM = if (location.hasAccuracy()) location.accuracy.toDouble() else null,
            speedMps = if (location.hasSpeed()) location.speed.toDouble() else null,
            bearingDeg = if (location.hasBearing()) location.bearing.toDouble() else null,
        )
    }
}
