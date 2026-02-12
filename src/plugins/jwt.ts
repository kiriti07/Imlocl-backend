import fp from "fastify-plugin";
import jwt from "@fastify/jwt";

export default fp(async (app) => {
  app.register(jwt, {
    secret: process.env.JWT_SECRET || "dev_secret_change_me",
  });

  app.decorate("auth", async (request: any, reply: any) => {
    try {
      await request.jwtVerify();
    } catch (err) {
      reply.code(401).send({ message: "Unauthorized" });
    }
  });
});

declare module "fastify" {
  interface FastifyInstance {
    auth: any;
  }
}
