import {controlsTemplate} from './assets';
import * as utils from './utils';
import {VisualizerElement} from './visualizer';
import {SpessaSynthPlayer} from "./spessasynth_player";
import {MIDI} from "spessasynth_lib";

type MIDI = typeof MIDI;

export type NoteEvent = CustomEvent<{ note: { midiNote: number } }>;
const VISUALIZER_EVENTS = ['start', 'stop', 'note'] as const;
const DEFAULT_SOUNDFONT = 'https://spessasus.github.io/SpessaSynth/GeneralUserGS.sf3';

let playingPlayer: PlayerElement = null;


/**
 * MIDI player element.
 * See also the [`@magenta/music/core/player` docs](https://magenta.github.io/magenta-js/music/modules/_core_player_.html).
 *
 * The element supports styling using the CSS [`::part` syntax](https://developer.mozilla.org/docs/Web/CSS/::part)
 * (see the list of shadow parts [below](#css-shadow-parts)). For example:
 * ```css
 * midi-player::part(control-panel) {
 *     background: aquamarine;
 *     border-radius: 0px;
 * }
 * ```
 *
 * @prop src - MIDI file URL
 * @prop soundFont - Magenta SoundFont URL, an empty string to use the default SoundFont, or `null` to use a simple oscillator synth
 * @prop noteSequence - Magenta note sequence object representing the currently loaded content
 * @prop loop - Indicates whether the player should loop
 * @prop currentTime - Current playback position in seconds
 * @prop duration - Content duration in seconds
 * @prop playing - Indicates whether the player is currently playing
 * @attr visualizer - A selector matching `midi-visualizer` elements to bind to this player
 *
 * @fires load - The content is loaded and ready to play
 * @fires start - The player has started playing
 * @fires stop - The player has stopped playing
 * @fires loop - The player has automatically restarted playback after reaching the end
 * @fires note - A note starts
 *
 * @csspart control-panel - `<div>` containing all the controls
 * @csspart play-button - Play button
 * @csspart time - Numeric time indicator
 * @csspart current-time - Elapsed time
 * @csspart total-time - Total duration
 * @csspart seek-bar - `<input type="range">` showing playback position
 * @csspart loading-overlay - Overlay with shimmer animation
 */
export class PlayerElement extends HTMLElement {
    protected player: SpessaSynthPlayer;
    protected soundfontBin: ArrayBuffer;
    protected midi: MIDI;
    protected controlPanel: HTMLElement;
    protected playButton: HTMLButtonElement;
    protected seekBar: HTMLInputElement;
    protected currentTimeLabel: HTMLInputElement;
    protected totalTimeLabel: HTMLInputElement;
    protected visualizerListeners = new Map<VisualizerElement, { [name: string]: EventListener }>();
    protected ns: MIDI = null;
    protected seeking = false;
    private domInitialized = false;
    private initTimeout: number;
    private needInitNs = false;

    constructor() {
        super();

        this.attachShadow({mode: 'open'});
        this.shadowRoot.appendChild(controlsTemplate.content.cloneNode(true));

        this.controlPanel = this.shadowRoot.querySelector('.controls');
        this.playButton = this.controlPanel.querySelector('.play');
        this.currentTimeLabel = this.controlPanel.querySelector('.current-time');
        this.totalTimeLabel = this.controlPanel.querySelector('.total-time');
        this.seekBar = this.controlPanel.querySelector('.seek-bar');
    }

    static get observedAttributes() {
        return ['sound-font', 'src', 'visualizer'];
    }

    protected _playing = false;

    get playing() {
        return this._playing;
    }

    get noteSequence() {
        return this.ns;
    }

    set noteSequence(value: MIDI | null) {
        if (this.ns == value) {
            return;
        }
        this.ns = value;
        this.removeAttribute('src');  // Triggers initPlayer only if src was present.
        this.initPlayer();
    }

    get src() {
        return this.getAttribute('src');
    }

    set src(value: string | null) {
        this.ns = null;
        this.setOrRemoveAttribute('src', value);  // Triggers initPlayer only if src was present.
        this.initPlayer();
    }

    /**
     * @attr sound-font
     */
    get soundFont() {
        return this.getAttribute('sound-font');
    }

    set soundFont(value: string | null) {
        this.setOrRemoveAttribute('sound-font', value);
    }

    /**
     * @attr loop
     */
    get loop() {
        return this.getAttribute('loop') != null;
    }

    set loop(value: boolean) {
        this.setOrRemoveAttribute('loop', value ? '' : null);
    }

