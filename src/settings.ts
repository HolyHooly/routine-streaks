import {
	AbstractInputSuggest,
	App,
	ButtonComponent,
	Modal,
	Notice,
	PluginSettingTab,
	Setting,
	TFolder,
} from 'obsidian';
import type RoutineStreaksPlugin from './main';
import {
	createDefaultSchedule,
	createNewRoutine,
	createRoutineCache,
	createRoutineFreezePeriod,
	createRoutinePausePeriod,
	createWidgetConfig,
	getAllowedScriptableWidgetFamilies,
	getDefaultScriptableWidgetFamily,
	getTodayDateKey,
	isValidDateKey,
	normalizeFolder,
	normalizeRoutineTag,
	normalizeScriptableExportPath,
	normalizeTemplateItem,
	SCRIPTABLE_WIDGET_FAMILIES,
	SCRIPTABLE_WIDGET_TYPES,
	STREAK_WIDGET_TYPES,
	SYNC_SETTINGS_PATH,
	WEEKDAY_OPTIONS,
} from './model';
import type {
	IntervalUnit,
	OverviewPet,
	RoutineCache,
	RoutineConfig,
	RoutineFreezePeriod,
	RoutinePauseEndMode,
	ScheduleType,
	ScriptableWidgetFamily,
	ScriptableWidgetType,
	StreakWidgetConfig,
	StreakWidgetType,
	WeekStartDay,
} from './model';
import {
	createScriptableWidgetCode,
	SCRIPTABLE_DATA_BOOKMARK_NAME,
} from './scriptable';
import { renderStreakWidget } from './widget';

const SCHEDULE_LABELS: Record<ScheduleType, string> = {
	weekdays: 'Selected weekdays',
	weekly_count: 'Weekly target',
	interval: 'Every n interval',
};

type FreezePeriodEditorMode =
	| 'freeze'
	| 'pause_date'
	| 'pause_completion'
	| 'pause_indefinite';

const TODAY_STATUS_LABELS: Record<RoutineCache['todayStatus'], string> = {
	disabled: 'Disabled',
	missing_daily_note: 'Daily Note missing',
	no_tasks: 'No tagged tasks today',
	off_schedule: 'Off schedule today',
	frozen: 'Frozen today',
	incomplete: 'Incomplete today',
	complete: 'Complete today',
};

export class RoutineStreaksSettingTab extends PluginSettingTab {
	plugin: RoutineStreaksPlugin;

	constructor(app: App, plugin: RoutineStreaksPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		this.render();
		void this.plugin
			.recalculate()
			.then(() => this.render())
			.catch((error) => {
				console.error('Routine streaks settings recalculation failed', error);
				new Notice('Routine streaks: recalculation failed.');
			});
	}

	private render(): void {
		const { containerEl } = this;
		containerEl.empty();
		containerEl.addClass('routine-streaks-settings');

		this.renderWidgetPreview(containerEl);
		this.renderScriptableSettings(containerEl);
		this.renderDailyNoteSettings(containerEl);
		this.renderRoutineSettings(containerEl);
	}

	private renderWidgetPreview(containerEl: HTMLElement): void {
		new Setting(containerEl)
			.setName('Streak widget')
			.setHeading()
			.addButton((button) =>
				button.setButtonText('Open widget').onClick(() => {
					void this.plugin.openStreakWidget();
				}),
			)
			.addButton((button) =>
				button.setButtonText('Edit layout').onClick(() => {
					new StreakWidgetEditorModal(this.app, this.plugin, () => {
						this.render();
					}).open();
				}),
			);

		new Setting(containerEl)
			.setName('Overview pet')
			.setDesc('Choose the pixel art pet shown in the overview.')
			.addDropdown((dropdown) => {
				dropdown.addOption('dog', 'Dog');
				dropdown.addOption('cat', 'Cat');
				dropdown.addOption('parrot', 'Parrot');
				dropdown.setValue(this.plugin.settings.overviewPet);
				dropdown.onChange(async (value) => {
					this.plugin.settings.overviewPet = value as OverviewPet;
					await this.plugin.saveSettings();
					this.render();
				});
			});

		renderStreakWidget(containerEl, this.plugin.settings, {
			showTasks: false,
		});
	}

