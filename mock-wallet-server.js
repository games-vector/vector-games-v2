const http = require('http');

const server = http.createServer((req, res) => {
  let body = '';

  req.on('data', chunk => {
    body += chunk.toString();
  });

  req.on('end', () => {
    console.log(`[Mock Wallet] ${req.method} ${req.url}`);
    if (body) {
      try {
        const parsed = JSON.parse(body);
        console.log(`[Mock Wallet] Request:`, JSON.stringify(parsed, null, 2));
      } catch (e) {
        console.log(`[Mock Wallet] Body:`, body);
      }
    }

    // Always return success with a mock balance
    const response = {
      status: '0000',
      balance: 999999.70, // Simulated balance after bet
      currency: 'INR',
      txId: 'mock-' + Date.now()
    };

    console.log(`[Mock Wallet] Response:`, JSON.stringify(response));

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(response));
  });
});

const PORT = 3001;
server.listen(PORT, () => {
  console.log(`[Mock Wallet] Server running on http://localhost:${PORT}`);
  console.log(`[Mock Wallet] Ready to handle wallet callbacks`);
});
