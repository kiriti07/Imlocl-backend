// server.ts
import "dotenv/config";
import express from "express";
import cors from "cors";
import { PrismaClient, PartnerRole, PartnerStatus } from "@prisma/client";
import { uploadMultipleToAzure } from "./utils/azure-storage-helper";
import { ensureContainerExists } from "./config/azure-storage";

import { uploadMeatItemImage, uploadMultipleMeatItemImages } from "./utils/azure-storage-helper-meat";
import { Server } from 'socket.io';
import crypto from "crypto";
import multer from "multer";
import http from 'http';
import { setupWebSocket } from './websocket';
import path from "path";
import fs from "fs";

const app = express();
const prisma = new PrismaClient();

app.use(cors());
app.use(express.json());

const PORT = Number(process.env.PORT || 8080);

// After your app initialization, create HTTP server
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "http://localhost:8081" }
});

// Track active deliveries
const activeDeliveries = new Map();


// ----------------------
// ✅ LOCAL IMAGE STORAGE (outside repo) + STATIC SERVE
// ----------------------

// Saves images to: /Users/<you>/Desktop/imlocl-uploads
// ✅ This folder is NOT inside your Git repo, so nothing gets pushed to GitHub.
const UPLOAD_DIR = path.join(process.env.HOME || "", "Desktop", "imlocl-uploads");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Serve images publicly: http://localhost:8080/uploads/<filename>
app.use("/uploads", express.static(UPLOAD_DIR));

// Multer setup
const storage = multer.memoryStorage(); // Store in memory instead of disk

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

ensureContainerExists().catch(console.error);


io.on('connection', (socket) => {
  console.log('Delivery partner connected:', socket.id);
  
  // Partner sends location updates
  socket.on('location-update', (data) => {
    const { deliveryId, lat, lng, timestamp } = data;
    
    // Store in database (batch writes recommended) [citation:3]
    // cacheLocation(deliveryId, { lat, lng, timestamp });
    
    // Broadcast to customer watching this delivery
    io.to(`delivery-${deliveryId}`).emit('partner-location', {
      lat, lng, timestamp
    });
  });
  
  // Customer subscribes to delivery tracking
  socket.on('track-delivery', (deliveryId) => {
    socket.join(`delivery-${deliveryId}`);
  });
});

// ----------------------
// helpers
// ----------------------
function s(v: any) {
  return String(v ?? "").trim();
}
function asFloat(v: any): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function genToken() {
  return crypto.randomUUID();
}

function roleFromPartnerType(partnerType: string): PartnerRole {
  const pt = partnerType.toLowerCase();

  if (["laundry", "laundry_partner", "laundry_shop"].includes(pt)) return PartnerRole.LAUNDRY_PARTNER;
  if (["meat_store", "meat", "meatshop", "meat_shop", "butcher"].includes(pt)) return PartnerRole.MEAT_PARTNER;
  if (["tailor", "stitching", "designer"].includes(pt)) return PartnerRole.TAILOR;
  if (["cook", "cooking", "chef"].includes(pt)) return PartnerRole.COOK;
  if (["delivery", "delivery_partner", "driver"].includes(pt)) return PartnerRole.DELIVERY;

  // safe fallback
  return PartnerRole.TAILOR;
}

function parseBearerToken(req: express.Request) {
  const auth = String(req.headers.authorization ?? "");
  return auth.startsWith("Bearer ") ? auth.substring(7).trim() : "";
}

async function authRequired(req: express.Request) {
  const token = parseBearerToken(req);
  if (!token) return { ok: false as const, status: 401, message: "Missing token" };

  const partner = await prisma.partner.findFirst({ where: { token } });
  if (!partner) return { ok: false as const, status: 401, message: "Invalid token" };

  return { ok: true as const, partner };
}

async function requireMeatPartnerApproved(req: express.Request) {
  const auth = await authRequired(req);
  if (!auth.ok) return auth;

  const partner = auth.partner;

  if (partner.role !== PartnerRole.MEAT_PARTNER) {
    return { ok: false as const, status: 403, message: "Only Meat Partner can access this." };
  }
  if (partner.status !== PartnerStatus.APPROVED) {
    return { ok: false as const, status: 403, message: "Account under review. Not approved yet." };
  }

  return { ok: true as const, partner };
}

async function ensureMeatShop(partnerId: string) {
  // If MeatShop doesn't exist, create it using Partner.businessName as default shopName
  const partner = await prisma.partner.findUnique({ where: { id: partnerId } });
  const shopName = partner?.businessName || partner?.fullName || "Meat Shop";

  return prisma.meatShop.upsert({
    where: { partnerId },
    update: {},
    create: {
      partnerId,
      shopName,
      address: partner?.address ?? null,
      city: partner?.city ?? null,
      isOpen: true,
    },
    include: { items: true },
  });
}

// ----------------------
// routes
// ----------------------
app.get("/api/health", (_req, res) => res.json({ ok: true }));

// ✅ PUBLIC: list all approved + open meat shops (for customer app)
app.get("/api/public/meatshops", async (_req, res) => {
  try {
    const shops = await prisma.meatShop.findMany({
      where: {
        isOpen: true,
        partner: {
          role: PartnerRole.MEAT_PARTNER,
          status: PartnerStatus.APPROVED,
          isActive: true,
        },
      },
      include: {
        items: {
          where: { inStock: true },
          orderBy: { createdAt: "desc" },
        },
        partner: true,
      },
      orderBy: { updatedAt: "desc" },
    });

    // return a clean object (avoid leaking token)
    const result = shops.map((s: any) => ({
      id: s.id,
      shopName: s.shopName,
      address: s.address,
      city: s.city,
      lat: s.lat,
      lng: s.lng,
      isOpen: s.isOpen,
      openTime: s.openTime,
      closeTime: s.closeTime,
      partner: {
        id: s.partner?.id,
        fullName: s.partner?.fullName,
        phone: s.partner?.phone,
        businessName: s.partner?.businessName,
      },
      items: (s.items ?? []).map((it: any) => ({
        id: it.id,
        name: it.name,
        unit: it.unit,
        price: it.price,
        minQty: it.minQty,
        stepQty: it.stepQty,
        inStock: it.inStock,
        imageUrl: it.imageUrl ?? null, // ✅ include imageUrl for customer
      })),
    }));

    return res.json({ shops: result });
  } catch (e: any) {
    console.error("PUBLIC MEATSHOPS ERROR:", e);
    return res.status(500).json({ message: e?.message ?? "Server error" });
  }
});

// ✅ Assign delivery partner to order (after store accepts)
app.post("/api/orders/:orderId/assign-delivery", async (req, res) => {
  try {
    const { orderId } = req.params;
    
    // Find nearest available delivery partner
    const availablePartners = await prisma.deliveryPartner.findMany({
      where: {
        isActive: true,
        isAvailable: true,
        currentOrders: { lt: 3 }, // Max 3 concurrent orders
      },
    });

    // Calculate ETA and find best match
    // Consider: distance, current load, historical performance
    
    const assignedPartner = await findOptimalPartner(availablePartners, orderId);
    
    // Create delivery record
    const delivery = await prisma.delivery.create({
      data: {
        orderId,
        partnerId: assignedPartner.id,
        status: 'ASSIGNED',
        estimatedPickupTime: calculatePickupTime(),
        estimatedDeliveryTime: calculateDeliveryTime(),
      },
    });

    // Notify partner via push notification
    await notifyPartner(assignedPartner.id, delivery);
    
    return res.json({ delivery });
  } catch (e: any) {
    console.error("ASSIGN DELIVERY ERROR:", e);
    return res.status(500).json({ message: e?.message ?? "Server error" });
  }
});

