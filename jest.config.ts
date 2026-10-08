import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  roots: ['<rootDir>/src', '<rootDir>/config', '<rootDir>/test'],
  testRegex: '.*\\.(spec|e2e-spec)\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': ['ts-jest', {}],
  },
  moduleFileExtensions: ['js', 'json', 'ts'],
  passWithNoTests: true,
  setupFiles: ['<rootDir>/test/jest.setup.ts'],
  collectCoverageFrom: ['src/**/*.(t|j)s', 'config/**/*.(t|j)s'],
  coverageDirectory: '<rootDir>/coverage',
};

export default config;
