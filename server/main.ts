#!/usr/bin/env node

import readline from 'readline';
import { inspect } from 'util';
import { broadcast, fromClients, getViewers, startServer, unicast } from './trpc';

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
    ['exit', quit],
    ['quit', quit],
]);

const helpInfo = new Map([
    ['help', 'Display this help message'],
    ['play', 'Start playing video'],
    ['pause [when]', 'Pause the video and optionally seeks to the specified number of seconds'],
    ['status', 'Show how many viewers are connected.'],
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

function quit() {
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

fromClients.on('connect', id => {
    switch (state.mode) {
        case 'init':
            break;

        case 'paused':
            console.log(`${id} has connected, we are paused at ${state.when}`);
            unicast(id, { whatdo: 'pause', when: state.when });
            state = {
                mode: 'waitingForReady',
                when: state.when,
            };
            break;

        case 'waitingForReady':
            unicast(id, { whatdo: 'pause', when: state.when });
            break;

        case 'waitingForWhenReports':
            unicast(id, { whatdo: 'pause', when: 0 });
            break;

        case 'playing':
            pauseAndReportWhen();
            break;

        default:
            return assertNever(state);
    }

    readyWhens.set(id, null);
});

function pauseAndReportWhen() {
    broadcast({ whatdo: 'pauseAndReportWhen' });
    state = {
        mode: 'waitingForWhenReports',
        inSync: [...readyWhens.keys()],
        whenReports: new Map(),
    };
}

fromClients.on('announce', (_id, reconnecting) => {
    switch (state.mode) {
        case 'init':
            state = {
                mode: 'paused',
                when: reconnecting?.when ?? 0,
            };
            broadcast({ whatdo: 'pause', when: reconnecting?.when ?? 0 });
            break;

        case 'paused':
        case 'waitingForReady':
        case 'waitingForWhenReports':
        case 'playing':
            break;

        default:
            return assertNever(state);
    }
});

fromClients.on('disconnect', id => {
    readyWhens.delete(id);

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

fromClients.on('reportReady', (id, when) => {
    readyWhens.set(id, when);

    switch (state.mode) {
        case 'paused':
            if (Math.abs(when - state.when) > epsilon) {
                state = { mode: 'waitingForReady', when };
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

fromClients.on('reportWhen', (id, when) => {
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
