import { FastifyPluginAsync } from "fastify";

const ordersRoutes: FastifyPluginAsync = async (app) => {
  app.get("/orders/health", async () => {
    return { status: "ok", message: "Orders routes placeholder" };
  });
};

export default ordersRoutes;