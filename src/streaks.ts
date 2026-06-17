import { App, TFile } from 'obsidian';
import {
	createRoutineCache,
	getEffectiveTodayDateKey,
	getTodayDateKey,
	normalizeFolder,
} from './model';
import type {
	RoutineCache,
	RoutineConfig,
	RoutineFreezePeriod,
	RoutineTask,
	RoutineStreaksSettings,
	WeekStartDay,
} from './model';

interface TaskStats {
	total: number;
	completed: number;
	tasks: RoutineTask[];
}

interface DailyNoteSnapshot {
	dateKey: string;
	file: TFile;
	content: string;
}

interface DatePattern {
	regex: RegExp;
	tokens: string[];
}

export interface RecalculationResult {
	cache: Record<string, RoutineCache>;
	todayDate: string;
	todayPath: string;
	todayFileFound: boolean;
	notesScanned: number;
}

const DAY_IN_MS = 24 * 60 * 60 * 1000;
const DATE_TOKEN_REGEX = /YYYY|yyyy|YY|yy|MM|mm|M|m|DD|dd|D|d/g;

export async function calculateRoutineCaches(
	app: App,
	settings: RoutineStreaksSettings,
): Promise<RecalculationResult> {
	const todayDate = getEffectiveTodayDateKey(settings.dayStartHour);
	const todayPath = getDailyNotePath(todayDate, settings);
	const todayFile = app.vault.getAbstractFileByPath(todayPath);
	const todayFileFound = todayFile instanceof TFile;
	const notes = await readDailyNotes(app, settings);
	const completionDatesByRoutine = new Map<string, string[]>();
	const todayStatsByRoutine = new Map<string, TaskStats>();

	for (const routine of settings.routines) {
		completionDatesByRoutine.set(routine.id, []);
		todayStatsByRoutine.set(routine.id, {
			total: 0,
			completed: 0,
			tasks: [],
		});
	}

	for (const note of notes) {
		for (const routine of settings.routines) {
			const stats = getTaskStats(note.content, routine.tag);

			if (note.dateKey === todayDate) {
				todayStatsByRoutine.set(routine.id, stats);
			}

			if (stats.total > 0 && stats.completed === stats.total) {
				const completionDates =
					completionDatesByRoutine.get(routine.id) ?? [];
				completionDates.push(note.dateKey);
				completionDatesByRoutine.set(routine.id, completionDates);
			}
		}
	}

	const cache: Record<string, RoutineCache> = {};

	for (const routine of settings.routines) {
		const completionDates = uniqueSortedDateKeys(
			completionDatesByRoutine.get(routine.id) ?? [],
		);
		const todayStats = todayStatsByRoutine.get(routine.id) ?? {
			total: 0,
			completed: 0,
			tasks: [],
		};
			cache[routine.id] = calculateRoutineCache(
				routine,
				completionDates,
				todayDate,
				todayFileFound,
				todayStats,
				settings.weekStartDay,
			);
	}

	return {
		cache,
		todayDate,
		todayPath,
		todayFileFound,
		notesScanned: notes.length,
	};
}

export function getDailyNotePath(
	dateKey: string,
	settings: Pick<
		RoutineStreaksSettings,
		'dailyNoteFolder' | 'dailyNoteDateFormat'
	>,
): string {
	const folder = normalizeFolder(settings.dailyNoteFolder);
	const formatted = formatDateKey(dateKey, settings.dailyNoteDateFormat);
	const filePath = formatted.endsWith('.md') ? formatted : `${formatted}.md`;

	return folder.length > 0 ? `${folder}/${filePath}` : filePath;
}

export function parseDailyNoteDateFromPath(
	filePath: string,
	settings: Pick<
		RoutineStreaksSettings,
		'dailyNoteFolder' | 'dailyNoteDateFormat'
	>,
): string | null {
	const folder = normalizeFolder(settings.dailyNoteFolder);
	let relativePath = filePath;

	if (folder.length > 0) {
		const prefix = `${folder}/`;

		if (!filePath.startsWith(prefix)) {
			return null;
		}

		relativePath = filePath.slice(prefix.length);
	}

	return parseDateKey(relativePath, settings.dailyNoteDateFormat);
}

