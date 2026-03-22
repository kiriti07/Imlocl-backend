import { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { GeocodingService } from "../utils/geocoding";

const ordersRoutes: FastifyPluginAsync = async (app) => {
  const geocoder = GeocodingService.getInstance();

  // Create a new order (for meat, organic, etc.)
  app.post("/orders", async (req, reply) => {
    const body = z.object({
      serviceType: z.enum(['MEAT', 'ORGANIC', 'LAUNDRY']),
      storeId: z.string().uuid(),
      storeName: z.string(),
      customerName: z.string().min(1),
      customerPhone: z.string().min(8),
      customerAddress: z.string().min(1),
      items: z.array(z.object({
        itemId: z.string(),
        itemName: z.string(),
        quantity: z.number().positive(),
        price: z.number().positive(),
        unit: z.string().optional(),
      })),
      paymentMethod: z.enum(['CASH', 'CARD', 'UPI']),
      subtotal: z.number().positive(),
      deliveryFee: z.number().default(0),
      totalAmount: z.number().positive(),
      isScheduled: z.boolean().default(false),
      scheduledFor: z.string().datetime().optional(),
      scheduleSlot: z.string().optional(),
      deliveryNote: z.string().optional(),
    }).parse(req.body);

    // 1. Geocode customer address
    let customerLat = null;
    let customerLng = null;
    
    try {
      const coords = await geocoder.geocodeAddress(body.customerAddress);
      if (coords) {
        customerLat = coords.latitude;
        customerLng = coords.longitude;
        console.log(`📍 Geocoded customer address: ${customerLat}, ${customerLng}`);
      }
    } catch (error) {
      console.error('Failed to geocode customer address:', error);
    }

    // 2. Ensure store has coordinates
    let storeCoordinates = null;
    if (body.serviceType === 'MEAT') {
      const store = await app.prisma.meatShop.findUnique({
        where: { id: body.storeId }
      });
      if (store && (!store.lat || !store.lng)) {
        await geocoder.geocodeAndSaveStore('MEAT', body.storeId);
      }
    } else if (body.serviceType === 'ORGANIC') {
      const store = await app.prisma.organicShop.findUnique({
        where: { id: body.storeId }
      });
      if (store && (!store.lat || !store.lng)) {
        await geocoder.geocodeAndSaveStore('ORGANIC', body.storeId);
      }
    }

    // 3. Generate order number
    const orderNumber = `IML-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(Math.random() * 9000 + 1000)}`;

    // 4. Create the order
    const order = await app.prisma.customerOrder.create({
      data: {
        orderNumber,
        serviceType: body.serviceType,
        storeType: body.serviceType,
        storeId: body.storeId,
        storeName: body.storeName,
        customerName: body.customerName,
        customerPhone: body.customerPhone,
        customerAddress: body.customerAddress,
        customerLat,
        customerLng,
        paymentMethod: body.paymentMethod,
        subtotal: body.subtotal,
        deliveryFee: body.deliveryFee,
        totalAmount: body.totalAmount,
        isScheduled: body.isScheduled,
        scheduledFor: body.scheduledFor ? new Date(body.scheduledFor) : undefined,
        scheduleSlot: body.scheduleSlot,
        deliveryNote: body.deliveryNote,
        orderStatus: 'PLACED',
        paymentStatus: 'PENDING_CASH_COLLECTION',
        items: {
          create: body.items.map(item => ({
            itemId: item.itemId,
            itemName: item.itemName,
            quantity: item.quantity,
            price: item.price,
            unit: item.unit,
            lineTotal: item.price * item.quantity
          }))
        }
      },
      include: {
        items: true
      }
    });

    // 5. Create delivery record
    const delivery = await app.prisma.delivery.create({
      data: {
        orderId: order.id,
        partnerId: '', // Will be assigned when a partner accepts
        customerName: order.customerName,
        customerPhone: order.customerPhone,
        customerAddress: order.customerAddress,
        storeId: order.storeId,
        storeName: order.storeName,
        storeAddress: '', // Will be populated from store
        status: 'ASSIGNED',
        items: body.items,
        totalAmount: order.totalAmount,
        pickupOtp: Math.floor(1000 + Math.random() * 9000).toString(),
      }
    });

    // 6. Update order with delivery ID
    await app.prisma.customerOrder.update({
      where: { id: order.id },
      data: { deliveryId: delivery.id }
    });

    // 7. Notify via WebSocket about new order
    const io = app.websocketServer;
    if (io) {
      // Notify all delivery partners
      io.emit('new-order-available', {
        orderId: order.id,
        deliveryId: delivery.id,
        storeName: order.storeName,
        storeAddress: order.customerAddress,
        totalAmount: order.totalAmount
      });
    }

    return reply.send({
      success: true,
      order,
      delivery,
      message: 'Order created successfully'
    });
  });

  // Get order details with tracking info
  app.get("/orders/:id", async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);

    const order = await app.prisma.customerOrder.findUnique({
      where: { id },
      include: {
        items: true,
        statusHistory: {
          orderBy: { createdAt: 'desc' },
          take: 10
        }
      }
    });

    if (!order) {
      return reply.status(404).send({ error: 'Order not found' });
    }

    // Get delivery details if exists
    let delivery = null;
    if (order.deliveryId) {
      delivery = await app.prisma.delivery.findUnique({
        where: { id: order.deliveryId },
        include: {
          partner: {
            include: {
              deliveryPartner: true
            }
          }
        }
      });
    }

    return reply.send({ order, delivery });
  });

  // Update order status
  app.patch("/orders/:id/status", async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { status } = z.object({
      status: z.enum(['PLACED', 'ACCEPTED', 'PREPARING', 'READY', 'DELIVERED', 'CANCELLED'])
    }).parse(req.body);

    const order = await app.prisma.customerOrder.update({
      where: { id },
      data: {
        orderStatus: status,
        ...(status === 'ACCEPTED' ? { acceptedAt: new Date() } : {}),
        ...(status === 'DELIVERED' ? { deliveredAt: new Date() } : {})
      }
    });

    // Add to status history
    await app.prisma.orderStatusHistory.create({
      data: {
        orderId: id,
        status: status,
        actorType: 'SYSTEM',
        note: `Order status updated to ${status}`
      }
    });

    // Notify via WebSocket
    const io = app.websocketServer;
    if (io) {
      io.to(`order-${id}`).emit('order-status-updated', {
        orderId: id,
        status,
        timestamp: new Date()
      });
    }

    return reply.send(order);
  });

  // Get nearby stores (for customer app)
  app.get("/stores/nearby", async (req, reply) => {
    const { lat, lng, type, radius = 5 } = z.object({
      lat: z.number(),
      lng: z.number(),
      type: z.enum(['MEAT', 'ORGANIC', 'LAUNDRY']),
      radius: z.number().optional()
    }).parse(req.query);

    let stores = [];
    
    if (type === 'MEAT') {
      stores = await app.prisma.meatShop.findMany({
        where: {
          isOpen: true,
          lat: { not: null },
          lng: { not: null }
        }
      });
    } else if (type === 'ORGANIC') {
      stores = await app.prisma.organicShop.findMany({
        where: {
          isOpen: true,
          lat: { not: null },
          lng: { not: null }
        }
      });
    } else if (type === 'LAUNDRY') {
      stores = await app.prisma.laundryShop.findMany({
        where: {
          isOpen: true,
          lat: { not: null },
          lng: { not: null }
        }
      });
    }

    // Calculate distance and filter by radius
    const storesWithDistance = stores.map(store => {
      const distance = calculateDistance(lat, lng, store.lat!, store.lng!);
      return { ...store, distance: distance / 1000 }; // Convert to km
    }).filter(store => store.distance <= radius);

    return reply.send(storesWithDistance);
  });
};

// Helper function to calculate distance between two points
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000; // Earth's radius in meters
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

export default ordersRoutes;