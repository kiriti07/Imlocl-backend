// src/routes/admin.ts
// ─────────────────────────────────────────────────────────────────────────────
// ImLocl Admin Panel — All backend routes
// Mount in server.ts with: app.use('/admin', adminRouter);
// ─────────────────────────────────────────────────────────────────────────────

import express from 'express';
import {
  PrismaClient,
  PartnerRole,
  PartnerStatus,
} from '@prisma/client';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const router  = express.Router();
const prisma  = new PrismaClient();

const ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET ?? 'imlocl-admin-secret-change-this';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toNum(v: any): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'number') return v;
  if (typeof v?.toNumber === 'function') return v.toNumber();
  return Number(v) || 0;
}

function startOfDay(d = new Date()) {
  const t = new Date(d);
  t.setHours(0, 0, 0, 0);
  return t;
}

function startOfMonth(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

// ─── Admin Auth Middleware ────────────────────────────────────────────────────

interface AdminPayload { id: string; role: string; email: string }

function adminAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  // In development, skip auth so you can test without a real token
  if (process.env.NODE_ENV === 'development') {
    (req as any).admin = { id: 'dev', role: 'ADMIN', email: 'dev@imlocl.com' };
    return next();
  }

  const token = String(req.headers.authorization ?? '').replace('Bearer ', '').trim();
  if (!token) return res.status(401).json({ message: 'Missing admin token' });

  try {
    const payload = jwt.verify(token, ADMIN_JWT_SECRET) as AdminPayload;
    (req as any).admin = payload;
    next();
  } catch {
    return res.status(401).json({ message: 'Invalid or expired admin token' });
  }
}

function requireAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
  const admin = (req as any).admin as AdminPayload;
  if (admin?.role !== 'ADMIN') return res.status(403).json({ message: 'Admin only' });
  next();
}

// ─────────────────────────────────────────────────────────────────────────────
// AUTH
// ─────────────────────────────────────────────────────────────────────────────

