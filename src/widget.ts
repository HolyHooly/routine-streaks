import { ItemView } from 'obsidian';
import type { WorkspaceLeaf } from 'obsidian';
import type RoutineStreaksPlugin from './main';
import {
	createRoutineCache,
	getEffectiveTodayDateKey,
	STREAK_WIDGET_TYPES,
} from './model';
import type {
	OverviewPet,
	RoutineCache,
	RoutineConfig,
	RoutineTask,
	RoutineStreaksSettings,
	StreakWidgetConfig,
	StreakWidgetType,
} from './model';
import {
	createRoutineProgressSummary,
	formatRoutineScheduleType,
	getRoutineProgressPercent,
} from './progress';

export const ROUTINE_STREAKS_WIDGET_VIEW_TYPE = 'routine-streaks-widget';

const TODAY_STATUS_LABELS: Record<RoutineCache['todayStatus'], string> = {
	disabled: 'Disabled',
	missing_daily_note: 'Daily note missing',
	no_tasks: 'No tagged tasks today',
	off_schedule: 'Off schedule today',
	frozen: 'Frozen today',
	incomplete: 'Incomplete today',
	complete: 'Complete today',
};

type PetMood = 'happy' | 'angry';

const PET_COLORS = {
	blush: '#f49ab0',
	cat: '#8f9aa7',
	catDark: '#687482',
	dog: '#c78342',
	dogDark: '#90572d',
	eye: '#211b18',
	mouth: '#211b18',
	muzzle: '#f1d2a2',
	outline: '#2a2522',
	parrot: '#38b96d',
	parrotDark: '#1f7d45',
	parrotLight: '#8de88d',
	parrotWing: '#2374c6',
	beak: '#f2b33d',
	warning: '#d94b45',
	white: '#fff2d8',
} as const;

export class RoutineStreaksWidgetView extends ItemView {
	private plugin: RoutineStreaksPlugin;

	constructor(leaf: WorkspaceLeaf, plugin: RoutineStreaksPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return ROUTINE_STREAKS_WIDGET_VIEW_TYPE;
	}

	getDisplayText(): string {
		return 'Routine streaks';
	}

	getIcon(): string {
		return 'flame';
	}

	async onOpen(): Promise<void> {
		await this.plugin.recalculate();
		this.render();
	}

	render(): void {
		this.contentEl.empty();
		this.contentEl.addClass('routine-streaks-widget-view');
		renderStreakWidget(this.contentEl, this.plugin.settings, {
			showHeading: true,
			collapsibleTasks: true,
			expandedTaskRoutineIds:
				this.plugin.settings.expandedWidgetTaskRoutineIds,
			onToggleTaskSection: (routineId, expanded) => {
				void this.plugin.setWidgetTaskSectionExpanded(routineId, expanded);
			},
			onTaskToggle: (task, completed) => {
				void this.plugin.setTodayTaskCompleted(task.lineNumber, completed);
			},
		});
	}
}

interface RenderStreakWidgetOptions {
	showHeading?: boolean;
	headingTitle?: string;
	headingSubtitle?: string;
	showTasks?: boolean;
	collapsibleTasks?: boolean;
	expandedTaskRoutineIds?: string[];
	onToggleTaskSection?: (routineId: string, expanded: boolean) => void;
	onTaskToggle?: (task: RoutineTask, completed: boolean) => void;
}

interface MarkdownWidgetConfig {
	headingTitle?: string;
	headingSubtitle?: string;
	widgetLayout?: StreakWidgetConfig[];
}

