import React from 'react'
import Head from 'next/head'
import Image from 'next/image'
import { useEffect, useRef, useState } from 'react';
import { recordWav, getSystemAudio, getMic } from '../components/recorder';

const DEFAULT_SCREENSHOT_PROMPT = `You are helping me during a live technical interview. The image is a screenshot of the current question (coding problem, system design prompt, or multiple choice).
- Identify the problem and any constraints or examples shown.
- Coding: give a brief approach, then a clean, correct solution in the language shown (default Python), with time/space complexity and 2-3 edge cases.
- System design: list requirements, a high-level architecture, key trade-offs, and scaling bottlenecks.
- Multiple choice: state the answer first, then one line of reasoning.
Be concise and scannable. If the screenshot is unreadable or ambiguous, say what is missing instead of guessing.`

const DEFAULT_AUDIO_PROMPT = `You are helping me during a live interview. The text is an automatic transcript of what the interviewer just said; it may contain transcription errors, so infer the intended words.
- If it is a question, give a direct answer I can say aloud in 30-60 seconds: lead with the answer, then 2-3 supporting points or a short example (STAR format for behavioral questions).
- If it is a technical question, be precise and mention trade-offs.
- If it is small talk or not a question, reply with a single short suggested response.
- If it is cut off or unclear, suggest a clarifying question to ask back.
Write in first person, conversational, no preamble.`