	private renderScriptableSettings(containerEl: HTMLElement): void {
		const dataJsonPath = this.getScriptableDataJsonPath();

		new Setting(containerEl)
			.setName('Scriptable widget')
			.setHeading();

		containerEl.createDiv({
			cls: 'routine-streaks-subheading',
			text: `Main devices write ${SYNC_SETTINGS_PATH}. All devices can export scriptable data to ${dataJsonPath}.`,
		});

		new Setting(containerEl)
			.setName('Main sync device')
			.setDesc('Enable only on the device that should write sync.json.')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.mainSyncDevice)
					.onChange(async (value) => {
						this.plugin.settings.mainSyncDevice = value;
						await this.plugin.saveSettings();
						if (!value) {
							await this.plugin.importSyncedSettings({ recalculate: true });
						}
						this.render();
					}),
			);

		new Setting(containerEl)
			.setName('Scriptable display')
			.setDesc('Choose which widget type is rendered on the phone.')
			.addDropdown((dropdown) => {
				for (const widgetType of SCRIPTABLE_WIDGET_TYPES) {
					dropdown.addOption(widgetType.type, widgetType.label);
				}

				dropdown.setValue(this.plugin.settings.scriptableWidgetType);
				dropdown.onChange(async (value) => {
					const widgetType = SCRIPTABLE_WIDGET_TYPES.some(
						(candidate) => candidate.type === value,
					)
						? (value as ScriptableWidgetType)
						: 'dashboard';
					this.plugin.settings.scriptableWidgetType = widgetType;
					if (
						!getAllowedScriptableWidgetFamilies(widgetType).includes(
							this.plugin.settings.scriptableWidgetFamily,
						)
					) {
						this.plugin.settings.scriptableWidgetFamily =
							getDefaultScriptableWidgetFamily(widgetType);
					}

					if (
						widgetType === 'routine_focus' &&
						!this.plugin.settings.routines.some(
							(routine) =>
								routine.enabled &&
								routine.id === this.plugin.settings.scriptableRoutineId,
						)
					) {
						this.plugin.settings.scriptableRoutineId =
							this.getFallbackScriptableRoutineId();
					}

					await this.plugin.saveSettings();
					this.render();
				});
			});

		if (this.plugin.settings.scriptableWidgetType === 'routine_focus') {
			new Setting(containerEl)
				.setName('Scriptable focused routine')
				.setDesc('Used when display is focused routine.')
				.addDropdown((dropdown) => {
					const enabledRoutines = this.plugin.settings.routines.filter(
						(routine) => routine.enabled,
					);

					if (enabledRoutines.length === 0) {
						dropdown.addOption('', 'No enabled routines');
					}

					for (const routine of enabledRoutines) {
						dropdown.addOption(routine.id, routine.label || routine.id);
					}

					dropdown.setValue(
						enabledRoutines.some(
							(routine) =>
								routine.id === this.plugin.settings.scriptableRoutineId,
						)
							? this.plugin.settings.scriptableRoutineId
							: enabledRoutines[0]?.id ?? '',
					);
					dropdown.onChange(async (value) => {
						this.plugin.settings.scriptableRoutineId = value;
						await this.plugin.saveSettings();
					});
				});
		}

		new Setting(containerEl)
			.setName('Scriptable size')
			.setDesc('Generated code uses this size for preview and layout.')
			.addDropdown((dropdown) => {
				const allowedFamilies = getAllowedScriptableWidgetFamilies(
					this.plugin.settings.scriptableWidgetType,
				);

				for (const family of SCRIPTABLE_WIDGET_FAMILIES.filter((option) =>
					allowedFamilies.includes(option.family),
				)) {
					dropdown.addOption(family.family, family.label);
				}

				dropdown.setValue(this.plugin.settings.scriptableWidgetFamily);
				dropdown.onChange(async (value) => {
					const family = SCRIPTABLE_WIDGET_FAMILIES.some(
						(candidate) => candidate.family === value,
					)
						? (value as ScriptableWidgetFamily)
						: getDefaultScriptableWidgetFamily(
								this.plugin.settings.scriptableWidgetType,
							);
					this.plugin.settings.scriptableWidgetFamily =
						getAllowedScriptableWidgetFamilies(
							this.plugin.settings.scriptableWidgetType,
						).includes(family)
							? family
							: getDefaultScriptableWidgetFamily(
									this.plugin.settings.scriptableWidgetType,
								);
					await this.plugin.saveSettings();
					this.render();
				});
			});

		if (this.plugin.settings.scriptableWidgetType === 'today_items') {
			this.renderScriptableTodayItemSettings(containerEl);
		}

		new Setting(containerEl)
			.setName('Scriptable data file')
			.setDesc('Visible vault path exported for scriptable.')
			.addText((text) => {
				text.setValue(this.plugin.settings.scriptableExportPath);
				text.inputEl.addEventListener('blur', () => {
					void this.updateScriptableExportPath(text.inputEl.value, text.inputEl);
				});
			})
			.addButton((button) =>
				button.setButtonText('Export now').onClick(async () => {
					await this.plugin.exportScriptableData({ showNotice: true });
				}),
			);

		new Setting(containerEl)
			.setName('Generated code')
			.setDesc('Generate code after choosing the display and size options.')
			.addButton((button) =>
				button.setButtonText('Generate code').onClick(() => {
					void this.generateScriptableWidgetCode();
				}),
			)
			.addButton((button) =>
				button.setButtonText('View generated code').onClick(() => {
					new ScriptableCodeModal(
						this.app,
						this.createGeneratedScriptableWidgetCode(),
						SCRIPTABLE_DATA_BOOKMARK_NAME,
						dataJsonPath,
						this.getGeneratedScriptableWidgetFamily(),
					).open();
				}),
		);
	}

	private renderScriptableTodayItemSettings(containerEl: HTMLElement): void {
		const enabledRoutines = this.plugin.settings.routines.filter(
			(routine) => routine.enabled,
		);
		const slotCount = this.getScriptableTodayItemSlotCount();
		const selectedRoutineIds = this.getScriptableTodayRoutineIds(slotCount);

		for (let index = 0; index < slotCount; index += 1) {
			new Setting(containerEl)
				.setName(
					slotCount === 1
						? 'Today items routine'
						: `Today items routine ${index + 1}`,
				)
				.setDesc(
					slotCount === 1
						? 'Choose the routine shown in the small widget.'
						: 'Choose one routine card for the grid.',
				)
				.addDropdown((dropdown) => {
					if (enabledRoutines.length === 0) {
						dropdown.addOption('', 'No enabled routines');
					} else if (slotCount > enabledRoutines.length) {
						dropdown.addOption('', 'None');
					}

					for (const routine of enabledRoutines) {
						dropdown.addOption(routine.id, routine.label || routine.id);
					}

					dropdown.setValue(selectedRoutineIds[index] ?? '');
					dropdown.onChange(async (value) => {
						const nextRoutineIds = this.getScriptableTodayRoutineIds(slotCount);
						nextRoutineIds[index] = value;
						this.plugin.settings.scriptableTodayRoutineIds = nextRoutineIds
							.filter((id) =>
								enabledRoutines.some((routine) => routine.id === id),
							)
							.slice(0, 4);
						await this.plugin.saveSettings();
						this.render();
					});
				});
		}
	}

	private async generateScriptableWidgetCode(): Promise<void> {
		await this.plugin.exportScriptableData();
		const code = this.createGeneratedScriptableWidgetCode();

		try {
			if (!navigator.clipboard) {
				throw new Error('Clipboard API is unavailable.');
			}

			await navigator.clipboard.writeText(code);
			new Notice('Routine streaks: Scriptable code generated and copied.');
		} catch (error) {
			console.error('Routine streaks Scriptable code generation failed', error);
			new Notice('Routine streaks: clipboard failed, opening generated code.');
			new ScriptableCodeModal(
				this.app,
				code,
				SCRIPTABLE_DATA_BOOKMARK_NAME,
				this.getScriptableDataJsonPath(),
				this.getGeneratedScriptableWidgetFamily(),
			).open();
		}
	}

	private createGeneratedScriptableWidgetCode(): string {
		return createScriptableWidgetCode(this.getScriptableDataJsonPath(), {
			widgetType: this.plugin.settings.scriptableWidgetType,
			routineId:
				this.plugin.settings.scriptableWidgetType === 'routine_focus'
					? this.plugin.settings.scriptableRoutineId
					: '',
			widgetFamily: this.plugin.settings.scriptableWidgetFamily,
			todayRoutineIds:
				this.plugin.settings.scriptableWidgetType === 'today_items'
					? this.getScriptableTodayRoutineIds(
							this.getScriptableTodayItemSlotCount(),
						)
					: [],
		});
	}

	private getScriptableDataJsonPath(): string {
		return this.plugin.settings.scriptableExportPath;
	}

	private getGeneratedScriptableWidgetFamily(): ScriptableWidgetFamily {
		return this.plugin.settings.scriptableWidgetFamily;
	}

	private getScriptableTodayItemSlotCount(): number {
		return this.plugin.settings.scriptableWidgetFamily === 'small' ? 1 : 4;
	}

	private getScriptableTodayRoutineIds(slotCount: number): string[] {
		const enabledRoutines = this.plugin.settings.routines.filter(
			(routine) => routine.enabled,
		);
		const enabledRoutineIds = new Set(enabledRoutines.map((routine) => routine.id));
		const selectedRoutineIds = this.plugin.settings.scriptableTodayRoutineIds
			.filter((id) => enabledRoutineIds.has(id))
			.slice(0, slotCount);

		for (const routine of enabledRoutines) {
			if (selectedRoutineIds.length >= slotCount) {
				break;
			}

			if (!selectedRoutineIds.includes(routine.id)) {
				selectedRoutineIds.push(routine.id);
			}
		}

		while (selectedRoutineIds.length < slotCount) {
			selectedRoutineIds.push('');
		}

		return selectedRoutineIds;
	}

	private getFallbackScriptableRoutineId(excludedRoutineId = ''): string {
		const fallbackRoutine =
			this.plugin.settings.routines.find(
				(routine) => routine.id !== excludedRoutineId && routine.enabled,
			) ??
			this.plugin.settings.routines.find(
				(routine) => routine.id !== excludedRoutineId,
			);

		return fallbackRoutine?.id ?? '';
	}

	private async updateScriptableExportPath(
		value: string,
		inputEl: HTMLInputElement,
	): Promise<void> {
		const exportPath = normalizeScriptableExportPath(value);
		inputEl.value = exportPath;
		this.plugin.settings.scriptableExportPath = exportPath;
		await this.plugin.saveSettings();
	}

	private renderDailyNoteSettings(containerEl: HTMLElement): void {
		new Setting(containerEl).setName('Daily notes').setHeading();

		new Setting(containerEl)
			.setName('Daily note folder')
			.setDesc('Leave empty for the vault root.')
			.addText((text) => {
				new FolderSuggest(this.app, text.inputEl, (folderPath) => {
					text.setValue(folderPath);
					this.plugin.settings.dailyNoteFolder = folderPath;
					void this.plugin.recalculate().then(() => this.render());
				});
				text
					.setPlaceholder('Daily')
					.setValue(this.plugin.settings.dailyNoteFolder)
					.onChange((value) => {
						this.plugin.settings.dailyNoteFolder = normalizeFolder(value);
						void this.plugin.saveSettings();
					});
				text.inputEl.addEventListener('blur', () => {
					void this.plugin.recalculate().then(() => this.render());
				});
			});

		new Setting(containerEl)
			.setName('Daily note date format')
			.setDesc('Use yyyy-mm-dd style date tokens.')
			.addText((text) => {
				text
					.setValue(this.plugin.settings.dailyNoteDateFormat)
					.onChange((value) => {
						this.plugin.settings.dailyNoteDateFormat =
							value.trim() || 'YYYY-MM-DD';
						void this.plugin.saveSettings();
					});
				text.inputEl.addEventListener('blur', () => {
					void this.plugin.recalculate().then(() => this.render());
				});
			});

		new Setting(containerEl)
			.setName('Week starts on')
			.setDesc('Used for weekly target routines.')
			.addDropdown((dropdown) => {
				dropdown.addOption('1', 'Monday');
				dropdown.addOption('0', 'Sunday');
				dropdown.setValue(String(this.plugin.settings.weekStartDay));
				dropdown.onChange(async (value) => {
					const weekStartDay: WeekStartDay = value === '0' ? 0 : 1;
					this.plugin.settings.weekStartDay = weekStartDay;
					await this.plugin.recalculate();
					this.render();
				});
			});

		new Setting(containerEl)
			.setName('Auto recalculation')
			.setDesc('Recalculate streak cache when Markdown files change.')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.autoRecalculate)
					.onChange((value) => {
						this.plugin.settings.autoRecalculate = value;
						void this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Recalculate streaks')
			.setDesc('Scan daily notes and rebuild the derived cache.')
			.addButton((button) =>
				button
					.setButtonText('Recalculate')
					.setCta()
					.onClick(async () => {
						await this.plugin.recalculate({ showNotice: true });
						this.render();
					}),
			);
	}

	private renderRoutineSettings(containerEl: HTMLElement): void {
		new Setting(containerEl)
			.setName('Routines')
			.setHeading()
			.addButton((button) =>
				button.setButtonText('Expand all').onClick(async () => {
					this.plugin.settings.expandedRoutineIds =
						this.plugin.settings.routines.map((routine) => routine.id);
					await this.plugin.saveSettings();
					this.render();
				}),
			)
			.addButton((button) =>
				button.setButtonText('Collapse all').onClick(async () => {
					this.plugin.settings.expandedRoutineIds = [];
					await this.plugin.saveSettings();
					this.render();
				}),
			)
			.addButton((button) =>
				button
					.setButtonText('Add routine')
					.setCta()
					.onClick(async () => {
						this.plugin.settings.routines.push(
							createNewRoutine(this.plugin.settings.routines),
						);
						const newRoutine = this.plugin.settings.routines.at(-1);
						if (newRoutine) {
							this.plugin.settings.expandedRoutineIds = [
								...new Set([
									...this.plugin.settings.expandedRoutineIds,
									newRoutine.id,
								]),
							];
						}
						await this.plugin.recalculate();
						this.render();
					}),
			);

		if (this.plugin.settings.routines.length === 0) {
			containerEl.createDiv({
				cls: 'routine-streaks-empty',
				text: 'No routines yet.',
			});
			return;
		}

		for (const routine of this.plugin.settings.routines) {
			this.renderRoutineCard(containerEl, routine);
		}
	}

	private renderRoutineCard(
		containerEl: HTMLElement,
		routine: RoutineConfig,
	): void {
		const collapsed = !this.isRoutineExpanded(routine.id);
		const card = containerEl.createDiv({
			cls: collapsed
				? 'routine-streaks-card is-collapsed'
				: 'routine-streaks-card',
		});
		const header = card.createDiv({ cls: 'routine-streaks-card-header' });
		const title = header.createDiv();
		const cache = this.plugin.settings.cache[routine.id] ?? createRoutineCache();

		const titleTextEl = title.createDiv({
			cls: 'routine-streaks-card-title',
			text: routine.label || routine.id,
		});
		title.createDiv({
			cls: `routine-streaks-status routine-streaks-status-${cache.todayStatus}`,
			text: TODAY_STATUS_LABELS[cache.todayStatus],
		});

		const controls = header.createDiv({
			cls: 'routine-streaks-card-controls',
		});

		const collapseButton = controls.createEl('button', {
			cls: collapsed
				? 'routine-streaks-collapse-toggle'
				: 'routine-streaks-collapse-toggle is-expanded',
			attr: {
				'aria-label': collapsed ? 'Expand routine' : 'Collapse routine',
			},
		});
		collapseButton.type = 'button';
		collapseButton.addEventListener('click', () => {
			void this.setRoutineCollapsed(routine.id, !collapsed).then(() =>
				this.render(),
			);
		});

		new ButtonComponent(controls)
			.setButtonText('Delete')
			.setWarning()
			.onClick(() => {
				new ConfirmRoutineDeleteModal(this.app, routine, async () => {
					this.plugin.settings.routines = this.plugin.settings.routines.filter(
						(candidate) => candidate.id !== routine.id,
					);
					this.plugin.settings.expandedRoutineIds =
						this.plugin.settings.expandedRoutineIds.filter(
							(id) => id !== routine.id,
						);
					this.plugin.settings.expandedWidgetTaskRoutineIds =
						this.plugin.settings.expandedWidgetTaskRoutineIds.filter(
							(id) => id !== routine.id,
						);
					for (const widget of this.plugin.settings.widgetLayout) {
						if (widget.routineId === routine.id) {
							widget.routineId = '';
						}
					}
					if (this.plugin.settings.scriptableRoutineId === routine.id) {
						this.plugin.settings.scriptableRoutineId =
							this.getFallbackScriptableRoutineId();
					}
					this.plugin.settings.scriptableTodayRoutineIds =
						this.plugin.settings.scriptableTodayRoutineIds.filter(
							(id) => id !== routine.id,
						);
					delete this.plugin.settings.cache[routine.id];
					await this.plugin.recalculate();
					this.render();
				}).open();
			});

		card.createDiv({
			cls: 'routine-streaks-cache-summary',
			text: formatCacheSummary(cache),
		});

		if (collapsed) {
			return;
		}

		new Setting(card)
			.setName('Enabled')
			.setDesc('Disabled routines keep their settings but are ignored in today status.')
			.addToggle((toggle) =>
				toggle.setValue(routine.enabled).onChange(async (value) => {
					routine.enabled = value;
					if (!value && this.plugin.settings.scriptableRoutineId === routine.id) {
						this.plugin.settings.scriptableRoutineId =
							this.getFallbackScriptableRoutineId(routine.id);
					}
					if (!value) {
						this.plugin.settings.scriptableTodayRoutineIds =
							this.plugin.settings.scriptableTodayRoutineIds.filter(
								(id) => id !== routine.id,
							);
					}
					await this.plugin.recalculate();
					this.render();
				}),
			);

		this.renderRoutineTextFields(card, routine, titleTextEl);
		this.renderRoutineTemplateSettings(card, routine);
		this.renderScheduleSettings(card, routine);
		this.renderFreezeSettings(card, routine);
	}

	private isRoutineExpanded(routineId: string): boolean {
		return this.plugin.settings.expandedRoutineIds.includes(routineId);
	}

	private async setRoutineCollapsed(
		routineId: string,
		collapsed: boolean,
	): Promise<void> {
		const expandedIds = new Set(this.plugin.settings.expandedRoutineIds);

		if (collapsed) {
			expandedIds.delete(routineId);
		} else {
			expandedIds.add(routineId);
		}

		this.plugin.settings.expandedRoutineIds = [...expandedIds].filter((id) =>
			this.plugin.settings.routines.some((routine) => routine.id === id),
		);
		await this.plugin.saveSettings();
	}

	private renderRoutineTextFields(
		card: HTMLElement,
		routine: RoutineConfig,
		titleEl: HTMLElement,
	): void {
		new Setting(card)
			.setName('ID')
			.setDesc('Stable internal identifier. Create a new routine if you need a different ID.')
			.addText((text) => text.setValue(routine.id).setDisabled(true));

		new Setting(card).setName('Label').addText((text) =>
			text.setValue(routine.label).onChange((value) => {
				routine.label = value.trim() || routine.id;
				titleEl.setText(routine.label || routine.id);
				void this.plugin.saveSettings();
			}),
		);

		const tagWarning = card.createDiv({ cls: 'routine-streaks-warning' });

		new Setting(card)
			.setName('Tag')
			.setDesc('Tasks with this tag are grouped into this routine.')
			.addText((text) =>
				text.setValue(routine.tag).onChange((value) => {
					void this.updateRoutineTag(routine, value, tagWarning);
				}),
			);
	}

	private renderRoutineTemplateSettings(
		card: HTMLElement,
		routine: RoutineConfig,
	): void {
		new Setting(card)
			.setName('Template items')
			.setDesc('Enter only the item name. The checkbox and tag are added automatically.');

		const editorEl = card.createDiv({
			cls: 'routine-streaks-template-editor',
		});
		const prefixLinesEl = editorEl.createDiv({
			cls: 'routine-streaks-template-prefix-lines',
		});
		const textareaEl = editorEl.createEl('textarea', {
			cls: 'routine-streaks-template-textarea',
		});
		textareaEl.rows = Math.max(2, routine.templateItems.length);
		textareaEl.placeholder = 'Item name';
		textareaEl.value = routine.templateItems.join('\n');

		const renderPrefixLines = (): void => {
			const lineCount = Math.max(2, textareaEl.value.split('\n').length);
			prefixLinesEl.empty();

			for (let index = 0; index < lineCount; index += 1) {
				prefixLinesEl.createDiv({
					cls: 'routine-streaks-template-prefix-line',
					text: `- [ ] ${routine.tag}`,
				});
			}
		};

		textareaEl.addEventListener('input', renderPrefixLines);
		textareaEl.addEventListener('blur', () => {
			routine.templateItems = routine.templateItems.filter(
				(templateItem) => templateItem.length > 0,
			);
			routine.templateItems = textareaEl.value
				.split('\n')
				.map(normalizeTemplateItem)
				.filter((item) => item.length > 0);

			textareaEl.value = routine.templateItems.join('\n');
			renderPrefixLines();
			void this.plugin.saveSettings();
		});
		renderPrefixLines();
	}

	private renderScheduleSettings(
		card: HTMLElement,
		routine: RoutineConfig,
	): void {
		new Setting(card)
			.setName('Schedule type')
			.addDropdown((dropdown) => {
				dropdown.addOption('weekdays', SCHEDULE_LABELS.weekdays);
				dropdown.addOption('weekly_count', SCHEDULE_LABELS.weekly_count);
				dropdown.addOption('interval', SCHEDULE_LABELS.interval);
				dropdown.setValue(routine.schedule.type);
				dropdown.onChange(async (value) => {
					const scheduleType = value as ScheduleType;
					routine.schedule = createDefaultSchedule(
						scheduleType,
						getTodayDateKey(),
					);
					await this.plugin.recalculate();
					this.render();
				});
			});

		if (routine.schedule.type === 'weekdays') {
			this.renderWeekdaySettings(card, routine);
		} else if (routine.schedule.type === 'weekly_count') {
			this.renderWeeklyTargetSetting(card, routine);
		} else {
			this.renderIntervalSettings(card, routine);
		}
	}

	private renderWeekdaySettings(
		card: HTMLElement,
		routine: RoutineConfig,
	): void {
		if (routine.schedule.type !== 'weekdays') {
			return;
		}

		const schedule = routine.schedule;
		const weekdaySetting = new Setting(card)
			.setName('Active weekdays')
			.setDesc('Choose the days that count for this routine.');
		weekdaySetting.settingEl.addClass('routine-streaks-inline-button-setting');
		const weekdaysEl = weekdaySetting.controlEl.createDiv({
			cls: 'routine-streaks-inline-buttons',
		});

		for (const weekday of WEEKDAY_OPTIONS) {
			const selected = schedule.weekdays.includes(weekday.value);
			const buttonEl = weekdaysEl.createEl('button', {
				cls: selected
					? 'routine-streaks-round-button is-selected'
					: 'routine-streaks-round-button',
				text: weekday.label,
			});
			buttonEl.type = 'button';
			buttonEl.ariaPressed = selected ? 'true' : 'false';
			buttonEl.addEventListener('click', () => {
				void this.toggleWeekday(routine, weekday.value);
			});
		}
	}

	private async toggleWeekday(
		routine: RoutineConfig,
		weekday: number,
	): Promise<void> {
		if (routine.schedule.type !== 'weekdays') {
			return;
		}

		const weekdays = new Set(routine.schedule.weekdays);

		if (weekdays.has(weekday)) {
			weekdays.delete(weekday);
		} else {
			weekdays.add(weekday);
		}

		if (weekdays.size === 0) {
			new Notice('Routine streaks: select at least one weekday.');
			return;
		}

		routine.schedule.weekdays = [...weekdays].sort(
			(left, right) => left - right,
		);
		await this.plugin.recalculate();
		this.render();
	}

	private renderWeeklyTargetSetting(
		card: HTMLElement,
		routine: RoutineConfig,
	): void {
		if (routine.schedule.type !== 'weekly_count') {
			return;
		}

		const schedule = routine.schedule;
		const targetSetting = new Setting(card)
			.setName('Weekly target')
			.setDesc('Each completed day adds one streak; missed past weeks reset it.');
		targetSetting.settingEl.addClass('routine-streaks-inline-button-setting');
		const targetButtonsEl = targetSetting.controlEl.createDiv({
			cls: 'routine-streaks-inline-buttons',
		});

		for (let target = 1; target <= 7; target += 1) {
			const selected = schedule.weeklyTarget === target;
			const buttonEl = targetButtonsEl.createEl('button', {
				cls: selected
					? 'routine-streaks-round-button is-selected'
					: 'routine-streaks-round-button',
				text: String(target),
			});
			buttonEl.type = 'button';
			buttonEl.ariaPressed = selected ? 'true' : 'false';
			buttonEl.addEventListener('click', () => {
				void this.setWeeklyTarget(routine, target);
			});
		}
	}

	private async setWeeklyTarget(
		routine: RoutineConfig,
		target: number,
	): Promise<void> {
		if (routine.schedule.type !== 'weekly_count') {
			return;
		}

		routine.schedule.weeklyTarget = target;
		await this.plugin.recalculate();
		this.render();
	}

	private renderIntervalSettings(
		card: HTMLElement,
		routine: RoutineConfig,
	): void {
		if (routine.schedule.type !== 'interval') {
			return;
		}

		const schedule = routine.schedule;
		new Setting(card)
			.setName('Every n interval')
			.setDesc('Choose the interval amount and unit.')
			.addText((text) => {
				text.inputEl.type = 'number';
				text.inputEl.min = '1';
				text.setValue(String(schedule.intervalAmount)).onChange((value) => {
					void this.updateIntervalAmount(routine, value);
				});
			})
			.addDropdown((dropdown) => {
				dropdown.addOption('day', 'Day');
				dropdown.addOption('week', 'Week');
				dropdown.setValue(schedule.intervalUnit);
				dropdown.onChange((value) => {
					void this.updateIntervalUnit(routine, value as IntervalUnit);
				});
			});

		new Setting(card)
			.setName('Interval start date')
			.setDesc('Use yyyy-mm-dd.')
			.addText((text) =>
				text.setValue(schedule.startDate).onChange(async (value) => {
					if (!isValidDateKey(value)) {
						new Notice('Routine streaks: start date must be yyyy-mm-dd.');
						return;
					}

					if (routine.schedule.type !== 'interval') {
						return;
					}

					routine.schedule.startDate = value;
					await this.plugin.recalculate();
				}),
			);
	}

	private async updateIntervalAmount(
		routine: RoutineConfig,
		value: string,
	): Promise<void> {
		const intervalAmount = Number(value);

		if (!Number.isInteger(intervalAmount) || intervalAmount < 1) {
			new Notice('Routine streaks: interval must be at least 1.');
			return;
		}

		if (routine.schedule.type !== 'interval') {
			return;
		}

		routine.schedule.intervalAmount = intervalAmount;
		await this.plugin.recalculate();
	}

	private async updateIntervalUnit(
		routine: RoutineConfig,
		intervalUnit: IntervalUnit,
	): Promise<void> {
		if (routine.schedule.type !== 'interval') {
			return;
		}

		routine.schedule.intervalUnit = intervalUnit;
		await this.plugin.recalculate();
		this.render();
	}

	private renderFreezeSettings(
		card: HTMLElement,
		routine: RoutineConfig,
	): void {
		const today = getTodayDateKey();
		const activePause = this.getActivePausePeriod(routine, today);
		const todayProtected = this.isDateProtected(routine, today);
		const quickActions = new Setting(card)
			.setName('Streak protection')
			.setDesc(
				activePause
					? this.formatPauseStatus(activePause.period)
					: 'Freeze today or pause this routine without entering date ranges.',
			)
			.addButton((button) =>
				button
					.setButtonText(todayProtected ? 'Today protected' : 'Freeze today')
					.setDisabled(todayProtected)
					.onClick(async () => {
						await this.freezeToday(routine);
					}),
			);

		if (activePause) {
			quickActions.addButton((button) =>
				button
					.setButtonText('Resume')
					.setCta()
					.onClick(async () => {
						await this.resumePause(routine, activePause.index, today);
					}),
			);
		} else {
			quickActions.addButton((button) =>
				button.setButtonText('Pause...').onClick(() => {
					new PauseRoutineModal(this.app, routine, async (pauseEnd, endDate) => {
						await this.pauseRoutine(routine, pauseEnd, endDate);
					}).open();
				}),
			);
		}

		new Setting(card)
			.setName('Advanced freezes')
			.setDesc('Edit protected dates and pauses directly.')
			.addButton((button) =>
				button.setButtonText('Add freeze').onClick(async () => {
					routine.freezePeriods.push(createRoutineFreezePeriod());
					await this.plugin.recalculate();
					this.render();
				}),
			);

		if (routine.freezePeriods.length === 0) {
			card.createDiv({
				cls: 'routine-streaks-empty',
				text: 'No freezes configured.',
			});
			return;
		}

		for (const [index, period] of routine.freezePeriods.entries()) {
			const periodEl = card.createDiv({
				cls: 'routine-streaks-freeze-period',
			});
			const warningEl = periodEl.createDiv({
				cls: 'routine-streaks-warning',
			});
			let startInputEl: HTMLInputElement | null = null;
			let endInputEl: HTMLInputElement | null = null;
			const savePeriod = (): void => {
				if (!startInputEl) {
					return;
				}

				void this.updateFreezePeriod(
					routine,
					index,
					startInputEl.value,
					endInputEl?.value ?? period.endDate,
					warningEl,
				);
			};

			const periodSetting = new Setting(periodEl)
				.setName(`${period.kind === 'pause' ? 'Pause' : 'Freeze'} ${index + 1}`)
				.setDesc(this.formatFreezePeriodDescription(period))
				.addDropdown((dropdown) => {
					dropdown.addOption('freeze', 'Freeze dates');
					dropdown.addOption('pause_date', 'Pause until date');
					dropdown.addOption('pause_completion', 'Pause until completed');
					dropdown.addOption('pause_indefinite', 'Pause until resumed');
					dropdown.setValue(this.getFreezePeriodEditorMode(period));
					dropdown.onChange(async (value) => {
						await this.updateFreezePeriodMode(
							routine,
							index,
							value as FreezePeriodEditorMode,
						);
					});
				})
				.addText((text) => {
					startInputEl = text.inputEl;
					text
						.setPlaceholder('Start date')
						.setValue(period.startDate)
						.onChange(() => warningEl.setText(''));
					text.inputEl.addEventListener('blur', savePeriod);
				});

			if (period.pauseEnd === 'date') {
				periodSetting.addText((text) => {
					endInputEl = text.inputEl;
					text
						.setPlaceholder('End date')
						.setValue(period.endDate)
						.onChange(() => warningEl.setText(''));
					text.inputEl.addEventListener('blur', savePeriod);
				});
			}

			periodSetting.addButton((button) =>
				button
					.setButtonText('Delete')
					.setWarning()
					.onClick(async () => {
						routine.freezePeriods.splice(index, 1);
						await this.plugin.recalculate();
						this.render();
					}),
			);
		}
	}

	private async freezeToday(routine: RoutineConfig): Promise<void> {
		const today = getTodayDateKey();

		if (this.isDateProtected(routine, today)) {
			return;
		}

		routine.freezePeriods.push(createRoutineFreezePeriod(today));
		await this.plugin.recalculate();
		this.render();
	}

	private async pauseRoutine(
		routine: RoutineConfig,
		pauseEnd: RoutinePauseEndMode,
		endDate: string,
	): Promise<void> {
		routine.freezePeriods.push(
			createRoutinePausePeriod(pauseEnd, getTodayDateKey(), endDate),
		);
		await this.plugin.recalculate();
		this.render();
	}

	private async resumePause(
		routine: RoutineConfig,
		index: number,
		today: string,
	): Promise<void> {
		const period = routine.freezePeriods[index];

		if (!period) {
			return;
		}

		const yesterday = addDaysToDateKey(today, -1);

		if (yesterday < period.startDate) {
			routine.freezePeriods.splice(index, 1);
		} else {
			period.kind = 'pause';
			period.pauseEnd = 'date';
			period.endDate = yesterday;
		}

		await this.plugin.recalculate();
		this.render();
	}

	private async updateFreezePeriod(
		routine: RoutineConfig,
		index: number,
		startDateValue: string,
		endDateValue: string,
		warningEl: HTMLElement,
	): Promise<void> {
		const startDate = startDateValue.trim();
		const endDate = endDateValue.trim() || startDate;

		if (!isValidDateKey(startDate)) {
			warningEl.setText('Start date must be yyyy-mm-dd.');
			return;
		}

		const period = routine.freezePeriods[index];

		if (!period) {
			return;
		}

		if (period.kind === 'pause' && period.pauseEnd !== 'date') {
			period.startDate = startDate;
			period.endDate = '';
			await this.plugin.recalculate();
			this.render();
			return;
		}

		if (!isValidDateKey(endDate)) {
			warningEl.setText('End date must be yyyy-mm-dd.');
			return;
		}

		period.startDate = startDate <= endDate ? startDate : endDate;
		period.endDate = startDate <= endDate ? endDate : startDate;
		await this.plugin.recalculate();
		this.render();
	}

	private async updateFreezePeriodMode(
		routine: RoutineConfig,
		index: number,
		mode: FreezePeriodEditorMode,
	): Promise<void> {
		const period = routine.freezePeriods[index];

		if (!period) {
			return;
		}

		if (mode === 'freeze') {
			period.kind = 'freeze';
			period.pauseEnd = 'date';
			period.endDate = isValidDateKey(period.endDate)
				? period.endDate
				: period.startDate;
		} else {
			period.kind = 'pause';
			period.pauseEnd =
				mode === 'pause_completion'
					? 'completion'
					: mode === 'pause_indefinite'
						? 'indefinite'
						: 'date';
			period.endDate =
				period.pauseEnd === 'date'
					? isValidDateKey(period.endDate)
						? period.endDate
						: period.startDate
					: '';
		}

		await this.plugin.recalculate();
		this.render();
	}

	private getActivePausePeriod(
		routine: RoutineConfig,
		today: string,
	): { index: number; period: RoutineFreezePeriod } | null {
		for (const [index, period] of routine.freezePeriods.entries()) {
			if (period.kind !== 'pause') {
				continue;
			}

			if (this.isPauseActive(routine, period, today)) {
				return { index, period };
			}
		}

		return null;
	}

	private isPauseActive(
		routine: RoutineConfig,
		period: RoutineFreezePeriod,
		today: string,
	): boolean {
		if (today < period.startDate) {
			return false;
		}

		if (period.pauseEnd === 'date') {
			return today <= period.endDate;
		}

		if (period.pauseEnd === 'indefinite') {
			return true;
		}

		const completionDate = this.getFirstCompletionOnOrAfter(
			routine,
			period.startDate,
		);

		return !completionDate || today < completionDate;
	}

	private isDateProtected(routine: RoutineConfig, dateKey: string): boolean {
		return routine.freezePeriods.some((period) =>
			this.isDateInFreezePeriod(routine, period, dateKey),
		);
	}

	private isDateInFreezePeriod(
		routine: RoutineConfig,
		period: RoutineFreezePeriod,
		dateKey: string,
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

		const completionDate = this.getFirstCompletionOnOrAfter(
			routine,
			period.startDate,
		);

		return !completionDate || dateKey < completionDate;
	}

	private getFirstCompletionOnOrAfter(
		routine: RoutineConfig,
		dateKey: string,
	): string | null {
		const cache = this.plugin.settings.cache[routine.id] ?? createRoutineCache();
		return (
			cache.completedDates
				.filter((completedDate) => completedDate >= dateKey)
				.sort()[0] ?? null
		);
	}

	private getFreezePeriodEditorMode(
		period: RoutineFreezePeriod,
	): FreezePeriodEditorMode {
		if (period.kind !== 'pause') {
			return 'freeze';
		}

		if (period.pauseEnd === 'completion') {
			return 'pause_completion';
		}

		if (period.pauseEnd === 'indefinite') {
			return 'pause_indefinite';
		}

		return 'pause_date';
	}

	private formatFreezePeriodDescription(period: RoutineFreezePeriod): string {
		if (period.kind !== 'pause') {
			return 'Use yyyy-mm-dd dates.';
		}

		if (period.pauseEnd === 'completion') {
			return 'Protects the streak until this routine is completed again.';
		}

		if (period.pauseEnd === 'indefinite') {
			return 'Protects the streak until you resume the routine.';
		}

		return 'Protects the streak through the selected end date.';
	}

	private formatPauseStatus(period: RoutineFreezePeriod): string {
		if (period.pauseEnd === 'completion') {
			return `Paused since ${period.startDate}; resumes when this routine is completed.`;
		}

		if (period.pauseEnd === 'indefinite') {
			return `Paused since ${period.startDate}; resume when you are ready.`;
		}

		return `Paused from ${period.startDate} through ${period.endDate}.`;
	}

	private async updateRoutineTag(
		routine: RoutineConfig,
		value: string,
		warningEl: HTMLElement,
	): Promise<void> {
		const tag = normalizeRoutineTag(value, routine.id);
		warningEl.setText('');

		if (tag === '#') {
			warningEl.setText('Tag cannot be empty.');
			return;
		}

		routine.tag = tag;
		await this.plugin.recalculate();
	}
}

