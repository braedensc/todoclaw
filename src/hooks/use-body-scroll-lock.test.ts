import { describe, expect, it } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useBodyScrollLock } from './use-body-scroll-lock'

describe('useBodyScrollLock', () => {
  it('locks body scrolling while active and restores the prior overflow on unmount', () => {
    document.body.style.overflow = 'auto'
    const { unmount } = renderHook(() => useBodyScrollLock(true))
    expect(document.body.style.overflow).toBe('hidden')
    unmount()
    expect(document.body.style.overflow).toBe('auto')
    document.body.style.overflow = ''
  })

  it('does nothing while inactive', () => {
    const { unmount } = renderHook(() => useBodyScrollLock(false))
    expect(document.body.style.overflow).toBe('')
    unmount()
  })

  it('holds the lock until the LAST of several concurrent sheets releases', () => {
    const first = renderHook(() => useBodyScrollLock(true))
    const second = renderHook(() => useBodyScrollLock(true))
    expect(document.body.style.overflow).toBe('hidden')
    // Closing one sheet while another is still up must not unlock the page behind it.
    first.unmount()
    expect(document.body.style.overflow).toBe('hidden')
    second.unmount()
    expect(document.body.style.overflow).toBe('')
  })

  it('re-locks when `active` flips from false to true', () => {
    const { rerender, unmount } = renderHook(({ active }) => useBodyScrollLock(active), {
      initialProps: { active: false },
    })
    expect(document.body.style.overflow).toBe('')
    rerender({ active: true })
    expect(document.body.style.overflow).toBe('hidden')
    rerender({ active: false })
    expect(document.body.style.overflow).toBe('')
    unmount()
  })
})
