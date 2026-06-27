import { Notice, Plugin, SuggestModal, TFile, TFolder } from 'obsidian';
import type { Editor, TAbstractFile } from 'obsidian';
import {
	createRoutineCache,
	createSyncFile,
	formatRoutineTemplate,
	getEffectiveTodayDateKey,
	mergeSyncedSettings,
	normalizeSettings,
	SYNC_SETTINGS_PATH,
} from './model';
import type {
	RoutineCache,
	RoutineConfig,
	RoutineStreaksSettings,
} from './model';
import { RoutineStreaksSettingTab } from './settings';
import {
	createRoutineProgressSummary,
	formatRoutineScheduleType,
} from './progress';
import {
	calculateRoutineCaches,
	getDailyNotePath,
	parseDailyNoteDateFromPath,
} from './streaks';
import type { RecalculationResult } from './streaks';
import {
	parseMarkdownWidgetSource,
	renderStreakWidget,
	ROUTINE_STREAKS_WIDGET_VIEW_TYPE,
	RoutineStreaksWidgetView,
} from './widget';

interface RecalculateOptions {
	showNotice?: boolean;
}

interface ExportOptions {
	showNotice?: boolean;
}

interface ScriptableTodayRoutineSummary {
	id: string;
	scheduleType: RoutineConfig['schedule']['type'];
	scheduleTypeLabel: string;
	status: RoutineCache['todayStatus'];
	taskCount: number;
	completedTaskCount: number;
	incompleteTaskCount: number;
	progressKind: 'daily_tasks' | 'weekly_count';
	progressCompleted: number;
	progressTarget: number;
	progressLabel: string;
	weeklyCompleted?: number;
	weeklyTarget?: number;
	currentStreak: number;
	longestStreak: number;
}

interface ScriptableTodaySummary {
	date: string;
	required: number;
	completed: number;
	incomplete: number;
	allDone: boolean;
	bestCurrentStreak: number;
	requiredRoutineIds: string[];
	completedRoutineIds: string[];
	incompleteRoutineIds: string[];
	routines: ScriptableTodayRoutineSummary[];
}

export default class RoutineStreaksPlugin extends Plugin {
	settings!: RoutineStreaksSettings;
	private recalculationTimer: number | null = null;
	private syncImportTimer: number | null = null;
	private dayBoundaryTimer: number | null = null;
	private markdownWidgetSources = new Map<HTMLElement, string>();

	async onload(): Promise<void> {
		await this.loadSettings();

		this.registerView(
			ROUTINE_STREAKS_WIDGET_VIEW_TYPE,
			(leaf) => new RoutineStreaksWidgetView(leaf, this),
		);

		this.addCommand({
			id: 'recalculate-streaks',
			name: 'Recalculate streaks',
			callback: () => {
				void this.recalculate({ showNotice: true });
			},
		});
		this.addCommand({
			id: 'open-streak-widget',
			name: 'Open streak widget',
			callback: () => {
				void this.openStreakWidget();
			},
		});
		this.addCommand({
			id: 'insert-routine-template',
			name: 'Insert routine template',
			editorCallback: (editor) => {
				this.openTemplateSuggester(editor);
			},
		});
		this.addRibbonIcon('flame', 'Open streak widget', () => {
			void this.openStreakWidget();
		});
		this.registerMarkdownCodeBlockProcessor(
			'routine-streaks-widget',
			(source, el) => {
				this.markdownWidgetSources.set(el, source);
				this.renderMarkdownWidget(el, source);
			},
		);

		this.addSettingTab(new RoutineStreaksSettingTab(this.app, this));
		this.registerDailyNoteWatchers();
		this.registerSyncSettingsWatchers();
		await this.recalculate();
	}

	onunload(): void {
		if (this.recalculationTimer !== null) {
			window.clearTimeout(this.recalculationTimer);
			this.recalculationTimer = null;
		}

		if (this.syncImportTimer !== null) {
			window.clearTimeout(this.syncImportTimer);
			this.syncImportTimer = null;
		}

		if (this.dayBoundaryTimer !== null) {
			window.clearTimeout(this.dayBoundaryTimer);
			this.dayBoundaryTimer = null;
		}
	}