class PauseRoutineModal extends Modal {
	private routine: RoutineConfig;
	private onConfirm: (
		pauseEnd: RoutinePauseEndMode,
		endDate: string,
	) => Promise<void>;
	private pauseEnd: RoutinePauseEndMode = 'completion';
	private endDate = getTodayDateKey();
	private warningEl: HTMLElement | null = null;

	constructor(
		app: App,
		routine: RoutineConfig,
		onConfirm: (
			pauseEnd: RoutinePauseEndMode,
			endDate: string,
		) => Promise<void>,
	) {
		super(app);
		this.routine = routine;
		this.onConfirm = onConfirm;
	}

	onOpen(): void {
		this.render();
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h2', { text: `Pause ${this.routine.label}` });
		contentEl.createEl('p', {
			text: 'Paused days protect the current streak without requiring date-range editing.',
		});

		new Setting(contentEl)
			.setName('Pause ends')
			.addDropdown((dropdown) => {
				dropdown.addOption('completion', 'When completed again');
				dropdown.addOption('indefinite', 'When resumed');
				dropdown.addOption('date', 'On a date');
				dropdown.setValue(this.pauseEnd);
				dropdown.onChange((value) => {
					this.pauseEnd = value as RoutinePauseEndMode;
					this.render();
				});
			});

		if (this.pauseEnd === 'date') {
			new Setting(contentEl)
				.setName('End date')
				.setDesc('Use yyyy-mm-dd.')
				.addText((text) => {
					text
						.setPlaceholder(getTodayDateKey())
						.setValue(this.endDate)
						.onChange((value) => {
							this.endDate = value.trim();
							this.warningEl?.setText('');
						});
				});
		}

		this.warningEl = contentEl.createDiv({
			cls: 'routine-streaks-warning',
		});

		const buttonsEl = contentEl.createDiv({
			cls: 'routine-streaks-modal-buttons',
		});

		new ButtonComponent(buttonsEl)
			.setButtonText('Cancel')
			.onClick(() => this.close());

		new ButtonComponent(buttonsEl)
			.setButtonText('Pause')
			.setCta()
			.onClick(async () => {
				await this.confirm();
			});
	}