// POST /admin/auth/login
router.post('/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ message: 'email and password required' });

    const admin = await (prisma as any).adminUser.findUnique({ where: { email: String(email).trim() } });
    if (!admin) return res.status(401).json({ message: 'Invalid credentials' });

    const valid = await bcrypt.compare(password, admin.passwordHash);
    if (!valid) return res.status(401).json({ message: 'Invalid credentials' });

    await (prisma as any).adminUser.update({
      where: { id: admin.id },
      data: { lastLogin: new Date() },
    });

    const token = jwt.sign(
      { id: admin.id, role: admin.role, email: admin.email },
      ADMIN_JWT_SECRET,
      { expiresIn: '24h' }
    );

    return res.json({ token, user: { id: admin.id, name: admin.name, email: admin.email, role: admin.role } });
  } catch (e: any) {
    console.error('ADMIN LOGIN ERROR:', e);
    return res.status(500).json({ message: e?.message ?? 'Server error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// OVERVIEW — Live dashboard stats
// ─────────────────────────────────────────────────────────────────────────────

// GET /admin/overview/stats
router.get('/overview/stats', adminAuth, async (_req, res) => {
  try {
    const today     = startOfDay();
    const thisMonth = startOfMonth();

    const [
      gmvTodayAgg,
      gmvMonthAgg,
      ordersToday,
      ordersMonth,
      activeCustomers,
      activeMeatOwners,
      activeOrganicOwners,
      activeLaundryOwners,
      activeDeliveryPartners,
      couponSpendTodayAgg,
      pendingPayoutsCount,
      cancelledToday,
      failedToday,
    ] = await Promise.all([
      // GMV today (completed orders)
      prisma.customerOrder.aggregate({
        where: { createdAt: { gte: today }, orderStatus: { in: ['COMPLETED', 'DELIVERED', 'CASH_COLLECTED'] } },
        _sum: { totalAmount: true },
      }),
      // GMV this month
      prisma.customerOrder.aggregate({
        where: { createdAt: { gte: thisMonth }, orderStatus: { in: ['COMPLETED', 'DELIVERED', 'CASH_COLLECTED'] } },
        _sum: { totalAmount: true },
      }),
      // Orders placed today
      prisma.customerOrder.count({ where: { createdAt: { gte: today } } }),
      // Orders this month
      prisma.customerOrder.count({ where: { createdAt: { gte: thisMonth } } }),
      // Active customers
      prisma.customer.count({ where: { isActive: true } }),
      // Active approved meat shops
      prisma.partner.count({ where: { role: PartnerRole.MEAT_PARTNER, status: PartnerStatus.APPROVED, isActive: true } }),
      // Active approved organic shops
      prisma.partner.count({ where: { role: PartnerRole.ORGANIC_PARTNER, status: PartnerStatus.APPROVED, isActive: true } }),
      // Active laundry shops
      prisma.partner.count({ where: { role: PartnerRole.LAUNDRY_PARTNER, status: PartnerStatus.APPROVED, isActive: true } }),
      // Online delivery partners
      prisma.deliveryPartner.count({ where: { isAvailable: true } }),
      // Coupon spend today
      prisma.customerOrder.aggregate({
        where: { createdAt: { gte: today }, couponCode: { not: null } },
        _sum: { discount: true },
      }),
      // Pending payouts (completed COD not yet settled)
      prisma.customerOrder.count({
        where: { orderStatus: 'COMPLETED', paymentStatus: 'CASH_COLLECTED' },
      }),
      // Cancelled today
      prisma.customerOrder.count({ where: { createdAt: { gte: today }, orderStatus: 'STORE_REJECTED' } }),
      // Failed today
      prisma.customerOrder.count({ where: { createdAt: { gte: today }, orderStatus: { in: ['FAILED', 'CANCELLED'] } } }),
    ]);

    const gmvToday       = toNum(gmvTodayAgg._sum.totalAmount);
    const gmvMonth       = toNum(gmvMonthAgg._sum.totalAmount);
    const avgOrder       = ordersMonth > 0 ? Math.round(gmvMonth / ordersMonth) : 0;
    const netProfitToday = Math.round(gmvToday * 0.15); // adjust to your actual commission %

    return res.json({
      gmvToday,
      gmvMonth,
      ordersToday,
      ordersMonth,
      activeCustomers,
      activeMeatOwners,
      activeOrganicOwners,
      activeLaundryOwners,
      activeDeliveryPartners,
      couponSpendToday: toNum(couponSpendTodayAgg._sum.discount),
      pendingPayouts: pendingPayoutsCount,
      netProfitToday,
      avgOrderValue: avgOrder,
      cancelledOrdersToday: cancelledToday,
      failedOrdersToday: failedToday,
    });
  } catch (e: any) {
    console.error('ADMIN STATS ERROR:', e);
    return res.status(500).json({ message: e?.message ?? 'Server error' });
  }
});

// GET /admin/overview/revenue?period=week|month|3months
router.get('/overview/revenue', adminAuth, async (req, res) => {
  try {
    const period = String(req.query.period ?? 'week');
    const days   = period === '3months' ? 90 : period === 'month' ? 30 : 7;
    const from   = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const orders = await prisma.customerOrder.findMany({
      where: { createdAt: { gte: from }, orderStatus: { in: ['COMPLETED', 'DELIVERED', 'CASH_COLLECTED'] } },
      select: { createdAt: true, totalAmount: true, discount: true, platformFee: true },
    });

    const byDate = new Map<string, { gmv: number; coupon: number; payout: number; profit: number }>();

    for (const o of orders) {
      const dateKey  = o.createdAt.toISOString().slice(0, 10);
      const existing = byDate.get(dateKey) ?? { gmv: 0, coupon: 0, payout: 0, profit: 0 };
      const gmv      = toNum(o.totalAmount);
      const coupon   = toNum(o.discount);
      const fee      = toNum(o.platformFee);

      byDate.set(dateKey, {
        gmv:    existing.gmv    + gmv,
        coupon: existing.coupon + coupon,
        payout: existing.payout + (gmv - fee),
        profit: existing.profit + (fee - coupon),
      });
    }

    const series = [];
    for (let i = days - 1; i >= 0; i--) {
      const d     = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
      const key   = d.toISOString().slice(0, 10);
      const label = `${d.toLocaleString('en-IN', { month: 'short' })} ${d.getDate()}`;
      series.push({ date: label, ...(byDate.get(key) ?? { gmv: 0, coupon: 0, payout: 0, profit: 0 }) });
    }

    return res.json({ series });
  } catch (e: any) {
    return res.status(500).json({ message: e?.message ?? 'Server error' });
  }
});

// GET /admin/overview/order-status
router.get('/overview/order-status', adminAuth, async (_req, res) => {
  try {
    const today = startOfDay();
    const [delivered, inTransit, cancelled, failed] = await Promise.all([
      prisma.customerOrder.count({ where: { createdAt: { gte: today }, orderStatus: { in: ['COMPLETED', 'DELIVERED'] } } }),
      prisma.customerOrder.count({ where: { createdAt: { gte: today }, orderStatus: { in: ['PICKED_UP', 'DELIVERY_ASSIGNED', 'ON_THE_WAY'] } } }),
      prisma.customerOrder.count({ where: { createdAt: { gte: today }, orderStatus: 'STORE_REJECTED' } }),
      prisma.customerOrder.count({ where: { createdAt: { gte: today }, orderStatus: { in: ['FAILED', 'CANCELLED'] } } }),
    ]);
    return res.json({ delivered, inTransit, cancelled, failed });
  } catch (e: any) {
    return res.status(500).json({ message: e?.message ?? 'Server error' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PARTNERS
// ─────────────────────────────────────────────────────────────────────────────

router.get('/partners', adminAuth, async (req, res) => {
  try {
    const { role, status, search, page = '1', limit = '20' } = req.query as Record<string, string>;
    const skip = (Number(page) - 1) * Number(limit);

    const where: any = {};
    if (role && role !== 'ALL') where.role = role;
    if (status && status !== 'ALL') where.status = status;
    if (search) {
      where.OR = [
        { fullName:     { contains: search, mode: 'insensitive' } },
        { phone:        { contains: search } },
        { businessName: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [partners, total] = await Promise.all([
      prisma.partner.findMany({
        where,
        include: {
          meatShop:        { select: { id: true } },
          organicShop:     { select: { id: true } },
          laundryShop:     { select: { id: true } },
          deliveryPartner: { select: { rating: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: Number(limit),
      }),
      prisma.partner.count({ where }),
    ]);

    const enriched = await Promise.all(partners.map(async (p) => {
      const storeId = p.meatShop?.id ?? p.organicShop?.id ?? p.laundryShop?.id;
      let totalOrders = 0;
      let totalRevenue = 0;

      if (storeId) {
        const agg = await prisma.customerOrder.aggregate({
          where: { storeId, orderStatus: { in: ['COMPLETED', 'DELIVERED', 'CASH_COLLECTED'] } },
          _count: { id: true },
          _sum: { totalAmount: true },
        });
        totalOrders  = agg._count.id ?? 0;
        totalRevenue = Math.round(toNum(agg._sum.totalAmount));
      }

      return {
        id: p.id,
        name: p.fullName,
        phone: p.phone,
        email: p.email,
        role: p.role,
        status: p.status.toLowerCase(),
        businessName: p.businessName,
        city: p.city,
        isActive: p.isActive,
        createdAt: p.createdAt,
        totalOrders,
        totalRevenue,
        rating: p.deliveryPartner?.rating ?? null,
      };
    }));

    return res.json({ partners: enriched, total });
  } catch (e: any) {
    console.error('ADMIN PARTNERS ERROR:', e);
    return res.status(500).json({ message: e?.message ?? 'Server error' });
  }
});

router.post('/partners/:id/approve',   adminAuth, requireAdmin, async (req, res) => {
  try {
    const p = await prisma.partner.update({ where: { id: req.params.id }, data: { status: PartnerStatus.APPROVED, isActive: true } });
    return res.json({ partner: p });
  } catch (e: any) { return res.status(500).json({ message: e?.message }); }
});

router.post('/partners/:id/reject',    adminAuth, requireAdmin, async (req, res) => {
  try {
    const p = await prisma.partner.update({ where: { id: req.params.id }, data: { status: PartnerStatus.REJECTED, isActive: false } });
    return res.json({ partner: p });
  } catch (e: any) { return res.status(500).json({ message: e?.message }); }
});

router.post('/partners/:id/suspend',   adminAuth, requireAdmin, async (req, res) => {
  try {
    const p = await prisma.partner.update({ where: { id: req.params.id }, data: { isActive: false } });
    return res.json({ partner: p });
  } catch (e: any) { return res.status(500).json({ message: e?.message }); }
});

router.post('/partners/:id/reinstate', adminAuth, requireAdmin, async (req, res) => {
  try {
    const p = await prisma.partner.update({ where: { id: req.params.id }, data: { status: PartnerStatus.APPROVED, isActive: true } });
    return res.json({ partner: p });
  } catch (e: any) { return res.status(500).json({ message: e?.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// CUSTOMERS
// ─────────────────────────────────────────────────────────────────────────────

router.get('/customers', adminAuth, async (req, res) => {
  try {
    const { search, page = '1', limit = '20' } = req.query as Record<string, string>;
    const skip  = (Number(page) - 1) * Number(limit);
    const where: any = {};
    if (search) where.OR = [{ fullName: { contains: search, mode: 'insensitive' } }, { phone: { contains: search } }];

    const [customers, total] = await Promise.all([
      prisma.customer.findMany({ where, include: { addresses: { where: { isDefault: true }, take: 1 } }, orderBy: { createdAt: 'desc' }, skip, take: Number(limit) }),
      prisma.customer.count({ where }),
    ]);

    const enriched = await Promise.all(customers.map(async (c) => {
      const agg = await prisma.customerOrder.aggregate({
        where: { customerPhone: c.phone, orderStatus: { in: ['COMPLETED', 'DELIVERED', 'CASH_COLLECTED'] } },
        _count: { id: true },
        _sum:   { totalAmount: true },
      });
      const last = await prisma.customerOrder.findFirst({ where: { customerPhone: c.phone }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } });
      return {
        id: c.id, name: c.fullName, phone: c.phone, email: c.email,
        city: c.addresses[0]?.city ?? null,
        isActive: c.isActive, isBlocked: !c.isActive,
        createdAt: c.createdAt, lastOrderAt: last?.createdAt ?? null,
        totalOrders: agg._count.id ?? 0,
        totalSpend: Math.round(toNum(agg._sum.totalAmount)),
        walletBalance: 0,
      };
    }));

    return res.json({ customers: enriched, total });
  } catch (e: any) { return res.status(500).json({ message: e?.message }); }
});

router.post('/customers/:id/block',   adminAuth, async (req, res) => {
  try { return res.json({ customer: await prisma.customer.update({ where: { id: req.params.id }, data: { isActive: false } }) }); }
  catch (e: any) { return res.status(500).json({ message: e?.message }); }
});

router.post('/customers/:id/unblock', adminAuth, async (req, res) => {
  try { return res.json({ customer: await prisma.customer.update({ where: { id: req.params.id }, data: { isActive: true } }) }); }
  catch (e: any) { return res.status(500).json({ message: e?.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// ORDERS
// ─────────────────────────────────────────────────────────────────────────────

router.get('/orders', adminAuth, async (req, res) => {
  try {
    const { status, serviceType, search, page = '1', limit = '20' } = req.query as Record<string, string>;
    const skip  = (Number(page) - 1) * Number(limit);
    const where: any = {};
    if (status)      where.orderStatus  = status;
    if (serviceType) where.serviceType  = serviceType.toUpperCase();
    if (search) {
      where.OR = [
        { orderNumber:   { contains: search, mode: 'insensitive' } },
        { customerName:  { contains: search, mode: 'insensitive' } },
        { customerPhone: { contains: search } },
        { storeName:     { contains: search, mode: 'insensitive' } },
      ];
    }

    const [orders, total] = await Promise.all([
      prisma.customerOrder.findMany({ where, include: { items: true }, orderBy: { createdAt: 'desc' }, skip, take: Number(limit) }),
      prisma.customerOrder.count({ where }),
    ]);

    return res.json({
      orders: orders.map((o) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        customerName: o.customerName,
        customerPhone: o.customerPhone,
        storeId: o.storeId,
        storeName: o.storeName,
        status: o.orderStatus,
        totalAmount: toNum(o.totalAmount),
        platformFee: toNum(o.platformFee),
        payoutAmount: toNum(o.totalAmount) - toNum(o.platformFee),
        paymentMethod: o.paymentMethod,
        paymentStatus: o.paymentStatus,
        serviceType: o.serviceType,
        createdAt: o.createdAt,
        deliveredAt: o.deliveredAt,
        isScheduled: o.isScheduled,
        items: o.items.map((it) => ({ name: it.itemName, qty: toNum(it.quantity), price: toNum(it.price) })),
      })),
      total,
    });
  } catch (e: any) { return res.status(500).json({ message: e?.message }); }
});

router.get('/orders/:id', adminAuth, async (req, res) => {
  try {
    const order = await prisma.customerOrder.findUnique({ where: { id: req.params.id }, include: { items: true, statusHistory: { orderBy: { createdAt: 'asc' } } } });
    if (!order) return res.status(404).json({ message: 'Not found' });
    return res.json({ order });
  } catch (e: any) { return res.status(500).json({ message: e?.message }); }
});

router.post('/orders/:id/cancel', adminAuth, async (req, res) => {
  try {
    const o = await prisma.customerOrder.update({ where: { id: req.params.id }, data: { orderStatus: 'CANCELLED', statusHistory: { create: { status: 'CANCELLED', note: req.body.reason ?? 'Cancelled by admin', actorType: 'ADMIN' } } } });
    return res.json({ order: o });
  } catch (e: any) { return res.status(500).json({ message: e?.message }); }
});

router.post('/orders/:id/refund', adminAuth, async (req, res) => {
  try {
    const { amount, reason = 'Refund by admin' } = req.body;
    const o = await prisma.customerOrder.update({ where: { id: req.params.id }, data: { paymentStatus: 'REFUNDED', statusHistory: { create: { status: 'REFUNDED', note: `Refund ₹${amount}: ${reason}`, actorType: 'ADMIN' } } } });
    return res.json({ order: o });
  } catch (e: any) { return res.status(500).json({ message: e?.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// PAYOUTS (derived from completed COD orders)
// ─────────────────────────────────────────────────────────────────────────────

router.get('/payouts', adminAuth, async (_req, res) => {
  try {
    const partners = await prisma.partner.findMany({
      where: { status: PartnerStatus.APPROVED, isActive: true, role: { in: [PartnerRole.MEAT_PARTNER, PartnerRole.ORGANIC_PARTNER, PartnerRole.LAUNDRY_PARTNER] } },
      include: { meatShop: { select: { id: true } }, organicShop: { select: { id: true } }, laundryShop: { select: { id: true } } },
    });

    const payouts = (await Promise.all(partners.map(async (p) => {
      const storeId = p.meatShop?.id ?? p.organicShop?.id ?? p.laundryShop?.id;
      if (!storeId) return null;

      const agg = await prisma.customerOrder.aggregate({
        where: { storeId, orderStatus: 'COMPLETED', paymentStatus: 'CASH_COLLECTED' },
        _count: { id: true },
        _sum: { totalAmount: true, platformFee: true },
      });

      const earned = toNum(agg._sum.totalAmount) - toNum(agg._sum.platformFee);
      if (earned <= 0) return null;

      return {
        id: `payout-${p.id}`,
        partnerId: p.id,
        partnerName: p.businessName ?? p.fullName,
        partnerType: p.role,
        amount: Math.round(earned),
        status: 'PENDING',
        ordersCount: agg._count.id ?? 0,
        period: 'Weekly',
        bankAccount: null,
        ifsc: null,
        createdAt: new Date().toISOString(),
      };
    }))).filter(Boolean);

    return res.json({ payouts });
  } catch (e: any) { return res.status(500).json({ message: e?.message }); }
});

// Stub — implement when you add a real Payout model
router.post('/payouts/:id/approve',      adminAuth, requireAdmin, async (_req, res) => res.json({ ok: true }));
router.post('/payouts/:id/process',      adminAuth, requireAdmin, async (_req, res) => res.json({ ok: true }));
router.post('/payouts/bulk-approve',     adminAuth, requireAdmin, async (_req, res) => res.json({ ok: true }));

// ─────────────────────────────────────────────────────────────────────────────
// COUPONS — uses your existing `coupon` table exactly
// ─────────────────────────────────────────────────────────────────────────────

router.get('/coupons', adminAuth, async (_req, res) => {
  try {
    const coupons = await prisma.coupon.findMany({ orderBy: { created_at: 'desc' } });

    const enriched = await Promise.all(coupons.map(async (c) => {
      const usage = await prisma.customerOrder.count({ where: { couponCode: c.code } });
      const dAgg  = await prisma.customerOrder.aggregate({ where: { couponCode: c.code, orderStatus: { in: ['COMPLETED', 'CASH_COLLECTED'] } }, _sum: { discount: true } });

      return {
        id: String(c.id),
        code: c.code,
        type: c.discount_type === 'PERCENTAGE' ? 'PERCENT' : 'FIXED',
        value: toNum(c.discount_value),
        minOrder: toNum(c.min_order_value),
        maxDiscount: toNum(c.max_discount),
        usageLimit: c.usage_limit ?? 999,
        usedCount: usage,
        perUserLimit: 1,
        validFrom: c.created_at?.toISOString() ?? new Date().toISOString(),
        validTo: c.expiry_date?.toISOString() ?? new Date(Date.now() + 30 * 86400000).toISOString(),
        isActive: c.is_active ?? true,
        createdBy: 'Admin',
        totalDiscount: Math.round(toNum(dAgg._sum.discount)),
        applicableTo: c.service_type ?? 'ALL',
      };
    }));

    return res.json({ coupons: enriched });
  } catch (e: any) { return res.status(500).json({ message: e?.message }); }
});

router.post('/coupons', adminAuth, requireAdmin, async (req, res) => {
  try {
    const { code, type, value, minOrder, maxDiscount, usageLimit, validTo, applicableTo } = req.body;
    const coupon = await prisma.coupon.create({
      data: {
        code:            String(code).toUpperCase().trim(),
        discount_type:   type === 'PERCENT' ? 'PERCENTAGE' : 'FIXED',
        discount_value:  Number(value),
        min_order_value: minOrder   ? Number(minOrder)   : 0,
        max_discount:    maxDiscount ? Number(maxDiscount) : null,
        usage_limit:     usageLimit  ? Number(usageLimit)  : 100,
        expiry_date:     validTo ? new Date(validTo) : new Date(Date.now() + 30 * 86400000),
        service_type:    applicableTo && applicableTo !== 'ALL' ? String(applicableTo) : null,
        is_active:       true,
      },
    });
    return res.json({ coupon });
  } catch (e: any) { return res.status(500).json({ message: e?.message }); }
});

router.post('/coupons/:id/disable', adminAuth, requireAdmin, async (req, res) => {
  try {
    const c = await prisma.coupon.update({ where: { id: req.params.id }, data: { is_active: false } });
    return res.json({ coupon: c });
  } catch (e: any) { return res.status(500).json({ message: e?.message }); }
});

router.post('/coupons/generate-for-customer', adminAuth, async (req, res) => {
  try {
    const { value, reason, agentId } = req.body;
    if (toNum(value) > 200 && (req as any).admin?.role !== 'ADMIN') {
      return res.status(403).json({ message: 'Coupons above ₹200 require admin approval' });
    }
    const code = `CC${Date.now().toString(36).toUpperCase()}`;
    const coupon = await prisma.coupon.create({
      data: {
        code,
        description:    `Support: ${reason}`,
        discount_type:  'FIXED',
        discount_value: Number(value),
        min_order_value: 0,
        usage_limit:    1,
        expiry_date:    new Date(Date.now() + 7 * 86400000),
        is_active:      true,
      },
    });
    console.log(`✅ Support coupon ${code} issued by agent ${agentId}: ${reason}`);
    return res.json({ coupon, code });
  } catch (e: any) { return res.status(500).json({ message: e?.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// TICKETS — built from CustomerOrder + OrderStatusHistory (no new model needed)
// ─────────────────────────────────────────────────────────────────────────────

router.get('/tickets', adminAuth, async (req, res) => {
  try {
    const { status = 'open' } = req.query as Record<string, string>;
    const statusMap: Record<string, string[]> = {
      open:        ['STORE_REJECTED', 'CANCELLED', 'FAILED', 'PLACED'],
      in_progress: ['STORE_ACCEPTED', 'READY_FOR_PICKUP', 'DELIVERY_ASSIGNED'],
      resolved:    ['COMPLETED'],
    };
    const orderStatuses = statusMap[status] ?? statusMap['open'];

    const orders = await prisma.customerOrder.findMany({
      where: { orderStatus: { in: orderStatuses } },
      orderBy: { updatedAt: 'desc' },
      take: 50,
    });

    const tickets = orders.map((o) => ({
      id: `ticket-${o.id}`,
      subject: `Order ${o.orderNumber} — ${o.orderStatus.replace(/_/g, ' ')}`,
      status,
      priority: ['STORE_REJECTED','CANCELLED','FAILED'].includes(o.orderStatus) ? 'high' : 'medium',
      tag: o.orderStatus === 'STORE_REJECTED' ? 'refund' : 'delivery_issue',
      userId: o.id,
      userName: o.customerName,
      userPhone: o.customerPhone,
      userType: 'customer',
      createdAt: o.createdAt.toISOString(),
      lastMessageAt: o.updatedAt.toISOString(),
      relatedOrderId: o.orderNumber,
      messages: [],
    }));

    return res.json({ tickets });
  } catch (e: any) { return res.status(500).json({ message: e?.message }); }
});

router.get('/tickets/:id', adminAuth, async (req, res) => {
  try {
    const orderId = req.params.id.replace('ticket-', '');
    const order   = await prisma.customerOrder.findFirst({
      where: { id: orderId },
      include: { statusHistory: { orderBy: { createdAt: 'asc' } }, items: true },
    });
    if (!order) return res.status(404).json({ message: 'Ticket not found' });

    return res.json({
      ticket: {
        id: `ticket-${order.id}`,
        subject: `Order ${order.orderNumber}`,
        status: 'open',
        priority: 'medium',
        tag: 'delivery_issue',
        userId: order.id,
        userName: order.customerName,
        userPhone: order.customerPhone,
        userType: 'customer',
        createdAt: order.createdAt.toISOString(),
        lastMessageAt: order.updatedAt.toISOString(),
        relatedOrderId: order.orderNumber,
        messages: order.statusHistory.map((h) => ({
          id: h.id,
          ticketId: `ticket-${order.id}`,
          senderId: h.actorId ?? 'system',
          senderName: h.actorType === 'CUSTOMER' ? order.customerName : h.actorType ?? 'System',
          senderType: h.actorType === 'CUSTOMER' ? 'user' : 'system',
          message: h.note ?? h.status,
          isInternal: false,
          createdAt: h.createdAt.toISOString(),
        })),
      },
    });
  } catch (e: any) { return res.status(500).json({ message: e?.message }); }
});

router.post('/tickets/:id/reply', adminAuth, async (req, res) => {
  try {
    const { message, isInternal = false } = req.body;
    const orderId = req.params.id.replace('ticket-', '');
    await prisma.orderStatusHistory.create({
      data: { orderId, status: 'AGENT_REPLY', note: `${isInternal ? '[Internal] ' : ''}${message}`, actorType: 'ADMIN', actorId: (req as any).admin?.id },
    });
    return res.json({ ok: true });
  } catch (e: any) { return res.status(500).json({ message: e?.message }); }
});

router.post('/tickets/:id/resolve', adminAuth, async (req, res) => {
  try {
    const orderId = req.params.id.replace('ticket-', '');
    await prisma.orderStatusHistory.create({ data: { orderId, status: 'TICKET_RESOLVED', note: 'Resolved by support agent', actorType: 'ADMIN' } });
    return res.json({ ok: true });
  } catch (e: any) { return res.status(500).json({ message: e?.message }); }
});

router.post('/tickets/:id/escalate', adminAuth, async (req, res) => {
  try {
    const orderId = req.params.id.replace('ticket-', '');
    await prisma.orderStatusHistory.create({ data: { orderId, status: 'TICKET_ESCALATED', note: `Escalated: ${req.body.reason}`, actorType: 'ADMIN' } });
    return res.json({ ok: true });
  } catch (e: any) { return res.status(500).json({ message: e?.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN USERS
// ─────────────────────────────────────────────────────────────────────────────

router.get('/users', adminAuth, requireAdmin, async (_req, res) => {
  try {
    const users = await (prisma as any).adminUser.findMany({
      select: { id: true, name: true, email: true, role: true, createdAt: true, lastLogin: true },
    });
    return res.json({ users });
  } catch (e: any) { return res.status(500).json({ message: e?.message }); }
});

router.post('/users', adminAuth, requireAdmin, async (req, res) => {
  try {
    const { name, email, password, role = 'CUSTOMER_CARE_FULL' } = req.body;
    if (!name || !email || !password) return res.status(400).json({ message: 'name, email, password required' });
    const existing = await (prisma as any).adminUser.findUnique({ where: { email: String(email).trim() } });
    if (existing) return res.status(409).json({ message: 'Email already in use' });
    const user = await (prisma as any).adminUser.create({
      data: { name: String(name).trim(), email: String(email).trim().toLowerCase(), passwordHash: await bcrypt.hash(password, 10), role: String(role) },
      select: { id: true, name: true, email: true, role: true, createdAt: true },
    });
    return res.json({ user });
  } catch (e: any) { return res.status(500).json({ message: e?.message }); }
});

router.put('/users/:id', adminAuth, requireAdmin, async (req, res) => {
  try {
    const data: any = {};
    if (req.body.name)     data.name = String(req.body.name).trim();
    if (req.body.role)     data.role = String(req.body.role);
    if (req.body.password) data.passwordHash = await bcrypt.hash(req.body.password, 10);
    const user = await (prisma as any).adminUser.update({ where: { id: req.params.id }, data, select: { id: true, name: true, email: true, role: true } });
    return res.json({ user });
  } catch (e: any) { return res.status(500).json({ message: e?.message }); }
});

router.delete('/users/:id', adminAuth, requireAdmin, async (req, res) => {
  try {
    await (prisma as any).adminUser.delete({ where: { id: req.params.id } });
    return res.json({ ok: true });
  } catch (e: any) { return res.status(500).json({ message: e?.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// LIVE MAP
// ─────────────────────────────────────────────────────────────────────────────

router.get('/live/delivery-partners', adminAuth, async (_req, res) => {
  try {
    const partners = await prisma.deliveryPartner.findMany({
      where: { isAvailable: true },
      include: { partner: { select: { fullName: true, phone: true } } },
    });

    return res.json({
      partners: partners
        .filter((p) => p.currentLat && p.currentLng)
        .map((p) => ({
          partnerId:   p.id,
          partnerName: p.partner.fullName,
          lat:         p.currentLat,
          lng:         p.currentLng,
          status:      p.currentOrders > 0 ? 'on_delivery' : 'available',
          updatedAt:   p.lastLocationUpdate?.toISOString() ?? new Date().toISOString(),
        })),
    });
  } catch (e: any) { return res.status(500).json({ message: e?.message }); }
});

export default router;
