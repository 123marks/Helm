import React from 'react'
import logoUrl from '@renderer/assets/logo.png'

/**
 * The app brand mark. Generated from build/logo-source.png by
 * `npm run make:logo`, which emits both the packaged window icon
 * (build/icon.png) and this renderer asset so the two never drift apart.
 */
export function Logo({
  size = 36,
  className
}: {
  size?: number
  className?: string
}): React.JSX.Element {
  return (
    <img
      src={logoUrl}
      width={size}
      height={size}
      className={className}
      alt="Helm"
      draggable={false}
    />
  )
}