    get currentTime() {
        return parseFloat(this.seekBar.value);
    }

    set currentTime(value: number) {
        this.seekBar.value = String(value);
        this.currentTimeLabel.textContent = utils.formatTime(this.currentTime);
        if (this.player && this.player.isPlaying) {
            this.player.currentTime = value;
        }
    }

    get duration() {
        return parseFloat(this.seekBar.max);
    }

    connectedCallback() {
        if (this.domInitialized) {
            return;
        }
        this.domInitialized = true;

        const applyFocusVisiblePolyfill =
            (window as any).applyFocusVisiblePolyfill as (scope: Document | ShadowRoot) => void;
        if (applyFocusVisiblePolyfill != null) {
            applyFocusVisiblePolyfill(this.shadowRoot);
        }

        this.playButton.addEventListener('click', () => {
            if (this.player.isPlaying) {
                this.stop();
            } else {
                this.start();
            }
        });
        this.seekBar.addEventListener('input', () => {
            // Pause playback while the user is manipulating the control
            this.seeking = true;
            if (this.player && this.player.isPlaying) {
                this.player.pause();
            }
        });
        this.seekBar.addEventListener('change', () => {
            const time = this.currentTime;  // This returns the seek bar value as a number
            this.currentTimeLabel.textContent = utils.formatTime(time);
            if (this.player) {
                if (this.player.isPlaying) {
                    this.player.currentTime = time;
                    if (!this.player.isPlaying) {
                        this.player.play();
                    }
                }
            }
            this.seeking = false;
        });

        this.initPlayerNow();
    }

    attributeChangedCallback(name: string, _oldValue: string, newValue: string) {
        if (!this.hasAttribute(name)) {
            newValue = null;
        }

        if (name === 'sound-font' || name === 'src') {
            this.initPlayer();
        } else if (name === 'visualizer') {
            const fn = () => {
                this.setVisualizerSelector(newValue);
            };
            if (document.readyState === 'loading') {
                window.addEventListener('DOMContentLoaded', fn);
            } else {
                fn();
            }
        }
    }

    reload() {
        this.initPlayerNow();
    }

    start() {
        this._start();
    }

    stop() {
        if (this.player && this.player.isPlaying) {
            this.player.pause();
        }
        this.handleStop(false);
    }

    addVisualizer(visualizer: VisualizerElement) {
        const listeners = {
            start: () => {
                //visualizer.noteSequence = this.noteSequence;
            },
            stop: () => {
                visualizer.clearActiveNotes();
            },
            note: (event: NoteEvent) => {
                console.log(event, "pass for now")
                //visualizer.redraw(event.detail.note);
            },
        } as const;
        for (const name of VISUALIZER_EVENTS) {
            this.addEventListener(name, listeners[name]);
        }
        this.visualizerListeners.set(visualizer, listeners);
    }

    removeVisualizer(visualizer: VisualizerElement) {
        const listeners = this.visualizerListeners.get(visualizer);
        for (const name of VISUALIZER_EVENTS) {
            this.removeEventListener(name, listeners[name]);
        }
        this.visualizerListeners.delete(visualizer);
    }

    protected initPlayer(initNs = true) {
        this.needInitNs = this.needInitNs || initNs;
        if (this.initTimeout == null) {
            this.stop();
            this.setLoading();
            this.initTimeout = window.setTimeout(() => this.initPlayerNow(this.needInitNs));
        }
    }

    protected async initPlayerNow(initNs = true) {
        this.initTimeout = null;
        this.needInitNs = false;
        if (!this.domInitialized) {
            return;
        }

        try {
            let ns: MIDI = null;
            if (initNs) {
                if (this.src) {
                    const midiBuf = await (await fetch(this.src)).arrayBuffer();
                    this.ns = null;
                    this.ns = new MIDI(midiBuf, "unnamed");
                }
                this.currentTime = 0;
                if (!this.ns) {
                    this.setError('No content loaded');
                }
            }
            ns = this.ns;

            if (ns) {
                this.seekBar.max = String(ns.duration);
                this.totalTimeLabel.textContent = utils.formatTime(ns.duration);
            } else {
                this.seekBar.max = '0';
                this.totalTimeLabel.textContent = utils.formatTime(0);
                return;
            }

            let soundFont = this.soundFont;
            // const callbackObject = {
            //     // Call callbacks only if we are still playing the same note sequence.
            //     run: (n: {
            //         midiNote: number,
            //         velocity: number,
            //         channelNumber: number
            //     }) => (this.ns === ns) && this.noteCallback(n),
            //     stop: () => {
            //     }
            // };
            if (soundFont === null) {
                console.error("Spessasynth requires a soundfont.");
                return;
            } else {
                if (soundFont === "") {
                    soundFont = DEFAULT_SOUNDFONT;
                }
                if (typeof this.soundfontBin === "undefined") {
                    this.soundfontBin = await (await fetch(soundFont)).arrayBuffer();
                }
                this.player = new SpessaSynthPlayer(this.soundfontBin);
                await this.player.initPlayer();
                this.player.loadMIDI(this.ns);
            }

            if (this.ns !== ns) {
                // If we started loading a different sequence in the meantime...
                return;
            }

            this.setLoaded();
            this.dispatchEvent(new CustomEvent('load'));
        } catch (error) {
            this.setError(String(error));
            throw error;
        }
    }

