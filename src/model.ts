export type ScheduleType = 'weekdays' | 'weekly_count' | 'interval';

export type WeekStartDay = 0 | 1;

export type IntervalUnit = 'day' | 'week';

export type OverviewPet = 'dog' | 'cat' | 'parrot';

export type RoutineFreezeKind = 'freeze' | 'pause';

export type RoutinePauseEndMode = 'date' | 'completion' | 'indefinite';

export type StreakWidgetType =
	| 'overview'
	| 'pet'
	| 'routine_cards'
	| 'today_items'
	| 'routine_focus';

export type ScriptableWidgetType = 'dashboard' | StreakWidgetType;

export type ScriptableWidgetFamily = 'small' | 'medium' | 'large';

export type RoutineTaskStatus =
	| 'disabled'
	| 'missing_daily_note'
	| 'no_tasks'
	| 'off_schedule'
	| 'frozen'
	| 'incomplete'
	| 'complete';

export interface WeekdaySchedule {
	type: 'weekdays';
	weekdays: number[];
}

export interface WeeklyCountSchedule {
	type: 'weekly_count';
	weeklyTarget: number;
}

export interface IntervalSchedule {
	type: 'interval';
	intervalAmount: number;
	intervalUnit: IntervalUnit;
	startDate: string;
}

export type RoutineSchedule =
	| WeekdaySchedule
	| WeeklyCountSchedule
	| IntervalSchedule;

export interface RoutineFreezePeriod {
	startDate: string;
	endDate: string;
	kind: RoutineFreezeKind;
	pauseEnd: RoutinePauseEndMode;
}

export interface RoutineConfig {
	id: string;
	label: string;
	tag: string;
	enabled: boolean;
	schedule: RoutineSchedule;
	templateItems: string[];
	freezePeriods: RoutineFreezePeriod[];
}

export interface RoutineTask {
	text: string;
	completed: boolean;
	lineNumber: number;
}

export interface RoutineCache {
	currentStreak: number;
	longestStreak: number;
	lastCompletedDate: string;
	lastComputedAt: string;
	completedDates: string[];
	countedCompletionDates: string[];
	todayTaskCount: number;
	todayCompletedTaskCount: number;
	todayStatus: RoutineTaskStatus;
	todayTasks: RoutineTask[];
}

export interface StreakWidgetConfig {
	id: string;
	type: StreakWidgetType;
	title: string;
	routineId: string;
}

export interface RoutineStreaksSettings {
	routines: RoutineConfig[];
	cache: Record<string, RoutineCache>;
	dailyNoteFolder: string;
	dailyNoteDateFormat: string;
	mainSyncDevice: boolean;
	scriptableExportPath: string;
	scriptableWidgetType: ScriptableWidgetType;
	scriptableRoutineId: string;
	scriptableWidgetFamily: ScriptableWidgetFamily;
	scriptableTodayRoutineIds: string[];
	weekStartDay: WeekStartDay;
	overviewPet: OverviewPet;
	autoRecalculate: boolean;
	expandedRoutineIds: string[];
	expandedWidgetTaskRoutineIds: string[];
	widgetLayout: StreakWidgetConfig[];
}

export const STREAK_WIDGET_TYPES: Array<{
	type: StreakWidgetType;
	label: string;
	description: string;
}> = [
	{
		type: 'overview',
		label: 'Overview',
		description: 'Best streak, today progress, and enabled routine count.',
	},
	{
		type: 'pet',
		label: 'Pet',
		description: 'A pixel pet that reacts to today\'s routine progress.',
	},
	{
		type: 'routine_cards',
		label: 'Routine cards',
		description: 'A card grid with streak and progress for every routine.',
	},
	{
		type: 'today_items',
		label: 'Today items',
		description: 'A checklist grouped by routine for today.',
	},
	{
		type: 'routine_focus',
		label: 'Focused routine',
		description: 'A single selected routine with its status and items.',
	},
];

