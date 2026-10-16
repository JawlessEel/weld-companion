# CHANGES

- 2026-10-16 · 1.89.1 · Backup folder served stale data back to generators: a re-saved chat copy was dropped (old file kept), and auto-sync could re-stamp an old browser-storage chat index as the newest. Fixed in src/backup-ui.js (previous chat copy kept under chat/_history; auto-sync never writes a chat index when the folder already has one).
