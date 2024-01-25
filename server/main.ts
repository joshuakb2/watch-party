#!/usr/bin/env node

import '@total-typescript/ts-reset/filter-boolean';
import readline from 'readline';
import { inspect } from 'util';
import { startServer, stopServer } from './trpcServer';
import { ViewerContext, broadcast, fromViewers, getViewers, kick, notify, unicast } from './viewerTrpc';
import { installCliCommandHandler } from './controllerTrpc';

const epsilon = 0.1;

async function main() {
    startServer();

    installCliCommandHandler(async input => {
        return await handleCommand(input);
    });

    let cli = readline.createInterface(process.stdin, process.stdout);

    while (true) {
        const nextInput = await new Promise<string>(resolve => cli.question('$ ', resolve));
        const response = await handleCommand(nextInput, cli);
        cli.write(`${response ?? ''}\n`);
    }
}

function splitArgs(input: string) {
    return input.trim().split(/ +/g);
}

async function handleCommand(input: string, cli?: readline.Interface) {
    let [cmd, ...args] = splitArgs(input);
    if (!cmd) return;

    let matching = [...commands].filter(([cmdName, _]) => cmdName.startsWith(cmd));

    if (matching.length > 1) {
        return `Ambiguous command could match any of ${matching.map(x => `"${x}"`).join(', ')}`;
    }

    if (matching.length === 0) {
        return `No such command as "${cmd}" exists.`;
    }

    const f = matching[0][1];

    // Do the command
    return await f(cli, ...args);
}

const commands = new Map<string, (cli?: readline.Interface, ...args: (string | undefined)[]) => Promise<string>>([
    ['help', printHelp],
    ['status', printStatus],
    ['play', cliPlay],
    ['pause', cliPause],
    ['say', cliSay],
    ['rewind <seconds>', cliRewind],
    ['kick', cliKick],
    ['exit', quit],
    ['quit', quit],
]);

const helpInfo = new Map([
    ['help', 'Display this help message'],
    ['play', 'Start playing video'],
    ['pause [when]', 'Pause the video and optionally seeks to the specified number of seconds'],
    ['rewind <when>', 'Rewind the video <when> seconds'],
    ['say [...words]', 'Send a notification to all viewers'],
    ['status', 'Show how many viewers are connected.'],
    ['kick ([...ids] | everyone)', 'Kick one or all viewers'],
    ['exit', 'Stop the server'],
]);

async function printHelp() {
    let response = '';
    for (let [cmd, info] of helpInfo) {
        response += `${cmd}: ${info}\n`;
    }
    return response;
}

async function printStatus() {
    const n = getViewers().length;
    let response = '';
    response += `There ${n === 1 ? 'is' : 'are'} ${n} ${n === 1 ? 'viewer' : 'viewers'} connected.\n`;
    response += `Status: ${inspect(state)}\n`;
    response += `Viewers: ${inspect(getViewers())}\n`;
    response += `ReadyWhens: ${inspect(readyWhens)}\n`;
    return response;
}

async function cliPlay() {
    const stateRef = state;
    if (stateRef.mode === 'playing') {
        return `Already playing\n`;
    }

    playIfPossible();
    if (state.mode === 'playing') {
        return `Now playing.\n`;
    }
    else {
        return `Can't play right now\n`;
    }
}

async function cliPause(_cli?: readline.Interface, whenStr?: string) {
    if (typeof whenStr !== 'string') {
        if (state.mode === 'playing') {
            pauseAndReportWhen();
            return `Instructing viewers to pause\n`;
        }
        else {
            return `Can't pause right now\n`;
        }
    }
    else {
        const when = +whenStr;
        pauseAt(when);
        return `Pausing at ${when}\n`;
    }
}

async function cliSay(_cli?: readline.Interface, ...words: (string | undefined)[]) {
    const message = words.filter(Boolean).join(' ');
    notify(message);
    return `Said "${message}"`;
}

async function cliRewind(_cli?: readline.Interface, secondsStr?: string) {
    if (!secondsStr) {
        return `You must provide a number of seconds to rewind.\n`;
    }

    const seconds = +secondsStr;

    if (isNaN(seconds)) {
        return `Invalid number given.\n`;
    }

    switch (state.mode) {
        case 'paused':
        case 'waitingForReady':
            const newWhen = state.when - seconds;
            pauseAt(newWhen);
            return `Rewinding to ${newWhen}\n`;

        case 'init':
        case 'waitingForWhenReports':
        case 'playing':
            return `Cannot rewind from state = ${state.mode}\n`;

        default:
            return assertNever(state);
    }
}

async function cliKick(_cli?: readline.Interface, ...who: (undefined | string)[]) {
    if (who.length === 1 && who[0] === 'everyone') {
        kick('everyone');
        return `Kicked everyone.\n`;
    }

    const ids = who.filter(Boolean);
    if (ids.length > 0) {
        kick(ids);
        return `Kicked ${ids.join(', ')}\n`;
    }

    return `Didn't kick anybody\n`;
}

async function quit(cli?: readline.Interface) {
    if (!cli) {
        return 'You can\'t stop the server from the controller app\n';
    }

    stopServer();
    process.exit(0);
}

