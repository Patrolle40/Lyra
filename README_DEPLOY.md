# Lyra website demo

Upload the contents of this folder to Cloudflare Pages (direct upload), or connect the repository to Pages.

## Download link
In `index.html`, find `SITE_CONFIG` near the bottom and fill:
- `latestVersion`: public version label
- `latestApkUrl`: permanent HTTPS URL, e.g. `https://github.com/OWNER/REPO/releases/latest/download/Lyra.apk`
- `latestReleaseUrl`: `https://github.com/OWNER/REPO/releases/latest`

The download buttons are deliberately disabled until these are configured.

## Assets
`assets/banner.png` and `assets/icon.png` are the supplied Lyra branding.
The gallery uses real captures of an earlier browser build; some UI elements may differ from the current Android build.

## Documentation
The included Import V1 guide is an early draft. Verify API parameters and code against the current app before publishing it as authoritative.