export default function HomePage() {
  const [ base64Data, setBase64Data ] = useState('');
  const [ screenshotPrompt, setScreenshotPrompt ] = useState('');
  const [ audioCapturePrompt, setAudioCapturePrompt ] = useState('');
  const [ fileName, setFileName ] = useState(null);
  const [ capturingAudio, setCapturingAudio ] = useState(false);
  const [ cv, setCv ] = useState('');
  const [ jobDescription, setJobDescription ] = useState('');
  const [ extraContext, setExtraContext ] = useState('');
  const [ transcript, setTranscript ] = useState('');
  const [ status, setStatus ] = useState(''); // non-empty while waiting on an AI/transcription call
  const apiKeyRef = useRef('');
  const promptsRef = useRef({ screenshot: '', audio: '', cv: '', jd: '', extra: '' }); // listeners are registered once; read latest prompts via ref
  const [ apiKey, setApiKey ] = useState('');
  const [ mod, setMod ] = useState('Ctrl');
  const mediaRecorderRef = useRef<any | null>(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    // Listen for the screenshot-taken event
    window.ipc.on('screenshot-taken', async (data) => {
      setBase64Data(data as any);
      await aiForScreenshots(data as any);
    });

    // Listen for the start-audio-capture event
    window.ipc.on('start-audio-capture', (_) => {
      startCapture();
    });
    
    // Listen for the stop-audio-capture event
    window.ipc.on('stop-audio-capture', (_) => {
      stopCapture();
    });

    // Get prompt from local storage
    const screenshotPrompt = localStorage.getItem('screenshotPrompt');
    setScreenshotPrompt(screenshotPrompt || DEFAULT_SCREENSHOT_PROMPT);

    const audioCapturePrompt = localStorage.getItem('audioCapturePrompt');
    setAudioCapturePrompt(audioCapturePrompt || DEFAULT_AUDIO_PROMPT);

    setTranscript(localStorage.getItem('transcript') || '');
    setBase64Data(localStorage.getItem('screenshot') || '');
    setExtraContext(localStorage.getItem('extraContext') || '');
    setCv(localStorage.getItem('cv') || '');
    setJobDescription(localStorage.getItem('jobDescription') || '');

    const storedFile = localStorage.getItem('uploadedFile');
    if (storedFile) {
      setFileName(JSON.parse(storedFile).name);
    }

    if (navigator.platform.startsWith('Mac')) setMod('Cmd');
    const storedKey = localStorage.getItem('anthropicKey');
    if (storedKey) {
      apiKeyRef.current = storedKey;
      setApiKey(storedKey);
    }
  }, [
    setBase64Data, 
    setScreenshotPrompt,
    setAudioCapturePrompt,
    setFileName,
    setCapturingAudio,
  ]);


  // persist outputs too (screenshot may exceed the localStorage quota, hence the try)
  useEffect(() => {
    try {
      localStorage.setItem('transcript', transcript);
      localStorage.setItem('screenshot', base64Data);
    } catch {}
  }, [transcript, base64Data]);

  // answers + loader live in the floating answer window (via main)
  const setResponse = (text: string) => window.ipc.send('new-answer', text);
  useEffect(() => window.ipc.send('status', status), [status]);

  const startCapture = async () => {
    if (mediaRecorderRef.current) return;
    try {
      console.log('Starting audio capture');
      const [sys, mic] = await Promise.all([getSystemAudio(), getMic()]);
      mediaRecorderRef.current = { interviewer: recordWav(sys), me: recordWav(mic) };
      setCapturingAudio(true);
    } catch (error) {
      console.error('Error capturing audio:', error);
    }
  };

  const stopCapture = async () => {
    const rec = mediaRecorderRef.current;
    if (!rec) return;
    mediaRecorderRef.current = null;
    setCapturingAudio(false);
    setStatus('Transcribing audio…');
    try {
      const [sys, mic] = await Promise.all([rec.interviewer(), rec.me()]);
      const [theirs, mine] = await Promise.all([
        window.ipc.invoke('transcribe', sys),
        window.ipc.invoke('transcribe', mic),
      ]);
      const text = `Interviewer: ${theirs}\n\nMe: ${mine}`;
      setTranscript(text);
      await aiForAudioCapture(text);
    } catch (error) {
      console.error('Error transcribing audio:', error);
      setResponse(`Error: ${error}`);
    } finally {
      setStatus('');
    }
  };

  const saveScreenshotPrompt = (value: string) => {
    setScreenshotPrompt(value);
    localStorage.setItem('screenshotPrompt', value);
  }

  const saveAudioCapturePrompt = (value: string) => {
    setAudioCapturePrompt(value);
    localStorage.setItem('audioCapturePrompt', value);
  }

  const saveCv = (value: string) => {
    setCv(value);
    localStorage.setItem('cv', value);
  }

  const saveJobDescription = (value: string) => {
    setJobDescription(value);
    localStorage.setItem('jobDescription', value);
  }

  const saveExtraContext = (value: string) => {
    setExtraContext(value);
    localStorage.setItem('extraContext', value);
  }

  const saveApiKey = (value: string) => {
    apiKeyRef.current = value;
    setApiKey(value);
    localStorage.setItem('anthropicKey', value);
  }

  const handleButtonClick = () => {
    fileInputRef.current.click();
  };

  const handleFileChange = async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    setStatus('Parsing CV…');
    try {
      saveCv(await window.ipc.invoke('parse-cv', { name: file.name, data: await file.arrayBuffer() }));
      setFileName(file.name);
      localStorage.setItem('uploadedFile', JSON.stringify({ name: file.name }));
    } catch (error) {
      setFileName(`failed to parse ${file.name}: ${error}`);
    } finally {
      setStatus('');
      event.target.value = ''; // allow re-selecting the same file
    }
  };

  const askClaude = async (prompt: string, content: any) => {
    setStatus('Asking Claude…');
    const { cv, jd, extra } = promptsRef.current;
    const system = [
      prompt,
      cv.trim() && `<my_cv>\n${cv.trim()}\n</my_cv>`,
      jd.trim() && `<job_description>\n${jd.trim()}\n</job_description>`,
      extra.trim() && `<additional_context>\n${extra.trim()}\n</additional_context>`,
      (cv.trim() || jd.trim() || extra.trim()) && 'Tailor answers to my background, the role and any additional context above; do not invent experience that is not in my CV.',
    ].filter(Boolean).join('\n\n');
    try {
      setResponse(await window.ipc.invoke('ask-claude', { apiKey: apiKeyRef.current, system, content }));
    } catch (error) {
      setResponse(`Error: ${error}`);
    } finally {
      setStatus('');
    }
  };

  promptsRef.current = { screenshot: screenshotPrompt, audio: audioCapturePrompt, cv, jd: jobDescription, extra: extraContext };

  const aiForScreenshots = (image: string) =>
    askClaude(promptsRef.current.screenshot, [
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: image } },
    ]);

  const aiForAudioCapture = (transcript: string) => askClaude(promptsRef.current.audio, transcript);

  return (
    <React.Fragment>
      <Head>
        <title>ainterview</title>
      </Head>
      <main className='cursor-default grid grid-cols-2 gap-4 text-2xl w-full h-dvh text-center'>
        <div className="flex flex-col justify-items-center">
          <div className="flex flex-row">
            <input type="text" 
              className="w-full p-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-4 focus:ring-blue-300 focus:ring-blue-800 border-gray-700 bg-gray-800 cursor-default"
              placeholder="Enter Anthropic API Key"
              value={apiKey}
              onChange={(e) => saveApiKey(e.target.value)}
              />
          </div>
          <div className="flex flex-row">
            {/* Hidden file input */}
            <input
              type="file"
              ref={fileInputRef}
              accept=".pdf,.docx,.txt,.md"
              style={{ display: 'none' }}
              onChange={handleFileChange}
            />
            {/* Custom button to trigger file input */}
            <button onClick={handleButtonClick} type="button" className="text-white bg-blue-700 hover:bg-blue-800 focus:ring-4 focus:ring-blue-300 font-medium rounded-lg text-sm px-5 py-2.5 me-2 mb-2 bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-blue-800 cursor-default" >
              Upload CV (.pdf, .docx)
            </button>
            {fileName && <p>CV loaded from: {fileName}</p>}
          </div>

          <p title="Global shortcut">Press {mod}+Shift+9 (or F9) to take a screenshot</p>
          <h2>Screenshot:</h2>
          {base64Data && (
            <Image
              className="ml-auto mr-auto"
              src={`data:image/png;base64,${base64Data}`}
              alt="Logo image"
              width={500}
              height={500}
            />
          ) || (
              <p className="h-[210px]">No screenshot taken</p>
            )}
          <h2>My CV:</h2>
          <textarea className="w-full h-40 p-2 border border-gray-700 rounded-lg focus:outline-none focus:ring-4 focus:ring-blue-800 bg-gray-800 cursor-default" placeholder="Paste your CV here" value={cv} onChange={(e) => saveCv(e.target.value)} />
          <h2>Job Description:</h2>
          <textarea className="w-full h-40 p-2 border border-gray-700 rounded-lg focus:outline-none focus:ring-4 focus:ring-blue-800 bg-gray-800 cursor-default" placeholder="Paste the job description here" value={jobDescription} onChange={(e) => saveJobDescription(e.target.value)} />
          <h2>Additional Position Context:</h2>
          <textarea className="w-full h-40 p-2 border border-gray-700 rounded-lg focus:outline-none focus:ring-4 focus:ring-blue-800 bg-gray-800 cursor-default" placeholder="Company, team, tech stack, interviewer names, interview stage, things to emphasize…" value={extraContext} onChange={(e) => saveExtraContext(e.target.value)} />
          <h2>Screenshot Prompt:</h2>
          <textarea className="w-full h-64 p-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-4 focus:ring-blue-300 focus:ring-blue-800 border-gray-700 bg-gray-800 cursor-default" placeholder="Enter prompt here" value={screenshotPrompt} onChange={(e) => saveScreenshotPrompt(e.target.value)} />
          <h2>Audio Capture</h2>
          <div className="flex flex-row mx-auto mt-2">
            <button title={`${mod}+Shift+7 (or F7)`} onClick={startCapture} disabled={capturingAudio} type="button" className="text-white bg-blue-700 hover:bg-blue-800 focus:ring-4 focus:ring-blue-300 font-medium rounded-lg text-sm px-5 py-2.5 me-2 mb-2 bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-blue-800 cursor-default disabled:bg-gray-700">
              Start Audio Capture
            </button>
            <button title={`${mod}+Shift+8 (or F8)`} onClick={stopCapture} disabled={!capturingAudio} type="button" className="text-white bg-red-700 hover:bg-red-800 focus:ring-4 focus:ring-red-300 font-medium rounded-lg text-sm px-5 py-2.5 me-2 mb-2 bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-red-800 cursor-default disabled:bg-gray-700">
              Stop Audio Capture
            </button>
          </div>
          <h2>Transcription:</h2>
          <textarea className="w-full h-32 p-2 border border-gray-700 rounded-lg bg-gray-800 cursor-default" placeholder="Transcription appears here" readOnly value={transcript} />
          <h2>Audio Capture Prompt:</h2>
          <textarea className="w-full h-64 p-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-4 focus:ring-blue-300 focus:ring-blue-800 border-gray-700 bg-gray-800 cursor-default" placeholder="Enter prompt here" value={audioCapturePrompt} onChange={(e) => saveAudioCapturePrompt(e.target.value)} />
        </div>

        <div className="w-full h-dvh relative">
          {status && (
            <div className="absolute top-2 right-2 z-10 flex items-center gap-2 rounded-lg bg-gray-900/90 px-3 py-1 text-sm text-white">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-gray-500 border-t-white" />
              {status}
            </div>
          )}
          <p className="p-4">Answers appear in the floating answer window.</p>
          <button onClick={() => window.ipc.send('show-answer-window', null)} type="button" className="text-white bg-blue-600 hover:bg-blue-700 font-medium rounded-lg text-sm px-5 py-2.5 cursor-default">
            Show answer window
          </button>
        </div>
      </main>
    </React.Fragment>
  )
}
