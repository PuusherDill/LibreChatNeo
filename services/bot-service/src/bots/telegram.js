import { Telegraf } from 'telegraf';
import { askLibreChat } from '../utils/librechat.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('telegram');

// Map: telegram chat_id → { conversationId, parentMessageId }
const sessions = new Map();

export async function startTelegramBot() {
  const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

  bot.start((ctx) => {
    ctx.reply(
      '👋 გამარჯობა! მე LibreChat-ის ასისტენტი ვარ.\n\n' +
      'Hello! I am a LibreChat assistant.\n\n' +
      'Just send me a message and I will answer using AI! 🤖',
    );
  });

  bot.help((ctx) => {
    ctx.reply(
      '💡 Commands:\n' +
      '/start — Welcome message\n' +
      '/reset — Start a new conversation\n' +
      '/help — Show this help',
    );
  });

  bot.command('reset', (ctx) => {
    sessions.delete(ctx.chat.id);
    ctx.reply('🔄 Conversation reset. Start fresh!');
  });

  bot.on('text', async (ctx) => {
    const chatId = ctx.chat.id;
    const userText = ctx.message.text;

    logger.info({ chatId, text: userText.slice(0, 80) }, 'Telegram message received');

    // Show typing indicator
    await ctx.sendChatAction('typing');

    try {
      const session = sessions.get(chatId) || {};
      const result = await askLibreChat(userText, session.conversationId, session.parentMessageId);

      // Persist conversation threading
      sessions.set(chatId, {
        conversationId: result.conversationId,
        parentMessageId: result.messageId,
      });

      await ctx.reply(result.text, { parse_mode: 'Markdown' });
    } catch (err) {
      logger.error({ err }, 'Error calling LibreChat');
      await ctx.reply('⚠️ Sorry, something went wrong. Please try again later.');
    }
  });

  // Graceful shutdown
  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));

  await bot.launch();
  logger.info('✅ Telegram bot started');
}