const readyWhens = new Map<ViewerContext, number | null>();

type InitMode = {
    mode: 'init';
};

type PausedState = {
    mode: 'paused';
    when: number;
};

type WaitingForReadyState = {
    mode: 'waitingForReady';
    when: number;
};

type WaitingForWhenReportsState = {
    mode: 'waitingForWhenReports';
    inSync: ViewerContext[];
    whenReports: Map<ViewerContext, number>;
};

type PlayingState = {
    mode: 'playing';
};

type ServerState =
    | InitMode
    | PausedState
    | WaitingForReadyState
    | WaitingForWhenReportsState
    | PlayingState;

let state: ServerState = { mode: 'init' };

function pauseAndReportWhen() {
    broadcast({ whatdo: 'pauseAndReportWhen' });
    state = {
        mode: 'waitingForWhenReports',
        inSync: [...readyWhens.keys()],
        whenReports: new Map(),
    };
}

fromViewers.on('join', (ctx, reconnecting) => {
    switch (state.mode) {
        case 'init':
            state = {
                mode: 'paused',
                when: reconnecting?.when ?? 0,
            };
            broadcast({ whatdo: 'pause', when: reconnecting?.when ?? 0 });
            break;

        case 'paused':
            unicast(ctx, { whatdo: 'pause', when: state.when });
            state = {
                mode: 'waitingForReady',
                when: state.when,
            };
            break;

        case 'waitingForReady':
            unicast(ctx, { whatdo: 'pause', when: state.when });
            break;

        case 'waitingForWhenReports':
            unicast(ctx, { whatdo: 'pause', when: 0 });
            break;

        case 'playing':
            pauseAndReportWhen();
            break;

        default:
            return assertNever(state);
    }

    readyWhens.set(ctx, null);

    notify(`Welcome to the party, ${ctx.name}! We are up to ${getViewers().length} viewers.`);
});

fromViewers.on('leave', ctx => {
    readyWhens.delete(ctx);

    if (getViewers().length === 0) {
        state = { mode: 'init' };
        return;
    }

    switch (state.mode) {
        case 'init':
        case 'paused':
        case 'playing':
            break;

        case 'waitingForReady':
            checkIfAllReady(state);
            break;

        case 'waitingForWhenReports':
            checkWhenReports(state);
            break;

        default:
            return assertNever(state);
    }

    notify(`${ctx.name ?? 'Somebody'} left, down to ${getViewers().length} viewers.`);
});

function checkIfAllReady(currentState: WaitingForReadyState) {
    let allReady = true;

    for (const when of readyWhens.values()) {
        if (when == null || Math.abs(when - currentState.when) > epsilon) {
            allReady = false;
            break;
        }
    }

    if (allReady) {
        state = {
            mode: 'paused',
            when: currentState.when,
        };
    }
}

function checkWhenReports(currentState: WaitingForWhenReportsState) {
    for (const ctx of currentState.inSync) {
        if (currentState.whenReports.get(ctx) == null) {
            return;
        }
    }

    const consensus = Math.min(...currentState.inSync.map(ctx =>
        currentState.whenReports.get(ctx) ?? Infinity
    ));

    state = {
        mode: 'paused',
        when: consensus,
    };
    broadcast({ whatdo: 'pause', when: consensus });
}

fromViewers.on('play', () => {
    playIfPossible();
});

function playIfPossible() {
    switch (state.mode) {
        case 'paused':
            if (getViewers().length === 0) break;

            state = { mode: 'playing' };
            broadcast({ whatdo: 'play' });
            break;

        case 'init':
        case 'waitingForReady':
        case 'waitingForWhenReports':
        case 'playing':
            break;

        default:
            return assertNever(state);
    }
}

fromViewers.on('pause', when => {
    switch (state.mode) {
        case 'init':
        case 'playing':
        case 'paused':
        case 'waitingForReady':
            pauseAt(when);
            break;

        case 'waitingForWhenReports':
            break;

        default:
            return assertNever(state);
    }
});

function pauseAt(when: number) {
    state = { mode: 'waitingForReady', when };
    broadcast({ whatdo: 'pause', when });
}

fromViewers.on('reportReady', (ctx, when) => {
    readyWhens.set(ctx, when);

    switch (state.mode) {
        case 'paused':
            if (Math.abs(when - state.when) > epsilon) {
                state = { mode: 'waitingForReady', when: state.when };
            }
            break;

        case 'waitingForReady':
            checkIfAllReady(state);
            break;

        case 'init':
        case 'waitingForWhenReports':
        case 'playing':
            break;

        default:
            return assertNever(state);
    }
});

fromViewers.on('reportWhen', (ctx, when) => {
    switch (state.mode) {
        case 'waitingForWhenReports':
            state.whenReports.set(ctx, when);
            checkWhenReports(state);
            break;

        case 'init':
        case 'paused':
        case 'waitingForReady':
        case 'playing':
            break;

        default:
            return assertNever(state);
    }
});

function assertNever(never: never): never {
    void never;
    throw new Error('This should never happen');
}

main().catch(err => {
    console.error(`Unexpected error: ${err}`);
    process.exit(1);
});