export const SCRIPTABLE_WIDGET_TYPES: Array<{
	type: ScriptableWidgetType;
	label: string;
	description: string;
}> = [
	{
		type: 'dashboard',
		label: 'Dashboard',
		description: 'Best streak, today progress, pet, and routine rows.',
	},
	...STREAK_WIDGET_TYPES,
];

export const SCRIPTABLE_WIDGET_FAMILIES: Array<{
	family: ScriptableWidgetFamily;
	label: string;
	description: string;
}> = [
	{
		family: 'small',
		label: 'Small',
		description: 'Compact square widget.',
	},
	{
		family: 'medium',
		label: 'Medium',
		description: 'Wide widget with more room for rows.',
	},
	{
		family: 'large',
		label: 'Large',
		description: 'Tall widget for lists and dashboards.',
	},
];

export const SCRIPTABLE_WIDGET_FAMILIES_BY_TYPE: Record<
	ScriptableWidgetType,
	ScriptableWidgetFamily[]
> = {
	dashboard: ['large'],
	overview: ['medium', 'large'],
	pet: ['small', 'medium', 'large'],
	routine_cards: ['medium', 'large'],
	today_items: ['small', 'medium', 'large'],
	routine_focus: ['small', 'medium', 'large'],
};

export const WEEKDAY_OPTIONS = [
	{ value: 0, label: 'Sun' },
	{ value: 1, label: 'Mon' },
	{ value: 2, label: 'Tue' },
	{ value: 3, label: 'Wed' },
	{ value: 4, label: 'Thu' },
	{ value: 5, label: 'Fri' },
	{ value: 6, label: 'Sat' },
] as const;

const ALL_WEEKDAYS = WEEKDAY_OPTIONS.map((option) => option.value);
const DEFAULT_SCRIPTABLE_EXPORT_PATH = 'Routine Streaks/data.json';
export const SYNC_SETTINGS_PATH = 'Routine Streaks/sync.json';
const ROUTINE_ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const ROUTINE_ID_LENGTH = 6;

const SYNCED_SETTINGS_KEYS = [
	'routines',
	'dailyNoteFolder',
	'dailyNoteDateFormat',
	'scriptableExportPath',
	'scriptableWidgetType',
	'scriptableRoutineId',
	'scriptableWidgetFamily',
	'scriptableTodayRoutineIds',
	'weekStartDay',
	'overviewPet',
	'autoRecalculate',
	'widgetLayout',
] as const;

type SyncedSettingsKey = (typeof SYNCED_SETTINGS_KEYS)[number];

export type RoutineStreaksSyncedSettings = Pick<
	RoutineStreaksSettings,
	SyncedSettingsKey
>;

export interface RoutineStreaksSyncFile {
	version: 1;
	updatedAt: string;
	settings: RoutineStreaksSyncedSettings;
}

export function getTodayDateKey(date = new Date()): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
}

export function createDefaultSettings(today = getTodayDateKey()): RoutineStreaksSettings {
	const routines: RoutineConfig[] = [];

	return {
		routines,
		cache: Object.fromEntries(
			routines.map((routine) => [routine.id, createRoutineCache()]),
		),
		dailyNoteFolder: '',
		dailyNoteDateFormat: 'YYYY-MM-DD',
		mainSyncDevice: false,
		scriptableExportPath: DEFAULT_SCRIPTABLE_EXPORT_PATH,
		scriptableWidgetType: 'dashboard',
		scriptableRoutineId: routines[0]?.id ?? '',
		scriptableWidgetFamily: 'large',
		scriptableTodayRoutineIds: routines.map((routine) => routine.id).slice(0, 4),
		weekStartDay: 1,
		overviewPet: 'dog',
		autoRecalculate: true,
		expandedRoutineIds: [],
		expandedWidgetTaskRoutineIds: [],
		widgetLayout: createDefaultWidgetLayout(),
	};
}

