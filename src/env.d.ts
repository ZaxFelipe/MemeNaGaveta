/// <reference types="vite/client" />
import type { MemeApi } from '@shared/types'

declare global {
  interface Window {
    api: MemeApi
  }
}
