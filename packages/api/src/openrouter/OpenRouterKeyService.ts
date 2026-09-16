import { logger } from '@librechat/data-schemas';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { IOpenRouterKeyStatus } from '@librechat/data-schemas';

const OPENROUTER_API_BASE = 'https://openrouter.ai/api/v1/keys';
const ALGORITHM = 'aes-256-gcm';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getManagementKey(): string | null {
  const key = process.env.OPENROUTER_MANAGEMENT_KEY;
  if (!key || key.trim() === '') {
    return null;
  }
  return key.trim();
}

function getEncryptSecret(): Buffer {
  const secret = process.env.OPENROUTER_ENCRYPT_SECRET || 'librechat_default_openrouter_secret_key_32bytes_min';
  if (secret.length < 32) {
    const padded = secret.padEnd(32, '0');
    return Buffer.from(padded.slice(0, 32), 'utf8');
  }
  return Buffer.from(secret.slice(0, 32), 'utf8');
}

async function orFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const managementKey = getManagementKey();
  if (!managementKey) {
    throw new Error('[OpenRouterKeyService] OPENROUTER_MANAGEMENT_KEY is not set in .env.');
  }

  const cleanPath = path === '/' ? '' : path;
  const url = cleanPath.startsWith('http') ? cleanPath : `${OPENROUTER_API_BASE}${cleanPath}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${managementKey}`,
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`[OpenRouterKeyService] API error ${response.status} at ${url}: ${body}`);
  }

  return response.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Encryption / Decryption
// ---------------------------------------------------------------------------

/**
 * Encrypts a plaintext OpenRouter API key using AES-256-GCM.
 * Returns a string in the format: `<iv_hex>:<authTag_hex>:<ciphertext_hex>`.
 */
