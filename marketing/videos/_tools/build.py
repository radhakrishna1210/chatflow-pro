"""Assemble a film folder from its spec.json.

    python3 _tools/build.py <film-folder> [<film-folder> ...]

spec.json:
    { "size": [1080, 1920], "voice": "af_heart",
      "music": [{ "src": "bed-drive", "at": 0, "in": 0, "out": 30, "volume": 0.3 }],
      "scenes": [{ "page": "s1.html", "dur": 4.5,
                   "vo":  [[0.3, "Words to say", "optional voice"]],
                   "sfx": [[0.2, "pop", 0.6]] }] }

It copies the shared kit and fonts into <film>/lib, voices every line with
Kokoro (cached by text), copies the beds and effects it uses into assets/,
writes a WebVTT beside each voice line, and writes film.html. Run it after
editing a spec; it warns when a line runs past the end of its scene.
"""
import hashlib, json, os, shutil, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SCRATCH = os.environ.get('FILM_SCRATCH', '/tmp/film-scratch')
AUDIO = os.path.join(SCRATCH, 'audio')        # make_audio.py output
VOICES = os.path.join(SCRATCH, 'voices')      # kokoro model files
CACHE = os.path.join(SCRATCH, 'vo-cache')

_kokoro = None


def kokoro():
    global _kokoro
    if _kokoro is None:
        from kokoro_onnx import Kokoro
        _kokoro = Kokoro(os.path.join(VOICES, 'kokoro-v1.0.int8.onnx'), os.path.join(VOICES, 'voices-v1.0.bin'))
    return _kokoro


def say(text, voice, speed):
    """Return the path of an mp3 of `text`, and its length in seconds."""
    import soundfile as sf
    os.makedirs(CACHE, exist_ok=True)
    key = hashlib.sha1(f'{voice}|{speed}|{text}'.encode()).hexdigest()[:16]
    mp3 = os.path.join(CACHE, key + '.mp3')
    meta = os.path.join(CACHE, key + '.json')
    if not os.path.exists(mp3):
        samples, sr = kokoro().create(text, voice=voice, speed=speed, lang='en-us')
        wav = os.path.join(CACHE, key + '.wav')
        sf.write(wav, samples, sr)
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', wav, '-af', 'apad=pad_dur=0.05', '-c:a', 'libmp3lame', '-q:a', '3', mp3], check=True)
        os.remove(wav)
        json.dump({'dur': len(samples) / sr}, open(meta, 'w'))
    return mp3, json.load(open(meta))['dur']


def mp3_of(name, dest_dir):
    """Copy a generated bed or effect into assets as mp3."""
    os.makedirs(dest_dir, exist_ok=True)
    out = os.path.join(dest_dir, name + '.mp3')
    if not os.path.exists(out):
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', os.path.join(AUDIO, name + '.wav'), '-c:a', 'libmp3lame', '-q:a', '3', out], check=True)
    return out


def ts(s):
    m, s = divmod(max(0, s), 60)
    return f'{int(m):02d}:{s:06.3f}'


def vtt(text, dur):
    """One cue, with each word's start estimated from its share of the letters."""
    words = text.split()
    total = sum(len(w) + 1 for w in words)
    acc, parts = 0, []
    for i, w in enumerate(words):
        at = 0.05 + (dur - 0.1) * acc / total
        parts.append(w if i == 0 else f'<{ts(at)}>{w}')
        acc += len(w) + 1
    return f'WEBVTT\n\n{ts(0)} --> {ts(dur)}\n' + ' '.join(parts) + '\n'


