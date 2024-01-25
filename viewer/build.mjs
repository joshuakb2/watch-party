#!/usr/bin/env node

import esbuild from 'esbuild';
import { solidPlugin } from 'esbuild-plugin-solid';
import { replace } from 'esbuild-plugin-replace';
import { readFileSync } from 'fs';

await esbuild.build({
    entryPoints: ['index.tsx'],
    bundle: true,
    minify: false,
    outfile: 'index.js',
    format: 'iife',
    sourcemap: 'linked',
    jsx: 'automatic',
    plugins: [
        solidPlugin(),
        replace({
            '_$VERSION$_': readFileSync('../version').toString().trim(),
        }),
    ],
});
