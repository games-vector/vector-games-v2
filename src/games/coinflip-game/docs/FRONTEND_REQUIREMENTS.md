# CoinFlip Game - Frontend Requirements Document

## Overview
This document defines the complete frontend requirements for cloning the CoinFlip game UI, based on analysis of the existing implementation at `coinflip.inout.games`. The frontend must be consistent with the backend REQUIREMENTS.md and follow the ARCHITECTURE_AND_ONBOARDING.md patterns.

---

## 1. Technology Stack

### Recommended Stack
- **Framework**: React 18+ or Vue 3+
- **Build Tool**: Vite
- **State Management**: Zustand / Pinia or Context API
- **Styling**: TailwindCSS or Styled Components
- **Animations**: Framer Motion / GSAP / CSS Animations
- **WebSocket**: Socket.IO Client v4
- **Language**: TypeScript

### Browser Support
- Chrome 90+
- Firefox 90+
- Safari 14+
- Edge 90+
- Mobile browsers (iOS Safari, Chrome Mobile)

---

## 2. Page Structure & Layout

### 2.1 Overall Layout
```
┌─────────────────────────────────────────────────────────┐
│                    HEADER BAR                           │
│  [Logo] [How to play?] [Balance: $999,999.7] [⛶] [≡]   │
├─────────────────────────────────────────────────────────┤
│                                                         │
│                   GAME AREA                             │
│                                                         │
│              [Round Counter]  [Multiplier]              │
│                                                         │
│                    [COIN]                               │
│                                                         │
│          [HEAD Button]    [TAIL Button]                 │
│                                                         │
│              [Result History Trail]                     │
│                                                         │
├─────────────────────────────────────────────────────────┤
│                  CONTROLS PANEL                         │
│  [Bet Amount Input] [Game Mode Toggle] [Action Button]  │
└─────────────────────────────────────────────────────────┘
```

### 2.2 Responsive Breakpoints
| Breakpoint | Width | Layout |
|------------|-------|--------|
| Mobile | < 640px | Single column, stacked controls |
| Tablet | 640px - 1024px | Adjusted spacing |
| Desktop | > 1024px | Full layout as shown |

---

## 3. Component Specifications

### 3.1 Header Component

