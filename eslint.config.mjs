import js from '@eslint/js'

export default [
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: {
        require: 'readonly',
        module: 'writable',
        exports: 'writable',
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        describe: 'readonly',
        it: 'readonly',
        before: 'readonly',
        after: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
      },
    },
    rules: {
      semi: ['error', 'never'],
      quotes: ['error', 'single'],
      indent: ['error', 2],
      'no-var': 'error',
      'space-before-function-paren': ['error', 'always'],
      'comma-dangle': ['error', 'always-multiline'],
      'max-len': [
        'error',
        {
          code: 120,
          ignoreUrls: true,
          ignoreComments: true,
        },
      ],
    },
  },
  {
    // Tests are formatted with the same style rules as lib/** (the block
    // above): ESLint fixes them on save. Only rules WITHOUT an auto-fixer
    // stay off: no-var (legacy var usage across the test suite) and max-len
    // (long string literals cannot be auto-wrapped). Correctness rules
    // (no-undef, no-unused-vars) stay active.
    files: ['tests/**/*.js'],
    rules: {
      'no-var': 'off',
      'max-len': 'off',
      // Kept active (a new unused identifier still fails), but tolerant of the
      // handful of legacy declarations these files already carry.
      'no-unused-vars': [
        'error',
        {
          varsIgnorePattern: '^(listener|events|Events|data)$',
          argsIgnorePattern: '^message$',
        },
      ],
    },
  },
]
