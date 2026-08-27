import antfu from '@antfu/eslint-config'

export default antfu({
  vue: true,
  typescript: true,
  ignores: [
    '.nuxt/**',
    '.output/**',
    'dist/**',
    'public/**',
    'node_modules/**',
  ],
  rules: {
    'node/prefer-global/process': 'off',
    'node/prefer-global/buffer': 'off',
    'no-console': 'off',
    'style/max-statements-per-line': 'off',
    'regexp/no-obscure-range': 'off',
    'unused-imports/no-unused-vars': 'warn',
    'vue/custom-event-name-casing': 'off',
    'no-throw-literal': 'off',
    'vue/no-template-shadow': 'off',
    'vue/one-component-per-file': 'off',
    'vue/prop-name-casing': 'off',
    'vue/attribute-hyphenation': 'off',
    'no-alert': 'off',
    'no-irregular-whitespace': 'off',
  },
})