export function createSyncFile(
	settings: RoutineStreaksSettings,
): RoutineStreaksSyncFile {
	return {
		version: 1,
		updatedAt: new Date().toISOString(),
		settings: createSyncedSettings(settings),
	};
}

export function mergeSyncedSettings(
	currentSettings: RoutineStreaksSettings,
	rawSyncFile: unknown,
): RoutineStreaksSettings {
	const syncSource = getSyncedSettingsSource(rawSyncFile);
	const normalizedSettings = normalizeSettings({
		...currentSettings,
		...syncSource,
		cache: currentSettings.cache,
		mainSyncDevice: currentSettings.mainSyncDevice,
		expandedRoutineIds: currentSettings.expandedRoutineIds,
		expandedWidgetTaskRoutineIds: currentSettings.expandedWidgetTaskRoutineIds,
	});

	return {
		...normalizedSettings,
		mainSyncDevice: currentSettings.mainSyncDevice,
	};
}

function createSyncedSettings(
	settings: RoutineStreaksSettings,
): RoutineStreaksSyncedSettings {
	return Object.fromEntries(
		SYNCED_SETTINGS_KEYS.map((key) => [key, settings[key]]),
	) as RoutineStreaksSyncedSettings;
}

function getSyncedSettingsSource(rawSyncFile: unknown): Record<string, unknown> {
	const source = isRecord(rawSyncFile) ? rawSyncFile : {};
	const settings = isRecord(source.settings) ? source.settings : source;
	return settings;
}

export function createRoutine(
	id: string,
	label: string,
	tag: string,
	today = getTodayDateKey(),
): RoutineConfig {
	return {
		id,
		label,
		tag,
		enabled: true,
		schedule: createDefaultSchedule('weekdays', today),
		templateItems: [],
		freezePeriods: [],
	};
}

export function createNewRoutine(
	existingRoutines: RoutineConfig[],
	today = getTodayDateKey(),
): RoutineConfig {
	const id = generateNextRoutineId(existingRoutines);
	return createRoutine(id, 'New Routine', `#routine/${id}`, today);
}

export function createDefaultSchedule(
	type: ScheduleType,
	today = getTodayDateKey(),
): RoutineSchedule {
	if (type === 'weekly_count') {
		return {
			type,
			weeklyTarget: 3,
		};
	}

	if (type === 'interval') {
		return {
			type,
			intervalAmount: 2,
			intervalUnit: 'day',
			startDate: today,
		};
	}

	return {
		type: 'weekdays',
		weekdays: [...ALL_WEEKDAYS],
	};
}

export function createRoutineCache(): RoutineCache {
	return {
		currentStreak: 0,
		longestStreak: 0,
		lastCompletedDate: '',
		lastComputedAt: '',
		completedDates: [],
		countedCompletionDates: [],
		todayTaskCount: 0,
		todayCompletedTaskCount: 0,
		todayStatus: 'no_tasks',
		todayTasks: [],
	};
}

export function createRoutineFreezePeriod(
	today = getTodayDateKey(),
): RoutineFreezePeriod {
	return {
		startDate: today,
		endDate: today,
		kind: 'freeze',
		pauseEnd: 'date',
	};
}

export function createRoutinePausePeriod(
	pauseEnd: RoutinePauseEndMode,
	today = getTodayDateKey(),
	endDate = today,
): RoutineFreezePeriod {
	return {
		startDate: today,
		endDate: pauseEnd === 'date' ? endDate : '',
		kind: 'pause',
		pauseEnd,
	};
}

export function createDefaultWidgetLayout(): StreakWidgetConfig[] {
	return [
		createWidgetConfig('overview'),
		createWidgetConfig('routine_cards'),
		createWidgetConfig('today_items'),
	];
}