	async loadSettings(): Promise<void> {
		this.settings = normalizeSettings(await this.loadData());
		await this.importSyncedSettings();
		await this.saveSettings();
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		if (this.settings.mainSyncDevice) {
			await this.exportSyncedSettings();
		}
		await this.exportScriptableData();
		this.refreshStreakWidgetViews();
		this.scheduleDayBoundaryRecalculation();
	}

	async exportSyncedSettings(): Promise<void> {
		const folderPath = SYNC_SETTINGS_PATH.split('/').slice(0, -1).join('/');
		const content = JSON.stringify(createSyncFile(this.settings), null, '\t');

		try {
			await this.ensureFolder(folderPath);

			const file = this.app.vault.getAbstractFileByPath(SYNC_SETTINGS_PATH);

			if (file instanceof TFile) {
				await this.app.vault.modify(file, content);
			} else if (file) {
				throw new Error(`${SYNC_SETTINGS_PATH} exists but is not a file.`);
			} else {
				await this.app.vault.create(SYNC_SETTINGS_PATH, content);
			}
		} catch (error) {
			console.error('Routine streaks sync export failed', error);
		}
	}

	async importSyncedSettings(
		options: { recalculate?: boolean } = {},
	): Promise<void> {
		if (this.settings.mainSyncDevice) {
			return;
		}

		const file = this.app.vault.getAbstractFileByPath(SYNC_SETTINGS_PATH);

		if (!(file instanceof TFile)) {
			return;
		}

		try {
			const content = await this.app.vault.cachedRead(file);
			const syncFile = JSON.parse(content) as unknown;
			this.settings = mergeSyncedSettings(this.settings, syncFile);
			await this.saveData(this.settings);
			this.refreshStreakWidgetViews();

			if (options.recalculate) {
				await this.recalculate();
			}
		} catch (error) {
			console.error('Routine streaks sync import failed', error);
		}
	}

	async exportScriptableData(options: ExportOptions = {}): Promise<void> {
		const exportPath = this.settings.scriptableExportPath;
		const folderPath = exportPath.split('/').slice(0, -1).join('/');
		const todaySummary = createScriptableTodaySummary(this.settings);
		const content = JSON.stringify(
			{
				exportedAt: new Date().toISOString(),
				routines: this.settings.routines,
				cache: this.settings.cache,
				todaySummary,
				bestCurrentStreak: todaySummary.bestCurrentStreak,
				overviewPet: this.settings.overviewPet,
				scriptableWidgetType: this.settings.scriptableWidgetType,
				scriptableRoutineId: this.settings.scriptableRoutineId,
				scriptableWidgetFamily: this.settings.scriptableWidgetFamily,
				scriptableTodayRoutineIds: this.settings.scriptableTodayRoutineIds,
				weekStartDay: this.settings.weekStartDay,
				dayStartHour: this.settings.dayStartHour,
			},
			null,
			'\t',
		);

		try {
			await this.ensureFolder(folderPath);

			const file = this.app.vault.getAbstractFileByPath(exportPath);

			if (file instanceof TFile) {
				await this.app.vault.modify(file, content);
			} else if (file) {
				throw new Error(`${exportPath} exists but is not a file.`);
			} else {
				await this.app.vault.create(exportPath, content);
			}

			if (options.showNotice) {
				new Notice(`Routine streaks: exported Scriptable data to ${exportPath}.`);
			}
		} catch (error) {
			console.error('Routine streaks Scriptable export failed', error);

			if (options.showNotice) {
				new Notice('Routine streaks: Scriptable export failed.');
			}
		}
	}

	async recalculate(
		options: RecalculateOptions = {},
	): Promise<RecalculationResult> {
		const result = await calculateRoutineCaches(this.app, this.settings);
		this.settings.cache = result.cache;
		await this.saveSettings();

		if (options.showNotice) {
			if (result.todayFileFound) {
				new Notice(
					`Routine streaks: scanned ${result.notesScanned} daily notes.`,
				);
			} else {
				new Notice(
					`Routine streaks: today's daily note was not found at ${result.todayPath}.`,
				);
			}
		}

		return result;
	}

