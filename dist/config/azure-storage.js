"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.containerClient = void 0;
exports.ensureContainerExists = ensureContainerExists;
// src/config/azure-storage.ts
const storage_blob_1 = require("@azure/storage-blob");
const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
const containerName = process.env.AZURE_STORAGE_CONTAINER_NAME || "images";
if (!connectionString) {
    throw new Error("AZURE_STORAGE_CONNECTION_STRING is not set");
}
const blobServiceClient = storage_blob_1.BlobServiceClient.fromConnectionString(connectionString);
const containerClient = blobServiceClient.getContainerClient(containerName);
exports.containerClient = containerClient;
// Export the function directly
async function ensureContainerExists() {
    try {
        await containerClient.createIfNotExists(); // No access parameter = private container
        console.log(`Container "${containerName}" is ready (private access)`);
    }
    catch (error) {
        console.error("Error creating container:", error);
        throw error;
    }
}
//# sourceMappingURL=azure-storage.js.map