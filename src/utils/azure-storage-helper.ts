// src/utils/azure-storage-helper.ts
import { containerClient } from "../config/azure-storage";
import { generateBlobSASQueryParameters, StorageSharedKeyCredential, SASProtocol } from "@azure/storage-blob";
import crypto from "crypto";

export interface UploadResult {
  blobName: string;
  url: string;
  sasUrl: string;
}

const accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME || "";
const accountKey = process.env.AZURE_STORAGE_ACCOUNT_KEY || "";
const sharedKeyCredential = new StorageSharedKeyCredential(accountName, accountKey);

function generateSasToken(blobName: string): string {
  const startDate = new Date();
  const expiryDate = new Date();
  expiryDate.setFullYear(expiryDate.getFullYear() + 1);

  const sasOptions = {
    containerName: containerClient.containerName,
    blobName: blobName,
    startsOn: startDate,
    expiresOn: expiryDate,
    permissions: "r",
    protocol: SASProtocol.Https,
  };

  const sasToken = generateBlobSASQueryParameters(sasOptions, sharedKeyCredential).toString();
  return sasToken;
}

export function generateBlobName(
  businessName: string,
  categoryName: string,
  subcategoryName: string,
  itemName: string,
  originalFilename: string
): string {
  const sanitize = (str: string) => str.replace(/[^a-zA-Z0-9]/g, '_');
  
  const safeBusiness = sanitize(businessName);
  const safeCategory = sanitize(categoryName);
  const safeSubcategory = sanitize(subcategoryName);
  const safeItem = sanitize(itemName);
  
  const ext = originalFilename.split('.').pop() || 'jpg';
  const uniqueFilename = `${crypto.randomUUID()}.${ext}`;
  
  return `${safeBusiness}/${safeCategory}/${safeSubcategory}/${safeItem}/${uniqueFilename}`;
}

export async function uploadToAzure(
  fileBuffer: Buffer,
  businessName: string,
  categoryName: string,
  subcategoryName: string,
  itemName: string,
  originalFilename: string
): Promise<UploadResult> {
  const blobName = generateBlobName(
    businessName,
    categoryName,
    subcategoryName,
    itemName,
    originalFilename
  );
  
  const blockBlobClient = containerClient.getBlockBlobClient(blobName);
  
  await blockBlobClient.uploadData(fileBuffer, {
    blobHTTPHeaders: {
      blobContentType: `image/${originalFilename.split('.').pop()}`,
    },
  });
  
  const sasToken = generateSasToken(blobName);
  const sasUrl = `${blockBlobClient.url}?${sasToken}`;
  
  return { 
    blobName, 
    url: blockBlobClient.url,
    sasUrl
  };
}

export async function uploadMultipleToAzure(
  files: Express.Multer.File[],
  businessName: string,
  categoryName: string,
  subcategoryName: string,
  itemName: string
): Promise<UploadResult[]> {
  const uploadPromises = files.map(file => 
    uploadToAzure(
      file.buffer,
      businessName,
      categoryName,
      subcategoryName,
      itemName,
      file.originalname
    )
  );
  
  return Promise.all(uploadPromises);
}