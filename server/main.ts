#!/usr/bin/env node

import '@total-typescript/ts-reset/filter-boolean';
import readline from 'readline';
import { inspect } from 'util';
import { broadcast, fromClients, getViewers, kick, notify, startServer, stopServer, unicast } from './trpc';

const epsilon = 0.1;

async function main() {
    startServer();

    let cli = readline.createInterface(process.stdin, process.stdout);

    let cmds = [ ...commands.keys() ];

    while (true) {
        let [ cmd, ...args ] = (await new Promise<string>(resolve => cli.question('$ ', resolve))).trim().split(/ +/g);
        if (!cmd) continue;

        let matching = cmds.filter(x => x.startsWith(cmd));

        if (matching.length === 0) {
            cli.write(`No such command as "${cmd}" exists.\n`);
            continue;
        }

        if (matching.length > 1) {
            cli.write(`Ambiguous command could match any of ${matching.map(x => `"${x}"`).join(', ')}\n`);
            continue;
        }

        cmd = matching[0];

        // Do the command
        commands.get(cmd)?.(cli, ...args);
    }
}

const commands = new Map<string, (cli: readline.Interface, ...args: (string | undefined)[]) => void>([
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

function printHelp(cli: readline.Interface) {
    for (let [cmd, info] of helpInfo) {
        cli.write(`${cmd}: ${info}\n`);
    }
}

function printStatus(cli: readline.Interface) {
    const n = getViewers().length;
    cli.write(`There ${n === 1 ? 'is' : 'are'} ${n} ${n === 1 ? 'viewer' : 'viewers'} connected.\n`);
    cli.write(`Status: ${inspect(state)}\n`);
    cli.write(`Viewers: ${inspect(getViewers())}\n`);
    cli.write(`ReadyWhens: ${inspect(readyWhens)}\n`);
}

function cliPlay(cli: readline.Interface) {
    const stateRef = state;
    if (stateRef.mode === 'playing') {
        cli.write(`Already playing\n`);
        return;
    }

    playIfPossible();
    if (state.mode === 'playing') {
        cli.write(`Now playing.\n`);
    }
    else {
        cli.write(`Can't play right now\n`);
    }
}

function cliPause(cli: readline.Interface, whenStr?: string) {
    if (typeof whenStr !== 'string') {
        if (state.mode === 'playing') {
            cli.write(`Instructing viewers to pause\n`);
            pauseAndReportWhen();
        }
        else {
            cli.write(`Can't pause right now\n`);
        }
    }
    else {
        const when = +whenStr;
        cli.write(`Pausing at ${when}\n`);
        pauseAt(when);
    }
}

function cliSay(_cli: readline.Interface, ...words: (string | undefined)[]) {
    notify(words.filter(Boolean).join(' '));
}

function cliRewind(cli: readline.Interface, secondsStr?: string) {
    if (!secondsStr) {
        cli.write(`You must provide a number of seconds to rewind.\n`);
        return;
    }

    const seconds = +secondsStr;

    if (isNaN(seconds)) {
        cli.write(`Invalid number given.\n`);
        return;
    }

    switch (state.mode) {
        case 'paused':
        case 'waitingForReady':
            const newWhen = state.when - seconds;
            cli.write(`Rewinding to ${newWhen}\n`);
            pauseAt(newWhen);
            break;

        case 'init':
        case 'waitingForWhenReports':
        case 'playing':
            cli.write(`Cannot rewind from state = ${state.mode}\n`);
            break;

        default:
            return assertNever(state);
    }
}

function cliKick(cli: readline.Interface, ...who: (undefined | string)[]) {
    if (who.length === 1 && who[0] === 'everyone') {
        kick('everyone')
        cli.write(`Kicked everyone.\n`);
        return;
    }

    const ids = who.filter(Boolean);
    if (ids.length > 0) {
        kick(ids);
        cli.write(`Kicked ${ids.join(', ')}\n`);
    }
}

function quit() {
    stopServer();
    process.exit(0);
}

const readyWhens = new Map<string, number | null>();

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
    inSync: string[];
    whenReports: Map<string, number>;
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

fromClients.on('join', (ctx, reconnecting) => {
    readyWhens.set(ctx.id, null);

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

    notify(`Welcome to the party, ${ctx.name}! We are up to ${getViewers().length} viewers.`);
});

fromClients.on('leave', ({ id, name }) => {
    readyWhens.delete(id);

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

    notify(`${name ?? 'Somebody'} left, down to ${getViewers().length} viewers.`);
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
    for (const id of currentState.inSync) {
        if (currentState.whenReports.get(id) == null) {
            return;
        }
    }

    const consensus = Math.min(...currentState.inSync.map(id =>
        currentState.whenReports.get(id) ?? Infinity
    ));

    state = {
        mode: 'paused',
        when: consensus,
    };
    broadcast({ whatdo: 'pause', when: consensus });
}

fromClients.on('play', () => {
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

fromClients.on('pause', when => {
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

fromClients.on('reportReady', ({ id }, when) => {
    readyWhens.set(id, when);

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

fromClients.on('reportWhen', ({ id }, when) => {
    switch (state.mode) {
        case 'waitingForWhenReports':
            state.whenReports.set(id, when);
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
