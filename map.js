// set environment
import mapboxgl from 'https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm';
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm';

console.log('Mapbox GL JS Loaded:', mapboxgl);
console.log('D3 Loaded:', d3);

mapboxgl.accessToken =
    'pk.eyJ1Ijoibm9uYW1lY2FucGFzc3Nvb29vc2FkIiwiYSI6ImNtNjdiZ3lnYTAwem8ya3EwZXBla2lpdmgifQ.hQmah8l_sPm94KPF2ocG9A';

// Initialize the map
const map = new mapboxgl.Map({
    container: 'map',
    style: 'mapbox://styles/mapbox/streets-v12',
    center: [-71.09415, 42.36027],
    zoom: 12,
    minZoom: 5,
    maxZoom: 18
});

// ---------- Shared Bike Lane Style ----------
const bikeLaneStyle = {
    'line-color': '#0B8A00',
    'line-width': 3,
    'line-opacity': 0.6
};

// Step 6 — traffic flow quantize scale
let stationFlow = d3.scaleQuantize()
    .domain([0, 1])
    .range([0, 0.5, 1]);

// ---------- Helper: Convert lon/lat → map projection ----------
function getCoords(station) {
    const point = new mapboxgl.LngLat(+station.lon, +station.lat);
    const { x, y } = map.project(point);
    return { cx: x, cy: y };
}

// ===========================================================
//       ★ NEW ★ Step 5.3 – Global helper functions
// ===========================================================

// Convert minutes → "HH:MM AM/PM"
function formatTime(minutes) {
    const date = new Date(0, 0, 0, 0, minutes);
    return date.toLocaleString('en-US', { timeStyle: 'short' });
}

// Convert a Date object into minutes since midnight
function minutesSinceMidnight(date) {
    return date.getHours() * 60 + date.getMinutes();
}

// Filter trips that start OR end within 60 min of selected time
function filterTripsbyTime(trips, timeFilter) {
    return timeFilter === -1
        ? trips
        : trips.filter((trip) => {
            const startedMinutes = minutesSinceMidnight(trip.started_at);
            const endedMinutes = minutesSinceMidnight(trip.ended_at);

            return (
                Math.abs(startedMinutes - timeFilter) <= 60 ||
                Math.abs(endedMinutes - timeFilter) <= 60
            );
        });
}

// Compute departures, arrivals, totalTraffic for each station
function computeStationTraffic(stations, trips) {
    // count departures
    const departures = d3.rollup(
        trips,
        v => v.length,
        d => d.start_station_id
    );

    // count arrivals
    const arrivals = d3.rollup(
        trips,
        v => v.length,
        d => d.end_station_id
    );

    // update station objects
    return stations.map(station => {
        const id = station.short_name;
        station.arrivals = arrivals.get(id) ?? 0;
        station.departures = departures.get(id) ?? 0;
        station.totalTraffic = station.arrivals + station.departures;
        return station;
    });
}

// ===========================================================
//                 MAIN LOGIC
// ===========================================================

map.on('load', async () => {

    // ---- Load Boston Bike Lanes ----
    map.addSource('boston_route', {
        type: 'geojson',
        data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson'
    });

    map.addLayer({
        id: 'boston-bike-lanes',
        type: 'line',
        source: 'boston_route',
        paint: bikeLaneStyle
    });

    // ---- Load Cambridge Bike Lanes ----
    map.addSource('cambridge_route', {
        type: 'geojson',
        data: 'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson'
    });

    map.addLayer({
        id: 'cambridge-bike-lanes',
        type: 'line',
        source: 'cambridge_route',
        paint: bikeLaneStyle
    });

    console.log("Boston + Cambridge bike lanes loaded.");

    // ======================================================
    //       Step 3 — Fetch & Plot Bluebike Stations
    // ======================================================

    const svg = d3.select('#map').select('svg');

    // Load station JSON
    let stations = [];
    try {
        const jsonurl = 'https://dsc106.com/labs/lab07/data/bluebikes-stations.json';
        const jsonData = await d3.json(jsonurl);
        stations = jsonData.data.stations;
    } catch (err) {
        console.error("Error loading stations:", err);
        return;
    }

    // ======================================================
    //             ★ Updated trip parsing (Step 5.3)
    // ======================================================

    const tripsUrl = 'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv';

    const trips = await d3.csv(
        tripsUrl,
        (trip) => {
            trip.started_at = new Date(trip.started_at);
            trip.ended_at = new Date(trip.ended_at);
            return trip;
        }
    );

    // Compute initial full traffic
    stations = computeStationTraffic(stations, trips);

    // radius scale — initial default
    const radiusScale = d3
        .scaleSqrt()
        .domain([0, d3.max(stations, d => d.totalTraffic)])
        .range([0, 25]);

    // ======================================================
    //       Draw initial circles (with KEY function)
    // ======================================================
    const circles = svg
        .selectAll('circle')
        .data(stations, d => d.short_name) // ★ key function
        .enter()
        .append('circle')
        .attr("r", d => radiusScale(d.totalTraffic))
        .attr('fill', 'steelblue')
        .attr('stroke', 'white')
        .attr('stroke-width', 1)
        .attr('opacity', 0.8)
        .each(function (d) {
            d3.select(this)
                .append("title")
                .text(`${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`);
        });

    // Update circle positions
    function updatePositions() {
        circles
            .attr('cx', d => getCoords(d).cx)
            .attr('cy', d => getCoords(d).cy)
            .attr("r", d => radiusScale(d.totalTraffic));
    }

    updatePositions();

    map.on('move', updatePositions);
    map.on('zoom', updatePositions);
    map.on('resize', updatePositions);
    map.on('moveend', updatePositions);

    // ======================================================
    //          Step 5 — Slider Reactivity + Filtering
    // ======================================================

    const timeSlider = document.getElementById('time-slider');
    const selectedTime = document.getElementById('selected-time');
    const anyTimeLabel = document.getElementById('any-time');

    let timeFilter = -1; // default: show all

    // ======================================================
    //         ★ NEW ★ Update Scatterplot
    // ======================================================
    function updateScatterPlot(timeFilter) {

        const filteredTrips = filterTripsbyTime(trips, timeFilter);

        const filteredStations = computeStationTraffic(stations, filteredTrips);

        // Dynamic scale range
        if (timeFilter === -1) {
            radiusScale.range([0, 25]);
        } else {
            radiusScale.range([3, 50]);
        }

        circles
            .data(filteredStations, d => d.short_name)
            .join(
                enter => enter.append('circle')
                    .attr('stroke', 'white')
                    .attr('stroke-width', 1)
                    .attr('opacity', 0.8),
                update => update,
                exit => exit.remove()
            )
            .attr("cx", d => getCoords(d).cx)
            .attr("cy", d => getCoords(d).cy)
            .attr("r", d => radiusScale(d.totalTraffic))
            .style('--departure-ratio', d =>
                stationFlow(d.totalTraffic === 0
                    ? 0.5
                    : d.departures / d.totalTraffic
                )
            );
    }

    // ======================================================
    //         Update slider UI + trigger filtering
    // ======================================================
    function updateTimeDisplay() {

        timeFilter = Number(timeSlider.value);

        if (timeFilter === -1) {
            selectedTime.textContent = '';
            anyTimeLabel.style.display = 'block';
        } else {
            selectedTime.textContent = formatTime(timeFilter);
            anyTimeLabel.style.display = 'none';
        }

        updateScatterPlot(timeFilter);
    }

    timeSlider.addEventListener('input', updateTimeDisplay);

    updateTimeDisplay(); // initialize UI
});
