import {defineConfig} from 'vitest/config';

export default defineConfig({
    test: {
        name: 'unit',
        environment: 'node',
        typecheck: {
            enabled: true,
            include: [
                'src/**/*.test.ts',
            ],
        },
        include: [
            'src/**/*.test.{ts,js}'
        ],
        coverage: {
            provider: 'v8',
            reporter: ['json', 'html'],
            exclude: ['node_modules/', 'dist/', '**/*.test.ts'],
            all: true,
            include: ['src'],
            reportsDirectory: './coverage/vitest/unit',
        },
    },
}); 