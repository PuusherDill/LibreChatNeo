/**
 * Admin routes for OpenRouter per-user key management.
 *
 * All endpoints require JWT auth + ADMIN capability.
 *
 * GET    /api/admin/openrouter/users          List all users with their OR key data
 * POST   /api/admin/openrouter/provision/:id  Provision/re-provision a key for a user
 * POST   /api/admin/openrouter/topup          Top up (or subscribe) a user's OR key limit
 * GET    /api/admin/openrouter/key/:hash      Live key status from OpenRouter API
 * PATCH  /api/admin/openrouter/key/:hash      Enable / disable a key
 * GET    /api/admin/openrouter/topups         History of all top-ups (paginated)
 * GET    /api/admin/openrouter/topups/:userId History for one user
 * GET    /api/admin/openrouter/reveal/:userId Decrypt and return the plaintext key (ADMIN only)
 */

const express = require('express');
const mongoose = require('mongoose');
const { SystemCapabilities } = require('@librechat/data-schemas');
const { requireCapability } = require('~/server/middleware/roles/capabilities');
const { requireJwtAuth } = require('~/server/middleware');
const { findUser, updateUser } = require('~/models');
const { logger } = require('@librechat/data-schemas');

const {
  createKeyForUser,
  getKeyStatus,
  updateKeyLimit,
  setKeyDisabled,
  decryptKey,
} = require('@librechat/api');

const router = express.Router();

const requireAdminAccess = requireCapability(SystemCapabilities.ACCESS_ADMIN);

router.use(requireJwtAuth, requireAdminAccess);

// ---------------------------------------------------------------------------
// Helper: resolve OpenRouterTopUp model from active mongoose connection
// ---------------------------------------------------------------------------
function getTopUpModel() {
  return mongoose.models.OpenRouterTopUp;
}

