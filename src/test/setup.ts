// Vitest setup: register jest-dom matchers (also augments vitest's `expect` types) and
// unmount React trees after each test so component tests don't leak into one another.
import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

afterEach(() => {
  cleanup()
})
