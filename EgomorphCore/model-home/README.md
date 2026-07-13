# EgoMorph Model Home

This directory is the default local workspace for the EgoMorph Codex bridge.

Codex may freely orient itself inside this directory with relative paths and may create or update allowed Markdown working files here. It must stay inside this directory and must not use it for secrets or script/web source files.

The bridge may use it for:

- `memory.md`, the reserved memory file generated from explicit user memory commands; if it is missing or was deleted, it may be recreated for memory entries
- user-provided `.json`, `.md`, and `.txt` files that may be read as prompt context
- Markdown files (`.md`) created when the user explicitly asks Codex to save notes, drafts, or other text

Private contents are intentionally ignored by Git. Keep this README so the directory exists in a clean checkout, but do not publish personal `memory.md` files or user documents. General notes and drafts should use their own Markdown filenames; `memory.md` is only for memory.
