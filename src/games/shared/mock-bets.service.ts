import { v4 as uuidv4 } from 'uuid';
import { BetData } from './DTO/game-state.dto';

/**
 * Mock player names from chicken-road-b last-win broadcaster
 * These are more realistic than "Player1231212"
 */
const MOCK_PLAYER_NAMES = [
  'Tan Supposed Meadowlark',
  'Salmon Delighted Loon',
  'Swift Golden Falcon',
  'Bold Crimson Tiger',
  'Clever Azure Dolphin',
  'Noble Silver Wolf',
  'Brave Emerald Eagle',
  'Wise Amber Bear',
  'Fierce Ruby Panther',
  'Mystic Sapphire Hawk',
  'Royal Platinum Lion',
  'Wild Bronze Cobra',
  'Sleek Copper Shark',
  'Majestic Jade Owl',
  'Elegant Pearl Swan',
  'Thunderous Storm Raven',
  'Radiant Sun Phoenix',
  'Frosty Ice Dragon',
  'Blazing Fire Unicorn',
  'Gentle Breeze Butterfly',
  'Mighty Thunder Rhino',
  'Silent Shadow Panther',
  'Bright Lightning Cheetah',
  'Calm Ocean Whale',
  'Swift Wind Gazelle',
  'Bold Mountain Goat',
  'Clever Forest Fox',
  'Noble Desert Camel',
  'Brave Arctic Polar Bear',
  'Wise Ancient Tortoise',
  'Fierce Jungle Jaguar',
  'Mystic Mountain Yeti',
  'Royal Palace Peacock',
  'Wild Prairie Bison',
  'Sleek Ocean Stingray',
  'Majestic Sky Condor',
  'Elegant Garden Hummingbird',
  'Thunderous Storm Buffalo',
  'Radiant Dawn Rooster',
  'Frosty Winter Moose',
  'Blazing Summer Lizard',
  'Gentle Spring Robin',
  'Mighty Autumn Bear',
  'Silent Night Bat',
  'Bright Day Sparrow',
  'Calm Evening Heron',
  'Swift Morning Lark',
  'Bold Noon Vulture',
  'Clever Midnight Owl',
  'Noble Dusk Falcon',
  'Brave Dawn Eagle',
  'Wise Twilight Crow',
  'Fierce Midnight Panther',
  'Mystic Dawn Serpent',
  'Royal Noon Lion',
  'Wild Dusk Wolf',
  'Sleek Dawn Leopard',
  'Majestic Noon Tiger',
  'Elegant Dusk Cat',
  'Thunderous Dawn Horse',
  'Radiant Noon Zebra',
  'Frosty Dusk Penguin',
  'Blazing Dawn Kangaroo',
  'Gentle Noon Koala',
  'Mighty Dusk Elephant',
  'Silent Dawn Giraffe',
  'Bright Noon Hippo',
  'Calm Dusk Crocodile',
  'Swift Dawn Alligator',
  'Bold Noon Snake',
  'Clever Dusk Lizard',
  'Noble Dawn Gecko',
  'Brave Noon Iguana',
  'Wise Dusk Chameleon',
  'Fierce Dawn Monitor',
  'Mystic Noon Skink',
  'Royal Dusk Anole',
  'Wild Dawn Basilisk',
  'Sleek Noon Komodo',
  'Majestic Dusk Dragon',
  'Elegant Dawn Wyvern',
  'Thunderous Noon Griffin',
  'Radiant Dusk Sphinx',
  'Frosty Dawn Chimera',
  'Blazing Noon Hydra',
  'Gentle Dusk Cerberus',
  'Mighty Dawn Minotaur',
  'Silent Noon Centaur',
  'Bright Dusk Satyr',
  'Calm Dawn Nymph',
  'Swift Noon Dryad',
  'Bold Dusk Faun',
  'Clever Dawn Sprite',
  'Noble Noon Pixie',
  'Brave Dusk Elf',
  'Wise Dawn Fairy',
  'Fierce Noon Goblin',
  'Mystic Dusk Troll',
  'Royal Dawn Orc',
  'Wild Noon Ogre',
  'Sleek Dusk Giant',
  'Majestic Dawn Titan',
  'Elegant Noon Deity',
  'Thunderous Dusk God',
  'Radiant Dawn Goddess',
  'Frosty Noon Angel',
  'Blazing Dusk Demon',
  'Gentle Dawn Spirit',
  'Mighty Noon Ghost',
  'Silent Dusk Phantom',
  'Bright Dawn Wraith',
  'Calm Noon Specter',
  'Swift Dusk Banshee',
  'Bold Dawn Poltergeist',
  'Clever Noon Apparition',
  'Noble Dusk Entity',
  'Brave Dawn Being',
  'Wise Noon Creature',
  'Fierce Dusk Beast',
  'Mystic Dawn Monster',
  'Royal Noon Fiend',
];

/**
 * Get a random player name from the mock broadcast array
 */
export function getRandomMockPlayerName(): string {
  const randomIndex = Math.floor(Math.random() * MOCK_PLAYER_NAMES.length);
  return MOCK_PLAYER_NAMES[randomIndex];
}

/**
 * Configuration for mock bet generation
 */
export interface MockBetsConfig {
  minBetAmount: number;
  maxBetAmount: number;
  minBetsCount: number;
  maxBetsCount: number;
  targetTotalMin: number;
  targetTotalMax: number;
  highRangeChance: number; // 0-1, chance to use high range
  highRangeMin: number;
  highRangeMax: number;
  currency: string;
  gameAvatarRange: { min: number; max: number };
}

/**
 * Default mock bets configuration
 */
