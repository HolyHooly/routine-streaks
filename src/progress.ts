import type {
	RoutineCache,
	RoutineConfig,
	WeekStartDay,
} from './model';

export type RoutineProgressKind = 'daily_tasks' | 'weekly_count';

export interface RoutineProgressSummary {
	kind: RoutineProgressKind;
	completed: number;
	target: number;
	label: string;
}

export function formatRoutineScheduleType(routine: RoutineConfig): string {
	if (routine.schedule.type === 'weekly_count') {
		return 'Weekly';
	}

	if (routine.schedule.type === 'interval') {
		return 'Interval';
	}

	return 'Weekdays';
}

export function createRoutineProgressSummary(
	routine: RoutineConfig,
	cache: RoutineCache,
	todayDate: string,
	weekStartDay: WeekStartDay,
): RoutineProgressSummary {
	if (routine.schedule.type === 'weekly_count') {
		const target = Math.max(1, routine.schedule.weeklyTarget);
		const completed = countCurrentWeekCompletions(
			cache.completedDates,
			todayDate,
			weekStartDay,
		);

		return {
			kind: 'weekly_count',
			completed,
			target,
			label: `${completed}/${target} this week`,
		};
	}

	const target = Math.max(0, cache.todayTaskCount);
	const completed = Math.max(0, cache.todayCompletedTaskCount);

	return {
		kind: 'daily_tasks',
		completed,
		target,
		label: target > 0 ? `${completed}/${target} tasks today` : 'No tasks today',
	};
}

export function getRoutineProgressPercent(
	progress: RoutineProgressSummary,
): number {
	if (progress.target <= 0) {
		return 0;
	}

	return Math.min(
		100,
		Math.round((progress.completed / progress.target) * 100),
	);
}

function countCurrentWeekCompletions(
	completedDates: string[],
	todayDate: string,
	weekStartDay: WeekStartDay,
): number {
	const weekStart = getWeekStartDateKey(todayDate, weekStartDay);
	const weekEnd = addDaysToDateKey(weekStart, 6);
	const dates = new Set(completedDates);

	return [...dates].filter((dateKey) => dateKey >= weekStart && dateKey <= weekEnd)
		.length;
}

function getWeekStartDateKey(
	dateKey: string,
	weekStartDay: WeekStartDay,
): string {
	const date = parseDateKey(dateKey);

	if (!date) {
		return dateKey;
	}

	const day = date.getDay();
	const distanceFromWeekStart = (day - weekStartDay + 7) % 7;
	date.setDate(date.getDate() - distanceFromWeekStart);
	return formatDateKey(date);
}

function addDaysToDateKey(dateKey: string, days: number): string {
	const date = parseDateKey(dateKey);

	if (!date) {
		return dateKey;
	}

	date.setDate(date.getDate() + days);
	return formatDateKey(date);
}

function parseDateKey(dateKey: string): Date | null {
	const [yearPart, monthPart, dayPart] = dateKey.split('-');
	const year = Number(yearPart);
	const month = Number(monthPart);
	const day = Number(dayPart);

	if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
		return null;
	}

	return new Date(year, month - 1, day);
}

function formatDateKey(date: Date): string {
	return [
		String(date.getFullYear()),
		String(date.getMonth() + 1).padStart(2, '0'),
		String(date.getDate()).padStart(2, '0'),
	].join('-');
}