export function createWidgetConfig(
	type: StreakWidgetType,
	routineId = '',
): StreakWidgetConfig {
	return {
		id: `widget_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
		type,
		title: '',
		routineId,
	};
}

export function normalizeSettings(raw: unknown): RoutineStreaksSettings {
	const today = getTodayDateKey();
	const defaults = createDefaultSettings(today);
	const source = isRecord(raw) ? raw : {};
	const rawRoutines = Array.isArray(source.routines)
		? source.routines
		: defaults.routines;
	const seenIds = new Set<string>();
	const routines = rawRoutines.map((routine, index) =>
		normalizeRoutine(routine, `routine_${index + 1}`, seenIds, today),
	);
	const normalizedRoutines = routines.length > 0 ? routines : defaults.routines;
	const cacheSource = isRecord(source.cache) ? source.cache : {};
	const requestedScriptableRoutineId = readString(source.scriptableRoutineId, '');
	const fallbackScriptableRoutineId =
		normalizedRoutines.find((routine) => routine.enabled)?.id ??
		normalizedRoutines[0]?.id ??
		'';
	const scriptableWidgetType = normalizeScriptableWidgetType(
		source.scriptableWidgetType,
	);
	const scriptableWidgetFamily = normalizeScriptableWidgetFamily(
		source.scriptableWidgetFamily,
		scriptableWidgetType,
	);
	const routineIds = new Set(normalizedRoutines.map((routine) => routine.id));
	const scriptableTodayRoutineIds = readStringArray(
		source.scriptableTodayRoutineIds,
	).filter((id) => routineIds.has(id));
	const fallbackScriptableTodayRoutineIds = normalizedRoutines
		.filter((routine) => routine.enabled)
		.map((routine) => routine.id)
		.slice(0, 4);

	return {
		routines: normalizedRoutines,
		cache: Object.fromEntries(
			normalizedRoutines.map((routine) => [
				routine.id,
				normalizeRoutineCache(cacheSource[routine.id]),
			]),
		),
		dailyNoteFolder: normalizeFolder(
			readString(source.dailyNoteFolder, defaults.dailyNoteFolder),
		),
		dailyNoteDateFormat: readString(
			source.dailyNoteDateFormat,
			defaults.dailyNoteDateFormat,
		).trim() || defaults.dailyNoteDateFormat,
		mainSyncDevice: readBoolean(
			source.mainSyncDevice,
			readBoolean(source.scriptableExportEnabled, defaults.mainSyncDevice),
		),
		scriptableExportPath: normalizeScriptableExportPath(
			readString(source.scriptableExportPath, defaults.scriptableExportPath),
		),
		scriptableWidgetType,
		scriptableRoutineId: normalizedRoutines.some(
			(routine) => routine.id === requestedScriptableRoutineId,
		)
			? requestedScriptableRoutineId
			: fallbackScriptableRoutineId,
		scriptableWidgetFamily,
		scriptableTodayRoutineIds:
			scriptableTodayRoutineIds.length > 0
				? scriptableTodayRoutineIds
				: fallbackScriptableTodayRoutineIds,
		weekStartDay: normalizeWeekStartDay(source.weekStartDay),
		overviewPet: normalizeOverviewPet(source.overviewPet),
		autoRecalculate: readBoolean(
			source.autoRecalculate,
			defaults.autoRecalculate,
		),
		expandedRoutineIds: readStringArray(source.expandedRoutineIds).filter(
			(id) => normalizedRoutines.some((routine) => routine.id === id),
		),
		expandedWidgetTaskRoutineIds: readStringArray(
			source.expandedWidgetTaskRoutineIds,
		).filter((id) => normalizedRoutines.some((routine) => routine.id === id)),
		widgetLayout: normalizeWidgetLayout(
			source.widgetLayout,
			normalizedRoutines,
		),
	};
}

export function sanitizeRoutineId(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.replace(/\s+/g, '_')
		.replace(/[^a-z0-9_-]/g, '')
		.replace(/_+/g, '_')
		.replace(/-+/g, '-')
		.replace(/^[-_]+|[-_]+$/g, '');
}

export function normalizeRoutineTag(value: string, fallbackId: string): string {
	const fallbackTag = `#routine/${fallbackId}`;
	const trimmed = value.trim();
	const tag = trimmed.length > 0 ? trimmed : fallbackTag;
	return tag.startsWith('#') ? tag.replace(/\s+/g, '-') : `#${tag.replace(/\s+/g, '-')}`;
}

export function normalizeFolder(value: string): string {
	return value.trim().replace(/^\/+|\/+$/g, '');
}

export function normalizeScriptableExportPath(value: string): string {
	const path = value.trim().replace(/^\/+|\/+$/g, '');

	if (path.length === 0) {
		return DEFAULT_SCRIPTABLE_EXPORT_PATH;
	}

	return path.endsWith('.json') ? path : `${path}.json`;
}

export function generateNextRoutineId(routines: RoutineConfig[]): string {
	const existingIds = new Set(routines.map((routine) => routine.id));
	let id = generateRandomRoutineId();

	while (existingIds.has(id)) {
		id = generateRandomRoutineId();
	}

	return id;
}

function generateRandomRoutineId(): string {
	let id = '';

	for (let index = 0; index < ROUTINE_ID_LENGTH; index += 1) {
		const characterIndex = Math.floor(
			Math.random() * ROUTINE_ID_ALPHABET.length,
		);
		id += ROUTINE_ID_ALPHABET[characterIndex] ?? '0';
	}

	return id;
}

export function isValidDateKey(value: string): boolean {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
		return false;
	}

	const [yearPart, monthPart, dayPart] = value.split('-');
	if (!yearPart || !monthPart || !dayPart) {
		return false;
	}

	const year = Number(yearPart);
	const month = Number(monthPart);
	const day = Number(dayPart);
	const date = new Date(year, month - 1, day);

	return (
		date.getFullYear() === year &&
		date.getMonth() === month - 1 &&
		date.getDate() === day
	);
}

