// src/utils/maps.ts
type LatLng = {
  latitude: number;
  longitude: number;
};

type ComputeRouteInput = {
  origin: LatLng;
  destination: LatLng;
  waypoints?: LatLng[];
};

type ComputeRouteResult = {
  route: LatLng[];
  encodedPolyline: string | null;
  distanceMeters: number | null;
  durationSeconds: number | null;
  etaMinutes: number | null;
  distanceKm: number | null;
};

function getMapsApiKey() {
  return process.env.GOOGLE_MAPS_API_KEY || '';
}

function hasMapsKey() {
  return !!getMapsApiKey();
}

function parseDurationSeconds(duration?: string | null): number | null {
  if (!duration || typeof duration !== 'string') return null;
  const match = duration.match(/^([\d.]+)s$/);
  if (!match) return null;
  return Math.round(Number(match[1]));
}

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}

function haversineDistanceMeters(a: LatLng, b: LatLng) {
  const R = 6371000;
  const dLat = toRadians(b.latitude - a.latitude);
  const dLng = toRadians(b.longitude - a.longitude);

  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);

  const x =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLng / 2) * Math.sin(dLng / 2) * Math.cos(lat1) * Math.cos(lat2);

  const c = 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  return Math.round(R * c);
}

function buildFallbackRoute(origin: LatLng, destination: LatLng, waypoints: LatLng[] = []) {
  const points = [origin, ...waypoints, destination];
  let distanceMeters = 0;

  for (let i = 0; i < points.length - 1; i++) {
    distanceMeters += haversineDistanceMeters(points[i], points[i + 1]);
  }

  // city driving approximation: 25 km/h
  const avgSpeedMetersPerSec = 25_000 / 3600;
  const durationSeconds = Math.max(60, Math.round(distanceMeters / avgSpeedMetersPerSec));

  return {
    route: points,
    encodedPolyline: null,
    distanceMeters,
    durationSeconds,
    etaMinutes: Math.max(1, Math.ceil(durationSeconds / 60)),
    distanceKm: Number((distanceMeters / 1000).toFixed(1)),
  };
}

export async function geocodeAddress(address: string): Promise<LatLng | null> {
  if (!address?.trim()) return null;

  const apiKey = getMapsApiKey();
  if (!apiKey) {
    console.warn('GOOGLE_MAPS_API_KEY missing. geocodeAddress returning null.');
    return null;
  }

  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
    address
  )}&key=${apiKey}`;

  try {
    const resp = await fetch(url);
    if (!resp.ok) {
      throw new Error(`Geocoding failed with status ${resp.status}`);
    }

    const data = await resp.json();
    const first = data?.results?.[0];
    const loc = first?.geometry?.location;

    if (typeof loc?.lat === 'number' && typeof loc?.lng === 'number') {
      return {
        latitude: loc.lat,
        longitude: loc.lng,
      };
    }

    console.warn('Geocoding returned no usable result for:', address);
    return null;
  } catch (error) {
    console.error('geocodeAddress error:', error);
    return null;
  }
}

export async function computeLiveRoute({
  origin,
  destination,
  waypoints = [],
}: ComputeRouteInput): Promise<ComputeRouteResult> {
  const apiKey = getMapsApiKey();

  if (!apiKey) {
    console.warn('GOOGLE_MAPS_API_KEY missing. Using fallback route.');
    return buildFallbackRoute(origin, destination, waypoints);
  }

  const body = {
    origin: {
      location: {
        latLng: {
          latitude: origin.latitude,
          longitude: origin.longitude,
        },
      },
    },
    destination: {
      location: {
        latLng: {
          latitude: destination.latitude,
          longitude: destination.longitude,
        },
      },
    },
    intermediates: waypoints.map((wp) => ({
      location: {
        latLng: {
          latitude: wp.latitude,
          longitude: wp.longitude,
        },
      },
    })),
    travelMode: 'DRIVE',
    routingPreference: 'TRAFFIC_AWARE',
    polylineQuality: 'HIGH_QUALITY',
    computeAlternativeRoutes: false,
    languageCode: 'en-US',
    units: 'METRIC',
  };

  try {
    const resp = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask':
          'routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline',
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const text = await resp.text();
      console.error(`Routes API failed: ${resp.status} ${text}`);
      return buildFallbackRoute(origin, destination, waypoints);
    }

    const data = await resp.json();
    const firstRoute = data?.routes?.[0];

    const encodedPolyline = firstRoute?.polyline?.encodedPolyline || null;
    const durationSeconds = parseDurationSeconds(firstRoute?.duration);
    const distanceMeters =
      typeof firstRoute?.distanceMeters === 'number' ? firstRoute.distanceMeters : null;

    if (!distanceMeters || !durationSeconds) {
      console.warn('Routes API returned incomplete data. Using fallback route.');
      return buildFallbackRoute(origin, destination, waypoints);
    }

    return {
      route: encodedPolyline ? decodePolyline(encodedPolyline) : [origin, ...waypoints, destination],
      encodedPolyline,
      distanceMeters,
      durationSeconds,
      etaMinutes: Math.max(1, Math.ceil(durationSeconds / 60)),
      distanceKm: Number((distanceMeters / 1000).toFixed(1)),
    };
  } catch (error) {
    console.error('computeLiveRoute error, using fallback route:', error);
    return buildFallbackRoute(origin, destination, waypoints);
  }
}

export function decodePolyline(encoded: string): LatLng[] {
  let index = 0;
  const len = encoded.length;
  let lat = 0;
  let lng = 0;
  const coordinates: LatLng[] = [];

  while (index < len) {
    let result = 0;
    let shift = 0;
    let b: number;

    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);

    const dlat = result & 1 ? ~(result >> 1) : result >> 1;
    lat += dlat;

    result = 0;
    shift = 0;

    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);

    const dlng = result & 1 ? ~(result >> 1) : result >> 1;
    lng += dlng;

    coordinates.push({
      latitude: lat / 1e5,
      longitude: lng / 1e5,
    });
  }

  return coordinates;
}