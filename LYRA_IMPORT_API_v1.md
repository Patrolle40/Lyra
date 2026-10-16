# Lyra Import Protocol v1 (draft)

This documents the client-side interface included in Lyra V1 - 3.06. The native platform transport is **not yet implemented**. No remote API, server, account, or API key is required for same-device local transfer.

## Browser-side interface

`window.LyraImport.receiveSong({ audioFile, title, artist, fileName? })`

- `audioFile`: an accessible JavaScript `File` or `Blob` containing a non-empty audio file. If a Blob has no `.name`, supply `fileName` with a supported audio extension.
- `title`, `artist`: optional display strings.
- Shows a user-choice popup after the audio is selected: **New Project**, **Current Project** (only in an open editor), or **Cancel**. For Current Project, existing lyric lines, words and timing are preserved; its previous audio is replaced.
- Resolves to `{ok:true, projectId:string, destination:"new"|"current"}` on success or `{ok:false, reason:"cancelled"}` on cancel.
- Rejects with an error if file validation or browser storage fails.
- Supported filename extensions currently include `.mp3`, `.flac`, `.wav`, `.m4a`, `.aac`, `.ogg`, `.opus`, `.webm`, `.mp4`, `.aiff`. Actual playback depends on browser/WebView support.

**Example for an already-accessible file:**

```js
const file = document.querySelector('input[type=file]').files[0];
await window.LyraImport.receiveSong({
  audioFile: file,
  title: 'Song title',
  artist: 'Artist'
});
```

## Provider adapter API

```js
window.LyraImport.registerProvider('stash', async ({ appId, protocol, version }) => {
  // A future native adapter opens Stash's song picker, receives its readable audio,
  // and returns the browser-accessible File plus metadata.
  // Return null if the user cancels.
  return { audioFile: chosenFile, title: chosenTitle, artist: chosenArtist };
});

// Called by Lyra when the user presses Compatible Apps > Stash > Import Song:
await window.LyraImport.requestSong('stash');
```

App entries are defined in `COMPATIBLE_APPS` in `index.html`. Currently **only Stash** is listed; other apps should be added when real integrations are arranged.

## Android / iOS responsibilities (future work)

- Android: use an Intent/Activity Result or supported file-sharing mechanism and `content://` URI with temporary read permission. Pass the resulting file data to the JS WebView through a secure Capacitor native bridge.
- iOS: implement a suitable document picker/Share Extension and securely make selected audio accessible to the WebView.
- Verify the user intentionally selected the song; do not expose or scan another app's whole local library.
- Do **not** pass private device paths or `content://` strings directly into `receiveSong`: it requires a readable JS Blob/File, not an arbitrary URI.
- For online streaming with DRM or files inaccessible to the originating app, transfer may not be possible.

## Testing in the HTML/PWA

Go to **Extra > Compatible Apps > Stash > Import Song > Test with audio file**. This tests the same `receiveSong` storage/project-import code and prompts for **New Project** / **Current Project** without pretending to communicate with Stash.

