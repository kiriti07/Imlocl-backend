"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const zod_1 = require("zod");
const shopsRoutes = async (app) => {
    // Create/update Laundry shop for a partner
    app.post("/laundry/shops", async (req, reply) => {
        const body = zod_1.z.object({
            partnerId: zod_1.z.string().uuid(),
            shopName: zod_1.z.string().min(2),
            address: zod_1.z.string().optional(),
            city: zod_1.z.string().optional(),
            lat: zod_1.z.number().optional(),
            lng: zod_1.z.number().optional(),
            isOpen: zod_1.z.boolean().optional(),
        }).parse(req.body);
        const shop = await app.prisma.laundryShop.upsert({
            where: { partnerId: body.partnerId },
            create: {
                partnerId: body.partnerId,
                shopName: body.shopName,
                address: body.address,
                city: body.city,
                lat: body.lat,
                lng: body.lng,
                isOpen: body.isOpen ?? true,
            },
            update: {
                shopName: body.shopName,
                address: body.address ?? undefined,
                city: body.city ?? undefined,
                lat: body.lat ?? undefined,
                lng: body.lng ?? undefined,
                isOpen: body.isOpen ?? undefined,
            },
        });
        return reply.send(shop);
    });
    // List laundry shops by city
    app.get("/laundry/shops", async (req) => {
        const { city } = zod_1.z.object({ city: zod_1.z.string().optional() }).parse(req.query);
        return app.prisma.laundryShop.findMany({
            where: city ? { city } : undefined,
            orderBy: { createdAt: "desc" },
        });
    });
    // Create/update Meat shop for a partner
    app.post("/meat/shops", async (req, reply) => {
        const body = zod_1.z.object({
            partnerId: zod_1.z.string().uuid(),
            shopName: zod_1.z.string().min(2),
            address: zod_1.z.string().optional(),
            city: zod_1.z.string().optional(),
            lat: zod_1.z.number().optional(),
            lng: zod_1.z.number().optional(),
            isOpen: zod_1.z.boolean().optional(),
        }).parse(req.body);
        const shop = await app.prisma.meatShop.upsert({
            where: { partnerId: body.partnerId },
            create: {
                partnerId: body.partnerId,
                shopName: body.shopName,
                address: body.address,
                city: body.city,
                lat: body.lat,
                lng: body.lng,
                isOpen: body.isOpen ?? true,
            },
            update: {
                shopName: body.shopName,
                address: body.address ?? undefined,
                city: body.city ?? undefined,
                lat: body.lat ?? undefined,
                lng: body.lng ?? undefined,
                isOpen: body.isOpen ?? undefined,
            },
        });
        return reply.send(shop);
    });
    // List meat shops by city
    app.get("/meat/shops", async (req) => {
        const { city } = zod_1.z.object({ city: zod_1.z.string().optional() }).parse(req.query);
        return app.prisma.meatShop.findMany({
            where: city ? { city } : undefined,
            orderBy: { createdAt: "desc" },
        });
    });
};
exports.default = shopsRoutes;
//# sourceMappingURL=shops.js.map