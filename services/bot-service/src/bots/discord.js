import { Client, GatewayIntentBits, Events } from 'discord.js';
import { askLibreChat } from '../utils/librechat.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('discord');

// Map: discord channel_id → { conversationId, parentMessageId }
const sessions = new Map();

export async function startDiscordBot() {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
    ],
  });

  client.once(Events.ClientReady, (c) => {
    logger.info(`✅ Discord bot ready as ${c.user.tag}`);
  });

  client.on(Events.MessageCreate, async (message) => {
    // Ignore messages from bots (including self)
    if (message.author.bot) return;

    // Only respond to direct mentions or DMs
    const isMentioned = message.mentions.has(client.user);
    const isDM = !message.guild;
    if (!isMentioned && !isDM) return;

    // Strip the mention prefix from the text
    const userText = message.content.replace(/<@!?\d+>/g, '').trim();
    if (!userText) {
      message.reply('Please send a message! 📝');
      return;
    }

    const channelId = message.channel.id;
    logger.info({ channelId, text: userText.slice(0, 80) }, 'Discord message received');

    // Show typing indicator
    await message.channel.sendTyping();

    try {
      const session = sessions.get(channelId) || {};
      const result = await askLibreChat(userText, session.conversationId, session.parentMessageId);

      sessions.set(channelId, {
        conversationId: result.conversationId,
        parentMessageId: result.messageId,
      });

      // Discord has 2000 char limit — split if needed
      const chunks = splitMessage(result.text, 1900);
      for (const chunk of chunks) {
        await message.reply(chunk);
      }
    } catch (err) {
      logger.error({ err }, 'Error calling LibreChat');
      await message.reply('⚠️ Sorry, something went wrong. Please try again.');
    }
  });

  await client.login(process.env.DISCORD_BOT_TOKEN);
}

function splitMessage(text, maxLength) {
  if (text.length <= maxLength) return [text];
  const chunks = [];
  for (let i = 0; i < text.length; i += maxLength) {
    chunks.push(text.slice(i, i + maxLength));
  }
  return chunks;
}