export function renderStreakWidget(
	containerEl: HTMLElement,
	settings: RoutineStreaksSettings,
	options: RenderStreakWidgetOptions = {},
): void {
	const enabledRoutines = settings.routines.filter((routine) => routine.enabled);
	const showTasks = options.showTasks ?? true;
	const wrapper = containerEl.createDiv({ cls: 'routine-streaks-widget' });

	if (options.showHeading) {
		const header = wrapper.createDiv({ cls: 'routine-streaks-widget-header' });
		header.createDiv({
			cls: 'routine-streaks-widget-title',
			text: options.headingTitle ?? 'Streak widget',
		});
		header.createDiv({
			cls: 'routine-streaks-widget-subtitle',
			text: options.headingSubtitle ?? 'Synced from daily note tasks',
		});
	}

	for (const widget of settings.widgetLayout) {
		renderWidgetBlock(wrapper, settings, enabledRoutines, widget, {
			...options,
			showTasks,
		});
	}
}

function renderWidgetBlock(
	containerEl: HTMLElement,
	settings: RoutineStreaksSettings,
	enabledRoutines: RoutineConfig[],
	widget: StreakWidgetConfig,
	options: RenderStreakWidgetOptions,
): void {
	const block = containerEl.createDiv({
		cls: `routine-streaks-widget-block routine-streaks-widget-block-${widget.type}`,
	});
	const title = widget.title.trim();

	if (title.length > 0) {
		block.createDiv({
			cls: 'routine-streaks-widget-block-title',
			text: title,
		});
	}

	if (widget.type === 'pet') {
		renderPetWidget(block, enabledRoutines, settings);
		return;
	}

	if (enabledRoutines.length === 0) {
		block.createDiv({
			cls: 'routine-streaks-widget-empty',
			text: 'No enabled routines.',
		});
		return;
	}

	if (widget.type === 'overview') {
		renderOverviewWidget(block, enabledRoutines, settings);
	} else if (widget.type === 'routine_cards') {
		renderRoutineCardsWidget(block, enabledRoutines, settings);
	} else if (widget.type === 'today_items') {
		renderTodayItemsWidget(block, enabledRoutines, settings, options);
	} else {
		renderFocusedRoutineWidget(block, enabledRoutines, settings, widget, options);
	}
}

export function parseMarkdownWidgetSource(
	source: string,
	settings: RoutineStreaksSettings,
): MarkdownWidgetConfig {
	const config: MarkdownWidgetConfig = {};
	const widgetLayout: StreakWidgetConfig[] = [];
	let inWidgetsSection = false;
	let currentWidget: StreakWidgetConfig | null = null;

	for (const rawLine of source.split(/\r?\n/)) {
		const trimmedLine = rawLine.trim();

		if (
			trimmedLine.length === 0 ||
			trimmedLine === '---' ||
			trimmedLine.startsWith('//')
		) {
			continue;
		}

		const listItem = trimmedLine.startsWith('-');
		const line = listItem ? trimmedLine.slice(1).trim() : trimmedLine;
		const keyValue = readKeyValue(line);

		if (!listItem && keyValue) {
			const normalizedKey = normalizeMarkdownKey(keyValue.key);

			if (
				!inWidgetsSection &&
				(normalizedKey === 'title' ||
					normalizedKey === 'heading' ||
					normalizedKey === 'heading_title')
			) {
				config.headingTitle = keyValue.value.trim() || undefined;
				continue;
			}

			if (
				!inWidgetsSection &&
				(normalizedKey === 'subtitle' ||
					normalizedKey === 'heading_subtitle')
			) {
				config.headingSubtitle = keyValue.value.trim() || undefined;
				continue;
			}

			if (normalizedKey === 'widgets') {
				inWidgetsSection = true;
				continue;
			}

			if (inWidgetsSection && currentWidget) {
				applyMarkdownWidgetProperty(currentWidget, keyValue, settings);
				continue;
			}
		}

		const widget = parseMarkdownWidgetLine(
			line,
			widgetLayout.length,
			settings,
		);

		if (widget) {
			widgetLayout.push(widget);
			currentWidget = widget;
			continue;
		}

		if (keyValue && currentWidget) {
			applyMarkdownWidgetProperty(currentWidget, keyValue, settings);
		}
	}

	if (widgetLayout.length > 0) {
		config.widgetLayout = widgetLayout;
	}

	return config;
}

