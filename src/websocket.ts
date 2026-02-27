// src/websocket.ts
import { Server } from 'socket.io';
import http from 'http';

// Store active deliveries and their subscribers
interface LocationUpdate {
  lat: number;
  lng: number;
  timestamp: Date;
}

interface DeliveryTracking {
  deliveryId: string;
  partnerLocation?: LocationUpdate;
  subscribers: Set<string>; // Socket IDs of customers tracking this delivery
  status: string;
  estimatedDeliveryTime?: string;
}

const activeDeliveries = new Map<string, DeliveryTracking>();

export function setupWebSocket(server: http.Server) {
  const io = new Server(server, {
    cors: {
      origin: ["http://localhost:8081", "http://localhost:8082"], // Your customer app URLs
      methods: ["GET", "POST"],
      credentials: true
    }
  });

  console.log('🔌 WebSocket server initialized');

  io.on('connection', (socket) => {
    console.log(`🟢 Client connected: ${socket.id}`);

    // Delivery partner sends location updates
    socket.on('location-update', (data) => {
      const { deliveryId, lat, lng, timestamp } = data;
      
      console.log(`📍 Location update for delivery ${deliveryId}: (${lat}, ${lng})`);

      // Store the latest location
      let delivery = activeDeliveries.get(deliveryId);
      if (!delivery) {
        delivery = {
          deliveryId,
          subscribers: new Set(),
          status: 'ASSIGNED',
        };
        activeDeliveries.set(deliveryId, delivery);
      }

      delivery.partnerLocation = { lat, lng, timestamp: new Date(timestamp) };

      // Broadcast to all customers tracking this delivery
      io.to(`delivery-${deliveryId}`).emit('partner-location', {
        lat,
        lng,
        timestamp
      });
    });

    // Delivery partner updates status
    socket.on('delivery-status', (data) => {
      const { deliveryId, status, estimatedDeliveryTime } = data;
      
      console.log(`📦 Status update for delivery ${deliveryId}: ${status}`);

      let delivery = activeDeliveries.get(deliveryId);
      if (!delivery) {
        delivery = {
          deliveryId,
          subscribers: new Set(),
          status,
          estimatedDeliveryTime
        };
        activeDeliveries.set(deliveryId, delivery);
      } else {
        delivery.status = status;
        delivery.estimatedDeliveryTime = estimatedDeliveryTime || delivery.estimatedDeliveryTime;
      }

      // Broadcast to all customers tracking this delivery
      io.to(`delivery-${deliveryId}`).emit('delivery-status', {
        status,
        estimatedDeliveryTime: delivery.estimatedDeliveryTime
      });
    });

    // Customer subscribes to delivery tracking
    socket.on('track-delivery', (deliveryId) => {
      console.log(`👤 Customer ${socket.id} tracking delivery ${deliveryId}`);
      
      socket.join(`delivery-${deliveryId}`);

      let delivery = activeDeliveries.get(deliveryId);
      if (!delivery) {
        delivery = {
          deliveryId,
          subscribers: new Set(),
          status: 'ASSIGNED',
        };
        activeDeliveries.set(deliveryId, delivery);
      }
      
      delivery.subscribers.add(socket.id);

      // Send current status and location if available
      if (delivery.status) {
        socket.emit('delivery-status', {
          status: delivery.status,
          estimatedDeliveryTime: delivery.estimatedDeliveryTime
        });
      }

      if (delivery.partnerLocation) {
        socket.emit('partner-location', delivery.partnerLocation);
      }
    });

    // Customer stops tracking
    socket.on('stop-tracking', (deliveryId) => {
      console.log(`👤 Customer ${socket.id} stopped tracking delivery ${deliveryId}`);
      
      socket.leave(`delivery-${deliveryId}`);
      
      const delivery = activeDeliveries.get(deliveryId);
      if (delivery) {
        delivery.subscribers.delete(socket.id);
        if (delivery.subscribers.size === 0) {
          // Clean up after 1 hour of inactivity
          setTimeout(() => {
            if (delivery.subscribers.size === 0) {
              activeDeliveries.delete(deliveryId);
              console.log(`🧹 Cleaned up inactive delivery: ${deliveryId}`);
            }
          }, 60 * 60 * 1000);
        }
      }
    });

    // Handle disconnection
    socket.on('disconnect', () => {
      console.log(`🔴 Client disconnected: ${socket.id}`);
      
      // Remove from all delivery subscribers
      activeDeliveries.forEach((delivery, deliveryId) => {
        if (delivery.subscribers.has(socket.id)) {
          delivery.subscribers.delete(socket.id);
        }
      });
    });
  });

  return io;
}

// Utility function to get delivery status (for REST API)
export function getDeliveryStatus(deliveryId: string) {
  return activeDeliveries.get(deliveryId);
}