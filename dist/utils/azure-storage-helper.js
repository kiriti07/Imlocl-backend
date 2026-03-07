"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateBlobName = generateBlobName;
exports.uploadToAzure = uploadToAzure;
exports.uploadMultipleToAzure = uploadMultipleToAzure;
// src/utils/azure-storage-helper.ts
const azure_storage_1 = require("../config/azure-storage");
const storage_blob_1 = require("@azure/storage-blob");
const crypto_1 = __importDefault(require("crypto"));
const accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME || "";
const accountKey = process.env.AZURE_STORAGE_ACCOUNT_KEY || "";
const sharedKeyCredential = new storage_blob_1.StorageSharedKeyCredential(accountName, accountKey);
function generateSasToken(blobName) {
    const startDate = new Date();
    const expiryDate = new Date();
    expiryDate.setFullYear(expiryDate.getFullYear() + 1);
    const sasOptions = {
        containerName: azure_storage_1.containerClient.containerName,
        blobName,
        startsOn: startDate,
        expiresOn: expiryDate,
        permissions: storage_blob_1.BlobSASPermissions.parse("r"),
        protocol: storage_blob_1.SASProtocol.Https,
    };
    return (0, storage_blob_1.generateBlobSASQueryParameters)(sasOptions, sharedKeyCredential).toString();
}
function generateBlobName(businessName, categoryName, subcategoryName, itemName, originalFilename) {
    const sanitize = (str) => str.replace(/[^a-zA-Z0-9]/g, "_");
    const safeBusiness = sanitize(businessName);
    const safeCategory = sanitize(categoryName);
    const safeSubcategory = sanitize(subcategoryName);
    const safeItem = sanitize(itemName);
    const ext = originalFilename.split(".").pop() || "jpg";
    const uniqueFilename = `${crypto_1.default.randomUUID()}.${ext}`;
    return `${safeBusiness}/${safeCategory}/${safeSubcategory}/${safeItem}/${uniqueFilename}`;
}
async function uploadToAzure(fileBuffer, businessName, categoryName, subcategoryName, itemName, originalFilename) {
    const blobName = generateBlobName(businessName, categoryName, subcategoryName, itemName, originalFilename);
    const blockBlobClient = azure_storage_1.containerClient.getBlockBlobClient(blobName);
    const ext = originalFilename.split(".").pop()?.toLowerCase() || "jpg";
    const contentType = ext === "png"
        ? "image/png"
        : ext === "webp"
            ? "image/webp"
            : ext === "gif"
                ? "image/gif"
                : "image/jpeg";
    await blockBlobClient.uploadData(fileBuffer, {
        blobHTTPHeaders: {
            blobContentType: contentType,
        },
    });
    const sasToken = generateSasToken(blobName);
    const sasUrl = `${blockBlobClient.url}?${sasToken}`;
    return {
        blobName,
        url: blockBlobClient.url,
        sasUrl,
    };
}
async function uploadMultipleToAzure(files, businessName, categoryName, subcategoryName, itemName) {
    const uploadPromises = files.map((file) => uploadToAzure(file.buffer, businessName, categoryName, subcategoryName, itemName, file.originalname));
    return Promise.all(uploadPromises);
}
//# sourceMappingURL=azure-storage-helper.js.map