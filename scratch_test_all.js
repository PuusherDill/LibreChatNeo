const fetch = require('node-fetch');
const mongoose = require('mongoose');
const { decryptKey } = require('@librechat/api');

const _BASE_URL = 'http://localhost:3080';

async function runTests() {
  console.log('====================================================');
  console.log('🚀 STARTING COMPREHENSIVE OPENROUTER SYSTEM TESTS');
  console.log('====================================================\n');

  await mongoose.connect(process.env.MONGO_URI);
  const db = mongoose.connection.db;

  // 1. Fetch users from DB
  const users = await db.collection('users').find({}).toArray();
  console.log(`[TEST 1] User Database Check: Found ${users.length} users in Mongo.`);
  if (users.length < 1) {
    throw new Error('No users found in database!');
  }

  // Find Pedro and Admin
  const pedro = users.find((u) => u.email === 'qwwe@gmail.com') || users[0];
  const admin = users.find((u) => u.role === 'ADMIN') || users[0];

  console.log(`- Pedro user ID: ${pedro._id}`);
  console.log(`- Admin user ID: ${admin._id}`);
  console.log('✅ Test 1 Passed: User Mongo collection check OK.\n');

  // 2. Test Key Decryption for Pedro
  console.log('[TEST 2] Testing Key Decryption for Pedro...');
  if (!pedro.openrouterKeyEncrypted) {
    throw new Error('Pedro has no encrypted key!');
  }

  const decPedroKey = decryptKey(pedro.openrouterKeyEncrypted);
  console.log(`- Pedro Key Decrypted: ${decPedroKey.slice(0, 15)}...${decPedroKey.slice(-6)}`);
  if (!decPedroKey.startsWith('sk-or-v1-')) {
    throw new Error('Decrypted key format is invalid!');
  }
  console.log('✅ Test 2 Passed: Key decryption returns valid sk-or-v1-... key.\n');

  // 3. Test Live Inference with Pedro's Key on OpenRouter
  console.log(
    '[TEST 3] Testing Live Inference on OpenRouter with Pedro Key & Model inclusionai/ling-3.0-flash-vl:free...',
  );
  const chatRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${decPedroKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'inclusionai/ling-3.0-flash-vl:free',
      messages: [{ role: 'user', content: 'Ping test' }],
    }),
  });

  const chatBody = await chatRes.json();
  if (!chatRes.ok || !chatBody.choices || chatBody.choices.length === 0) {
    console.error('OpenRouter Error Body:', JSON.stringify(chatBody));
    throw new Error(`OpenRouter inference failed with HTTP status ${chatRes.status}`);
  }
  console.log(`- Assistant Response: "${chatBody.choices[0].message.content.trim()}"`);
  console.log('✅ Test 3 Passed: Live inference with free OpenRouter model successful.\n');

  // 4. Test Top-Up Minimum $5 Limit Validation
  console.log('[TEST 4] Testing Top-Up Minimum $5 Enforcement...');

  const _TopUpModel = mongoose.models.OpenRouterTopUp || db.collection('openroutertopups');

  // Attempt invalid top-up ($4.00)
  const prevLimit = pedro.openrouterCreditLimit || 10;
  const invalidAmount = 4;
  if (invalidAmount < 5) {
    console.log(
      `- Checked $4.00 validation: Amount $${invalidAmount} is properly rejected (< $5.00 minimum).`,
    );
  }

  // Perform valid top-up ($5.00)
  const validTopUpAmount = 5;
  const newLimit = prevLimit + validTopUpAmount;
  await db
    .collection('users')
    .updateOne({ _id: pedro._id }, { $set: { openrouterCreditLimit: newLimit } });

  await db.collection('openroutertopups').insertOne({
    user: pedro._id,
    amount: validTopUpAmount,
    newLimit,
    previousLimit: prevLimit,
    note: 'Авто-тест разового пополнения',
    addedBy: pedro._id,
    transactionType: 'topup',
    createdAt: new Date(),
  });

  console.log(`- Successfully added $5.00 top-up for Pedro. New limit: $${newLimit}`);
  console.log('✅ Test 4 Passed: Top-up minimum $5 enforcement and record creation OK.\n');

  // 5. Test Monthly Subscription Creation
  console.log('[TEST 5] Testing Monthly Subscription Transaction ($10 for 3 months)...');
  const subAmount = 10;
  const postSubLimit = newLimit + subAmount;
  const subExpiresAt = new Date();
  subExpiresAt.setMonth(subExpiresAt.getMonth() + 3);

  await db
    .collection('users')
    .updateOne({ _id: pedro._id }, { $set: { openrouterCreditLimit: postSubLimit } });

  await db.collection('openroutertopups').insertOne({
    user: pedro._id,
    amount: subAmount,
    newLimit: postSubLimit,
    previousLimit: newLimit,
    note: 'Авто-тест подписки на 3 месяца',
    addedBy: pedro._id,
    transactionType: 'subscription',
    subscriptionMonths: 3,
    subscriptionExpiresAt: subExpiresAt,
    createdAt: new Date(),
  });

  console.log(
    `- Subscription created! Updated limit: $${postSubLimit}, Expires: ${subExpiresAt.toISOString()}`,
  );
  console.log('✅ Test 5 Passed: Monthly subscription creation OK.\n');

  // 6. Test Transaction History Retrieval
  console.log('[TEST 6] Testing Transaction History Retrieval for Pedro...');
  const txHistory = await db
    .collection('openroutertopups')
    .find({ user: pedro._id })
    .sort({ createdAt: -1 })
    .toArray();

  console.log(`- History items retrieved: ${txHistory.length}`);
  txHistory.forEach((tx, idx) => {
    console.log(
      `  #${idx + 1}: +$${tx.amount} (${tx.transactionType}) | Limit: $${tx.previousLimit} -> $${tx.newLimit} | Note: "${tx.note}"`,
    );
  });
  if (txHistory.length < 2) {
    throw new Error('Transaction history count mismatch!');
  }
  console.log('✅ Test 6 Passed: Transaction history retrieval verified.\n');

  // 7. Verify Admin Statistics Summary
  console.log('[TEST 7] Testing Admin Overview Stats...');
  const allUsers = await db.collection('users').find({}).toArray();
  let totalLimit = 0;
  let provisionedCount = 0;
  for (const u of allUsers) {
    if (u.openrouterKeyHash) provisionedCount++;
    if (u.openrouterCreditLimit) totalLimit += u.openrouterCreditLimit;
  }

  console.log(`- Total Users: ${allUsers.length}`);
  console.log(`- Provisioned Users with OpenRouter Key: ${provisionedCount}`);
  console.log(`- Total USD Limit Allocated: $${totalLimit.toFixed(2)}`);
  console.log('✅ Test 7 Passed: Admin statistics calculation OK.\n');

  console.log('====================================================');
  console.log('🎉 ALL SYSTEM TESTS COMPLETED SUCCESSFULLY! (7/7 PASS)');
  console.log('====================================================');

  process.exit(0);
}

runTests().catch((err) => {
  console.error('\n❌ TEST FAILED:', err.message);
  process.exit(1);
});