// ✅ PUBLIC: get one meat shop by id (for /meat-store/[id] page)
app.get("/api/public/meatshops/:id", async (req, res) => {
  try {
    const id = s(req.params.id);
    if (!id) return res.status(400).json({ message: "id is required" });

    const shop = await prisma.meatShop.findFirst({
      where: {
        id,
        partner: {
          role: PartnerRole.MEAT_PARTNER,
          status: PartnerStatus.APPROVED,
          isActive: true,
        },
      },
      include: {
        items: { orderBy: { createdAt: "desc" } },
        partner: true,
      },
    });

    if (!shop) return res.status(404).json({ message: "Meat shop not found" });

    const result: any = {
      id: shop.id,
      shopName: shop.shopName,
      address: shop.address,
      city: shop.city,
      lat: shop.lat,
      lng: shop.lng,
      isOpen: shop.isOpen,
      openTime: (shop as any).openTime ?? null,
      closeTime: (shop as any).closeTime ?? null,
      partner: {
        id: (shop as any).partner?.id,
        fullName: (shop as any).partner?.fullName,
        businessName: (shop as any).partner?.businessName,
      },
      items: (shop as any).items?.map((it: any) => ({
        id: it.id,
        name: it.name,
        unit: it.unit,
        price: it.price,
        minQty: it.minQty,
        stepQty: it.stepQty,
        inStock: it.inStock,
        imageUrl: it.imageUrl ?? null, // ✅ include imageUrl
      })),
    };

    return res.json({ shop: result });
  } catch (e: any) {
    console.error("PUBLIC MEATSHOP BY ID ERROR:", e);
    return res.status(500).json({ message: e?.message ?? "Server error" });
  }
});

// ✅ REGISTER
app.post("/api/partners/register", async (req, res) => {
  try {
    const partnerType = s(req.body.partnerType);
    const fullName = s(req.body.fullName);
    const phone = s(req.body.phone);

    const email = req.body.email ? s(req.body.email) : null;
    const businessName = req.body.businessName ? s(req.body.businessName) : null;
    const address = req.body.address ? s(req.body.address) : null;
    const city = req.body.city ? s(req.body.city) : null;
    const experience = s(req.body.experience) || null;

    if (!partnerType || !fullName || !phone) {
      return res.status(400).json({ message: "partnerType, fullName, phone are required" });
    }

    const existing = await prisma.partner.findFirst({ where: { phone } });
    if (existing) {
      return res.status(409).json({ message: "Phone already registered. Please login." });
    }

    const role = roleFromPartnerType(partnerType);

    const created = await prisma.partner.create({
      data: {
        phone,
        partnerType,
        fullName,
        role,
        status: PartnerStatus.PENDING,
        email,
        businessName,
        address,
        city,
        experience,
      },
    });

    return res.json({ partner: created });
  } catch (e: any) {
    console.error("REGISTER ERROR:", e);
    return res.status(500).json({ message: e?.message ?? "Server error" });
  }
});

// ✅ LOGIN
app.post("/api/auth/login", async (req, res) => {
  try {
    const phone = s(req.body.phone);
    if (!phone) return res.status(400).json({ message: "phone is required" });

    const partner = await prisma.partner.findFirst({ where: { phone } });
    if (!partner) return res.status(404).json({ message: "Partner not found. Please register." });

    const token = genToken();

    const updated = await prisma.partner.update({
      where: { id: partner.id },
      data: { token },
    });

    return res.json({ token, partner: updated });
  } catch (e: any) {
    console.error("LOGIN ERROR:", e);
    return res.status(500).json({ message: e?.message ?? "Server error" });
  }
});

// ✅ ME (refresh status)
app.get("/api/auth/me", async (req, res) => {
  try {
    const auth = await authRequired(req);
    if (!auth.ok) return res.status(auth.status).json({ message: auth.message });

    return res.json({ partner: auth.partner });
  } catch (e: any) {
    console.error("ME ERROR:", e);
    return res.status(500).json({ message: e?.message ?? "Server error" });
  }
});

// ----------------------
// MEAT SHOP APIs (MEAT_PARTNER + APPROVED only)
// ----------------------

// ✅ Get my meat shop + items
app.get("/api/meatshop/me", async (req, res) => {
  try {
    const gate = await requireMeatPartnerApproved(req);
    if (!gate.ok) return res.status(gate.status).json({ message: gate.message });

    const shop = await ensureMeatShop(gate.partner.id);
    return res.json({ shop });
  } catch (e: any) {
    console.error("MEATSHOP/ME ERROR:", e);
    return res.status(500).json({ message: e?.message ?? "Server error" });
  }
});

// ✅ Save location pin (lat/lng + address/city)
app.post("/api/meatshop/location", async (req, res) => {
  try {
    const gate = await requireMeatPartnerApproved(req);
    if (!gate.ok) return res.status(gate.status).json({ message: gate.message });

    const lat = asFloat(req.body.lat);
    const lng = asFloat(req.body.lng);

    if (lat === null || lng === null) {
      return res.status(400).json({ message: "lat and lng are required numbers" });
    }

    const address = req.body.address ? s(req.body.address) : null;
    const city = req.body.city ? s(req.body.city) : null;

    const shop = await prisma.meatShop.upsert({
      where: { partnerId: gate.partner.id },
      update: { lat, lng, address, city },
      create: {
        partnerId: gate.partner.id,
        shopName: gate.partner.businessName || gate.partner.fullName || "Meat Shop",
        lat,
        lng,
        address,
        city,
      },
    });

    return res.json({ shop });
  } catch (e: any) {
    console.error("MEATSHOP/LOCATION ERROR:", e);
    return res.status(500).json({ message: e?.message ?? "Server error" });
  }
});

// ✅ Save timings (openTime/closeTime)
app.post("/api/meatshop/timings", async (req, res) => {
  try {
    const gate = await requireMeatPartnerApproved(req);
    if (!gate.ok) return res.status(gate.status).json({ message: gate.message });

    const openTime = req.body.openTime ? s(req.body.openTime) : null;
    const closeTime = req.body.closeTime ? s(req.body.closeTime) : null;

    const shop = await prisma.meatShop.upsert({
      where: { partnerId: gate.partner.id },
      update: { openTime, closeTime },
      create: {
        partnerId: gate.partner.id,
        shopName: gate.partner.businessName || gate.partner.fullName || "Meat Shop",
        openTime,
        closeTime,
      },
    });

    return res.json({ shop });
  } catch (e: any) {
    console.error("MEATSHOP/TIMINGS ERROR:", e);
    return res.status(500).json({ message: e?.message ?? "Server error" });
  }
});

// ✅ Toggle store open/close
app.post("/api/meatshop/toggle", async (req, res) => {
  try {
    const gate = await requireMeatPartnerApproved(req);
    if (!gate.ok) return res.status(gate.status).json({ message: gate.message });

    const isOpen = Boolean(req.body.isOpen);

    const shop = await prisma.meatShop.upsert({
      where: { partnerId: gate.partner.id },
      update: { isOpen },
      create: {
        partnerId: gate.partner.id,
        shopName: gate.partner.businessName || gate.partner.fullName || "Meat Shop",
        isOpen,
      },
    });

    return res.json({ shop });
  } catch (e: any) {
    console.error("MEATSHOP/TOGGLE ERROR:", e);
    return res.status(500).json({ message: e?.message ?? "Server error" });
  }
});

// ✅ Add item
// ✅ Add item with Azure Blob Storage support
app.post("/api/meatshop/items", upload.single("image"), async (req, res) => {
  try {
    const gate = await requireMeatPartnerApproved(req);
    if (!gate.ok) return res.status(gate.status).json({ message: gate.message });

    const shop = await ensureMeatShop(gate.partner.id);

    const name = s(req.body.name);
    const unit = s(req.body.unit);
    const price = asFloat(req.body.price);
    const minQty = asFloat(req.body.minQty);
    const stepQty = asFloat(req.body.stepQty);

    if (!name || !unit || price === null) {
      return res.status(400).json({ message: "name, unit, price are required" });
    }

    // Create the item first
    const item = await prisma.meatItem.create({
      data: {
        meatShopId: shop.id,
        name,
        unit,
        price,
        minQty,
        stepQty,
        inStock: true,
        imageUrl: null, // Will update if image uploaded
      },
    });

    // If image was uploaded, save to Azure Blob Storage
    let imageUrl = null;
    if (req.file) {
      try {
        const shopName = shop.shopName;
        const uploadResult = await uploadMeatItemImage(
          req.file.buffer,
          shopName,
          name,
          req.file.originalname
        );
        imageUrl = uploadResult.url;

        // Update the item with the image URL
        const updatedItem = await prisma.meatItem.update({
          where: { id: item.id },
          data: { imageUrl },
        });

        return res.json({ item: updatedItem, imageUrl });
      } catch (uploadError) {
        console.error("Image upload to Azure failed:", uploadError);
        // Still return the item even if image upload fails
        return res.json({ 
          item, 
          warning: "Item created but image upload failed",
          imageUrl: null 
        });
      }
    }

    return res.json({ item });
  } catch (e: any) {
    console.error("MEATSHOP/ITEMS CREATE ERROR:", e);
    return res.status(500).json({ message: e?.message ?? "Server error" });
  }
});

