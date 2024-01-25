import { Setter, Accessor, createSignal } from "solid-js";

export type Uselessness = 'testing' | 'useless' | 'decent';

export function testWhetherUseless(videoFileName: string): Accessor<Uselessness> {
    const [useless, setUseless] = createSignal<Uselessness>('testing');
    performTest(videoFileName, setUseless);
    return useless;
}

function performTest(videoFileName: string, setUseless: Setter<Uselessness>) {
    const video = document.createElement('video');
    video.style.display = 'hidden';
    video.innerHTML = `<source src='https://files.joshuabaker.me/${videoFileName}' type='video/mp4'>`;

    Promise.race([
        sleep(5000).then(() => 'useless' as const),
        testProcedure(),
    ]).then(setUseless).finally(() => video.remove());

    async function testProcedure(): Promise<'decent'> {
        document.body.append(video);
        await new Promise<void>(resolve => video.oncanplay = () => resolve());
        video.currentTime = 300;
        await new Promise<void>(resolve => video.oncanplay = () => resolve());
        return 'decent';
    }
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
