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

function fromDbLatLng(lat?: number | null, lng?: number | null): LatLng | null {
  if (typeof lat === 'number' && typeof lng === 'number') {
    return {
      latitude: lat,
      longitude: lng,
    };
  }
  return null;
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

    let orderRecord: any = null;
    if (delivery.orderId) {
      orderRecord = await prisma.customerOrder.findUnique({
        where: { id: delivery.orderId },
        select: {
          id: true,
          customerLat: true,
          customerLng: true,
          storeType: true,
          storeId: true,
        },
      });
    }

    let storeLocation: LatLng | null = null;

    if (orderRecord?.storeType === 'MEAT' && orderRecord?.storeId) {
      const meatShop = await prisma.meatShop.findUnique({
        where: { id: orderRecord.storeId },
        select: {
          lat: true,
          lng: true,
          address: true,
        },
      });

      storeLocation =
        fromDbLatLng(meatShop?.lat, meatShop?.lng) ||
        (await resolveAddress(meatShop?.address || delivery.storeAddress));
    } else if (orderRecord?.storeType === 'ORGANIC' && orderRecord?.storeId) {
      const organicShop = await prisma.organicShop.findUnique({
        where: { id: orderRecord.storeId },
        select: {
          lat: true,
          lng: true,
          address: true,
        },
      });

      storeLocation =
        fromDbLatLng(organicShop?.lat, organicShop?.lng) ||
        (await resolveAddress(organicShop?.address || delivery.storeAddress));
    } else {
      storeLocation = await resolveAddress(delivery.storeAddress);
    }

    const customerLocation =
      fromDbLatLng(orderRecord?.customerLat, orderRecord?.customerLng) ||
      (await resolveAddress(delivery.customerAddress));

    const partnerLocation =
      liveTracking?.partnerLocation &&
      typeof liveTracking.partnerLocation.lat === 'number' &&
      typeof liveTracking.partnerLocation.lng === 'number'
        ? {
            latitude: liveTracking.partnerLocation.lat,
            longitude: liveTracking.partnerLocation.lng,
          }
        : null;

    let route: LatLng[] = [];
    let etaMinutes: number | null = null;
    let distanceKm: number | null = null;

    const currentStatus = String(liveTracking?.status || delivery.status || '');

    if (partnerLocation) {
      const goingToStore = [
        'ASSIGNED',
        'ACCEPTED',
        'ON_THE_WAY_TO_STORE',
        'ARRIVED_AT_STORE',
      ].includes(currentStatus);

      const destination =
        goingToStore && storeLocation ? storeLocation : customerLocation;

      if (destination) {
        try {
          const liveRoute = await computeLiveRoute({
            origin: partnerLocation,
            destination,
            waypoints: [],
          });

          route = Array.isArray(liveRoute.route) ? liveRoute.route : [];
          etaMinutes =
            typeof liveRoute.etaMinutes === 'number' ? liveRoute.etaMinutes : null;
          distanceKm =
            typeof liveRoute.distanceKm === 'number' ? liveRoute.distanceKm : null;
        } catch (routeError) {
          console.error('Route compute error:', routeError);
        }
      }
    }

    console.log('TRACKING DEBUG deliveryId:', deliveryId);
    console.log('TRACKING DEBUG storeLocation:', storeLocation);
    console.log('TRACKING DEBUG customerLocation:', customerLocation);
    console.log('TRACKING DEBUG partnerLocation:', partnerLocation);
    console.log('TRACKING DEBUG etaMinutes:', etaMinutes);
    console.log('TRACKING DEBUG distanceKm:', distanceKm);
    console.log('TRACKING DEBUG route points:', route.length);

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
      liveTimestamp: liveTracking?.partnerLocation?.timestamp || null,
    });
  } catch (error: any) {
    console.error('TRACKING ROUTE ERROR:', error);
    return res.status(500).json({
      error: error?.message || 'Failed to fetch live tracking data',
    });
  }
});

export default router;