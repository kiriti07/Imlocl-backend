import "dotenv/config";
import express from "express";
import cors from "cors";
import crypto from "crypto";
import { PrismaClient, PartnerRole, PartnerStatus } from "@prisma/client";

const app = express();
const prisma = new PrismaClient();

app.use(cors());
app.use(express.json());

// --------------------
// In-memory sessions (DEV ONLY)
// token -> partnerId
// NOTE: backend restart clears this map; user must login again.
// --------------------
const sessions = new Map<string, string>();

function getBearerToken(req: express.Request) {
  const h = req.headers.authorization || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m?.[1] ?? null;
}

function pickEnumValue<T extends Record<string, any>>(enumObj: T, preferred: string[], fallback?: string) {
  for (const k of preferred) {
    if (k in enumObj) return enumObj[k];
  }
  // fallback to provided
  if (fallback && fallback in enumObj) return enumObj[fallback];
  // fallback to first enum value
  const keys = Object.keys(enumObj);
  return enumObj[keys[0]];
}

// PartnerType (from app) -> Role (from prisma enum)
function mapPartnerTypeToRole(partnerType: string) {
  const pt = String(partnerType || "").toLowerCase();

  // adjust these based on your actual PartnerRole enum values
  if (pt === "designer") {
    return pickEnumValue(PartnerRole as any, ["DESIGNER", "TAILOR", "STITCHING"], "TAILOR");
  }
  if (pt === "laundry") {
    return pickEnumValue(PartnerRole as any, ["LAUNDRY", "LAUNDRY_PARTNER"], "LAUNDRY");
  }
  if (pt === "meat") {
    return pickEnumValue(PartnerRole as any, ["MEAT", "MEAT_PARTNER"], "MEAT");
  }
  if (pt === "delivery") {
    return pickEnumValue(PartnerRole as any, ["DELIVERY", "DRIVER"], "DELIVERY");
  }

  // default role
  return pickEnumValue(PartnerRole as any, ["PARTNER", "TAILOR"], "PARTNER");
}

// --------------------
// Health
// --------------------
app.get("/api/health", (_req, res) => res.json({ ok: true }));

// --------------------
// Register
// --------------------
app.post("/api/partners/register", async (req, res) => {
  try {
    console.log("REGISTER BODY:", req.body);

    const {
      partnerType,
      fullName,
      phone,
      email,
      businessName,
      address,
      city,
      experience,
    } = req.body ?? {};

    if (!partnerType || !fullName || !phone) {
      return res.status(400).json({ message: "partnerType, fullName, phone are required" });
    }

    // prevent duplicates
    const exists = await prisma.partner.findUnique({ where: { phone: String(phone) } });
    if (exists) {
      return res.status(409).json({ message: "Phone already registered. Please login." });
    }

    const role = mapPartnerTypeToRole(String(partnerType));
    const status = pickEnumValue(PartnerStatus as any, ["PENDING"], "PENDING");

    // Your DB seems to have: partnerType + name (not fullName)
    const partner = await prisma.partner.create({
      data: {
        phone: String(phone),
        partnerType: String(partnerType),
        name: String(fullName),

        role,
        status,

        email: email ? String(email) : null,
        businessName: businessName ? String(businessName) : null,
        address: address ? String(address) : null,
        city: city ? String(city) : null,
        experience: experience ? String(experience) : null,
      } as any,
    });

    return res.json(partner);
  } catch (e: any) {
    console.error("REGISTER ERROR:", e);
    return res.status(500).json({ message: e?.message ?? "Server error" });
  }
});

// --------------------
// Login
// --------------------
app.post("/api/auth/login", async (req, res) => {
  try {
    const { phone } = req.body ?? {};
    if (!phone) return res.status(400).json({ message: "phone is required" });

    const partner = await prisma.partner.findUnique({
      where: { phone: String(phone) },
    });

    if (!partner) {
      return res.status(404).json({ message: "Partner not found. Please register first." });
    }

    const token = crypto.randomUUID();
    sessions.set(token, String(partner.id));

    return res.json({ token, partner });
  } catch (e: any) {
    console.error("LOGIN ERROR:", e);
    return res.status(500).json({ message: e?.message ?? "Server error" });
  }
});

// --------------------
// ME (refresh latest profile + status)
// --------------------
app.get("/api/auth/me", async (req, res) => {
  try {
    const token = getBearerToken(req);
    if (!token) return res.status(401).json({ message: "Missing Authorization Bearer token" });

    const partnerId = sessions.get(token);
    if (!partnerId) {
      return res.status(401).json({
        message: "Session expired (DEV token store resets on backend restart). Please login again.",
      });
    }

    const partner = await prisma.partner.findUnique({
      where: { id: partnerId as any },
    });

    if (!partner) return res.status(404).json({ message: "Partner not found" });

    // ✅ returns latest status from DB (so Prisma Studio change reflects)
    return res.json({ partner });
  } catch (e: any) {
    console.error("ME ERROR:", e);
    return res.status(500).json({ message: e?.message ?? "Server error" });
  }
});

// --------------------
// Logout
// --------------------
app.post("/api/auth/logout", async (req, res) => {
  const token = getBearerToken(req);
  if (token) sessions.delete(token);
  return res.json({ ok: true });
});

async function main() {
  await prisma.$connect();

  const port = Number(process.env.PORT || 8080);
  app.listen(port, "0.0.0.0", () => {
    console.log(`✅ API running on http://localhost:${port}`);
  });
}

main().catch((err) => {
  console.error("❌ Failed to start server:", err);
  process.exit(1);
});
