import { useEffect, useState } from 'react'
import { Maximize2, Minimize2, Minus, X } from 'lucide-react'

/** Botões de janela no estilo macOS (fechar, minimizar, maximizar). */
export function TrafficLights() {
  const [maximized, setMaximized] = useState(false)
  useEffect(() => window.api.window.onMaximizedChange(setMaximized), [])

  const base =
    'flex size-3 items-center justify-center rounded-full shadow-[inset_0_0_0_0.5px_rgba(0,0,0,0.18)]'
  const icon = 'size-2 opacity-0 transition-opacity group-hover:opacity-100 text-black/60'

  return (
    <div className="group flex items-center gap-2 px-1">
      <button aria-label="Fechar" className={`${base} bg-[#ff5f57]`} onClick={() => window.api.window.close()}>
        <X className={icon} strokeWidth={3} />
      </button>
      <button aria-label="Minimizar" className={`${base} bg-[#febc2e]`} onClick={() => window.api.window.minimize()}>
        <Minus className={icon} strokeWidth={3} />
      </button>
      <button
        aria-label={maximized ? 'Restaurar' : 'Maximizar'}
        className={`${base} bg-[#28c840]`}
        onClick={() => window.api.window.toggleMaximize()}
      >
        {maximized ? <Minimize2 className={icon} strokeWidth={3} /> : <Maximize2 className={icon} strokeWidth={3} />}
      </button>
    </div>
  )
}
