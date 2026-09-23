package dev.carheadsup.companion.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.carheadsup.companion.R
import dev.carheadsup.companion.ui.MainViewModel
import dev.carheadsup.companion.ui.Remote
import dev.carheadsup.companion.ui.theme.StatusColors
import dev.carheadsup.protocol.MaintenanceStatusKind
import dev.carheadsup.protocol.api.MaintenanceItemStatus
import dev.carheadsup.protocol.api.TripFormatter
import dev.carheadsup.protocol.api.TripLog
import dev.carheadsup.protocol.api.TripRecord

/** The trip log (synced from the HUD) and the maintenance schedule. */
@Composable
fun TripsScreen(viewModel: MainViewModel) {
    val trips by viewModel.trips.collectAsStateWithLifecycle()
    val sync by viewModel.tripSync.collectAsStateWithLifecycle()
    val maintenance by viewModel.maintenance.collectAsStateWithLifecycle()
    val formatter by viewModel.formatter.collectAsStateWithLifecycle()

    LaunchedEffect(Unit) {
        if (maintenance is Remote.Idle) viewModel.loadMaintenance()
    }

    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        item {
            SectionCard(stringResource(R.string.section_maintenance)) {
                when (val state = maintenance) {
                    Remote.Idle, Remote.Loading -> CircularProgressIndicator(Modifier.size(24.dp))

                    is Remote.Failed -> Text(
                        stringResource(R.string.load_failed, state.message),
                        color = StatusColors.error,
                    )

                    is Remote.Loaded ->
                        if (state.value.isEmpty()) {
                            Text(stringResource(R.string.maintenance_none))
                        } else {
                            state.value.forEachIndexed { index, item ->
                                if (index > 0) HorizontalDivider()
                                MaintenanceRow(item, formatter)
                            }
                        }
                }
                TextButton(onClick = viewModel::loadMaintenance) { Text(stringResource(R.string.action_refresh)) }
            }
        }
        item {
            SectionCard(stringResource(R.string.section_trips)) {
                val totals = TripLog.totals(trips)
                Text(
                    stringResource(
                        R.string.trips_totals,
                        totals.trips,
                        formatter.distance(totals.distanceKm),
                        formatter.fuel(totals.fuelUsedL) ?: "–",
                    ),
                    style = MaterialTheme.typography.bodyMedium,
                )
                totals.costByCurrency.forEach { (currency, amount) ->
                    formatter.cost(amount, currency)?.let {
                        Text(stringResource(R.string.trips_cost_total, it), style = MaterialTheme.typography.bodySmall)
                    }
                }
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    FilledTonalButton(onClick = viewModel::syncTrips, enabled = sync !is Remote.Loading) {
                        Text(stringResource(R.string.action_sync_trips))
                    }
                    when (val state = sync) {
                        Remote.Loading -> CircularProgressIndicator(Modifier.size(20.dp))

                        is Remote.Failed -> Text(
                            stringResource(R.string.load_failed, state.message),
                            color = StatusColors.error,
                        )

                        is Remote.Loaded -> Text(
                            stringResource(R.string.trips_synced, state.value),
                            style = MaterialTheme.typography.bodySmall,
                        )

                        Remote.Idle -> Unit
                    }
                }
            }
        }
        if (trips.isEmpty()) {
            item {
                Text(
                    stringResource(R.string.trips_empty),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        items(trips, key = { it.id }) { trip -> TripRow(trip, formatter) }
    }
}

@Composable
private fun TripRow(trip: TripRecord, formatter: TripFormatter) {
    OutlinedCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(formatter.timeRange(trip.startedAt, trip.endedAt), style = MaterialTheme.typography.titleSmall)
            Text(formatter.summary(trip), style = MaterialTheme.typography.bodyLarge)
            val details =
                listOfNotNull(
                    formatter.economy(trip.avgLPer100km),
                    stringResource(R.string.trip_avg_speed, formatter.speed(trip.avgMovingSpeedKph)),
                    stringResource(R.string.trip_max_speed, formatter.speed(trip.maxSpeedKph)),
                    stringResource(R.string.trip_idle, formatter.duration(trip.idleS)),
                ).joinToString(" · ")
            Text(
                details,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun MaintenanceRow(item: MaintenanceItemStatus, formatter: TripFormatter) {
    val color =
        when (item.status) {
            MaintenanceStatusKind.OK -> StatusColors.ok
            MaintenanceStatusKind.DUE_SOON -> StatusColors.warning
            MaintenanceStatusKind.OVERDUE -> StatusColors.error
            MaintenanceStatusKind.UNKNOWN -> MaterialTheme.colorScheme.onSurfaceVariant
        }
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(item.label, style = MaterialTheme.typography.bodyLarge)
            formatter.maintenanceRemaining(item)?.let {
                Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        Text(TripFormatter.statusLabel(item.status), color = color, style = MaterialTheme.typography.labelLarge)
    }
}
