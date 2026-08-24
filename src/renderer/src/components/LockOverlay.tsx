import React, { useEffect, useState } from 'react'
import { LockKeyhole } from 'lucide-react'
import { useLockStore } from '@renderer/store/lock'
import { Logo } from '@renderer/components/Logo'
import { Button } from '@renderer/components/ui/button'
import { Input } from '@renderer/components/ui/input'

/** Full-screen gate shown when the app is locked; verifies the PIN to reveal the vault. */
export function LockOverlay(): React.JSX.Element | null {
  const enabled = useLockStore((s) => s.enabled)
  const locked = useLockStore((s) => s.locked)
  const unlock = useLockStore((s) => s.unlock)
  const [pin, setPin] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (enabled && locked) {
      setPin('')
      setError('')
    }
  }, [enabled, locked])

  if (!enabled || !locked) return null

  const submit = async (): Promise<void> => {
    if (!pin) return
    setBusy(true)
    const ok = await unlock(pin)
    setBusy(false)
    if (!ok) {
      setError('PIN 不正确')
      setPin('')
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/95 backdrop-blur-xl">
      <div className="w-80 rounded-2xl border bg-card p-6 shadow-2xl">
        <div className="mb-4 flex flex-col items-center gap-2 text-center">
          <Logo size={44} className="rounded-xl shadow-lg shadow-primary/30" />
          <div className="mt-1 flex items-center gap-1.5 text-base font-semibold">
            <LockKeyhole className="h-4 w-4 text-primary" /> 已锁定
          </div>
          <p className="text-xs text-muted-foreground">输入 PIN 解锁 Helm</p>
        </div>
        <Input
          type="password"
          autoFocus
          aria-label="PIN"
          value={pin}
          onChange={(e) => {
            setPin(e.target.value)
            setError('')
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit()
          }}
          placeholder="PIN"
          className="text-center font-mono tracking-[0.3em]"
        />
        {error && <p className="mt-2 text-center text-xs text-destructive">{error}</p>}
        <Button className="mt-4 w-full" onClick={() => void submit()} disabled={busy || !pin}>
          {busy ? '验证中…' : '解锁'}
        </Button>
      </div>
    </div>
  )
}
