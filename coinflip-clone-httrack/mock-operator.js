const express = require('express');
const app = express();
app.use(express.json());

// Mock wallet balances
const wallets = {};

// Initialize wallet for a user
function getWallet(userId, currency = 'INR') {
  const key = `${userId}:${currency}`;
  if (!wallets[key]) {
    wallets[key] = {
      balance: 1000000.00, // Starting balance: 1 million
      currency: currency
    };
  }
  return wallets[key];
}

/**
 * Mock Operator Callback Endpoint
 *
 * The wallet service sends requests in the format:
 * { key: cert, message: JSON.stringify({ action: string, ... }) }
 *
 * Actions:
 * - getBalance: { action: 'getBalance', userId }
 * - bet: { action: 'bet', txns: [{ platformTxId, userId, betAmount, currency, ... }] }
 * - settle: { action: 'settle', txns: [{ platformTxId, userId, winAmount, ... }] }
 * - cancelBet: { action: 'cancelBet', txns: [...] }
 */
app.post('/callback', (req, res) => {
  let messageObj;

  try {
    // Parse the message from the request
    if (req.body.message) {
      messageObj = typeof req.body.message === 'string'
        ? JSON.parse(req.body.message)
        : req.body.message;
    } else {
      // Fallback for direct action format
      messageObj = req.body;
    }
  } catch (e) {
    console.error('[MOCK_OPERATOR] Failed to parse message:', e.message);
    return res.json({ status: '9999', message: 'Invalid message format' });
  }

  const { action } = messageObj;
  console.log(`[MOCK_OPERATOR] Received action: ${action}`);
  console.log(`[MOCK_OPERATOR] Message:`, JSON.stringify(messageObj, null, 2));

  // Handle getBalance
  if (action === 'getBalance') {
    const { userId } = messageObj;
    const wallet = getWallet(userId);
    console.log(`[MOCK_OPERATOR] getBalance for user=${userId}: ${wallet.balance} ${wallet.currency}`);
    return res.json({
      status: '0000',
      balance: wallet.balance.toFixed(2),
      currency: wallet.currency
    });
  }

  // Handle bet (placeBet)
  if (action === 'bet') {
    const { txns } = messageObj;
    if (!txns || !txns.length) {
      return res.json({ status: '9999', message: 'No transactions provided' });
    }

    const txn = txns[0]; // Process first transaction
    const { userId, betAmount, currency = 'INR', platformTxId } = txn;
    const wallet = getWallet(userId, currency);
    const betAmountNum = parseFloat(betAmount);

    if (wallet.balance < betAmountNum) {
      console.log(`[MOCK_OPERATOR] Insufficient balance: ${wallet.balance} < ${betAmountNum}`);
      return res.json({
        status: '1001',
        message: 'Insufficient balance'
      });
    }

    wallet.balance -= betAmountNum;
    console.log(`[MOCK_OPERATOR] Bet placed: -${betAmountNum} ${currency}, new balance: ${wallet.balance}`);

    return res.json({
      status: '0000',
      balance: wallet.balance.toFixed(2),
      balanceTs: new Date().toISOString(),
      currency: currency,
      platformTxId: platformTxId
    });
  }

  // Handle settle (settleBet)
  if (action === 'settle') {
    const { txns } = messageObj;
    if (!txns || !txns.length) {
      return res.json({ status: '9999', message: 'No transactions provided' });
    }

    const txn = txns[0];
    const { userId, winAmount, currency = 'INR', platformTxId } = txn;
    const wallet = getWallet(userId, currency);
    const winAmountNum = parseFloat(winAmount || 0);

    wallet.balance += winAmountNum;
    console.log(`[MOCK_OPERATOR] Bet settled: +${winAmountNum} ${currency}, new balance: ${wallet.balance}`);

    return res.json({
      status: '0000',
      balance: wallet.balance.toFixed(2),
      balanceTs: new Date().toISOString(),
      currency: currency,
      platformTxId: platformTxId
    });
  }

  // Handle cancelBet (refund)
  if (action === 'cancelBet') {
    const { txns } = messageObj;
    if (!txns || !txns.length) {
      return res.json({ status: '9999', message: 'No transactions provided' });
    }

    const txn = txns[0];
    const { userId, betAmount, currency = 'INR', platformTxId } = txn;
    const wallet = getWallet(userId, currency);
    const refundAmount = parseFloat(betAmount || 0);

    wallet.balance += refundAmount;
    console.log(`[MOCK_OPERATOR] Bet cancelled: +${refundAmount} ${currency}, new balance: ${wallet.balance}`);

    return res.json({
      status: '0000',
      balance: wallet.balance.toFixed(2),
      balanceTs: new Date().toISOString(),
      currency: currency,
      platformTxId: platformTxId
    });
  }

  // Unknown action
  console.log(`[MOCK_OPERATOR] Unknown action: ${action}`);
  res.json({
    status: '9999',
    message: `Unknown action: ${action}`
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', wallets: Object.keys(wallets).length });
});

const PORT = 3001;
app.listen(PORT, () => {
  console.log('');
  console.log('==========================================');
  console.log('  Mock Operator Service for Development');
  console.log('==========================================');
  console.log(`  Server: http://localhost:${PORT}`);
  console.log(`  Callback: http://localhost:${PORT}/callback`);
  console.log(`  Health: http://localhost:${PORT}/health`);
  console.log('');
  console.log('  Starting balance: 1,000,000 per user');
  console.log('==========================================');
  console.log('');
});
