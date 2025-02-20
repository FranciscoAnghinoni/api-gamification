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

## Endpoints

### 1. Record Read Event

Records when a user reads a post and updates their streak.

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
GET /api/admin/stats?startDate={startDate}&endDate={endDate}&postId={postId}&minStreak={minStreak}
```

#### Query Parameters

| Parameter | Type   | Required | Description                           |
| --------- | ------ | -------- | ------------------------------------- |
| startDate | string | No       | Start date for filtering (YYYY-MM-DD) |
| endDate   | string | No       | End date for filtering (YYYY-MM-DD)   |
| postId    | string | No       | Filter by specific post               |
| minStreak | number | No       | Filter users by minimum streak        |

#### Response

```json
{
	"total_users": 100,
	"avg_streak": 4.5,
	"max_streak": 15,
	"total_reads": 500,
	"top_readers": [
		{
			"email": "user@example.com",
			"streak": 10,
			"reads": 50
		}
	],
	"engagement_over_time": [
		{
			"date": "2024-03-20",
			"reads": 25,
			"unique_readers": 20
		}
	]
}
```

### 4. Post Details

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

### 5. Post Statistics

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

### 6. User Registration

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

### 7. User Login

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

### 8. Change Password

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

## Error Responses

All endpoints may return the following error responses:

### 400 Bad Request

```json
{
	"error": "Validation error message"
}
```

### 401 Unauthorized

```json
{
	"error": "Authentication required"
}
```

### 404 Not Found

```json
{
	"error": "Resource not found"
}
```

### 429 Too Many Requests

```json
{
	"error": "Rate limit exceeded"
}
```

### 500 Internal Server Error

```json
{
	"error": "Internal server error"
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