// ✅ Update item
app.put("/api/meatshop/items/:id", async (req, res) => {
  try {
    const gate = await requireMeatPartnerApproved(req);
    if (!gate.ok) return res.status(gate.status).json({ message: gate.message });

    const shop = await ensureMeatShop(gate.partner.id);
    const id = s(req.params.id);

    // Ensure item belongs to this partner
    const existing = await prisma.meatItem.findFirst({
      where: { id, meatShopId: shop.id },
    });
    if (!existing) return res.status(404).json({ message: "Item not found" });

    const data: any = {};
    if (req.body.name !== undefined) data.name = s(req.body.name);
    if (req.body.unit !== undefined) data.unit = s(req.body.unit);
    if (req.body.price !== undefined) data.price = Number(req.body.price);
    if (req.body.minQty !== undefined) data.minQty = asFloat(req.body.minQty);
    if (req.body.stepQty !== undefined) data.stepQty = asFloat(req.body.stepQty);
    if (req.body.inStock !== undefined) data.inStock = Boolean(req.body.inStock);

    const item = await prisma.meatItem.update({
      where: { id },
      data,
    });

    return res.json({ item });
  } catch (e: any) {
    console.error("MEATSHOP/ITEMS UPDATE ERROR:", e);
    return res.status(500).json({ message: e?.message ?? "Server error" });
  }
});

// ✅ Delete item (soft delete -> inStock=false)
app.delete("/api/meatshop/items/:id", async (req, res) => {
  try {
    const gate = await requireMeatPartnerApproved(req);
    if (!gate.ok) return res.status(gate.status).json({ message: gate.message });

    const shop = await ensureMeatShop(gate.partner.id);
    const id = s(req.params.id);

    const existing = await prisma.meatItem.findFirst({
      where: { id, meatShopId: shop.id },
    });
    if (!existing) return res.status(404).json({ message: "Item not found" });

    await prisma.meatItem.update({
      where: { id },
      data: { inStock: false },
    });

    return res.json({ ok: true });
  } catch (e: any) {
    console.error("MEATSHOP/ITEMS DELETE ERROR:", e);
    return res.status(500).json({ message: e?.message ?? "Server error" });
  }
});


// ============================================
// DELIVERY MANAGEMENT ENDPOINTS
// ============================================

// ✅ Create a new delivery (after order is confirmed)
app.post("/api/deliveries", async (req, res) => {
  try {
    const gate = await requireMeatPartnerApproved(req);
    if (!gate.ok) return res.status(gate.status).json({ message: gate.message });

    const {
      orderId,
      customerName,
      customerPhone,
      customerAddress,
      items,
      totalAmount,
      estimatedPickupTime,
    } = req.body;

    // Get the store details
    const shop = await ensureMeatShop(gate.partner.id);

    // Find an available delivery partner
    const availablePartner = await prisma.deliveryPartner.findFirst({
      where: {
        isAvailable: true,
        isActive: true,
        currentOrders: { lt: 3 }, // Max 3 concurrent deliveries
      },
    });

    if (!availablePartner) {
      return res.status(400).json({ 
        message: "No delivery partners available at the moment",
        delivery: null 
      });
    }

    // Calculate estimated delivery time (e.g., pickup time + 30 mins)
    const estimatedDeliveryTime = new Date(estimatedPickupTime);
    estimatedDeliveryTime.setMinutes(estimatedDeliveryTime.getMinutes() + 30);

    // Create delivery record
    const delivery = await prisma.delivery.create({
      data: {
        orderId,
        partnerId: availablePartner.id,
        customerName,
        customerPhone,
        customerAddress,
        storeId: shop.id,
        storeName: shop.shopName,
        storeAddress: shop.address,
        status: 'ASSIGNED',
        assignedAt: new Date(),
        estimatedPickupTime: new Date(estimatedPickupTime),
        estimatedDeliveryTime: estimatedDeliveryTime,
        items: JSON.stringify(items),
        totalAmount,
      },
      include: {
        partner: true,
      },
    });

    // Update partner's current orders count
    await prisma.deliveryPartner.update({
      where: { id: availablePartner.id },
      data: { currentOrders: { increment: 1 } },
    });

    // Notify via WebSocket
    io.emit('delivery-created', {
      deliveryId: delivery.id,
      status: delivery.status,
      partner: {
        name: delivery.partner.fullName,
        phone: delivery.partner.phone,
      },
    });

    return res.json({ delivery });
  } catch (e: any) {
    console.error("CREATE DELIVERY ERROR:", e);
    return res.status(500).json({ message: e?.message ?? "Server error" });
  }
});

// ✅ Update delivery status (called by delivery partner)
app.put("/api/deliveries/:id/status", async (req, res) => {
  try {
    const gate = await requireMeatPartnerApproved(req);
    if (!gate.ok) return res.status(gate.status).json({ message: gate.message });

    const { id } = req.params;
    const { status, lat, lng } = req.body;

    const updateData: any = {
      status,
    };

    // Update timestamps based on status
    if (status === 'ARRIVED_AT_STORE') {
      // No timestamp needed
    } else if (status === 'PICKED_UP') {
      updateData.pickedUpAt = new Date();
    } else if (status === 'DELIVERED') {
      updateData.deliveredAt = new Date();
      
      // Update partner's current orders count
      const delivery = await prisma.delivery.findUnique({
        where: { id },
      });
      
      if (delivery) {
        await prisma.deliveryPartner.update({
          where: { id: delivery.partnerId },
          data: { 
            currentOrders: { decrement: 1 },
            totalDeliveries: { increment: 1 },
          },
        });
      }
    }

    // Update location if provided
    if (lat && lng) {
      updateData.currentLat = lat;
      updateData.currentLng = lng;
      updateData.lastLocationUpdate = new Date();
    }

    const delivery = await prisma.delivery.update({
      where: { id },
      data: updateData,
    });

    // Broadcast via WebSocket
    io.to(`delivery-${id}`).emit('delivery-status', {
      status: delivery.status,
      estimatedDeliveryTime: delivery.estimatedDeliveryTime,
    });

    if (lat && lng) {
      io.to(`delivery-${id}`).emit('partner-location', {
        lat,
        lng,
        timestamp: new Date(),
      });
    }

    return res.json({ delivery });
  } catch (e: any) {
    console.error("UPDATE DELIVERY STATUS ERROR:", e);
    return res.status(500).json({ message: e?.message ?? "Server error" });
  }
});

// ✅ Get delivery details (for customer tracking)
app.get("/api/deliveries/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const delivery = await prisma.delivery.findUnique({
      where: { id },
      include: {
        partner: {
          select: {
            fullName: true,
            phone: true,
            vehicleType: true,
            vehicleNumber: true,
            rating: true,
          },
        },
      },
    });

    if (!delivery) {
      return res.status(404).json({ message: "Delivery not found" });
    }

    // Get real-time location from WebSocket store if available
    const wsStatus = getDeliveryStatus(id);

    return res.json({
      delivery,
      realtime: wsStatus || null,
    });
  } catch (e: any) {
    console.error("GET DELIVERY ERROR:", e);
    return res.status(500).json({ message: e?.message ?? "Server error" });
  }
});

// ✅ Get active deliveries for a partner
app.get("/api/deliveries/partner/:partnerId", async (req, res) => {
  try {
    const { partnerId } = req.params;

    const deliveries = await prisma.delivery.findMany({
      where: {
        partnerId,
        status: {
          notIn: ['DELIVERED', 'FAILED', 'CANCELLED'],
        },
      },
      orderBy: { assignedAt: 'desc' },
    });

    return res.json({ deliveries });
  } catch (e: any) {
    console.error("GET PARTNER DELIVERIES ERROR:", e);
    return res.status(500).json({ message: e?.message ?? "Server error" });
  }
});

