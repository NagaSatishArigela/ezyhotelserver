-- Creates the dedicated e2e/integration test database.
-- Executed by the postgres image only on FIRST container init (empty data dir).
-- The main "ezyhotels" DB is created from POSTGRES_DB in docker-compose.yml.
CREATE DATABASE ezyhotels_test;
