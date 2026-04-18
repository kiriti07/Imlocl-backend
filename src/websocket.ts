// src/websocket.ts
import { Server } from 'socket.io';
import http from 'http';

interface LocationUpdate {
  lat: number;
  lng: number;
  timestamp: Date;
  heading?: number | null;
  speed?: number | null;
  accuracy?: number | null;
}

interface DeliveryTracking {
  deliveryId: string;
  orderId?: string;
  partnerLocation?: LocationUpdate;
  subscribers: Set<string>;
  status: string;
  estimatedDeliveryTime?: string;
}

const activeDeliveries = new Map<string, DeliveryTracking>();

// orderId → deliveryId mapping so order-room subscribers get location updates
const orderToDelivery = new Map<string, string>();

function legacyRoom(deliveryId: string) {
  return `delivery-${deliveryId}`;
}

function modernRoom(deliveryId: string) {
  return `delivery:${deliveryId}`;
}

function getOrCreateDelivery(deliveryId: string, initialStatus = 'ASSIGNED') {
  let delivery = activeDeliveries.get(deliveryId);

  if (!delivery) {
    delivery = {
      deliveryId,
      subscribers: new Set<string>(),
      status: initialStatus,
    };
    activeDeliveries.set(deliveryId, delivery);
  }

  return delivery;
}

function sanitizeStatus(value: unknown, fallback = 'ASSIGNED') {
  const s = String(value || '').trim().toUpperCase();
  return s || fallback;
}

/**
 * Broadcast location to:
 * 1. delivery-${deliveryId} and delivery:${deliveryId} rooms (partner app / legacy)
 * 2. order-${orderId} room (customer tracking screen)
 *
 * Emits both 'partner-location' (legacy) and 'delivery-partner-location-update'
 * + 'location-update' (what the Customer App listens for).
 */
function broadcastLocation(io: Server, deliveryId: string, payload: any, orderId?: string) {
  const fullPayload = { ...payload, deliveryId };

  // ── Delivery rooms ──────────────────────────────────────────────────────────
  // Legacy event name (partner app, DeliveryRouteMap)
  io.to(legacyRoom(deliveryId)).emit('partner-location', fullPayload);
  io.to(modernRoom(deliveryId)).emit('partner-location', fullPayload);

  // Event names the Customer tracking screen listens for
  io.to(legacyRoom(deliveryId)).emit('delivery-partner-location-update', fullPayload);
  io.to(modernRoom(deliveryId)).emit('delivery-partner-location-update', fullPayload);
  io.to(legacyRoom(deliveryId)).emit('location-update', fullPayload);
  io.to(modernRoom(deliveryId)).emit('location-update', fullPayload);

  // ── Order room ──────────────────────────────────────────────────────────────
  // Customer App joins `order-${orderId}` via track-order event
  if (orderId) {
    io.to(`order-${orderId}`).emit('delivery-partner-location-update', fullPayload);
    io.to(`order-${orderId}`).emit('location-update', fullPayload);
    io.to(`order-${orderId}`).emit('partner-location', fullPayload);
  }
}

function broadcastStatus(io: Server, deliveryId: string, payload: any, orderId?: string) {
  io.to(legacyRoom(deliveryId)).emit('delivery-status', payload);
  io.to(legacyRoom(deliveryId)).emit('delivery-status-updated', payload);
  io.to(modernRoom(deliveryId)).emit('delivery-status', payload);
  io.to(modernRoom(deliveryId)).emit('delivery-status-updated', payload);

  if (orderId) {
    io.to(`order-${orderId}`).emit('delivery-status-updated', payload);
    io.to(`order-${orderId}`).emit('order-status-updated', payload);
  }
}

