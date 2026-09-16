/**
 * User-facing OpenRouter routes for balance inspection, top-ups, and transaction history.
 *
 * All endpoints require JWT auth.
 *
 * GET  /api/openrouter/balance   Get logged-in user's OR key balance & stats
 * POST /api/openrouter/topup     Top up balance or subscribe (min $5)
 * GET  /api/openrouter/history   Get logged-in user's top-up history
 */

const express = require('express');
const mongoose = require('mongoose');
const { runAsSystem, logger } = require('@librechat/data-schemas');
const { requireJwtAuth } = require('~/server/middleware');
const { findUser, updateUser, upsertBalanceFields } = require('~/models');
const { updateKeyLimit, getKeyStatus, createKeyForUser } = require('@librechat/api');

const router = express.Router();

router.use(requireJwtAuth);

function getTopUpModel() {
  return mongoose.models.OpenRouterTopUp;
}

// ---------------------------------------------------------------------------
// GET /api/openrouter/balance
// ---------------------------------------------------------------------------
router.get('/balance', async (req, res) => {
  try {
    const userId = req.user._id;

    const user = await runAsSystem(() =>
      findUser(
        { _id: userId },
        'name username email openrouterCreditLimit openrouterCreditUsed openrouterKeyDisabled openrouterKeyHash',
      ),
    );

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const limit = user.openrouterCreditLimit ?? 0;
    const used = user.openrouterCreditUsed ?? 0;
    const remaining = Math.max(0, parseFloat((limit - used).toFixed(4)));
    const disabled = user.openrouterKeyDisabled ?? false;
    const hasKey = !!user.openrouterKeyHash;

    // Sync Mongo tokenCredits field
    runAsSystem(() => upsertBalanceFields({ user: userId, tokenCredits: remaining })).catch(() => {});

    let liveStatus = null;
    if (hasKey) {
      try {
        liveStatus = await getKeyStatus(user.openrouterKeyHash);
      } catch (e) {
        // Fallback silently if live API fails
      }
    }

    return res.json({
      hasKey,
      creditLimit: limit,
      creditUsed: used,
      remaining,
      disabled,
      liveStatus,
    });
  } catch (err) {
    logger.error('[openrouterUser] /balance error:', err);
    return res.status(500).json({ error: 'Failed to fetch OpenRouter balance' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/openrouter/topup
// Body: { amount: number, transactionType?: 'topup' | 'subscription', subscriptionMonths?: number, note?: string }
// Enforces minimum $5.00 limit.
// ---------------------------------------------------------------------------
router.post('/topup', async (req, res) => {
  try {
    const userId = req.user._id;
    const { note = '', transactionType = 'topup', subscriptionMonths } = req.body;
    const amount = parseFloat(req.body.amount);

    if (isNaN(amount) || amount < 5) {
      return res.status(400).json({ error: 'Минимальная сумма пополнения — $5.00' });
    }

    const user = await runAsSystem(() =>
      findUser(
        { _id: userId },
        'name username email openrouterKeyHash openrouterCreditLimit openrouterCreditUsed',
      ),
    );

    if (!user) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }

    let keyHash = user.openrouterKeyHash;

    // Auto-provision key if user doesn't have one yet
    if (!keyHash) {
      const displayName = `${user.name || user.username || user.email} [LibreChat]`;
      const provisioned = await createKeyForUser(displayName, amount);
      keyHash = provisioned.hash;
      await updateUser(userId, {
        openrouterKeyHash: provisioned.hash,
        openrouterKeyEncrypted: provisioned.keyEncrypted,
        openrouterCreditLimit: amount,
        openrouterCreditUsed: 0,
        openrouterKeyDisabled: false,
      });
    }

    const prevLimit = user.openrouterCreditLimit ?? 0;
    const newLimit = parseFloat((prevLimit + amount).toFixed(4));
    const newRemaining = Math.max(0, newLimit - (user.openrouterCreditUsed ?? 0));

    // Update limit on OpenRouter Management API if configured
    await updateKeyLimit(keyHash, newLimit);

    // Update local database user record and sync balances collection
    await updateUser(userId, {
      openrouterCreditLimit: newLimit,
      openrouterKeyDisabled: false,
    });
    await runAsSystem(() => upsertBalanceFields({ user: userId, tokenCredits: newRemaining }));

    // Record top-up transaction
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
      amount,
      newLimit,
      previousLimit: prevLimit,
      note: note || (transactionType === 'subscription' ? `Подписка на ${subscriptionMonths} мес.` : 'Пополнение баланса'),
      addedBy: userId,
      transactionType,
      subscriptionMonths: subscriptionMonths ? parseInt(subscriptionMonths, 10) : null,
      subscriptionExpiresAt,
      openrouterKeyHash: keyHash,
    });

    logger.info(
      `[openrouterUser] User ${req.user.email} topped up $${amount}. New limit: $${newLimit}`,
    );

    return res.json({
      success: true,
      newLimit,
      remaining: Math.max(0, newLimit - (user.openrouterCreditUsed ?? 0)),
      transaction: record.toObject(),
    });
  } catch (err) {
    logger.error('[openrouterUser] /topup error:', err);
    return res.status(500).json({ error: err.message || 'Ошибка пополнения баланса' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/openrouter/history
// Get transaction history for current logged-in user
// ---------------------------------------------------------------------------
router.get('/history', async (req, res) => {
  try {
    const userId = req.user._id;
    const TopUp = getTopUpModel();

    const records = await TopUp.find({ user: userId })
      .sort({ createdAt: -1 })
      .lean();

    return res.json({ records });
  } catch (err) {
    logger.error('[openrouterUser] /history error:', err);
    return res.status(500).json({ error: 'Failed to fetch transaction history' });
  }
});

module.exports = router;
