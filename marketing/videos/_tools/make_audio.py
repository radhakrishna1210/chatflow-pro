"""Synthesise the music beds and sound effects the films use.

Everything is generated from code, so the films carry no third-party audio and
the beds can be re-made at any length:  python3 make_audio.py <out_dir>
"""
import sys, os
import numpy as np
import soundfile as sf

SR = 44100
rng = np.random.default_rng(7)


def t_(dur):
    return np.arange(int(dur * SR)) / SR


def env(n, a=0.005, r=0.2, sustain=None):
    """Attack / exponential-release envelope over n samples."""
    x = np.arange(n) / SR
    e = np.minimum(1, x / max(a, 1e-4))
    e *= np.exp(-x / r) if sustain is None else np.where(x < sustain, 1, np.exp(-(x - sustain) / r))
    return e


def lowpass(x, cutoff):
    # one-pole low-pass, cheap and smooth enough for pads
    a = np.exp(-2 * np.pi * cutoff / SR)
    y = np.empty_like(x)
    acc = 0.0
    for i, v in enumerate(x):
        acc = (1 - a) * v + a * acc
        y[i] = acc
    return y


def saw(f, t):
    return 2 * ((f * t) % 1) - 1


def note(m):
    return 440 * 2 ** ((m - 69) / 12)


def kick(dur=0.45):
    t = t_(dur)
    f = 45 + 110 * np.exp(-t * 28)
    ph = 2 * np.pi * np.cumsum(f) / SR
    return np.sin(ph) * env(len(t), 0.001, 0.16)


def clap(dur=0.25):
    n = int(dur * SR)
    noise = rng.standard_normal(n)
    noise = noise - lowpass(noise, 900)
    return noise * env(n, 0.002, 0.07) * 0.5


def hat(dur=0.08):
    n = int(dur * SR)
    noise = rng.standard_normal(n)
    noise = noise - lowpass(noise, 6000)
    return noise * env(n, 0.001, 0.018) * 0.35


def add(buf, x, at, gain=1.0):
    i = int(at * SR)
    if i >= len(buf):
        return
    j = min(len(buf), i + len(x))
    buf[i:j] += x[: j - i] * gain


def track(dur, bpm, chords, mood):
    """A four-chord loop: kick, clap, hats, sub bass, pad, pluck arpeggio."""
    out = np.zeros(int(dur * SR) + SR)
    beat = 60 / bpm
    bar = beat * 4
    k, c, h = kick(), clap(), hat()
    nbars = int(dur / bar) + 1
    for b in range(nbars):
        t0 = b * bar
        root, triad = chords[b % len(chords)]
        intro = b < 2  # first two bars: no drums, so a hook can land on top
        for q in range(4):
            tb = t0 + q * beat
            if not intro:
                if mood != 'calm' or q in (0, 2):
                    add(out, k, tb, 0.9 if q in (0, 2) else (0.55 if mood == 'drive' else 0))
                if q in (1, 3):
                    add(out, c, tb, 0.55 if mood != 'tense' else 0.35)
                for e in range(2):
                    add(out, h, tb + e * beat / 2, 0.5 if e else 0.3)
        # sub bass on the root, pulsing eighths
        for e in range(8):
            if intro and e % 2:
                continue
            tb = t0 + e * beat / 2
            n = int(beat / 2 * SR * 0.9)
            tt = np.arange(n) / SR
            f = note(root - 24)
            x = np.sin(2 * np.pi * f * tt) + 0.3 * np.sin(4 * np.pi * f * tt)
            add(out, x * env(n, 0.004, 0.18), tb, 0.32)
        # pad: detuned saws, low-passed, the whole bar
        n = int(bar * SR)
        tt = np.arange(n) / SR
        pad = np.zeros(n)
        for m in triad:
            for d in (-0.08, 0.08):
                pad += saw(note(m) * (1 + d / 100 * 12), tt)
        pad = lowpass(pad, 1200 if mood != 'tense' else 700)
        pe = np.minimum(1, tt / 0.3) * np.minimum(1, (bar - tt) / 0.3)
        add(out, pad * pe, t0, 0.045)
        # pluck arpeggio, sixteenths, over the triad
        if mood != 'tense' or b % 2:
            seq = triad + [triad[1] + 12, triad[0] + 12, triad[2], triad[1]]
            for s in range(8):
                tb = t0 + s * beat / 2
                m = seq[s % len(seq)] + 12
                pn = int(0.3 * SR)
                pt = np.arange(pn) / SR
                x = np.sign(np.sin(2 * np.pi * note(m) * pt)) * 0.5 + np.sin(2 * np.pi * note(m) * pt)
                x = lowpass(x * env(pn, 0.002, 0.09), 3000)
                add(out, x, tb, 0.05 if mood != 'calm' else 0.035)
    out = out[: int(dur * SR)]
    # fade in / out
    fi = int(0.4 * SR)
    fo = int(2.5 * SR)
    out[:fi] *= np.linspace(0, 1, fi)
    out[-fo:] *= np.linspace(1, 0, fo)
    out = np.tanh(out * 1.4) / np.tanh(1.4)
    return out / np.max(np.abs(out)) * 0.8


