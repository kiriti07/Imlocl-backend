import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export class GeocodingService {
  private static instance: GeocodingService;
  private cache: Map<string, Coordinates> = new Map();
  private readonly apiKey: string;

  private constructor() {
    this.apiKey = process.env.GOOGLE_MAPS_API_KEY || '';
    if (!this.apiKey) {
      console.error('⚠️ GOOGLE_MAPS_API_KEY is not set!');
    }
  }

  static getInstance(): GeocodingService {
    if (!GeocodingService.instance) {
      GeocodingService.instance = new GeocodingService();
    }
    return GeocodingService.instance;
  }

  async geocodeAddress(address: string, forceRefresh = false): Promise<Coordinates | null> {
    if (!address?.trim()) return null;

    // Check cache first
    const cacheKey = address.toLowerCase().trim();
    if (!forceRefresh && this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    if (!this.apiKey) {
      console.error('Cannot geocode: No API key');
      return null;
    }

    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
      address
    )}&key=${this.apiKey}`;

    try {
      const response = await fetch(url);
      const data = await response.json();

      if (data.status === 'OK' && data.results?.[0]?.geometry?.location) {
        const location = data.results[0].geometry.location;
        const coords: Coordinates = {
          latitude: location.lat,
          longitude: location.lng
        };
        
        this.cache.set(cacheKey, coords);
        return coords;
      } else {
        console.warn(`Geocoding failed for "${address}": ${data.status}`);
        return null;
      }
    } catch (error) {
      console.error(`Geocoding error for "${address}":`, error);
      return null;
    }
  }

  async geocodeAndSaveStore(storeType: 'MEAT' | 'ORGANIC' | 'LAUNDRY', storeId: string): Promise<boolean> {
    let store: any;
    let address: string | null = null;

    if (storeType === 'MEAT') {
      store = await prisma.meatShop.findUnique({ where: { id: storeId } });
      address = store?.address;
    } else if (storeType === 'ORGANIC') {
      store = await prisma.organicShop.findUnique({ where: { id: storeId } });
      address = store?.address;
    } else if (storeType === 'LAUNDRY') {
      store = await prisma.laundryShop.findUnique({ where: { id: storeId } });
      address = store?.address;
    }

    if (!address) return false;

    const coords = await this.geocodeAddress(address);
    if (!coords) return false;

    const updateData = { lat: coords.latitude, lng: coords.longitude };

    if (storeType === 'MEAT') {
      await prisma.meatShop.update({ where: { id: storeId }, data: updateData });
    } else if (storeType === 'ORGANIC') {
      await prisma.organicShop.update({ where: { id: storeId }, data: updateData });
    } else if (storeType === 'LAUNDRY') {
      await prisma.laundryShop.update({ where: { id: storeId }, data: updateData });
    }

    return true;
  }
}