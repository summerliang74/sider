export default [{
  files: ['**/*.js', '**/*.mjs'],
  languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
  rules: {
    'constructor-super': 'error',
    'no-dupe-args': 'error',
    'no-dupe-class-members': 'error',
    'no-dupe-keys': 'error',
    'no-duplicate-case': 'error',
    'no-duplicate-imports': 'error',
    'no-unreachable': 'error',
    'valid-typeof': 'error',
  },
}];
