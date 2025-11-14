
# LightTaskSheet — Final Build

A lightweight internal spreadsheet-style task tracker with:

- Multi-user authentication
- JSON-backed storage
- Undo, multi-select, drag & drop
- Sub-rows, hierarchical numbering
- JSON & Excel export
- Collapse/expand
- Column types & color coding

## Installation

```sh
npm install
```

## Run

```sh
npm start
```

Server runs on http://localhost:3000

## Backup

```sh
npm run backup
```

Backups are stored in `backups/` as timestamped copies of the `data/` folder.
