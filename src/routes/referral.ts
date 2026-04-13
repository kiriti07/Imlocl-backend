// src/routes/referral.ts
// Mount in server.ts with: app.use('/api/referral', referralRouter);
// ─────────────────────────────────────────────────────────────────────────────

import express from 'express';
import { PrismaClient } from '@prisma/client';

const router = express.Router();
const prisma = new PrismaClient();

function toNum(v: any): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return v;
  if (typeof v?.toNumber === 'function') return v.toNumber();
  return Number(v) || 0;
}

// Generate a unique referral code for a partner
function generateCode(partnerId: string): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let hash = 0;
  for (let i = 0; i < partnerId.length; i++) {
    hash = (hash << 5) - hash + partnerId.charCodeAt(i);
    hash |= 0;
  }
  let code = 'IML';
  let seed = Math.abs(hash);
  for (let i = 0; i < 5; i++) {
    code += chars[seed % chars.length];
    seed = Math.floor(seed / chars.length) + partnerId.charCodeAt(i % partnerId.length);
  }
  return code;
}

// ─── Auth middleware (reuse your existing partner JWT) ────────────────────────
function partnerAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  const header = req.headers.authorization ?? '';
  const token  = header.startsWith('Bearer ') ? header.slice(7) : header;
  if (!token) return res.status(401).json({ message: 'Missing token' });
  try {
    const jwt = require('jsonwebtoken');
    const payload = jwt.verify(token, process.env.JWT_SECRET ?? 'secret') as any;
    (req as any).partner = payload;
    next();
  } catch {
    return res.status(401).json({ message: 'Invalid token' });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/referral/me — get my referral code + stats
// ─────────────────────────────────────────────────────────────────────────────
router.get('/me', partnerAuth, async (req, res) => {
  try {
    const partnerId = (req as any).partner?.id;
    if (!partnerId) return res.status(401).json({ message: 'Not authenticated' });

    // Ensure partner has a referral code
    let partner = await prisma.partner.findUnique({
      where: { id: partnerId },
      select: { id: true, fullName: true, referralCode: true, referralBonus: true } as any,
    }) as any;

    if (!partner) return res.status(404).json({ message: 'Partner not found' });

    // Generate and save code if missing
    if (!partner.referralCode) {
      const code = generateCode(partnerId);
      partner = await (prisma.partner as any).update({
        where: { id: partnerId },
        data: { referralCode: code },
        select: { id: true, fullName: true, referralCode: true, referralBonus: true },
      });
    }

    // Get all referrals made by this partner
    const referrals = await (prisma as any).referral.findMany({
      where: { referrerId: partnerId },
      orderBy: { createdAt: 'desc' },
    });

    // Enrich with referee names
    const enriched = await Promise.all(referrals.map(async (r: any) => {
      const referee = await prisma.partner.findUnique({
        where: { id: r.refereeId },
        select: { fullName: true, role: true, businessName: true },
      });
      return {
        id:           r.id,
        refereeName:  referee?.fullName ?? 'Unknown',
        refereeRole:  referee?.role ?? r.refereeType,
        status:       r.status,
        bonusAmount:  toNum(r.bonusAmount),
        orderCount:   r.refereeOrderCount,
        activatedAt:  r.activatedAt,
        paidAt:       r.paidAt,
        createdAt:    r.createdAt,
      };
    }));

    const pending   = enriched.filter(r => r.status === 'PENDING');
    const active    = enriched.filter(r => r.status === 'ACTIVE');
    const paid      = enriched.filter(r => r.status === 'PAID');
    const totalPaid = paid.reduce((s, r) => s + r.bonusAmount, 0);
    const totalPending = [...pending, ...active].reduce((s, r) => s + r.bonusAmount, 0);

    return res.json({
      referralCode:   partner.referralCode,
      referralLink:   `https://partner.imlocl.com/join?ref=${partner.referralCode}`,
      walletBonus:    toNum(partner.referralBonus),
      stats: {
        totalReferrals: enriched.length,
        pending:        pending.length,
        active:         active.length,
        paid:           paid.length,
        totalEarned:    totalPaid,
        pendingEarnings: totalPending,
      },
      referrals: enriched,
    });
  } catch (e: any) {
    console.error('REFERRAL ME ERROR:', e);
    return res.status(500).json({ message: e?.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/referral/apply — called during partner registration
// Body: { partnerId, referralCode }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/apply', async (req, res) => {
  try {
    const { partnerId, referralCode } = req.body;
    if (!partnerId || !referralCode) {
      return res.status(400).json({ message: 'partnerId and referralCode required' });
    }

    // Find the referrer
    const referrer = await (prisma.partner as any).findFirst({
      where: { referralCode: String(referralCode).toUpperCase().trim() },
      select: { id: true, fullName: true },
    });

    if (!referrer) return res.status(404).json({ message: 'Invalid referral code' });
    if (referrer.id === partnerId) return res.status(400).json({ message: 'Cannot refer yourself' });

    // Check if referee already used a code
    const existing = await (prisma as any).referral.findFirst({ where: { refereeId: partnerId } });
    if (existing) return res.status(409).json({ message: 'Referral already applied' });

    // Get referee's role
    const referee = await prisma.partner.findUnique({
      where: { id: partnerId },
      select: { role: true },
    });

    // Create referral record
    const referral = await (prisma as any).referral.create({
      data: {
        referrerId:    referrer.id,
        refereeId:     partnerId,
        refereeType:   String(referee?.role ?? 'UNKNOWN'),
        status:        'PENDING',
        bonusAmount:   5000,
        refereeOrderCount: 0,
      },
    });

    // Mark referee as referred
    await (prisma.partner as any).update({
      where: { id: partnerId },
      data: { referredBy: referrer.id },
    });

    return res.json({
      ok: true,
      message: `Referral applied! You were referred by ${referrer.fullName}.`,
      referral: { id: referral.id, bonusAmount: 5000 },
    });
  } catch (e: any) {
    console.error('REFERRAL APPLY ERROR:', e);
    return res.status(500).json({ message: e?.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/referral/progress — called after each order completion (internal)
// Body: { partnerId }  — call this from your order completion webhook/handler
// ─────────────────────────────────────────────────────────────────────────────
router.post('/progress', async (req, res) => {
  try {
    const { partnerId } = req.body;
    if (!partnerId) return res.status(400).json({ message: 'partnerId required' });

    // Find referral for this partner
    const referral = await (prisma as any).referral.findFirst({
      where: { refereeId: partnerId, status: { in: ['PENDING', 'ACTIVE'] } },
    });
    if (!referral) return res.json({ ok: true, message: 'No active referral' });

    const newCount = referral.refereeOrderCount + 1;
    const THRESHOLD = 10; // Activate after 10 completed orders

    if (newCount >= THRESHOLD && referral.status === 'PENDING') {
      // Activate referral — credit ₹5000 to referrer's bonus wallet
      await (prisma as any).referral.update({
        where: { id: referral.id },
        data: { status: 'ACTIVE', refereeOrderCount: newCount, activatedAt: new Date() },
      });

      // Credit bonus to referrer (stored in referralBonus field)
      await (prisma.partner as any).update({
        where: { id: referral.referrerId },
        data: { referralBonus: { increment: 5000 } },
      });

      // Schedule payout (mark as PAID — in production trigger actual transfer)
      await (prisma as any).referral.update({
        where: { id: referral.id },
        data: { status: 'PAID', paidAt: new Date() },
      });

      console.log(`✅ Referral activated: ₹5000 credited to partner ${referral.referrerId}`);

      return res.json({ ok: true, activated: true, bonusCredited: 5000 });
    } else {
      // Just increment count
      await (prisma as any).referral.update({
        where: { id: referral.id },
        data: {
          refereeOrderCount: newCount,
          status: newCount >= THRESHOLD ? 'ACTIVE' : 'PENDING',
        },
      });
      return res.json({ ok: true, activated: false, count: newCount, threshold: THRESHOLD });
    }
  } catch (e: any) {
    console.error('REFERRAL PROGRESS ERROR:', e);
    return res.status(500).json({ message: e?.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/referral/validate/:code — validate a referral code (for registration UI)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/validate/:code', async (req, res) => {
  try {
    const code = String(req.params.code).toUpperCase().trim();
    const referrer = await (prisma.partner as any).findFirst({
      where: { referralCode: code },
      select: { id: true, fullName: true, city: true, role: true },
    });
    if (!referrer) return res.status(404).json({ valid: false, message: 'Invalid referral code' });
    return res.json({
      valid: true,
      referrerName: referrer.fullName,
      referrerCity: referrer.city,
    });
  } catch (e: any) {
    return res.status(500).json({ message: e?.message });
  }
});

export default router;