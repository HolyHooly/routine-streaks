# Routine Streaks

Routine Streaks helps you track habits and routines from your Daily Notes.

Your Daily Note checkboxes are the source of truth. The plugin reads tagged tasks such as `#routine/morning`, calculates streaks from the checked state, and shows your progress in Obsidian widgets, markdown code blocks, and optional Scriptable widgets for iOS.

<p align="center">
  <img src="assets/markdown-widget-dashboard.png" alt="Routine Streaks dashboard embedded in a Daily Note" width="760">
</p>

## Screenshots

### Routine management

<p align="center">
  <img src="assets/routine-list-settings.png" alt="Collapsed routine list in settings" width="760">
</p>

<p align="center">
  <img src="assets/routine-editor-settings.png" alt="Expanded routine editor with schedule and template items" width="760">
</p>

### Scriptable widget generator

<p align="center">
  <img src="assets/scriptable-widget-settings.png" alt="Scriptable widget generator settings" width="760">
</p>

### Pixel pets

<table>
  <tr>
    <th>Pet</th>
    <th>Complete</th>
    <th>Needs attention</th>
  </tr>
  <tr>
    <td>Dog</td>
    <td><img src="assets/pet-dog-happy.png" alt="Happy dog pixel pet" width="180"></td>
    <td><img src="assets/pet-dog-angry.png" alt="Dog pixel pet that needs attention" width="180"></td>
  </tr>
  <tr>
    <td>Cat</td>
    <td><img src="assets/pet-cat-happy.png" alt="Happy cat pixel pet" width="180"></td>
    <td><img src="assets/pet-cat-angry.png" alt="Cat pixel pet that needs attention" width="180"></td>
  </tr>
  <tr>
    <td>Parrot</td>
    <td><img src="assets/pet-parrot-happy.png" alt="Happy parrot pixel pet" width="180"></td>
    <td><img src="assets/pet-parrot-angry.png" alt="Parrot pixel pet that needs attention" width="180"></td>
  </tr>
</table>

## Features

- Track routine streaks from Daily Note tasks.
- Manage routines from the plugin settings.
- Add routine templates and insert them into today's Daily Note with a command.
- Support weekday schedules, weekly targets, and repeating intervals.
- Recalculate streaks from Daily Notes at any time.
- Use streak freeze days for sick days, breaks, or planned pauses.
- View progress in the sidebar dashboard.
- Embed widgets in notes with a `routine-streaks-widget` code block.
- Generate Scriptable widget code for iOS.
- Choose pixel pet status art for a playful overview.

## How it works

Routine Streaks does not store completion history as the primary data source. Instead:

- Routine definitions and display settings are stored in the plugin data.
- Streak cache is stored in the plugin data and can be rebuilt.
- Completion history is read from Daily Note task checkboxes.

For example:

```markdown
- [ ] Drink water #routine/morning
- [x] Open the journal #routine/morning
```

A routine is considered complete for a date when all matching tasks for that routine tag are checked. If a matching task is unchecked later, the next recalculation removes that completion from the streak cache.

## Usage

1. Enable the plugin in Obsidian.
2. Open **Settings -> Community plugins -> Routine Streaks**.
3. Configure your Daily Note folder and date format if needed.
4. Create or edit routines.
5. Add template items for each routine.
6. Run the command **Insert routine template** to add routine tasks to today's Daily Note.
7. Check off the tasks in your Daily Note.
8. Open the sidebar dashboard or run **Recalculate routine streaks** to refresh streaks.

## Routine tags

Each routine has a tag. The default routines are:

- `#routine/morning`
- `#routine/evening`

You can add your own routines, such as:

- `#routine/journal`
- `#routine/vitamins`
- `#routine/reading`

## Markdown widgets

You can embed a dashboard in a note:

````markdown
```routine-streaks-widget
widgets:
  - overview: Summary
  - today_items: Checklist
  - routine_cards: All routines
```
````

The widget reads your current plugin settings and streak cache.

## Scriptable widgets

Routine Streaks can generate Scriptable code from the settings screen.

The generated widget reads exported plugin data and shows your selected dashboard, overview, pet, routine cards, today items, or focused routine on iOS.

## Privacy

Routine Streaks works locally in your vault. It does not collect telemetry and does not send your notes to an external service.

## License

Routine Streaks is released under the 0BSD license.