export function encryptKey(plaintext: string): string {
  const secretKey = getEncryptSecret();
  const iv = randomBytes(16);
  const cipher = createCipheriv(ALGORITHM, secretKey, iv);

  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypts a stored OpenRouter API key.
 * Accepts the `<iv_hex>:<authTag_hex>:<ciphertext_hex>` format produced by `encryptKey`.
 */
export function decryptKey(stored: string): string {
  const secretKey = getEncryptSecret();
  const parts = stored.split(':');
  if (parts.length !== 3) {
    throw new Error('[OpenRouterKeyService] Invalid encrypted key format.');
  }

  const [ivHex, authTagHex, ciphertextHex] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const ciphertext = Buffer.from(ciphertextHex, 'hex');

  const decipher = createDecipheriv(ALGORITHM, secretKey, iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

// ---------------------------------------------------------------------------
// OpenRouter Management API calls with Local/Fallback mode
// ---------------------------------------------------------------------------

interface CreateKeyResponse {
  data: {
    hash: string;
    key?: string;
    label: string;
    name: string;
    disabled: boolean;
    limit: number | null;
    limit_remaining: number | null;
    usage: number;
  };
  key?: string;
}

interface ListKeysResponse {
  data: IOpenRouterKeyStatus[];
}

interface KeyResponse {
  data: IOpenRouterKeyStatus;
}

/**
 * Creates a new OpenRouter API key for a user via the Management API or local fallback.
 *
 * @param userName   Display name for the key (e.g. user email or name)
 * @param limitUsd   Initial credit limit in USD (e.g. 5 for $5.00)
 * @param customKey  Optional custom API key provided by admin
 */
export async function createKeyForUser(
  userName: string,
  limitUsd: number,
  customKey?: string,
): Promise<{ hash: string; keyEncrypted: string }> {
  logger.info(`[OpenRouterKeyService] Creating key for user: ${userName} with limit $${limitUsd}`);

  if (customKey && customKey.trim().length > 0) {
    const hash = `or_hash_${randomBytes(12).toString('hex')}`;
    const keyEncrypted = encryptKey(customKey.trim());
    logger.info(`[OpenRouterKeyService] Custom key provisioned for ${userName}. Hash: ${hash}`);
    return { hash, keyEncrypted };
  }

  const managementKey = getManagementKey();
  if (managementKey) {
    try {
      const result = await orFetch<CreateKeyResponse>('/', {
        method: 'POST',
        body: JSON.stringify({
          name: userName,
          limit: limitUsd,
        }),
      });

      const hash = result.data?.hash;
      const key = result.key || result.data?.key;
      if (hash && key) {
        const keyEncrypted = encryptKey(key);
        logger.info(`[OpenRouterKeyService] Key created via OpenRouter API. Hash: ${hash}`);
        return { hash, keyEncrypted };
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(`[OpenRouterKeyService] OpenRouter Management API failed (${message}). Falling back to local temporary key.`);
    }
  }

  // Local temporary key fallback (when OPENROUTER_MANAGEMENT_KEY is missing or fails)
  const tempKey = process.env.OPENROUTER_KEY || process.env.OPENROUTER_API_KEY || `sk-or-v1-temp-${randomBytes(16).toString('hex')}`;
  const hash = `or_hash_temp_${randomBytes(12).toString('hex')}`;
  const keyEncrypted = encryptKey(tempKey);

  logger.info(`[OpenRouterKeyService] Local key generated for ${userName}. Hash: ${hash}`);
  return { hash, keyEncrypted };
}

/**
 * Fetches live status for a specific key by its hash.
 */
export async function getKeyStatus(keyHash: string): Promise<IOpenRouterKeyStatus> {
  const managementKey = getManagementKey();
  if (managementKey && !keyHash.startsWith('or_hash_temp_')) {
    try {
      const result = await orFetch<KeyResponse>(`/${keyHash}`);
      return result.data;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(`[OpenRouterKeyService] getKeyStatus failed for ${keyHash}: ${message}`);
    }
  }

  return {
    hash: keyHash,
    name: 'Local Key',
    label: 'Local Key',
    disabled: false,
    limit: null,
    limit_remaining: null,
    limit_reset: null,
    usage: 0,
    usage_daily: 0,
    usage_weekly: 0,
    usage_monthly: 0,
  };
}

/**
 * Updates the credit limit for a user's key.
 */
export async function updateKeyLimit(
  keyHash: string,
  newLimit: number,
): Promise<IOpenRouterKeyStatus> {
  logger.info(`[OpenRouterKeyService] Updating limit for key ${keyHash} to $${newLimit}`);

  const managementKey = getManagementKey();
  if (managementKey && !keyHash.startsWith('or_hash_temp_')) {
    try {
      const result = await orFetch<KeyResponse>(`/${keyHash}`, {
        method: 'PATCH',
        body: JSON.stringify({ limit: newLimit }),
      });
      return result.data;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(`[OpenRouterKeyService] updateKeyLimit failed for ${keyHash}: ${message}`);
    }
  }

  return {
    hash: keyHash,
    name: 'Local Key',
    label: 'Local Key',
    disabled: false,
    limit: newLimit,
    limit_remaining: newLimit,
    limit_reset: null,
    usage: 0,
    usage_daily: 0,
    usage_weekly: 0,
    usage_monthly: 0,
  };
}

/**
 * Enables or disables a user's OpenRouter key.
 */
export async function setKeyDisabled(
  keyHash: string,
  disabled: boolean,
): Promise<IOpenRouterKeyStatus> {
  logger.info(`[OpenRouterKeyService] ${disabled ? 'Disabling' : 'Enabling'} key ${keyHash}`);

  const managementKey = getManagementKey();
  if (managementKey && !keyHash.startsWith('or_hash_temp_')) {
    try {
      const result = await orFetch<KeyResponse>(`/${keyHash}`, {
        method: 'PATCH',
        body: JSON.stringify({ disabled }),
      });
      return result.data;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(`[OpenRouterKeyService] setKeyDisabled failed for ${keyHash}: ${message}`);
    }
  }

  return {
    hash: keyHash,
    name: 'Local Key',
    label: 'Local Key',
    disabled,
    limit: null,
    limit_remaining: null,
    limit_reset: null,
    usage: 0,
    usage_daily: 0,
    usage_weekly: 0,
    usage_monthly: 0,
  };
}

/**
 * Permanently deletes a key from OpenRouter.
 */
export async function deleteKey(keyHash: string): Promise<void> {
  logger.warn(`[OpenRouterKeyService] Deleting key ${keyHash}`);
  const managementKey = getManagementKey();
  if (managementKey && !keyHash.startsWith('or_hash_temp_')) {
    try {
      await orFetch<unknown>(`/${keyHash}`, { method: 'DELETE' });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(`[OpenRouterKeyService] deleteKey failed for ${keyHash}: ${message}`);
    }
  }
}

/**
 * Lists all OpenRouter keys managed by this account.
 */
export async function listAllKeys(offset = 0): Promise<IOpenRouterKeyStatus[]> {
  const managementKey = getManagementKey();
  if (managementKey) {
    try {
      const result = await orFetch<ListKeysResponse>(`?offset=${offset}`);
      return result.data;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(`[OpenRouterKeyService] listAllKeys failed: ${message}`);
    }
  }
  return [];
}

