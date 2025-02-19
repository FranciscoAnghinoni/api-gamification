-- Users table to store user information and streaks
CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    auto_login_token TEXT UNIQUE,
    current_streak INTEGER DEFAULT 0,
    highest_streak INTEGER DEFAULT 0,
    last_read_date TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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

-- Posts table to store newsletter post information
CREATE TABLE posts (
    id TEXT PRIMARY KEY,
    title TEXT,
    subtitle TEXT,
    authors TEXT,
    status TEXT,
    publish_date DATETIME,
    content TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for better query performance
CREATE INDEX idx_reading_stats_user_id ON reading_stats(user_id);
CREATE INDEX idx_reading_stats_post_id ON reading_stats(post_id);
CREATE INDEX idx_reading_stats_read_date ON reading_stats(read_date);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_auto_login_token ON users(auto_login_token);

-- Create views for common queries
CREATE VIEW v_user_stats AS
SELECT 
    u.id,
    u.email,
    u.current_streak,
    u.highest_streak,
    COUNT(r.id) as total_reads,
    MAX(r.read_date) as last_read_date,
    GROUP_CONCAT(DISTINCT r.utm_source) as sources
FROM users u
LEFT JOIN reading_stats r ON u.id = r.user_id
GROUP BY u.id;

CREATE VIEW v_post_stats AS
SELECT 
    r.post_id,
    p.title,
    COUNT(*) as total_reads,
    COUNT(DISTINCT r.user_id) as unique_readers,
    MIN(r.read_date) as first_read,
    MAX(r.read_date) as last_read
FROM reading_stats r
LEFT JOIN posts p ON r.post_id = p.id
GROUP BY r.post_id;

-- Remove old indexes and tables that are no longer needed
DROP INDEX IF EXISTS idx_reads_email;
DROP INDEX IF EXISTS idx_reads_timestamp;
DROP TABLE IF EXISTS posts;
DROP TABLE IF EXISTS reads; 