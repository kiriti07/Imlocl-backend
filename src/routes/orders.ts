// This file is not currently used. Order creation is handled in server.ts
// Keeping this file for potential future Fastify migration

import { FastifyPluginAsync } from "fastify";

const ordersRoutes: FastifyPluginAsync = async (app) => {
  // TODO: Migrate order routes from server.ts to Fastify
  app.get("/orders/health", async () => {
    return { status: "ok", message: "Orders routes placeholder" };
  });
};

export default ordersRoutes;