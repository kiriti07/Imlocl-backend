// src/utils/azure-storage-helper-meat.ts
import { containerClient } from "../config/azure-storage";
import { BlockBlobClient } from "@azure/storage-blob";
import crypto from "crypto";

export interface UploadResult {
  blobName: string;
  url: string;
}

/**
 * Generate a blob name for meat shop items
 * Format: meat-shops/{shopName}/{itemName}/{filename}
 */
export function generateMeatItemBlobName(
  shopName: string,
  itemName: string,
  originalFilename: string
): string {
  // Sanitize folder names (replace spaces with underscores, remove special chars)
  const sanitize = (str: string) => str.replace(/[^a-zA-Z0-9]/g, '_').replace(/\s+/g, '_');
  
  const safeShopName = sanitize(shopName);
  const safeItemName = sanitize(itemName);
  
  // Generate unique filename
  const ext = originalFilename.split('.').pop() || 'jpg';
  const uniqueFilename = `${crypto.randomUUID()}.${ext}`;
  
  return `meat-shops/${safeShopName}/${safeItemName}/${uniqueFilename}`;
}

/**
 * Upload a single meat item image to Azure Blob Storage
 */
export async function uploadMeatItemImage(
  fileBuffer: Buffer,
  shopName: string,
  itemName: string,
  originalFilename: string
): Promise<UploadResult> {
  try {
    const blobName = generateMeatItemBlobName(shopName, itemName, originalFilename);
    const blockBlobClient = containerClient.getBlockBlobClient(blobName);
    
    // Upload the file
    await blockBlobClient.uploadData(fileBuffer, {
      blobHTTPHeaders: {
        blobContentType: `image/${originalFilename.split('.').pop()}`,
      },
    });
    
    const url = blockBlobClient.url;
    console.log(`✅ Meat item image uploaded to Azure: ${url}`);
    
    return { blobName, url };
  } catch (error) {
    console.error("Error uploading to Azure:", error);
    throw error;
  }
}

/**
 * Upload multiple meat item images to Azure Blob Storage
 */
export async function uploadMultipleMeatItemImages(
  files: Express.Multer.File[],
  shopName: string,
  itemName: string
): Promise<UploadResult[]> {
  const uploadPromises = files.map(file => 
    uploadMeatItemImage(
      file.buffer,
      shopName,
      itemName,
      file.originalname
    )
  );
  
  return Promise.all(uploadPromises);
}