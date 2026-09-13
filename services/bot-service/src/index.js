import 'dotenv/config';
import { createLogger } from './utils/logger.js';
import { startTelegramBot } from './bots/telegram.js';
import { startDiscordBot } from './bots/discord.js';

const logger = createLogger('main');

async function main() {
  logger.info('🚀 LibreChat Bot Service starting...');

  const enabled = [];

  if (process.env.TELEGRAM_BOT_TOKEN) {
    await startTelegramBot();
    enabled.push('Telegram');
  }

  if (process.env.DISCORD_BOT_TOKEN) {
    await startDiscordBot();
    enabled.push('Discord');
  }

  if (enabled.length === 0) {
    logger.warn('⚠️  No bots configured. Set TELEGRAM_BOT_TOKEN or DISCORD_BOT_TOKEN in .env');
  } else {
    logger.info(`✅ Active bots: ${enabled.join(', ')}`);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
