// server.ts
import "dotenv/config";
import express from "express";
import cors from "cors";
import { PrismaClient, PartnerRole, PartnerStatus, DeliveryStatus, VehicleType } from "@prisma/client";
import { uploadMultipleToAzure } from "./utils/azure-storage-helper";
import { ensureContainerExists } from "./config/azure-storage";
import bcrypt from "bcryptjs";
import { uploadMeatItemImage, uploadMultipleMeatItemImages } from "./utils/azure-storage-helper-meat";
import { Server } from 'socket.io';
import crypto from "crypto";
import multer from "multer";
import http from 'http';
import { setupWebSocket, getDeliveryStatus } from "./websocket";
import path from "path";
import fs from "fs";
import trackingRoutes from './routes/tracking';


const app = express();
const prisma = new PrismaClient();

app.use(cors());
app.use(express.json());
app.use('/api', trackingRoutes);

const PORT = Number(process.env.PORT || 8080);

const server = http.createServer(app);
const io = setupWebSocket(server);

// const io = new Server(server, {
//   cors: { origin: "http://localhost:8081" }
// });

// // Track active deliveries
// const activeDeliveries = new Map();

process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT EXCEPTION:", err);
});

process.on("unhandledRejection", (reason) => {
  console.error("UNHANDLED REJECTION:", reason);
});
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


// io.on("connection", (socket) => {
//   console.log("Socket connected:", socket.id);

//   socket.on("join-store-room", (storeId: string) => {
//     if (storeId) {
//       socket.join(`store-${storeId}`);
//       console.log(`Socket ${socket.id} joined store-${storeId}`);
//     }
//   });

//   socket.on("join-customer-room", (customerId: string) => {
//     if (customerId) {
//       socket.join(`customer-${customerId}`);
//       console.log(`Socket ${socket.id} joined customer-${customerId}`);
//     }
//   });

//   socket.on("join-order-room", (orderId: string) => {
//     if (orderId) {
//       socket.join(`order-${orderId}`);
//       console.log(`Socket ${socket.id} joined order-${orderId}`);
//     }
//   });

//   socket.on("join-delivery-room", (deliveryId: string) => {
//     if (deliveryId) {
//       socket.join(`delivery-${deliveryId}`);
//       console.log(`Socket ${socket.id} joined delivery-${deliveryId}`);
//     }
//   });

//   socket.on("join-delivery-partner-room", (deliveryPartnerId: string) => {
//     if (deliveryPartnerId) {
//       socket.join(`delivery-partner-${deliveryPartnerId}`);
//       console.log(`Socket ${socket.id} joined delivery-partner-${deliveryPartnerId}`);
//     }
//   });

//   socket.on("location-update", (data) => {
//     const { deliveryId, lat, lng, timestamp } = data || {};
//     if (!deliveryId) return;

//     io.to(`delivery-${deliveryId}`).emit("partner-location", {
//       lat,
//       lng,
//       timestamp,
//     });
//   });

//   socket.on("disconnect", () => {
//     console.log("Socket disconnected:", socket.id);
//   });
// });


function calculatePickupTime() {
  const dt = new Date();
  dt.setMinutes(dt.getMinutes() + 15);
  return dt;
}

function calculateDeliveryTime() {
  const dt = new Date();
  dt.setMinutes(dt.getMinutes() + 45);
  return dt;
}

async function findOptimalPartner(partners: any[], _orderId: string) {
  if (!partners.length) {
    throw new Error("No delivery partners available");
  }
  return partners[0];
}

async function notifyPartner(_partnerId: string, _delivery: any) {
  console.log("notifyPartner placeholder called");
}

// function getDeliveryStatus(_deliveryId: string) {
//   return null;
// }
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

function generate4DigitOtp() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

async function customerAuthRequired(req: express.Request) {
  const token = parseBearerToken(req);
  if (!token) return { ok: false as const, status: 401, message: "Missing token" };

  const customer = await prisma.customer.findFirst({
    where: { token, isActive: true },
    include: {
      addresses: {
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!customer) {
    return { ok: false as const, status: 401, message: "Invalid customer token" };
  }

  return { ok: true as const, customer };
}

function toNumber(value: any): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value) || 0;
  if (typeof value?.toNumber === "function") return value.toNumber();
  return Number(value) || 0;
}

function roleFromPartnerType(partnerType: string): PartnerRole {
  const pt = partnerType.toLowerCase();

  if (["laundry", "laundry_partner", "laundry_shop"].includes(pt)) return PartnerRole.LAUNDRY_PARTNER;
  if (["meat_store", "meat", "meatshop", "meat_shop", "butcher"].includes(pt)) return PartnerRole.MEAT_PARTNER;
  if (["organic", "organic_store", "organic-shop", "organicshop", "kirana", "grocery_organic"].includes(pt)) {
    return PartnerRole.ORGANIC_PARTNER;
  }
  if (["tailor", "stitching", "designer"].includes(pt)) return PartnerRole.TAILOR;
  if (["cook", "cooking", "chef"].includes(pt)) return PartnerRole.COOK;
  if (["delivery", "delivery_partner", "driver"].includes(pt)) return PartnerRole.DELIVERY;

  // ❌ Don't default to TAILOR - throw an error
  throw new Error(`Invalid partner type: ${partnerType}`);
}

function parseBearerToken(req: express.Request) {
  const auth = String(req.headers.authorization ?? "");
  return auth.startsWith("Bearer ") ? auth.substring(7).trim() : "";
}

function generateOrderNumber(prefix: string = "IML") {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `${prefix}-${y}${m}${d}-${rand}`;
}

function normalizeVehicleType(value?: string | null): VehicleType {
  const v = String(value || "").trim().toUpperCase();

  if (v === "BIKE") return VehicleType.BIKE;
  if (v === "SCOOTY") return VehicleType.SCOOTY;
  if (v === "CAR") return VehicleType.CAR;
  if (v === "BICYCLE") return VehicleType.BIKE;

  return VehicleType.BIKE;
}

async function ensureDeliveryPartnerProfile(partnerId: string, extras?: {
  drivingLicense?: string | null;
  vehicleNumber?: string | null;
  vehicleType?: string | null;
  vehicleModel?: string | null;
}) {
  const existing = await prisma.deliveryPartner.findUnique({
    where: { partnerId },
  });

  if (existing) return existing;

  return prisma.deliveryPartner.create({
    data: {
      partnerId,
      drivingLicense: extras?.drivingLicense || "PENDING",
      vehicleNumber: extras?.vehicleNumber || "PENDING",
      vehicleType: normalizeVehicleType(extras?.vehicleType),
      vehicleModel: extras?.vehicleModel || null,
      isAvailable: true,
    },
  });
}

app.post("/api/orders", async (req, res) => {
  try {
    const {
      serviceType,
      storeId,
      items = [],
      addressId,
      paymentMethod,
      couponCode,
      pricingSummary,
      isScheduled,
      scheduledFor,
      scheduleSlot,
      deliveryNote,
    } = req.body;

    if (!serviceType || !storeId || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: "serviceType, storeId and items are required" });
    }

    if (!paymentMethod || String(paymentMethod).toUpperCase() !== "COD") {
      return res.status(400).json({ message: "Only COD is implemented right now" });
    }

    const auth = await customerAuthRequired(req);
    if (!auth.ok) {
      return res.status(auth.status).json({ message: auth.message });
    }

    const selectedAddress = await prisma.customerAddress.findFirst({
      where: {
        id: String(addressId),
        customerId: auth.customer.id,
      },
    });

    if (!selectedAddress) {
      return res.status(400).json({ message: "Valid address is required" });
    }

    const normalizedServiceType = String(serviceType).trim().toUpperCase();
    const storeType = normalizedServiceType === "MEAT" ? "MEAT" : "ORGANIC";

    let store: any = null;

    if (storeType === "MEAT") {
      store = await prisma.meatShop.findFirst({
        where: {
          id: storeId,
          isOpen: true,
          partner: {
            role: PartnerRole.MEAT_PARTNER,
            status: PartnerStatus.APPROVED,
            isActive: true,
          },
        },
        include: { partner: true },
      });
    } else {
      store = await prisma.organicShop.findFirst({
        where: {
          id: storeId,
          isOpen: true,
          partner: {
            role: PartnerRole.ORGANIC_PARTNER,
            status: PartnerStatus.APPROVED,
            isActive: true,
          },
        },
        include: { partner: true },
      });
    }

    if (!store) {
      return res.status(404).json({ message: "Store not found or currently closed" });
    }

    const itemIds = items.map((x: any) => String(x.itemId));
    let dbItems: any[] = [];

    if (storeType === "MEAT") {
      dbItems = await prisma.meatItem.findMany({
        where: {
          id: { in: itemIds },
          meatShopId: store.id,
          inStock: true,
        },
      });
    } else {
      dbItems = await prisma.organicItem.findMany({
        where: {
          id: { in: itemIds },
          organicShopId: store.id,
          inStock: true,
        },
      });
    }

    if (dbItems.length !== itemIds.length) {
      return res.status(400).json({ message: "Some items are invalid or out of stock" });
    }

    const normalizedItems = items.map((raw: any) => {
      const dbItem = dbItems.find((x: any) => x.id === String(raw.itemId));
      const qty = Number(raw.quantity ?? 0);
      const price = Number(dbItem.price ?? 0);

      return {
        itemId: dbItem.id,
        itemName: dbItem.name,
        unit: dbItem.unit ?? null,
        imageUrl: dbItem.imageUrl ?? null,
        quantity: qty,
        price,
        lineTotal: qty * price,
      };
    });

    const subtotal = normalizedItems.reduce((sum: number, x: any) => sum + x.lineTotal, 0);

    const scheduledFields = {
      isScheduled: Boolean(isScheduled && scheduledFor),
      scheduledFor: scheduledFor ? new Date(scheduledFor) : null,
      scheduleSlot: scheduleSlot ? String(scheduleSlot) : null,
      deliveryNote: deliveryNote ? String(deliveryNote) : null,
    };

    const createdOrder = await prisma.$transaction(async (tx) => {
      const orderRecord = await tx.customerOrder.create({
        data: {
          orderNumber: generateOrderNumber(),
          serviceType: normalizedServiceType,
          storeType,
          storeId: store.id,
          storeName: store.shopName,
          customerName: auth.customer.fullName,
          customerPhone: auth.customer.phone,
          customerAddress: selectedAddress.fullAddress,
          customerLat: selectedAddress.lat ?? null,
          customerLng: selectedAddress.lng ?? null,
          paymentMethod: "COD",
          paymentStatus: "PENDING_CASH_COLLECTION",
          orderStatus: "PLACED",
          couponCode: couponCode ? String(couponCode).trim().toUpperCase() : null,
          subtotal: Number(pricingSummary?.subtotal ?? subtotal),
          packagingCharge: Number(pricingSummary?.packagingCharge ?? 0),
          deliveryFee: Number(pricingSummary?.deliveryFee ?? 0),
          platformFee: Number(pricingSummary?.platformFee ?? 0),
          handlingFee: Number(pricingSummary?.handlingFee ?? 0),
          gst: Number(pricingSummary?.gst ?? 0),
          restaurantGst: Number(pricingSummary?.restaurantGst ?? 0),
          gstOnDeliveryFee: Number(pricingSummary?.gstOnDeliveryFee ?? 0),
          lateNightFee: Number(pricingSummary?.lateNightFee ?? 0),
          discount: Number(pricingSummary?.discount ?? 0),
          totalAmount: Number(pricingSummary?.totalPayable ?? subtotal),

          ...scheduledFields,

          items: {
            create: normalizedItems.map((x: any) => ({
              itemId: x.itemId,
              itemName: x.itemName,
              unit: x.unit,
              price: x.price,
              quantity: x.quantity,
              lineTotal: x.lineTotal,
              imageUrl: x.imageUrl,
            })),
          },

          statusHistory: {
            create: {
              status: "PLACED",
              note: Boolean(isScheduled && scheduledFor)
                ? `Scheduled order placed by customer for ${scheduleSlot || "selected slot"}`
                : "Order placed by customer with COD",
              actorType: "CUSTOMER",
            },
          },
        },
        include: {
          items: true,
          statusHistory: true,
        },
      });

      await tx.orderPayment.create({
        data: {
          order_id: orderRecord.id,
          payment_method: "COD",
          payment_gateway: null,
          transaction_id: null,
          status: "PENDING_CASH_COLLECTION",
          amount: Number(pricingSummary?.totalPayable ?? subtotal),
        },
      });

      return orderRecord;
    });

    const freshOrderRaw = await prisma.customerOrder.findUnique({
      where: { id: createdOrder.id },
      include: {
        items: true,
        statusHistory: true,
      },
    });

    if (!freshOrderRaw) {
      return res.status(500).json({ message: "Failed to reload created order" });
    }

    const freshOrder: any = freshOrderRaw;

    io.to(`store-${store.id}`).emit("store-new-order", {
      orderId: freshOrder.id,
      orderNumber: freshOrder.orderNumber,
      storeId: store.id,
      storeName: store.shopName,
      totalAmount: freshOrder.totalAmount,
      paymentMethod: freshOrder.paymentMethod,
      orderStatus: freshOrder.orderStatus,
      createdAt: freshOrder.createdAt,
      isScheduled: freshOrder.isScheduled,
      scheduledFor: freshOrder.scheduledFor,
      scheduleSlot: freshOrder.scheduleSlot,
      deliveryNote: freshOrder.deliveryNote,
    });

    io.to(`customer-${auth.customer.id}`).emit("customer-order-created", {
      orderId: freshOrder.id,
      orderNumber: freshOrder.orderNumber,
      orderStatus: freshOrder.orderStatus,
      totalAmount: freshOrder.totalAmount,
      createdAt: freshOrder.createdAt,
      isScheduled: freshOrder.isScheduled,
      scheduledFor: freshOrder.scheduledFor,
      scheduleSlot: freshOrder.scheduleSlot,
    });

    io.to(`order-${freshOrder.id}`).emit("order-status-updated", {
      orderId: freshOrder.id,
      orderStatus: freshOrder.orderStatus,
    });

    return res.json({
      message: "COD order placed successfully",
      order: freshOrder,
    });
  } catch (e: any) {
    console.error("CREATE ORDER ERROR:", e);
    return res.status(500).json({ message: e?.message ?? "Server error" });
  }
});

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

