/**
 * Last Win Data interface for Keno game
 */
export interface KenoLastWinData {
  username: string;
  avatar: string | null;
  countryCode: string;
  winAmount: string;
  currency: string;
  risk: string;
  chosenCount: number;
  hitCount: number;
  multiplier: string;
}

/**
 * Mock last win data for Keno game
 * Shows realistic wins across different risk levels and selection counts
 */
export const KENO_LAST_WIN_DATA: KenoLastWinData[] = [
  { username: 'Lucky Dragon', avatar: null, countryCode: 'US', winAmount: '500.00', currency: 'USD', risk: 'HIGH', chosenCount: 10, hitCount: 8, multiplier: '500x' },
  { username: 'Fortune Tiger', avatar: null, countryCode: 'IN', winAmount: '150.00', currency: 'USD', risk: 'MEDIUM', chosenCount: 6, hitCount: 5, multiplier: '25x' },
  { username: 'Golden Phoenix', avatar: null, countryCode: 'UK', winAmount: '75.00', currency: 'GBP', risk: 'LOW', chosenCount: 5, hitCount: 4, multiplier: '10x' },
  { username: 'Silver Wolf', avatar: null, countryCode: 'CA', winAmount: '300.00', currency: 'CAD', risk: 'HIGH', chosenCount: 7, hitCount: 6, multiplier: '80x' },
  { username: 'Jade Rabbit', avatar: null, countryCode: 'AU', winAmount: '45.00', currency: 'AUD', risk: 'LOW', chosenCount: 3, hitCount: 3, multiplier: '5x' },
  { username: 'Ruby Eagle', avatar: null, countryCode: 'DE', winAmount: '200.00', currency: 'EUR', risk: 'MEDIUM', chosenCount: 8, hitCount: 6, multiplier: '30x' },
  { username: 'Sapphire Bear', avatar: null, countryCode: 'JP', winAmount: '1250.00', currency: 'JPY', risk: 'HIGH', chosenCount: 9, hitCount: 7, multiplier: '100x' },
  { username: 'Diamond Lion', avatar: null, countryCode: 'BR', winAmount: '890.45', currency: 'BRL', risk: 'MEDIUM', chosenCount: 5, hitCount: 4, multiplier: '10x' },
  { username: 'Emerald Hawk', avatar: null, countryCode: 'FR', winAmount: '567.80', currency: 'EUR', risk: 'LOW', chosenCount: 4, hitCount: 4, multiplier: '10x' },
  { username: 'Platinum Panther', avatar: null, countryCode: 'IT', winAmount: '1000.00', currency: 'EUR', risk: 'HIGH', chosenCount: 10, hitCount: 9, multiplier: '1000x' },
  { username: 'Bronze Cobra', avatar: null, countryCode: 'ES', winAmount: '38.96', currency: 'EUR', risk: 'LOW', chosenCount: 2, hitCount: 2, multiplier: '4.1x' },
  { username: 'Copper Shark', avatar: null, countryCode: 'MX', winAmount: '71.23', currency: 'MXN', risk: 'MEDIUM', chosenCount: 4, hitCount: 3, multiplier: '6x' },
  { username: 'Jade Owl', avatar: null, countryCode: 'CN', winAmount: '2340.50', currency: 'CNY', risk: 'HIGH', chosenCount: 6, hitCount: 5, multiplier: '50x' },
  { username: 'Pearl Swan', avatar: null, countryCode: 'KR', winAmount: '1567.00', currency: 'KRW', risk: 'MEDIUM', chosenCount: 7, hitCount: 5, multiplier: '15x' },
  { username: 'Storm Raven', avatar: null, countryCode: 'RU', winAmount: '1234.56', currency: 'RUB', risk: 'LOW', chosenCount: 8, hitCount: 6, multiplier: '15x' },
  { username: 'Sun Phoenix', avatar: null, countryCode: 'AE', winAmount: '2345.67', currency: 'AED', risk: 'HIGH', chosenCount: 5, hitCount: 5, multiplier: '50x' },
  { username: 'Ice Dragon', avatar: null, countryCode: 'SE', winAmount: '678.90', currency: 'SEK', risk: 'MEDIUM', chosenCount: 3, hitCount: 3, multiplier: '8x' },
  { username: 'Fire Unicorn', avatar: null, countryCode: 'NO', winAmount: '789.12', currency: 'NOK', risk: 'LOW', chosenCount: 6, hitCount: 5, multiplier: '13x' },
  { username: 'Breeze Butterfly', avatar: null, countryCode: 'NL', winAmount: '456.78', currency: 'EUR', risk: 'HIGH', chosenCount: 4, hitCount: 4, multiplier: '40x' },
  { username: 'Thunder Rhino', avatar: null, countryCode: 'ZA', winAmount: '1234.56', currency: 'ZAR', risk: 'MEDIUM', chosenCount: 9, hitCount: 7, multiplier: '60x' },
  { username: 'Shadow Panther', avatar: null, countryCode: 'TR', winAmount: '3456.78', currency: 'TRY', risk: 'LOW', chosenCount: 10, hitCount: 7, multiplier: '50x' },
  { username: 'Lightning Cheetah', avatar: null, countryCode: 'PL', winAmount: '567.89', currency: 'PLN', risk: 'HIGH', chosenCount: 3, hitCount: 3, multiplier: '15x' },
  { username: 'Ocean Whale', avatar: null, countryCode: 'GR', winAmount: '445.67', currency: 'EUR', risk: 'MEDIUM', chosenCount: 2, hitCount: 2, multiplier: '5x' },
  { username: 'Wind Gazelle', avatar: null, countryCode: 'PT', winAmount: '389.45', currency: 'EUR', risk: 'LOW', chosenCount: 1, hitCount: 1, multiplier: '2.85x' },
  { username: 'Mountain Goat', avatar: null, countryCode: 'CH', winAmount: '10000.00', currency: 'CHF', risk: 'HIGH', chosenCount: 10, hitCount: 10, multiplier: '10000x' },
  { username: 'Forest Fox', avatar: null, countryCode: 'BE', winAmount: '456.78', currency: 'EUR', risk: 'MEDIUM', chosenCount: 6, hitCount: 5, multiplier: '25x' },
  { username: 'Desert Camel', avatar: null, countryCode: 'EG', winAmount: '234.56', currency: 'EGP', risk: 'LOW', chosenCount: 7, hitCount: 5, multiplier: '10x' },
  { username: 'Arctic Bear', avatar: null, countryCode: 'FI', winAmount: '567.89', currency: 'EUR', risk: 'HIGH', chosenCount: 8, hitCount: 6, multiplier: '50x' },
  { username: 'Ancient Tortoise', avatar: null, countryCode: 'TH', winAmount: '3456.78', currency: 'THB', risk: 'MEDIUM', chosenCount: 4, hitCount: 4, multiplier: '20x' },
  { username: 'Jungle Jaguar', avatar: null, countryCode: 'ID', winAmount: '2345.67', currency: 'IDR', risk: 'LOW', chosenCount: 9, hitCount: 7, multiplier: '30x' },
];