	async openStreakWidget(): Promise<void> {
		let leaf = this.app.workspace.getLeavesOfType(
			ROUTINE_STREAKS_WIDGET_VIEW_TYPE,
		)[0];

		if (!leaf) {
			leaf = this.app.workspace.getRightLeaf(false) ?? undefined;
		}

		if (!leaf) {
			new Notice('Routine streaks: could not open the streak widget.');
			return;
		}

		await leaf.setViewState({
			type: ROUTINE_STREAKS_WIDGET_VIEW_TYPE,
			active: true,
		});
		this.app.workspace.setActiveLeaf(leaf);
	}

	openTemplateSuggester(editor: Editor): void {
		const routinesWithTemplates = this.settings.routines.filter(
			(routine) => routine.enabled && routine.templateItems.length > 0,
		);

		if (routinesWithTemplates.length === 0) {
			new Notice('Routine streaks: add template items in settings first.');
			return;
		}

		new RoutineTemplateSuggestModal(this, routinesWithTemplates, editor).open();
	}

	async insertRoutineTemplate(
		routine: RoutineConfig,
		editor: Editor,
	): Promise<void> {
		const template = formatRoutineTemplate(routine);

		if (template.length === 0) {
			new Notice('Routine streaks: this routine has no template items.');
			return;
		}

		editor.replaceSelection(`${template}\n`);
		new Notice(`Routine streaks: inserted ${routine.label}.`);
	}

	async setWidgetTaskSectionExpanded(
		routineId: string,
		expanded: boolean,
	): Promise<void> {
		const expandedIds = new Set(this.settings.expandedWidgetTaskRoutineIds);

		if (expanded) {
			expandedIds.add(routineId);
		} else {
			expandedIds.delete(routineId);
		}

		this.settings.expandedWidgetTaskRoutineIds = [...expandedIds].filter((id) =>
			this.settings.routines.some((routine) => routine.id === id),
		);
		await this.saveSettings();
	}

	async setTodayTaskCompleted(
		lineNumber: number,
		completed: boolean,
	): Promise<void> {
		const todayPath = getDailyNotePath(
			getEffectiveTodayDateKey(this.settings.dayStartHour),
			this.settings,
		);
		const file = this.app.vault.getAbstractFileByPath(todayPath);

		if (!(file instanceof TFile)) {
			new Notice(
				`Routine streaks: today's daily note was not found at ${todayPath}.`,
			);
			return;
		}

		const content = await this.app.vault.cachedRead(file);
		const lines = content.split('\n');
		const line = lines[lineNumber];

		if (!line) {
			new Notice('Routine streaks: task line was not found.');
			return;
		}

		const updatedLine = line.replace(
			/^(\s*[-*+]\s+\[)[ xX](\]\s+.*)$/,
			`$1${completed ? 'x' : ' '}$2`,
		);

		if (updatedLine === line) {
			new Notice('Routine streaks: task line could not be updated.');
			return;
		}

		lines[lineNumber] = updatedLine;
		await this.app.vault.modify(file, lines.join('\n'));
		await this.recalculate();
	}

	refreshStreakWidgetViews(): void {
		for (const leaf of this.app.workspace.getLeavesOfType(
			ROUTINE_STREAKS_WIDGET_VIEW_TYPE,
		)) {
			if (leaf.view instanceof RoutineStreaksWidgetView) {
				leaf.view.render();
			}
		}

		for (const [el, source] of this.markdownWidgetSources) {
			if (!el.isConnected) {
				this.markdownWidgetSources.delete(el);
				continue;
			}

			this.renderMarkdownWidget(el, source);
		}
	}

	private renderMarkdownWidget(el: HTMLElement, source: string): void {
		const widgetConfig = parseMarkdownWidgetSource(source, this.settings);
		const renderSettings = widgetConfig.widgetLayout
			? {
					...this.settings,
					widgetLayout: widgetConfig.widgetLayout,
				}
			: this.settings;
		const headingTitle = widgetConfig.headingTitle ?? '';
		const headingSubtitle = widgetConfig.headingSubtitle ?? '';

		el.empty();
		renderStreakWidget(el, renderSettings, {
			showHeading: headingTitle.length > 0 || headingSubtitle.length > 0,
			headingTitle,
			headingSubtitle,
		});
	}

