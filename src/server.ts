// server.ts
import "dotenv/config";
import express from "express";
import cors from "cors";
import { PrismaClient, PartnerRole, PartnerStatus } from "@prisma/client";
import crypto from "crypto";
import multer from "multer";
import path from "path";
import fs from "fs";

const app = express();
const prisma = new PrismaClient();

app.use(cors());
app.use(express.json());

const PORT = Number(process.env.PORT || 8080);

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
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase() || ".jpg";
    cb(null, `${crypto.randomUUID()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
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
app.post("/api/meatshop/items", async (req, res) => {
  try {
    const gate = await requireMeatPartnerApproved(req);
    if (!gate.ok) return res.status(gate.status).json({ message: gate.message });

    const shop = await ensureMeatShop(gate.partner.id);

    const name = s(req.body.name);
    const unit = s(req.body.unit); // "kg" | "g" | "piece"
    const price = asFloat(req.body.price);

    const minQty = asFloat(req.body.minQty);
    const stepQty = asFloat(req.body.stepQty);

    if (!name || !unit || price === null) {
      return res.status(400).json({ message: "name, unit, price are required" });
    }

    const item = await prisma.meatItem.create({
      data: {
        meatShopId: shop.id,
        name,
        unit,
        price,
        minQty,
        stepQty,
        inStock: true,
      },
    });

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
// ✅ ITEM IMAGE UPLOAD (MEAT_PARTNER + APPROVED only)
// ----------------------
// Upload image for an item you own
// FormData field name must be: "image"
app.post("/api/meatshop/items/:id/image", upload.single("image"), async (req, res) => {
  try {
    const gate = await requireMeatPartnerApproved(req);
    if (!gate.ok) return res.status(gate.status).json({ message: gate.message });

    const shop = await ensureMeatShop(gate.partner.id);
    const id = s(req.params.id);

    const existing = await prisma.meatItem.findFirst({
      where: { id, meatShopId: shop.id },
    });
    if (!existing) return res.status(404).json({ message: "Item not found" });

    if (!req.file) return res.status(400).json({ message: "Missing file field 'image'" });

    // Public URL (customer app can view)
    const imageUrl = `http://localhost:${PORT}/uploads/${req.file.filename}`;

    const updated = await prisma.meatItem.update({
      where: { id },
      data: { imageUrl },
    });

    return res.json({ item: updated, imageUrl });
  } catch (e: any) {
    console.error("MEATSHOP/ITEM IMAGE UPLOAD ERROR:", e);
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
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`✅ API running on http://localhost:${PORT}`);
    console.log(`🖼️ Uploads served at http://localhost:${PORT}/uploads/<file>`);
    console.log(`📁 Upload folder: ${UPLOAD_DIR}`);
  });
}

main().catch((err) => {
  console.error("❌ Failed to start server:", err);
  process.exit(1);
});
