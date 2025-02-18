-- Create users table
DROP TABLE IF EXISTS users;
CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    username TEXT,
    current_streak INTEGER DEFAULT 0,
    highest_streak INTEGER DEFAULT 0,
    last_read_date DATE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Create reading_stats table
DROP TABLE IF EXISTS reading_stats;
CREATE TABLE reading_stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    post_id TEXT NOT NULL,
    utm_source TEXT,
    utm_medium TEXT,
    utm_campaign TEXT,
    utm_channel TEXT,
    read_date DATE NOT NULL,
    ip TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_reading_stats_user ON reading_stats(user_id);
CREATE INDEX IF NOT EXISTS idx_reading_stats_date ON reading_stats(read_date);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX idx_reading_stats_ip_created ON reading_stats(ip, created_at);

-- Remove old indexes and tables that are no longer needed
DROP INDEX IF EXISTS idx_reads_email;
DROP INDEX IF EXISTS idx_reads_timestamp;
DROP TABLE IF EXISTS posts;
DROP TABLE IF EXISTS reads; 