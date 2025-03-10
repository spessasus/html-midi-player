declare module "spessasynth_lib"

export class Synthetizer {
    constructor(targetNode: AudioNode, soundFontBuffer: ArrayBuffer, enableEventSystem?: boolean, startRenderingData?: any, synthConfig?: any);
}

type MIDIFile = { binary: ArrayBuffer, altName?: string } | BasicMIDI;

export class Sequencer {
    loop: boolean;
    currentTime: number;
    isFinished: boolean;
    paused: boolean;

    constructor(midiBinaries: MIDIFile[], synth: Synthetizer, options?: {
        autoPlay: boolean | undefined
    });

    pause(): void;

    play(): void;

    stop(): void;

    loadNewSongList(midiBuffers: MIDIFile[]): void;
}

class IndexedByteArray extends Uint8Array {
    currentIndex: number;
}

class MidiMessage {
    ticks: number;
    messageStatusByte: number;
    messageData: IndexedByteArray;
}


class MIDISequenceData {
    timeDivision: number;
    duration: number;
    tempoChanges: { ticks: number, tempo: number }[];
    copyright: string;
    tracksAmount: number;
    lyrics: Uint8Array[];
    lyricsTicks: number[];
    firstNoteOn: number;
    keyRange: { min: number, max: number };
    lastVoiceEventTick: number;
    midiPorts: number[];
    midiPortChannelOffsets: number;
    usedChannelsOnTrack: number[];
    loop: { start: number, end: number };
    midiName: string;
    midiNameUsesFileName: boolean;
    fileName: string;
    rawMidiName = Uint8Array;
    format: number;
    RMIDInfo: Object<number, IndexedByteArray>;
    bankOffset: number;
    isKaraokeFile: boolean;
}

export class BasicMIDI extends MIDISequenceData {
    embeddedSoundFont: ArrayBuffer | undefined;
    tracks: MidiMessage[][];

    static copyFrom(mid: BasicMIDI): BasicMIDI;

    flush(): void
}

export class MIDI extends BasicMIDI {
    constructor(arrayBuffer: ArrayBuffer, fileName: string)
}

export function readBytesAsUintBigEndian(dataArray: IndexedByteArray, bytesAmount: number): number;