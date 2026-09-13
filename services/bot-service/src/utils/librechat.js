import axios from 'axios';
import { createLogger } from './logger.js';

const logger = createLogger('librechat-api');

const LIBRECHAT_URL = process.env.LIBRECHAT_API_URL || 'http://api:3080';
const BOT_EMAIL = process.env.BOT_USER_EMAIL;
const BOT_PASSWORD = process.env.BOT_USER_PASSWORD;

let authToken = null;
let tokenExpiry = 0;

/**
 * Authenticate bot user against LibreChat and return JWT token.
 * Token is cached until near expiry.
 */
async function getAuthToken() {
  if (authToken && Date.now() < tokenExpiry) return authToken;

  logger.debug('Refreshing LibreChat auth token...');
  const res = await axios.post(`${LIBRECHAT_URL}/api/auth/login`, {
    email: BOT_EMAIL,
    password: BOT_PASSWORD,
  });

  authToken = res.data.token;
  // expire 5 minutes before actual expiry (tokens last ~1 day)
  tokenExpiry = Date.now() + 23 * 60 * 60 * 1000;
  logger.info('LibreChat auth token refreshed');
  return authToken;
}

/**
 * Send a message to LibreChat and return the AI response text.
 * @param {string} userMessage - The user's message text
 * @param {string} conversationId - Optional existing conversation ID
 * @param {string} parentMessageId - Optional parent message ID for threading
 */
export async function askLibreChat(userMessage, conversationId = null, parentMessageId = null) {
  const token = await getAuthToken();

  const payload = {
    text: userMessage,
    endpoint: process.env.BOT_ENDPOINT || 'google',
    model: process.env.BOT_MODEL || 'gemini-2.0-flash',
    ...(conversationId && { conversationId }),
    ...(parentMessageId && { parentMessageId }),
  };

  const res = await axios.post(`${LIBRECHAT_URL}/api/ask/${payload.endpoint}`, payload, {
    headers: { Authorization: `Bearer ${token}` },
    timeout: 60000,
  });

  return {
    text: res.data?.text || res.data?.response || 'No response',
    conversationId: res.data?.conversationId,
    messageId: res.data?.messageId,
  };
}
