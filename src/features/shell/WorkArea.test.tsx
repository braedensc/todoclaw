import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { WorkArea } from './WorkArea'
import type { QuadrantFocus } from './use-quadrant-focus'
import type { ChatController } from '../ai/use-chat-controller'

// WorkArea's one job under test: pick the right work surface for (isMobile, isCoarse, gridOnly).
// Every surface is stubbed — this is a routing test, not a render test — so a branch reorder
// (e.g. moving the isMobile early-return above the gridOnly check, the exact bug that made
// grid-only a silent no-op on phones pre-touch-grid) fails loudly.
const mockIsMobile = vi.fn(() => false)
const mockIsCoarse = vi.fn(() => false)
vi.mock('../../hooks/use-is-mobile', () => ({ useIsMobile: () => mockIsMobile() }))
vi.mock('../../hooks/use-is-coarse-pointer', () => ({
  useIsCoarsePointer: () => mockIsCoarse(),
}))
vi.mock('../grid/use-grid', () => ({ useGrid: () => ({}) }))
vi.mock('../grid/GridSurface', () => ({
  GridSurface: ({ gridOnly }: { gridOnly: boolean }) => (
    <div data-testid={gridOnly ? 'stub-grid-only' : 'stub-grid-inline'} />
  ),
}))
vi.mock('../grid/TouchGridSurface', () => ({
  TouchGridSurface: () => <div data-testid="stub-touch-grid" />,
}))
vi.mock('./MobileMatrix', () => ({ MobileMatrix: () => <div data-testid="stub-matrix" /> }))
vi.mock('./TaskInputWidget', () => ({ TaskInputWidget: () => <div data-testid="stub-input" /> }))
vi.mock('../list/ListView', () => ({ ListView: () => <div data-testid="stub-list" /> }))

const focusStub: QuadrantFocus = {
  focus: null,
  enter: () => {},
  switchTo: () => {},
  exit: () => {},
  clear: () => {},
}

function renderWorkArea(gridOnly: boolean) {
  return render(
    <WorkArea
      chat={{} as ChatController}
      onOpenChat={() => {}}
      gridOnly={gridOnly}
      onExitGridOnly={() => {}}
      quadrantFocus={focusStub}
    />,
  )
}

beforeEach(() => {
  mockIsMobile.mockReturnValue(false)
  mockIsCoarse.mockReturnValue(false)
})

describe('WorkArea surface selection', () => {
  it('desktop fine-pointer: inline grid normally, the desktop overlay in grid-only', () => {
    renderWorkArea(false)
    expect(screen.getByTestId('stub-grid-inline')).toBeInTheDocument()
  })

  it('desktop fine-pointer grid-only: the desktop fullscreen overlay', () => {
    renderWorkArea(true)
    expect(screen.getByTestId('stub-grid-only')).toBeInTheDocument()
    expect(screen.queryByTestId('stub-touch-grid')).toBeNull()
  })

  it('mobile: MobileMatrix normally (ADR-0028 — no inline grid)', () => {
    mockIsMobile.mockReturnValue(true)
    renderWorkArea(false)
    expect(screen.getByTestId('stub-matrix')).toBeInTheDocument()
    expect(screen.queryByTestId('stub-grid-inline')).toBeNull()
  })

  it('mobile grid-only: the TOUCH grid — the gridOnly branch must beat the MobileMatrix return', () => {
    mockIsMobile.mockReturnValue(true)
    renderWorkArea(true)
    expect(screen.getByTestId('stub-touch-grid')).toBeInTheDocument()
    expect(screen.queryByTestId('stub-matrix')).toBeNull()
  })

  it('coarse pointer at desktop width (iPad / landscape phone) grid-only: the touch grid', () => {
    mockIsCoarse.mockReturnValue(true)
    renderWorkArea(true)
    expect(screen.getByTestId('stub-touch-grid')).toBeInTheDocument()
    expect(screen.queryByTestId('stub-grid-only')).toBeNull()
  })

  it('coarse pointer at desktop width WITHOUT grid-only: the normal desktop layout', () => {
    mockIsCoarse.mockReturnValue(true)
    renderWorkArea(false)
    expect(screen.getByTestId('stub-grid-inline')).toBeInTheDocument()
  })
})
