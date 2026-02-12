import { FastifyPluginAsync } from "fastify";
import { z } from "zod";

const authRoutes: FastifyPluginAsync = async (app) => {
  // Phone-only login for MVP
  app.post("/auth/login", async (req, reply) => {
    const body = z.object({
      phone: z.string().min(8),
    }).parse(req.body);

    const partner = await app.prisma.partner.findUnique({
      where: { phone: body.phone },
      include: { laundryShop: true, meatShop: true },
    });

    if (!partner) {
      return reply.code(404).send({ message: "Partner not found. Please register first." });
    }

    const token = app.jwt.sign({ partnerId: partner.id });
    return reply.send({ token, partner });
  });

  // Current logged-in partner
  app.get("/auth/me", { preHandler: [app.auth] }, async (req: any) => {
    const partnerId = req.user.partnerId as string;

    const partner = await app.prisma.partner.findUnique({
      where: { id: partnerId },
      include: { laundryShop: true, meatShop: true },
    });

    return { partner };
  });
};

export default authRoutes;
