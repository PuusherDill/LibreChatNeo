import { logger } from '@librechat/data-schemas';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { IOpenRouterKeyStatus } from '@librechat/data-schemas';

const OPENROUTER_API_BASE = 'https://openrouter.ai/api/v1/keys';
const ALGORITHM = 'aes-256-gcm';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getManagementKey(): string {
  const key = process.env.OPENROUTER_MANAGEMENT_KEY;
  if (!key) {
    throw new Error(
      '[OpenRouterKeyService] OPENROUTER_MANAGEMENT_KEY is not set in .env. ' +
        'Create a management key at https://openrouter.ai/settings/management-keys',
    );
  }
  return key;
}

function getEncryptSecret(): Buffer {
  const secret = process.env.OPENROUTER_ENCRYPT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      '[OpenRouterKeyService] OPENROUTER_ENCRYPT_SECRET must be at least 32 characters long. ' +
        'Set it in .env to encrypt OpenRouter keys in the database.',
    );
  }
  return Buffer.from(secret.slice(0, 32), 'utf8');
}

async function orFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const managementKey = getManagementKey();
  const url = path.startsWith('http') ? path : `${OPENROUTER_API_BASE}${path}`;

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
// OpenRouter Management API calls
// ---------------------------------------------------------------------------

interface CreateKeyResponse {
  data: {
    hash: string;
    /** Plaintext key – returned ONLY on creation, never again */
    key: string;
    label: string;
    name: string;
    disabled: boolean;
    limit: number | null;
    limit_remaining: number | null;
    usage: number;
  };
}

interface ListKeysResponse {
  data: IOpenRouterKeyStatus[];
}

interface KeyResponse {
  data: IOpenRouterKeyStatus;
}

/**
 * Creates a new OpenRouter API key for a user via the Management API.
 * Returns the key hash (for future management) and the encrypted plaintext key
 * (for authenticating the user's chat requests).
 *
 * @param userName  Display name for the key (e.g. user email or name)
 * @param limitUsd  Initial credit limit in USD (e.g. 5 for $5.00)
 */
export async function createKeyForUser(
  userName: string,
  limitUsd: number,
): Promise<{ hash: string; keyEncrypted: string }> {
  logger.info(`[OpenRouterKeyService] Creating key for user: ${userName} with limit $${limitUsd}`);

  const result = await orFetch<CreateKeyResponse>('/', {
    method: 'POST',
    body: JSON.stringify({
      name: userName,
      limit: limitUsd,
    }),
  });

  const { hash, key } = result.data;
  if (!hash || !key) {
    throw new Error('[OpenRouterKeyService] OpenRouter did not return hash or key.');
  }

  const keyEncrypted = encryptKey(key);
  logger.info(`[OpenRouterKeyService] Key created successfully. Hash: ${hash}`);

  return { hash, keyEncrypted };
}

/**
 * Fetches live status for a specific key by its hash.
 * Used in the admin panel to show real-time usage data.
 */
export async function getKeyStatus(keyHash: string): Promise<IOpenRouterKeyStatus> {
  const result = await orFetch<KeyResponse>(`/${keyHash}`);
  return result.data;
}

/**
 * Updates the credit limit for a user's key.
 * Called when an admin tops up a user's balance via the admin panel.
 *
 * @param keyHash   The key's hash (stored in user.openrouterKeyHash)
 * @param newLimit  New absolute credit limit in USD (NOT an increment — replaces the current value)
 */
export async function updateKeyLimit(
  keyHash: string,
  newLimit: number,
): Promise<IOpenRouterKeyStatus> {
  logger.info(`[OpenRouterKeyService] Updating limit for key ${keyHash} to $${newLimit}`);

  const result = await orFetch<KeyResponse>(`/${keyHash}`, {
    method: 'PATCH',
    body: JSON.stringify({ limit: newLimit }),
  });

  return result.data;
}

/**
 * Enables or disables a user's OpenRouter key.
 * When disabled, the user cannot make AI requests until re-enabled.
 */
export async function setKeyDisabled(
  keyHash: string,
  disabled: boolean,
): Promise<IOpenRouterKeyStatus> {
  logger.info(`[OpenRouterKeyService] ${disabled ? 'Disabling' : 'Enabling'} key ${keyHash}`);

  const result = await orFetch<KeyResponse>(`/${keyHash}`, {
    method: 'PATCH',
    body: JSON.stringify({ disabled }),
  });

  return result.data;
}

/**
 * Permanently deletes a key from OpenRouter.
 * Use with caution – the user will lose access immediately.
 */
export async function deleteKey(keyHash: string): Promise<void> {
  logger.warn(`[OpenRouterKeyService] Deleting key ${keyHash}`);
  await orFetch<unknown>(`/${keyHash}`, { method: 'DELETE' });
}

/**
 * Lists all OpenRouter keys managed by this account.
 * Used by the admin panel to sync data from OpenRouter.
 *
 * @param offset  Pagination offset (100 keys per page)
 */
export async function listAllKeys(offset = 0): Promise<IOpenRouterKeyStatus[]> {
  const result = await orFetch<ListKeysResponse>(`?offset=${offset}`);
  return result.data;
}
