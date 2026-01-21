/**
 * Mock data for platform messages sent on connection
 * TODO: Replace with real data from services
 */

/**
 * Mock balance data
 * TODO: Replace with real balance from WalletService.getBalance()
 */
export function getMockBalance(currency: string = 'USD'): { currency: string; balance: string } {
  return {
    currency: currency,
    balance: '1000000', // TODO: Get from walletService.getBalance(agentId, userId)
  };
}

/**
 * Mock bets ranges
 * TODO: Replace with real data from betConfig or game config
 */
export function getMockBetsRanges(): Record<string, [string, string]> {
  return {
    USD: ['0.01', '200.00'],
    EUR: ['0.01', '180.00'],
    INR: ['0.01', '150.00'],
    PKR: ['0.01', '30000.00'],
    BDT: ['0.01', '2000.00'],
    BRL: ['0.01', '1000.00'],
    TZS: ['0.01', '500000.00'],
    EGP: ['0.01', '5000.00'],
    XOF: ['0.01', '600000.00'],
  };
}

/**
 * Mock bet config
 * TODO: Replace with real data from GamePlayService.getGameConfigPayload() or game config service
 */
export function getMockBetConfig(): Record<string, any> {
  return {
    USD: {
      betPresets: ['0.5', '1', '2', '5', '10', '25', '50', '100'],
      minBet: '0.01',
      maxBet: '200.00',
      maxWin: '10000.00',
      decimalPlaces: 2,
    },
    EUR: {
      betPresets: ['0.5', '1', '2', '5', '10', '25', '50', '100'],
      minBet: '0.01',
      maxBet: '180.00',
      maxWin: '9000.00',
      decimalPlaces: 2,
    },
    INR: {
      betPresets: ['5', '10', '25', '50', '100', '250', '500', '1000'],
      minBet: '0.01',
      maxBet: '150.00',
      maxWin: '7500.00',
      decimalPlaces: 2,
    },
  };
}

/**
 * Mock myData
 * TODO: Replace with real data from UserService.findOne()
 */
export function getMockMyData(userId: string, nickname?: string, gameAvatar?: number | null): {
  userId: string;
  nickname: string;
  gameAvatar: number | null;
} {
  return {
    userId: userId,
    nickname: nickname || userId, // TODO: Get from userData.username
    gameAvatar: gameAvatar ?? null, // TODO: Get from userData.avatar
  };
}

/**
 * Mock currencies (exchange rates)
 * TODO: Replace with real data from GamePlayService.getCurrencies()
 */
export function getMockCurrencies(): Record<string, number> {
  return {
    USD: 1.0,
    EUR: 0.8755,
    GBP: 0.7892,
    INR: 83.12,
    PKR: 278.5,
    BDT: 109.75,
    BRL: 4.95,
    TZS: 2515.0,
    EGP: 30.9,
    XOF: 600.0,
    LKR: 325.0,
    BWP: 13.65,
    ZWL: 26.85,
  };
}
