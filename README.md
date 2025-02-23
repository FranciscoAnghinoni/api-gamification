# API Gamification

A Cloudflare Workers API for gamifying newsletter reading habits with streak tracking and statistics.

## Features

### 📊 User Statistics

- Current and highest reading streaks
- Total reads tracking
- Traffic source analysis
- Reading history
- Opening rate calculation
  - Based on newsletters available since user's first read
  - Excludes Sundays and days without newsletters
  - Calculated as: (newsletters read / newsletters available since first read) \* 100
- Detailed engagement metrics
- Time-based analytics

### 🎯 Streak System

- Daily streak tracking
- Sunday exclusions (doesn't break streak)
- Automatic streak calculations
- Highest streak records
- Streak recovery grace period
- Streak milestone achievements

### 📈 Admin Dashboard

- Total user count
- Average streak statistics
- Maximum streak achieved
- Total reads across platform
- Top 10 readers leaderboard
  - Sorted by opening rate and streak
  - Opening rate considers only newsletters since user's first read
  - Excludes Sundays and days without newsletters
- User engagement trends
- Real-time analytics

### 🔒 Security

- Input validation
- Error handling
- CORS configuration
- Data encryption

## Business Rules

### Newsletter Reading

- Readings are not allowed on Sundays
- Each newsletter can only be read once per user
- Reading time is adjusted to Brazil timezone (UTC-3)

### Opening Rate Calculation

1. First read date: The date when the user first read any newsletter
2. Available newsletters: Count of newsletters sent (excluding Sundays) since user's first read
3. Read newsletters: Count of newsletters the user has read
4. Opening rate = (Read newsletters / Available newsletters) \* 100

### Streak Calculation

1. Streak increases daily with each read
2. Sundays are excluded and don't break the streak
3. Streak breaks if user misses a newsletter on a non-Sunday
4. Current streak and highest streak are tracked separately

## API Endpoints

### Authentication
