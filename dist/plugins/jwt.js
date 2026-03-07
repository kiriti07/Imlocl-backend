"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fastify_plugin_1 = __importDefault(require("fastify-plugin"));
const jwt_1 = __importDefault(require("@fastify/jwt"));
exports.default = (0, fastify_plugin_1.default)(async (app) => {
    app.register(jwt_1.default, {
        secret: process.env.JWT_SECRET || "dev_secret_change_me",
    });
    app.decorate("auth", async (request, reply) => {
        try {
            await request.jwtVerify();
        }
        catch (err) {
            reply.code(401).send({ message: "Unauthorized" });
        }
    });
});
//# sourceMappingURL=jwt.js.map