async function readDailyNotes(
	app: App,
	settings: RoutineStreaksSettings,
): Promise<DailyNoteSnapshot[]> {
	const snapshots: DailyNoteSnapshot[] = [];

	for (const file of app.vault.getMarkdownFiles()) {
		const dateKey = parseDailyNoteDateFromPath(file.path, settings);

		if (!dateKey) {
			continue;
		}

		snapshots.push({
			dateKey,
			file,
			content: await app.vault.cachedRead(file),
		});
	}

	return snapshots.sort((left, right) =>
		left.dateKey.localeCompare(right.dateKey),
	);
}

function calculateRoutineCache(
	routine: RoutineConfig,
	completionDates: string[],
	todayDate: string,
	todayFileFound: boolean,
	todayStats: TaskStats,
	weekStartDay: WeekStartDay,
): RoutineCache {
	const cache = createRoutineCache();
	const completedSet = new Set(completionDates);
	const streak =
		routine.schedule.type === 'weekly_count'
			? calculateWeeklyCountStreak(
					routine,
					completionDates,
					todayDate,
					weekStartDay,
				)
			: calculateScheduledDateStreak(routine, completedSet, todayDate);

	return {
		...cache,
		currentStreak: streak.currentStreak,
		longestStreak: streak.longestStreak,
		lastCompletedDate: streak.countedCompletionDates.at(-1) ?? '',
		lastComputedAt: new Date().toISOString(),
		completedDates: completionDates,
		countedCompletionDates: streak.countedCompletionDates,
		todayTaskCount: todayStats.total,
		todayCompletedTaskCount: todayStats.completed,
		todayIncompleteTaskCount: Math.max(
			0,
			todayStats.total - todayStats.completed,
		),
		todayStatus: getTodayStatus(
			routine,
			todayDate,
			todayFileFound,
			todayStats,
			completedSet,
		),
		todayTasks: todayStats.tasks,
	};
}

function calculateScheduledDateStreak(
	routine: RoutineConfig,
	completedSet: Set<string>,
	todayDate: string,
): {
	currentStreak: number;
	longestStreak: number;
	countedCompletionDates: string[];
} {
	const countedCompletionDates = [...completedSet].filter((dateKey) =>
		shouldCountCompletion(routine, dateKey, completedSet),
	);

	if (countedCompletionDates.length === 0) {
		return {
			currentStreak: 0,
			longestStreak: 0,
			countedCompletionDates: [],
		};
	}

	const earliestCountedDate = countedCompletionDates.sort()[0];
	if (!earliestCountedDate) {
		return {
			currentStreak: 0,
			longestStreak: 0,
			countedCompletionDates: [],
		};
	}

	let currentStreak = 0;
	let longestStreak = 0;

	for (
		let dateKey = earliestCountedDate;
		dateKey <= todayDate;
		dateKey = addDays(dateKey, 1)
	) {
		if (shouldCountCompletion(routine, dateKey, completedSet)) {
			currentStreak += 1;
			longestStreak = Math.max(longestStreak, currentStreak);
		} else if (isFrozenDate(routine, dateKey, completedSet)) {
			continue;
		} else if (!isEligibleDate(routine, dateKey)) {
			continue;
		} else if (dateKey === todayDate) {
			continue;
		} else {
			currentStreak = 0;
		}
	}

	return {
		currentStreak,
		longestStreak,
		countedCompletionDates: uniqueSortedDateKeys(countedCompletionDates),
	};
}

