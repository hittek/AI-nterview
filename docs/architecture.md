# Architecture and internals

> Experimental. See the disclaimer in the [README](../README.md).

Stack: Electron 31 + Next.js (via [nextron](https://github.com/saltyshiomix/nextron)) + Tailwind. Claude via `@anthropic-ai/sdk`; transcription via bundled `whisper.cpp`.

## Processes and windows

| Window | Page | Purpose |
|---|---|---|
| Main (`home`) | `renderer/pages/home.tsx` | API key, CV, job description, extra context, prompts, capture buttons, transcription field |
| Answer (`answer`) | `renderer/pages/answer.tsx` | Floating, always-on-top answer viewer with history and loader |

Both windows call `setContentProtection(true)`. The answer window hides instead of closing; closing the main window quits the app. Window size/position persist via `electron-store` (`main/helpers/create-window.ts`).

Main process: `main/background.ts`. Preload (`main/preload.ts`) exposes `window.ipc` (send/on/invoke) and `window.electronAPI` (loopback audio toggles).

## Data flow

**Audio question**
1. Start (button or Cmd/Ctrl+Shift+7): `recorder.ts` opens system audio through `electron-audio-loopback` (`getDisplayMedia` with the video track dropped) and the mic (`getUserMedia`). Each stream is recorded to a 16 kHz mono 16-bit WAV in an `AudioContext` + `ScriptProcessor`.
2. Stop (Cmd/Ctrl+Shift+8): both WAVs go to the main process (`transcribe` IPC) in parallel. Tracks whose peak amplitude is below 300 are treated as silent and skipped. Whisper runs greedy (`-bs 1 -bo 1`), up to 8 threads, no timestamps.
3. The combined text `Interviewer: …\n\nMe: …` is shown in the Transcription field, then sent to Claude.

**Screenshot question**: Cmd/Ctrl+Shift+9 captures the screen in main (`screenshot-desktop`), sends the PNG (base64) to the renderer, which asks Claude with the screenshot prompt.

**Claude call** (`ask-claude` IPC, in main so the key never reaches web content): model `claude-sonnet-5-5`, `max_tokens` 4096. System prompt = selected prompt + optional `<my_cv>`, `<job_description>`, `<additional_context>` blocks + a "tailor, do not invent experience" line. The renderer waits for the full response (no streaming).

**Answers**: the renderer sends the result via `new-answer`; main appends it to an `electron-store` list (last 50), pushes the list to the answer window, and shows that window without taking focus. The answer window jumps to the newest entry on every update.

## IPC reference

| Channel | Kind | Direction | Notes |
|---|---|---|---|
| `ask-claude` | invoke | renderer → main | `{apiKey, system, content}` → text |
| `transcribe` | invoke | renderer → main | WAV `ArrayBuffer` → text |
| `parse-cv` | invoke | renderer → main | `{name, data}` → text (`.pdf` via pdf-parse, `.docx` via mammoth, else UTF-8) |
| `new-answer` | send | renderer → main | text; stored and broadcast |
| `get-answers` | invoke | answer → main | full history |
| `answers` | event | main → answer | full history |
| `status` | send/event | main window → main → answer | loader text; empty clears it |
| `nav` | event | main → answer | `-1` / `1` from the global shortcuts |
| `show-answer-window` | send | renderer → main | |
| `screenshot-taken`, `start-audio-capture`, `stop-audio-capture` | event | main → main window | from global shortcuts |

## Global shortcuts

`F7/F8/F9` and `Cmd/Ctrl+Shift+7/8/9` (start/stop/screenshot; F-keys need Fn on a Mac), `Cmd/Ctrl+Shift+←/→` (answer history). Registration failures are logged to the console.

## Persistence

| What | Where |
|---|---|
| API key, prompts, CV, job description, extra context, last transcript, last screenshot | renderer `localStorage` (the screenshot may exceed the quota and then silently not persist) |
| Answer history (50) | `electron-store` file `answers` in the app's userData folder |
| Window bounds | `electron-store` files `window-state-main` / `window-state-answer` |

The API key is stored unencrypted in `localStorage`. Treat the machine's user profile as the trust boundary.

## Whisper

Packaged builds read `Resources/whisper/` (see `extraResources` in `electron-builder.yml`): `ggml-base.en.bin` plus `whisper-cli` (mac) or `whisper-cli.exe` + DLLs (win). Dev uses `~/.local/bin/whisper-cli` and `~/.cache/whisper/ggml-base.en.bin`; `WHISPER_BIN` / `WHISPER_MODEL` override both. Swap in a larger model (e.g. `ggml-small.en.bin`) for better accuracy at the cost of speed; the filename is set in `main/background.ts`.

## Building

`npx nextron build --mac --arm64` / `--win --x64`. Each run wipes `dist/`. Unsigned. macOS needs `NSMicrophoneUsageDescription` and `NSAudioCaptureUsageDescription` (set in `electron-builder.yml`). The Windows build is cross-built from macOS and untested on Windows.

## Known limitations

- `setContentProtection` may not hide windows from ScreenCaptureKit-based sharing on newer macOS; test before use.
- `ScriptProcessor` is deprecated (swap for `AudioWorklet` if removed).
- Scanned (image-only) PDFs yield no CV text.
- Answers are plain text (no markdown rendering) and not streamed.
- Bundled whisper binary is arm64-only on macOS and CPU-only on Windows.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `EADDRINUSE :::8888` on `npm run dev` | A stale dev server holds the port; stop it |
| Capture is silent | Grant Microphone and Screen/System Audio Recording to the app (the packaged app is a separate entry from dev) and restart it |
| macOS says app is damaged | `xattr -cr ainterview.app` |
| Transcript is garbled | Use a larger whisper model; check the loopback device volume |
| Pad keys only scroll | See [external-keyboard.md](external-keyboard.md) |
