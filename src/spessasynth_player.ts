import {
    BasicMIDI,
    IndexedByteArray,
    MidiMessage,
    readBytesAsUintBigEndian,
    Sequencer,
    Synthetizer
} from "spessasynth_lib";

type BasicMIDI = typeof BasicMIDI;
type Synthetizer = typeof Synthetizer;
type Sequencer = typeof Sequencer;
type MidiMessage = typeof MidiMessage;

export class NoteTime {
    public midiNote: number;
    public start: number;
    public length: number;
    public velocity: number;
}

export class SpessaSynthPlayer {
    private static context: AudioContext = undefined;
    private synth: Synthetizer;
    private seq: Sequencer = undefined;
    private soundfontBuffer: ArrayBuffer;
    private midi: BasicMIDI;

    constructor(soundfontBuffer: ArrayBuffer) {
        this.soundfontBuffer = soundfontBuffer;
    }

    public get currentTime() {
        return this.seq.currentTime;
    }

    public set currentTime(newTime: number) {
        this.seq.currentTime = newTime;
    }

    public get isPlaying() {
        return !this.seq.paused;
    }

    public loadMIDI(midi: BasicMIDI) {
        if (typeof this.seq === "undefined") {
            this.seq = new Sequencer([midi], this.synth, {
                autoPlay: false
            });
        } else {
            this.seq.loadNewSongList([midi]);
        }
        this.midi = midi;
    }

    public play() {
        this.seq.play();
    }

    public pause() {
        this.seq.pause();
    }

    public async initPlayer() {
        if (typeof SpessaSynthPlayer.context === "undefined") {
            const context: AudioContext = new AudioContext();
            SpessaSynthPlayer.context = context;
            await context.audioWorklet.addModule(new URL(import.meta.url, "assets/worklet_processor.min.js").href);
        }
        this.synth = new Synthetizer(SpessaSynthPlayer.context.destination, this.soundfontBuffer);
    }

    public getNoteTimes(): NoteTime[][] {

        function getTempo(event: MidiMessage): number {
            // simulate IndexedByteArray
            event.messageData = new IndexedByteArray(event.messageData.buffer);
            event.messageData.currentIndex = 0;
            return 60000000 / readBytesAsUintBigEndian(event.messageData, 3);
        }

        const minNoteTime = 0.02;
        const noteTimes: NoteTime[][] = [];
        // flatten and sort by ticks
        const trackData: MidiMessage[][] = this.midi.tracks;
        let events: MidiMessage[] = trackData.flat();
        events.sort((e1: MidiMessage, e2: MidiMessage) => e1.ticks - e2.ticks);

        // 16 channels
        for (let i = 0; i < 16; i++) {
            noteTimes.push([]);
        }
        let elapsedTime: number = 0;
        let oneTickToSeconds: number = 60 / (120 * this.midi.timeDivision);
        let eventIndex: number = 0;
        let unfinished: number = 0;
        const unfinishedNotes: NoteTime[][] = [];
        for (let i = 0; i < 16; i++) {
            unfinishedNotes.push([]);
        }
        const noteOff = (midiNote: number, channel: number): void => {
            const noteIndex = unfinishedNotes[channel].findIndex(n => n.midiNote === midiNote);
            const note = unfinishedNotes[channel][noteIndex];
            if (note) {
                const time = elapsedTime - note.start;
                note.length = (time < minNoteTime && channel === 9 ? minNoteTime : time);
                // delete from unfinished
                unfinishedNotes[channel].splice(noteIndex, 1);
            }
            unfinished--;
        };
        while (eventIndex < events.length) {
            const event: MidiMessage = events[eventIndex];

            const status: number = event.messageStatusByte >> 4;
            const channel: number = event.messageStatusByte & 0x0F;

            // note off
            if (status === 0x8) {
                noteOff(event.messageData[0], channel);
            }
            // note on
            else if (status === 0x9) {
                if (event.messageData[1] === 0) {
                    // nevermind, its note off
                    noteOff(event.messageData[0], channel);
                } else {
                    // stop previous
                    noteOff(event.messageData[0], channel);
                    const noteTime = {
                        midiNote: event.messageData[0],
                        start: elapsedTime,
                        length: -1,
                        velocity: event.messageData[1] / 127
                    };
                    noteTimes[channel].push(noteTime);
                    unfinishedNotes[channel].push(noteTime);
                    unfinished++;

                }
            }
            // set tempo
            else if (event.messageStatusByte === 0x51) {
                oneTickToSeconds = 60 / (getTempo(event) * this.midi.timeDivision);
            }

            if (++eventIndex >= events.length) {
                break;
            }

            elapsedTime += oneTickToSeconds * (events[eventIndex].ticks - event.ticks);
        }

        // finish the unfinished notes
        if (unfinished > 0) {
            // for every channel, for every note that is unfinished (has -1 length)
            unfinishedNotes.forEach((channelNotes, channel) => {
                channelNotes.forEach(note => {
                    const time = elapsedTime - note.start;
                    note.length = (time < minNoteTime && channel === 9 ? minNoteTime : time);
                });
            });
        }
        return noteTimes;
    }
}