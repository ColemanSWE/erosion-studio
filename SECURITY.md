# Security policy

## Reporting a vulnerability

Please report security issues privately through GitHub: open the repository's **Security** tab and choose **Report a vulnerability**. Don't open a public issue for anything exploitable.

Include what you found, how to reproduce it, and the version or commit you tested. You'll get a reply within a week.

## Supported versions

Fixes go into `main` and the next release. Older releases aren't patched.

## What's in scope

Erosion Studio opens untrusted media and project files, so the boundaries that matter most are:

- **Renderer → main process.** The renderer is sandboxed and treated as untrusted. Any way for it to read, write or delete files outside what `electron/path-policy.ts` allows, or to run code in the main process, is a vulnerability.
- **`app://` and `media://` protocol handlers** (`electron/app-protocol.ts`, `electron/media-protocol.ts`): path traversal, serving non-media files, or escaping `dist/`.
- **Malicious `.eron` projects or media files** that execute script, bypass the Content Security Policy, or trigger file access beyond the policy.
- **Remote code loading.** The renderer should only run code shipped with the app.

Bugs in bundled third-party binaries (FFmpeg, Electron/Chromium) should go to those projects, but let us know if Erosion Studio needs to update a version.