    protected _start(looped = false) {
        (async () => {
            if (this.player) {
                if (this.player.isPlaying === false) {
                    if (playingPlayer && playingPlayer.playing && !(playingPlayer == this && looped)) {
                        playingPlayer.stop();
                    }
                    playingPlayer = this;
                    this._playing = true;
                    this.currentTime = 0;

                    this.controlPanel.classList.remove('stopped');
                    this.controlPanel.classList.add('playing');
                    try {
                        // Force reload visualizers to prevent stuttering at playback start
                        // for (const visualizer of this.visualizerListeners.keys()) {
                        //     if (visualizer.noteSequence != this.ns) {
                        //         visualizer.noteSequence = this.ns;
                        //         visualizer.reload();
                        //     }
                        // }

                        this.player.play();
                        if (!looped) {
                            this.dispatchEvent(new CustomEvent('start'));
                        } else {
                            this.dispatchEvent(new CustomEvent('loop'));
                        }
                        this.handleStop(true);
                    } catch (error) {
                        this.handleStop();
                        throw error;
                    }
                } else if (!this.player.isPlaying) {
                    // This normally should not happen, since we pause playback only when seeking.
                    this.player.play();
                }
            }
        })();
    }

    protected noteCallback(note: { midiNote: number, velocity: number, channelNumber: number }) {
        if (!this.playing) {
            return;
        }
        this.dispatchEvent(new CustomEvent('note', {detail: {note}}));
        if (this.seeking) {
            return;
        }
        this.seekBar.value = String(this.player.currentTime);
        this.currentTimeLabel.textContent = utils.formatTime(this.player.currentTime);
    }

    protected handleStop(finished = false) {
        if (finished) {
            if (this.loop) {
                this.currentTime = 0;
                this._start(true);
                return;
            }
            this.currentTime = this.duration;
        }
        this.controlPanel.classList.remove('playing');
        this.controlPanel.classList.add('stopped');
        if (this._playing) {
            this._playing = false;
            this.dispatchEvent(new CustomEvent('stop', {detail: {finished}}));
        }
    }

    protected setVisualizerSelector(selector: string) {
        // Remove old listeners
        for (const listeners of this.visualizerListeners.values()) {
            for (const name of VISUALIZER_EVENTS) {
                this.removeEventListener(name, listeners[name]);
            }
        }
        this.visualizerListeners.clear();

        // Match visualizers and add them as listeners
        if (selector != null) {
            for (const element of document.querySelectorAll(selector)) {
                if (!(element instanceof VisualizerElement)) {
                    console.warn(`Selector ${selector} matched non-visualizer element`, element);
                    continue;
                }

                //this.addVisualizer(element);
            }
        }
    }

    protected setLoading() {
        this.playButton.disabled = true;
        this.seekBar.disabled = true;
        this.controlPanel.classList.remove('error');
        this.controlPanel.classList.add('loading', 'frozen');
        this.controlPanel.removeAttribute('title');
    }

    protected setLoaded() {
        this.controlPanel.classList.remove('loading', 'frozen');
        this.playButton.disabled = false;
        this.seekBar.disabled = false;
    }

    protected setError(error: string) {
        this.playButton.disabled = true;
        this.seekBar.disabled = true;
        this.controlPanel.classList.remove('loading', 'stopped', 'playing');
        this.controlPanel.classList.add('error', 'frozen');
        this.controlPanel.title = error;
    }

    protected setOrRemoveAttribute(name: string, value: string) {
        if (value == null) {
            this.removeAttribute(name);
        } else {
            this.setAttribute(name, value);
        }
    }
}