// ✅ Register a delivery partner
app.post("/api/delivery-partners/register", async (req, res) => {
  try {
    const {
      fullName,
      phone,
      email,
      vehicleType,
      vehicleNumber,
    } = req.body;

    // Check if partner already exists
    const existing = await prisma.deliveryPartner.findFirst({
      where: {
        OR: [
          { phone },
          { email },
        ],
      },
    });

    if (existing) {
      return res.status(409).json({ message: "Partner already registered" });
    }

    const partner = await prisma.deliveryPartner.create({
      data: {
        fullName,
        phone,
        email,
        vehicleType,
        vehicleNumber,
        isActive: true,
        isAvailable: true,
      },
    });

    return res.json({ partner });
  } catch (e: any) {
    console.error("REGISTER DELIVERY PARTNER ERROR:", e);
    return res.status(500).json({ message: e?.message ?? "Server error" });
  }
});

// ✅ Update partner availability
app.put("/api/delivery-partners/:id/availability", async (req, res) => {
  try {
    const { id } = req.params;
    const { isAvailable } = req.body;

    const partner = await prisma.deliveryPartner.update({
      where: { id },
      data: { isAvailable },
    });

    return res.json({ partner });
  } catch (e: any) {
    console.error("UPDATE PARTNER AVAILABILITY ERROR:", e);
    return res.status(500).json({ message: e?.message ?? "Server error" });
  }
});
// ----------------------
// ✅ ITEM IMAGE UPLOAD (MEAT_PARTNER + APPROVED only)
// ----------------------
// Upload image for an item you own
// FormData field name must be: "image"
// ✅ Upload image for an existing meat item to Azure Blob Storage
app.post("/api/meatshop/items/:id/image", upload.single("image"), async (req, res) => {
  try {
    const gate = await requireMeatPartnerApproved(req);
    if (!gate.ok) return res.status(gate.status).json({ message: gate.message });

    const shop = await ensureMeatShop(gate.partner.id);
    const id = s(req.params.id);

    const existing = await prisma.meatItem.findFirst({
      where: { id, meatShopId: shop.id },
    });

    if (!existing) {
      return res.status(404).json({ message: "Item not found" });
    }

    if (!req.file) {
      return res.status(400).json({ message: "Missing file field 'image'" });
    }

    // Upload to Azure Blob Storage
    const shopName = shop.shopName;
    const uploadResult = await uploadMeatItemImage(
      req.file.buffer,
      shopName,
      existing.name,
      req.file.originalname
    );

    // Update the item with the Azure URL
    const updated = await prisma.meatItem.update({
      where: { id },
      data: { imageUrl: uploadResult.url },
    });

    console.log(`✅ Meat item image uploaded to Azure: ${uploadResult.url}`);
    return res.json({ item: updated, imageUrl: uploadResult.url });
  } catch (e: any) {
    console.error("MEATSHOP/ITEM IMAGE UPLOAD ERROR:", e);
    return res.status(500).json({ message: e?.message ?? "Server error" });
  }
});


// ✅ Upload multiple images for a meat item
app.post("/api/meatshop/items/:id/images", upload.array("images", 5), async (req, res) => {
  try {
    const gate = await requireMeatPartnerApproved(req);
    if (!gate.ok) return res.status(gate.status).json({ message: gate.message });

    const shop = await ensureMeatShop(gate.partner.id);
    const id = s(req.params.id);
    const files = req.files as Express.Multer.File[];

    const existing = await prisma.meatItem.findFirst({
      where: { id, meatShopId: shop.id },
    });

    if (!existing) {
      return res.status(404).json({ message: "Item not found" });
    }

    if (!files || files.length === 0) {
      return res.status(400).json({ message: "No images uploaded" });
    }

    if (files.length > 5) {
      return res.status(400).json({ message: "Maximum 5 images allowed" });
    }

    // Upload all images to Azure
    const uploadResults = await uploadMultipleMeatItemImages(
      files,
      shop.shopName,
      existing.name
    );

    const imageUrls = uploadResults.map(result => result.url);

    // For now, store just the first image (or you could modify schema to support multiple)
    const updated = await prisma.meatItem.update({
      where: { id },
      data: { imageUrl: imageUrls[0] }, // Store first image
    });

    return res.json({ 
      item: updated, 
      imageUrls,
      message: `${imageUrls.length} images uploaded successfully` 
    });
  } catch (e: any) {
    console.error("MEATSHOP/MULTI-IMAGE UPLOAD ERROR:", e);
    return res.status(500).json({ message: e?.message ?? "Server error" });
  }
});

// Optional: remove image (set imageUrl null) (still keeps file on disk)
app.delete("/api/meatshop/items/:id/image", async (req, res) => {
  try {
    const gate = await requireMeatPartnerApproved(req);
    if (!gate.ok) return res.status(gate.status).json({ message: gate.message });

    const shop = await ensureMeatShop(gate.partner.id);
    const id = s(req.params.id);

    const existing = await prisma.meatItem.findFirst({
      where: { id, meatShopId: shop.id },
    });
    if (!existing) return res.status(404).json({ message: "Item not found" });

    const updated = await prisma.meatItem.update({
      where: { id },
      data: { imageUrl: null },
    });

    return res.json({ item: updated });
  } catch (e: any) {
    console.error("MEATSHOP/ITEM IMAGE DELETE ERROR:", e);
    return res.status(500).json({ message: e?.message ?? "Server error" });
  }
});

// ----------------------
// start
// ----------------------
async function main() {
  await prisma.$connect();
  
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`✅ API running on http://localhost:${PORT}`);
    console.log(`🔌 WebSocket server running on ws://localhost:${PORT}`);
    console.log(`🖼️ Uploads served at http://localhost:${PORT}/uploads/<file>`);
    console.log(`📁 Upload folder: ${UPLOAD_DIR}`);
  });
}

main().catch((err) => {
  console.error("❌ Failed to start server:", err);
  process.exit(1);
});

// Add after your existing routes, before the server start

// ============================================
// DESIGNER/TAILOR PUBLIC ENDPOINTS
// ============================================

