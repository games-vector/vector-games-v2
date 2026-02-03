# Database scripts

## Game config tables (fix "Config table does not exist" logs)

The app reads per-game config from tables `game_config_<game_code>` (e.g. `game_config_sugar_daddy`). If these tables are missing, the app falls back to code defaults and can log repeatedly.

To create the tables and insert default records:

```bash
# From project root, using your DB credentials
mysql -u root -p vectorgames < db/seed-game-config-tables.sql
```

Or from a MySQL client:

```sql
USE vectorgames;
SOURCE /path/to/vector-games-v2/db/seed-game-config-tables.sql;
```

**Tables created:**

- `game_config_platform` – JWT expiry etc. (keys: `jwt.expiresIn`, `jwt.genericExpiresIn`)
- `game_config_sugar_daddy` – betConfig, RTP, coefficientSpeed, coefficientDistribution
- `game_config_diver` – same keys as sugar_daddy
- `game_config_chicken_road_two` – betConfig, coefficients, hazardConfig

After running the script, the backend will read config from the DB instead of only defaults, and the "Config table … does not exist" warnings for these games will stop (as long as the DB name is the one the app uses, e.g. `vectorgames`).