def build(folder):
    spec = json.load(open(os.path.join(folder, 'spec.json')))
    W, H = spec.get('size', [1080, 1920])
    voice = spec.get('voice', 'af_heart')
    speed = spec.get('speed', 1.05)

    lib = os.path.join(folder, 'lib')
    if os.path.exists(lib):
        shutil.rmtree(lib)
    shutil.copytree(os.path.join(ROOT, '_shared'), lib)

    assets = os.path.join(folder, 'assets')
    vodir = os.path.join(assets, 'vo')
    if os.path.exists(vodir):
        shutil.rmtree(vodir)
    os.makedirs(vodir)

    pages, vo_clips, sfx_clips, timeline = [], [], [], []
    at = 0.0
    for si, sc in enumerate(spec['scenes']):
        dur = sc['dur']
        pid = os.path.splitext(sc['page'])[0]
        pages.append(f'  <iframe id="{pid}" src="{sc["page"]}#t=0,{dur:g}" at="{at:.3f}"></iframe>')
        timeline.append((pid, at, dur))
        for li, line in enumerate(sc.get('vo', [])):
            off, text = line[0], line[1]
            v = line[2] if len(line) > 2 else voice
            src, d = say(text, v, speed)
            name = f'{pid}-{li + 1}'
            shutil.copy(src, os.path.join(vodir, name + '.mp3'))
            open(os.path.join(vodir, name + '.vtt'), 'w').write(vtt(text, d))
            vo_clips.append(f'  <audio id="vo-{name}" src="assets/vo/{name}.mp3" at="{at + off:.3f}" volume="1.1"></audio>')
            if off + d > dur + 0.05:
                print(f'  ! {pid} line {li + 1} runs {off + d - dur:.2f}s past its scene ({off:.2f}+{d:.2f} > {dur})')
            else:
                print(f'    {pid} line {li + 1}: {off:.2f} → {off + d:.2f} of {dur}')
        for fx in sc.get('sfx', []):
            off, name = fx[0], fx[1]
            vol = fx[2] if len(fx) > 2 else 0.6
            mp3_of('sfx-' + name, os.path.join(assets, 'sfx'))
            sfx_clips.append((at + off, f'assets/sfx/sfx-{name}.mp3', vol, f'{pid}-{name}-{len(sfx_clips) + 1}'))
        at += dur

    # Effects may overlap; a track holds clips that do not, so deal them out
    # across as many effect tracks as they need.
    fx_tracks = []
    for start, src, vol, cid in sorted(sfx_clips):
        import soundfile as sf
        d = sf.info(os.path.join(folder, src)).duration
        for tr in fx_tracks:
            if tr[-1][0] <= start:
                tr.append((start + d, src, vol, cid, start))
                break
        else:
            fx_tracks.append([(start + d, src, vol, cid, start)])

    # Each bed is cut to the stretch it plays, ending no later than the film,
    # with short fades so a cut never clicks and the film ends on a tail.
    music = []
    mdir = os.path.join(assets, 'music')
    if os.path.exists(mdir):
        shutil.rmtree(mdir)
    os.makedirs(mdir)
    for i, m in enumerate(spec.get('music', [])):
        start, mat = m.get('in', 0), m.get('at', 0)
        length = min(m['out'] - start, at - mat)
        fade_out = 1.6 if mat + length >= at - 0.01 else 0.4
        name = f'{m["src"]}-{i + 1}.mp3'
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-ss', f'{start}', '-t', f'{length}', '-i', os.path.join(AUDIO, m['src'] + '.wav'),
                        '-af', f'afade=t=in:d=0.3,afade=t=out:st={max(0, length - fade_out):.3f}:d={fade_out}', '-c:a', 'libmp3lame', '-q:a', '3', os.path.join(mdir, name)], check=True)
        music.append(f'  <audio id="music-{i + 1}" src="assets/music/{name}" at="{mat:g}" volume="{m.get("volume", 0.3)}"></audio>')

    html = ['<!doctype html>', '<html>', '<head>', '<meta charset="utf-8">',
            f'<meta name="viewport" content="width={W}, height={H}">', f'<title>{spec.get("title", os.path.basename(folder))}</title>',
            '</head>', '<body>', '<section>', *pages, '</section>', '<section>', *vo_clips, '</section>']
    for tr in fx_tracks:
        html += ['<section>', *[f'  <audio id="{cid}" src="{src}" at="{st:.3f}" volume="{vol}"></audio>' for _, src, vol, cid, st in tr], '</section>']
    if music:
        html += ['<section>', *music, '</section>']
    html += ['</body>', '</html>', '']
    open(os.path.join(folder, 'film.html'), 'w').write('\n'.join(html))
    print(f'{os.path.basename(folder)}: {at:.2f}s, {len(pages)} scenes, {len(vo_clips)} lines, {len(sfx_clips)} effects')
    json.dump([{'page': p, 'at': round(a, 3), 'dur': d} for p, a, d in timeline], open(os.path.join(folder, 'timeline.json'), 'w'), indent=1)


if __name__ == '__main__':
    for f in sys.argv[1:]:
        build(os.path.abspath(f))