export const DEFAULT_MOCK_BETS_CONFIG: MockBetsConfig = {
  minBetAmount: 10,
  maxBetAmount: 3000,
  minBetsCount: 15,
  maxBetsCount: 30,
  targetTotalMin: 15000,
  targetTotalMax: 20000,
  highRangeChance: 0.1, // 10% chance
  highRangeMin: 20000,
  highRangeMax: 25000,
  currency: 'INR',
  gameAvatarRange: { min: 1, max: 50 },
};

/**
 * Generate mock bets for a crash game round
 * Uses random player names from the mock broadcast array
 */
export function generateMockBets(
  config: Partial<MockBetsConfig> = {},
): BetData[] {
  const finalConfig = { ...DEFAULT_MOCK_BETS_CONFIG, ...config };
  const mockBets: BetData[] = [];
  let currentTotal = 0;

  // Target total: use high range with configured chance, otherwise normal range
  const useHighRange = Math.random() < finalConfig.highRangeChance;
  const targetMin = useHighRange ? finalConfig.highRangeMin : finalConfig.targetTotalMin;
  const targetMax = useHighRange ? finalConfig.highRangeMax : finalConfig.targetTotalMax;
  const calculatedTargetTotal = Math.floor(Math.random() * (targetMax - targetMin + 1)) + targetMin;

  // Generate random number of bets
  const numBets = Math.floor(Math.random() * (finalConfig.maxBetsCount - finalConfig.minBetsCount + 1)) + finalConfig.minBetsCount;

  // Generate bets until we reach target total
  for (let i = 0; i < numBets; i++) {
    // If we haven't reached target, ensure remaining bets will get us there
    const remainingBets = numBets - i;
    const remainingNeeded = Math.max(0, calculatedTargetTotal - currentTotal);

    let betAmount: number;
    if (remainingNeeded > 0 && remainingBets > 0) {
      // Ensure we can reach target, but still randomize
      const minForThisBet = Math.min(finalConfig.minBetAmount, Math.floor(remainingNeeded / remainingBets));
      const maxForThisBet = Math.min(finalConfig.maxBetAmount, Math.max(minForThisBet, remainingNeeded * 2));
      betAmount = Math.floor(Math.random() * (maxForThisBet - minForThisBet + 1)) + minForThisBet;
    } else {
      // Random bet amount
      betAmount = Math.floor(Math.random() * (finalConfig.maxBetAmount - finalConfig.minBetAmount + 1)) + finalConfig.minBetAmount;
    }

    // Round to nearest multiple of 5
    betAmount = Math.round(betAmount / 5) * 5;
    // Ensure minimum
    if (betAmount < finalConfig.minBetAmount) {
      betAmount = finalConfig.minBetAmount;
    }

    currentTotal += betAmount;

    const mockUserId = `mock_${uuidv4()}`;
    const playerGameId = uuidv4();
    const nickname = getRandomMockPlayerName();
    const gameAvatar = Math.floor(
      Math.random() * (finalConfig.gameAvatarRange.max - finalConfig.gameAvatarRange.min + 1)
    ) + finalConfig.gameAvatarRange.min;

    mockBets.push({
      userId: mockUserId,
      operatorId: 'system',
      multiplayerGameId: '',
      nickname,
      currency: finalConfig.currency,
      betAmount: betAmount.toString(),
      betNumber: 0,
      gameAvatar,
      playerGameId,
    });
  }

  return mockBets;
}

/**
 * Schedule cashouts for mock bets
 * Distribution: 30% low (1.10-2.00x), 40% medium (2.00-5.00x), 20% high (5.00-10.00x), 10% very high (10.00x+)
 */
export interface MockBetCashoutSchedule {
  playerGameId: string;
  cashoutCoeff: number;
}

export function scheduleMockBetsCashouts(
  mockBets: BetData[],
  crashCoeff: number,
  cashoutPercentage: number = 0.50 + Math.random() * 0.10, // 50-60% default
): Map<string, MockBetCashoutSchedule> {
  const schedule = new Map<string, MockBetCashoutSchedule>();

  if (mockBets.length === 0) {
    return schedule;
  }

  const numBetsToCashout = Math.max(1, Math.floor(mockBets.length * cashoutPercentage));

  // Shuffle and select bets to cashout
  const shuffledBets = [...mockBets].sort(() => Math.random() - 0.5);
  const betsToCashout = shuffledBets.slice(0, numBetsToCashout);

  // Ensure crashCoeff is at least 1.10 for cashout scheduling
  const minCrashCoeff = Math.max(1.10, crashCoeff);

  for (const bet of betsToCashout) {
    // Determine cashout coefficient based on distribution
    const random = Math.random();
    let cashoutCoeff: number;

    if (random < 0.30) {
      // 30% cashout at low range (1.10-2.00x)
      cashoutCoeff = 1.10 + Math.random() * 0.90;
    } else if (random < 0.70) {
      // 40% cashout at medium range (2.00-5.00x)
      cashoutCoeff = 2.00 + Math.random() * 3.00;
    } else if (random < 0.90) {
      // 20% cashout at high range (5.00-10.00x)
      cashoutCoeff = 5.00 + Math.random() * 5.00;
    } else {
      // 10% cashout at very high range (10.00x+)
      const maxHighCoeff = Math.min(minCrashCoeff, 50.00); // Cap at 50x or crashCoeff
      cashoutCoeff = 10.00 + Math.random() * (maxHighCoeff - 10.00);
    }

    // Ensure cashout coefficient doesn't exceed crash coefficient
    cashoutCoeff = Math.min(cashoutCoeff, minCrashCoeff);
    cashoutCoeff = parseFloat(cashoutCoeff.toFixed(2));

    schedule.set(bet.playerGameId, {
      playerGameId: bet.playerGameId,
      cashoutCoeff,
    });
  }

  return schedule;
}
