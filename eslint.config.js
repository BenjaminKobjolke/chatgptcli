export default [
    {
        files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module'
        },
        rules: {
            'no-unused-vars': 'warn',
            'no-undef': 'off'
        }
    },
    {
        ignores: ['node_modules/**', '.omx/**', 'code_analysis_results/**', 'coverage/**']
    }
];
