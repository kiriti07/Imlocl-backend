import { FastifyPluginAsync } from "fastify";
import { z } from "zod";

const PartnerType = z.enum([
  "laundry_store",
  "designer",
  "tailor",
  "meat_store",
  "cook",
  "delivery_partner",
]);

function mapTypeToRole(type: z.infer<typeof PartnerType>) {
  switch (type) {
    case "laundry_store": return "LAUNDRY_PARTNER";
    case "meat_store": return "MEAT_PARTNER";
    case "tailor": return "TAILOR";
    case "cook": return "COOK";
    case "delivery_partner": return "DELIVERY";
    case "designer": return "TAILOR"; // treat designer as tailor for now (or add DESIGNER role later)
  }
}

const partnersRoutes: FastifyPluginAsync = async (app) => {
  app.post("/partners/register", async (req, reply) => {
    const body = z.object({
      partnerType: PartnerType,
      fullName: z.string().min(1),
      phone: z.string().min(8),
      email: z.string().email().optional(),
      businessName: z.string().optional(),
      address: z.string().optional(),
      city: z.string().optional(),
      experience: z.string().optional(),
    }).parse(req.body);

    const role = mapTypeToRole(body.partnerType) as any;

    const partner = await app.prisma.partner.upsert({
      where: { phone: body.phone },
      create: {
        partnerType: body.partnerType,
        fullName: body.fullName,
        phone: body.phone,
        email: body.email,
        businessName: body.businessName,
        address: body.address,
        city: body.city,
        experience: body.experience,
        role,
      },
      update: {
        partnerType: body.partnerType,
        fullName: body.fullName,
        email: body.email ?? undefined,
        businessName: body.businessName ?? undefined,
        address: body.address ?? undefined,
        city: body.city ?? undefined,
        experience: body.experience ?? undefined,
        role,
        isActive: true,
      },
    });

    return reply.send(partner);
  });
};

export default partnersRoutes;
