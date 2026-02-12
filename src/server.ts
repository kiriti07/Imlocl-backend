import "dotenv/config";
import express from "express";
import cors from "cors";
import { PrismaClient, PartnerRole, PartnerStatus } from "@prisma/client";

const app = express();
const prisma = new PrismaClient();

app.use(cors());
app.use(express.json());

function mapPartnerTypeToRole(partnerType: string): PartnerRole {
  switch (partnerType) {
    case "laundry_store":
      return PartnerRole.LAUNDRY_PARTNER;
    case "meat_store":
      return PartnerRole.MEAT_PARTNER;
    case "tailor":
      return PartnerRole.TAILOR;
    case "designer":
      // you don't have DESIGNER enum → map to TAILOR for now
      return PartnerRole.TAILOR;
    case "cook":
      return PartnerRole.COOK;
    case "delivery_partner":
      return PartnerRole.DELIVERY;
    default:
      return PartnerRole.TAILOR;
  }
}

// ✅ health
app.get("/api/health", (_req, res) => res.json({ ok: true }));

// ✅ register
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
      return res.status(400).json({
        message: "partnerType, fullName, phone are required",
      });
    }

    const role = mapPartnerTypeToRole(String(partnerType));

    // If already exists → return conflict
    const existing = await prisma.partner.findUnique({
      where: { phone: String(phone) },
    });

    if (existing) {
      return res.status(409).json({
        message: "Phone already registered. Please login.",
      });
    }

    const partner = await prisma.partner.create({
      data: {
        phone: String(phone),

        // ✅ REQUIRED by your Prisma model (based on your error)
        partnerType: String(partnerType),
        fullName: String(fullName),

        // ✅ REQUIRED by your Prisma model
        role,
        status: PartnerStatus.PENDING,

        // Optional fields (safe to pass, Prisma ignores if not in schema ONLY if you don't cast any)
        email: email ?? null,
        businessName: businessName ?? null,
        address: address ?? null,
        city: city ?? null,
        experience: experience ?? null,
      },
    });

    return res.json({ partner });
  } catch (e: any) {
    console.error("REGISTER ERROR:", e);
    return res.status(500).json({ message: e?.message ?? "Server error" });
  }
});

// ✅ login (phone-only for now)
app.post("/api/auth/login", async (req, res) => {
  try {
    const { phone } = req.body ?? {};
    if (!phone) return res.status(400).json({ message: "Phone is required" });

    const partner = await prisma.partner.findUnique({
      where: { phone: String(phone) },
    });

    if (!partner) return res.status(404).json({ message: "Partner not found" });

    // TEMP token (replace with JWT later)
    const token = `partner-${partner.id}`;
    return res.json({ token, partner });
  } catch (e: any) {
    console.error("LOGIN ERROR:", e);
    return res.status(500).json({ message: e?.message ?? "Server error" });
  }
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
