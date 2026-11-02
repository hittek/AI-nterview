import { IpcHandler } from '../main/preload'

declare global {
  interface Window {
    ipc: IpcHandler
    electronAPI: {
      enableLoopbackAudio(): Promise<void>
      disableLoopbackAudio(): Promise<void>
    }
  }
}
