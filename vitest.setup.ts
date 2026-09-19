import '@testing-library/jest-dom/vitest';

// Tests must never reach a real analytics sink, and must not depend on
// whatever .env.local a developer happens to have.
process.env.NEXT_PUBLIC_ANALYTICS_PROVIDER = 'noop';
process.env.NEXT_PUBLIC_SITE_URL = 'http://localhost:3000';
process.env.APP_ENV = 'local';