function normalizeRoutine(
	raw: unknown,
	fallbackId: string,
	seenIds: Set<string>,
	today: string,
): RoutineConfig {
	const source = isRecord(raw) ? raw : {};
	const sanitizedFallbackId = sanitizeRoutineId(fallbackId) || 'routine';
	const requestedId =
		sanitizeRoutineId(readString(source.id, sanitizedFallbackId)) ||
		sanitizedFallbackId;
	let id = requestedId;
	let suffix = 2;

	while (seenIds.has(id)) {
		id = `${requestedId}_${suffix}`;
		suffix += 1;
	}

	seenIds.add(id);

	return {
		id,
		label: readString(source.label, id),
			tag: normalizeRoutineTag(readString(source.tag, `#routine/${id}`), id),
			enabled: readBoolean(source.enabled, true),
			schedule: normalizeSchedule(source.schedule, today),
			templateItems: readStringArray(source.templateItems)
				.map(normalizeTemplateItem)
				.filter((item) => item.length > 0),
		freezePeriods: normalizeFreezePeriods(source.freezePeriods, today),
	};
}

function normalizeSchedule(raw: unknown, today: string): RoutineSchedule {
	if (!isRecord(raw)) {
		return createDefaultSchedule('weekdays', today);
	}

	const type = raw.type;

	if (type === 'weekly_count') {
		return {
			type,
			weeklyTarget: clampInteger(raw.weeklyTarget, 1, 7, 3),
		};
	}

	if (type === 'interval') {
		const startDate = readString(raw.startDate, today);
		const legacyIntervalDays = clampInteger(raw.intervalDays, 1, 366, 2);
		const intervalUnit = normalizeIntervalUnit(raw.intervalUnit);

		return {
			type,
			intervalAmount: clampInteger(
				raw.intervalAmount,
				1,
				366,
				intervalUnit === 'week' || legacyIntervalDays % 7 === 0
					? Math.max(1, legacyIntervalDays / 7)
					: legacyIntervalDays,
			),
			intervalUnit:
				typeof raw.intervalUnit === 'string'
					? intervalUnit
					: legacyIntervalDays % 7 === 0
						? 'week'
						: 'day',
			startDate: isValidDateKey(startDate) ? startDate : today,
		};
	}

	const weekdays = Array.isArray(raw.weekdays)
		? normalizeWeekdays(raw.weekdays)
		: [...ALL_WEEKDAYS];

	return {
		type: 'weekdays',
		weekdays: weekdays.length > 0 ? weekdays : [...ALL_WEEKDAYS],
	};
}

