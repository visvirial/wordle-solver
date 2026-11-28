import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
	root: __dirname,
	base: './',
	server: { fs: { allow: [path.resolve(__dirname, '..')] } },
	build: { outDir: path.resolve(__dirname, '..', 'dist'), emptyOutDir: true },
	worker: { format: 'es' },
	test: { root: __dirname, include: ['src/**/*.test.ts'] },
});
