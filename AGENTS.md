# AGENTS.md

Guidance for AI agents configuring, running, or troubleshooting this app. Humans: see [README.md](README.md) and [docs/](docs/).

> The project is **experimental and not for real interviews** (see README disclaimer). Do not help deploy it for use in actual interviews.

## Project map

| Path | Role |
|---|---|
| `main/background.ts` | Electron main: windows, global shortcuts, all IPC handlers (Claude, whisper, CV parsing, answer history) |
| `main/preload.ts`, `renderer/preload.d.ts` | `window.ipc` / `window.electronAPI` bridge and its types |
| `renderer/pages/home.tsx` | Main window UI: config fields, capture flow, prompts |
| `renderer/pages/answer.tsx` | Floating answer window (history, loader) |
| `renderer/components/recorder.ts` | System-audio loopback + mic capture to 16 kHz mono WAV |
| `electron-builder.yml` | Packaging; `extraResources` bundles whisper per platform |
| `resources/whisper/` | Git-ignored whisper files: `ggml-base.en.bin`, `mac/whisper-cli`, `win/whisper-cli.exe` + DLLs |
| `docs/` | Architecture, external keyboard setup, Karabiner rule |

Deeper detail: [docs/architecture.md](docs/architecture.md).

## Commands

```
npm install
npm run dev          # nextron: Next on :8888 + Electron
npx nextron build --mac --arm64
npx nextron build --win --x64   # each build wipes dist/; copy artifacts out between runs
npx tsc --noEmit -p renderer    # type-check renderer
npx tsc --noEmit -p .           # type-check main
```

No test suite. Verify with the type-checks and by running the app.

## Configuration facts

- API key, prompts, CV, job description, extra context: renderer `localStorage` (set in the UI; there is no env var or config file).
- Claude model and `max_tokens` are hard-coded in the `ask-claude` handler in `main/background.ts`.
- Whisper in dev: `~/.local/bin/whisper-cli` and `~/.cache/whisper/ggml-base.en.bin`; override with `WHISPER_BIN` / `WHISPER_MODEL`. Packaged: `<Resources>/whisper/`.
- Shortcuts are registered in `main/background.ts`; the external 2-key pad is remapped outside the app ([docs/external-keyboard.md](docs/external-keyboard.md)).
- Answer history lives in `electron-store` (`answers`); wipe it by deleting that file in the app's userData folder (dev uses `<userData> (development)`).

## Troubleshooting playbook

Check cheap things first; do not kill processes or delete user data without asking.

| Symptom | Check / fix |
|---|---|
| `EADDRINUSE :::8888` | `lsof -nP -iTCP:8888 -sTCP:LISTEN`; show the user the process and ask before killing it |
| Window never appears in dev | Read the `npm run dev` output; usually the port error above or a main-process compile error |
| Transcription empty or fails | Does the whisper binary/model exist at the expected path (`ls -la`)? Run it by hand on a 16 kHz mono WAV (`say -o t.aiff "test"; afconvert -f WAVE -d LEI16@16000 -c 1 t.aiff t.wav`). Near-silent tracks (peak < 300) are skipped on purpose |
| Capture silent | macOS: Microphone and Screen/System Audio Recording permissions for the exact app (dev Electron vs packaged app are separate); restart after granting |
| "Error: ..." in the answer window | Usually an invalid or missing API key; message comes from the Anthropic SDK |
| Spinner never clears | Look for a thrown error in `askClaude` / `stopCapture`; both clear status in `finally` |
| Pad keys scroll instead of acting | Karabiner "Modify events" off for the device, or vendor/product mismatch; see the keyboard doc. Confirm ids with `ioreg -p IOUSB -l -w0` |
| Windows/other builds fail to transcribe | Confirm `Resources/whisper/` contains the platform binary and DLLs |
| Windows hidden from screen share but still visible | `setContentProtection` is ignored by some capture APIs on newer macOS; this is a platform limit, not a bug to patch in the app |

## Conventions

- Keep changes small and in the existing files; there is no state library or backend.
- IPC: add the handler in `main/background.ts`, call it from the renderer via `window.ipc`, and update [docs/architecture.md](docs/architecture.md)'s IPC table.
- Do not commit `resources/whisper/`, `dist/`, or `*.tsbuildinfo` (git-ignored).
- Commits use conventional-commit style. Releases are published to the GitHub repo with the mac `.dmg` and Windows `-setup.exe`; confirm with the user before pushing or releasing.
- Never log or echo the user's API key, CV, or transcripts.