	private async ensureFolder(folderPath: string): Promise<void> {
		if (folderPath.length === 0) {
			return;
		}

		const parts = folderPath.split('/').filter((part) => part.length > 0);
		let currentPath = '';

		for (const part of parts) {
			currentPath = currentPath.length > 0 ? `${currentPath}/${part}` : part;
			const existing = this.app.vault.getAbstractFileByPath(currentPath);

			if (!existing) {
				await this.app.vault.adapter.mkdir(currentPath);
				continue;
			}

			if (!(existing instanceof TFolder)) {
				throw new Error(`${currentPath} exists but is not a folder.`);
			}
		}
	}

	private registerDailyNoteWatchers(): void {
		this.registerEvent(
			this.app.vault.on('create', (file) =>
				this.queueRecalculationForFile(file),
			),
		);
		this.registerEvent(
			this.app.vault.on('modify', (file) =>
				this.queueRecalculationForFile(file),
			),
		);
		this.registerEvent(
			this.app.vault.on('rename', (file, oldPath) =>
				this.queueRecalculationForFile(file, oldPath),
			),
		);
		this.registerEvent(
			this.app.vault.on('delete', (file) =>
				this.queueRecalculationForFile(file),
			),
		);
	}

	private registerSyncSettingsWatchers(): void {
		this.registerEvent(
			this.app.vault.on('create', (file) =>
				this.queueSyncedSettingsImport(file),
			),
		);
		this.registerEvent(
			this.app.vault.on('modify', (file) =>
				this.queueSyncedSettingsImport(file),
			),
		);
		this.registerEvent(
			this.app.vault.on('rename', (file, oldPath) =>
				this.queueSyncedSettingsImport(file, oldPath),
			),
		);
	}

	private queueSyncedSettingsImport(
		file: TAbstractFile,
		oldPath?: string,
	): void {
		if (this.settings.mainSyncDevice) {
			return;
		}

		if (!(file instanceof TFile)) {
			return;
		}

		const touchesSyncFile =
			file.path === SYNC_SETTINGS_PATH || oldPath === SYNC_SETTINGS_PATH;

		if (!touchesSyncFile) {
			return;
		}

		if (this.syncImportTimer !== null) {
			window.clearTimeout(this.syncImportTimer);
		}

		this.syncImportTimer = window.setTimeout(() => {
			this.syncImportTimer = null;
			void this.importSyncedSettings({ recalculate: true });
		}, 750);
	}

	private queueRecalculationForFile(
		file: TAbstractFile,
		oldPath?: string,
	): void {
		if (!this.settings.autoRecalculate) {
			return;
		}

		if (!(file instanceof TFile)) {
			return;
		}

		const oldPathWasDailyNote = oldPath
			? parseDailyNoteDateFromPath(oldPath, this.settings) !== null
			: false;
		const fileIsMarkdown = file.extension === 'md';

		if (!fileIsMarkdown && !oldPathWasDailyNote) {
			return;
		}

		const touchesDailyNote =
			(fileIsMarkdown &&
				parseDailyNoteDateFromPath(file.path, this.settings) !== null) ||
			oldPathWasDailyNote;

		if (!touchesDailyNote) {
			return;
		}

		if (this.recalculationTimer !== null) {
			window.clearTimeout(this.recalculationTimer);
		}

		this.recalculationTimer = window.setTimeout(() => {
			this.recalculationTimer = null;
			void this.recalculate().catch((error) => {
				console.error('Routine streaks recalculation failed', error);
			});
		}, 750);
	}

	private scheduleDayBoundaryRecalculation(): void {
		if (this.dayBoundaryTimer !== null) {
			window.clearTimeout(this.dayBoundaryTimer);
		}

		this.dayBoundaryTimer = window.setTimeout(() => {
			this.dayBoundaryTimer = null;
			void this.recalculate().catch((error) => {
				console.error('Routine streaks day boundary recalculation failed', error);
				this.scheduleDayBoundaryRecalculation();
			});
		}, this.getDelayUntilNextDayStart());
	}

	private getDelayUntilNextDayStart(date = new Date()): number {
		const nextDayStart = new Date(date);
		nextDayStart.setHours(this.settings.dayStartHour, 0, 0, 0);

		if (nextDayStart <= date) {
			nextDayStart.setDate(nextDayStart.getDate() + 1);
		}

		return Math.max(1000, nextDayStart.getTime() - date.getTime());
	}
}

