const { createKeyForUser, decryptKey } = require('@librechat/api');
const mongoose = require('mongoose');

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  const db = mongoose.connection.db;

  const users = await db.collection('users').find({}).toArray();
  console.log(`Found ${users.length} users in DB.`);

  for (const u of users) {
    const displayName = `${u.name || u.username || u.email} [LibreChat]`;
    console.log(`Creating fresh OpenRouter key for ${u.email} (${displayName})...`);
    try {
      const res = await createKeyForUser(displayName, 10);
      const decKey = decryptKey(res.keyEncrypted);
      console.log(`SUCCESS for ${u.email}: hash=${res.hash}, key=${decKey}`);

      await db.collection('users').updateOne(
        { _id: u._id },
        {
          $set: {
            openrouterKeyHash: res.hash,
            openrouterKeyEncrypted: res.keyEncrypted,
            openrouterCreditLimit: 10,
            openrouterCreditUsed: 0,
            openrouterKeyDisabled: false,
          },
        },
      );
    } catch (err) {
      console.error(`ERROR for ${u.email}:`, err.message);
    }
  }

  process.exit(0);
}

main();
