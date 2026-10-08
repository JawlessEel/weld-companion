# Backups tab

Shows the generator backup copies that generators store in Weld through Skybridge storage, and saves them to a folder you choose.

## Where copies live

Generators write to Weld's storage, which is the userscript manager's own storage inside the browser profile. That is convenient but fragile: clearing site data or removing the script removes it. The **Backup location** card exists so a second copy lives somewhere you control.

## Backup location

1. Open Weld, **Backups**, **Backup location**, then **Choose folder...**. Pick any folder: a local drive, an external disk, or a folder inside Google Drive, OneDrive, iCloud Drive or Dropbox (the sync client uploads it).
2. Press **Save all to folder now**, or tick **Save new backups to the folder automatically** to copy each new save while Weld is open.
3. After a browser restart press **Allow access** once; browsers require a click to re-grant folder access.

Needs Chrome or Edge (other browsers cannot open folders). The folder choice is remembered in the browser's IndexedDB (`weldCompanionBackupFolder`); the automatic setting is stored as `backupFolderAuto`.

### Sharing between computers (Load from folder)

Point Weld on every computer at the same synced folder (for example `Google Drive\My Drive\Weld_shared_saves`) and turn on the automatic save. Each Weld then adds its saves to the folder, and **Check folder for new saves** reads the other computers' saves back:

1. Press **Check folder for new saves**. Weld reads the `weld-backup-record` / `weld-backup-bundle` files in the folder (up to 5 levels deep) and lists what would change. Nothing is written yet.
2. Press **Apply**. Weld first saves its own current copies to the folder, then writes the listed records into its storage. Reload the generator tab afterwards so it reads them.

What it will and won't do: a record missing here is added; a chat copy that already exists is never overwritten; a source (snapshot) copy is replaced only by one with a strictly newer saved time; a chat index only gains entries whose chat copy is present; keys you deleted here on purpose stay deleted; `_operational` (link and self-test) and `_legacy` records are skipped because they belong to one computer; chat copies holding secret-shaped values are held back.

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
- Nothing is restored from the folder automatically. Generators own applying copies.

## Cleanup duplicates

**Find duplicates** compares the chat copies and source copies for each generator by their full content (not a hash alone).

- **Exact duplicates** are listed with the newest copy kept and the older ones pre-ticked. **Delete selected** first saves everything to your backup folder, reads each copy back from the folder and confirms its content matches, then removes only those keys and takes them out of the generator's chat index. It needs a backup folder with access allowed.
- **Possible duplicates** (same thread and message counts, different content) are only listed. Delete one with the per-key Delete button after checking it.
- **Ask the AI helper to review** opens the AI helper with a metadata-only report (key names, dates, counts; never chat text or settings). You press Ask yourself.
- Chat copies holding secret-shaped values are left out of cleanup because they are never copied to the folder.
