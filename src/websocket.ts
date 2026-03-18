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

function broadcastLocation(io: Server, deliveryId: string, payload: any) {
  io.to(legacyRoom(deliveryId)).emit('partner-location', payload);
  io.to(modernRoom(deliveryId)).emit('partner-location', payload);
}

function broadcastStatus(io: Server, deliveryId: string, payload: any) {
  io.to(legacyRoom(deliveryId)).emit('delivery-status', payload);
  io.to(modernRoom(deliveryId)).emit('delivery-status', payload);
  io.to(modernRoom(deliveryId)).emit('delivery-status-updated', payload);
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

    // ---------------------------------------------------
    // OLD EVENT: location-update
    // ---------------------------------------------------
    socket.on('location-update', (data) => {
      try {
        const { deliveryId, lat, lng, timestamp, heading, speed, accuracy } = data || {};
        if (!deliveryId || typeof lat !== 'number' || typeof lng !== 'number') {
          socket.emit('tracking-error', { message: 'Invalid location-update payload' });
          return;
        }

        console.log(`📍 Location update for delivery ${deliveryId}: (${lat}, ${lng})`);

        const delivery = getOrCreateDelivery(String(deliveryId));

        delivery.partnerLocation = {
          lat,
          lng,
          timestamp: timestamp ? new Date(timestamp) : new Date(),
          heading: typeof heading === 'number' ? heading : null,
          speed: typeof speed === 'number' ? speed : null,
          accuracy: typeof accuracy === 'number' ? accuracy : null,
        };

        broadcastLocation(io, String(deliveryId), {
          lat,
          lng,
          timestamp: delivery.partnerLocation.timestamp,
          heading: delivery.partnerLocation.heading ?? null,
          speed: delivery.partnerLocation.speed ?? null,
          accuracy: delivery.partnerLocation.accuracy ?? null,
        });
      } catch (error) {
        console.error('❌ location-update error:', error);
        socket.emit('tracking-error', { message: 'Failed to process location update' });
      }
    });
    socket.on("join-store-room", (storeId: string) => {
      if (!storeId) return;
      socket.join(`store-${String(storeId)}`);
      console.log(`🏪 ${socket.id} joined store-${String(storeId)}`);
    });
    
    socket.on("join-customer-room", (customerId: string) => {
      if (!customerId) return;
      socket.join(`customer-${String(customerId)}`);
      console.log(`👤 ${socket.id} joined customer-${String(customerId)}`);
    });
    
    socket.on("join-order-room", (orderId: string) => {
      if (!orderId) return;
      socket.join(`order-${String(orderId)}`);
      console.log(`📦 ${socket.id} joined order-${String(orderId)}`);
    });
    
    socket.on("join-delivery-partner-room", (deliveryPartnerId: string) => {
      if (!deliveryPartnerId) return;
      socket.join(`delivery-partner-${String(deliveryPartnerId)}`);
      socket.join(`delivery-partner:${String(deliveryPartnerId)}`);
      console.log(`🛵 ${socket.id} joined delivery-partner-${String(deliveryPartnerId)}`);
    });

    // ---------------------------------------------------
    // NEW EVENT: delivery-partner-location-update
    // ---------------------------------------------------
    socket.on('delivery-partner-location-update', (data) => {
      try {
        const { deliveryId, lat, lng, timestamp, heading, speed, accuracy } = data || {};
        if (!deliveryId || typeof lat !== 'number' || typeof lng !== 'number') {
          socket.emit('tracking-error', {
            message: 'Invalid delivery-partner-location-update payload',
          });
          return;
        }

        console.log(`📍 Partner live location for delivery ${deliveryId}: (${lat}, ${lng})`);

        const delivery = getOrCreateDelivery(String(deliveryId));

        delivery.partnerLocation = {
          lat,
          lng,
          timestamp: timestamp ? new Date(timestamp) : new Date(),
          heading: typeof heading === 'number' ? heading : null,
          speed: typeof speed === 'number' ? speed : null,
          accuracy: typeof accuracy === 'number' ? accuracy : null,
        };

        broadcastLocation(io, String(deliveryId), {
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

    // ---------------------------------------------------
    // OLD EVENT: delivery-status
    // ---------------------------------------------------
    socket.on('delivery-status', (data) => {
      try {
        const { deliveryId, status, estimatedDeliveryTime } = data || {};
        if (!deliveryId || !status) {
          socket.emit('tracking-error', { message: 'Invalid delivery-status payload' });
          return;
        }

        console.log(`📦 Status update for delivery ${deliveryId}: ${status}`);

        const delivery = getOrCreateDelivery(String(deliveryId), String(status));
        delivery.status = String(status);
        if (estimatedDeliveryTime) {
          delivery.estimatedDeliveryTime = String(estimatedDeliveryTime);
        }

        broadcastStatus(io, String(deliveryId), {
          deliveryId: String(deliveryId),
          status: delivery.status,
          estimatedDeliveryTime: delivery.estimatedDeliveryTime,
        });
      } catch (error) {
        console.error('❌ delivery-status error:', error);
        socket.emit('tracking-error', { message: 'Failed to process delivery status' });
      }
    });

    // ---------------------------------------------------
    // NEW EVENT: delivery-status-updated
    // ---------------------------------------------------
    socket.on('delivery-status-updated', (data) => {
      try {
        const { deliveryId, status, estimatedDeliveryTime } = data || {};
        if (!deliveryId || !status) {
          socket.emit('tracking-error', { message: 'Invalid delivery-status-updated payload' });
          return;
        }

        console.log(`📦 Modern status update for delivery ${deliveryId}: ${status}`);

        const delivery = getOrCreateDelivery(String(deliveryId), String(status));
        delivery.status = String(status);
        if (estimatedDeliveryTime) {
          delivery.estimatedDeliveryTime = String(estimatedDeliveryTime);
        }

        broadcastStatus(io, String(deliveryId), {
          deliveryId: String(deliveryId),
          status: delivery.status,
          estimatedDeliveryTime: delivery.estimatedDeliveryTime,
        });
      } catch (error) {
        console.error('❌ delivery-status-updated error:', error);
        socket.emit('tracking-error', { message: 'Failed to process modern delivery status' });
      }
    });

    // ---------------------------------------------------
    // OLD EVENT: track-delivery
    // ---------------------------------------------------
    socket.on('track-delivery', (deliveryId) => {
      const normalizedDeliveryId = String(deliveryId);
      console.log(`👤 Customer ${socket.id} tracking delivery ${normalizedDeliveryId}`);

      socket.join(legacyRoom(normalizedDeliveryId));
      socket.join(modernRoom(normalizedDeliveryId));

      const delivery = getOrCreateDelivery(normalizedDeliveryId);
      delivery.subscribers.add(socket.id);

      if (delivery.status) {
        socket.emit('delivery-status', {
          deliveryId: normalizedDeliveryId,
          status: delivery.status,
          estimatedDeliveryTime: delivery.estimatedDeliveryTime,
        });
      }

      if (delivery.partnerLocation) {
        socket.emit('partner-location', {
          lat: delivery.partnerLocation.lat,
          lng: delivery.partnerLocation.lng,
          timestamp: delivery.partnerLocation.timestamp,
          heading: delivery.partnerLocation.heading ?? null,
          speed: delivery.partnerLocation.speed ?? null,
          accuracy: delivery.partnerLocation.accuracy ?? null,
        });
      }
    });

    // ---------------------------------------------------
    // NEW EVENT: join-delivery-room
    // ---------------------------------------------------
    socket.on('join-delivery-room', (deliveryId) => {
      const normalizedDeliveryId = String(deliveryId);
      console.log(`👤 Socket ${socket.id} joined delivery room ${normalizedDeliveryId}`);

      socket.join(modernRoom(normalizedDeliveryId));
      socket.join(legacyRoom(normalizedDeliveryId));

      const delivery = getOrCreateDelivery(normalizedDeliveryId);
      delivery.subscribers.add(socket.id);

      if (delivery.status) {
        socket.emit('delivery-status', {
          deliveryId: normalizedDeliveryId,
          status: delivery.status,
          estimatedDeliveryTime: delivery.estimatedDeliveryTime,
        });
      }

      if (delivery.partnerLocation) {
        socket.emit('partner-location', {
          lat: delivery.partnerLocation.lat,
          lng: delivery.partnerLocation.lng,
          timestamp: delivery.partnerLocation.timestamp,
          heading: delivery.partnerLocation.heading ?? null,
          speed: delivery.partnerLocation.speed ?? null,
          accuracy: delivery.partnerLocation.accuracy ?? null,
        });
      }
    });

    // ---------------------------------------------------
    // OLD EVENT: stop-tracking
    // ---------------------------------------------------
    socket.on('stop-tracking', (deliveryId) => {
      const normalizedDeliveryId = String(deliveryId);
      console.log(`👤 Customer ${socket.id} stopped tracking delivery ${normalizedDeliveryId}`);

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
    });

    // ---------------------------------------------------
    // NEW EVENT: leave-delivery-room
    // ---------------------------------------------------
    socket.on('leave-delivery-room', (deliveryId) => {
      const normalizedDeliveryId = String(deliveryId);
      console.log(`👤 Socket ${socket.id} left delivery room ${normalizedDeliveryId}`);

      socket.leave(modernRoom(normalizedDeliveryId));
      socket.leave(legacyRoom(normalizedDeliveryId));

      const delivery = activeDeliveries.get(normalizedDeliveryId);
      if (delivery) {
        delivery.subscribers.delete(socket.id);
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
  return activeDeliveries.get(deliveryId);
}