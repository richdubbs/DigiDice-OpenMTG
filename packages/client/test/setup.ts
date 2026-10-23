/** Client test setup (jsdom): unmount rendered trees after each test (Vitest runs without globals, so Testing Library cannot do it by itself). */
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});
