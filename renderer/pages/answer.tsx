import React, { useEffect, useState } from 'react'
import Head from 'next/head'

export default function AnswerPage() {
  const [list, setList] = useState<string[]>([])
  const [idx, setIdx] = useState(0)
  const [status, setStatus] = useState('')

  const nav = (d: number) => setIdx((i) => Math.max(0, Math.min(list.length - 1, i + d)))

  useEffect(() => {
    const show = (l: string[]) => { setList(l); setIdx(l.length - 1) } // new answer => jump to latest
    window.ipc.invoke('get-answers').then((l) => show(l as string[]))
    const offs = [
      window.ipc.on('answers', (l) => show(l as string[])),
      window.ipc.on('status', (s) => setStatus(s as string)),
    ]
    return () => offs.forEach((off) => off())
  }, [])

  // arrows + global Cmd/Ctrl+Shift+Left/Right (from main)
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'ArrowLeft' ? nav(-1) : e.key === 'ArrowRight' && nav(1)
    window.addEventListener('keydown', key)
    const off = window.ipc.on('nav', (d) => nav(d as number))
    return () => { window.removeEventListener('keydown', key); off() }
  }, [list.length])

  const btn = 'px-3 py-1 rounded bg-gray-700 hover:bg-gray-600 disabled:opacity-30 cursor-default'
  return (
    <div className="flex flex-col h-dvh bg-gray-900 text-white">
      <Head><title>answer</title></Head>
      <div className="flex items-center gap-2 p-2 border-b border-gray-700 text-sm">
        <button className={btn} disabled={idx <= 0} onClick={() => nav(-1)}>←</button>
        <span>{list.length ? `${idx + 1} / ${list.length}` : 'No answers yet'}</span>
        <button className={btn} disabled={idx >= list.length - 1} onClick={() => nav(1)}>→</button>
        <button className={btn} disabled={idx >= list.length - 1} onClick={() => setIdx(list.length - 1)}>Latest</button>
        {status && (
          <span className="ml-auto flex items-center gap-2">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-gray-500 border-t-white" />
            {status}
          </span>
        )}
      </div>
      <div className="flex-1 overflow-y-auto p-3 whitespace-pre-wrap" key={idx}>{list[idx]}</div>
    </div>
  )
}
