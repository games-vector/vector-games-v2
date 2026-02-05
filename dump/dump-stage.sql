CREATE DATABASE  IF NOT EXISTS `vectorgames` /*!40100 DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci */ /*!80016 DEFAULT ENCRYPTION='N' */;
USE `vectorgames`;
-- MySQL dump 10.13  Distrib 8.0.44, for Win64 (x86_64)
--
-- Host: 127.0.0.1    Database: vectorgames
-- ------------------------------------------------------
-- Server version	8.0.44

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Table structure for table `agents`
--

DROP TABLE IF EXISTS `agents`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `agents` (
  `agentId` varchar(255) NOT NULL,
  `cert` varchar(255) NOT NULL,
  `agentIPaddress` varchar(255) NOT NULL,
  `callbackURL` varchar(255) NOT NULL,
  `isWhitelisted` tinyint NOT NULL DEFAULT '1',
  `allowedGameCodes` json DEFAULT NULL,
  `password_hash` varchar(255) NOT NULL,
  `currency` varchar(255) DEFAULT NULL,
  `createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updatedAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `createdBy` varchar(255) DEFAULT NULL,
  `updatedBy` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`agentId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `agents`
--

LOCK TABLES `agents` WRITE;
/*!40000 ALTER TABLE `agents` DISABLE KEYS */;
INSERT INTO `agents` VALUES ('brlag','JXfDPlWXw4LxuDtxVz0','*','https://awc.play247.services/awc/singleWallet',1,NULL,'asdjadbhsdasdAS',NULL,'2026-01-22 17:26:13.961681','2026-01-22 17:26:13.961681',NULL,NULL);
/*!40000 ALTER TABLE `agents` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `game_config_chicken_road_two`
--

DROP TABLE IF EXISTS `game_config_chicken_road_two`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `game_config_chicken_road_two` (
  `id` int NOT NULL AUTO_INCREMENT,
  `key` varchar(255) NOT NULL,
  `value` text,
  `updatedAt` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `key` (`key`),
  KEY `idx_key` (`key`)
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `game_config_chicken_road_two`
--

LOCK TABLES `game_config_chicken_road_two` WRITE;
/*!40000 ALTER TABLE `game_config_chicken_road_two` DISABLE KEYS */;
INSERT INTO `game_config_chicken_road_two` VALUES (1,'betConfig','{\"minBetAmount\":\"0.01\",\"maxBetAmount\":\"150.00\",\"maxWinAmount\":\"10000.00\",\"defaultBetAmount\":\"0.600000000000000000\",\"betPresets\":[\"0.5\",\"1\",\"2\",\"7\"],\"decimalPlaces\":\"2\",\"currency\":\"INR\"}','2026-01-22 17:20:59'),(2,'coefficients','{\"EASY\":[\"1.01\",\"1.03\",\"1.06\",\"1.10\",\"1.15\",\"1.19\",\"1.24\",\"1.30\",\"1.35\",\"1.42\",\"1.48\",\"1.56\",\"1.65\",\"1.75\",\"1.85\",\"1.98\",\"2.12\",\"2.28\",\"2.47\",\"2.70\",\"2.96\",\"3.28\",\"3.70\",\"4.11\",\"4.64\",\"5.39\",\"6.50\",\"8.36\",\"12.08\",\"23.24\"],\"MEDIUM\":[\"1.08\",\"1.21\",\"1.37\",\"1.56\",\"1.78\",\"2.05\",\"2.37\",\"2.77\",\"3.24\",\"3.85\",\"4.62\",\"5.61\",\"6.91\",\"8.64\",\"10.99\",\"14.29\",\"18.96\",\"26.07\",\"37.24\",\"53.82\",\"82.36\",\"137.59\",\"265.35\",\"638.82\",\"2457.00\"],\"HARD\":[\"1.18\",\"1.46\",\"1.83\",\"2.31\",\"2.95\",\"3.82\",\"5.02\",\"6.66\",\"9.04\",\"12.52\",\"17.74\",\"25.80\",\"38.71\",\"60.21\",\"97.34\",\"166.87\",\"305.94\",\"595.86\",\"1283.03\",\"3267.64\",\"10898.54\",\"62162.09\"],\"DAREDEVIL\":[\"1.44\",\"2.21\",\"3.45\",\"5.53\",\"9.09\",\"15.30\",\"26.78\",\"48.70\",\"92.54\",\"185.08\",\"391.25\",\"894.28\",\"2235.72\",\"6096.15\",\"18960.33\",\"72432.75\",\"379632.82\",\"3608855.25\"]}','2026-01-22 17:21:50'),(3,'hazardConfig','{\"totalColumns\":{\"EASY\":30,\"MEDIUM\":25,\"HARD\":22,\"DAREDEVIL\":18},\"hazardRefreshMs\":5000,\"hazards\":{\"EASY\":3,\"MEDIUM\":4,\"HARD\":5,\"DAREDEVIL\":7}}','2026-01-22 17:21:50'),(4,'game.payloads','{\"gameCode\":\"chicken-road-two\",\"gameName\":\"chicken-road-2\",\"platform\":\"In-out\",\"gameType\":\"CRASH\",\"settleType\":\"platformTxId\"}','2026-01-22 17:21:50');
/*!40000 ALTER TABLE `game_config_chicken_road_two` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `game_config_diver`
--

DROP TABLE IF EXISTS `game_config_diver`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `game_config_diver` (
  `id` int NOT NULL AUTO_INCREMENT,
  `key` varchar(255) NOT NULL,
  `value` text NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `key` (`key`)
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `game_config_diver`
--

LOCK TABLES `game_config_diver` WRITE;
/*!40000 ALTER TABLE `game_config_diver` DISABLE KEYS */;
INSERT INTO `game_config_diver` VALUES (1,'RTP','92','2026-01-30 13:05:29','2026-01-30 13:05:29'),(2,'coefficientSpeed','0.5','2026-01-30 13:05:29','2026-01-30 13:05:29'),(3,'coefficientDistribution','{\n    \"ranges\": [\n      {\n        \"name\": \"low\",\n        \"min\": 1.02,\n        \"max\": 3.0,\n        \"weight\": 0.75\n      },\n      {\n        \"name\": \"medium\",\n        \"min\": 3.0,\n        \"max\": 5.0,\n        \"weight\": 0.20\n      },\n      {\n        \"name\": \"high\",\n        \"min\": 5.0,\n        \"max\": 10.0,\n        \"weight\": 0.05\n      }\n    ],\n    \"distributionType\": \"uniform\"\n  }','2026-01-30 13:05:29','2026-01-30 13:05:29'),(4,'betConfig','{\n    \"minBetAmount\": \"0.01\",\n    \"maxBetAmount\": \"200.00\",\n    \"maxWinAmount\": \"20000.00\",\n    \"defaultBetAmount\": \"1.00\",\n    \"betPresets\": [\"0.5\", \"1\", \"2\", \"7\", \"10\", \"20\"],\n    \"decimalPlaces\": \"2\",\n    \"currency\": \"INR\"\n  }','2026-01-30 13:05:29','2026-01-30 13:05:29');
/*!40000 ALTER TABLE `game_config_diver` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `game_config_platform`
--

DROP TABLE IF EXISTS `game_config_platform`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `game_config_platform` (
  `id` int NOT NULL AUTO_INCREMENT,
  `key` varchar(255) NOT NULL,
  `value` text,
  `updatedAt` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `key` (`key`),
  KEY `idx_key` (`key`)
) ENGINE=InnoDB AUTO_INCREMENT=7 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `game_config_platform`
--

LOCK TABLES `game_config_platform` WRITE;
/*!40000 ALTER TABLE `game_config_platform` DISABLE KEYS */;
INSERT INTO `game_config_platform` VALUES (1,'jwt.secret','CHANGE_ME_DEV_SECRET','2026-01-22 17:22:55'),(2,'jwt.expiresIn','7d','2026-01-29 09:54:04'),(3,'redis.TTL','3600','2026-01-29 09:54:22'),(4,'game.session.ttl','3600','2026-01-29 09:54:39'),(5,'jwt.genericExpiresIn','7d','2026-01-29 10:18:28'),(6,'dashboard_credentials','{\n    \"userId\": \"ajd180nkmwqzrcjzeojg\",\n    \"agentId\": \"brlag\",\n    \"cert\": \"JXfDPlWXw4LxuDtxVz0\"\n}','2026-02-03 08:39:02');
/*!40000 ALTER TABLE `game_config_platform` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `game_config_sugar_daddy`
--

DROP TABLE IF EXISTS `game_config_sugar_daddy`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `game_config_sugar_daddy` (
  `id` int NOT NULL AUTO_INCREMENT,
  `key` varchar(255) NOT NULL,
  `value` text,
  `updatedAt` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `key` (`key`),
  KEY `idx_key` (`key`)
) ENGINE=InnoDB AUTO_INCREMENT=9 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `game_config_sugar_daddy`
--

LOCK TABLES `game_config_sugar_daddy` WRITE;
/*!40000 ALTER TABLE `game_config_sugar_daddy` DISABLE KEYS */;
INSERT INTO `game_config_sugar_daddy` VALUES (1,'betConfig','{\n    \"currency\": \"INR\",\n    \"betPresets\": [\n        \"20\",\n        \"50\",\n        \"100\",\n        \"500\",\n        \"1000\"\n    ],\n    \"maxBetAmount\": \"16400.00\",\n    \"maxWinAmount\": \"820000.00\",\n    \"minBetAmount\": \"0.10\",\n    \"decimalPlaces\": \"2\",\n    \"defaultBetAmount\": \"1.00\"\n}','2026-02-02 05:59:26'),(2,'game.payloads','{\"gameCode\":\"sugar-daddy\",\"gameName\":\"Sugar Daddy\",\"platform\":\"In-out\",\"gameType\":\"CRASH\",\"settleType\":\"platformTxId\"}','2026-01-22 17:22:45'),(3,'frontend.host','sugar-daddy.inoutgames.live','2026-01-25 12:09:27'),(4,'RTP','97','2026-01-29 19:43:55'),(6,'coefficientDistribution','{\n  \"ranges\": [\n    {\n      \"name\": \"low\",\n      \"min\": 1.02,\n      \"max\": 3.0,\n      \"weight\": 0.75\n    },\n    {\n      \"name\": \"medium\",\n      \"min\": 3.0,\n      \"max\": 5.0,\n      \"weight\": 0.20\n    },\n    {\n      \"name\": \"high\",\n      \"min\": 5.0,\n      \"max\": 26.0,\n      \"weight\": 0.05\n    }\n  ],\n  \"distributionType\": \"uniform\"\n}','2026-01-29 19:45:01'),(8,'coefficientSpeed','0.25','2026-01-29 20:06:25');
/*!40000 ALTER TABLE `game_config_sugar_daddy` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `games`
--

DROP TABLE IF EXISTS `games`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `games` (
  `id` varchar(36) NOT NULL,
  `gameCode` varchar(255) NOT NULL,
  `gameName` varchar(255) NOT NULL,
  `platform` varchar(255) NOT NULL,
  `gameType` varchar(255) NOT NULL,
  `settleType` varchar(255) NOT NULL,
  `isActive` tinyint NOT NULL DEFAULT '1',
  `createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updatedAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `createdBy` varchar(255) DEFAULT NULL,
  `updatedBy` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `IDX_7b6dbcdbcde7e71b78d3e4c0e9` (`gameCode`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `games`
--

LOCK TABLES `games` WRITE;
/*!40000 ALTER TABLE `games` DISABLE KEYS */;
INSERT INTO `games` VALUES ('4937582c-cf04-43f2-ad26-20682fd625a8','chicken-road-two','chicken-road-2','In-out','CRASH','platformTxId',1,'2026-01-21 14:52:50.162667','2026-01-21 14:52:50.162667',NULL,NULL),('6bb7f5e1-dc2c-41d5-9437-166826dd1ab9','diver','diver','In-out','CRASH','platformTxId',1,'2026-01-30 13:03:36.048847','2026-01-30 13:06:05.904816',NULL,NULL),('82f7fea8-292e-4a44-a348-f5be62fb4793','sugar-daddy','sugar-daddy','In-out','CRASH','platformTxId',1,'2026-01-21 14:52:50.114327','2026-01-29 10:07:53.208433',NULL,NULL),('a4361c9e-eaf6-44f0-b053-f8e63eaf7fb4','chicken-road-vegas','chicken-road-2','In-out','CRASH','platformTxId',1,'2026-01-21 14:52:50.191238','2026-01-21 14:52:50.191238',NULL,NULL),('b5472d0f-1234-4567-8910-abcdef123456','coinflip','CoinFlip','In-out','CRASH','platformTxId',1,'2026-02-04 00:00:00.000000','2026-02-04 00:00:00.000000',NULL,NULL);
/*!40000 ALTER TABLE `games` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `game_config_coinflip`
--

DROP TABLE IF EXISTS `game_config_coinflip`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `game_config_coinflip` (
  `id` int NOT NULL AUTO_INCREMENT,
  `key` varchar(255) NOT NULL,
  `value` text,
  `updatedAt` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `key` (`key`),
  KEY `idx_key` (`key`)
) ENGINE=InnoDB AUTO_INCREMENT=5 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `game_config_coinflip`
--

LOCK TABLES `game_config_coinflip` WRITE;
/*!40000 ALTER TABLE `game_config_coinflip` DISABLE KEYS */;
INSERT INTO `game_config_coinflip` VALUES (1,'betConfig','{"minBetAmount":"0.01","maxBetAmount":"200.00","maxWinAmount":"20000.00","defaultBetAmount":"0.30","betPresets":["0.5","1","2","7"],"decimalPlaces":2,"currency":"INR"}','2026-02-04 00:00:00'),(2,'game.payloads','{"gameCode":"coinflip","gameName":"CoinFlip","platform":"In-out","gameType":"CRASH","settleType":"platformTxId"}','2026-02-04 00:00:00'),(3,'multipliers','["1.94","3.88","7.76","15.52","31.04","62.08","124.16","248.32","496.64","993.28","1986.56","3973.12","7946.24","15892.48","31784.96","63569.92","127139.84","254279.68","508559.36","1017118.72"]','2026-02-04 00:00:00'),(4,'gameConfig','{"maxRounds":20,"baseMultiplier":1.94}','2026-02-04 00:00:00');
/*!40000 ALTER TABLE `game_config_coinflip` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `user`
--

DROP TABLE IF EXISTS `user`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `user` (
  `userId` varchar(255) NOT NULL,
  `agentId` varchar(255) NOT NULL,
  `currency` varchar(255) NOT NULL,
  `language` varchar(255) DEFAULT NULL,
  `username` varchar(255) DEFAULT NULL,
  `betLimit` varchar(255) NOT NULL,
  `avatar` varchar(255) DEFAULT NULL,
  `passwordHash` varchar(255) DEFAULT NULL,
  `createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updatedAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  `createdBy` varchar(255) DEFAULT NULL,
  `updatedBy` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`userId`,`agentId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `user`
--

LOCK TABLES `user` WRITE;
/*!40000 ALTER TABLE `user` DISABLE KEYS */;
INSERT INTO `user` VALUES ('ajd180nkmwqzrcjzeojg','brlag','INR','EN','ajd180nkmwqzrcjzeojg','1000.00',NULL,NULL,'2026-01-26 13:05:57.289726','2026-01-26 13:05:57.289726',NULL,NULL),('sxxurczuleogz19epayf','brlag','INR','EN','sxxurczuleogz19epayf','1000.00',NULL,NULL,'2026-01-26 13:06:49.449151','2026-01-26 13:06:49.449151',NULL,NULL),('ztj130cdajnmodugtbtk','brlag','INR','en','ztj130cdajnmodugtbtk','10000.00',NULL,NULL,'2026-01-22 17:27:04.181878','2026-01-22 17:27:04.181878',NULL,NULL);
/*!40000 ALTER TABLE `user` ENABLE KEYS */;
UNLOCK TABLES;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-02-03 16:23:43