function normalizeRoutineCache(raw: unknown): RoutineCache {
	if (!isRecord(raw)) {
		return createRoutineCache();
	}

	return {
		currentStreak: readNumber(raw.currentStreak, 0),
		longestStreak: readNumber(raw.longestStreak, 0),
		lastCompletedDate: readString(raw.lastCompletedDate, ''),
		lastComputedAt: readString(raw.lastComputedAt, ''),
		completedDates: readStringArray(raw.completedDates),
		countedCompletionDates: readStringArray(raw.countedCompletionDates),
		todayTaskCount: readNumber(raw.todayTaskCount, 0),
		todayCompletedTaskCount: readNumber(raw.todayCompletedTaskCount, 0),
		todayStatus: normalizeTaskStatus(raw.todayStatus),
		todayTasks: readRoutineTasks(raw.todayTasks),
	};
}

function normalizeWidgetLayout(
	raw: unknown,
	routines: RoutineConfig[],
): StreakWidgetConfig[] {
	if (!Array.isArray(raw)) {
		return createDefaultWidgetLayout();
	}

	const routineIds = new Set(routines.map((routine) => routine.id));
	const widgets = raw.flatMap((entry): StreakWidgetConfig[] => {
		if (!isRecord(entry)) {
			return [];
		}

		const type = normalizeWidgetType(entry.type);

		if (!type) {
			return [];
		}

		const routineId = readString(entry.routineId, '');

		return [
			{
				id:
					sanitizeRoutineId(readString(entry.id, '')) ||
					createWidgetConfig(type).id,
				type,
				title: readString(entry.title, '').trim(),
				routineId: routineIds.has(routineId) ? routineId : '',
			},
		];
	});

	return widgets.length > 0 ? widgets : createDefaultWidgetLayout();
}

function normalizeWidgetType(raw: unknown): StreakWidgetType | null {
	if (
		raw === 'overview' ||
		raw === 'pet' ||
		raw === 'routine_cards' ||
		raw === 'today_items' ||
		raw === 'routine_focus'
	) {
		return raw;
	}

	return null;
}

function normalizeScriptableWidgetType(raw: unknown): ScriptableWidgetType {
	if (raw === 'dashboard') {
		return raw;
	}

	return normalizeWidgetType(raw) ?? 'dashboard';
}

function normalizeScriptableWidgetFamily(
	raw: unknown,
	widgetType: ScriptableWidgetType,
): ScriptableWidgetFamily {
	const allowedFamilies = getAllowedScriptableWidgetFamilies(widgetType);

	if (
		(raw === 'small' || raw === 'medium' || raw === 'large') &&
		allowedFamilies.includes(raw)
	) {
		return raw;
	}

	return getDefaultScriptableWidgetFamily(widgetType);
}

export function getAllowedScriptableWidgetFamilies(
	widgetType: ScriptableWidgetType,
): ScriptableWidgetFamily[] {
	return SCRIPTABLE_WIDGET_FAMILIES_BY_TYPE[widgetType] ?? ['medium'];
}

export function getDefaultScriptableWidgetFamily(
	widgetType: ScriptableWidgetType,
): ScriptableWidgetFamily {
	return getAllowedScriptableWidgetFamilies(widgetType)[0] ?? 'medium';
}

