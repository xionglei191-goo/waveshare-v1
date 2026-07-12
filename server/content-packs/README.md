# Family Hub content packs

Family-owned content packs use manifest schema 1. A pack declares a stable `id`,
positive integer `version`, `source.kind`, `license`, and a `contents` list. Each
content entry has one of these types and paths:

- `album`: `images/` with JPG, PNG, or RGB565 BIN.
- `podcast`: `music/server/` with MP3, Ogg, or Opus.
- `english`: `courses/english/` with lesson JSON containing `title` and at least
  one of `lessons`, `phrases`, or `prompt`; MP3/Ogg/Opus audio and JPG/PNG
  covers use the same pack id with `assetRole` set to `audio` or `cover`.
- `game`: `games/` with JSON containing `title` and at least one of `levels`,
  `questions`, or `type`. Set `entry` to a firmware game id such as `tap` when
  the item should open a built-in game.
  Game packs may also include MP3/Ogg/Opus and JPG/PNG media with
  `assetRole=media` and an optional `lessonId`/level id association.

Imports are limited to 5 MB per file. Paths are relative and may not contain
`..`. JSON schemas and MP3/Ogg/Opus/JPEG/PNG file signatures are validated.
Files are written atomically and indexed with SHA-256, size, content type, and
version. Sample, test, diagnostic, demo, mock, and placeholder namespaces are
excluded from production views and cannot satisfy external acceptance.