// ---------------------------------------------------------------------------
// GET /api/admin/openrouter/users
// List all users with their cached OR key stats.
// ---------------------------------------------------------------------------
router.get('/users', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page ?? '1', 10));
    const limit = Math.min(100, parseInt(req.query.limit ?? '50', 10));
    const skip = (page - 1) * limit;

    const users = await mongoose.models.User.find(
      {},
      {
        _id: 1,
        name: 1,
        username: 1,
        email: 1,
        role: 1,
        openrouterCreditLimit: 1,
        openrouterCreditUsed: 1,
        openrouterKeyDisabled: 1,
        openrouterKeyHash: 1,
        createdAt: 1,
      },
    )
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const total = await mongoose.models.User.countDocuments();

    return res.json({ users, total, page, limit });
  } catch (err) {
    logger.error('[adminOpenRouter] /users error:', err);
    return res.status(500).json({ error: 'Failed to list users' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/admin/openrouter/provision/:userId
// Provision (or re-provision) an OR key for a user who doesn't have one yet.
// Body: { limitUsd: number }
// ---------------------------------------------------------------------------
router.post('/provision/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const limitUsd = parseFloat(
      req.body.limitUsd ?? process.env.OPENROUTER_INITIAL_CREDIT_LIMIT ?? '5',
    );

    const user = await findUser({ _id: userId }, 'name username email openrouterKeyHash');
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const displayName = `${user.name || user.username || user.email} [LibreChat]`;
    const { hash, keyEncrypted } = await createKeyForUser(displayName, limitUsd);

    await updateUser(userId, {
      openrouterKeyHash: hash,
      openrouterKeyEncrypted: keyEncrypted,
      openrouterCreditLimit: limitUsd,
      openrouterCreditUsed: 0,
      openrouterKeyDisabled: false,
    });

    logger.info(
      `[adminOpenRouter] Key provisioned by admin ${req.user.email} for user ${user.email}`,
    );

    return res.json({ success: true, hash, creditLimit: limitUsd });
  } catch (err) {
    logger.error('[adminOpenRouter] /provision error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /api/admin/openrouter/topup
// Add credits (or create a subscription) for a user.
// Body: { userId, amount, note?, transactionType?, subscriptionMonths? }
// ---------------------------------------------------------------------------
router.post('/topup', async (req, res) => {
  try {
    const { userId, amount, note = '', transactionType = 'topup', subscriptionMonths } = req.body;

    if (!userId || !amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
      return res.status(400).json({ error: 'userId and a positive amount are required' });
    }

    const user = await findUser(
      { _id: userId },
      'name username email openrouterKeyHash openrouterCreditLimit',
    );
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    if (!user.openrouterKeyHash) {
      return res.status(400).json({
        error: 'User does not have an OpenRouter key yet. Use /provision first.',
      });
    }

    const prevLimit = user.openrouterCreditLimit ?? 0;
    const newLimit = parseFloat((prevLimit + parseFloat(amount)).toFixed(4));

    // Update limit on OpenRouter
    const keyStatus = await updateKeyLimit(user.openrouterKeyHash, newLimit);

    // Persist updated cached values
    await updateUser(userId, {
      openrouterCreditLimit: newLimit,
      openrouterKeyDisabled: false,
    });

    // Record transaction in DB
    const TopUp = getTopUpModel();
    let subscriptionExpiresAt = null;
    if (transactionType === 'subscription' && subscriptionMonths) {
      subscriptionExpiresAt = new Date();
      subscriptionExpiresAt.setMonth(
        subscriptionExpiresAt.getMonth() + parseInt(subscriptionMonths, 10),
      );
    }

    const record = await TopUp.create({
      user: userId,
      amount: parseFloat(amount),
      newLimit,
      previousLimit: prevLimit,
      note,
      addedBy: req.user._id,
      transactionType,
      subscriptionMonths: subscriptionMonths ? parseInt(subscriptionMonths, 10) : null,
      subscriptionExpiresAt,
      openrouterKeyHash: user.openrouterKeyHash,
    });

    logger.info(
      `[adminOpenRouter] Top-up by ${req.user.email}: user=${user.email}, ` +
        `+$${amount}, newLimit=$${newLimit}`,
    );

    return res.json({
      success: true,
      newLimit,
      transaction: record.toObject(),
      keyStatus,
    });
  } catch (err) {
    logger.error('[adminOpenRouter] /topup error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/admin/openrouter/key/:hash
// Fetch live key status from OpenRouter API.
// ---------------------------------------------------------------------------
router.get('/key/:hash', async (req, res) => {
  try {
    const status = await getKeyStatus(req.params.hash);

    // Also update cached values in DB
    await mongoose.models.User.updateOne(
      { openrouterKeyHash: req.params.hash },
      {
        $set: {
          openrouterCreditUsed: status.usage ?? 0,
          openrouterCreditLimit: status.limit ?? 0,
          openrouterKeyDisabled: status.disabled ?? false,
        },
      },
    );

    return res.json(status);
  } catch (err) {
    logger.error('[adminOpenRouter] /key/:hash GET error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/admin/openrouter/key/:hash
// Enable or disable a key.
// Body: { disabled: boolean }
// ---------------------------------------------------------------------------
router.patch('/key/:hash', async (req, res) => {
  try {
    const { hash } = req.params;
    const { disabled } = req.body;

    if (typeof disabled !== 'boolean') {
      return res.status(400).json({ error: 'disabled (boolean) is required' });
    }

    const status = await setKeyDisabled(hash, disabled);

    // Sync to DB
    await mongoose.models.User.updateOne(
      { openrouterKeyHash: hash },
      { $set: { openrouterKeyDisabled: disabled } },
    );

    logger.info(
      `[adminOpenRouter] Key ${hash} ${disabled ? 'disabled' : 'enabled'} by ${req.user.email}`,
    );

    return res.json({ success: true, status });
  } catch (err) {
    logger.error('[adminOpenRouter] /key/:hash PATCH error:', err);
    return res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// GET /api/admin/openrouter/topups
// Paginated list of ALL top-up transactions.
// ---------------------------------------------------------------------------
router.get('/topups', async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page ?? '1', 10));
    const limit = Math.min(100, parseInt(req.query.limit ?? '50', 10));
    const skip = (page - 1) * limit;

    const TopUp = getTopUpModel();
    const [records, total] = await Promise.all([
      TopUp.find({})
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('user', 'name username email')
        .populate('addedBy', 'name email')
        .lean(),
      TopUp.countDocuments(),
    ]);

    return res.json({ records, total, page, limit });
  } catch (err) {
    logger.error('[adminOpenRouter] /topups error:', err);
    return res.status(500).json({ error: 'Failed to load top-up history' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/admin/openrouter/topups/:userId
// Top-up history for one user.
// ---------------------------------------------------------------------------
router.get('/topups/:userId', async (req, res) => {
  try {
    const TopUp = getTopUpModel();
    const records = await TopUp.find({ user: req.params.userId })
      .sort({ createdAt: -1 })
      .populate('addedBy', 'name email')
      .lean();

    return res.json({ records });
  } catch (err) {
    logger.error('[adminOpenRouter] /topups/:userId error:', err);
    return res.status(500).json({ error: 'Failed to load user top-up history' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/admin/openrouter/reveal/:userId
// Return the decrypted plaintext OpenRouter key for a user.
// This is a sensitive operation — only available to ADMIN.
// ---------------------------------------------------------------------------
router.get('/reveal/:userId', async (req, res) => {
  try {
    const user = await mongoose.models.User.findById(req.params.userId)
      .select('+openrouterKeyEncrypted +openrouterKeyHash')
      .lean();

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    if (!user.openrouterKeyEncrypted) {
      return res.status(404).json({ error: 'User has no OpenRouter key' });
    }

    const plaintext = decryptKey(user.openrouterKeyEncrypted);

    logger.warn(
      `[adminOpenRouter] Key revealed for user ${req.params.userId} by admin ${req.user.email}`,
    );

    return res.json({ key: plaintext, hash: user.openrouterKeyHash });
  } catch (err) {
    logger.error('[adminOpenRouter] /reveal/:userId error:', err);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
