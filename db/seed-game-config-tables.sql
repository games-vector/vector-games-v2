-- =============================================================================
-- Game config tables and default records
-- Run this against your vectorgames DB to create missing game_config_* tables
-- and insert default records so the app stops logging "Config table does not exist".
--
-- Usage: mysql -u root -p vectorgames < db/seed-game-config-tables.sql
-- Or from MySQL client: source /path/to/seed-game-config-tables.sql;
-- =============================================================================

-- Use the app database (adjust if your DB name differs)
-- CREATE DATABASE IF NOT EXISTS vectorgames;
-- USE vectorgames;

-- -----------------------------------------------------------------------------
-- Platform config (JWT etc.)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `game_config_platform` (
  `key` VARCHAR(255) NOT NULL,
  `value` TEXT,
  PRIMARY KEY (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO `game_config_platform` (`key`, `value`) VALUES
  ('jwt.expiresIn', '1h'),
  ('jwt.genericExpiresIn', '1h')
ON DUPLICATE KEY UPDATE `value` = VALUES(`value`);

-- -----------------------------------------------------------------------------
-- Sugar Daddy game config
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `game_config_sugar_daddy` (
  `key` VARCHAR(255) NOT NULL,
  `value` TEXT,
  PRIMARY KEY (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO `game_config_sugar_daddy` (`key`, `value`) VALUES
  ('betConfig', '{"minBetAmount":"0.01","maxBetAmount":"200.00","maxWinAmount":"20000.00","defaultBetAmount":"1.00","betPresets":["0.5","1","2","7","10","20"],"decimalPlaces":"2","currency":"INR"}'),
  ('RTP', '92'),
  ('coefficientSpeed', '0.5'),
  ('coefficientDistribution', '{"ranges":[{"name":"low","min":1.02,"max":3.0,"weight":0.75},{"name":"medium","min":3.0,"max":5.0,"weight":0.2},{"name":"high","min":5.0,"max":10.0,"weight":0.05}],"distributionType":"uniform"}')
ON DUPLICATE KEY UPDATE `value` = VALUES(`value`);

-- -----------------------------------------------------------------------------
-- Diver game config
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `game_config_diver` (
  `key` VARCHAR(255) NOT NULL,
  `value` TEXT,
  PRIMARY KEY (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO `game_config_diver` (`key`, `value`) VALUES
  ('betConfig', '{"minBetAmount":"0.01","maxBetAmount":"200.00","maxWinAmount":"20000.00","defaultBetAmount":"1.00","betPresets":["0.5","1","2","7","10","20"],"decimalPlaces":"2","currency":"INR"}'),
  ('RTP', '92'),
  ('coefficientSpeed', '0.5'),
  ('coefficientDistribution', '{"ranges":[{"name":"low","min":1.02,"max":3.0,"weight":0.75},{"name":"medium","min":3.0,"max":5.0,"weight":0.2},{"name":"high","min":5.0,"max":10.0,"weight":0.05}],"distributionType":"uniform"}')
ON DUPLICATE KEY UPDATE `value` = VALUES(`value`);

-- -----------------------------------------------------------------------------
-- Chicken Road game config
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `game_config_chicken_road_two` (
  `key` VARCHAR(255) NOT NULL,
  `value` TEXT,
  PRIMARY KEY (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO `game_config_chicken_road_two` (`key`, `value`) VALUES
  ('betConfig', '{"minBetAmount":"0.01","maxBetAmount":"150.00","maxWinAmount":"10000.00","defaultBetAmount":"0.60","betPresets":["0.5","1","2","7"],"decimalPlaces":"2","currency":"INR"}'),
  ('coefficients', '{"EASY":["1.01","1.03","1.06","1.10","1.15","1.19","1.24","1.30","1.35","1.42","1.48","1.56","1.65","1.75","1.85","1.98","2.12","2.28","2.47","2.70","2.96","3.28","3.70","4.11","4.64","5.39","6.50","8.36","12.08","23.24"],"MEDIUM":["1.08","1.21","1.37","1.56","1.78","2.05","2.37","2.77","3.24","3.85","4.62","5.61","6.91","8.64","10.99","14.29","18.96","26.07","37.24","53.82","82.36","137.59","265.35","638.82","2457.00"],"HARD":["1.18","1.46","1.83","2.31","2.95","3.82","5.02","6.66","9.04","12.52","17.74","25.80","38.71","60.21","97.34","166.87","305.94","595.86","1283.03","3267.64","10898.54","62162.09"],"DAREDEVIL":["1.44","2.21","3.45","5.53","9.09","15.30","26.78","48.70","92.54","185.08","391.25","894.28","2235.72","6096.15","18960.33","72432.75","379632.82","3608855.25"]}'),
  ('hazardConfig', '{"totalColumns":{"EASY":30,"MEDIUM":25,"HARD":22,"DAREDEVIL":18},"hazardRefreshMs":5000,"hazards":{"EASY":3,"MEDIUM":4,"HARD":5,"DAREDEVIL":7}}')
ON DUPLICATE KEY UPDATE `value` = VALUES(`value`);