function calculateWeeklyCountStreak(
	routine: RoutineConfig,
	completionDates: string[],
	todayDate: string,
	weekStartDay: WeekStartDay,
): {
	currentStreak: number;
	longestStreak: number;
	countedCompletionDates: string[];
} {
	const uniqueCompletionDates = uniqueSortedDateKeys(completionDates);

	if (
		routine.schedule.type !== 'weekly_count' ||
		uniqueCompletionDates.length === 0
	) {
		return {
			currentStreak: 0,
			longestStreak: 0,
			countedCompletionDates: [],
		};
	}

	const weeklyTarget = routine.schedule.weeklyTarget;
	const completionsByWeek = new Map<string, string[]>();
	const completedSet = new Set(uniqueCompletionDates);

	for (const dateKey of uniqueCompletionDates) {
		const weekStart = getWeekStart(dateKey, weekStartDay);
		const weekCompletions = completionsByWeek.get(weekStart) ?? [];
		weekCompletions.push(dateKey);
		completionsByWeek.set(weekStart, weekCompletions);
	}

	const firstCompletedDate = uniqueCompletionDates[0];
	if (!firstCompletedDate) {
		return {
			currentStreak: 0,
			longestStreak: 0,
			countedCompletionDates: [],
		};
	}

	const currentWeekStart = getWeekStart(todayDate, weekStartDay);
	let currentStreak = 0;
	let longestStreak = 0;
	const countedCompletionDates: string[] = [];

	for (
		let weekStart = getWeekStart(firstCompletedDate, weekStartDay);
		weekStart <= currentWeekStart;
		weekStart = addDays(weekStart, 7)
	) {
		const weekCompletions = completionsByWeek.get(weekStart) ?? [];
		const effectiveWeeklyTarget = getEffectiveWeeklyTarget(
			routine,
			weekStart,
			weeklyTarget,
			completedSet,
		);
		const isCurrentWeek = weekStart === currentWeekStart;
		const completedTarget = weekCompletions.length >= effectiveWeeklyTarget;

		if (effectiveWeeklyTarget === 0) {
			continue;
		}

		if (isCurrentWeek || completedTarget) {
			for (const completionDate of weekCompletions) {
				currentStreak += 1;
				longestStreak = Math.max(longestStreak, currentStreak);
				countedCompletionDates.push(completionDate);
			}
			continue;
		}

		currentStreak = 0;
	}

	return {
		currentStreak,
		longestStreak,
		countedCompletionDates: uniqueSortedDateKeys(countedCompletionDates),
	};
}

function getTodayStatus(
	routine: RoutineConfig,
	todayDate: string,
	todayFileFound: boolean,
	todayStats: TaskStats,
	completedSet: Set<string>,
): RoutineCache['todayStatus'] {
	if (!routine.enabled) {
		return 'disabled';
	}

	if (!isScheduledDate(routine, todayDate)) {
		return 'off_schedule';
	}

	if (todayStats.total > 0 && todayStats.completed === todayStats.total) {
		return 'complete';
	}

	if (
		isFrozenDate(routine, todayDate, completedSet) &&
		isScheduledDate(routine, todayDate)
	) {
		return 'frozen';
	}

	if (!todayFileFound) {
		return 'missing_daily_note';
	}

	if (todayStats.total === 0) {
		return 'no_tasks';
	}

	return 'incomplete';
}

function shouldCountCompletion(
	routine: RoutineConfig,
	dateKey: string,
	completedSet: Set<string>,
): boolean {
	if (!completedSet.has(dateKey)) {
		return false;
	}

	if (isScheduledDate(routine, dateKey)) {
		return true;
	}

	return false;
}

function isEligibleDate(
	routine: RoutineConfig,
	dateKey: string,
): boolean {
	return isScheduledDate(routine, dateKey);
}

function getEffectiveWeeklyTarget(
	routine: RoutineConfig,
	weekStart: string,
	weeklyTarget: number,
	completedSet: Set<string>,
): number {
	const weekEnd = addDays(weekStart, 6);
	const frozenDateCount = countFrozenDatesInRange(
		routine,
		weekStart,
		weekEnd,
		completedSet,
	);

	return Math.max(0, weeklyTarget - frozenDateCount);
}

