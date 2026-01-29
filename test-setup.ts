/**
 * Test setup file for Bun tests.
 * Mocks Vite-specific imports and browser-only modules that don't work in Node/Bun.
 */

import { mock } from 'bun:test'

// Mock Vite's ?url imports that return file URLs instead of module contents.
// These work in Vite but fail in Bun's test runner because Bun tries to
// import them as regular ES modules.
mock.module('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({
  default: 'mock-pdf-worker-url',
}))

// Mock pdfjs-dist - it requires browser APIs like DOMMatrix that aren't available in Bun
mock.module('pdfjs-dist', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
}))

// Mock react-pdf - it depends on pdfjs-dist which requires browser APIs
mock.module('react-pdf', () => ({
  Document: () => null,
  Page: () => null,
  pdfjs: { GlobalWorkerOptions: { workerSrc: '' } },
}))

// Mock react-pdf CSS imports
mock.module('react-pdf/dist/Page/AnnotationLayer.css', () => ({}))
mock.module('react-pdf/dist/Page/TextLayer.css', () => ({}))