async function requireDeliveryPartnerApproved(req: express.Request) {
  const auth = await authRequired(req);
  if (!auth.ok) return auth;

  const partner = auth.partner;

  if (partner.role !== PartnerRole.DELIVERY) {
    return { ok: false as const, status: 403, message: "Only Delivery Partner can access this." };
  }
  if (partner.status !== PartnerStatus.APPROVED) {
    return { ok: false as const, status: 403, message: "Account under review. Not approved yet." };
  }

  return { ok: true as const, partner };
}

app.get("/api/customer/orders", async (req, res) => {
  try {
    const auth = await customerAuthRequired(req);
    if (!auth.ok) {
      return res.status(auth.status).json({ message: auth.message });
    }

    const orders = await prisma.customerOrder.findMany({
      where: {
        customerPhone: auth.customer.phone,
      },
      include: {
        items: true,
        statusHistory: {
          orderBy: { createdAt: "desc" },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return res.json({ orders });
  } catch (e: any) {
    console.error("CUSTOMER ORDERS ERROR:", e);
    return res.status(500).json({ message: e?.message ?? "Server error" });
  }
});

app.get("/api/customer/orders/:id", async (req, res) => {
  try {
    const auth = await customerAuthRequired(req);
    if (!auth.ok) {
      return res.status(auth.status).json({ message: auth.message });
    }

    const orderId = s(req.params.id);

    const order = await prisma.customerOrder.findFirst({
      where: {
        id: orderId,
        customerPhone: auth.customer.phone,
      },
      include: {
        items: true,
        statusHistory: {
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    return res.json({ order });
  } catch (e: any) {
    console.error("CUSTOMER ORDER DETAIL ERROR:", e);
    return res.status(500).json({ message: e?.message ?? "Server error" });
  }
});

app.get("/api/orders/:id", async (req, res) => {
  try {
    const orderId = s(req.params.id);

    const auth = await authRequired(req);
    if (!auth.ok) return res.status(auth.status).json({ message: auth.message });

    const order = await prisma.customerOrder.findUnique({
      where: { id: orderId },
      include: {
        items: true,
        statusHistory: {
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    let ownedStore: any = null;

    if (auth.partner.role === PartnerRole.MEAT_PARTNER) {
      ownedStore = await prisma.meatShop.findUnique({
        where: { partnerId: auth.partner.id },
      });
    } else if (auth.partner.role === PartnerRole.ORGANIC_PARTNER) {
      ownedStore = await prisma.organicShop.findUnique({
        where: { partnerId: auth.partner.id },
      });
    }

    if (!ownedStore || ownedStore.id !== order.storeId) {
      return res.status(403).json({ message: "You cannot access this order" });
    }

    return res.json({ order });
  } catch (e: any) {
    console.error("STORE ORDER DETAIL ERROR:", e);
    return res.status(500).json({ message: e?.message ?? "Server error" });
  }
});


// ============================================
// CUSTOMER AUTH + PROFILE
// ============================================

// Register customer
app.post("/api/customers/register", async (req, res) => {
  try {
    const fullName = s(req.body.fullName);
    const phone = s(req.body.phone);
    const email = req.body.email ? s(req.body.email) : null;
    const password = s(req.body.password);

    const addressLabel = req.body.addressLabel ? s(req.body.addressLabel) : "Home";
    const fullAddress = req.body.fullAddress ? s(req.body.fullAddress) : null;
    const city = req.body.city ? s(req.body.city) : null;
    const lat = asFloat(req.body.lat);
    const lng = asFloat(req.body.lng);

    if (!fullName || !phone || !password) {
      return res.status(400).json({
        message: "fullName, phone and password are required",
      });
    }

    const existing = await prisma.customer.findUnique({
      where: { phone },
    });

    if (existing) {
      return res.status(409).json({ message: "Customer already exists. Please login." });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const token = genToken();

    const customer = await prisma.customer.create({
      data: {
        fullName,
        phone,
        email,
        passwordHash,
        token,
        addresses: fullAddress
          ? {
              create: {
                label: addressLabel,
                fullAddress,
                city,
                lat,
                lng,
                isDefault: true,
              },
            }
          : undefined,
      },
      include: {
        addresses: {
          orderBy: { createdAt: "desc" },
        },
      },
    });

    return res.json({
      token,
      customer,
    });
  } catch (e: any) {
    console.error("CUSTOMER REGISTER ERROR:", e);
    return res.status(500).json({ message: e?.message ?? "Server error" });
  }
});

// Login customer
app.post("/api/customers/login", async (req, res) => {
  try {
    const phone = s(req.body.phone);
    const password = s(req.body.password);

    if (!phone || !password) {
      return res.status(400).json({ message: "phone and password are required" });
    }

    const customer = await prisma.customer.findUnique({
      where: { phone },
      include: {
        addresses: {
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!customer) {
      return res.status(404).json({ message: "Customer not found. Please register." });
    }

    const valid = await bcrypt.compare(password, customer.passwordHash);
    if (!valid) {
      return res.status(401).json({ message: "Invalid phone or password" });
    }

    const token = genToken();

    const updated = await prisma.customer.update({
      where: { id: customer.id },
      data: { token },
      include: {
        addresses: {
          orderBy: { createdAt: "desc" },
        },
      },
    });

    return res.json({
      token,
      customer: updated,
    });
  } catch (e: any) {
    console.error("CUSTOMER LOGIN ERROR:", e);
    return res.status(500).json({ message: e?.message ?? "Server error" });
  }
});

// Get current customer profile
app.get("/api/customers/me", async (req, res) => {
  try {
    const auth = await customerAuthRequired(req);
    if (!auth.ok) {
      return res.status(auth.status).json({ message: auth.message });
    }

    return res.json({ customer: auth.customer });
  } catch (e: any) {
    console.error("CUSTOMER ME ERROR:", e);
    return res.status(500).json({ message: e?.message ?? "Server error" });
  }
});

// Add customer address
app.post("/api/customers/addresses", async (req, res) => {
  try {
    const auth = await customerAuthRequired(req);
    if (!auth.ok) {
      return res.status(auth.status).json({ message: auth.message });
    }

    const label = req.body.label ? s(req.body.label) : "Home";
    const fullAddress = s(req.body.fullAddress);
    const city = req.body.city ? s(req.body.city) : null;
    const lat = asFloat(req.body.lat);
    const lng = asFloat(req.body.lng);
    const isDefault = Boolean(req.body.isDefault);

    if (!fullAddress) {
      return res.status(400).json({ message: "fullAddress is required" });
    }

    if (isDefault) {
      await prisma.customerAddress.updateMany({
        where: {
          customerId: auth.customer.id,
          isDefault: true,
        },
        data: {
          isDefault: false,
        },
      });
    }

    const address = await prisma.customerAddress.create({
      data: {
        customerId: auth.customer.id,
        label,
        fullAddress,
        city,
        lat,
        lng,
        isDefault,
      },
    });

    return res.json({ address });
  } catch (e: any) {
    console.error("CUSTOMER ADDRESS CREATE ERROR:", e);
    return res.status(500).json({ message: e?.message ?? "Server error" });
  }
});

// List customer addresses
app.get("/api/customers/addresses", async (req, res) => {
  try {
    const auth = await customerAuthRequired(req);
    if (!auth.ok) {
      return res.status(auth.status).json({ message: auth.message });
    }

    const addresses = await prisma.customerAddress.findMany({
      where: { customerId: auth.customer.id },
      orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
    });

    return res.json({ addresses });
  } catch (e: any) {
    console.error("CUSTOMER ADDRESSES ERROR:", e);
    return res.status(500).json({ message: e?.message ?? "Server error" });
  }
});

// ----------------------
// ORGANIC helpers
// ----------------------
async function requireOrganicPartnerApproved(req: express.Request) {
  const auth = await authRequired(req);
  if (!auth.ok) return auth;

  const partner = auth.partner;

  if (partner.role !== PartnerRole.ORGANIC_PARTNER) {
    return { ok: false as const, status: 403, message: "Only Organic Partner can access this." };
  }
  if (partner.status !== PartnerStatus.APPROVED) {
    return { ok: false as const, status: 403, message: "Account under review. Not approved yet." };
  }

  return { ok: true as const, partner };
}

async function ensureOrganicShop(partnerId: string) {
  const partner = await prisma.partner.findUnique({ where: { id: partnerId } });
  const shopName = partner?.businessName || partner?.fullName || "Organic Store";

  return prisma.organicShop.upsert({
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
app.get("/api/debug/register-source", (_req, res) => {
  return res.json({
    source: "src/server.ts",
    marker: "organic-fix-build",
  });
});

app.get("/", (req, res) => {
  res.status(200).json({ status: "ok", service: "imlocl-backend" });
});

app.get("/health", (req, res) => {
  res.status(200).json({ status: "healthy" });
});

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.post("/api/checkout/summary", async (req, res) => {
  try {
    const {
      serviceType,
      items = [],
      couponCode,
      city,
      subtotal: subtotalFromBody,
    } = req.body as {
      serviceType?: string;
      items?: Array<{ price?: number; quantity?: number }>;
      couponCode?: string;
      city?: string;
      subtotal?: number;
    };

    if (!serviceType) {
      return res.status(400).json({ message: "serviceType is required" });
    }

    const normalizedServiceType = String(serviceType).trim().toUpperCase();

    const subtotal =
      typeof subtotalFromBody === "number" && Number.isFinite(subtotalFromBody)
        ? subtotalFromBody
        : items.reduce((sum: number, item: { price?: number; quantity?: number }) => {
            const price = Number(item?.price ?? 0);
            const quantity = Number(item?.quantity ?? 0);
            return sum + price * quantity;
          }, 0);

    const fees = await prisma.serviceFeeConfig.findMany({
      where: {
        service_type: normalizedServiceType,
        is_active: true,
      },
      orderBy: {
        created_at: "asc",
      },
    });

    let packaging = 0;
    let delivery = 0;
    let handling = 0;
    let platform = 0;
    let lateNight = 0;
    let restaurantGst = 0;
    let gstOnDelivery = 0;
    let gstPercent = 0;

    for (const fee of fees) {
      const amount = toNumber(fee.amount);
      const feeCode = String(fee.fee_code ?? "").toUpperCase();
      const feeType = String(fee.fee_type ?? "").toUpperCase();

      switch (feeCode) {
        case "PACKAGING":
          packaging += amount;
          break;
        case "DELIVERY":
          delivery += amount;
          break;
        case "HANDLING":
          handling += amount;
          break;
        case "PLATFORM":
          platform += amount;
          break;
        case "LATE_NIGHT":
          lateNight += amount;
          break;
        case "RESTAURANT_GST":
          restaurantGst += amount;
          break;
        case "GST_ON_DELIVERY":
          gstOnDelivery += amount;
          break;
        case "GST":
          if (feeType === "PERCENTAGE") {
            gstPercent += amount;
          } else {
            restaurantGst += amount;
          }
          break;
        default:
          break;
      }
    }

    const preCouponTotal =
      subtotal +
      packaging +
      delivery +
      handling +
      platform +
      lateNight +
      restaurantGst +
      gstOnDelivery;

    let couponDiscount = 0;
    let appliedCoupon: any = null;

    if (couponCode) {
      const coupon = await prisma.coupon.findFirst({
        where: {
          code: String(couponCode).trim().toUpperCase(),
          is_active: true,
          OR: [
            { service_type: null },
            { service_type: normalizedServiceType },
          ],
        },
      });

      if (coupon) {
        const minOrderValue = toNumber(coupon.min_order_value);
        const discountValue = toNumber(coupon.discount_value);
        const maxDiscount = toNumber(coupon.max_discount);
        const discountType = String(coupon.discount_type ?? "").toUpperCase();

        if (subtotal >= minOrderValue) {
          if (discountType === "PERCENTAGE") {
            couponDiscount = (subtotal * discountValue) / 100;
          } else {
            couponDiscount = discountValue;
          }

          if (maxDiscount > 0) {
            couponDiscount = Math.min(couponDiscount, maxDiscount);
          }

          couponDiscount = Math.min(couponDiscount, preCouponTotal);
          appliedCoupon = coupon;
        }
      }
    }

    const afterCoupon = Math.max(preCouponTotal - couponDiscount, 0);
    const gstAmount = gstPercent > 0 ? (afterCoupon * gstPercent) / 100 : 0;
    const total = afterCoupon + gstAmount;

    return res.json({
      summary: {
        serviceType: normalizedServiceType,
        city: city ?? null,
        subtotal,
        charges: {
          packaging,
          delivery,
          handling,
          platform,
          lateNight,
          restaurantGst,
          gstOnDelivery,
          gstPercent,
          gstAmount,
        },
        coupon: appliedCoupon
          ? {
              code: appliedCoupon.code,
              description: appliedCoupon.description,
              discountType: appliedCoupon.discount_type,
              discountValue: toNumber(appliedCoupon.discount_value),
              discountAmount: couponDiscount,
            }
          : null,
        total,
      },
    });
  } catch (e: any) {
    console.error("CHECKOUT SUMMARY ERROR:", e);
    return res.status(500).json({ message: e?.message ?? "Server error" });
  }
});


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
app.post("/api/orders/:orderId/assign-delivery", async (_req, res) => {
  return res.status(501).json({
    message: "assign-delivery route is not implemented yet. Use /api/deliveries instead."
  });
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

// ✅ PUBLIC: list all approved + open organic stores (for customer app)
app.get("/api/public/organicstores", async (_req, res) => {
  try {
    const shops = await prisma.organicShop.findMany({
      where: {
        isOpen: true,
        partner: {
          role: PartnerRole.ORGANIC_PARTNER,
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
        imageUrl: it.imageUrl ?? null,
        category: it.category ?? null,
        isOrganic: it.isOrganic ?? true,
      })),
    }));

    return res.json({ shops: result });
  } catch (e: any) {
    console.error("PUBLIC ORGANIC STORES ERROR:", e);
    return res.status(500).json({ message: e?.message ?? "Server error" });
  }
});

// ✅ PUBLIC: get one organic store by id (for /organic-store/[id] page)
app.get("/api/public/organicstores/:id", async (req, res) => {
  try {
    const id = s(req.params.id);
    if (!id) return res.status(400).json({ message: "id is required" });

    const shop = await prisma.organicShop.findFirst({
      where: {
        id,
        partner: {
          role: PartnerRole.ORGANIC_PARTNER,
          status: PartnerStatus.APPROVED,
          isActive: true,
        },
      },
      include: {
        items: { orderBy: { createdAt: "desc" } },
        partner: true,
      },
    });

    if (!shop) return res.status(404).json({ message: "Organic store not found" });

    return res.json({
      shop: {
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
          imageUrl: it.imageUrl ?? null,
          category: it.category ?? null,
          isOrganic: it.isOrganic ?? true,
        })),
      },
    });
  } catch (e: any) {
    console.error("PUBLIC ORGANIC STORE BY ID ERROR:", e);
    return res.status(500).json({ message: e?.message ?? "Server error" });
  }
});

// ✅ Get my organic categories
app.get("/api/organicshop/categories", async (req, res) => {
  try {
    const gate = await requireOrganicPartnerApproved(req);
    if (!gate.ok) return res.status(gate.status).json({ message: gate.message });

    const shop = await ensureOrganicShop(gate.partner.id);

    const categories = await prisma.organicCategory.findMany({
      where: { organicShopId: shop.id },
      include: {
        items: {
          orderBy: { createdAt: "desc" },
        },
      },
      orderBy: { name: "asc" },
    });

    return res.json({ categories });
  } catch (e: any) {
    console.error("ORGANIC CATEGORIES ERROR:", e);
    return res.status(500).json({ message: e?.message ?? "Server error" });
  }
});

// ✅ Create category
app.post("/api/organicshop/categories", async (req, res) => {
  try {
    const gate = await requireOrganicPartnerApproved(req);
    if (!gate.ok) return res.status(gate.status).json({ message: gate.message });

    const shop = await ensureOrganicShop(gate.partner.id);
    const name = s(req.body.name);

    if (!name) {
      return res.status(400).json({ message: "Category name is required" });
    }

    const category = await prisma.organicCategory.create({
      data: {
        organicShopId: shop.id,
        name,
      },
    });

    return res.json({ category });
  } catch (e: any) {
    console.error("CREATE ORGANIC CATEGORY ERROR:", e);
    return res.status(500).json({ message: e?.message ?? "Server error" });
  }
});

app.get("/api/organicshop/orders", async (req, res) => {
  try {
    const gate = await requireOrganicPartnerApproved(req);
    if (!gate.ok) return res.status(gate.status).json({ message: gate.message });

    const shop = await prisma.organicShop.findUnique({
      where: { partnerId: gate.partner.id },
    });

    if (!shop) {
      return res.json({ orders: [] });
    }

    const orders = await prisma.customerOrder.findMany({
      where: {
        storeId: shop.id,
        storeType: "ORGANIC",
      },
      include: {
        items: true,
        statusHistory: {
          orderBy: { createdAt: "desc" },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const orderIds = orders.map((o) => o.id);

    const deliveries: any[] = orderIds.length
      ? ((await prisma.delivery.findMany({
          where: {
            orderId: { in: orderIds },
          },
        })) as any[])
      : [];

    const deliveryMap = new Map(deliveries.map((d: any) => [d.orderId, d]));

    const ordersWithDelivery = orders.map((order: any) => {
      const delivery = deliveryMap.get(order.id);

      return {
        ...order,
        deliveryId: delivery?.id ?? null,
        deliveryStatus: delivery?.status ?? null,
        pickupOtp: delivery?.pickupOtp ?? null,
        pickupOtpVerified: Boolean(delivery?.pickupOtpVerified),
      };
    });

    return res.json({ orders: ordersWithDelivery });
  } catch (e: any) {
    console.error("ORGANIC SHOP ORDERS ERROR:", e);
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

    // delivery extras
    const drivingLicense = req.body.drivingLicense ? s(req.body.drivingLicense) : null;
    const vehicleNumber = req.body.vehicleNumber ? s(req.body.vehicleNumber) : null;
    const vehicleType = req.body.vehicleType ? s(req.body.vehicleType) : null;
    const vehicleModel = req.body.vehicleModel ? s(req.body.vehicleModel) : null;

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

    // ✅ create deliveryPartner row also for delivery users
    if (role === PartnerRole.DELIVERY) {
      await ensureDeliveryPartnerProfile(created.id, {
        drivingLicense,
        vehicleNumber,
        vehicleType,
        vehicleModel,
      });
    }

    const fetched = await prisma.partner.findUnique({
      where: { id: created.id },
      include: {
        deliveryPartner: true,
        designerProfile: true,
        meatShop: true,
        organicShop: true,
        laundryShop: true,
      },
    });

    return res.json({
      debug: {
        receivedPartnerType: partnerType,
        mappedRoleBeforeInsert: role,
        createdRoleFromCreateResponse: created.role,
        fetchedRoleFromDb: fetched?.role ?? null,
        source: "src/server.ts",
      },
      partner: fetched,
    });
  } catch (e: any) {
    console.error("REGISTER ERROR:", e);
    return res.status(500).json({ message: e?.message ?? "Server error" });
  }
});

// ✅ LOGIN
// app.post("/api/auth/login", async (req, res) => {
//   try {
//     const phone = s(req.body.phone);
//     if (!phone) return res.status(400).json({ message: "phone is required" });

//     const partner = await prisma.partner.findFirst({ where: { phone } });
//     if (!partner) return res.status(404).json({ message: "Partner not found. Please register." });

//     const token = genToken();

//     const updated = await prisma.partner.update({
//       where: { id: partner.id },
//       data: { token },
//     });

//     return res.json({ token, partner: updated });
//   } catch (e: any) {
//     console.error("LOGIN ERROR:", e);
//     return res.status(500).json({ message: e?.message ?? "Server error" });
//   }
// });

app.post("/api/auth/login", async (req, res) => {
  try {
    const phone = s(req.body.phone);
    if (!phone) return res.status(400).json({ message: "phone is required" });

    const partner = await prisma.partner.findFirst({ where: { phone } });
    if (!partner) return res.status(404).json({ message: "Partner not found. Please register." });

    const token = genToken();

    await prisma.partner.update({
      where: { id: partner.id },
      data: { token },
    });

    // ✅ backfill missing deliveryPartner row for old users
    if (partner.role === PartnerRole.DELIVERY) {
      await ensureDeliveryPartnerProfile(partner.id);
    }

    const updatedPartner = await prisma.partner.findUnique({
      where: { id: partner.id },
      include: {
        deliveryPartner: true,
        designerProfile: true,
        meatShop: true,
        organicShop: true,
        laundryShop: true,
      },
    });

    return res.json({ token, partner: updatedPartner });
  } catch (e: any) {
    console.error("LOGIN ERROR:", e);
    return res.status(500).json({ message: e?.message ?? "Server error" });
  }
});


// ✅ ME (refresh status)
// app.get("/api/auth/me", async (req, res) => {
//   try {
//     const auth = await authRequired(req);
//     if (!auth.ok) return res.status(auth.status).json({ message: auth.message });

//     return res.json({ partner: auth.partner });
//   } catch (e: any) {
//     console.error("ME ERROR:", e);
//     return res.status(500).json({ message: e?.message ?? "Server error" });
//   }
// });

app.get("/api/auth/me", async (req, res) => {
  try {
    const auth = await authRequired(req);
    if (!auth.ok) return res.status(auth.status).json({ message: auth.message });

    // ✅ backfill missing deliveryPartner row for old users
    if (auth.partner.role === PartnerRole.DELIVERY) {
      await ensureDeliveryPartnerProfile(auth.partner.id);
    }

    const partner = await prisma.partner.findUnique({
      where: { id: auth.partner.id },
      include: {
        deliveryPartner: true,
        designerProfile: true,
        meatShop: true,
        organicShop: true,
        laundryShop: true,
      },
    });

    return res.json({ partner });
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

app.get("/api/meatshop/orders", async (req, res) => {
  try {
    const gate = await requireMeatPartnerApproved(req);
    if (!gate.ok) return res.status(gate.status).json({ message: gate.message });

    const shop = await prisma.meatShop.findUnique({
      where: { partnerId: gate.partner.id },
    });

    if (!shop) {
      return res.json({ orders: [] });
    }

    const orders = await prisma.customerOrder.findMany({
      where: {
        storeId: shop.id,
        storeType: "MEAT",
      },
      include: {
        items: true,
        statusHistory: {
          orderBy: { createdAt: "desc" },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    const orderIds = orders.map((o) => o.id);

    const deliveries: any[] = orderIds.length
      ? ((await prisma.delivery.findMany({
          where: {
            orderId: { in: orderIds },
          },
        })) as any[])
      : [];

    const deliveryMap = new Map(deliveries.map((d: any) => [d.orderId, d]));

    const ordersWithDelivery = orders.map((order: any) => {
      const delivery = deliveryMap.get(order.id);

      return {
        ...order,
        deliveryId: delivery?.id ?? null,
        deliveryStatus: delivery?.status ?? null,
        pickupOtp: delivery?.pickupOtp ?? null,
        pickupOtpVerified: Boolean(delivery?.pickupOtpVerified),
      };
    });

    return res.json({ orders: ordersWithDelivery });
  } catch (e: any) {
    console.error("MEAT SHOP ORDERS ERROR:", e);
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

// ----------------------
// ORGANIC SHOP APIs (ORGANIC_PARTNER + APPROVED only)
// ----------------------

// ✅ Get my organic shop + items
app.get("/api/organicshop/me", async (req, res) => {
  try {
    const gate = await requireOrganicPartnerApproved(req);
    if (!gate.ok) return res.status(gate.status).json({ message: gate.message });

    const shop = await prisma.organicShop.findUnique({
      where: { partnerId: gate.partner.id },
      include: {
        items: { orderBy: { createdAt: "desc" } },
        categories: {
          include: {
            items: { orderBy: { createdAt: "desc" } },
          },
          orderBy: { name: "asc" },
        },
      },
    });

    if (!shop) {
      return res.json({
        shop: null,
        categories: [],
        items: [],
        stats: {
          totalItems: 0,
          todaysOrders: 0,
          pendingOrders: 0,
          earningsToday: 0,
        },
      });
    }

    return res.json({
      shop: {
        id: shop.id,
        shopName: shop.shopName,
        city: shop.city,
        address: shop.address,
        isOpen: shop.isOpen,
      },
      categories: shop.categories,
      items: shop.items,
      stats: {
        totalItems: shop.items.length,
        todaysOrders: 0,
        pendingOrders: 0,
        earningsToday: 0,
      },
    });
  } catch (e: any) {
    console.error("ORGANICSHOP/ME ERROR:", e);
    return res.status(500).json({ message: e?.message ?? "Server error" });
  }
});

// ✅ Toggle store open/close
app.post("/api/organicshop/toggle", async (req, res) => {
  try {
    const gate = await requireOrganicPartnerApproved(req);
    if (!gate.ok) return res.status(gate.status).json({ message: gate.message });

    const isOpen = Boolean(req.body.isOpen);

    const shop = await prisma.organicShop.upsert({
      where: { partnerId: gate.partner.id },
      update: { isOpen },
      create: {
        partnerId: gate.partner.id,
        shopName: gate.partner.businessName || gate.partner.fullName || "Organic Store",
        isOpen,
      },
    });

    return res.json({ shop });
  } catch (e: any) {
    console.error("ORGANICSHOP/TOGGLE ERROR:", e);
    return res.status(500).json({ message: e?.message ?? "Server error" });
  }
});

// ✅ Add organic item (basic JSON version)
app.post("/api/organicshop/items", async (req, res) => {
  try {
    const gate = await requireOrganicPartnerApproved(req);
    if (!gate.ok) return res.status(gate.status).json({ message: gate.message });

    const shop = await ensureOrganicShop(gate.partner.id);

    const name = s(req.body.name);
    const unit = s(req.body.unit);
    const price = asFloat(req.body.price);
    const minQty = asFloat(req.body.minQty);
    const stepQty = asFloat(req.body.stepQty);
    const category = req.body.category ? s(req.body.category) : null;
    const description = req.body.description ? s(req.body.description) : null;
    const stock = req.body.stock !== undefined ? Number(req.body.stock) : null;
    const isAvailable = req.body.isAvailable !== undefined ? Boolean(req.body.isAvailable) : true;
    const organicCategoryId = req.body.organicCategoryId ? s(req.body.organicCategoryId) : null;

    if (!name || !unit || price === null) {
      return res.status(400).json({ message: "name, unit, price are required" });
    }

    const item = await prisma.organicItem.create({
      data: {
        organicShopId: shop.id,
        organicCategoryId,
        name,
        unit,
        price,
        minQty,
        stepQty,
        inStock: isAvailable,
        imageUrl: null,
        category,
        description,
        stock,
        isOrganic: true,
      },
    });

    return res.json({ item });
  } catch (e: any) {
    console.error("ORGANICSHOP/ITEMS CREATE ERROR:", e);
    return res.status(500).json({ message: e?.message ?? "Server error" });
  }
});

app.post("/api/organicshop/items/:id/image", upload.single("image"), async (req, res) => {
  try {
    const gate = await requireOrganicPartnerApproved(req);
    if (!gate.ok) {
      return res.status(gate.status).json({ message: gate.message });
    }

    const shop = await ensureOrganicShop(gate.partner.id);
    const id = s(req.params.id);

    const existing = await prisma.organicItem.findFirst({
      where: { id, organicShopId: shop.id },
    });

    if (!existing) {
      return res.status(404).json({ message: "Item not found" });
    }

    if (!req.file) {
      return res.status(400).json({ message: "Missing file field 'image'" });
    }

    const businessName =
      gate.partner.businessName ||
      shop.shopName ||
      gate.partner.fullName ||
      "Organic Store";

    const categoryName =
      existing.category ||
      "Uncategorized";

    const itemName =
      existing.name ||
      "Organic Item";

    // Upload to Azure Blob Storage
    const uploadResults = await uploadMultipleToAzure(
      [req.file],
      businessName,
      "Organic Store",
      categoryName,
      itemName
    );

    const imageUrl = uploadResults?.[0]?.url;

    if (!imageUrl) {
      throw new Error("Azure upload failed: image URL not returned");
    }

    const updated = await prisma.organicItem.update({
      where: { id },
      data: { imageUrl },
    });

    console.log(`✅ Organic item image uploaded to Azure: ${imageUrl}`);

    return res.json({ item: updated, imageUrl });
  } catch (e: any) {
    console.error("ORGANICSHOP/ITEM IMAGE UPLOAD ERROR:", e);
    return res.status(500).json({ message: e?.message ?? "Server error" });
  }
});

app.put("/api/organicshop/items/:id", async (req, res) => {
  try {
    const gate = await requireOrganicPartnerApproved(req);
    if (!gate.ok) return res.status(gate.status).json({ message: gate.message });

    const shop = await ensureOrganicShop(gate.partner.id);
    const id = s(req.params.id);

    const existing = await prisma.organicItem.findFirst({
      where: { id, organicShopId: shop.id },
    });

    if (!existing) {
      return res.status(404).json({ message: "Item not found" });
    }

    const data: any = {};
    if (req.body.name !== undefined) data.name = s(req.body.name);
    if (req.body.unit !== undefined) data.unit = s(req.body.unit);
    if (req.body.price !== undefined) data.price = Number(req.body.price);
    if (req.body.minQty !== undefined) data.minQty = asFloat(req.body.minQty);
    if (req.body.stepQty !== undefined) data.stepQty = asFloat(req.body.stepQty);
    if (req.body.category !== undefined) data.category = req.body.category ? s(req.body.category) : null;
    if (req.body.organicCategoryId !== undefined) data.organicCategoryId = req.body.organicCategoryId ? s(req.body.organicCategoryId) : null;
    if (req.body.description !== undefined) data.description = req.body.description ? s(req.body.description) : null;
    if (req.body.stock !== undefined) data.stock = req.body.stock === null ? null : Number(req.body.stock);
    if (req.body.inStock !== undefined) data.inStock = Boolean(req.body.inStock);

    const item = await prisma.organicItem.update({
      where: { id },
      data,
    });

    return res.json({ item });
  } catch (e: any) {
    console.error("ORGANICSHOP/ITEM UPDATE ERROR:", e);
    return res.status(500).json({ message: e?.message ?? "Server error" });
  }
});



app.put("/api/organicshop/categories/:id", async (req, res) => {
  try {
    const gate = await requireOrganicPartnerApproved(req);
    if (!gate.ok) return res.status(gate.status).json({ message: gate.message });

    const shop = await ensureOrganicShop(gate.partner.id);
    const id = s(req.params.id);
    const name = s(req.body.name);

    if (!name) {
      return res.status(400).json({ message: "Category name is required" });
    }

    const existing = await prisma.organicCategory.findFirst({
      where: { id, organicShopId: shop.id },
    });

    if (!existing) {
      return res.status(404).json({ message: "Category not found" });
    }

    const category = await prisma.organicCategory.update({
      where: { id },
      data: { name },
    });

    return res.json({ category });
  } catch (e: any) {
    console.error("ORGANIC CATEGORY UPDATE ERROR:", e);
    return res.status(500).json({ message: e?.message ?? "Server error" });
  }
});

app.delete("/api/organicshop/categories/:id", async (req, res) => {
  try {
    const gate = await requireOrganicPartnerApproved(req);
    if (!gate.ok) return res.status(gate.status).json({ message: gate.message });

    const shop = await ensureOrganicShop(gate.partner.id);
    const id = s(req.params.id);

    const existing = await prisma.organicCategory.findFirst({
      where: { id, organicShopId: shop.id },
      include: { items: true },
    });

    if (!existing) {
      return res.status(404).json({ message: "Category not found" });
    }

    if ((existing.items?.length || 0) > 0) {
      return res.status(400).json({
        message: "Cannot delete category because it still contains items",
      });
    }

    await prisma.organicCategory.delete({
      where: { id },
    });

    return res.json({ ok: true });
  } catch (e: any) {
    console.error("ORGANIC CATEGORY DELETE ERROR:", e);
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
        currentOrders: { lt: 3 },
        partner: {
          isActive: true,
          status: PartnerStatus.APPROVED,
          role: PartnerRole.DELIVERY,
        },
      },
      include: {
        partner: true,
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
        customerAddress: customerAddress || null,
        storeId: shop.id,
        storeName: shop.shopName,
        storeAddress: shop.address || null,
        status: "ASSIGNED",
        assignedAt: new Date(),
        estimatedPickupTime: calculatePickupTime(),
        estimatedDeliveryTime: calculateDeliveryTime(),
        items,
        totalAmount: Number(totalAmount),
      },
      include: {
        partner: {
          include: {
            partner: true,
          },
        },
      },
    });

    // Update partner's current orders count
    await prisma.deliveryPartner.update({
      where: { id: availablePartner.id },
      data: { currentOrders: { increment: 1 } },
    });

    // Notify via WebSocket
    io.emit("delivery-created", {
      deliveryId: delivery.id,
      status: delivery.status,
      partner: {
        name: delivery.partner.partner.fullName,
        phone: delivery.partner.partner.phone,
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
    const id = s(req.params.id);
    const status = s(req.body.status).toUpperCase();

    const gate = await requireDeliveryPartnerApproved(req);
    if (!gate.ok) {
      return res.status(gate.status).json({ message: gate.message });
    }

    const deliveryPartner = await prisma.deliveryPartner.findUnique({
      where: { partnerId: gate.partner.id },
    });

    if (!deliveryPartner) {
      return res.status(404).json({ message: "Delivery partner profile not found" });
    }

    const existingDelivery = await prisma.delivery.findFirst({
      where: {
        id,
        partnerId: deliveryPartner.id,
      },
    });

    if (!existingDelivery) {
      return res.status(404).json({ message: "Delivery not found" });
    }

    const allowedStatuses = [
      "ARRIVED_AT_STORE",
      "PICKED_UP",
      "DELIVERED",
      "FAILED",
      "CANCELLED",
    ];

    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({ message: "Invalid delivery status" });
    }

    const updateData: any = { status };

    if (status === "ARRIVED_AT_STORE") {
      updateData.arrivedAtStoreAt = new Date();
    }

    if (status === "PICKED_UP" && !(existingDelivery as any).pickupOtpVerified) {
      return res.status(400).json({
        message: "Pickup OTP must be verified before marking order as picked up",
      });
    }

    if (status === "DELIVERED") {
      updateData.deliveredAt = new Date();
    }

    const result = await prisma.$transaction(async (tx) => {
      const updatedDelivery = await tx.delivery.update({
        where: { id },
        data: updateData,
      });

      let updatedOrder: any = null;

      if (updatedDelivery.orderId) {
        if (status === "ARRIVED_AT_STORE") {
          updatedOrder = await tx.customerOrder.update({
            where: { id: updatedDelivery.orderId },
            data: {
              orderStatus: "RIDER_ARRIVED_AT_STORE",
              statusHistory: {
                create: {
                  status: "RIDER_ARRIVED_AT_STORE",
                  note: "Delivery partner arrived at the store",
                  actorType: "DELIVERY_PARTNER",
                  actorId: gate.partner.id,
                },
              },
            },
          });
        }

        if (status === "PICKED_UP") {
          updatedOrder = await tx.customerOrder.update({
            where: { id: updatedDelivery.orderId },
            data: {
              orderStatus: "PICKED_UP",
              statusHistory: {
                create: {
                  status: "PICKED_UP",
                  note: "Order is picked up and on the way to deliver",
                  actorType: "DELIVERY_PARTNER",
                  actorId: gate.partner.id,
                },
              },
            },
          });
        }

        if (status === "DELIVERED") {
          updatedOrder = await tx.customerOrder.update({
            where: { id: updatedDelivery.orderId },
            data: {
              orderStatus: "COMPLETED",
              deliveredAt: new Date(),
              statusHistory: {
                create: {
                  status: "COMPLETED",
                  note: "Order completed and delivered to customer",
                  actorType: "DELIVERY_PARTNER",
                  actorId: gate.partner.id,
                },
              },
            },
          });

          await tx.deliveryPartner.update({
            where: { id: deliveryPartner.id },
            data: {
              currentOrders: {
                decrement: 1,
              },
            },
          });
        }
      }

      return { updatedDelivery, updatedOrder };
    });

    const { updatedDelivery, updatedOrder } = result;

    io.to(`delivery-${updatedDelivery.id}`).emit("delivery-status-updated", {
      deliveryId: updatedDelivery.id,
      status: updatedDelivery.status,
      orderId: updatedDelivery.orderId,
      message:
        status === "PICKED_UP"
          ? "Order is picked up and on the way to deliver"
          : status === "DELIVERED"
          ? "Order completed successfully"
          : undefined,
    });

    if (updatedDelivery.orderId) {
      io.to(`order-${updatedDelivery.orderId}`).emit("order-status-updated", {
        orderId: updatedDelivery.orderId,
        orderStatus: updatedOrder?.orderStatus || status,
        deliveryStatus: updatedDelivery.status,
        message:
          status === "PICKED_UP"
            ? "Order is picked up and on the way to deliver"
            : status === "DELIVERED"
            ? "Order completed successfully"
            : undefined,
      });
    }

    if (updatedDelivery.storeId) {
      io.to(`store-${updatedDelivery.storeId}`).emit("store-order-updated", {
        orderId: updatedDelivery.orderId,
        orderStatus: updatedOrder?.orderStatus || status,
        deliveryStatus: updatedDelivery.status,
        storeCompleted: status === "PICKED_UP",
      });
    }

    if (updatedDelivery.orderId) {
      const order = await prisma.customerOrder.findUnique({
        where: { id: updatedDelivery.orderId },
        select: {
          id: true,
          customerPhone: true,
        },
      });

      if (order?.customerPhone) {
        const customer = await prisma.customer.findFirst({
          where: { phone: order.customerPhone },
          select: { id: true },
        });

        if (customer?.id) {
          io.to(`customer-${customer.id}`).emit("customer-order-status-updated", {
            orderId: updatedDelivery.orderId,
            orderStatus: updatedOrder?.orderStatus || status,
            deliveryStatus: updatedDelivery.status,
            title:
              status === "PICKED_UP"
                ? "Order Picked Up"
                : status === "DELIVERED"
                ? "Order Completed"
                : "Order Update",
            message:
              status === "PICKED_UP"
                ? "Order is picked up and on the way to deliver"
                : status === "DELIVERED"
                ? "Your order has been delivered successfully"
                : `Order status updated to ${status}`,
          });
        }
      }
    }

    return res.json({
      message:
        status === "PICKED_UP"
          ? "Order picked up successfully"
          : status === "DELIVERED"
          ? "Order completed successfully"
          : "Delivery status updated successfully",
      delivery: updatedDelivery,
      order: updatedOrder,
    });
  } catch (e: any) {
    console.error("DELIVERY STATUS UPDATE ERROR:", e);
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
          include: {
            partner: true,
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
      address,
      city,
      drivingLicense,
      vehicleNumber,
      vehicleType,
      vehicleModel,
    } = req.body;

    if (!fullName || !phone || !drivingLicense || !vehicleNumber || !vehicleType) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    const existingPartner = await prisma.partner.findFirst({
      where: { phone: s(phone) },
      include: { deliveryPartner: true },
    });

    if (existingPartner?.deliveryPartner) {
      return res.status(409).json({ message: "Delivery partner already registered" });
    }

    let partnerId = existingPartner?.id;

    if (!partnerId) {
      const createdPartner = await prisma.partner.create({
        data: {
          fullName: s(fullName),
          phone: s(phone),
          email: email ? s(email) : null,
          address: address ? s(address) : null,
          city: city ? s(city) : null,
          partnerType: "delivery_partner",
          role: PartnerRole.DELIVERY,
          status: PartnerStatus.PENDING,
          isActive: true,
        },
      });
      partnerId = createdPartner.id;
    }

    const deliveryPartner = await prisma.deliveryPartner.create({
      data: {
        partnerId,
        drivingLicense: s(drivingLicense),
        vehicleNumber: s(vehicleNumber),
        vehicleType,
        vehicleModel: vehicleModel ? s(vehicleModel) : null,
        isAvailable: true,
      },
      include: {
        partner: true,
      },
    });

    return res.json({ deliveryPartner });
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

// ✅ Get my deliveries (for logged-in delivery partner)
app.get("/api/delivery-partner/me/deliveries", async (req, res) => {
  try {
    const gate = await requireDeliveryPartnerApproved(req);
    if (!gate.ok) {
      return res.status(gate.status).json({ message: gate.message });
    }

    const deliveryPartner = await prisma.deliveryPartner.findUnique({
      where: { partnerId: gate.partner.id },
    });

    if (!deliveryPartner) {
      return res.json({ deliveries: [] });
    }

    const deliveries = await prisma.delivery.findMany({
      where: {
        partnerId: deliveryPartner.id,
      },
      orderBy: { assignedAt: "desc" },
    });

    const orderIds = deliveries
      .map((d) => d.orderId)
      .filter((id): id is string => Boolean(id));

    const orders = orderIds.length
      ? await prisma.customerOrder.findMany({
          where: {
            id: { in: orderIds },
          },
          select: {
            id: true,
            orderNumber: true,
          },
        })
      : [];

    const orderMap = new Map(orders.map((o) => [o.id, o.orderNumber]));

    const deliveriesWithOrderNumber = deliveries.map((delivery) => ({
      ...delivery,
      orderNumber: delivery.orderId ? orderMap.get(delivery.orderId) ?? null : null,
      pickupOtpVerified: Boolean((delivery as any).pickupOtpVerified),
    }));    

    return res.json({ deliveries: deliveriesWithOrderNumber });
  } catch (e: any) {
    console.error("GET MY DELIVERIES ERROR:", e);
    return res.status(500).json({ message: e?.message ?? "Server error" });
  }
});

// ✅ Get one delivery detail for logged-in delivery partner
app.get("/api/delivery-partner/me/deliveries/:id", async (req, res) => {
  try {
    const gate = await requireDeliveryPartnerApproved(req);
    if (!gate.ok) {
      return res.status(gate.status).json({ message: gate.message });
    }

    const deliveryPartner = await prisma.deliveryPartner.findUnique({
      where: { partnerId: gate.partner.id },
    });

    if (!deliveryPartner) {
      return res.status(404).json({ message: "Delivery partner profile not found" });
    }

    const id = s(req.params.id);

    const delivery = await prisma.delivery.findFirst({
      where: {
        id,
        partnerId: deliveryPartner.id,
      },
    });

    if (!delivery) {
      return res.status(404).json({ message: "Delivery not found" });
    }

    let orderNumber: string | null = null;

    if (delivery.orderId) {
      const order = await prisma.customerOrder.findUnique({
        where: { id: delivery.orderId },
        select: {
          orderNumber: true,
        },
      });

      orderNumber = order?.orderNumber ?? null;
    }

    return res.json({
      delivery: {
        ...delivery,
        orderNumber,
        pickupOtpVerified: Boolean((delivery as any).pickupOtpVerified),
      },
    });    
  } catch (e: any) {
    console.error("GET MY DELIVERY DETAIL ERROR:", e);
    return res.status(500).json({ message: e?.message ?? "Server error" });
  }
});

app.put("/api/deliveries/:id/verify-pickup-otp", async (req, res) => {
  try {
    const id = s(req.params.id);
    const otp = s(req.body.otp);

    const gate = await requireDeliveryPartnerApproved(req);
    if (!gate.ok) {
      return res.status(gate.status).json({ message: gate.message });
    }

    const deliveryPartner = await prisma.deliveryPartner.findUnique({
      where: { partnerId: gate.partner.id },
    });

    if (!deliveryPartner) {
      return res.status(404).json({ message: "Delivery partner profile not found" });
    }

    const delivery = await prisma.delivery.findFirst({
      where: {
        id,
        partnerId: deliveryPartner.id,
      },
    });

    if (!delivery) {
      return res.status(404).json({ message: "Delivery not found" });
    }

    if (!(delivery as any).pickupOtp) {
      return res.status(400).json({ message: "Pickup OTP not generated yet" });
    }

    if ((delivery as any).pickupOtp !== otp) {
      return res.status(400).json({ message: "Invalid pickup OTP" });
    }

    const updateOtpData: any = {
      pickupOtpVerified: true,
      pickupOtpVerifiedAt: new Date(),
    };
    
    const updated = await prisma.delivery.update({
      where: { id },
      data: updateOtpData,
    });    

    io.to(`delivery-${updated.id}`).emit("delivery-pickup-otp-verified", {
      deliveryId: updated.id,
      pickupOtpVerified: true,
    });

    io.to(`store-${updated.storeId}`).emit("store-order-updated", {
      orderId: updated.orderId,
      pickupOtpVerified: true,
      deliveryId: updated.id,
    });

    return res.json({
      message: "Pickup OTP verified successfully",
      delivery: updated,
    });
  } catch (e: any) {
    console.error("VERIFY PICKUP OTP ERROR:", e);
    return res.status(500).json({ message: e?.message ?? "Server error" });
  }
});

// ✅ Accept assigned delivery
app.put("/api/deliveries/:id/accept", async (req, res) => {
  try {
    const gate = await requireDeliveryPartnerApproved(req);
    if (!gate.ok) {
      return res.status(gate.status).json({ message: gate.message });
    }

    const deliveryPartner = await prisma.deliveryPartner.findUnique({
      where: { partnerId: gate.partner.id },
    });

    if (!deliveryPartner) {
      return res.status(404).json({ message: "Delivery partner profile not found" });
    }

    const id = s(req.params.id);

    const delivery = await prisma.delivery.findFirst({
      where: {
        id,
        partnerId: deliveryPartner.id,
      },
    });

    if (!delivery) {
      return res.status(404).json({ message: "Delivery not found" });
    }

    const updated = await prisma.delivery.update({
      where: { id },
      data: {
        status: DeliveryStatus.ON_THE_WAY_TO_STORE,
      },
    });

    if (updated.orderId) {
      await prisma.customerOrder.update({
        where: { id: updated.orderId },
        data: {
          orderStatus: "DELIVERY_ACCEPTED",
          statusHistory: {
            create: {
              status: "DELIVERY_ACCEPTED",
              note: "Delivery accepted by delivery partner",
              actorType: "DELIVERY_PARTNER",
              actorId: gate.partner.id,
            },
          },
        },
      });
    }

    io.to(`delivery-${updated.id}`).emit("delivery-status-updated", {
      deliveryId: updated.id,
      status: updated.status,
    });

    if (updated.orderId) {
      io.to(`order-${updated.orderId}`).emit("order-status-updated", {
        orderId: updated.orderId,
        orderStatus: "DELIVERY_ACCEPTED",
      });
    }

    return res.json({ delivery: updated });
  } catch (e: any) {
    console.error("ACCEPT DELIVERY ERROR:", e);
    return res.status(500).json({ message: e?.message ?? "Server error" });
  }
});

// ✅ Reject assigned delivery
app.put("/api/deliveries/:id/reject", async (req, res) => {
  try {
    const gate = await requireDeliveryPartnerApproved(req);
    if (!gate.ok) {
      return res.status(gate.status).json({ message: gate.message });
    }

    const reason = s(req.body.reason) || "Rejected by delivery partner";

    const deliveryPartner = await prisma.deliveryPartner.findUnique({
      where: { partnerId: gate.partner.id },
    });

    if (!deliveryPartner) {
      return res.status(404).json({ message: "Delivery partner profile not found" });
    }

    const id = s(req.params.id);

    const delivery = await prisma.delivery.findFirst({
      where: {
        id,
        partnerId: deliveryPartner.id,
      },
    });

    if (!delivery) {
      return res.status(404).json({ message: "Delivery not found" });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const cancelledDelivery = await tx.delivery.update({
        where: { id },
        data: {
          status: "CANCELLED",
        },
      });

      await tx.deliveryPartner.update({
        where: { id: deliveryPartner.id },
        data: {
          currentOrders: {
            decrement: 1,
          },
        },
      });

      if (cancelledDelivery.orderId) {
        await tx.customerOrder.update({
          where: { id: cancelledDelivery.orderId },
          data: {
            orderStatus: "READY_FOR_PICKUP",
            deliveryId: null,
            deliveryPartnerId: null,
            statusHistory: {
              create: {
                status: "DELIVERY_REJECTED",
                note: reason,
                actorType: "DELIVERY_PARTNER",
                actorId: gate.partner.id,
              },
            },
          },
        });
      }

      return cancelledDelivery;
    });

    io.to(`delivery-${updated.id}`).emit("delivery-status-updated", {
      deliveryId: updated.id,
      status: updated.status,
    });

    if (updated.orderId) {
      io.to(`order-${updated.orderId}`).emit("order-status-updated", {
        orderId: updated.orderId,
        orderStatus: "READY_FOR_PICKUP",
      });
    }

    return res.json({ delivery: updated });
  } catch (e: any) {
    console.error("REJECT DELIVERY ERROR:", e);
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
      designCount: 0,
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
    
    const fileName = `design-${Date.now()}-${req.file.originalname.replace(/\s+/g, "-")}`;
    const filePath = path.join(UPLOAD_DIR, fileName);
    
    fs.writeFileSync(filePath, req.file.buffer);
    
    const imageUrl = `${req.protocol}://${req.get("host")}/uploads/${fileName}`;
    
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

app.put("/api/orders/:id/store-accept", async (req, res) => {
  try {
    const orderId = s(req.params.id);

    const auth = await authRequired(req);
    if (!auth.ok) return res.status(auth.status).json({ message: auth.message });

    const isStorePartner =
      auth.partner.role === PartnerRole.MEAT_PARTNER ||
      auth.partner.role === PartnerRole.ORGANIC_PARTNER;

    if (!isStorePartner) {
      return res.status(403).json({ message: "Only store partners can access this order" });
    }

    const order = await prisma.customerOrder.findUnique({
      where: { id: orderId },
    });

    if (!order) return res.status(404).json({ message: "Order not found" });

    let ownedStore: any = null;
    if (auth.partner.role === PartnerRole.MEAT_PARTNER) {
      ownedStore = await prisma.meatShop.findUnique({ where: { partnerId: auth.partner.id } });
    } else {
      ownedStore = await prisma.organicShop.findUnique({ where: { partnerId: auth.partner.id } });
    }

    if (!ownedStore || ownedStore.id !== order.storeId) {
      return res.status(403).json({ message: "You cannot access this order" });
    }

    const updated = await prisma.customerOrder.update({
      where: { id: orderId },
      data: {
        orderStatus: "STORE_ACCEPTED",
        acceptedAt: new Date(),
        statusHistory: {
          create: {
            status: "STORE_ACCEPTED",
            note: "Order accepted by store",
            actorType: "STORE",
            actorId: auth.partner.id,
          },
        },
      },
      include: { items: true },
    });

    io.to(`order-${updated.id}`).emit("order-status-updated", {
      orderId: updated.id,
      orderStatus: updated.orderStatus,
    });

    io.to(`store-${updated.storeId}`).emit("store-order-updated", {
      orderId: updated.id,
      orderStatus: updated.orderStatus,
    });

    io.emit("customer-order-status-updated", {
      orderId: updated.id,
      orderStatus: updated.orderStatus,
    });


    return res.json({ order: updated });
  } catch (e: any) {
    console.error("STORE ACCEPT ORDER ERROR:", e);
    return res.status(500).json({ message: e?.message ?? "Server error" });
  }
});

app.put("/api/orders/:id/store-reject", async (req, res) => {
  try {
    const orderId = s(req.params.id);
    const reason = s(req.body.reason) || "Rejected by store";

    const auth = await authRequired(req);
    if (!auth.ok) return res.status(auth.status).json({ message: auth.message });

    const isStorePartner =
      auth.partner.role === PartnerRole.MEAT_PARTNER ||
      auth.partner.role === PartnerRole.ORGANIC_PARTNER;

    if (!isStorePartner) {
      return res.status(403).json({ message: "Only store partners can access this order" });
    }

    const order = await prisma.customerOrder.update({
      where: { id: orderId },
      data: {
        orderStatus: "STORE_REJECTED",
        rejectedAt: new Date(),
        statusHistory: {
          create: {
            status: "STORE_REJECTED",
            note: reason,
            actorType: "STORE",
            actorId: auth.partner.id,
          },
        },
      },
    });

    io.to(`order-${order.id}`).emit("order-status-updated", {
      orderId: order.id,
      orderStatus: order.orderStatus,
    });
    
    io.to(`store-${order.storeId}`).emit("store-order-updated", {
      orderId: order.id,
      orderStatus: order.orderStatus,
    });
    

    return res.json({ order });
  } catch (e: any) {
    console.error("STORE REJECT ORDER ERROR:", e);
    return res.status(500).json({ message: e?.message ?? "Server error" });
  }
});

app.put("/api/orders/:id/ready-for-pickup", async (req, res) => {
  try {
    const orderId = s(req.params.id);

    const auth = await authRequired(req);
    if (!auth.ok) return res.status(auth.status).json({ message: auth.message });

    const isStorePartner =
      auth.partner.role === PartnerRole.MEAT_PARTNER ||
      auth.partner.role === PartnerRole.ORGANIC_PARTNER;

    if (!isStorePartner) {
      return res.status(403).json({ message: "Only store partners can access this order" });
    }

    const order = await prisma.customerOrder.findUnique({
      where: { id: orderId },
      include: { items: true },
    });

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }
    
    const orderAny = order as any;

    if (orderAny.isScheduled && orderAny.scheduledFor) {
      const scheduledTime = new Date(orderAny.scheduledFor).getTime();
      const now = Date.now();
      const readyWindowMs = 45 * 60 * 1000;

      if (now < scheduledTime - readyWindowMs) {
        return res.status(400).json({
          message: "This is a scheduled order. It can only be marked ready closer to the scheduled delivery time.",
        });
      }
    }

    const availablePartner = await prisma.deliveryPartner.findFirst({
      where: {
        isAvailable: true,
        currentOrders: { lt: 3 },
        partner: {
          role: PartnerRole.DELIVERY,
          status: PartnerStatus.APPROVED,
          isActive: true,
        },
      },
      include: { partner: true },
    });

    if (!availablePartner) {
      const updated = await prisma.customerOrder.update({
        where: { id: orderId },
        data: {
          orderStatus: "READY_FOR_PICKUP",
          readyForPickupAt: new Date(),
          statusHistory: {
            create: {
              status: "READY_FOR_PICKUP",
              note: "Ready, but no delivery partner assigned yet",
              actorType: "STORE",
              actorId: auth.partner.id,
            },
          },
        },
      });

      return res.json({
        order: updated,
        message: "Order ready, but no delivery partner available right now",
      });
    }

    // ✅ Fetch real store address based on store type
    let storeAddress: string | null = null;

    if (order.storeType === "MEAT") {
      const meatShop = await prisma.meatShop.findUnique({
        where: { id: order.storeId },
      });
      storeAddress = meatShop?.address ?? null;
    } else if (order.storeType === "ORGANIC") {
      const organicShop = await prisma.organicShop.findUnique({
        where: { id: order.storeId },
      });
      storeAddress = organicShop?.address ?? null;
    }

    const pickupOtp = generate4DigitOtp();

    const deliveryCreateData: any = {
      orderId: order.id,
      partnerId: availablePartner.id,
      customerName: order.customerName,
      customerPhone: order.customerPhone,
      customerAddress: order.customerAddress,
      storeId: order.storeId,
      storeName: order.storeName,
      storeAddress: storeAddress,
      status: "ASSIGNED",
      assignedAt: new Date(),
      estimatedPickupTime: calculatePickupTime(),
      estimatedDeliveryTime: calculateDeliveryTime(),
      pickupOtp,
      pickupOtpVerified: false,
      items: order.items,
      totalAmount: Number(order.totalAmount),
    };
    
    const delivery = await prisma.delivery.create({
      data: deliveryCreateData,
      include: {
        partner: { include: { partner: true } },
      },
    });    

    await prisma.deliveryPartner.update({
      where: { id: availablePartner.id },
      data: { currentOrders: { increment: 1 } },
    });

    const updatedOrder = await prisma.customerOrder.update({
      where: { id: order.id },
      data: {
        orderStatus: "DELIVERY_ASSIGNED",
        readyForPickupAt: new Date(),
        deliveryId: delivery.id,
        deliveryPartnerId: availablePartner.id,
        statusHistory: {
          create: [
            {
              status: "READY_FOR_PICKUP",
              note: "Order is ready for pickup",
              actorType: "STORE",
              actorId: auth.partner.id,
            },
            {
              status: "DELIVERY_ASSIGNED",
              note: `Assigned to delivery partner ${availablePartner.partner.fullName}`,
              actorType: "SYSTEM",
            },
          ],
        },
      },
    });

    io.to(`order-${updatedOrder.id}`).emit("order-status-updated", {
      orderId: updatedOrder.id,
      orderStatus: updatedOrder.orderStatus,
      deliveryId: delivery.id,
    });

    io.to(`store-${updatedOrder.storeId}`).emit("store-order-updated", {
      orderId: updatedOrder.id,
      orderStatus: updatedOrder.orderStatus,
      deliveryId: delivery.id,
    });

    io.to(`delivery-partner-${availablePartner.id}`).emit("delivery-assigned", {
      orderId: updatedOrder.id,
      deliveryId: delivery.id,
      deliveryPartnerId: availablePartner.id,
      partnerName: availablePartner.partner.fullName,
      status: delivery.status,
    });

    return res.json({
      order: updatedOrder,
      delivery,
    });
  } catch (e: any) {
    console.error("READY FOR PICKUP ERROR:", e);
    return res.status(500).json({ message: e?.message ?? "Server error" });
  }
});

app.put("/api/orders/:id/cash-received", async (req, res) => {
  try {
    const orderId = s(req.params.id);

    const gate = await requireDeliveryPartnerApproved(req);
    if (!gate.ok) return res.status(gate.status).json({ message: gate.message });

    const deliveryPartner = await prisma.deliveryPartner.findUnique({
      where: { partnerId: gate.partner.id },
    });

    if (!deliveryPartner) {
      return res.status(404).json({ message: "Delivery partner profile not found" });
    }

    const order = await prisma.customerOrder.findUnique({
      where: { id: orderId },
    });

    if (!order) return res.status(404).json({ message: "Order not found" });

    if (order.deliveryPartnerId !== deliveryPartner.id) {
      return res.status(403).json({ message: "This order is not assigned to you" });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const updatedOrder = await tx.customerOrder.update({
        where: { id: orderId },
        data: {
          paymentStatus: "CASH_COLLECTED",
          orderStatus: "COMPLETED",
          cashCollectedAt: new Date(),
          statusHistory: {
            create: {
              status: "CASH_COLLECTED",
              note: "Cash collected from customer by delivery partner",
              actorType: "DELIVERY_PARTNER",
              actorId: gate.partner.id,
            },
          },
        },
      });

      await tx.orderPayment.updateMany({
        where: { order_id: orderId },
        data: {
          status: "CASH_COLLECTED",
          transaction_id: `COD-${Date.now()}`,
        },
      });

      return updatedOrder;
    });

    io.emit("payment-updated", {
      orderId: updated.id,
      paymentStatus: updated.paymentStatus,
      orderStatus: updated.orderStatus,
    });

    return res.json({
      message: "Cash received marked successfully",
      order: updated,
    });
  } catch (e: any) {
    console.error("CASH RECEIVED ERROR:", e);
    return res.status(500).json({ message: e?.message ?? "Server error" });
  }
});
// ----------------------
// start
// ----------------------
async function main() {
  await prisma.$connect();

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`✅ API running on http://0.0.0.0:${PORT}`);
    console.log(`🔌 WebSocket server running on ws://0.0.0.0:${PORT}`);
  });

  ensureContainerExists()
    .then(() => console.log("✅ Azure storage container ready"))
    .catch((err) => console.error("⚠️ Azure storage init failed:", err));
}

main().catch((err) => {
  console.error("❌ Failed to start server:", err);
  process.exit(1);
});