function createScriptableTodaySummary(
	settings: RoutineStreaksSettings,
): ScriptableTodaySummary {
	const todayDate = getEffectiveTodayDateKey(settings.dayStartHour);
	const enabledRoutines = settings.routines.filter((routine) => routine.enabled);
	const routineSummaries = enabledRoutines.map((routine) => {
		const cache = settings.cache[routine.id] ?? createRoutineCache();
		const taskCount = Math.max(0, cache?.todayTaskCount ?? 0);
		const completedTaskCount = Math.max(0, cache?.todayCompletedTaskCount ?? 0);
		const incompleteTaskCount = Math.max(
			0,
			cache?.todayIncompleteTaskCount ?? taskCount - completedTaskCount,
		);
		const progress = createRoutineProgressSummary(
			routine,
			cache,
			todayDate,
			settings.weekStartDay,
		);

		return {
			id: routine.id,
			scheduleType: routine.schedule.type,
			scheduleTypeLabel: formatRoutineScheduleType(routine),
			status: cache?.todayStatus ?? 'no_tasks',
			taskCount,
			completedTaskCount,
			incompleteTaskCount,
			progressKind: progress.kind,
			progressCompleted: progress.completed,
			progressTarget: progress.target,
			progressLabel: progress.label,
			...(progress.kind === 'weekly_count'
				? {
						weeklyCompleted: progress.completed,
						weeklyTarget: progress.target,
					}
				: {}),
			currentStreak: Math.max(0, cache?.currentStreak ?? 0),
			longestStreak: Math.max(0, cache?.longestStreak ?? 0),
		};
	});
	const requiredRoutineIds = routineSummaries
		.filter((summary) => isRequiredTodayStatus(summary.status))
		.map((summary) => summary.id);
	const completedRoutineIds = routineSummaries
		.filter((summary) => isRequiredTodayStatus(summary.status))
		.filter((summary) => summary.status === 'complete')
		.map((summary) => summary.id);
	const incompleteRoutineIds = routineSummaries
		.filter((summary) => isRequiredTodayStatus(summary.status))
		.filter((summary) => summary.status !== 'complete')
		.map((summary) => summary.id);
	const bestCurrentStreak = routineSummaries.reduce(
		(best, summary) => Math.max(best, summary.currentStreak),
		0,
	);

	return {
		date: todayDate,
		required: requiredRoutineIds.length,
		completed: completedRoutineIds.length,
		incomplete: incompleteRoutineIds.length,
		allDone:
			requiredRoutineIds.length === 0 ||
			completedRoutineIds.length === requiredRoutineIds.length,
		bestCurrentStreak,
		requiredRoutineIds,
		completedRoutineIds,
		incompleteRoutineIds,
		routines: routineSummaries,
	};
}

function isRequiredTodayStatus(status: RoutineCache['todayStatus']): boolean {
	return (
		status !== 'disabled' &&
		status !== 'off_schedule' &&
		status !== 'frozen'
	);
}

class RoutineTemplateSuggestModal extends SuggestModal<RoutineConfig> {
	private plugin: RoutineStreaksPlugin;
	private routines: RoutineConfig[];
	private editor: Editor;

	constructor(
		plugin: RoutineStreaksPlugin,
		routines: RoutineConfig[],
		editor: Editor,
	) {
		super(plugin.app);
		this.plugin = plugin;
		this.routines = routines;
		this.editor = editor;
		this.setPlaceholder('Choose a routine template');
	}

	getSuggestions(query: string): RoutineConfig[] {
		const normalizedQuery = query.toLowerCase();
		return this.routines.filter((routine) =>
			[routine.label, routine.id, routine.tag]
				.join(' ')
				.toLowerCase()
				.includes(normalizedQuery),
		);
	}

	renderSuggestion(routine: RoutineConfig, el: HTMLElement): void {
		el.createDiv({ text: routine.label || routine.id });
		el.createEl('small', {
			text: `${routine.tag} - ${routine.templateItems.length} items`,
		});
	}

	onChooseSuggestion(routine: RoutineConfig): void {
		void this.plugin.insertRoutineTemplate(routine, this.editor);
	}
}
