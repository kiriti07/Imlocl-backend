"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const zod_1 = require("zod");
const PartnerType = zod_1.z.enum([
    "laundry_store",
    "designer",
    "tailor",
    "meat_store",
    "organic_store", // ✅ ADD THIS
    "cook",
    "delivery_partner",
]);
function mapTypeToRole(type) {
    switch (type) {
        case "laundry_store": return "LAUNDRY_PARTNER";
        case "meat_store": return "MEAT_PARTNER";
        case "organic_store": return "ORGANIC_PARTNER"; // ✅ ADD THIS
        case "tailor": return "TAILOR";
        case "cook": return "COOK";
        case "delivery_partner": return "DELIVERY";
        case "designer": return "TAILOR"; // treat designer as tailor for now
    }
}
const partnersRoutes = async (app) => {
    app.post("/partners/register", async (req, reply) => {
        const body = zod_1.z.object({
            partnerType: PartnerType,
            fullName: zod_1.z.string().min(1),
            phone: zod_1.z.string().min(8),
            email: zod_1.z.string().email().optional(),
            businessName: zod_1.z.string().optional(),
            address: zod_1.z.string().optional(),
            city: zod_1.z.string().optional(),
            experience: zod_1.z.string().optional(),
        }).parse(req.body);
        const role = mapTypeToRole(body.partnerType);
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
exports.default = partnersRoutes;
//# sourceMappingURL=partners.js.map