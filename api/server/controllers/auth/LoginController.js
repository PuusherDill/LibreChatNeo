const { logger } = require('@librechat/data-schemas');
const { generate2FATempToken } = require('~/server/services/twoFactorService');
const { setAuthTokens } = require('~/server/services/AuthService');
const { updateUser } = require('~/models');
const { createKeyForUser } = require('@librechat/api');

const loginController = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    if (req.user.twoFactorEnabled) {
      const tempToken = generate2FATempToken(req.user._id);
      return res.status(200).json({ twoFAPending: true, tempToken });
    }

    // Auto-provision OpenRouter key on login if missing
    if (!req.user.openrouterKeyHash) {
      try {
        const initialLimit = parseFloat(process.env.OPENROUTER_INITIAL_CREDIT_LIMIT ?? '10') || 10;
        const displayName = `${req.user.name || req.user.username || req.user.email} [LibreChat]`;
        const { hash, keyEncrypted } = await createKeyForUser(displayName, initialLimit);
        await updateUser(req.user._id.toString(), {
          openrouterKeyHash: hash,
          openrouterKeyEncrypted: keyEncrypted,
          openrouterCreditLimit: initialLimit,
          openrouterCreditUsed: 0,
          openrouterKeyDisabled: false,
        });
        req.user.openrouterKeyHash = hash;
        req.user.openrouterCreditLimit = initialLimit;
        req.user.openrouterCreditUsed = 0;
        req.user.openrouterKeyDisabled = false;
        logger.info(`[loginController] Auto-provisioned OpenRouter key for ${req.user.email}`);
      } catch (orErr) {
        logger.error(`[loginController] Failed auto-provisioning OpenRouter key: ${orErr.message}`);
      }
    }

    const { password: _p, totpSecret: _t, __v, ...user } = req.user;
    user.id = user._id.toString();

    const token = await setAuthTokens(req.user._id, res, null, req);

    return res.status(200).send({ token, user });
  } catch (err) {
    logger.error('[loginController]', err);
    return res.status(500).json({ message: 'Something went wrong' });
  }
};

module.exports = {
  loginController,
};
