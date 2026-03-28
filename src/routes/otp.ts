import { Router, Request, Response } from 'express';
import twilio from 'twilio';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const router = Router();

// Initialize Twilio client
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const VERIFY_SERVICE_SID = process.env.TWILIO_VERIFY_SERVICE_SID;

// Format phone number to E.164 format (add country code if needed)
function formatPhoneNumber(phone: string): string {
  // Remove any non-digit characters
  const cleaned = phone.replace(/\D/g, '');
  
  // Add +91 for Indian numbers if not present
  if (cleaned.length === 10) {
    return `+91${cleaned}`;
  }
  
  // If already has country code
  if (cleaned.length > 10 && cleaned.startsWith('91')) {
    return `+${cleaned}`;
  }
  
  return phone.startsWith('+') ? phone : `+${cleaned}`;
}

// Store OTP verification data temporarily
interface VerificationData {
  phone: string;
  fullName: string;
  email?: string;
  passwordHash: string;
  addressLabel?: string;
  fullAddress?: string;
  city?: string;
  lat?: number | null;
  lng?: number | null;
  landmark?: string;
  deliveryInstructions?: string;
  expiresAt: number;
}

const verificationStore = new Map<string, VerificationData>();

// Clean up expired verifications every hour
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of verificationStore.entries()) {
    if (value.expiresAt < now) {
      verificationStore.delete(key);
    }
  }
}, 60 * 60 * 1000);

// Send OTP
router.post('/send-otp', async (req: Request, res: Response) => {
  try {
    const {
      phone,
      fullName,
      email,
      password,
      addressLabel,
      fullAddress,
      city,
      lat,
      lng,
      landmark,
      deliveryInstructions,
    } = req.body;

    // Validate required fields
    if (!phone || !fullName || !password) {
      return res.status(400).json({
        message: 'Phone number, full name, and password are required',
      });
    }

    // Check if customer already exists
    const existing = await prisma.customer.findUnique({
      where: { phone },
    });

    if (existing) {
      return res.status(409).json({
        message: 'Customer already exists. Please login.',
      });
    }

    // Format phone number
    const formattedPhone = formatPhoneNumber(phone);

    // Hash password
    const bcrypt = await import('bcryptjs');
    const passwordHash = await bcrypt.hash(password, 10);

    // Generate a unique key for this verification session
    const sessionKey = `${formattedPhone}_${Date.now()}`;

    // Store user data temporarily
    verificationStore.set(sessionKey, {
      phone: formattedPhone,
      fullName,
      email,
      passwordHash,
      addressLabel: addressLabel || 'Home',
      fullAddress,
      city,
      lat: lat ? Number(lat) : null,
      lng: lng ? Number(lng) : null,
      landmark,
      deliveryInstructions,
      expiresAt: Date.now() + 10 * 60 * 1000, // 10 minutes expiry
    });

    // Send OTP via Twilio Verify
    const verification = await twilioClient.verify.v2
      .services(VERIFY_SERVICE_SID!)
      .verifications.create({
        to: formattedPhone,
        channel: 'sms',
      });

    console.log('OTP sent to:', formattedPhone, 'Status:', verification.status);

    return res.json({
      success: true,
      message: 'OTP sent successfully',
      sessionKey,
      expiresIn: 600, // 10 minutes in seconds
    });
  } catch (error: any) {
    console.error('Send OTP error:', error);
    
    // Handle specific Twilio errors
    if (error.code === 20404) {
      return res.status(400).json({
        message: 'Invalid phone number format. Please use a valid Indian mobile number.',
      });
    }
    
    return res.status(500).json({
      message: error?.message || 'Failed to send OTP',
    });
  }
});

// Verify OTP and complete registration
router.post('/verify-otp', async (req: Request, res: Response) => {
  try {
    const { sessionKey, code } = req.body;

    if (!sessionKey || !code) {
      return res.status(400).json({
        message: 'Session key and verification code are required',
      });
    }

    // Get stored verification data
    const verificationData = verificationStore.get(sessionKey);
    
    if (!verificationData) {
      return res.status(400).json({
        message: 'Session expired or invalid. Please request a new OTP.',
      });
    }

    // Check if session expired
    if (verificationData.expiresAt < Date.now()) {
      verificationStore.delete(sessionKey);
      return res.status(400).json({
        message: 'OTP session expired. Please request a new OTP.',
      });
    }

    // Verify OTP with Twilio
    const verificationCheck = await twilioClient.verify.v2
      .services(VERIFY_SERVICE_SID!)
      .verificationChecks.create({
        to: verificationData.phone,
        code: code,
      });

    if (verificationCheck.status !== 'approved') {
      return res.status(400).json({
        message: 'Invalid verification code. Please try again.',
      });
    }

    // Create customer account
    const customer = await prisma.customer.create({
      data: {
        fullName: verificationData.fullName,
        phone: verificationData.phone,
        email: verificationData.email,
        passwordHash: verificationData.passwordHash,
        token: require('crypto').randomUUID(),
        addresses: verificationData.fullAddress
          ? {
              create: {
                label: verificationData.addressLabel || 'Home',
                fullAddress: verificationData.fullAddress,
                city: verificationData.city,
                lat: verificationData.lat,
                lng: verificationData.lng,
                landmark: verificationData.landmark,
                deliveryInstructions: verificationData.deliveryInstructions,
                isDefault: true,
              },
            }
          : undefined,
      },
      include: {
        addresses: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    // Clean up verification data
    verificationStore.delete(sessionKey);

    return res.json({
      success: true,
      token: customer.token,
      customer,
      message: 'Registration successful',
    });
  } catch (error: any) {
    console.error('Verify OTP error:', error);
    
    // Handle specific Twilio errors
    if (error.code === 20404) {
      return res.status(400).json({
        message: 'Invalid verification code. Please try again.',
      });
    }
    
    return res.status(500).json({
      message: error?.message || 'Failed to verify OTP',
    });
  }
});

// Resend OTP
router.post('/resend-otp', async (req: Request, res: Response) => {
  try {
    const { sessionKey } = req.body;

    if (!sessionKey) {
      return res.status(400).json({
        message: 'Session key is required',
      });
    }

    // Get stored verification data
    const verificationData = verificationStore.get(sessionKey);
    
    if (!verificationData) {
      return res.status(400).json({
        message: 'Session expired. Please start registration again.',
      });
    }

    // Resend OTP
    const verification = await twilioClient.verify.v2
      .services(VERIFY_SERVICE_SID!)
      .verifications.create({
        to: verificationData.phone,
        channel: 'sms',
      });

    // Reset expiry time
    verificationData.expiresAt = Date.now() + 10 * 60 * 1000;
    verificationStore.set(sessionKey, verificationData);

    console.log('OTP resent to:', verificationData.phone);

    return res.json({
      success: true,
      message: 'OTP resent successfully',
      expiresIn: 600,
    });
  } catch (error: any) {
    console.error('Resend OTP error:', error);
    return res.status(500).json({
      message: error?.message || 'Failed to resend OTP',
    });
  }
});

export default router;