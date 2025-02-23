# API Documentation

## Base URL

```
https://api.example.com
```

## Authentication

Most endpoints require authentication using a Bearer token. Include the token in the Authorization header:

```
Authorization: Bearer <your_token>
```

## Business Rules

### Opening Rate Calculation

The opening rate is calculated based on the following rules:

1. Only considers newsletters sent after the user's first read
2. Excludes Sundays from the calculation
3. Only counts days where newsletters were actually sent
4. Formula: (newsletters read / newsletters available since first read) \* 100

For example:

- If a user's first read was on Feb 20, and there were newsletters on Feb 20, 21, and 22
- And the user read on Feb 21 and 22
- Then their opening rate would be (2/3) \* 100 = 66.67%

## Endpoints

### 1. Record Read Event

Records when a user reads a post and updates their streak. Not allowed on Sundays.

```http
GET /?email={email}&id={postId}&utm_source={source}&utm_medium={medium}&utm_campaign={campaign}&utm_channel={channel}
```

#### Query Parameters

| Parameter    | Type   | Required | Description          |
| ------------ | ------ | -------- | -------------------- |
| email        | string | Yes      | User's email address |
| id           | string | Yes      | Post ID being read   |
| utm_source   | string | No       | Traffic source       |
| utm_medium   | string | No       | Traffic medium       |
| utm_campaign | string | No       | Campaign identifier  |
| utm_channel  | string | No       | Channel identifier   |

#### Response

```json
{
	"success": true
}
```

### 2. User Statistics

Get statistics for a specific user.

```http
GET /api/stats?userId={userId}&email={email}
GET /api/stats?email=user@example.com
```

#### Query Parameters

| Parameter | Type   | Required | Description |
| --------- | ------ | -------- | ----------- |
| userId    | number | No\*     | User ID     |
| email     | string | No\*     | User email  |

\*Either userId or email must be provided

#### Response

```json
{
	"current_streak": 5,
	"highest_streak": 10,
	"total_reads": 25,
	"last_read_date": "2024-03-20T10:30:00Z",
	"opening_rate": 83.33,
	"history": [
		{
			"date": "2024-03-20T10:30:00Z",
			"post_id": "123",
			"post_title": "Example Post"
		}
	]
}
```

### 3. Admin Statistics

Get administrative statistics and analytics.

```http
GET /api/stats/admin?startDate={startDate}&endDate={endDate}&newsletterDate={newsletterDate}&minStreak={minStreak}
```

#### Query Parameters

| Parameter      | Type   | Required | Description                                     |
| -------------- | ------ | -------- | ----------------------------------------------- |
| startDate      | string | Yes      | Start date for filtering (YYYY-MM-DD)           |
| endDate        | string | Yes      | End date for filtering (YYYY-MM-DD)             |
| newsletterDate | string | No       | Filter by specific newsletter date (YYYY-MM-DD) |
| minStreak      | number | No       | Filter users by minimum streak                  |

#### Response

```json
{
	"total_users": 100,
	"avg_streak": 4.5,
	"avg_opening_rate": 75.8,
	"active_users": 80
}
```

### 4. Top Readers

Get top 10 readers sorted by opening rate and streak.

```http
GET /api/stats/admin/top-readers?startDate={startDate}&endDate={endDate}&newsletterDate={newsletterDate}&minStreak={minStreak}
```

#### Query Parameters

| Parameter      | Type   | Required | Description                                     |
| -------------- | ------ | -------- | ----------------------------------------------- |
| startDate      | string | Yes      | Start date for filtering (YYYY-MM-DD)           |
| endDate        | string | Yes      | End date for filtering (YYYY-MM-DD)             |
| newsletterDate | string | No       | Filter by specific newsletter date (YYYY-MM-DD) |
| minStreak      | number | No       | Filter users by minimum streak                  |

#### Response

```json
[
	{
		"email": "user@example.com",
		"streak": 10,
		"opening_rate": 100,
		"last_read": "2024-03-20T10:30:00Z"
	}
]
```

### 5. Historical Statistics

Get historical statistics for the admin dashboard.

```http
GET /api/stats/admin/historical?startDate={startDate}&endDate={endDate}&newsletterDate={newsletterDate}&minStreak={minStreak}
```

#### Query Parameters

| Parameter      | Type   | Required | Description                                     |
| -------------- | ------ | -------- | ----------------------------------------------- |
| startDate      | string | Yes      | Start date for filtering (YYYY-MM-DD)           |
| endDate        | string | Yes      | End date for filtering (YYYY-MM-DD)             |
| newsletterDate | string | No       | Filter by specific newsletter date (YYYY-MM-DD) |
| minStreak      | number | No       | Filter users by minimum streak                  |

#### Response

```json
{
	"daily_stats": [
		{
			"date": "2024-03-20",
			"avg_streak": 3.5,
			"opening_rate": 72.5
		}
	]
}
```

### 6. Post Details

Get details about a specific post.

```http
GET /api/posts?id={postId}
```

#### Query Parameters

| Parameter | Type   | Required | Description |
| --------- | ------ | -------- | ----------- |
| id        | string | Yes      | Post ID     |

#### Response

Returns post details from Beehiiv API

### 7. Post Statistics

Get statistics for a specific post.

```http
GET /api/posts/stats?id={postId}
```

#### Query Parameters

| Parameter | Type   | Required | Description |
| --------- | ------ | -------- | ----------- |
| id        | string | Yes      | Post ID     |

#### Response

Returns post-specific statistics

### 8. User Registration

Register a new user account.

```http
POST /api/auth/register
```

#### Request Body

```json
{
	"email": "user@example.com",
	"password": "securepassword"
}
```

#### Response

```json
{
	"token": "jwt_token_here",
	"user": {
		"id": 1,
		"email": "user@example.com"
	}
}
```

### 9. User Login

Authenticate a user and get access token.

```http
POST /api/auth/login
```

#### Request Body

```json
{
	"email": "user@example.com",
	"password": "securepassword"
}
```

#### Response

```json
{
	"token": "jwt_token_here",
	"user": {
		"id": 1,
		"email": "user@example.com"
	}
}
```

### 10. Change Password

Change user's password.

```http
POST /api/auth/change-password
```

#### Headers

```
Authorization: Bearer <token>
```

#### Request Body

```json
{
	"currentPassword": "oldpassword",
	"newPassword": "newpassword"
}
```

#### Response

```json
{
	"success": true
}
```

## CORS

The API supports CORS for the following origins:

- `https://the-news-gamification-ten.vercel.app`
- `http://localhost:5173`
- `http://localhost:3000`

## Example Usage (JavaScript)

```javascript
// Example: Login
async function login(email, password) {
	const response = await fetch('https://api.example.com/api/auth/login', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({ email, password }),
	});
	return await response.json();
}

// Example: Get User Stats
async function getUserStats(token, userId) {
	const response = await fetch(`https://api.example.com/api/stats?userId=${userId}`, {
		headers: {
			Authorization: `Bearer ${token}`,
		},
	});
	return await response.json();
}

// Example: Record Read
async function recordRead(email, postId) {
	const response = await fetch(`https://api.example.com/?email=${email}&id=${postId}`);
	return await response.json();
}
```
