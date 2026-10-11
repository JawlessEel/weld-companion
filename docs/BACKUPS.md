# Backups tab

## GitHub backup (Weld 1.79.1)

The GitHub tab's **Push** and **Push as pull request** have been restored to their
earlier two-panel behavior: the DSL/top panel and HTML panel only. They do not
collect `src/` files, browser caches, downloaded models or OPFS files. Existing
repository mappings and the saved token are preserved. Each push still commits
both panels atomically, so a failed upload cannot update only one panel.

The earlier Tampermonkey request options are restored without a native timeout
option; an explicit 35-second watchdog remains to stop requests that never call
a handler. This rollback has not yet been verified in the installed manager.

### Restoring older full-project backups

Full-project backups made with earlier versions use `.weld-backup/manifest.json`
and verified 4 MiB parts for large files. Existing backup files are retained by
the restored two-panel Push; it does not delete older project or asset files.

To restore the exact source bytes from a downloaded/cloned backup,
run this inside the generator's folder (Python 3, standard library only):

```powershell
python .weld-backup/restore.py --output ..\restored-generator
```

Use a new output directory outside the generator folder. The tool checks the size
and SHA-256 of every part and refuses to overwrite existing files. Source files
restore under `src/`. Older backups containing cached models can still restore
them under `.weld-backup/assets/`. Browser cache reinstallation is not automated. The two
editor panel backups remain in the original generator folder.

For a local download that also captures readable cached assets/models, use Dev's
**Download all files and assets (this generator)**. This saves assembled files to
the computer save folder and enables automatic updates only for generators you
explicitly select; see [Folder sync](DEV.md#folder-sync).

**Local asset coverage limits:** a userscript cannot read the browser's ordinary HTTP disk
cache or other origins' storage. Private chat databases, IndexedDB, cookies,
credentials, `.env` and private-key files are excluded (a sensitive project path
aborts the push). Public cache capture accepts recognized static/model file URLs
on Perchance, Hugging Face, uploads and the supported library CDNs; API responses,
authenticated requests and signed URLs are excluded. This is a project/model
backup, not a browser-profile export. The manifest and confirmation report these
limits and unavailable storage APIs. Loading a model into a remote server does
not make its weights available in this browser.

Weld keeps no backups of its own (1.88.0). Generator vault saves pass straight through to a backup folder you choose; this tab shows, downloads, deletes and purges anything older that is still held in browser storage.

## Where copies live

A generator's vault save (`weld:genvault:<generator>/snapshot`, `chat/index`, `chat/snap-*`) is written straight into the **Backup location** folder and never into Weld's storage. When the generator reads or lists its vault, Weld answers from that folder (an older copy still in browser storage is used only for a key the folder does not have). With no folder chosen, or folder access not allowed, the save is refused with code `no-backup-folder` and the generator keeps its own copy. Chat copies still need **Settings > Skybridge > Let generators send chat copies** turned on. Each generator may write at most 30 files per 10 minutes and 500 files per folder (codes rate-limited, folder-full), and reads only accept files that generator stored itself.

## Backup location

1. Open Weld, **Backups**, **Backup location**, then **Choose folder...**. Pick any folder: a local drive, an external disk, or a folder inside Google Drive, OneDrive, iCloud Drive or Dropbox (the sync client uploads it).
2. After a browser restart press **Allow access** once (or leave **Keep access allowed** on and click anywhere); browsers require a click to re-grant folder access.
3. **Save all to folder now** (or the automatic option) copies anything older still in browser storage into the folder.

Needs Chrome or Edge (other browsers cannot open folders). The folder choice is remembered in the browser's IndexedDB (`weldCompanionBackupFolder`); the automatic setting is stored as `backupFolderAuto`.

Several computers can point at the same synced folder: each one's generators read the vault saves that are there. (The old **Check folder for new saves** import was removed in 1.88.0 because it copied records into Weld storage.)

## Delete and Purge

- **Delete** on a key removes that one key at once, with no confirmation. The opened sections and scroll position stay where they were. A generator's chat index is not edited.
- **Purge all Weld-stored backups** removes every backup Weld still holds in browser storage, in one click: all vault keys (including legacy `dadchat:vault:*`) and the Project tab's old `weldCompanionProjects` database (saved generator copies and snapshots). Small operational link and self-test records are kept. Anything not provably in the backup folder is saved first: into the folder when one is connected (chat copies with secret-shaped values, which never go to a folder, are downloaded instead), otherwise everything is downloaded as one `weld-backup-purged-<date>.json` file.
- The Project tab now keeps generator copies and snapshots for the open tab only; reloading clears them. Use its Download buttons to keep one.

### Layout

```
<your folder>/
  <generator>/snapshot/snapshot-YYYYMMDD-HHMMSS-xxxx.json   generator-source copies
  <generator>/chat/snap-<time>-<id>.json                    chat copies
  <generator>/chat/index-<hash>.json                        chat index versions
  <generator>/other/...                                     other keys under that generator
  _legacy/  _operational/                                   dadchat:vault:* and link/self-test keys
```

Each file is `{ "format": "weld-backup-record", "v": 1, "exportedAt", "record": { key, storedBy, size, stale, value } }`, the same shape as the Download buttons.

### Safety rules

- **Add-only.** A file is written only if its name does not exist yet. A changed record gets a new file (the name includes its time or a content hash), so an older copy is never overwritten. Weld never deletes anything in the folder, and **Disconnect folder** leaves it untouched.
- **Secrets stay out.** A chat copy whose config holds a plaintext secret-shaped value (api key, secret, token, webhook) is held back and listed in the card instead of being copied to a drive or cloud folder.
- Stale (null) records are skipped; unreadable ones are counted as failed.
- A generator deleting a copy (a null save) never deletes a file from the folder.

## Cleanup duplicates

**Find duplicates** compares the chat copies and source copies for each generator by their full content (not a hash alone).

- **Exact duplicates** are listed with the newest copy kept and the older ones pre-ticked. **Delete selected** first saves everything to your backup folder, reads each copy back from the folder and confirms its content matches, then removes only those keys and takes them out of the generator's chat index. It needs a backup folder with access allowed.
- **Possible duplicates** (same thread and message counts, different content) are only listed. Delete one with the per-key Delete button after checking it.
- **Ask the AI helper to review** opens the AI helper with a metadata-only report (key names, dates, counts; never chat text or settings). You press Ask yourself.
- Chat copies holding secret-shaped values are left out of cleanup because they are never copied to the folder.
