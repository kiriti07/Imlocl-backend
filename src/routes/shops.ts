import { FastifyPluginAsync } from "fastify";
import { z } from "zod";

const shopsRoutes: FastifyPluginAsync = async (app) => {
  // Create/update Laundry shop for a partner
  app.post("/laundry/shops", async (req, reply) => {
    const body = z.object({
      partnerId: z.string().uuid(),
      shopName: z.string().min(2),
      address: z.string().optional(),
      city: z.string().optional(),
      lat: z.number().optional(),
      lng: z.number().optional(),
      isOpen: z.boolean().optional(),
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
    const { city } = z.object({ city: z.string().optional() }).parse(req.query);
    return app.prisma.laundryShop.findMany({
      where: city ? { city } : undefined,
      orderBy: { createdAt: "desc" },
    });
  });

  // Create/update Meat shop for a partner
  app.post("/meat/shops", async (req, reply) => {
    const body = z.object({
      partnerId: z.string().uuid(),
      shopName: z.string().min(2),
      address: z.string().optional(),
      city: z.string().optional(),
      lat: z.number().optional(),
      lng: z.number().optional(),
      isOpen: z.boolean().optional(),
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
    const { city } = z.object({ city: z.string().optional() }).parse(req.query);
    return app.prisma.meatShop.findMany({
      where: city ? { city } : undefined,
      orderBy: { createdAt: "desc" },
    });
  });
};

export default shopsRoutes;