#### Logo
- Position: Top-left
- Text: "COINFLIP" with coin icon replacing "O"
- Color: Red/Orange gradient (#FF4444 to #FF8800)
- Font: Bold, custom gaming font

#### "How to play?" Button
- Icon: Info circle (ⓘ)
- Opens modal with game rules
- Background: Dark semi-transparent

#### Balance Display
- Format: `999 999.7` (space as thousand separator)
- Currency icon: Dollar ($) in circle
- Real-time updates via WebSocket

#### Fullscreen Toggle
- Icon: Expand arrows (⛶)
- Toggles browser fullscreen mode

#### Menu Button (Hamburger)
- Icon: Three horizontal lines (≡)
- Opens slide-out menu panel

### 3.2 Menu Panel (Slide-out)

#### Menu Items
1. **User Info Section**
   - Avatar image (circular)
   - Username/Nickname
   - "Change avatar" link

2. **Settings**
   - Sound toggle (ON/OFF)
   - Music toggle (ON/OFF)
   - Animation toggle (ON/OFF)

3. **Navigation**
   - "Provably fair settings" → Opens fairness modal
   - "Game rules" → Opens rules modal
   - "My bet history" → Opens history modal

4. **Footer**
   - "Powered by" branding

### 3.3 Game Area

#### Round Counter (ROUNDS Mode)
- Display: `0 / 20`
- Label: "ROUND"
- Updates after each step
- Hidden in QUICK mode

#### Multiplier Display
- Format: `x1.94`
- Label: "MULTIPLIER"
- Updates based on current round
- Multiplier ladder:
  ```
  Round 1:  x1.94
  Round 2:  x3.88
  Round 3:  x7.76
  Round 4:  x15.52
  Round 5:  x31.04
  ...up to...
  Round 20: x1,017,118.72
  ```

#### Main Coin Display
- Large central coin image
- Animated flip on result
- Two states: HEADS (anchor icon) / TAILS (skull icon)
- Glow effect: Red/pink radial gradient behind coin
- Theme: Pirate/treasure map aesthetic

#### Choice Buttons
- **HEAD Button**
  - Left position
  - Shows coin icon (HEADS side)
  - Text: "HEAD"
  - Subtext: Potential win amount (e.g., "$ 0.58")
  - Background: Dark brown (#3D3428)
  - Border: Golden outline on hover

- **TAIL Button**
  - Right position
  - Shows coin icon (TAILS side)
  - Text: "TAIL"
  - Subtext: Potential win amount
  - Same styling as HEAD button

#### Result History Trail
- Position: Below choice buttons, horizontal scroll
- Shows last N flip results as small coin icons
- Scrollable left/right with arrow buttons
- Each icon represents HEADS or TAILS

### 3.4 Controls Panel

#### Bet Amount Section
- **MIN Button**: Sets minimum bet (0.01)
- **Amount Input**: Editable text field
  - Default: 0.3
  - Numeric keyboard on mobile
- **MAX Button**: Sets maximum bet (200.00)
- **Preset Buttons**: 0.5, 1, 2, 7 (with $ icon)

#### Game Mode Toggle
- Label: "Game mode"
- Two options:
  - **Multiply** (ROUNDS mode): Shows "Round — 20"
  - **Instant** (QUICK mode): Single flip

#### Win Amount Display
- Text: "You win – $ X.XX"
- Shows calculated potential win: `betAmount × multiplier`
- Updates dynamically

#### Action Button
- Primary CTA button
- States:
  - **CHOOSE THE OUTCOME**: Initial state (disabled until choice made)
  - **HEAD / TAIL**: After selecting choice (green, enabled)
  - **CASHOUT**: In ROUNDS mode after winning (green)
  - **Loading**: During API call (spinner)
- Background: Green (#4CAF50) when active
- Full width at bottom

---

## 4. Visual Design Specifications

### 4.1 Color Palette
```css
/* Primary Colors */
--color-primary: #FF4444;        /* Red accent */
--color-secondary: #FFB800;      /* Gold/Yellow */
--color-success: #4CAF50;        /* Green for wins/CTA */
--color-danger: #F44336;         /* Red for losses */

/* Background Colors */
--bg-dark: #1A1A2E;              /* Dark purple/navy */
--bg-panel: #2D2D44;             /* Panel background */
--bg-input: #3D3D5C;             /* Input fields */
--bg-button: #3D3428;            /* Button background */

/* Text Colors */
--text-primary: #FFFFFF;         /* White */
--text-secondary: #B0B0B0;       /* Gray */
--text-gold: #FFD700;            /* Gold highlights */

/* Game Theme */
--map-bg: #C4A574;               /* Treasure map tan */
--map-dark: #8B6914;             /* Map shadows */
```

### 4.2 Typography
```css
/* Font Family */
--font-primary: 'Poppins', sans-serif;
--font-gaming: 'Russo One', sans-serif;  /* For headers/logo */

/* Font Sizes */
--text-xs: 12px;
--text-sm: 14px;
--text-base: 16px;
--text-lg: 18px;
--text-xl: 24px;
--text-2xl: 32px;
--text-3xl: 48px;
```

### 4.3 Spacing
```css
--spacing-xs: 4px;
--spacing-sm: 8px;
--spacing-md: 16px;
--spacing-lg: 24px;
--spacing-xl: 32px;
```

### 4.4 Border Radius
```css
--radius-sm: 4px;
--radius-md: 8px;
--radius-lg: 16px;
--radius-full: 9999px;  /* Circular */
```

---

## 5. Assets Required

### 5.1 Images
| Asset | Description | Format |
|-------|-------------|--------|
| `headsCoin.png` | Coin showing anchor (HEADS) | PNG with transparency |
| `tailsCoin.png` | Coin showing skull (TAILS) | PNG with transparency |
| `background.png` | Treasure map background | PNG/JPG |
| `logo.svg` | CoinFlip logo | SVG |
| `sword.png` | Decorative sword (left side) | PNG |
| `lantern.png` | Decorative lantern (right side) | PNG |

### 5.2 Icons
- Info icon (ⓘ)
- Fullscreen icon (⛶)
- Menu icon (≡)
- Close icon (✕)
- Sound on/off icons
- Music on/off icons
- Dollar sign ($)
- Arrow left/right

### 5.3 Audio (Optional)
| Sound | Trigger |
|-------|---------|
| `coin_flip.mp3` | When coin flips |
| `win.mp3` | On winning result |
| `lose.mp3` | On losing result |
| `button_click.mp3` | Button interactions |
| `cashout.mp3` | On successful cashout |

---

## 6. Animations

### 6.1 Coin Flip Animation
```css
@keyframes coinFlip {
  0% { transform: rotateY(0deg); }
  100% { transform: rotateY(1800deg); }  /* 5 full rotations */
}

.coin-flipping {
  animation: coinFlip 1.5s ease-out;
}
```

### 6.2 Win/Lose Feedback
- **Win**: Green glow pulse, confetti particles (optional)
- **Lose**: Red flash, shake animation

### 6.3 Button Interactions
- Hover: Scale 1.02, brightness increase
- Active: Scale 0.98
- Disabled: Opacity 0.5

### 6.4 Balance Update
- Number counting animation
- Green/Red color flash for increase/decrease

---

## 7. State Management

### 7.1 Game State Interface
```typescript
interface GameState {
  // Connection
  isConnected: boolean;
  socketId: string | null;

  // User
  userId: string;
  nickname: string;
  avatar: string | null;
  balance: string;
  currency: string;

  // Game Config
  betConfig: BetConfig;
  currencies: Record<string, number>;

  // Current Game
  playMode: 'QUICK' | 'ROUNDS';
  betAmount: string;
  selectedChoice: 'HEADS' | 'TAILS' | null;

  // Active Session (ROUNDS mode)
  isPlaying: boolean;
  currentRound: number;
  choices: CoinChoice[];
  results: CoinChoice[];
  currentCoeff: string;
  isWin: boolean;

  // UI State
  isFlipping: boolean;
  showResult: boolean;
  lastResult: CoinChoice | null;
  quickGamesHistory: QuickGameResult[];

  // Modals
  showMenu: boolean;
  showRules: boolean;
  showFairness: boolean;
  showHistory: boolean;
}

interface BetConfig {
  minBetAmount: string;
  maxBetAmount: string;
  maxWinAmount: string;
  defaultBetAmount: string;
  betPresets: string[];
  decimalPlaces: number;
}

type CoinChoice = 'HEADS' | 'TAILS';

interface QuickGameResult {
  isWin: boolean;
  result: CoinChoice;
  datetime: string;
}
```

### 7.2 Actions
```typescript
// Bet Actions
placeBet(betAmount: string, currency: string, choice: CoinChoice | null, playMode: PlayMode): void
makeStep(choice: CoinChoice, roundNumber: number): void
cashout(): void

// UI Actions
setPlayMode(mode: PlayMode): void
setBetAmount(amount: string): void
selectChoice(choice: CoinChoice): void
toggleMenu(): void
openModal(modal: ModalType): void
closeModal(): void

// Settings
toggleSound(): void
toggleMusic(): void
toggleAnimation(): void
```

---

## 8. WebSocket Integration

### 8.1 Connection
```typescript
const socket = io('wss://api.example.com', {
  path: '/io',
  query: {
    gameMode: 'coinflip',
    operatorId: operatorId,
    Authorization: authToken,
  },
  transports: ['websocket'],
});
```

### 8.2 Event Listeners
```typescript
// Server → Client Events
socket.on('onBalanceChange', (data: { currency: string; balance: string }) => {
  updateBalance(data.balance);
});

socket.on('betsRanges', (data: Record<string, [string, string]>) => {
  setBetRanges(data);
});

socket.on('betConfig', (data: Record<string, BetConfig>) => {
  setBetConfig(data);
});

socket.on('myData', (data: { userId: string; nickname: string; gameAvatar: string | null }) => {
  setUserData(data);
});

socket.on('currencies', (data: Record<string, number>) => {
  setCurrencies(data);
});
```

### 8.3 Game Actions
```typescript
// Place Bet
socket.emit('gameService', {
  action: 'bet',
  payload: {
    betAmount: '0.3',
    currency: 'USD',
    choice: 'HEADS',      // null for ROUNDS mode
    playMode: 'QUICK',    // or 'ROUNDS'
  }
}, (response) => {
  handleBetResponse(response);
});

// Make Step (ROUNDS mode)
socket.emit('gameService', {
  action: 'step',
  payload: {
    choice: 'HEADS',
    roundNumber: 1,
  }
}, (response) => {
  handleStepResponse(response);
});

// Cashout (ROUNDS mode)
socket.emit('gameService', {
  action: 'withdraw'
}, (response) => {
  handleCashoutResponse(response);
});

// Get Game State (reconnection)
socket.emit('gameService', {
  action: 'get-game-state',
  payload: {}
}, (response) => {
  if (response) restoreGameState(response);
});
```

---

## 9. User Flows

### 9.1 QUICK Mode (Instant) Flow
```
1. User selects "Instant" game mode
2. User enters bet amount
3. User clicks HEAD or TAIL button
4. Button changes to selected choice
5. User clicks "CHOOSE THE OUTCOME" (now shows choice)
6. Frontend: Shows loading state
7. Frontend: Plays coin flip animation
8. Backend: Returns result
9. Frontend: Shows result (win/lose)
10. Frontend: Updates balance
11. Reset to initial state
```

### 9.2 ROUNDS Mode (Multiply) Flow
```
1. User selects "Multiply" game mode
2. User enters bet amount
3. User clicks "CHOOSE THE OUTCOME" (places bet, no choice)
4. Backend: Creates session, deducts balance
5. Frontend: Shows round 0/20, waiting for choice

[For each round]
6. User clicks HEAD or TAIL
7. Frontend: Plays coin flip animation
8. Backend: Returns result

If WIN:
  9a. Update round counter and multiplier
  9b. Show "CASHOUT" button
  9c. User can continue (step 6) or cashout (step 10)

If LOSE:
  9a. Show lose animation
  9b. Reset to initial state

[Cashout]
10. User clicks "CASHOUT"
11. Backend: Settles bet, returns winAmount
12. Frontend: Shows win celebration
13. Frontend: Updates balance
14. Reset to initial state
```

### 9.3 Reconnection Flow
```
1. Socket disconnects
2. Show "Reconnecting..." overlay
3. Socket reconnects
4. Call 'get-game-state'
5. If active session exists:
   - Restore game state
   - Show current round/multiplier
6. If no active session:
   - Show initial state
```

---

## 10. Error Handling

### 10.1 Error Messages
| Error Code | User Message |
|------------|--------------|
| `missing_action` | "Invalid request. Please try again." |
| `active_session_exists` | "You have an active game. Please complete it first." |
| `no_active_session` | "No active game found." |
| `invalid_bet_amount` | "Invalid bet amount. Please check your bet." |
| `invalid_choice` | "Please select HEAD or TAIL." |
| `invalid_play_mode` | "Invalid game mode selected." |
| `invalid_round_number` | "Invalid round. Please refresh the page." |
| `agent_rejected` | "Transaction rejected. Please try again." |
| `settlement_failed` | "Failed to process winnings. Contact support." |
| `cashout_failed` | "Failed to cashout. Please try again." |
| `bet_failed` | "Failed to place bet. Please try again." |

### 10.2 Error Display
- Toast notification at top of screen
- Auto-dismiss after 5 seconds
- Red background for errors
- Green background for success messages

---

## 11. Modals

### 11.1 How to Play / Game Rules Modal
```
┌──────────────────────────────────────┐
│  [X]           GAME RULES            │
├──────────────────────────────────────┤
│                                      │
│  INSTANT MODE                        │
│  - Select HEAD or TAIL               │
│  - Win 1.94x your bet                │
│  - 50% chance to win                 │
│                                      │
│  MULTIPLY MODE                       │
│  - Win up to 20 rounds in a row      │
│  - Each win doubles multiplier       │
│  - Cashout anytime after a win       │
│  - Max multiplier: 1,017,118.72x     │
│                                      │
│  MULTIPLIER TABLE                    │
│  Round 1:  1.94x                     │
│  Round 2:  3.88x                     │
│  Round 3:  7.76x                     │
│  ...                                 │
│                                      │
└──────────────────────────────────────┘
```

### 11.2 Provably Fair Modal
```
┌──────────────────────────────────────┐
│  [X]      PROVABLY FAIR SETTINGS     │
├──────────────────────────────────────┤
│                                      │
│  Your Seed                           │
│  ┌────────────────────────────────┐  │
│  │ a1b2c3d4e5f67890               │  │
│  └────────────────────────────────┘  │
│  [Change Seed]                       │
│                                      │
│  Server Seed (Hashed)                │
│  ┌────────────────────────────────┐  │
│  │ 59856e17ca19bb24c369232...     │  │
│  └────────────────────────────────┘  │
│                                      │
│  Nonce: 42                           │
│                                      │
│  [How verification works]            │
│                                      │
└──────────────────────────────────────┘
```

### 11.3 Bet History Modal
```
┌──────────────────────────────────────┐
│  [X]         MY BET HISTORY          │
├──────────────────────────────────────┤
│  Date        Mode     Bet    Result  │
├──────────────────────────────────────┤
│  12:34:56   QUICK    $0.30   +$0.58  │
│  12:33:21   ROUNDS   $1.00   -$1.00  │
│  12:30:15   QUICK    $0.50   -$0.50  │
│  12:28:44   ROUNDS   $2.00   +$7.76  │
│  ...                                 │
├──────────────────────────────────────┤
│           [Load More]                │
└──────────────────────────────────────┘
```

---

## 12. Accessibility (a11y)

### 12.1 Requirements
- All interactive elements keyboard accessible
- ARIA labels on buttons and inputs
- Color contrast ratio ≥ 4.5:1
- Focus indicators visible
- Screen reader compatible

### 12.2 ARIA Labels
```html
<button aria-label="Select HEADS">HEAD</button>
<button aria-label="Select TAILS">TAIL</button>
<button aria-label="Place bet">CHOOSE THE OUTCOME</button>
<button aria-label="Open menu">Menu</button>
<input aria-label="Bet amount" type="text" />
```

---

## 13. Performance Requirements

### 13.1 Targets
| Metric | Target |
|--------|--------|
| First Contentful Paint | < 1.5s |
| Time to Interactive | < 3s |
| Bundle Size (gzipped) | < 200KB |
| WebSocket Latency | < 100ms |
| Animation FPS | 60fps |

### 13.2 Optimization
- Lazy load modals
- Preload coin images
- Use CSS transforms for animations
- Debounce bet amount input
- Memoize expensive calculations

---

## 14. Testing Requirements

### 14.1 Unit Tests
- State management functions
- Utility functions (formatting, calculations)
- Component rendering

### 14.2 Integration Tests
- WebSocket connection flow
- Game flow (QUICK mode)
- Game flow (ROUNDS mode)
- Error handling

### 14.3 E2E Tests
- Complete QUICK mode game
- Complete ROUNDS mode game with cashout
- Complete ROUNDS mode game with loss
- Reconnection flow

---

## 15. Deployment

### 15.1 Environment Variables
```env
VITE_API_URL=https://api.example.com
VITE_WS_PATH=/io
VITE_DEFAULT_CURRENCY=USD
VITE_DEFAULT_LANGUAGE=en
```

### 15.2 Build Commands
```bash
# Development
npm run dev

# Production build
npm run build

# Preview production build
npm run preview
```

### 15.3 URL Parameters
| Parameter | Description | Example |
|-----------|-------------|---------|
| `gameMode` | Game code | `coinflip` |
| `operatorId` | Agent/Operator ID | `uuid` |
| `authToken` | JWT auth token | `jwt-token` |
| `currency` | User currency | `USD` |
| `lang` | Language code | `en` |

---

## 16. File Structure

```
coinflip-frontend/
├── public/
│   ├── images/
│   │   ├── headsCoin.png
│   │   ├── tailsCoin.png
│   │   ├── background.png
│   │   └── ...
│   └── sounds/
│       ├── coin_flip.mp3
│       └── ...
├── src/
│   ├── components/
│   │   ├── Header/
│   │   ├── GameArea/
│   │   ├── Controls/
│   │   ├── Menu/
│   │   ├── Modals/
│   │   └── common/
│   ├── hooks/
│   │   ├── useSocket.ts
│   │   ├── useGameState.ts
│   │   └── useSound.ts
│   ├── store/
│   │   └── gameStore.ts
│   ├── services/
│   │   └── socketService.ts
│   ├── types/
│   │   └── game.types.ts
│   ├── utils/
│   │   ├── format.ts
│   │   └── calculations.ts
│   ├── styles/
│   │   └── global.css
│   ├── App.tsx
│   └── main.tsx
├── package.json
└── vite.config.ts
```

---

## 17. Consistency with Backend

### 17.1 Socket Event Names (from REQUIREMENTS.md)
| Event | Direction | Usage |
|-------|-----------|-------|
| `gameService` | Client → Server | All game actions |
| `onBalanceChange` | Server → Client | Balance updates |
| `betsRanges` | Server → Client | Bet limits |
| `betConfig` | Server → Client | Bet configuration |
| `myData` | Server → Client | User info |
| `currencies` | Server → Client | Exchange rates |

### 17.2 Action Names
| Action | Mode | Description |
|--------|------|-------------|
| `bet` | Both | Place initial bet |
| `step` | ROUNDS | Make choice in round |
| `withdraw` | ROUNDS | Cashout winnings |
| `get-game-state` | Both | Reconnection |
| `get-game-config` | Both | Get game config |
| `get-game-seeds` | Both | Get fairness seeds |
| `set-user-seed` | Both | Update user seed |

### 17.3 Response Format Consistency
All responses follow the format defined in REQUIREMENTS.md:
```typescript
interface GameResponse {
  isFinished: boolean;
  isWin: boolean;
  currency: string;
  betAmount: string;
  coeff?: string;
  choices: string[];
  roundNumber: number;
  playMode: 'QUICK' | 'ROUNDS';
  winAmount?: string;
  quickGamesHistory?: QuickGameResult[];
}

interface ErrorResponse {
  error: {
    message: string;
  };
}
```

---

## Summary

This frontend should:
1. **Match the visual design** of coinflip.inout.games exactly
2. **Integrate seamlessly** with the backend per REQUIREMENTS.md
3. **Follow architecture patterns** from ARCHITECTURE_AND_ONBOARDING.md
4. **Provide smooth animations** for coin flips and state changes
5. **Handle all error cases** gracefully
6. **Support reconnection** for ongoing games
7. **Be responsive** across all device sizes
8. **Be accessible** to all users