function emitCurrentSnapshot(socket: any, deliveryId: string) {
  const delivery = activeDeliveries.get(deliveryId);
  if (!delivery) return;

  socket.emit('delivery-status', {
    deliveryId,
    status: delivery.status,
    estimatedDeliveryTime: delivery.estimatedDeliveryTime || null,
  });

  if (delivery.partnerLocation) {
    const locationPayload = {
      deliveryId,
      orderId: delivery.orderId ?? null,
      lat: delivery.partnerLocation.lat,
      lng: delivery.partnerLocation.lng,
      timestamp: delivery.partnerLocation.timestamp,
      heading: delivery.partnerLocation.heading ?? null,
      speed: delivery.partnerLocation.speed ?? null,
      accuracy: delivery.partnerLocation.accuracy ?? null,
      status: delivery.status,
    };
    // Send with all event names so any listener picks it up
    socket.emit('partner-location', locationPayload);
    socket.emit('delivery-partner-location-update', locationPayload);
    socket.emit('location-update', locationPayload);
  }
}

export function setupWebSocket(server: http.Server) {
  const io = new Server(server, {
    cors: {
      origin: ['http://localhost:8081', 'http://localhost:8082', '*'],
      methods: ['GET', 'POST'],
      credentials: true,
    },
  });

  console.log('🔌 WebSocket server initialized');

  io.on('connection', (socket) => {
    console.log(`🟢 Client connected: ${socket.id}`);

    // ── Room joins ────────────────────────────────────────────────────────────

    socket.on('join-store-room', (storeId: string) => {
      if (!storeId) return;
      socket.join(`store-${String(storeId)}`);
      console.log(`🏪 ${socket.id} joined store-${String(storeId)}`);
    });

    socket.on('join-customer-room', (customerId: string) => {
      if (!customerId) return;
      socket.join(`customer-${String(customerId)}`);
      console.log(`👤 ${socket.id} joined customer-${String(customerId)}`);
    });

    socket.on('join-order-room', (orderId: string) => {
      if (!orderId) return;
      socket.join(`order-${String(orderId)}`);
      console.log(`📦 ${socket.id} joined order-${String(orderId)}`);

      // If we already know the delivery for this order, send snapshot immediately
      const deliveryId = orderToDelivery.get(String(orderId));
      if (deliveryId) emitCurrentSnapshot(socket, deliveryId);
    });

    socket.on('join-delivery-partner-room', (deliveryPartnerId: string) => {
      if (!deliveryPartnerId) return;
      socket.join(`delivery-partner-${String(deliveryPartnerId)}`);
      socket.join(`delivery-partner:${String(deliveryPartnerId)}`);
      console.log(`🛵 ${socket.id} joined delivery-partner-${String(deliveryPartnerId)}`);
    });

    socket.on('join-delivery-room', (deliveryId: string) => {
      const normalizedDeliveryId = String(deliveryId || '').trim();
      if (!normalizedDeliveryId) return;

      socket.join(legacyRoom(normalizedDeliveryId));
      socket.join(modernRoom(normalizedDeliveryId));

      const delivery = getOrCreateDelivery(normalizedDeliveryId);
      delivery.subscribers.add(socket.id);

      console.log(`📦 Socket ${socket.id} joined delivery room ${normalizedDeliveryId}`);
      emitCurrentSnapshot(socket, normalizedDeliveryId);
    });

    /**
     * track-order — emitted by the Customer App tracking screen.
     * data can be { orderId } object or a plain orderId string.
     */
    socket.on('track-order', (data: any) => {
      const orderId = typeof data === 'string' ? data : data?.orderId;
      if (!orderId) return;

      const normalizedOrderId = String(orderId).trim();
      socket.join(`order-${normalizedOrderId}`);
      console.log(`📦 ${socket.id} tracking order ${normalizedOrderId}`);

      // If we already know which delivery maps to this order, send snapshot
      const deliveryId = orderToDelivery.get(normalizedOrderId);
      if (deliveryId) emitCurrentSnapshot(socket, deliveryId);
    });

    /**
     * track-delivery — emitted by the Customer App tracking screen once it
     * knows the deliveryId from the order response.
     */
    socket.on('track-delivery', (data: any) => {
      const deliveryId = typeof data === 'string' ? data : data?.deliveryId;
      if (!deliveryId) return;

      const normalizedDeliveryId = String(deliveryId).trim();
      socket.join(legacyRoom(normalizedDeliveryId));
      socket.join(modernRoom(normalizedDeliveryId));

      const delivery = getOrCreateDelivery(normalizedDeliveryId);
      delivery.subscribers.add(socket.id);

      console.log(`👤 Customer ${socket.id} tracking delivery ${normalizedDeliveryId}`);
      emitCurrentSnapshot(socket, normalizedDeliveryId);
    });

    socket.on('leave-delivery-room', (deliveryId: string) => {
      const normalizedDeliveryId = String(deliveryId || '').trim();
      if (!normalizedDeliveryId) return;

      socket.leave(legacyRoom(normalizedDeliveryId));
      socket.leave(modernRoom(normalizedDeliveryId));

      const delivery = activeDeliveries.get(normalizedDeliveryId);
      if (delivery) delivery.subscribers.delete(socket.id);

      console.log(`👤 Socket ${socket.id} left delivery room ${normalizedDeliveryId}`);
    });

    socket.on('stop-tracking', (deliveryId: string) => {
      const normalizedDeliveryId = String(deliveryId || '').trim();
      if (!normalizedDeliveryId) return;

      socket.leave(legacyRoom(normalizedDeliveryId));
      socket.leave(modernRoom(normalizedDeliveryId));

      const delivery = activeDeliveries.get(normalizedDeliveryId);
      if (delivery) {
        delivery.subscribers.delete(socket.id);

        if (delivery.subscribers.size === 0) {
          setTimeout(() => {
            const latest = activeDeliveries.get(normalizedDeliveryId);
            if (latest && latest.subscribers.size === 0) {
              activeDeliveries.delete(normalizedDeliveryId);
              console.log(`🧹 Cleaned up inactive delivery: ${normalizedDeliveryId}`);
            }
          }, 60 * 60 * 1000);
        }
      }

      console.log(`👤 Customer ${socket.id} stopped tracking delivery ${normalizedDeliveryId}`);
    });

    // ── Location updates ──────────────────────────────────────────────────────

    socket.on('location-update', (data) => {
      try {
        const { deliveryId, orderId, lat, lng, timestamp, heading, speed, accuracy, status } = data || {};

        if (!deliveryId || typeof lat !== 'number' || typeof lng !== 'number') {
          socket.emit('tracking-error', { message: 'Invalid location-update payload' });
          return;
        }

        const normalizedDeliveryId = String(deliveryId);
        const normalizedOrderId    = orderId ? String(orderId) : undefined;

        // Store orderId↔deliveryId mapping
        if (normalizedOrderId) {
          orderToDelivery.set(normalizedOrderId, normalizedDeliveryId);
        }

        const delivery = getOrCreateDelivery(normalizedDeliveryId, sanitizeStatus(status));
        if (status) delivery.status = sanitizeStatus(status, delivery.status);
        if (normalizedOrderId) delivery.orderId = normalizedOrderId;

        delivery.partnerLocation = {
          lat, lng,
          timestamp: timestamp ? new Date(timestamp) : new Date(),
          heading:  typeof heading  === 'number' ? heading  : null,
          speed:    typeof speed    === 'number' ? speed    : null,
          accuracy: typeof accuracy === 'number' ? accuracy : null,
        };

        console.log(`📍 Location update for delivery ${normalizedDeliveryId}: (${lat}, ${lng})`);

        broadcastLocation(io, normalizedDeliveryId, {
          lat, lng,
          orderId:   normalizedOrderId ?? null,
          timestamp: delivery.partnerLocation.timestamp,
          heading:   delivery.partnerLocation.heading  ?? null,
          speed:     delivery.partnerLocation.speed    ?? null,
          accuracy:  delivery.partnerLocation.accuracy ?? null,
          status:    delivery.status,
        }, normalizedOrderId);

      } catch (error) {
        console.error('❌ location-update error:', error);
        socket.emit('tracking-error', { message: 'Failed to process location update' });
      }
    });

    socket.on('delivery-partner-location-update', (data) => {
      try {
        const { deliveryId, orderId, lat, lng, timestamp, heading, speed, accuracy, status } = data || {};

        if (!deliveryId || typeof lat !== 'number' || typeof lng !== 'number') {
          socket.emit('tracking-error', {
            message: 'Invalid delivery-partner-location-update payload',
          });
          return;
        }

        const normalizedDeliveryId = String(deliveryId);
        const normalizedOrderId    = orderId ? String(orderId) : undefined;

        // Store orderId↔deliveryId mapping so order-room subscribers get updates
        if (normalizedOrderId) {
          orderToDelivery.set(normalizedOrderId, normalizedDeliveryId);
        }

        const delivery = getOrCreateDelivery(normalizedDeliveryId, sanitizeStatus(status));
        if (status) delivery.status = sanitizeStatus(status, delivery.status);
        if (normalizedOrderId) delivery.orderId = normalizedOrderId;

        delivery.partnerLocation = {
          lat, lng,
          timestamp: timestamp ? new Date(timestamp) : new Date(),
          heading:  typeof heading  === 'number' ? heading  : null,
          speed:    typeof speed    === 'number' ? speed    : null,
          accuracy: typeof accuracy === 'number' ? accuracy : null,
        };

        console.log(
          `📍 Partner live location for delivery ${normalizedDeliveryId}: (${lat}, ${lng}) status=${delivery.status}`
        );

        broadcastLocation(io, normalizedDeliveryId, {
          lat, lng,
          orderId:   normalizedOrderId ?? null,
          timestamp: delivery.partnerLocation.timestamp,
          heading:   delivery.partnerLocation.heading  ?? null,
          speed:     delivery.partnerLocation.speed    ?? null,
          accuracy:  delivery.partnerLocation.accuracy ?? null,
          status:    delivery.status,
        }, normalizedOrderId);

      } catch (error) {
        console.error('❌ delivery-partner-location-update error:', error);
        socket.emit('tracking-error', {
          message: 'Failed to process partner live location',
        });
      }
    });

    // ── Status updates ────────────────────────────────────────────────────────

    socket.on('delivery-status', (data) => {
      try {
        const { deliveryId, orderId, status, estimatedDeliveryTime } = data || {};
        if (!deliveryId || !status) {
          socket.emit('tracking-error', { message: 'Invalid delivery-status payload' });
          return;
        }

        const normalizedDeliveryId = String(deliveryId);
        const normalizedOrderId    = orderId ? String(orderId) : undefined;

        const delivery = getOrCreateDelivery(normalizedDeliveryId, sanitizeStatus(status));
        delivery.status = sanitizeStatus(status, delivery.status);
        if (estimatedDeliveryTime) delivery.estimatedDeliveryTime = String(estimatedDeliveryTime);
        if (normalizedOrderId) {
          delivery.orderId = normalizedOrderId;
          orderToDelivery.set(normalizedOrderId, normalizedDeliveryId);
        }

        console.log(`📦 Status update for delivery ${normalizedDeliveryId}: ${delivery.status}`);

        broadcastStatus(io, normalizedDeliveryId, {
          deliveryId: normalizedDeliveryId,
          orderId:    normalizedOrderId ?? null,
          status:     delivery.status,
          estimatedDeliveryTime: delivery.estimatedDeliveryTime || null,
        }, normalizedOrderId);

      } catch (error) {
        console.error('❌ delivery-status error:', error);
        socket.emit('tracking-error', { message: 'Failed to process delivery status' });
      }
    });

    socket.on('delivery-status-updated', (data) => {
      try {
        const { deliveryId, orderId, status, estimatedDeliveryTime } = data || {};
        if (!deliveryId || !status) {
          socket.emit('tracking-error', { message: 'Invalid delivery-status-updated payload' });
          return;
        }

        const normalizedDeliveryId = String(deliveryId);
        const normalizedOrderId    = orderId ? String(orderId) : undefined;

        const delivery = getOrCreateDelivery(normalizedDeliveryId, sanitizeStatus(status));
        delivery.status = sanitizeStatus(status, delivery.status);
        if (estimatedDeliveryTime) delivery.estimatedDeliveryTime = String(estimatedDeliveryTime);
        if (normalizedOrderId) {
          delivery.orderId = normalizedOrderId;
          orderToDelivery.set(normalizedOrderId, normalizedDeliveryId);
        }

        console.log(`📦 Modern status update for delivery ${normalizedDeliveryId}: ${delivery.status}`);

        broadcastStatus(io, normalizedDeliveryId, {
          deliveryId: normalizedDeliveryId,
          orderId:    normalizedOrderId ?? null,
          status:     delivery.status,
          estimatedDeliveryTime: delivery.estimatedDeliveryTime || null,
        }, normalizedOrderId);

      } catch (error) {
        console.error('❌ delivery-status-updated error:', error);
        socket.emit('tracking-error', { message: 'Failed to process modern delivery status' });
      }
    });

    // ── Live Chat ─────────────────────────────────────────────────────────────

    socket.on('agent-join-chat', (data: { roomId: string }) => {
      if (!data?.roomId) return;
      socket.join(`chat-${data.roomId}`);
      console.log(`💬 Agent ${socket.id} joined chat room: ${data.roomId}`);
    });

    socket.on('user-join-chat', (data: { roomId: string }) => {
      if (!data?.roomId) return;
      socket.join(`chat-${data.roomId}`);
      console.log(`💬 User ${socket.id} joined chat room: ${data.roomId}`);
    });

    socket.on('chat-send-message', async (data: {
      roomId:     string;
      senderId:   string;
      senderType: string;
      senderName: string;
      message:    string;
    }) => {
      try {
        if (!data?.roomId || !data?.message?.trim()) return;

        const { PrismaClient } = await import('@prisma/client');
        const prismaChat = new PrismaClient();

        const saved = await prismaChat.chatMessage.create({
          data: {
            roomId:     String(data.roomId),
            senderId:   String(data.senderId),
            senderType: String(data.senderType),
            senderName: String(data.senderName),
            message:    String(data.message).trim(),
          },
        });

        await prismaChat.$disconnect();

        console.log(`💬 Chat message in room ${data.roomId} from ${data.senderName}`);
        io.to(`chat-${data.roomId}`).emit('chat-new-message', saved);
      } catch (error) {
        console.error('❌ chat-send-message error:', error);
        socket.emit('chat-error', { message: 'Failed to send message' });
      }
    });

    socket.on('chat-load-history', async (data: { roomId: string }) => {
      try {
        if (!data?.roomId) return;

        const { PrismaClient } = await import('@prisma/client');
        const prismaChat = new PrismaClient();

        const messages = await prismaChat.chatMessage.findMany({
          where: { roomId: String(data.roomId) },
          orderBy: { createdAt: 'asc' },
          take: 100,
        });

        await prismaChat.$disconnect();

        socket.emit('chat-history', { roomId: data.roomId, messages });
      } catch (error) {
        console.error('❌ chat-load-history error:', error);
      }
    });

    socket.on('chat-mark-read', async (data: { roomId: string }) => {
      try {
        if (!data?.roomId) return;

        const { PrismaClient } = await import('@prisma/client');
        const prismaChat = new PrismaClient();

        await prismaChat.chatMessage.updateMany({
          where: { roomId: String(data.roomId), isRead: false, senderType: { not: 'AGENT' } },
          data:  { isRead: true },
        });

        await prismaChat.$disconnect();

        io.to(`chat-${data.roomId}`).emit('chat-messages-read', { roomId: data.roomId });
      } catch (error) {
        console.error('❌ chat-mark-read error:', error);
      }
    });

    // ── Disconnect ────────────────────────────────────────────────────────────

    socket.on('disconnect', () => {
      console.log(`🔴 Client disconnected: ${socket.id}`);

      activeDeliveries.forEach((delivery) => {
        if (delivery.subscribers.has(socket.id)) {
          delivery.subscribers.delete(socket.id);
        }
      });
    });
  });

  return io;
}

export function getDeliveryStatus(deliveryId: string) {
  return activeDeliveries.get(String(deliveryId));
}