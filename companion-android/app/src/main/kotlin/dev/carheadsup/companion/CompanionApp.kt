package dev.carheadsup.companion

import android.app.Application
import kotlinx.coroutines.launch

/** Creates the [AppGraph] before any activity or service runs. */
class CompanionApp : Application() {
    lateinit var graph: AppGraph
        private set

    override fun onCreate() {
        super.onCreate()
        graph = AppGraph(this)
        graph.notifier.createChannels()
        graph.localNetwork.start()
        graph.scope.launch { graph.trips.load() }
    }
}
