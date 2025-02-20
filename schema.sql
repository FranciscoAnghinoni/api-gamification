-- Drop existing tables
DROP TABLE IF EXISTS reading_stats;
DROP TABLE IF EXISTS users;

-- Users table to store user information and streaks
CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT,
    is_admin BOOLEAN DEFAULT 0,
    current_streak INTEGER DEFAULT 0,
    highest_streak INTEGER DEFAULT 0,
    last_read_date TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Reading statistics table to store all read events
CREATE TABLE reading_stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    post_id TEXT NOT NULL,
    utm_source TEXT,
    utm_medium TEXT,
    utm_campaign TEXT,
    utm_channel TEXT,
    read_date DATE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Create indexes for better query performance
CREATE INDEX idx_reading_stats_user_id ON reading_stats(user_id);
CREATE INDEX idx_reading_stats_post_id ON reading_stats(post_id);
CREATE INDEX idx_reading_stats_read_date ON reading_stats(read_date);
CREATE INDEX idx_users_email ON users(email); 