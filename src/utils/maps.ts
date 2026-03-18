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
  
  const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY || '';
  
  function assertMapsKey() {
    if (!GOOGLE_MAPS_API_KEY) {
      throw new Error('GOOGLE_MAPS_API_KEY is missing in environment variables');
    }
  }
  
  function parseDurationSeconds(duration?: string | null): number | null {
    if (!duration || typeof duration !== 'string') return null;
    const match = duration.match(/^([\d.]+)s$/);
    if (!match) return null;
    return Math.round(Number(match[1]));
  }
  
  export async function geocodeAddress(address: string): Promise<LatLng | null> {
    if (!address?.trim()) return null;
    assertMapsKey();
  
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
      address
    )}&key=${GOOGLE_MAPS_API_KEY}`;
  
    const resp = await fetch(url);
    if (!resp.ok) {
      throw new Error(`Geocoding failed with status ${resp.status}`);
    }
  
    const data = await resp.json();
    const first = data?.results?.[0];
    const loc = first?.geometry?.location;
  
    if (
      typeof loc?.lat === 'number' &&
      typeof loc?.lng === 'number'
    ) {
      return {
        latitude: loc.lat,
        longitude: loc.lng,
      };
    }
  
    return null;
  }
  
  export async function computeLiveRoute({
    origin,
    destination,
    waypoints = [],
  }: ComputeRouteInput): Promise<ComputeRouteResult> {
    assertMapsKey();
  
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
  
    const resp = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': GOOGLE_MAPS_API_KEY,
        'X-Goog-FieldMask':
          'routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline',
      },
      body: JSON.stringify(body),
    });
  
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Routes API failed: ${resp.status} ${text}`);
    }
  
    const data = await resp.json();
    const firstRoute = data?.routes?.[0];
  
    const encodedPolyline = firstRoute?.polyline?.encodedPolyline || null;
    const durationSeconds = parseDurationSeconds(firstRoute?.duration);
    const distanceMeters =
      typeof firstRoute?.distanceMeters === 'number' ? firstRoute.distanceMeters : null;
  
    return {
      route: encodedPolyline ? decodePolyline(encodedPolyline) : [],
      encodedPolyline,
      distanceMeters,
      durationSeconds,
      etaMinutes: durationSeconds != null ? Math.max(1, Math.ceil(durationSeconds / 60)) : null,
      distanceKm: distanceMeters != null ? Number((distanceMeters / 1000).toFixed(1)) : null,
    };
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