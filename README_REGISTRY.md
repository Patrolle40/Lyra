# Lyra Compatible Apps Registry · local prototype

Based on Lyra V1-3.12-0. Open index.html (best served by a local web server).

Features: public name search, exact app-code lookup for public/unlisted, private hidden from search, filters, manual installation flag, local admin create/edit/delete, custom HTTPS links, custom icon URL, local certification review with version/date/notes, offline mode and native import placeholder. Data stored in localStorage on each browser/device.

LIMITATIONS: No server, no accounts, no actual APK upload/inspection, no Android package discovery or content URI bridge, no trustworthy developer ownership verification, no malware scan, no cross-device sync. Certification is a self-assigned local TEST label only. Installed status is manually entered. The original LyraImport.receiveSong(File) browser test flow is preserved. For real deployment implement backend access controls and a native Capacitor Android plugin.