function parseMarkdownWidgetLine(
	line: string,
	index: number,
	settings: RoutineStreaksSettings,
): StreakWidgetConfig | null {
	const parts = line
		.split('|')
		.map((part) => part.trim())
		.filter((part) => part.length > 0);
	const firstPart = parts[0];

	if (!firstPart) {
		return null;
	}

	const keyValue = readKeyValue(firstPart);
	const key = keyValue ? normalizeMarkdownKey(keyValue.key) : '';
	const typeSource =
		key === 'type' && keyValue ? keyValue.value : keyValue?.key ?? firstPart;
	const type = normalizeMarkdownWidgetType(typeSource);

	if (!type) {
		return null;
	}

	const inlineValue = key === 'type' ? '' : keyValue?.value.trim() ?? '';
	let title = '';
	let routineId = '';

	if (type === 'routine_focus') {
		routineId = normalizeMarkdownRoutineId(inlineValue, settings);

		if (parts[2]) {
			title = parts[1] ?? '';
			routineId = normalizeMarkdownRoutineId(parts[2], settings);
		} else if (parts[1]) {
			const routineIdFromSecondPart = normalizeMarkdownRoutineId(
				parts[1],
				settings,
			);

			if (!routineId && routineIdFromSecondPart) {
				routineId = routineIdFromSecondPart;
			} else {
				title = parts[1];
			}
		}
	} else {
		title = parts[1] ?? inlineValue;
	}

	return createMarkdownWidgetConfig(type, index, title, routineId);
}

function applyMarkdownWidgetProperty(
	widget: StreakWidgetConfig,
	keyValue: { key: string; value: string },
	settings: RoutineStreaksSettings,
): void {
	const key = normalizeMarkdownKey(keyValue.key);
	const value = keyValue.value.trim();

	if (key === 'title') {
		widget.title = value || getDefaultWidgetTitle(widget.type);
		return;
	}

	if (
		widget.type === 'routine_focus' &&
		(key === 'id' ||
			key === 'routine' ||
			key === 'routineid' ||
			key === 'routine_id')
	) {
		widget.routineId = normalizeMarkdownRoutineId(value, settings);
	}
}

function createMarkdownWidgetConfig(
	type: StreakWidgetType,
	index: number,
	title: string,
	routineId: string,
): StreakWidgetConfig {
	return {
		id: `markdown_widget_${index + 1}_${type}`,
		type,
		title: title.trim() || getDefaultWidgetTitle(type),
		routineId,
	};
}

function readKeyValue(line: string): { key: string; value: string } | null {
	const separatorIndex = line.indexOf(':');

	if (separatorIndex < 0) {
		return null;
	}

	const key = line.slice(0, separatorIndex).trim();

	if (key.length === 0) {
		return null;
	}

	return {
		key,
		value: line.slice(separatorIndex + 1).trim(),
	};
}

