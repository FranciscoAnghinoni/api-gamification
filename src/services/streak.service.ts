import { DatabaseService } from './db.service';

export class StreakService {
	constructor(private db: DatabaseService) {}

	async updateStreak(email: string): Promise<void> {
		const user = await this.db.getOrCreateUser(email);
		const today = new Date();

		// Skip streak updates on Sundays since there are no editions
		if (today.getDay() === 0) {
			return;
		}

		const lastRead = await this.db.getLastReadDate(user.id);
		if (!lastRead) {
			// First read ever, start streak at 1
			await this.db.updateUserStreak(user.id, 1);
			return;
		}

		const lastReadDate = new Date(lastRead);
		const yesterday = new Date(today);
		yesterday.setDate(today.getDate() - 1);

		// If yesterday was Sunday, check Friday
		if (yesterday.getDay() === 0) {
			yesterday.setDate(yesterday.getDate() - 2);
		}

		// Format dates to YYYY-MM-DD for comparison
		const lastReadFormatted = lastReadDate.toISOString().split('T')[0];
		const yesterdayFormatted = yesterday.toISOString().split('T')[0];
		const todayFormatted = today.toISOString().split('T')[0];

		let newStreak = 1;

		if (lastReadFormatted === yesterdayFormatted) {
			// Read yesterday, increment streak
			newStreak = user.current_streak + 1;
		} else if (lastReadFormatted === todayFormatted) {
			// Already read today, maintain current streak
			return;
		}
		// Otherwise, it's a gap in reading, start new streak at 1

		await this.db.updateUserStreak(user.id, newStreak);
	}
}
