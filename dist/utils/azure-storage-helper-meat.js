"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateMeatItemBlobName = generateMeatItemBlobName;
exports.uploadMeatItemImage = uploadMeatItemImage;
exports.uploadMultipleMeatItemImages = uploadMultipleMeatItemImages;
// src/utils/azure-storage-helper-meat.ts
const azure_storage_1 = require("../config/azure-storage");
const crypto_1 = __importDefault(require("crypto"));
/**
 * Generate a blob name for meat shop items
 * Format: meat-shops/{shopName}/{itemName}/{filename}
 */
function generateMeatItemBlobName(shopName, itemName, originalFilename) {
    // Sanitize folder names (replace spaces with underscores, remove special chars)
    const sanitize = (str) => str.replace(/[^a-zA-Z0-9]/g, '_').replace(/\s+/g, '_');
    const safeShopName = sanitize(shopName);
    const safeItemName = sanitize(itemName);
    // Generate unique filename
    const ext = originalFilename.split('.').pop() || 'jpg';
    const uniqueFilename = `${crypto_1.default.randomUUID()}.${ext}`;
    return `meat-shops/${safeShopName}/${safeItemName}/${uniqueFilename}`;
}
/**
 * Upload a single meat item image to Azure Blob Storage
 */
async function uploadMeatItemImage(fileBuffer, shopName, itemName, originalFilename) {
    try {
        const blobName = generateMeatItemBlobName(shopName, itemName, originalFilename);
        const blockBlobClient = azure_storage_1.containerClient.getBlockBlobClient(blobName);
        // Upload the file
        await blockBlobClient.uploadData(fileBuffer, {
            blobHTTPHeaders: {
                blobContentType: `image/${originalFilename.split('.').pop()}`,
            },
        });
        const url = blockBlobClient.url;
        console.log(`✅ Meat item image uploaded to Azure: ${url}`);
        return { blobName, url };
    }
    catch (error) {
        console.error("Error uploading to Azure:", error);
        throw error;
    }
}
/**
 * Upload multiple meat item images to Azure Blob Storage
 */
async function uploadMultipleMeatItemImages(files, shopName, itemName) {
    const uploadPromises = files.map(file => uploadMeatItemImage(file.buffer, shopName, itemName, file.originalname));
    return Promise.all(uploadPromises);
}
//# sourceMappingURL=azure-storage-helper-meat.js.map