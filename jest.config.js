/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',

  // Which test files to run
  testMatch: ['**/tests/**/*.test.ts', '**/tests/**/*.e2e.test.ts'],

  // Silence noisy console output in tests unless DEBUG=1
  silent: process.env.DEBUG !== '1',

  // Timeout — E2E tests can take longer
  testTimeout: 15_000,

  // Coverage configuration
  collectCoverage: false, // Only collect when explicitly requested (npm test:coverage or CI)
  coverageDirectory: 'coverage',
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/server.ts',         // Bootstrap entry point — tested via integration
    '!src/app.ts',            // Express app setup — tested via E2E
    '!src/**/*.d.ts',
    '!src/types/**',          // Pure type definitions — nothing to test
    '!src/config/database.ts', // DB init — requires real DB
  ],
  coverageReporters: ['text-summary', 'lcov', 'html'],
  coverageThreshold: {
    global: {
      branches: 40,
      functions: 30,
      lines: 45,
      statements: 45,
    },
  },

  // Module path aliases (if any tsconfig paths exist)
  moduleNameMapper: {},

  // ts-jest options
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      tsconfig: 'tsconfig.json',
      diagnostics: false, // Don't fail on TS errors in tests (lint catches those)
    }],
  },
};
