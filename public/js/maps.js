let mapsReadyPromise = null;

export function waitForGoogleMaps(timeout = 15000) {
  if (mapsReadyPromise) return mapsReadyPromise;

  mapsReadyPromise = new Promise((resolve, reject) => {
    const start = Date.now();

    function check() {
      if (
        window.google &&
        window.google.maps &&
        window.google.maps.places &&
        window.google.maps.Map &&
        window.google.maps.Marker &&
        window.google.maps.Geocoder &&
        window.google.maps.DirectionsService
      ) {
        resolve(window.google.maps);
        return;
      }

      if (Date.now() - start > timeout) {
        reject(new Error("Google Maps no terminó de cargar a tiempo."));
        return;
      }

      setTimeout(check, 100);
    }

    check();
  });

  return mapsReadyPromise;
}

export async function createSingleMap(mapElementId, fallbackCenter = { lat: 4.711, lng: -74.0721 }) {
  const maps = await waitForGoogleMaps();
  const el = document.getElementById(mapElementId);

  if (!el) {
    throw new Error(`No se encontró el contenedor del mapa: ${mapElementId}`);
  }

  const map = new maps.Map(el, {
    center: fallbackCenter,
    zoom: 12,
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: false
  });

  const marker = new maps.Marker({
    map,
    position: fallbackCenter
  });

  return { map, marker, maps };
}

export function setMapLocation({ map, marker, place, latLng }) {
  if (!map || !marker) return;

  if (place?.geometry?.location) {
    const location = place.geometry.location;
    map.setCenter(location);
    map.setZoom(17);
    marker.setPosition(location);
    return;
  }

  if (latLng?.lat != null && latLng?.lng != null) {
    map.setCenter(latLng);
    map.setZoom(17);
    marker.setPosition(latLng);
  }
}

export async function initSingleAutocomplete({
  inputId,
  onSelected
}) {
  const maps = await waitForGoogleMaps();

  const input = document.getElementById(inputId);
  if (!input) {
    throw new Error(`No se encontró el input ${inputId}`);
  }

  const options = {
    fields: ["place_id", "formatted_address", "name", "geometry"],
    componentRestrictions: { country: "co" }
  };

  const autocomplete = new maps.places.Autocomplete(input, options);

  autocomplete.addListener("place_changed", () => {
    const place = autocomplete.getPlace();
    onSelected?.(place);
  });

  return autocomplete;
}

export async function reverseGeocodeLatLng(latLng) {
  const maps = await waitForGoogleMaps();
  const geocoder = new maps.Geocoder();

  const result = await geocoder.geocode({ location: latLng });
  const first = result?.results?.[0];

  if (!first) {
    throw new Error("No se encontró una dirección para ese punto.");
  }

  return {
    address: first.formatted_address || "",
    placeId: first.place_id || "",
    latLng: {
      lat: Number(latLng.lat),
      lng: Number(latLng.lng)
    },
    raw: first
  };
}

export async function calculateRouteDistance({
  originPlaceId,
  destinationPlaceId,
  originAddress,
  destinationAddress,
  originLatLng,
  destinationLatLng,
  travelMode = "DRIVING"
}) {
  const maps = await waitForGoogleMaps();
  const directionsService = new maps.DirectionsService();

  let origin = originAddress;
  let destination = destinationAddress;

  if (originPlaceId) origin = { placeId: originPlaceId };
  else if (originLatLng?.lat != null && originLatLng?.lng != null) origin = originLatLng;

  if (destinationPlaceId) destination = { placeId: destinationPlaceId };
  else if (destinationLatLng?.lat != null && destinationLatLng?.lng != null) destination = destinationLatLng;

  const request = {
    origin,
    destination,
    travelMode: maps.TravelMode[travelMode] || maps.TravelMode.DRIVING,
    unitSystem: maps.UnitSystem.METRIC,
    provideRouteAlternatives: false
  };

  const result = await directionsService.route(request);

  const route = result?.routes?.[0];
  const leg = route?.legs?.[0];

  if (!leg?.distance?.value) {
    throw new Error("No fue posible calcular la distancia de la ruta.");
  }

  const distanceMeters = Number(leg.distance.value || 0);
  const distanceKm = Number((distanceMeters / 1000).toFixed(1));

  return {
    raw: result,
    route,
    leg,
    distanceMeters,
    distanceKm,
    distanceText: leg.distance.text || `${distanceKm} km`,
    durationText: leg.duration?.text || ""
  };
}