function countFrozenDatesInRange(
	routine: RoutineConfig,
	startDate: string,
	endDate: string,
	completedSet: Set<string>,
): number {
	let count = 0;

	for (
		let dateKey = startDate;
		dateKey <= endDate;
		dateKey = addDays(dateKey, 1)
	) {
		if (isFrozenDate(routine, dateKey, completedSet)) {
			count += 1;
		}
	}

	return count;
}

function isFrozenDate(
	routine: RoutineConfig,
	dateKey: string,
	completedSet?: Set<string>,
): boolean {
	return routine.freezePeriods.some((period) =>
		isDateInFreezePeriod(period, dateKey, completedSet),
	);
}

function isDateInFreezePeriod(
	period: RoutineFreezePeriod,
	dateKey: string,
	completedSet?: Set<string>,
): boolean {
	if (dateKey < period.startDate) {
		return false;
	}

	if (period.kind !== 'pause' || period.pauseEnd === 'date') {
		return dateKey <= period.endDate;
	}

	if (period.pauseEnd === 'indefinite') {
		return true;
	}

	const completionDate = getFirstCompletionOnOrAfter(
		completedSet,
		period.startDate,
	);

	return !completionDate || dateKey < completionDate;
}

function getFirstCompletionOnOrAfter(
	completedSet: Set<string> | undefined,
	dateKey: string,
): string | null {
	if (!completedSet) {
		return null;
	}

	return (
		[...completedSet]
			.sort()
			.find((completedDate) => completedDate >= dateKey) ?? null
	);
}

function isScheduledDate(routine: RoutineConfig, dateKey: string): boolean {
	const date = parseDate(dateKey);

	if (!date) {
		return false;
	}

	if (routine.schedule.type === 'weekly_count') {
		return true;
	}

	if (routine.schedule.type === 'interval') {
		const startDate = parseDate(routine.schedule.startDate);

		if (!startDate) {
			return false;
		}

		const difference = differenceInDays(routine.schedule.startDate, dateKey);
		const intervalDays =
			routine.schedule.intervalUnit === 'week'
				? routine.schedule.intervalAmount * 7
				: routine.schedule.intervalAmount;
		return difference >= 0 && difference % intervalDays === 0;
	}

	return routine.schedule.weekdays.includes(date.getDay());
}

function getTaskStats(content: string, tag: string): TaskStats {
	const escapedTag = escapeRegExp(tag);
	const tagRegex = new RegExp(
		`(^|\\s)${escapedTag}(?=$|\\s|[.,;:!?\\)\\]\\}])`,
	);
	const taskRegex = /^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/;
	let total = 0;
	let completed = 0;
	const tasks: RoutineTask[] = [];

	for (const [lineNumber, line] of content.split('\n').entries()) {
		const match = taskRegex.exec(line);

		if (!match) {
			continue;
		}

		const marker = match[1];
		const taskBody = match[2] ?? '';

		if (!tagRegex.test(taskBody)) {
			continue;
		}

		total += 1;
		const isCompleted = marker === 'x' || marker === 'X';

		if (isCompleted) {
			completed += 1;
		}

		tasks.push({
			text: getTaskText(taskBody, tagRegex),
			completed: isCompleted,
			lineNumber,
		});
	}

	return { total, completed, tasks };
}

function getTaskText(taskBody: string, tagRegex: RegExp): string {
	const text = taskBody.replace(tagRegex, ' ').replace(/\s+/g, ' ').trim();
	return text.length > 0 ? text : taskBody.trim();
}

