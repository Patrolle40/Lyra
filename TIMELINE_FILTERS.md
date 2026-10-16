# Lyra V1-3.12-0 — Timeline Filters

Button: Timeline Filters, immediately above the main timeline.

- Text: checked by default; standard lyrics lines.
- Instrumental: checked by default; instrumental intervals.
- Manually Placed: checked by default; free/scratch Word-by-Word lines. New scratch lines are tagged `manualPlaced: true`, retained in project saves.
- Generated: disabled and unchecked; reserved for future Online/AI functionality.
- In the preview window unchecked lines are always dimmed, including when main setting is Hide.
- In the main timeline the Hide / Darken switch applies only to unchecked types.
- No lines are removed from the project, undo history, player lyrics, or exported lyrics.
- Preferences are saved locally on this device (`lyra-timeline-filter-v1`) and shared across projects.

Testing: Toggle each filter with at least one line of each type; verify dimming in preview; toggle Hide / Darken and verify main timeline behavior; reload and verify preferences persisted; verify lyrics exports still include all lines.
