// src/config/azure-storage.ts
import { BlobServiceClient } from "@azure/storage-blob";

const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
const containerName = process.env.AZURE_STORAGE_CONTAINER_NAME || "images";

if (!connectionString) {
  throw new Error("AZURE_STORAGE_CONNECTION_STRING is not set");
}

const blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
const containerClient = blobServiceClient.getContainerClient(containerName);

// Export the function directly
export async function ensureContainerExists() {
  try {
    await containerClient.createIfNotExists(); // No access parameter = private container
    console.log(`Container "${containerName}" is ready (private access)`);
  } catch (error) {
    console.error("Error creating container:", error);
    throw error;
  }
}

export { containerClient };