export function normalizeTemplateItem(value: string): string {
	return value
		.trim()
		.replace(/^\s*[-*+]\s+\[[ xX]\]\s+/, '')
		.replace(/(^|\s)#[^\s]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

export function formatRoutineTemplate(routine: RoutineConfig): string {
	return routine.templateItems
		.map(normalizeTemplateItem)
		.filter((item) => item.length > 0)
		.map((item) => `- [ ] ${routine.tag} ${item}`)
		.join('\n');
}

function normalizeIntervalUnit(raw: unknown): IntervalUnit {
	return raw === 'week' ? 'week' : 'day';
}

function normalizeOverviewPet(raw: unknown): OverviewPet {
	if (raw === 'cat' || raw === 'parrot') {
		return raw;
	}

	return 'dog';
}

function normalizeRoutineFreezeKind(raw: unknown): RoutineFreezeKind {
	return raw === 'pause' ? 'pause' : 'freeze';
}

function normalizeRoutinePauseEnd(raw: unknown): RoutinePauseEndMode {
	if (raw === 'completion' || raw === 'indefinite') {
		return raw;
	}

	return 'date';
}

function normalizeWeekStartDay(raw: unknown): WeekStartDay {
	return Number(raw) === 0 ? 0 : 1;
}

function normalizeFreezePeriods(
	raw: unknown,
	today: string,
): RoutineFreezePeriod[] {
	if (!Array.isArray(raw)) {
		return [];
	}

	return raw.flatMap((entry): RoutineFreezePeriod[] => {
		if (!isRecord(entry)) {
			return [];
		}

		const kind = normalizeRoutineFreezeKind(entry.kind);
		const pauseEnd =
			kind === 'pause' ? normalizeRoutinePauseEnd(entry.pauseEnd) : 'date';
		let startDate = readString(entry.startDate, today);
		let endDate = readString(entry.endDate, startDate);

		if (!isValidDateKey(startDate)) {
			startDate = today;
		}

		if (pauseEnd !== 'date') {
			return [
				{
					startDate,
					endDate: '',
					kind,
					pauseEnd,
				},
			];
		}

		if (!isValidDateKey(endDate)) {
			endDate = startDate;
		}

		if (endDate < startDate) {
			return [
				{
					startDate: endDate,
					endDate: startDate,
					kind,
					pauseEnd,
				},
			];
		}

		return [
			{
				startDate,
				endDate,
				kind,
				pauseEnd,
			},
		];
	});
}

function normalizeTaskStatus(raw: unknown): RoutineTaskStatus {
	if (
		raw === 'disabled' ||
		raw === 'missing_daily_note' ||
		raw === 'no_tasks' ||
		raw === 'off_schedule' ||
		raw === 'frozen' ||
		raw === 'incomplete' ||
		raw === 'complete'
	) {
		return raw;
	}

	return 'no_tasks';
}

function normalizeWeekdays(raw: unknown[]): number[] {
	const weekdays = raw
		.map((value) => Number(value))
		.filter((value) => Number.isInteger(value) && value >= 0 && value <= 6);

	return [...new Set(weekdays)].sort((left, right) => left - right);
}

function readString(value: unknown, fallback: string): string {
	return typeof value === 'string' ? value : fallback;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
	return typeof value === 'boolean' ? value : fallback;
}

function readNumber(value: unknown, fallback: number): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function readStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}

	return value.filter((entry): entry is string => typeof entry === 'string');
}

function readRoutineTasks(value: unknown): RoutineTask[] {
	if (!Array.isArray(value)) {
		return [];
	}

	return value.flatMap((entry) => {
		if (!isRecord(entry)) {
			return [];
		}

		const text = readString(entry.text, '').trim();

		if (text.length === 0) {
			return [];
		}

		return [
			{
				text,
				completed: readBoolean(entry.completed, false),
				lineNumber: readNumber(entry.lineNumber, -1),
			},
		];
	});
}

function clampInteger(
	value: unknown,
	minimum: number,
	maximum: number,
	fallback: number,
): number {
	const numberValue = Number(value);

	if (!Number.isInteger(numberValue)) {
		return fallback;
	}

	return Math.max(minimum, Math.min(maximum, numberValue));
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}
