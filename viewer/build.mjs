#!/usr/bin/env node

import esbuild from 'esbuild';
import { replace } from 'esbuild-plugin-replace';
import { readFileSync } from 'fs';

await esbuild.build({
    entryPoints: ['index.ts'],
    bundle: true,
    minify: false,
    outfile: 'index.js',
    format: 'iife',
    sourcemap: 'linked',
    plugins: [
        replace({
            '_$VERSION$_': readFileSync('../version').toString().trim(),
        }),
    ],
});
