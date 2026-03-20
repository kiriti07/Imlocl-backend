// src/routes/tracking.ts
import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { computeLiveRoute, geocodeAddress } from '../utils/maps';
import { getDeliveryStatus } from '../websocket';

const prisma = new PrismaClient();
const router = Router();

type LatLng = {
  latitude: number;
  longitude: number;
};

function normalizeParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] || '';
  return value || '';
}

async function resolveAddress(address?: string | null): Promise<LatLng | null> {
  if (!address) return null;

  try {
    return await geocodeAddress(address);
  } catch (error) {
    console.error('Geocoding error for address:', address, error);
    return null;
  }
}

router.get('/deliveries/:id/tracking', async (req: Request, res: Response) => {
  try {
    const deliveryId = normalizeParam(req.params.id);

    if (!deliveryId) {
      return res.status(400).json({ error: 'Delivery id is required' });
    }

    const delivery = await prisma.delivery.findUnique({
      where: { id: deliveryId },
      select: {
        id: true,
        orderId: true,
        partnerId: true,
        customerName: true,
        customerPhone: true,
        customerAddress: true,
        storeId: true,
        storeName: true,
        storeAddress: true,
        status: true,
        estimatedPickupTime: true,
        estimatedDeliveryTime: true,
        totalAmount: true,
      },
    });

    if (!delivery) {
      return res.status(404).json({ error: 'Delivery not found' });
    }

    const liveTracking = getDeliveryStatus(deliveryId);

    const storeLocation = await resolveAddress(delivery.storeAddress);
    const customerLocation = await resolveAddress(delivery.customerAddress);

    const partnerLat =
    typeof (liveTracking as any)?.partnerLocation?.lat === 'number'
        ? (liveTracking as any).partnerLocation.lat
        : typeof (liveTracking as any)?.lat === 'number'
        ? (liveTracking as any).lat
        : null;

    const partnerLng =
    typeof (liveTracking as any)?.partnerLocation?.lng === 'number'
        ? (liveTracking as any).partnerLocation.lng
        : typeof (liveTracking as any)?.lng === 'number'
        ? (liveTracking as any).lng
        : null;

    const partnerTimestamp =
    (liveTracking as any)?.partnerLocation?.timestamp ||
    (liveTracking as any)?.timestamp ||
    null;

    const partnerLocation =
    partnerLat !== null && partnerLng !== null
        ? {
            latitude: partnerLat,
            longitude: partnerLng,
        }
        : null;

    let route: LatLng[] = [];
    let etaMinutes: number | null = null;
    let distanceKm: number | null = null;

    if (partnerLocation && customerLocation) {
      const currentStatus = String(liveTracking?.status || delivery.status || '');

      const needsStoreFirst = [
        'ASSIGNED',
        'ACCEPTED',
        'ON_THE_WAY_TO_STORE',
        'ARRIVED_AT_STORE',
      ].includes(currentStatus);

      const waypoints: LatLng[] =
        needsStoreFirst && storeLocation ? [storeLocation] : [];

      try {
        const liveRoute = await computeLiveRoute({
          origin: partnerLocation,
          destination: customerLocation,
          waypoints,
        });

        route = liveRoute.route;
        etaMinutes = liveRoute.etaMinutes;
        distanceKm = liveRoute.distanceKm;
      } catch (routeError) {
        console.error('Route compute error:', routeError);
      }
    }

    return res.json({
      delivery: {
        id: delivery.id,
        orderId: delivery.orderId,
        partnerId: delivery.partnerId,
        status: liveTracking?.status || delivery.status,
        storeId: delivery.storeId,
        storeName: delivery.storeName,
        storeAddress: delivery.storeAddress,
        customerName: delivery.customerName,
        customerPhone: delivery.customerPhone,
        customerAddress: delivery.customerAddress,
        estimatedPickupTime: delivery.estimatedPickupTime,
        estimatedDeliveryTime:
          liveTracking?.estimatedDeliveryTime || delivery.estimatedDeliveryTime,
        totalAmount: delivery.totalAmount,
      },
      storeLocation,
      customerLocation,
      partnerLocation,
      route,
      etaMinutes,
      distanceKm,
      liveTimestamp: partnerTimestamp,
    });
  } catch (error: any) {
    console.error('TRACKING ROUTE ERROR:', error);
    return res.status(500).json({
      error: error?.message || 'Failed to fetch live tracking data',
    });
  }
});

export default router;