	private async confirm(): Promise<void> {
		const today = getTodayDateKey();

		if (this.pauseEnd === 'date') {
			if (!isValidDateKey(this.endDate)) {
				this.warningEl?.setText('End date must be yyyy-mm-dd.');
				return;
			}

			if (this.endDate < today) {
				this.warningEl?.setText('End date cannot be before today.');
				return;
			}
		}

		await this.onConfirm(this.pauseEnd, this.endDate);
		this.close();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

class StreakWidgetEditorModal extends Modal {
	private plugin: RoutineStreaksPlugin;
	private onSave: () => void;
	private draftLayout: StreakWidgetConfig[];
	private previewEl: HTMLElement | null = null;

	constructor(
		app: App,
		plugin: RoutineStreaksPlugin,
		onSave: () => void,
	) {
		super(app);
		this.plugin = plugin;
		this.onSave = onSave;
		this.draftLayout = plugin.settings.widgetLayout.map((widget) => ({
			...widget,
		}));
	}

	onOpen(): void {
		this.modalEl.addClass('routine-streaks-widget-editor-modal-shell');
		this.render();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private render(): void {
		const { contentEl } = this;
		this.previewEl = null;
		contentEl.empty();
		contentEl.addClass('routine-streaks-widget-editor-modal');
		contentEl.createEl('h2', { text: 'Edit widget layout' });

		const shell = contentEl.createDiv({
			cls: 'routine-streaks-widget-editor-shell',
		});
		this.renderPalette(shell);
		this.renderCanvas(shell);

		const buttonsEl = contentEl.createDiv({
			cls: 'routine-streaks-modal-buttons',
		});
		new ButtonComponent(buttonsEl)
			.setButtonText('Cancel')
			.onClick(() => this.close());
		new ButtonComponent(buttonsEl)
			.setButtonText('Save')
			.setCta()
			.onClick(() => {
				void this.save();
			});
	}

	private renderPalette(shell: HTMLElement): void {
		const paletteEl = shell.createDiv({
			cls: 'routine-streaks-widget-editor-palette',
		});
		paletteEl.createDiv({
			cls: 'routine-streaks-widget-editor-label',
			text: 'Widget examples',
		});

		for (const widgetType of STREAK_WIDGET_TYPES) {
			const itemEl = paletteEl.createDiv({
				cls: 'routine-streaks-widget-editor-palette-item',
				attr: {
					title: widgetType.description,
				},
			});
			itemEl.draggable = true;
			itemEl.addEventListener('dragstart', (event) => {
				event.dataTransfer?.setData('widget-type', widgetType.type);
			});
			itemEl.createDiv({
				cls: 'routine-streaks-widget-editor-palette-title',
				text: widgetType.label,
			});
			itemEl.createDiv({
				cls: 'routine-streaks-widget-editor-palette-desc',
				text: widgetType.description,
			});
			new ButtonComponent(itemEl).setButtonText('Add').onClick(() => {
				this.addWidget(widgetType.type);
			});
		}
	}

	private renderCanvas(shell: HTMLElement): void {
		const canvasEl = shell.createDiv({
			cls: 'routine-streaks-widget-editor-canvas',
		});
		canvasEl.createDiv({
			cls: 'routine-streaks-widget-editor-label',
			text: 'Widget layout',
		});
		const dropZone = canvasEl.createDiv({
			cls: 'routine-streaks-widget-editor-dropzone',
		});
		dropZone.addEventListener('dragover', (event) => event.preventDefault());
		dropZone.addEventListener('drop', (event) => {
			event.preventDefault();
			this.handleDrop(event);
		});

		if (this.draftLayout.length === 0) {
			dropZone.createDiv({
				cls: 'routine-streaks-widget-editor-empty',
				text: 'Drag widgets here.',
			});
		}

		for (const widget of this.draftLayout) {
			this.renderLayoutItem(dropZone, widget);
		}

		canvasEl.createDiv({
			cls: 'routine-streaks-widget-editor-label',
			text: 'Preview',
		});
		this.previewEl = canvasEl.createDiv({
			cls: 'routine-streaks-widget-editor-preview',
		});
		this.renderPreview();
	}

	private renderPreview(): void {
		if (!this.previewEl) {
			return;
		}

		this.previewEl.empty();
		renderStreakWidget(
			this.previewEl,
			{
				...this.plugin.settings,
				widgetLayout: this.draftLayout,
			},
			{
				showTasks: false,
			},
		);
	}

	private renderLayoutItem(parentEl: HTMLElement, widget: StreakWidgetConfig): void {
		const itemEl = parentEl.createDiv({
			cls: 'routine-streaks-widget-editor-layout-item',
		});
		itemEl.draggable = true;
		itemEl.addEventListener('dragstart', (event) => {
			event.dataTransfer?.setData('widget-id', widget.id);
		});
		itemEl.addEventListener('dragover', (event) => event.preventDefault());
		itemEl.addEventListener('drop', (event) => {
			event.preventDefault();
			event.stopPropagation();
			this.handleDrop(event, widget.id);
		});

		const headerEl = itemEl.createDiv({
			cls: 'routine-streaks-widget-editor-layout-header',
		});
		headerEl.createDiv({
			cls: 'routine-streaks-widget-editor-layout-type',
			text: getWidgetTypeLabel(widget.type),
		});

		const controlsEl = headerEl.createDiv({
			cls: 'routine-streaks-widget-editor-layout-controls',
		});
		new ButtonComponent(controlsEl).setButtonText('Up').onClick(() => {
			this.moveWidget(widget.id, -1);
		});
		new ButtonComponent(controlsEl).setButtonText('Down').onClick(() => {
			this.moveWidget(widget.id, 1);
		});
		new ButtonComponent(controlsEl)
			.setButtonText('Remove')
			.setWarning()
			.onClick(() => {
				this.draftLayout = this.draftLayout.filter(
					(candidate) => candidate.id !== widget.id,
				);
				this.render();
			});

		new Setting(itemEl)
			.setName('Title')
			.addText((text) =>
				text.setValue(widget.title).onChange((value) => {
					widget.title = value.trim();
					this.renderPreview();
				}),
			);

		if (widget.type === 'routine_focus') {
			new Setting(itemEl)
				.setName('Routine')
				.addDropdown((dropdown) => {
					const enabledRoutines = this.plugin.settings.routines.filter(
						(routine) => routine.enabled,
					);

					for (const routine of enabledRoutines) {
						dropdown.addOption(routine.id, routine.label || routine.id);
					}

					dropdown.setValue(widget.routineId || enabledRoutines[0]?.id || '');
					dropdown.onChange((value) => {
						widget.routineId = value;
						this.renderPreview();
					});
				});
		}
	}

	private handleDrop(event: DragEvent, beforeWidgetId?: string): void {
		const widgetType = event.dataTransfer?.getData('widget-type') as
			| StreakWidgetType
			| '';
		const widgetId = event.dataTransfer?.getData('widget-id') ?? '';

		if (widgetType) {
			this.addWidget(widgetType, beforeWidgetId);
			return;
		}

		if (widgetId) {
			this.moveWidgetBefore(widgetId, beforeWidgetId);
		}
	}

	private addWidget(type: StreakWidgetType, beforeWidgetId?: string): void {
		const routineId =
			type === 'routine_focus'
				? this.plugin.settings.routines.find((routine) => routine.enabled)?.id ??
					''
				: '';
		const widget = createWidgetConfig(type, routineId);

		if (!beforeWidgetId) {
			this.draftLayout.push(widget);
			this.render();
			return;
		}

		const index = this.draftLayout.findIndex(
			(candidate) => candidate.id === beforeWidgetId,
		);
		this.draftLayout.splice(index >= 0 ? index : this.draftLayout.length, 0, widget);
		this.render();
	}

	private moveWidget(widgetId: string, delta: number): void {
		const index = this.draftLayout.findIndex((widget) => widget.id === widgetId);
		const targetIndex = index + delta;

		if (
			index < 0 ||
			targetIndex < 0 ||
			targetIndex >= this.draftLayout.length
		) {
			return;
		}

		const [widget] = this.draftLayout.splice(index, 1);
		if (widget) {
			this.draftLayout.splice(targetIndex, 0, widget);
			this.render();
		}
	}

	private moveWidgetBefore(widgetId: string, beforeWidgetId?: string): void {
		const index = this.draftLayout.findIndex((widget) => widget.id === widgetId);

		if (index < 0 || widgetId === beforeWidgetId) {
			return;
		}

		const [widget] = this.draftLayout.splice(index, 1);

		if (!widget) {
			return;
		}

		const targetIndex = beforeWidgetId
			? this.draftLayout.findIndex((candidate) => candidate.id === beforeWidgetId)
			: this.draftLayout.length;
		this.draftLayout.splice(
			targetIndex >= 0 ? targetIndex : this.draftLayout.length,
			0,
			widget,
		);
		this.render();
	}

	private async save(): Promise<void> {
		this.plugin.settings.widgetLayout = this.draftLayout;
		await this.plugin.saveSettings();
		this.onSave();
		this.close();
	}
}

function getWidgetTypeLabel(type: StreakWidgetType): string {
	return (
		STREAK_WIDGET_TYPES.find((widgetType) => widgetType.type === type)?.label ??
		'Widget'
	);
}

function formatScriptableWidgetFamily(family: ScriptableWidgetFamily): string {
	if (family === 'small') {
		return 'Small';
	}

	if (family === 'large') {
		return 'Large';
	}

	return 'Medium';
}

class FolderSuggest extends AbstractInputSuggest<TFolder> {
	private onChoose: (folderPath: string) => void;

	constructor(
		app: App,
		inputEl: HTMLInputElement,
		onChoose: (folderPath: string) => void,
	) {
		super(app, inputEl);
		this.limit = 50;
		this.onChoose = onChoose;
	}

	protected getSuggestions(query: string): TFolder[] {
		const normalizedQuery = normalizeFolder(query).toLowerCase();
		return this.getFolders()
			.filter((folder) => {
				if (normalizedQuery.length === 0) {
					return true;
				}

				const folderPath = normalizeFolder(folder.path).toLowerCase();
				return folderPath.includes(normalizedQuery);
			})
			.sort((left, right) => {
				if (left.isRoot()) {
					return -1;
				}

				if (right.isRoot()) {
					return 1;
				}

				return left.path.localeCompare(right.path);
			});
	}

	private getFolders(): TFolder[] {
		const folders: TFolder[] = [];

		const collect = (folder: TFolder): void => {
			folders.push(folder);

			for (const child of folder.children) {
				if (child instanceof TFolder) {
					collect(child);
				}
			}
		};

		collect(this.app.vault.getRoot());
		return folders;
	}

	renderSuggestion(folder: TFolder, el: HTMLElement): void {
		el.createDiv({
			text: folder.isRoot() ? 'Vault root' : folder.path,
		});

		if (folder.isRoot()) {
			el.createEl('small', { text: 'Leave the setting empty.' });
		}
	}

	selectSuggestion(folder: TFolder): void {
		const folderPath = folder.isRoot() ? '' : normalizeFolder(folder.path);
		this.setValue(folderPath);
		this.onChoose(folderPath);
		this.close();
	}
}

class ScriptableCodeModal extends Modal {
	private code: string;
	private bookmarkName: string;
	private dataJsonPath: string;
	private preferredFamily: ScriptableWidgetFamily;

	constructor(
		app: App,
		code: string,
		bookmarkName: string,
		dataJsonPath: string,
		preferredFamily: ScriptableWidgetFamily,
	) {
		super(app);
		this.code = code;
		this.bookmarkName = bookmarkName;
		this.dataJsonPath = dataJsonPath;
		this.preferredFamily = preferredFamily;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h2', { text: 'Generated scriptable code' });
		contentEl.createEl('p', {
			text: `Before using this, create a Scriptable file bookmark named "${this.bookmarkName}" for ${this.dataJsonPath}. Recommended size: ${formatScriptableWidgetFamily(this.preferredFamily)}.`,
		});

		const textareaEl = contentEl.createEl('textarea', {
			cls: 'routine-streaks-scriptable-code',
		});
		textareaEl.readOnly = true;
		textareaEl.rows = 18;
		textareaEl.value = this.code;
		textareaEl.addEventListener('focus', () => textareaEl.select());

		const buttonsEl = contentEl.createDiv({
			cls: 'routine-streaks-modal-buttons',
		});

		new ButtonComponent(buttonsEl)
			.setButtonText('Copy generated code')
			.setCta()
			.onClick(async () => {
				try {
					await navigator.clipboard.writeText(this.code);
					new Notice('Routine streaks: generated code copied.');
				} catch (error) {
					console.error('Routine streaks Scriptable copy failed', error);
					textareaEl.focus();
					textareaEl.select();
					new Notice('Routine streaks: select the code manually.');
				}
			});

		new ButtonComponent(buttonsEl)
			.setButtonText('Close')
			.onClick(() => this.close());
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

class ConfirmRoutineDeleteModal extends Modal {
	private routine: RoutineConfig;
	private onConfirm: () => Promise<void>;

	constructor(
		app: App,
		routine: RoutineConfig,
		onConfirm: () => Promise<void>,
	) {
		super(app);
		this.routine = routine;
		this.onConfirm = onConfirm;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h2', { text: 'Delete routine?' });
		contentEl.createEl('p', {
			text: `Delete "${this.routine.label}" from settings. Daily Notes will not be modified.`,
		});

		const buttonsEl = contentEl.createDiv({
			cls: 'routine-streaks-modal-buttons',
		});

		new ButtonComponent(buttonsEl)
			.setButtonText('Cancel')
			.onClick(() => this.close());

		new ButtonComponent(buttonsEl)
			.setButtonText('Delete')
			.setWarning()
			.onClick(async () => {
				await this.onConfirm();
				this.close();
			});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

function addDaysToDateKey(dateKey: string, days: number): string {
	const [yearPart, monthPart, dayPart] = dateKey.split('-');
	const year = Number(yearPart);
	const month = Number(monthPart);
	const day = Number(dayPart);
	const date = new Date(year, month - 1, day);
	date.setDate(date.getDate() + days);

	return [
		String(date.getFullYear()),
		String(date.getMonth() + 1).padStart(2, '0'),
		String(date.getDate()).padStart(2, '0'),
	].join('-');
}

function formatCacheSummary(cache: RoutineCache): string {
	const lastCompletedDate =
		cache.lastCompletedDate.length > 0 ? cache.lastCompletedDate : 'never';
	const taskSummary =
		cache.todayTaskCount > 0
			? `${cache.todayCompletedTaskCount}/${cache.todayTaskCount} tasks today`
			: '0 tasks today';

	return `Current ${cache.currentStreak} | Longest ${cache.longestStreak} | Last ${lastCompletedDate} | ${taskSummary}`;
}
