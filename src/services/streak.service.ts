import { DatabaseService } from './db.service';

export class StreakService {
	constructor(private dbService: DatabaseService) {}

	async updateStreak(email: string): Promise<void> {
		const user = await this.dbService.getUser(email);
		if (!user) return;

		const today = new Date();
		const todayStr = today.toISOString().split('T')[0];

		// Skip processing on Sundays
		if (today.getDay() === 0) return;

		if (!user.last_read_date) {
			await this.dbService.createUser(email, todayStr);
			return;
		}

		const lastRead = new Date(user.last_read_date);
		const newStreak = this.isYesterday(lastRead, today) ? user.current_streak + 1 : 1;

		// Update user with new streak
		await this.dbService.createUser(email, todayStr);
	}

	private isYesterday(lastRead: Date, today: Date): boolean {
		const yesterday = new Date(today);
		yesterday.setDate(today.getDate() - 1);
		return lastRead.toISOString().split('T')[0] === yesterday.toISOString().split('T')[0];
	}
}
