<p align="right"><b>English</b> · <a href="README.ru.md">Русский</a></p>

# orca-pod-form

`orca-pod-form` reopens the existing Orca Pod configuration form in a project where full setup has already run. It saves the selected profiles without repeating dependency, graphify or memory setup. [Back to orca-pod](../../README.md) · [Skill instructions](SKILL.md).

| Agent | Invocation |
| --- | --- |
| Claude Code | `/orca-pod-form` |
| Codex | `$orca-pod-form` |
| Pi | `/skill:orca-pod-form` |
| Qoder | `/orca-pod-form` |
| OMP | `/skill:orca-pod-form` |

The form discovers model catalogs as before. Cancel leaves the project unchanged; if the config changed while the form was open, the skill refuses to overwrite it. Existing YAML comments are not retained on save. Missing or legacy-only configs require `orca-pod-setup` first. OMP installation and sandbox notes are in the [main README](../../README.md).