def sfx_pop():
    t = t_(0.12)
    f = 900 + 900 * np.exp(-t * 60)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * env(len(t), 0.001, 0.035)


def sfx_ding():
    t = t_(0.9)
    x = sum(np.sin(2 * np.pi * f * t) * g for f, g in ((1318.5, 1), (1975.5, 0.5), (2637, 0.2)))
    return x * env(len(t), 0.002, 0.25) * 0.5


def sfx_whoosh():
    n = int(0.6 * SR)
    noise = rng.standard_normal(n)
    out = np.zeros(n)
    seg = n // 30
    for i in range(30):
        cut = 300 + 5000 * np.sin(np.pi * i / 30)
        s = noise[i * seg:(i + 1) * seg]
        out[i * seg:(i + 1) * seg] = lowpass(s, cut)
    shape = np.sin(np.linspace(0, np.pi, n)) ** 2
    return out * shape * 0.9


def sfx_tick():
    n = int(0.03 * SR)
    noise = rng.standard_normal(n)
    return (noise - lowpass(noise, 3000)) * env(n, 0.0005, 0.006) * 0.6


def sfx_success():
    out = np.zeros(int(1.0 * SR))
    for i, m in enumerate((72, 76, 79, 84)):
        t = t_(0.6)
        x = np.sin(2 * np.pi * note(m) * t) + 0.3 * np.sin(4 * np.pi * note(m) * t)
        add(out, x * env(len(t), 0.003, 0.18), i * 0.07, 0.35)
    return out


def sfx_buzz():
    t = t_(0.45)
    x = np.sign(np.sin(2 * np.pi * 110 * t)) * 0.6 + saw(116, t) * 0.4
    return lowpass(x, 1400) * env(len(t), 0.003, 0.4, sustain=0.3) * 0.45


def sfx_riser(dur=1.6):
    t = t_(dur)
    noise = rng.standard_normal(len(t))
    hp = noise - lowpass(noise, 2500)
    f = 200 * 2 ** (t / dur * 3)
    tone = saw(f, t) * 0.15
    shape = (t / dur) ** 2
    return (hp * 0.5 + tone) * shape


def sfx_impact():
    k = kick(0.9)
    n = len(k)
    noise = rng.standard_normal(n)
    return np.tanh((k * 1.2 + lowpass(noise, 400) * env(n, 0.001, 0.3) * 0.8) * 1.5) * 0.9


def sfx_cash():
    out = np.zeros(int(0.8 * SR))
    for i, m in enumerate((88, 91)):
        t = t_(0.5)
        x = sum(np.sin(2 * np.pi * note(m) * h * t) / h for h in (1, 2.76, 5.4))
        add(out, x * env(len(t), 0.001, 0.12), i * 0.09, 0.4)
    add(out, sfx_tick(), 0, 1.0)
    return out


def norm(x, peak=0.9):
    return x / (np.max(np.abs(x)) + 1e-9) * peak


def main(out):
    os.makedirs(out, exist_ok=True)
    Am, F, C, G, Dm, E = (57, [57, 60, 64]), (53, [53, 57, 60]), (48, [55, 60, 64]), (55, [55, 59, 62]), (50, [57, 62, 65]), (52, [56, 59, 64])
    beds = {
        'bed-drive.wav': (200, 118, [Am, F, C, G], 'drive'),   # marketing reels
        'bed-tense.wav': (60, 92, [Am, Am, F, E], 'tense'),     # the pain, before the turn
        'bed-lift.wav': (60, 112, [F, C, G, Am], 'drive'),      # the turn, after it
        'bed-calm.wav': (240, 100, [C, G, Am, F], 'calm'),      # the product tour
    }
    for name, (dur, bpm, ch, mood) in beds.items():
        sf.write(os.path.join(out, name), track(dur, bpm, ch, mood), SR)
        print('wrote', name)
    for name, fn in {'pop': sfx_pop, 'ding': sfx_ding, 'whoosh': sfx_whoosh, 'tick': sfx_tick,
                     'success': sfx_success, 'buzz': sfx_buzz, 'riser': sfx_riser,
                     'impact': sfx_impact, 'cash': sfx_cash}.items():
        sf.write(os.path.join(out, f'sfx-{name}.wav'), norm(fn()), SR)
        print('wrote sfx', name)


if __name__ == '__main__':
    main(sys.argv[1])
