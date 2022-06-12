#!/usr/bin/env node

const readline = require('readline');
const { WebSocketServer } = require('ws');

async function main() {
    await startServer();

    // let cli = readline.createInterface(process.stdin, process.stdout);

    // let cmds = [ ...commands.keys() ];

    // while (true) {
    //     let [ cmd, ...args ] = (await new Promise(resolve => cli.question('$ ', resolve))).trim().split(/ +/g);
    //     if (!cmd) continue;

    //     let matching = cmds.filter(x => x.startsWith(cmd));

    //     if (matching.length === 0) {
    //         cli.write(`No such command as "${cmd}" exists.\n`);
    //         continue;
    //     }

    //     if (matching.length > 1) {
    //         cli.write(`Ambiguous command could match any of ${matching.map(x => `"${x}"`).join(', ')}\n`);
    //         continue;
    //     }

    //     cmd = matching[0];

    //     // Do the command
    //     await commands.get(cmd)(cli, ...args);
    // }
}

// const commands = new Map([
//     [ 'help', printHelp ],
//     [ 'status', printStatus ],
//     [ 'exit', quit ],
//     [ 'quit', quit ],
// ]);

// const helpInfo = new Map([
//     [ 'help', 'Display this help message' ],
//     [ 'status', 'Show how many viewers are connected.' ],
//     [ 'exit', 'Stop the server' ],
// ]);

// function printHelp(cli) {
//     for (let [ cmd, info ] of helpInfo) {
//         cli.write(`${cmd}: ${info}\n`);
//     }
// }

// function printStatus(cli) {
//     let n = viewers.size;
//     cli.write(`There ${n === 1 ? 'is' : 'are'} ${n} ${n === 1 ? 'viewer' : 'viewers'} connected.\n`);
// }

// function quit() {
//     process.exit(0);
// }

const viewers = new Set();

/*
type SyncState = {
    playing: boolean;
    startTime: number;
    waitingFor: Set<WebSocket>;
};

type MessageToServer = {
    type: 'play';
} | {
    type: 'pause';
    startTime: number;
} | {
    type: 'ready';
} | {
    type: 'seek';
    startTime: number;
} | {
    type: 'inform-current-time';
    currentTime: number;
};

type MessageFromServer = {
    type: 'wait';
    wait: boolean;
} | {
    type: 'seek';
    startTime: number;
} | {
    type: 'play';
} | {
    type: 'pause';
    startTime: number;
} | {
    type: 'init';
    playing: boolean;
    waiting: boolean;
    startTime: number;
} | {
    type: 'inquire-current-time';
};
*/

let syncState = {
    playing: false,
    startTime: 0,
    waitingFor: new Set()
};

async function startServer() {
    let server = new WebSocketServer({ port: 13579, host: '0.0.0.0' });

    server.on('connection', connection => {
        console.log(`New connection. # of viewers = ${viewers.size + 1}`);

        viewers.add(connection);
        syncState.waitingFor.add(connection);

        if (viewers.size === 1) {
            syncState.startTime = 0;
        }
        else {
            let oneOfThem = [ ...viewers ].find(x => x !== connection);

            oneOfThem.send(JSON.stringify({ type: 'inquire-current-time' }));
        }

        console.log(`Waiting for ${syncState.waitingFor.size} viewers to be ready`);

        if (syncState.waitingFor.size === 1) {
            broadcast({ type: 'wait', wait: true });
        }

        connection.send(JSON.stringify({
            type: 'init',
            playing: syncState.playing,
            waiting: true,
            startTime: syncState.startTime
        }));

        connection.on('close', () => {
            console.log(`Connection closed. # of viewers = ${viewers.size - 1}`);

            viewers.delete(connection);
            syncState.waitingFor.delete(connection);

            console.log(`Waiting for ${syncState.waitingFor.size} viewers to be ready`);

            if (syncState.waitingFor.size === 0) {
                broadcast({ type: 'wait', wait: false });
            }
        });

        connection.on('message', data => {
            let msg = JSON.parse(data.toString());

            console.log(`Received ${JSON.stringify(msg)}`);

            switch (msg.type) {
                case 'play':
                    broadcast({ type: 'play' }, connection);
                    syncState.playing = true;
                    break;
                case 'pause':
                    let newWaitingFor = new Set(viewers);
                    newWaitingFor.delete(connection);

                    console.log(`Waiting for ${newWaitingFor.size} viewers to be ready`);
                    if (newWaitingFor.size > 0) {
                        broadcast({ type: 'wait', wait: true });
                    }
                    broadcast({ type: 'pause', startTime: msg.startTime }, connection);
                    syncState = {
                        playing: false,
                        startTime: msg.startTime,
                        waitingFor: newWaitingFor
                    };
                    break;
                case 'ready':
                    syncState.waitingFor.delete(connection);
                    console.log(`Waiting for ${syncState.waitingFor.size} viewers to be ready`);
                    if (syncState.waitingFor.size === 0) {
                        broadcast({ type: 'wait', wait: false });
                    }
                    break;
                case 'seek':
                    console.log(`Waiting for ${viewers.size} viewers to be ready`);
                    broadcast({ type: 'wait', wait: true });
                    broadcast({ type: 'seek', startTime: msg.startTime }, connection);
                    syncState = {
                        playing: syncState.playing,
                        startTime: msg.startTime,
                        waitingFor: new Set(viewers)
                    };
                    break;

                case 'inform-current-time':
                    console.log(`Found out the current time (${msg.currentTime}), pausing everyone`);
                    syncState.startTime = msg.currentTime;
                    broadcast({ type: 'pause', startTime: msg.currentTime });
                    break;
            }


        });
    });

    await new Promise((resolve, reject) => {
        server.once('listening', () => resolve());
        server.once('error', reject);
    });
}

function broadcast(msgFromServer, excluded) {
    console.log(`Broadcasting ${JSON.stringify(msgFromServer)}` + (excluded ? ' (except the initiator)' : ''));

    for (let viewer of viewers) {
        if (viewer === excluded) continue;
        viewer.send(JSON.stringify(msgFromServer));
    }
}

main().catch(err => {
    console.error(`Unexpected error: ${err}`);
    process.exit(1);
});
