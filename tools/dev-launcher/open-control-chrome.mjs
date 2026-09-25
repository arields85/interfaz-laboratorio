#!/usr/bin/env node
// tools/dev-launcher/open-control-chrome.mjs -- opens ONLY the dedicated CONTROL Chrome on the
// HMI URL, for when the dev server is already running elsewhere (so CoreAnalytics.cmd's own
// `npm run dev` orchestration is not needed). See README.md in this folder.
//
// Imports createBrowserOpener straight from hmi-app/scripts/dev.mjs instead of reimplementing the
// control-Chrome argument list here, so this tool and the dev server's own readiness-triggered
// open (hmi-app/scripts/dev.mjs) can never drift apart.
import { createBrowserOpener } from '../../hmi-app/scripts/dev.mjs'

const DEFAULT_HOST = '127.0.0.1'
const DEFAULT_PORT = '5173'

const host = process.env.PRISMA_DEV_HOST || DEFAULT_HOST
const port = process.argv[2] || process.env.PRISMA_DEV_PORT || DEFAULT_PORT
const url = `http://${host}:${port}/`

createBrowserOpener().open(url)