function normalizeMarkdownKey(value: string): string {
	return value.trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function normalizeMarkdownWidgetType(value: string): StreakWidgetType | null {
	const normalizedValue = normalizeMarkdownKey(value);

	if (
		normalizedValue === 'overview' ||
		normalizedValue === 'pet' ||
		normalizedValue === 'routine_cards' ||
		normalizedValue === 'today_items' ||
		normalizedValue === 'routine_focus'
	) {
		return normalizedValue;
	}

	if (normalizedValue === 'cards' || normalizedValue === 'routines') {
		return 'routine_cards';
	}

	if (
		normalizedValue === 'animal' ||
		normalizedValue === 'pixel_pet' ||
		normalizedValue === 'pet_card'
	) {
		return 'pet';
	}

	if (normalizedValue === 'tasks' || normalizedValue === 'items') {
		return 'today_items';
	}

	if (normalizedValue === 'focus' || normalizedValue === 'routine') {
		return 'routine_focus';
	}

	return null;
}

function normalizeMarkdownRoutineId(
	value: string,
	settings: RoutineStreaksSettings,
): string {
	const routineId = value.trim();
	return settings.routines.some((routine) => routine.id === routineId)
		? routineId
		: '';
}

function getDefaultWidgetTitle(type: StreakWidgetType): string {
	return (
		STREAK_WIDGET_TYPES.find((widgetType) => widgetType.type === type)?.label ??
		'Widget'
	);
}

function renderOverviewWidget(
	containerEl: HTMLElement,
	enabledRoutines: RoutineConfig[],
	settings: RoutineStreaksSettings,
): void {
	const requiredRoutines = getRequiredTodayRoutines(enabledRoutines, settings);
	const completedToday = countCompletedToday(requiredRoutines, settings);
	const bestCurrentStreak = enabledRoutines.reduce((best, routine) => {
		const cache = settings.cache[routine.id] ?? createRoutineCache();
		return Math.max(best, cache.currentStreak);
	}, 0);
	const summary = containerEl.createDiv({
		cls: 'routine-streaks-widget-summary',
	});
	renderMetric(summary, String(bestCurrentStreak), 'Best current');
	renderMetric(summary, `${completedToday}/${requiredRoutines.length}`, 'Today');
	renderPetMetric(
		summary,
		settings.overviewPet,
		isTodayComplete(requiredRoutines, completedToday),
	);
}

function renderPetWidget(
	containerEl: HTMLElement,
	enabledRoutines: RoutineConfig[],
	settings: RoutineStreaksSettings,
): void {
	const requiredRoutines = getRequiredTodayRoutines(enabledRoutines, settings);
	const completedToday = countCompletedToday(requiredRoutines, settings);
	renderPetMetric(
		containerEl,
		settings.overviewPet,
		isTodayComplete(requiredRoutines, completedToday),
	);
}

function getRequiredTodayRoutines(
	enabledRoutines: RoutineConfig[],
	settings: RoutineStreaksSettings,
): RoutineConfig[] {
	return enabledRoutines.filter((routine) => {
		const cache = settings.cache[routine.id] ?? createRoutineCache();
		return cache.todayStatus !== 'off_schedule' && cache.todayStatus !== 'frozen';
	});
}

function countCompletedToday(
	enabledRoutines: RoutineConfig[],
	settings: RoutineStreaksSettings,
): number {
	return enabledRoutines.filter((routine) => {
		const cache = settings.cache[routine.id] ?? createRoutineCache();
		return cache.todayStatus === 'complete';
	}).length;
}

function isTodayComplete(
	requiredRoutines: RoutineConfig[],
	completedToday: number,
): boolean {
	return requiredRoutines.length === 0 || completedToday === requiredRoutines.length;
}

function renderRoutineCardsWidget(
	containerEl: HTMLElement,
	enabledRoutines: RoutineConfig[],
	settings: RoutineStreaksSettings,
): void {
	const grid = containerEl.createDiv({ cls: 'routine-streaks-widget-grid' });

	for (const routine of enabledRoutines) {
		const cache = settings.cache[routine.id] ?? createRoutineCache();
		renderRoutineWidgetCard(grid, routine, cache, settings, {
			showTasks: false,
		});
	}
}

function renderTodayItemsWidget(
	containerEl: HTMLElement,
	enabledRoutines: RoutineConfig[],
	settings: RoutineStreaksSettings,
	options: RenderStreakWidgetOptions,
): void {
	const list = containerEl.createDiv({
		cls: 'routine-streaks-widget-task-groups',
	});

	for (const routine of enabledRoutines) {
		const cache = settings.cache[routine.id] ?? createRoutineCache();
		const group = list.createDiv({
			cls: `routine-streaks-widget-task-group routine-streaks-widget-card-${cache.todayStatus}`,
		});
		const header = group.createDiv({ cls: 'routine-streaks-widget-card-header' });
		header.createDiv({
			cls: 'routine-streaks-widget-card-title',
			text: routine.label || routine.id,
		});
		renderScheduleBadge(header, routine);
		group.createDiv({
			cls: 'routine-streaks-widget-progress-label',
			text: formatRoutineProgress(routine, cache, settings),
		});
		renderTaskSection(group, routine, cache, options);
	}
}

function renderFocusedRoutineWidget(
	containerEl: HTMLElement,
	enabledRoutines: RoutineConfig[],
	settings: RoutineStreaksSettings,
	widget: StreakWidgetConfig,
	options: RenderStreakWidgetOptions,
): void {
	const routine =
		enabledRoutines.find((candidate) => candidate.id === widget.routineId) ??
		enabledRoutines[0];

	if (!routine) {
		return;
	}

	const cache = settings.cache[routine.id] ?? createRoutineCache();
	renderRoutineWidgetCard(containerEl, routine, cache, settings, options);
}

function renderMetric(
	containerEl: HTMLElement,
	value: string,
	label: string,
): void {
	const metric = containerEl.createDiv({ cls: 'routine-streaks-widget-metric' });
	metric.createDiv({ cls: 'routine-streaks-widget-metric-value', text: value });
	metric.createDiv({ cls: 'routine-streaks-widget-metric-label', text: label });
}

function renderPetMetric(
	containerEl: HTMLElement,
	pet: OverviewPet,
	happy: boolean,
): void {
	const mood = happy ? 'happy' : 'angry';
	const metric = containerEl.createDiv({
		cls: happy
			? 'routine-streaks-widget-metric routine-streaks-widget-pet is-happy'
			: 'routine-streaks-widget-metric routine-streaks-widget-pet is-angry',
	});
	renderPixelPet(metric, pet, mood);
}

function renderPixelPet(
	containerEl: HTMLElement,
	pet: OverviewPet,
	mood: PetMood,
): void {
	const canvasEl = containerEl.createEl('canvas', {
		cls: 'routine-streaks-pixel-art',
		attr: {
			'aria-hidden': 'true',
			height: '64',
			width: '64',
		},
	});
	const context = canvasEl.getContext('2d');

	if (!context) {
		return;
	}

	context.imageSmoothingEnabled = false;
	context.clearRect(0, 0, 64, 64);

	if (pet === 'cat') {
		drawCatPixelArt(context, mood);
	} else if (pet === 'parrot') {
		drawParrotPixelArt(context, mood);
	} else {
		drawDogPixelArt(context, mood);
	}
}

function drawDogPixelArt(
	context: CanvasRenderingContext2D,
	mood: PetMood,
): void {
	const angry = mood === 'angry';
	const { blush, dog, dogDark, eye, mouth, muzzle, outline, warning, white } =
		PET_COLORS;

	drawPixelRect(context, 10, 7, 12, 22, outline);
	drawPixelRect(context, 12, 9, 8, 18, dogDark);
	drawPixelRect(context, 42, 7, 12, 22, outline);
	drawPixelRect(context, 44, 9, 8, 18, dogDark);
	drawPixelRect(context, 20, 6, 24, 4, outline);
	drawPixelRect(context, 16, 10, 32, 4, outline);
	drawPixelRect(context, 12, 14, 40, 8, outline);
	drawPixelRect(context, 10, 22, 44, 24, outline);
	drawPixelRect(context, 14, 46, 36, 8, outline);
	drawPixelRect(context, 20, 54, 24, 4, outline);

	drawPixelRect(context, 20, 10, 24, 4, dog);
	drawPixelRect(context, 16, 14, 32, 8, dog);
	drawPixelRect(context, 14, 22, 36, 22, dog);
	drawPixelRect(context, 18, 44, 28, 8, dog);
	drawPixelRect(context, 24, 52, 16, 2, dog);
	drawPixelRect(context, 20, 31, 24, 16, muzzle);
	drawPixelRect(context, 24, 35, 16, 14, white);
	drawPixelRect(context, 30, 34, 4, 4, eye);

	if (angry) {
		drawPixelRect(context, 21, 24, 9, 3, warning);
		drawPixelRect(context, 35, 24, 9, 3, warning);
		drawPixelRect(context, 21, 27, 5, 3, eye);
		drawPixelRect(context, 39, 27, 5, 3, eye);
		drawPixelRect(context, 25, 43, 14, 3, mouth);
		drawPixelRect(context, 24, 44, 4, 3, mouth);
		drawPixelRect(context, 36, 44, 4, 3, mouth);
	} else {
		drawPixelRect(context, 23, 25, 5, 5, eye);
		drawPixelRect(context, 37, 25, 5, 5, eye);
		drawPixelRect(context, 26, 43, 12, 3, mouth);
		drawPixelRect(context, 28, 46, 8, 4, blush);
	}

	drawPixelRect(context, 16, 33, 4, 3, blush);
	drawPixelRect(context, 44, 33, 4, 3, blush);
	drawPixelRect(context, 20, 56, 6, 2, outline);
	drawPixelRect(context, 38, 56, 6, 2, outline);
}

function drawCatPixelArt(
	context: CanvasRenderingContext2D,
	mood: PetMood,
): void {
	const angry = mood === 'angry';
	const { blush, cat, catDark, eye, mouth, muzzle, outline, warning, white } =
		PET_COLORS;

	drawPixelRect(context, 8, 5, 6, 8, outline);
	drawPixelRect(context, 14, 9, 6, 8, outline);
	drawPixelRect(context, 50, 5, 6, 8, outline);
	drawPixelRect(context, 44, 9, 6, 8, outline);
	drawPixelRect(context, 10, 9, 4, 6, cat);
	drawPixelRect(context, 48, 9, 4, 6, cat);
	drawPixelRect(context, 12, 15, 40, 6, outline);
	drawPixelRect(context, 10, 21, 44, 24, outline);
	drawPixelRect(context, 14, 45, 36, 8, outline);
	drawPixelRect(context, 20, 53, 24, 4, outline);

	drawPixelRect(context, 16, 17, 32, 4, cat);
	drawPixelRect(context, 14, 21, 36, 22, cat);
	drawPixelRect(context, 18, 43, 28, 8, cat);
	drawPixelRect(context, 24, 51, 16, 2, cat);
	drawPixelRect(context, 21, 33, 22, 14, muzzle);
	drawPixelRect(context, 25, 36, 14, 12, white);
	drawPixelRect(context, 30, 34, 4, 4, eye);
	drawPixelRect(context, 16, 20, 6, 3, catDark);
	drawPixelRect(context, 42, 20, 6, 3, catDark);

	if (angry) {
		drawPixelRect(context, 21, 24, 9, 3, warning);
		drawPixelRect(context, 35, 24, 9, 3, warning);
		drawPixelRect(context, 21, 27, 5, 3, eye);
		drawPixelRect(context, 39, 27, 5, 3, eye);
		drawPixelRect(context, 25, 43, 14, 3, mouth);
		drawPixelRect(context, 24, 44, 4, 3, mouth);
		drawPixelRect(context, 36, 44, 4, 3, mouth);
	} else {
		drawPixelRect(context, 23, 25, 5, 5, eye);
		drawPixelRect(context, 37, 25, 5, 5, eye);
		drawPixelRect(context, 26, 43, 12, 3, mouth);
		drawPixelRect(context, 28, 46, 8, 4, blush);
	}

	drawPixelRect(context, 6, 35, 12, 2, outline);
	drawPixelRect(context, 46, 35, 12, 2, outline);
	drawPixelRect(context, 7, 40, 11, 2, outline);
	drawPixelRect(context, 46, 40, 11, 2, outline);
	drawPixelRect(context, 16, 32, 4, 3, blush);
	drawPixelRect(context, 44, 32, 4, 3, blush);
}

function drawParrotPixelArt(
	context: CanvasRenderingContext2D,
	mood: PetMood,
): void {
	const angry = mood === 'angry';
	const {
		beak,
		blush,
		eye,
		mouth,
		outline,
		parrot,
		parrotDark,
		parrotLight,
		parrotWing,
		warning,
		white,
	} = PET_COLORS;

	drawPixelRect(context, 19, 7, 21, 4, outline);
	drawPixelRect(context, 15, 11, 29, 8, outline);
	drawPixelRect(context, 13, 19, 34, 15, outline);
	drawPixelRect(context, 43, 21, 12, 7, outline);
	drawPixelRect(context, 47, 28, 10, 5, outline);
	drawPixelRect(context, 13, 34, 35, 18, outline);
	drawPixelRect(context, 17, 52, 22, 6, outline);
	drawPixelRect(context, 10, 45, 10, 15, outline);
	drawPixelRect(context, 14, 58, 8, 4, outline);
	drawPixelRect(context, 24, 58, 6, 3, outline);
	drawPixelRect(context, 35, 58, 6, 3, outline);

	drawPixelRect(context, 20, 11, 19, 4, parrotLight);
	drawPixelRect(context, 17, 15, 25, 8, parrot);
	drawPixelRect(context, 16, 23, 28, 10, parrot);
	drawPixelRect(context, 17, 34, 27, 16, parrot);
	drawPixelRect(context, 21, 50, 16, 4, parrotDark);
	drawPixelRect(context, 12, 46, 8, 12, parrotDark);
	drawPixelRect(context, 31, 34, 12, 16, parrotWing);
	drawPixelRect(context, 34, 38, 8, 8, parrotDark);
	drawPixelRect(context, 20, 18, 10, 10, white);
	drawPixelRect(context, 23, 20, 4, 4, eye);

	if (angry) {
		drawPixelRect(context, 18, 16, 12, 3, warning);
		drawPixelRect(context, 25, 18, 5, 3, warning);
		drawPixelRect(context, 22, 21, 7, 3, eye);
		drawPixelRect(context, 39, 19, 13, 5, outline);
		drawPixelRect(context, 42, 23, 14, 4, outline);
		drawPixelRect(context, 42, 31, 12, 5, outline);
		drawPixelRect(context, 41, 20, 10, 3, beak);
		drawPixelRect(context, 44, 24, 10, 2, beak);
		drawPixelRect(context, 44, 28, 10, 4, mouth);
		drawPixelRect(context, 43, 32, 9, 3, beak);
	} else {
		drawPixelRect(context, 40, 22, 10, 4, beak);
		drawPixelRect(context, 45, 25, 10, 4, beak);
		drawPixelRect(context, 47, 30, 7, 2, beak);
		drawPixelRect(context, 43, 29, 8, 2, mouth);
		drawPixelRect(context, 25, 46, 6, 3, blush);
	}

	drawPixelRect(context, 16, 30, 4, 3, blush);
	drawPixelRect(context, 29, 55, 6, 3, parrotDark);
}

function drawPixelRect(
	context: CanvasRenderingContext2D,
	x: number,
	y: number,
	width: number,
	height: number,
	color: string,
): void {
	context.fillStyle = color;
	context.fillRect(x, y, width, height);
}

function renderRoutineWidgetCard(
	containerEl: HTMLElement,
	routine: RoutineConfig,
	cache: RoutineCache,
	settings: RoutineStreaksSettings,
	options: RenderStreakWidgetOptions,
): void {
	const card = containerEl.createDiv({
		cls: `routine-streaks-widget-card routine-streaks-widget-card-${cache.todayStatus}`,
	});
	const header = card.createDiv({ cls: 'routine-streaks-widget-card-header' });
	const titleBlock = header.createDiv({
		cls: 'routine-streaks-widget-card-title-block',
	});

	titleBlock.createDiv({
		cls: 'routine-streaks-widget-card-title',
		text: routine.label || routine.id,
	});
	titleBlock.createDiv({
		cls: 'routine-streaks-widget-card-tag',
		text: routine.tag,
	});
	renderScheduleBadge(header, routine);

	const body = card.createDiv({ cls: 'routine-streaks-widget-card-body' });
	body.createDiv({
		cls: 'routine-streaks-widget-streak-number',
		text: String(cache.currentStreak),
	});

	const details = body.createDiv({ cls: 'routine-streaks-widget-card-details' });
	details.createDiv({
		text: `Longest ${cache.longestStreak}`,
	});
	details.createDiv({
		text: cache.lastCompletedDate
			? `Last ${cache.lastCompletedDate}`
			: 'Last never',
	});

	const progress = createRoutineProgressSummary(
		routine,
		cache,
		getEffectiveTodayDateKey(settings.dayStartHour),
		settings.weekStartDay,
	);
	const progressPercent = getRoutineProgressPercent(progress);

	card.createDiv({
		cls: 'routine-streaks-widget-status',
		text: TODAY_STATUS_LABELS[cache.todayStatus],
	});

	const progressTrack = card.createDiv({
		cls: 'routine-streaks-widget-progress',
	});
	progressTrack.createDiv({
		cls: `routine-streaks-widget-progress-fill routine-streaks-widget-progress-fill-${cache.todayStatus}`,
		attr: {
			style: `width: ${progressPercent}%`,
		},
	});
	card.createDiv({
		cls: 'routine-streaks-widget-progress-label',
		text: progress.label,
	});

	if (!options.showTasks) {
		return;
	}

	renderTaskSection(card, routine, cache, options);
}

function formatRoutineProgress(
	routine: RoutineConfig,
	cache: RoutineCache,
	settings: RoutineStreaksSettings,
): string {
	return createRoutineProgressSummary(
		routine,
		cache,
		getEffectiveTodayDateKey(settings.dayStartHour),
		settings.weekStartDay,
	).label;
}

function renderScheduleBadge(
	containerEl: HTMLElement,
	routine: RoutineConfig,
): void {
	containerEl.createDiv({
		cls: 'routine-streaks-widget-schedule-badge',
		text: formatRoutineScheduleType(routine),
	});
}

function renderTaskSection(
	containerEl: HTMLElement,
	routine: RoutineConfig,
	cache: RoutineCache,
	options: RenderStreakWidgetOptions,
): void {
	const taskSectionExpanded = options.collapsibleTasks
		? (options.expandedTaskRoutineIds ?? []).includes(routine.id)
		: true;
	const taskHeader = containerEl.createDiv({
		cls: 'routine-streaks-widget-task-header',
	});
	taskHeader.createDiv({
		cls: 'routine-streaks-widget-task-heading',
		text: 'Today items',
	});

	if (options.collapsibleTasks) {
		const toggleButton = taskHeader.createEl('button', {
			cls: taskSectionExpanded
				? 'routine-streaks-widget-task-toggle is-expanded'
				: 'routine-streaks-widget-task-toggle',
			attr: {
				'aria-label': taskSectionExpanded ? 'Hide today items' : 'Show today items',
			},
		});
		toggleButton.type = 'button';
		toggleButton.addEventListener('click', () => {
			options.onToggleTaskSection?.(routine.id, !taskSectionExpanded);
		});
	}

	if (!taskSectionExpanded) {
		return;
	}

	const taskList = containerEl.createDiv({ cls: 'routine-streaks-widget-task-list' });

	if (cache.todayTasks.length === 0) {
		taskList.createDiv({
			cls: 'routine-streaks-widget-task-empty',
			text: 'No matching tasks in today\'s daily note.',
		});
		return;
	}

	for (const task of cache.todayTasks) {
		const taskEl = taskList.createDiv({
			cls: task.completed
				? 'routine-streaks-widget-task is-complete'
				: 'routine-streaks-widget-task',
		});
		if (options.onTaskToggle && task.lineNumber >= 0) {
			const checkbox = taskEl.createEl('input', {
				cls: 'routine-streaks-widget-task-checkbox',
				type: 'checkbox',
			});
			checkbox.checked = task.completed;
			checkbox.addEventListener('change', () => {
				options.onTaskToggle?.(task, checkbox.checked);
			});
		} else {
			taskEl.createSpan({
				cls: 'routine-streaks-widget-task-check',
				text: task.completed ? 'x' : '',
			});
		}
		taskEl.createSpan({
			cls: 'routine-streaks-widget-task-text',
			text: task.text,
		});
	}
}
