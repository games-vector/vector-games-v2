export interface WheelLastWinData {
  username: string;
  avatar: number | null;
  countryCode: string;
  winAmount: number;
  currency: string;
  color: string;
  multiplier: number;
  betAmount: number;
}

export const WHEEL_LAST_WIN_DATA: WheelLastWinData[] = [
  { username: 'Lucky Dragon', avatar: 1, countryCode: 'US', winAmount: 500, currency: 'USD', color: 'GREEN', multiplier: 50, betAmount: 10 },
  { username: 'Golden Tiger', avatar: 2, countryCode: 'GB', winAmount: 15, currency: 'USD', color: 'BLUE', multiplier: 5, betAmount: 3 },
  { username: 'Silver Fox', avatar: 3, countryCode: 'DE', winAmount: 6, currency: 'EUR', color: 'RED', multiplier: 3, betAmount: 2 },
  { username: 'Red Phoenix', avatar: 4, countryCode: 'JP', winAmount: 4, currency: 'USD', color: 'BLACK', multiplier: 2, betAmount: 2 },
  { username: 'Blue Storm', avatar: 5, countryCode: 'BR', winAmount: 25, currency: 'BRL', color: 'BLUE', multiplier: 5, betAmount: 5 },
  { username: 'Night Owl', avatar: 6, countryCode: 'IN', winAmount: 300, currency: 'INR', color: 'RED', multiplier: 3, betAmount: 100 },
  { username: 'Crystal Moon', avatar: 7, countryCode: 'CA', winAmount: 10, currency: 'CAD', color: 'BLUE', multiplier: 5, betAmount: 2 },
  { username: 'Thunder Wolf', avatar: 8, countryCode: 'AU', winAmount: 20, currency: 'AUD', color: 'BLACK', multiplier: 2, betAmount: 10 },
  { username: 'Cosmic Star', avatar: 1, countryCode: 'FR', winAmount: 150, currency: 'EUR', color: 'GREEN', multiplier: 50, betAmount: 3 },
  { username: 'Shadow Cat', avatar: 2, countryCode: 'KR', winAmount: 9, currency: 'USD', color: 'RED', multiplier: 3, betAmount: 3 },
  { username: 'Iron Bear', avatar: 3, countryCode: 'RU', winAmount: 14, currency: 'USD', color: 'BLACK', multiplier: 2, betAmount: 7 },
  { username: 'Neon Shark', avatar: 4, countryCode: 'MX', winAmount: 100, currency: 'MXN', color: 'BLUE', multiplier: 5, betAmount: 20 },
  { username: 'Jade Rabbit', avatar: 5, countryCode: 'CN', winAmount: 2000, currency: 'INR', color: 'GREEN', multiplier: 50, betAmount: 40 },
  { username: 'Flame Hawk', avatar: 6, countryCode: 'TR', winAmount: 30, currency: 'TRY', color: 'RED', multiplier: 3, betAmount: 10 },
  { username: 'Frost Lion', avatar: 7, countryCode: 'NG', winAmount: 4, currency: 'USD', color: 'BLACK', multiplier: 2, betAmount: 2 },
  { username: 'Spark Eagle', avatar: 8, countryCode: 'ZA', winAmount: 50, currency: 'ZAR', color: 'BLUE', multiplier: 5, betAmount: 10 },
  { username: 'Storm Panda', avatar: 1, countryCode: 'SE', winAmount: 18, currency: 'SEK', color: 'RED', multiplier: 3, betAmount: 6 },
  { username: 'Mystic Cobra', avatar: 2, countryCode: 'PL', winAmount: 8, currency: 'PLN', color: 'BLACK', multiplier: 2, betAmount: 4 },
  { username: 'Titan Crane', avatar: 3, countryCode: 'TH', winAmount: 750, currency: 'THB', color: 'GREEN', multiplier: 50, betAmount: 15 },
  { username: 'Pixel Viper', avatar: 4, countryCode: 'PH', winAmount: 25, currency: 'PHP', color: 'BLUE', multiplier: 5, betAmount: 5 },
];