// ✅ PUBLIC: Get all approved designers/tailors
app.get("/api/public/designers", async (_req, res) => {
  try {
    const designers = await prisma.partner.findMany({
      where: {
        role: { in: [PartnerRole.TAILOR] },
        status: PartnerStatus.APPROVED,
        isActive: true,
      },
      include: {
        designerProfile: {
          include: {
            portfolio: {
              where: { status: "published" },
              orderBy: { createdAt: "desc" },
              take: 4, // Latest 4 designs as preview
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    // Transform to match frontend expected format
    const result = designers.map((designer: any) => ({
      id: designer.id,
      name: designer.fullName,
      avatar: designer.designerProfile?.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(designer.fullName)}&background=random`,
      coverImage: designer.designerProfile?.coverImage || "https://images.unsplash.com/photo-1558618666-fcd25c85f82e?w=800&h=400&fit=crop",
      bio: designer.designerProfile?.bio || `${designer.fullName} is a talented fashion designer.`,
      speciality: designer.designerProfile?.specialties?.[0] || "Fashion Design",
      location: designer.city || "Location not specified",
      rating: 4.8, // You'll need to implement a review system
      reviewCount: 0,
      designCount: designer.designerProfile?._count?.portfolio || 0,
      experience: designer.experience || "Experienced",
      verified: true,
      tags: designer.designerProfile?.specialties || ["Fashion"],
    }));

    return res.json({ designers: result });
  } catch (e: any) {
    console.error("PUBLIC DESIGNERS ERROR:", e);
    return res.status(500).json({ message: e?.message ?? "Server error" });
  }
});


// ✅ PUBLIC: Get single designer by ID with full portfolio
app.get("/api/public/designers/:id", async (req, res) => {
  try {
    const id = s(req.params.id);
    if (!id) return res.status(400).json({ message: "id is required" });

    const designer = await prisma.partner.findFirst({
      where: {
        id,
        role: { in: [PartnerRole.TAILOR] },
        status: PartnerStatus.APPROVED,
        isActive: true,
      },
      include: {
        designerProfile: {
          include: {
            categories: {
              include: {
                subcategories: {
                  include: {
                    items: {
                      where: { isActive: true },
                      include: { sizes: true },
                    },
                  },
                  orderBy: { displayOrder: 'asc' },
                },
              },
              orderBy: { displayOrder: 'asc' },
            },
          },
        },
      },
    });

    if (!designer) {
      return res.status(404).json({ message: "Designer not found" });
    }

    // Transform categories data
    const categories = designer.designerProfile?.categories?.map((cat: any) => ({
      id: cat.id,
      name: cat.name,
      isDefault: cat.isDefault,
      subcategories: cat.subcategories?.map((sub: any) => ({
        id: sub.id,
        name: sub.name,
        items: sub.items?.map((item: any) => ({
          id: item.id,
          title: item.name,
          description: item.description || '',
          images: item.images,
          price: item.price,
          discountPrice: item.discountPrice,
          currency: item.currency,
          availability: item.availability,
          deliveryTime: item.deliveryTime || item.customizationTime,
          sizes: item.sizes?.map((s: any) => s.size) || [],
          views: item.views,
          createdAt: item.createdAt,
        })) || [],
      })) || [],
    })) || [];

    const result = {
      id: designer.id,
      name: designer.businessName || designer.fullName,
      avatar: designer.designerProfile?.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(designer.fullName)}&background=random`,
      coverImage: designer.designerProfile?.coverImage || "https://images.unsplash.com/photo-1558618666-fcd25c85f82e?w=800&h=400&fit=crop",
      bio: designer.designerProfile?.bio || `${designer.fullName} is a talented fashion designer.`,
      speciality: designer.designerProfile?.specialties?.[0] || "Fashion Design",
      location: designer.city || "Location not specified",
      rating: 4.8,
      reviewCount: 0,
      designCount: designer.designerProfile?.portfolio?.length || 0,
      experience: designer.experience || "Experienced",
      verified: true,
      tags: designer.designerProfile?.specialties || ["Fashion"],
      categories: categories, // This is the key addition
    };

    return res.json({ designer: result });
  } catch (e: any) {
    console.error("PUBLIC DESIGNER BY ID ERROR:", e);
    return res.status(500).json({ message: e?.message ?? "Server error" });
  }
});

// ✅ PUBLIC: Get all published designs
// Replace this section in your server.ts

// ✅ PUBLIC: Get all published designs (from DesignerItem)
app.get("/api/public/designs", async (req, res) => {
  try {
    const category = req.query.category as string || 'all';
    const limit = Number(req.query.limit) || 50;
    const offset = Number(req.query.offset) || 0;

    // Build where clause
    const where: any = {
      isActive: true,
      // Only show items that have images
      images: { isEmpty: false },
    };

    // Filter by category if needed
    if (category !== 'all') {
      where.subcategory = {
        category: {
          name: {
            equals: category,
            mode: 'insensitive'
          }
        }
      };
    }

    // Get items from DesignerItem table
    const items = await prisma.designerItem.findMany({
      where,
      include: {
        subcategory: {
          include: {
            category: {
              include: {
                designer: {
                  include: {
                    partner: true
                  }
                }
              }
            }
          }
        },
        sizes: true,
      },
      orderBy: [
        { createdAt: 'desc' },
      ],
      take: limit,
      skip: offset,
    });

    // Count trending items (you can define your own logic)
    const trendingCount = await prisma.designerItem.count({
      where: {
        ...where,
        views: { gt: 100 } // Example: items with more than 100 views are trending
      },
    });

    // Count new items (created in last 7 days)
    const newCount = await prisma.designerItem.count({
      where: {
        ...where,
        createdAt: {
          gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
        }
      },
    });

    // Transform to match frontend expected format
    const result = items.map((item: any) => ({
      id: item.id,
      title: item.name,
      description: item.description || '',
      images: item.images,
      price: item.price,
      discountPrice: item.discountPrice,
      currency: item.currency,
      category: item.subcategory.category.name.toLowerCase(),
      subcategory: item.subcategory.name,
      tags: [], // You can add tags logic here if needed
      designerId: item.subcategory.category.designer.partner.id,
      designerName: item.subcategory.category.designer.partner.businessName || 
                     item.subcategory.category.designer.partner.fullName,
      designerAvatar: item.subcategory.category.designer.avatar || 
                      `https://ui-avatars.com/api/?name=${encodeURIComponent(item.subcategory.category.designer.partner.fullName)}&background=random`,
      isTrending: item.views > 100, // Custom logic for trending
      isNew: (new Date().getTime() - new Date(item.createdAt).getTime()) < 7 * 24 * 60 * 60 * 1000,
      likes: item.views, // Using views as likes for now
      views: item.views,
      inquiries: 0, // You can add inquiry tracking later
      fabricType: null,
      deliveryTime: item.deliveryTime || item.customizationTime,
      sizes: item.sizes.map((s: any) => s.size),
      availability: item.availability,
      createdAt: item.createdAt,
    }));

    return res.json({ 
      designs: result,
      meta: {
        total: items.length,
        trending: trendingCount,
        new: newCount,
      },
    });
  } catch (e: any) {
    console.error("PUBLIC DESIGNS ERROR:", e);
    return res.status(500).json({ message: e?.message ?? "Server error" });
  }
});


// ✅ PUBLIC: Get single design by ID (from DesignerItem)
app.get("/api/public/designs/:id", async (req, res) => {
  try {
    const id = s(req.params.id);
    if (!id) return res.status(400).json({ message: "id is required" });

    const item = await prisma.designerItem.findFirst({
      where: {
        id,
        isActive: true,
      },
      include: {
        subcategory: {
          include: {
            category: {
              include: {
                designer: {
                  include: {
                    partner: true
                  }
                }
              }
            }
          }
        },
        sizes: true,
      },
    });

    if (!item) {
      return res.status(404).json({ message: "Design not found" });
    }

    // Increment view count
    await prisma.designerItem.update({
      where: { id },
      data: { views: { increment: 1 } },
    });

    const result = {
      id: item.id,
      title: item.name,
      description: item.description || '',
      images: item.images,
      price: item.price,
      discountPrice: item.discountPrice,
      currency: item.currency,
      category: item.subcategory.category.name.toLowerCase(),
      subcategory: item.subcategory.name,
      tags: [],
      designerId: item.subcategory.category.designer.partner.id,
      designerName: item.subcategory.category.designer.partner.businessName || 
                     item.subcategory.category.designer.partner.fullName,
      designerAvatar: item.subcategory.category.designer.avatar || 
                      `https://ui-avatars.com/api/?name=${encodeURIComponent(item.subcategory.category.designer.partner.fullName)}&background=random`,
      isTrending: item.views > 100,
      isNew: (new Date().getTime() - new Date(item.createdAt).getTime()) < 7 * 24 * 60 * 60 * 1000,
      likes: item.views,
      views: item.views + 1,
      inquiries: 0,
      fabricType: null,
      deliveryTime: item.deliveryTime || item.customizationTime,
      sizes: item.sizes.map((s: any) => s.size),
      availability: item.availability,
      createdAt: item.createdAt,
    };

    return res.json({ design: result });
  } catch (e: any) {
    console.error("PUBLIC DESIGN BY ID ERROR:", e);
    return res.status(500).json({ message: e?.message ?? "Server error" });
  }
});

// ============================================
// DESIGNER/TAILOR PRIVATE ENDPOINTS (Partner App)
// ============================================

// ✅ Get designer profile (for partner app)
app.get("/api/designer/profile", async (req, res) => {
  try {
    const auth = await authRequired(req);
    if (!auth.ok) return res.status(auth.status).json({ message: auth.message });

    // Check if user is a designer/tailor
    if (auth.partner.role !== PartnerRole.TAILOR) {
      return res.status(403).json({ message: "Access denied. Not a designer/tailor." });
    }

    // Get or create designer profile
    let designerProfile = await prisma.designerProfile.findUnique({
      where: { partnerId: auth.partner.id },
      include: { portfolio: true },
    });

    if (!designerProfile) {
      designerProfile = await prisma.designerProfile.create({
        data: {
          partnerId: auth.partner.id,
          specialties: ["Fashion"],
        },
        include: { portfolio: true },
      });
    }

    return res.json({ profile: designerProfile });
  } catch (e: any) {
    console.error("DESIGNER PROFILE ERROR:", e);
    return res.status(500).json({ message: e?.message ?? "Server error" });
  }
});

// ✅ Update designer profile
app.post("/api/designer/profile", async (req, res) => {
  try {
    const auth = await authRequired(req);
    if (!auth.ok) return res.status(auth.status).json({ message: auth.message });

    if (auth.partner.role !== PartnerRole.TAILOR) {
      return res.status(403).json({ message: "Access denied" });
    }

    const { bio, specialties, avatar, coverImage } = req.body;

    const profile = await prisma.designerProfile.upsert({
      where: { partnerId: auth.partner.id },
      update: { bio, specialties, avatar, coverImage },
      create: {
        partnerId: auth.partner.id,
        bio,
        specialties: specialties || ["Fashion"],
        avatar,
        coverImage,
      },
    });

    return res.json({ profile });
  } catch (e: any) {
    console.error("UPDATE DESIGNER PROFILE ERROR:", e);
    return res.status(500).json({ message: e?.message ?? "Server error" });
  }
});

// ✅ Get designer's designs (for partner app)
app.get("/api/designer/designs", async (req, res) => {
  try {
    const auth = await authRequired(req);
    if (!auth.ok) return res.status(auth.status).json({ message: auth.message });

    if (auth.partner.role !== PartnerRole.TAILOR) {
      return res.status(403).json({ message: "Access denied" });
    }

    const designs = await prisma.design.findMany({
      where: {
        designer: {
          partnerId: auth.partner.id,
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return res.json({ designs });
  } catch (e: any) {
    console.error("GET DESIGNER DESIGNS ERROR:", e);
    return res.status(500).json({ message: e?.message ?? "Server error" });
  }
});

// ✅ Create new design
app.post("/api/designer/designs", async (req, res) => {
  try {
    const auth = await authRequired(req);
    if (!auth.ok) return res.status(auth.status).json({ message: auth.message });

    if (auth.partner.role !== PartnerRole.TAILOR) {
      return res.status(403).json({ message: "Access denied" });
    }

    // Get or create designer profile
    let designerProfile = await prisma.designerProfile.findUnique({
      where: { partnerId: auth.partner.id },
    });

    if (!designerProfile) {
      designerProfile = await prisma.designerProfile.create({
        data: {
          partnerId: auth.partner.id,
          specialties: ["Fashion"],
        },
      });
    }

    const design = await prisma.design.create({
      data: {
        designerId: designerProfile.id,
        title: s(req.body.title),
        description: req.body.description,
        category: s(req.body.category),
        price: Number(req.body.price),
        currency: req.body.currency || "₹",
        images: req.body.images || [],
        tags: req.body.tags || [],
        fabricType: req.body.fabricType,
        deliveryTime: req.body.deliveryTime,
        readyToWear: req.body.readyToWear || false,
        customizationOptions: req.body.customizationOptions || [],
        status: req.body.status || "draft",
      },
    });

    return res.json({ design });
  } catch (e: any) {
    console.error("CREATE DESIGN ERROR:", e);
    return res.status(500).json({ message: e?.message ?? "Server error" });
  }
});

// ✅ Update design
app.put("/api/designer/designs/:id", async (req, res) => {
  try {
    const auth = await authRequired(req);
    if (!auth.ok) return res.status(auth.status).json({ message: auth.message });

    if (auth.partner.role !== PartnerRole.TAILOR) {
      return res.status(403).json({ message: "Access denied" });
    }

    const designId = s(req.params.id);

    // Verify ownership
    const existing = await prisma.design.findFirst({
      where: {
        id: designId,
        designer: {
          partnerId: auth.partner.id,
        },
      },
    });

    if (!existing) {
      return res.status(404).json({ message: "Design not found" });
    }

    const updated = await prisma.design.update({
      where: { id: designId },
      data: {
        title: req.body.title ? s(req.body.title) : undefined,
        description: req.body.description,
        category: req.body.category ? s(req.body.category) : undefined,
        price: req.body.price ? Number(req.body.price) : undefined,
        images: req.body.images,
        tags: req.body.tags,
        fabricType: req.body.fabricType,
        deliveryTime: req.body.deliveryTime,
        readyToWear: req.body.readyToWear,
        customizationOptions: req.body.customizationOptions,
        status: req.body.status,
      },
    });

    return res.json({ design: updated });
  } catch (e: any) {
    console.error("UPDATE DESIGN ERROR:", e);
    return res.status(500).json({ message: e?.message ?? "Server error" });
  }
});

// ✅ Delete design (soft delete)
app.delete("/api/designer/designs/:id", async (req, res) => {
  try {
    const auth = await authRequired(req);
    if (!auth.ok) return res.status(auth.status).json({ message: auth.message });

    if (auth.partner.role !== PartnerRole.TAILOR) {
      return res.status(403).json({ message: "Access denied" });
    }

    const designId = s(req.params.id);

    // Verify ownership
    const existing = await prisma.design.findFirst({
      where: {
        id: designId,
        designer: {
          partnerId: auth.partner.id,
        },
      },
    });

    if (!existing) {
      return res.status(404).json({ message: "Design not found" });
    }

    await prisma.design.delete({
      where: { id: designId },
    });

    return res.json({ success: true });
  } catch (e: any) {
    console.error("DELETE DESIGN ERROR:", e);
    return res.status(500).json({ message: e?.message ?? "Server error" });
  }
});

// ✅ Upload design image
app.post("/api/designer/designs/:id/image", upload.single("image"), async (req, res) => {
  try {
    const auth = await authRequired(req);
    if (!auth.ok) return res.status(auth.status).json({ message: auth.message });

    if (auth.partner.role !== PartnerRole.TAILOR) {
      return res.status(403).json({ message: "Access denied" });
    }

    const designId = s(req.params.id);

    // Verify ownership
    const existing = await prisma.design.findFirst({
      where: {
        id: designId,
        designer: {
          partnerId: auth.partner.id,
        },
      },
    });

    if (!existing) {
      return res.status(404).json({ message: "Design not found" });
    }

    if (!req.file) {
      return res.status(400).json({ message: "No image uploaded" });
    }

    const imageUrl = `http://localhost:${PORT}/uploads/${req.file.filename}`;

    // Add to images array
    const images = [...(existing.images || []), imageUrl];

    await prisma.design.update({
      where: { id: designId },
      data: { images },
    });

    return res.json({ imageUrl, images });
  } catch (e: any) {
    console.error("UPLOAD DESIGN IMAGE ERROR:", e);
    return res.status(500).json({ message: e?.message ?? "Server error" });
  }
});

// ============================================
// DESIGNER CATEGORY MANAGEMENT ENDPOINTS
// ============================================

// ✅ Get all categories for a designer
app.get("/api/designer/categories", async (req, res) => {
  try {
    const auth = await authRequired(req);
    if (!auth.ok) return res.status(auth.status).json({ message: auth.message });

    if (auth.partner.role !== PartnerRole.TAILOR) {
      return res.status(403).json({ message: "Access denied" });
    }

    // Get designer profile
    const designerProfile = await prisma.designerProfile.findUnique({
      where: { partnerId: auth.partner.id },
    });

    if (!designerProfile) {
      return res.status(404).json({ message: "Designer profile not found" });
    }

    const categories = await prisma.designerCategory.findMany({
      where: { designerId: designerProfile.id },
      include: {
        subcategories: {
          include: {
            items: {
              include: {
                sizes: true,
              },
            },
          },
          orderBy: { displayOrder: 'asc' },
        },
      },
      orderBy: { displayOrder: 'asc' },
    });

    return res.json({ categories });
  } catch (e: any) {
    console.error("GET CATEGORIES ERROR:", e);
    return res.status(500).json({ message: e?.message ?? "Server error" });
  }
});

// ✅ Create a new category
app.post("/api/designer/categories", async (req, res) => {
  try {
    const auth = await authRequired(req);
    if (!auth.ok) return res.status(auth.status).json({ message: auth.message });

    if (auth.partner.role !== PartnerRole.TAILOR) {
      return res.status(403).json({ message: "Access denied" });
    }

    const { name, isDefault = false } = req.body;

    if (!name) {
      return res.status(400).json({ message: "Category name is required" });
    }

    // Get designer profile
    const designerProfile = await prisma.designerProfile.findUnique({
      where: { partnerId: auth.partner.id },
    });

    if (!designerProfile) {
      return res.status(404).json({ message: "Designer profile not found" });
    }

    // Get max display order
    const lastCategory = await prisma.designerCategory.findFirst({
      where: { designerId: designerProfile.id },
      orderBy: { displayOrder: 'desc' },
    });

    const displayOrder = lastCategory ? lastCategory.displayOrder + 1 : 0;

    const category = await prisma.designerCategory.create({
      data: {
        designerId: designerProfile.id,
        name,
        isDefault,
        displayOrder,
      },
    });

    return res.json({ category });
  } catch (e: any) {
    console.error("CREATE CATEGORY ERROR:", e);
    return res.status(500).json({ message: e?.message ?? "Server error" });
  }
});

// ✅ Update a category
app.put("/api/designer/categories/:id", async (req, res) => {
  try {
    const auth = await authRequired(req);
    if (!auth.ok) return res.status(auth.status).json({ message: auth.message });

    if (auth.partner.role !== PartnerRole.TAILOR) {
      return res.status(403).json({ message: "Access denied" });
    }

    const categoryId = s(req.params.id);
    const { name, displayOrder } = req.body;

    // Verify ownership
    const designerProfile = await prisma.designerProfile.findUnique({
      where: { partnerId: auth.partner.id },
    });

    if (!designerProfile) {
      return res.status(404).json({ message: "Designer profile not found" });
    }

    const category = await prisma.designerCategory.findFirst({
      where: {
        id: categoryId,
        designerId: designerProfile.id,
      },
    });

    if (!category) {
      return res.status(404).json({ message: "Category not found" });
    }

    const updated = await prisma.designerCategory.update({
      where: { id: categoryId },
      data: {
        name: name || undefined,
        displayOrder: displayOrder !== undefined ? displayOrder : undefined,
      },
    });

    return res.json({ category: updated });
  } catch (e: any) {
    console.error("UPDATE CATEGORY ERROR:", e);
    return res.status(500).json({ message: e?.message ?? "Server error" });
  }
});

// ✅ Delete a category
app.delete("/api/designer/categories/:id", async (req, res) => {
  try {
    const auth = await authRequired(req);
    if (!auth.ok) return res.status(auth.status).json({ message: auth.message });

    if (auth.partner.role !== PartnerRole.TAILOR) {
      return res.status(403).json({ message: "Access denied" });
    }

    const categoryId = s(req.params.id);

    // Verify ownership
    const designerProfile = await prisma.designerProfile.findUnique({
      where: { partnerId: auth.partner.id },
    });

    if (!designerProfile) {
      return res.status(404).json({ message: "Designer profile not found" });
    }

    const category = await prisma.designerCategory.findFirst({
      where: {
        id: categoryId,
        designerId: designerProfile.id,
      },
    });

    if (!category) {
      return res.status(404).json({ message: "Category not found" });
    }

    // Don't allow deleting default categories? Or allow?
    if (category.isDefault) {
      return res.status(400).json({ message: "Cannot delete default category" });
    }

    await prisma.designerCategory.delete({
      where: { id: categoryId },
    });

    return res.json({ success: true });
  } catch (e: any) {
    console.error("DELETE CATEGORY ERROR:", e);
    return res.status(500).json({ message: e?.message ?? "Server error" });
  }
});

// ✅ Create a new subcategory
app.post("/api/designer/subcategories", async (req, res) => {
  try {
    const auth = await authRequired(req);
    if (!auth.ok) return res.status(auth.status).json({ message: auth.message });

    if (auth.partner.role !== PartnerRole.TAILOR) {
      return res.status(403).json({ message: "Access denied" });
    }

    const { categoryId, name } = req.body;

    if (!categoryId || !name) {
      return res.status(400).json({ message: "categoryId and name are required" });
    }

    // Verify ownership
    const designerProfile = await prisma.designerProfile.findUnique({
      where: { partnerId: auth.partner.id },
    });

    if (!designerProfile) {
      return res.status(404).json({ message: "Designer profile not found" });
    }

    const category = await prisma.designerCategory.findFirst({
      where: {
        id: categoryId,
        designerId: designerProfile.id,
      },
    });

    if (!category) {
      return res.status(404).json({ message: "Category not found" });
    }

    // Get max display order
    const lastSubcategory = await prisma.designerSubcategory.findFirst({
      where: { categoryId },
      orderBy: { displayOrder: 'desc' },
    });

    const displayOrder = lastSubcategory ? lastSubcategory.displayOrder + 1 : 0;

    const subcategory = await prisma.designerSubcategory.create({
      data: {
        categoryId,
        name,
        displayOrder,
      },
    });

    return res.json({ subcategory });
  } catch (e: any) {
    console.error("CREATE SUBCATEGORY ERROR:", e);
    return res.status(500).json({ message: e?.message ?? "Server error" });
  }
});

// ✅ Update a subcategory
app.put("/api/designer/subcategories/:id", async (req, res) => {
  try {
    const auth = await authRequired(req);
    if (!auth.ok) return res.status(auth.status).json({ message: auth.message });

    if (auth.partner.role !== PartnerRole.TAILOR) {
      return res.status(403).json({ message: "Access denied" });
    }

    const subcategoryId = s(req.params.id);
    const { name, displayOrder } = req.body;

    // Verify ownership through category
    const subcategory = await prisma.designerSubcategory.findFirst({
      where: {
        id: subcategoryId,
        category: {
          designer: {
            partnerId: auth.partner.id,
          },
        },
      },
    });

    if (!subcategory) {
      return res.status(404).json({ message: "Subcategory not found" });
    }

    const updated = await prisma.designerSubcategory.update({
      where: { id: subcategoryId },
      data: {
        name: name || undefined,
        displayOrder: displayOrder !== undefined ? displayOrder : undefined,
      },
    });

    return res.json({ subcategory: updated });
  } catch (e: any) {
    console.error("UPDATE SUBCATEGORY ERROR:", e);
    return res.status(500).json({ message: e?.message ?? "Server error" });
  }
});

// ✅ Delete a subcategory
app.delete("/api/designer/subcategories/:id", async (req, res) => {
  try {
    const auth = await authRequired(req);
    if (!auth.ok) return res.status(auth.status).json({ message: auth.message });

    if (auth.partner.role !== PartnerRole.TAILOR) {
      return res.status(403).json({ message: "Access denied" });
    }

    const subcategoryId = s(req.params.id);

    // Verify ownership
    const subcategory = await prisma.designerSubcategory.findFirst({
      where: {
        id: subcategoryId,
        category: {
          designer: {
            partnerId: auth.partner.id,
          },
        },
      },
    });

    if (!subcategory) {
      return res.status(404).json({ message: "Subcategory not found" });
    }

    await prisma.designerSubcategory.delete({
      where: { id: subcategoryId },
    });

    return res.json({ success: true });
  } catch (e: any) {
    console.error("DELETE SUBCATEGORY ERROR:", e);
    return res.status(500).json({ message: e?.message ?? "Server error" });
  }
});

// ✅ Create a new item
app.post("/api/designer/items", async (req, res) => {
  try {
    const auth = await authRequired(req);
    if (!auth.ok) return res.status(auth.status).json({ message: auth.message });

    if (auth.partner.role !== PartnerRole.TAILOR) {
      return res.status(403).json({ message: "Access denied" });
    }

    const {
      subcategoryId,
      name,
      description,
      price,
      discountPrice,
      currency = "₹",
      images = [],
      videos = [],
      availability,
      sizes = [],
      measurements,
      deliveryTime,
      customizationTime,
    } = req.body;

    if (!subcategoryId || !name || !price || !availability) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    // Verify ownership
    const subcategory = await prisma.designerSubcategory.findFirst({
      where: {
        id: subcategoryId,
        category: {
          designer: {
            partnerId: auth.partner.id,
          },
        },
      },
    });

    if (!subcategory) {
      return res.status(404).json({ message: "Subcategory not found" });
    }

    // Create item with transaction to also create sizes
    const result = await prisma.$transaction(async (tx) => {
      const item = await tx.designerItem.create({
        data: {
          subcategoryId,
          name,
          description,
          price: Number(price),
          discountPrice: discountPrice ? Number(discountPrice) : null,
          currency,
          images,
          videos,
          availability,
          measurements: measurements || null,
          deliveryTime,
          customizationTime,
        },
      });

      // Create sizes if provided and availability is READY_MADE
      if (availability === 'READY_MADE' && sizes.length > 0) {
        await tx.size.createMany({
          data: sizes.map((size: string) => ({
            itemId: item.id,
            size,
            inStock: true,
          })),
        });
      }

      return item;
    });

    return res.json({ item: result });
  } catch (e: any) {
    console.error("CREATE ITEM ERROR:", e);
    return res.status(500).json({ message: e?.message ?? "Server error" });
  }
});

// ✅ Update an item
app.put("/api/designer/items/:id", async (req, res) => {
  try {
    const auth = await authRequired(req);
    if (!auth.ok) return res.status(auth.status).json({ message: auth.message });

    if (auth.partner.role !== PartnerRole.TAILOR) {
      return res.status(403).json({ message: "Access denied" });
    }

    const itemId = s(req.params.id);
    const {
      name,
      description,
      price,
      discountPrice,
      images,
      videos,
      availability,
      sizes,
      measurements,
      deliveryTime,
      customizationTime,
      isActive,
    } = req.body;

    // Verify ownership
    const item = await prisma.designerItem.findFirst({
      where: {
        id: itemId,
        subcategory: {
          category: {
            designer: {
              partnerId: auth.partner.id,
            },
          },
        },
      },
      include: { sizes: true },
    });

    if (!item) {
      return res.status(404).json({ message: "Item not found" });
    }

    // Update with transaction
    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.designerItem.update({
        where: { id: itemId },
        data: {
          name: name || undefined,
          description: description !== undefined ? description : undefined,
          price: price !== undefined ? Number(price) : undefined,
          discountPrice: discountPrice !== undefined ? Number(discountPrice) : undefined,
          images: images || undefined,
          videos: videos || undefined,
          availability: availability || undefined,
          measurements: measurements || undefined,
          deliveryTime: deliveryTime !== undefined ? deliveryTime : undefined,
          customizationTime: customizationTime !== undefined ? customizationTime : undefined,
          isActive: isActive !== undefined ? isActive : undefined,
        },
      });

      // Update sizes if provided and availability is READY_MADE
      if (availability === 'READY_MADE' && sizes) {
        // Delete existing sizes
        await tx.size.deleteMany({
          where: { itemId },
        });

        // Create new sizes
        if (sizes.length > 0) {
          await tx.size.createMany({
            data: sizes.map((size: string) => ({
              itemId,
              size,
              inStock: true,
            })),
          });
        }
      }

      return updated;
    });

    return res.json({ item: result });
  } catch (e: any) {
    console.error("UPDATE ITEM ERROR:", e);
    return res.status(500).json({ message: e?.message ?? "Server error" });
  }
});

// ✅ Delete an item
app.delete("/api/designer/items/:id", async (req, res) => {
  try {
    const auth = await authRequired(req);
    if (!auth.ok) return res.status(auth.status).json({ message: auth.message });

    if (auth.partner.role !== PartnerRole.TAILOR) {
      return res.status(403).json({ message: "Access denied" });
    }

    const itemId = s(req.params.id);

    // Verify ownership
    const item = await prisma.designerItem.findFirst({
      where: {
        id: itemId,
        subcategory: {
          category: {
            designer: {
              partnerId: auth.partner.id,
            },
          },
        },
      },
    });

    if (!item) {
      return res.status(404).json({ message: "Item not found" });
    }

    // This will cascade delete sizes due to onDelete: Cascade
    await prisma.designerItem.delete({
      where: { id: itemId },
    });

    return res.json({ success: true });
  } catch (e: any) {
    console.error("DELETE ITEM ERROR:", e);
    return res.status(500).json({ message: e?.message ?? "Server error" });
  }
});

// Update the multi-image upload endpoint
app.post("/api/designer/items/:id/images", upload.array("images", 8), async (req, res) => {
  try {
    console.log('=== MULTI-IMAGE UPLOAD REQUEST ===');
    
    const auth = await authRequired(req);
    if (!auth.ok) return res.status(auth.status).json({ message: auth.message });

    if (auth.partner.role !== PartnerRole.TAILOR) {
      return res.status(403).json({ message: "Access denied" });
    }

    const itemId = s(req.params.id);
    const files = req.files as Express.Multer.File[];

    if (!files || files.length === 0) {
      return res.status(400).json({ message: "No images uploaded" });
    }

    if (files.length < 3) {
      return res.status(400).json({ message: "Minimum 3 images required" });
    }

    if (files.length > 8) {
      return res.status(400).json({ message: "Maximum 8 images allowed" });
    }

    // Get the item with all related info
    const item = await prisma.designerItem.findFirst({
      where: {
        id: itemId,
        subcategory: {
          category: {
            designer: {
              partnerId: auth.partner.id,
            },
          },
        },
      },
      include: {
        subcategory: {
          include: {
            category: {
              include: {
                designer: {
                  include: {
                    partner: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!item) {
      return res.status(404).json({ message: "Item not found" });
    }

    // Get business name, category name, subcategory name
    const businessName = item.subcategory.category.designer.partner.businessName || 
                        item.subcategory.category.designer.partner.fullName;
    const categoryName = item.subcategory.category.name;
    const subcategoryName = item.subcategory.name;
    const itemName = item.name;

    // Upload to Azure Blob Storage
    const uploadResults = await uploadMultipleToAzure(
      files,
      businessName,
      categoryName,
      subcategoryName,
      itemName
    );

    const imageUrls = uploadResults.map(result => result.url);

    // Update the item with image URLs
    const updated = await prisma.designerItem.update({
      where: { id: itemId },
      data: { images: imageUrls },
    });

    console.log('Images uploaded to Azure successfully:', imageUrls);
    return res.json({ images: updated.images });
  } catch (e: any) {
    console.error("UPLOAD ITEM IMAGES ERROR:", e);
    return res.status(500).json({ message: e?.message ?? "Server error" });
  }
});

// ============================================
// PROFILE UPDATE ENDPOINT (for all partner types)
// ============================================

// ✅ Update partner profile
app.put("/api/partner/profile", async (req, res) => {
  try {
    const auth = await authRequired(req);
    if (!auth.ok) return res.status(auth.status).json({ message: auth.message });

    const {
      fullName,
      email,
      businessName,
      address,
      city,
      experience,
    } = req.body;

    // Update partner basic info
    const updatedPartner = await prisma.partner.update({
      where: { id: auth.partner.id },
      data: {
        fullName: fullName || undefined,
        email: email || undefined,
        businessName: businessName || undefined,
        address: address || undefined,
        city: city || undefined,
        experience: experience || undefined,
      },
    });

    // Handle role-specific profile updates
    if (auth.partner.role === PartnerRole.TAILOR) {
      // Update designer profile if exists
      const { bio, specialties, avatar, coverImage } = req.body;
      
      if (bio || specialties || avatar || coverImage) {
        await prisma.designerProfile.upsert({
          where: { partnerId: auth.partner.id },
          update: {
            bio: bio || undefined,
            specialties: specialties || undefined,
            avatar: avatar || undefined,
            coverImage: coverImage || undefined,
          },
          create: {
            partnerId: auth.partner.id,
            bio: bio || "",
            specialties: specialties || ["Fashion"],
            avatar: avatar || null,
            coverImage: coverImage || null,
          },
        });
      }
    }

    if (auth.partner.role === PartnerRole.DELIVERY) {
      // Update delivery partner profile
      const { drivingLicense, vehicleNumber, vehicleType, vehicleModel } = req.body;
      
      if (drivingLicense || vehicleNumber || vehicleType || vehicleModel) {
        await prisma.deliveryPartner.upsert({
          where: { partnerId: auth.partner.id },
          update: {
            drivingLicense: drivingLicense || undefined,
            vehicleNumber: vehicleNumber || undefined,
            vehicleType: vehicleType || undefined,
            vehicleModel: vehicleModel || undefined,
          },
          create: {
            partnerId: auth.partner.id,
            drivingLicense: drivingLicense || "",
            vehicleNumber: vehicleNumber || "",
            vehicleType: vehicleType || "BIKE",
            vehicleModel: vehicleModel || null,
          },
        });
      }
    }

    // Fetch updated partner with all relations
    const updated = await prisma.partner.findUnique({
      where: { id: auth.partner.id },
      include: {
        designerProfile: true,
        deliveryPartner: true,
        meatShop: true,
        laundryShop: true,
      },
    });

    return res.json({ partner: updated });
  } catch (e: any) {
    console.error("PROFILE UPDATE ERROR:", e);
    return res.status(500).json({ message: e?.message ?? "Server error" });
  }
});