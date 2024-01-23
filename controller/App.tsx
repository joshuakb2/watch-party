import { Show, createSignal } from "solid-js";
import { trpc } from "./trpc";

export const App = () => {
    const [msgListener, setMsgListener] = createSignal<MsgListener | undefined>();
    const installMessageListener: MsgListenerInstaller = listener => {
        setMsgListener(() => listener);
    };

    return <div style={{
        width: '100%',
        height: '100%',
        display: 'grid',
        'grid-template-columns': '1fr',
        'grid-template-rows': '1fr min-content',
        'grid-template-areas': '"messages" "input"',
    }}>
        <Terminal {...{ installMessageListener }} />
        <Show when={msgListener()}>
            {msgListener => <InputBox {...{ msgListener: msgListener() }} />}
        </Show>
    </div>;
};

type MsgListener = (newMessage: string) => void;
type MsgListenerInstaller = (listener: MsgListener) => void;

const Terminal = ({ installMessageListener }: {
    installMessageListener: MsgListenerInstaller;
}) => {
    installMessageListener(msg => {
        if (myDiv) {
            myDiv.innerText += '\n' + msg;
            myDiv.scrollTop = myDiv.scrollHeight - myDiv.clientHeight;
        }
    });

    let myDiv: HTMLDivElement | undefined;

    return <div ref={myDiv} style={{
        'grid-area': 'messages',
        padding: '4px',
        'font-family': 'monospace',
        'overflow-x': 'hidden',
        'overflow-y': 'auto',
    }} />;
};

const InputBox = ({ msgListener }: { msgListener: MsgListener }) => {
    return <input type='text' style={{ 'grid-area': 'input' }} onkeydown={ev => {
        if (ev.key !== 'Enter') return;

        ev.preventDefault();
        ev.stopPropagation();

        const s = ev.currentTarget.value;
        ev.currentTarget.value = '';
        trpc.cliCommand.mutate(s).then(response => {
            if (response != null) {
                msgListener(response);
            }
        });
    }}></input>;
};
