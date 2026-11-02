import path from 'path'
import { app, ipcMain, globalShortcut, BrowserWindow } from 'electron'
import Store from 'electron-store'
import serve from 'electron-serve'
import { createWindow } from './helpers'
import screenshot from 'screenshot-desktop'
import Anthropic from '@anthropic-ai/sdk'
import { initMain } from 'electron-audio-loopback'
import { execFile } from 'child_process'
import { promisify } from 'util'
import fs from 'fs'
import os from 'os'
import mammoth from 'mammoth'
import { PDFParse } from 'pdf-parse'

// must run before app is ready
initMain()

const isProd = process.env.NODE_ENV === 'production'

if (isProd) {
  serve({ directory: 'app' })
} else {
  app.setPath('userData', `${app.getPath('userData')} (development)`)
}

;(async () => {
  await app.whenReady()

  const mainWindow = createWindow('main', {
    width: 1000,
    height: 1200,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
    alwaysOnTop: true,
    autoHideMenuBar: false,
    focusable: true,
  })

  if (isProd) {
    await mainWindow.loadURL('app://./home')
  } else {
    const port = process.argv[2]
    await mainWindow.loadURL(`http://localhost:${port}/home`)
    mainWindow.webContents.openDevTools()
  }

  mainWindow.setContentProtection(true);
  mainWindow.on('closed', () => app.quit())

  // Floating answer window: sits over the main one (or anywhere), hidden from screen share
  answerWindow = createWindow('answer', {
    width: 520,
    height: 600,
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
    alwaysOnTop: true,
  })
  answerWindow.setContentProtection(true)
  answerWindow.on('close', (e) => {
    if (quitting) return
    e.preventDefault() // hide instead; reopen from the main window
    answerWindow.hide()
  })
  await answerWindow.loadURL(isProd ? 'app://./answer' : `http://localhost:${process.argv[2]}/answer`)
  mainWindow.focus()

  // navigate answer history without leaving Zoom
  globalShortcut.register('CommandOrControl+Shift+Left', () => answerWindow.webContents.send('nav', -1))
  globalShortcut.register('CommandOrControl+Shift+Right', () => answerWindow.webContents.send('nav', 1))

  // F9 is a media/Mission Control key on a Mac (needs Fn), so also bind Cmd/Ctrl+Shift+9
  for (const key of ['F9', 'CommandOrControl+Shift+9']) {
    if (!globalShortcut.register(key, () => takeScreenshot(mainWindow))) console.error('shortcut not registered:', key)
  }

  // F7/F8 are media keys on a Mac (need Fn), so also bind Cmd+Shift+7/8
  for (const key of ['F7', 'CommandOrControl+Shift+7']) {
    if (!globalShortcut.register(key, () => mainWindow.webContents.send('start-audio-capture', true))) console.error('shortcut not registered:', key)
  }
  for (const key of ['F8', 'CommandOrControl+Shift+8']) {
    if (!globalShortcut.register(key, () => mainWindow.webContents.send('stop-audio-capture', true))) console.error('shortcut not registered:', key)
  }

  app.commandLine.appendSwitch('enable-features', 'WebSpeechAPI');
})()

app.on('will-quit', () => {
  // Unregister all shortcuts
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  app.quit()
})

// Function to take a screenshot
function takeScreenshot(mainWindow) {
  screenshot({ format: 'png' })
    .then((img) => {
      const imgBase64 = img.toString('base64');

      // Send the Base64 string to the renderer process
      if (mainWindow) {
        mainWindow.webContents.send('screenshot-taken', imgBase64);
      }
    })
    .catch((err) => {
      console.error('Error taking screenshot:', err);
    });
}

let answerWindow: BrowserWindow
let quitting = false
app.on('before-quit', () => { quitting = true })

// Answer history (last 50) survives restarts
const answerStore = new Store<{ list: string[] }>({ name: 'answers', defaults: { list: [] } })
ipcMain.handle('get-answers', () => answerStore.get('list'))
ipcMain.on('new-answer', (_e, text: string) => {
  const list = [...answerStore.get('list'), text].slice(-50)
  answerStore.set('list', list)
  answerWindow?.webContents.send('answers', list)
  answerWindow?.showInactive() // reappear without stealing focus from Zoom
})
ipcMain.on('status', (_e, status: string) => answerWindow?.webContents.send('status', status))
ipcMain.on('show-answer-window', () => answerWindow?.show())

// IPC Communication
ipcMain.on('request-screenshot', () => {
  takeScreenshot(null);
});

// Claude lives in main: keeps the key out of web content and avoids CORS
ipcMain.handle('ask-claude', async (_e, { apiKey, system, content }) => {
  const client = new Anthropic({ apiKey })
  const msg = await client.messages.create({
    model: 'claude-sonnet-5-5',
    max_tokens: 4096,
    system,
    messages: [{ role: 'user', content }],
  })
  return msg.content.map((b) => (b.type === 'text' ? b.text : '')).join('')
})

// Local transcription: `brew install whisper-cpp` + a ggml model (see README)
// Packaged app ships both in Resources/whisper (see extraResources); dev falls back to the local install
const bundled = (f: string) => path.join(process.resourcesPath, 'whisper', f)
const WHISPER_MODEL =
  process.env.WHISPER_MODEL ||
  (app.isPackaged ? bundled('ggml-base.en.bin') : path.join(os.homedir(), '.cache/whisper/ggml-base.en.bin'))
const WHISPER_BIN =
  process.env.WHISPER_BIN || (app.isPackaged ? bundled(process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli') : `${process.env.HOME}/.local/bin/whisper-cli`)

ipcMain.handle('transcribe', async (_e, wav: ArrayBuffer) => {
  // skip near-silent tracks (e.g. nobody spoke): nothing to transcribe
  const pcm = new Int16Array(wav, 44, Math.floor((wav.byteLength - 44) / 2))
  if (!pcm.some((x) => Math.abs(x) > 300)) return ''
  const file = path.join(os.tmpdir(), `ainterview-${Date.now()}-${Math.random().toString(36).slice(2)}.wav`)
  fs.writeFileSync(file, Buffer.from(wav))
  try {
    const { stdout } = await promisify(execFile)(
      WHISPER_BIN,
      ['-m', WHISPER_MODEL, '-f', file, '-nt', '-np', '-bs', '1', '-bo', '1', '-t', String(Math.min(8, os.cpus().length))] // greedy decoding + more threads
    )
    return stdout.trim()
  } finally {
    fs.unlinkSync(file)
  }
})

// CV upload: extract plain text from .pdf / .docx / text files
ipcMain.handle('parse-cv', async (_e, { name, data }: { name: string; data: ArrayBuffer }) => {
  const buf = Buffer.from(data)
  const ext = path.extname(name).toLowerCase()
  if (ext === '.pdf') {
    const parser = new PDFParse({ data: new Uint8Array(buf) })
    try {
      return (await parser.getText()).text.trim()
    } finally {
      await parser.destroy()
    }
  }
  if (ext === '.docx') return (await mammoth.extractRawText({ buffer: buf })).value.trim()
  return buf.toString('utf8').trim() // .txt / .md
})