function parseDateKey(path: string, format: string): string | null {
	const pattern = buildDatePattern(format);
	const match = pattern.regex.exec(path);

	if (!match) {
		return null;
	}

	let year = 0;
	let month = 0;
	let day = 0;

	for (let index = 0; index < pattern.tokens.length; index += 1) {
		const token = pattern.tokens[index];
		const value = match[index + 1];

		if (!token || !value) {
			continue;
		}

		if (token === 'YYYY' || token === 'yyyy') {
			year = Number(value);
		} else if (token === 'YY' || token === 'yy') {
			year = 2000 + Number(value);
		} else if (
			token === 'MM' ||
			token === 'mm' ||
			token === 'M' ||
			token === 'm'
		) {
			month = Number(value);
		} else if (
			token === 'DD' ||
			token === 'dd' ||
			token === 'D' ||
			token === 'd'
		) {
			day = Number(value);
		}
	}

	if (year === 0 || month === 0 || day === 0) {
		return null;
	}

	const date = new Date(year, month - 1, day);

	if (
		date.getFullYear() !== year ||
		date.getMonth() !== month - 1 ||
		date.getDate() !== day
	) {
		return null;
	}

	return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(
		2,
		'0',
	)}`;
}

function buildDatePattern(format: string): DatePattern {
	const tokens: string[] = [];
	let pattern = '^';
	let cursor = 0;
	let match: RegExpExecArray | null;

	DATE_TOKEN_REGEX.lastIndex = 0;

	while ((match = DATE_TOKEN_REGEX.exec(format)) !== null) {
		const token = match[0];
		pattern += escapeRegExp(format.slice(cursor, match.index));
		tokens.push(token);

		if (token === 'YYYY' || token === 'yyyy') {
			pattern += '(\\d{4})';
		} else if (token === 'YY' || token === 'yy') {
			pattern += '(\\d{2})';
		} else if (
			token === 'MM' ||
			token === 'mm' ||
			token === 'DD' ||
			token === 'dd'
		) {
			pattern += '(\\d{2})';
		} else {
			pattern += '(\\d{1,2})';
		}

		cursor = match.index + token.length;
	}

	pattern += escapeRegExp(format.slice(cursor));

	if (!format.endsWith('.md')) {
		pattern += '\\.md';
	}

	pattern += '$';

	return {
		regex: new RegExp(pattern),
		tokens,
	};
}

function formatDateKey(dateKey: string, format: string): string {
	const [year = '', month = '', day = ''] = dateKey.split('-');

	return format.replace(DATE_TOKEN_REGEX, (token) => {
		if (token === 'YYYY' || token === 'yyyy') {
			return year;
		}

		if (token === 'YY' || token === 'yy') {
			return year.slice(-2);
		}

		if (token === 'MM' || token === 'mm') {
			return month;
		}

		if (token === 'M' || token === 'm') {
			return String(Number(month));
		}

		if (token === 'DD' || token === 'dd') {
			return day;
		}

		return String(Number(day));
	});
}

function uniqueSortedDateKeys(dateKeys: string[]): string[] {
	return [...new Set(dateKeys)].sort();
}

function parseDate(dateKey: string): Date | null {
	const [yearPart, monthPart, dayPart] = dateKey.split('-');

	if (!yearPart || !monthPart || !dayPart) {
		return null;
	}

	const year = Number(yearPart);
	const month = Number(monthPart);
	const day = Number(dayPart);
	const date = new Date(year, month - 1, day);

	if (
		date.getFullYear() !== year ||
		date.getMonth() !== month - 1 ||
		date.getDate() !== day
	) {
		return null;
	}

	return date;
}

function addDays(dateKey: string, days: number): string {
	const date = parseDate(dateKey);

	if (!date) {
		return dateKey;
	}

	date.setDate(date.getDate() + days);
	return getTodayDateKey(date);
}

function differenceInDays(startDateKey: string, endDateKey: string): number {
	const startDate = parseDate(startDateKey);
	const endDate = parseDate(endDateKey);

	if (!startDate || !endDate) {
		return 0;
	}

	return Math.floor((endDate.getTime() - startDate.getTime()) / DAY_IN_MS);
}

function getWeekStart(dateKey: string, weekStartDay: WeekStartDay): string {
	const date = parseDate(dateKey);

	if (!date) {
		return dateKey;
	}

	const day = date.getDay();
	const distanceFromWeekStart = (day - weekStartDay + 7) % 7;
	date.setDate(date.getDate() - distanceFromWeekStart);
	return getTodayDateKey(date);
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
