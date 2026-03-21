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
  partnerLocation?: LocationUpdate;
  subscribers: Set<string>;
  status: string;
  estimatedDeliveryTime?: string;
}

const activeDeliveries = new Map<string, DeliveryTracking>();

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

function broadcastLocation(io: Server, deliveryId: string, payload: any) {
  io.to(legacyRoom(deliveryId)).emit('partner-location', payload);
  io.to(modernRoom(deliveryId)).emit('partner-location', payload);
}

function broadcastStatus(io: Server, deliveryId: string, payload: any) {
  io.to(legacyRoom(deliveryId)).emit('delivery-status', payload);
  io.to(legacyRoom(deliveryId)).emit('delivery-status-updated', payload);

  io.to(modernRoom(deliveryId)).emit('delivery-status', payload);
  io.to(modernRoom(deliveryId)).emit('delivery-status-updated', payload);
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
    socket.emit('partner-location', {
      lat: delivery.partnerLocation.lat,
      lng: delivery.partnerLocation.lng,
      timestamp: delivery.partnerLocation.timestamp,
      heading: delivery.partnerLocation.heading ?? null,
      speed: delivery.partnerLocation.speed ?? null,
      accuracy: delivery.partnerLocation.accuracy ?? null,
      status: delivery.status,
    });
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

      console.log(`👤 Socket ${socket.id} joined delivery room ${normalizedDeliveryId}`);

      emitCurrentSnapshot(socket, normalizedDeliveryId);
    });

    socket.on('track-delivery', (deliveryId: string) => {
      const normalizedDeliveryId = String(deliveryId || '').trim();
      if (!normalizedDeliveryId) return;

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
      if (delivery) {
        delivery.subscribers.delete(socket.id);
      }

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

    socket.on('location-update', (data) => {
      try {
        const { deliveryId, lat, lng, timestamp, heading, speed, accuracy, status } = data || {};

        if (!deliveryId || typeof lat !== 'number' || typeof lng !== 'number') {
          socket.emit('tracking-error', { message: 'Invalid location-update payload' });
          return;
        }

        const normalizedDeliveryId = String(deliveryId);
        const delivery = getOrCreateDelivery(normalizedDeliveryId, sanitizeStatus(status));

        if (status) {
          delivery.status = sanitizeStatus(status, delivery.status);
        }

        delivery.partnerLocation = {
          lat,
          lng,
          timestamp: timestamp ? new Date(timestamp) : new Date(),
          heading: typeof heading === 'number' ? heading : null,
          speed: typeof speed === 'number' ? speed : null,
          accuracy: typeof accuracy === 'number' ? accuracy : null,
        };

        console.log(`📍 Location update for delivery ${normalizedDeliveryId}: (${lat}, ${lng})`);

        broadcastLocation(io, normalizedDeliveryId, {
          lat,
          lng,
          timestamp: delivery.partnerLocation.timestamp,
          heading: delivery.partnerLocation.heading ?? null,
          speed: delivery.partnerLocation.speed ?? null,
          accuracy: delivery.partnerLocation.accuracy ?? null,
          status: delivery.status,
        });
      } catch (error) {
        console.error('❌ location-update error:', error);
        socket.emit('tracking-error', { message: 'Failed to process location update' });
      }
    });

    socket.on('delivery-partner-location-update', (data) => {
      try {
        const { deliveryId, lat, lng, timestamp, heading, speed, accuracy, status } = data || {};

        if (!deliveryId || typeof lat !== 'number' || typeof lng !== 'number') {
          socket.emit('tracking-error', {
            message: 'Invalid delivery-partner-location-update payload',
          });
          return;
        }

        const normalizedDeliveryId = String(deliveryId);
        const delivery = getOrCreateDelivery(normalizedDeliveryId, sanitizeStatus(status));

        if (status) {
          delivery.status = sanitizeStatus(status, delivery.status);
        }

        delivery.partnerLocation = {
          lat,
          lng,
          timestamp: timestamp ? new Date(timestamp) : new Date(),
          heading: typeof heading === 'number' ? heading : null,
          speed: typeof speed === 'number' ? speed : null,
          accuracy: typeof accuracy === 'number' ? accuracy : null,
        };

        console.log(
          `📍 Partner live location for delivery ${normalizedDeliveryId}: (${lat}, ${lng}) status=${delivery.status}`
        );

        broadcastLocation(io, normalizedDeliveryId, {
          lat,
          lng,
          timestamp: delivery.partnerLocation.timestamp,
          heading: delivery.partnerLocation.heading ?? null,
          speed: delivery.partnerLocation.speed ?? null,
          accuracy: delivery.partnerLocation.accuracy ?? null,
          status: delivery.status,
        });
      } catch (error) {
        console.error('❌ delivery-partner-location-update error:', error);
        socket.emit('tracking-error', {
          message: 'Failed to process partner live location',
        });
      }
    });

    socket.on('delivery-status', (data) => {
      try {
        const { deliveryId, status, estimatedDeliveryTime } = data || {};
        if (!deliveryId || !status) {
          socket.emit('tracking-error', { message: 'Invalid delivery-status payload' });
          return;
        }

        const normalizedDeliveryId = String(deliveryId);
        const delivery = getOrCreateDelivery(normalizedDeliveryId, sanitizeStatus(status));

        delivery.status = sanitizeStatus(status, delivery.status);
        if (estimatedDeliveryTime) {
          delivery.estimatedDeliveryTime = String(estimatedDeliveryTime);
        }

        console.log(`📦 Status update for delivery ${normalizedDeliveryId}: ${delivery.status}`);

        broadcastStatus(io, normalizedDeliveryId, {
          deliveryId: normalizedDeliveryId,
          status: delivery.status,
          estimatedDeliveryTime: delivery.estimatedDeliveryTime || null,
        });
      } catch (error) {
        console.error('❌ delivery-status error:', error);
        socket.emit('tracking-error', { message: 'Failed to process delivery status' });
      }
    });

    socket.on('delivery-status-updated', (data) => {
      try {
        const { deliveryId, status, estimatedDeliveryTime } = data || {};
        if (!deliveryId || !status) {
          socket.emit('tracking-error', { message: 'Invalid delivery-status-updated payload' });
          return;
        }

        const normalizedDeliveryId = String(deliveryId);
        const delivery = getOrCreateDelivery(normalizedDeliveryId, sanitizeStatus(status));

        delivery.status = sanitizeStatus(status, delivery.status);
        if (estimatedDeliveryTime) {
          delivery.estimatedDeliveryTime = String(estimatedDeliveryTime);
        }

        console.log(`📦 Modern status update for delivery ${normalizedDeliveryId}: ${delivery.status}`);

        broadcastStatus(io, normalizedDeliveryId, {
          deliveryId: normalizedDeliveryId,
          status: delivery.status,
          estimatedDeliveryTime: delivery.estimatedDeliveryTime || null,
        });
      } catch (error) {
        console.error('❌ delivery-status-updated error:', error);
        socket.emit('tracking-error', { message: 'Failed to process modern delivery status' });
      }
    });

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