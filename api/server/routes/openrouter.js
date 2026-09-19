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
    const gelPerUsd = parseFloat(process.env.GEL_PER_USD) || 2.7;
    const minTopUpGel = parseFloat(process.env.MIN_TOPUP_GEL) || 10;
    const presetPackagesGel = [15, 20, 35, 45];

    const user = await runAsSystem(() =>
      findUser(
        { _id: userId },
        'name username email openrouterCreditLimit openrouterCreditUsed openrouterKeyDisabled openrouterKeyHash',
      ),
    );

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const limitUsd = user.openrouterCreditLimit ?? 0;
    const usedUsd = user.openrouterCreditUsed ?? 0;
    const remainingUsd = Math.max(0, parseFloat((limitUsd - usedUsd).toFixed(4)));
    const disabled = user.openrouterKeyDisabled ?? false;
    const hasKey = !!user.openrouterKeyHash;

    const balanceGel = parseFloat((remainingUsd * gelPerUsd).toFixed(2));
    const limitGel = parseFloat((limitUsd * gelPerUsd).toFixed(2));
    const usedGel = parseFloat((usedUsd * gelPerUsd).toFixed(2));

    // Sync Mongo tokenCredits field
    runAsSystem(() => upsertBalanceFields(userId.toString(), { tokenCredits: remainingUsd })).catch(
      () => {},
    );

    let liveStatus = null;
    if (hasKey) {
      try {
        liveStatus = await getKeyStatus(user.openrouterKeyHash);
      } catch (_e) {
        // Fallback silently if live API fails
      }
    }

    return res.json({
      hasKey,
      creditLimit: limitUsd,
      creditUsed: usedUsd,
      remaining: remainingUsd,
      balanceGel,
      limitGel,
      usedGel,
      gelPerUsd,
      minTopUpGel,
      presetPackagesGel,
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
// Body: { amountGel?: number, amount?: number, transactionType?: 'topup' | 'subscription', subscriptionMonths?: number, note?: string }
// Enforces GEL/USD conversion and minimum GEL top-up.
// ---------------------------------------------------------------------------
router.post('/topup', async (req, res) => {
  try {
    const userId = req.user._id;
    const gelPerUsd = parseFloat(process.env.GEL_PER_USD) || 2.7;
    const minTopUpGel = parseFloat(process.env.MIN_TOPUP_GEL) || 10;
    const { note = '', transactionType = 'topup', subscriptionMonths } = req.body;

    let amountGel = parseFloat(req.body.amountGel);
    let amountUsd = parseFloat(req.body.amount);

    if (!isNaN(amountGel)) {
      if (amountGel < minTopUpGel) {
        return res.status(400).json({ error: `Минимальная сумма пополнения — ${minTopUpGel} GEL` });
      }
      amountUsd = parseFloat((amountGel / gelPerUsd).toFixed(4));
    } else if (!isNaN(amountUsd)) {
      amountGel = parseFloat((amountUsd * gelPerUsd).toFixed(2));
      if (amountGel < minTopUpGel) {
        return res.status(400).json({ error: `Минимальная сумма пополнения — ${minTopUpGel} GEL` });
      }
    } else {
      return res.status(400).json({ error: 'Укажите сумму пополнения' });
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
      const provisioned = await createKeyForUser(displayName, amountUsd);
      keyHash = provisioned.hash;
      await updateUser(userId, {
        openrouterKeyHash: provisioned.hash,
        openrouterKeyEncrypted: provisioned.keyEncrypted,
        openrouterCreditLimit: amountUsd,
        openrouterCreditUsed: 0,
        openrouterKeyDisabled: false,
      });
    }

    const prevLimitUsd = user.openrouterCreditLimit ?? 0;
    const newLimitUsd = parseFloat((prevLimitUsd + amountUsd).toFixed(4));
    const newRemainingUsd = Math.max(0, newLimitUsd - (user.openrouterCreditUsed ?? 0));
    const newRemainingGel = parseFloat((newRemainingUsd * gelPerUsd).toFixed(2));

    // Update limit on OpenRouter Management API if configured
    await updateKeyLimit(keyHash, newLimitUsd);

    // Update local database user record and sync balances collection
    await updateUser(userId, {
      openrouterCreditLimit: newLimitUsd,
      openrouterKeyDisabled: false,
    });
    await runAsSystem(() =>
      upsertBalanceFields(userId.toString(), { tokenCredits: newRemainingUsd }),
    );

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
      amount: amountUsd,
      amountGel,
      newLimit: newLimitUsd,
      previousLimit: prevLimitUsd,
      note:
        note ||
        (transactionType === 'subscription'
          ? `Подписка на ${subscriptionMonths} мес.`
          : `Пополнение на ${amountGel} GEL ($${amountUsd} USD)`),
      addedBy: userId,
      transactionType,
      subscriptionMonths: subscriptionMonths ? parseInt(subscriptionMonths, 10) : null,
      subscriptionExpiresAt,
      openrouterKeyHash: keyHash,
    });

    logger.info(
      `[openrouterUser] User ${req.user.email} topped up ${amountGel} GEL ($${amountUsd} USD). New limit: $${newLimitUsd}`,
    );

    return res.json({
      success: true,
      newLimit: newLimitUsd,
      remaining: newRemainingUsd,
      balanceGel: newRemainingGel,
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

    const records = await TopUp.find({ user: userId }).sort({ createdAt: -1 }).lean();

    return res.json({ records });
  } catch (err) {
    logger.error('[openrouterUser] /history error:', err);
    return res.status(500).json({ error: 'Ошибка загрузки истории операций' });
  }
});
// ---------------------------------------------------------------------------
// POST /api/openrouter/card-request
// Submit a manual card payment request for admin review
// ---------------------------------------------------------------------------
router.post('/card-request', async (req, res) => {
  try {
    const userId = req.user._id;
    const gelPerUsd = parseFloat(process.env.GEL_PER_USD) || 2.7;
    const minTopUpGel = parseFloat(process.env.MIN_TOPUP_GEL) || 10;
    const { amountGel: inputGel, userComment = '', transactionType = 'topup' } = req.body;

    const amountGel = parseFloat(inputGel);
    if (isNaN(amountGel) || amountGel < minTopUpGel) {
      return res.status(400).json({ error: `Минимальная сумма пополнения — ${minTopUpGel} GEL` });
    }

    const amountUsd = parseFloat((amountGel / gelPerUsd).toFixed(4));
    const user = await runAsSystem(() =>
      findUser({ _id: userId }, 'openrouterCreditLimit openrouterKeyHash'),
    );

    const prevLimitUsd = user?.openrouterCreditLimit ?? 0;
    const TopUp = getTopUpModel();

    const record = await TopUp.create({
      user: userId,
      amount: amountUsd,
      amountGel,
      previousLimit: prevLimitUsd,
      newLimit: prevLimitUsd + amountUsd,
      note: `Заявка на пополнение картой (${amountGel} GEL)`,
      addedBy: userId,
      transactionType,
      status: 'pending',
      paymentMethod: 'card',
      userComment,
      openrouterKeyHash: user?.openrouterKeyHash || '',
    });

    logger.info(
      `[openrouterUser] Card payment request created by ${req.user.email} for ${amountGel} GEL`,
    );

    return res.json({
      success: true,
      message: 'Заявка на пополнение картой успешно отправлена на проверку!',
      transaction: record.toObject(),
    });
  } catch (err) {
    logger.error('[openrouterUser] /card-request error:', err);
    return res.status(500).json({ error: err.message || 'Ошибка создания заявки' });
  }
});

module.exports = router;
