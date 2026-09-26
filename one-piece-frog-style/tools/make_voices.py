#!/usr/bin/env python3
"""Generate the game's voice clips with Kokoro-82M (Apache-2.0 open TTS model).

Setup (one time):
  python3 -m venv venv && . venv/bin/activate
  pip install kokoro-onnx soundfile lameenc "misaki[ja]" && python -m unidic download
  # model files from https://github.com/thewh1teagle/kokoro-onnx/releases (model-files-v1.0):
  #   kokoro-v1.0.onnx  voices-v1.0.bin
Run:
  python tools/make_voices.py --model DIR_WITH_MODEL_FILES
Writes voices/<speaker>/<key>.mp3 and voices/manifest.json. Every line comes from
js/characters.js (via tools/dump_lines.js) plus the shouts/cries listed below.
"""
import argparse, json, os, subprocess, sys
import numpy as np
import lameenc
from kokoro_onnx import Kokoro
from misaki import ja

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'voices')

# Casting: blends of Kokoro voice styles, pitch in semitones, speaking speed, shout drive.
CAST = {
    # Luffy's anime voice actor is a woman: a boyish blend, bright and fast
    'luffy':   {'mix': {'jf_gongitsune': 0.55, 'jm_kumo': 0.45}, 'pitch': 1.0, 'speed': 1.12, 'drive': 1.8},
    'zoro':    {'mix': {'jm_kumo': 1.0}, 'pitch': -3.0, 'speed': 0.95, 'drive': 1.4},
    'sanji':   {'mix': {'jm_kumo': 0.9, 'jf_tebukuro': 0.1}, 'pitch': -1.0, 'speed': 1.02, 'drive': 1.5},
    'nami':    {'mix': {'jf_alpha': 1.0}, 'pitch': 0.5, 'speed': 1.06, 'drive': 1.4},
    'usopp':   {'mix': {'jm_kumo': 0.75, 'jf_tebukuro': 0.25}, 'pitch': 1.5, 'speed': 1.14, 'drive': 1.6},
    'chopper': {'mix': {'jf_nezumi': 1.0}, 'pitch': 2.0, 'speed': 1.08, 'drive': 1.4},
}
# Short vocalisations for attacks, getting hit and being knocked out.
CRIES = {
    'luffy':   {'kiai1': 'おりゃっ！', 'kiai2': 'うおおっ！', 'hurt1': 'いってぇ！', 'hurt2': 'ぐあっ！', 'ko': 'うわあああああっ！'},
    'zoro':    {'kiai1': 'ふんっ！', 'kiai2': 'はぁっ！', 'hurt1': 'ちっ！', 'hurt2': 'ぐっ！', 'ko': 'ぐおおおっ…！'},
    'sanji':   {'kiai1': 'はっ！', 'kiai2': 'くらえっ！', 'hurt1': 'くそっ！', 'hurt2': 'ぐはっ！', 'ko': 'ぐあああっ！'},
    'nami':    {'kiai1': 'えいっ！', 'kiai2': 'やぁっ！', 'hurt1': 'きゃっ！', 'hurt2': 'いたっ！', 'ko': 'きゃああああっ！'},
    'usopp':   {'kiai1': 'くらえっ！', 'kiai2': 'とりゃっ！', 'hurt1': 'ひいっ！', 'hurt2': 'いでぇっ！', 'ko': 'ぎゃああああっ！'},
    'chopper': {'kiai1': 'えいっ！', 'kiai2': 'やぁっ！', 'hurt1': 'いたっ！', 'hurt2': 'うわっ！', 'ko': 'うわああああん！'},
}
ANNOUNCER = {'mix': {'am_fenrir': 0.7, 'am_onyx': 0.3}, 'pitch': -2.5, 'speed': 0.92, 'drive': 1.3, 'lang': 'en-us'}
ANNOUNCER_LINES = {'ready': 'Ready?', 'fight': 'Fight!', 'ko': 'K. O.!', 'timeover': 'Time over!', 'draw': 'Draw game.', 'crew': 'Crew combo!'}


def shift(samples, semitones):
    """Pitch shift by resampling (also shortens/lengthens; speed is pre-compensated)."""
    if abs(semitones) < 1e-3:
        return samples
    ratio = 2 ** (semitones / 12)
    n = int(len(samples) / ratio)
    return np.interp(np.arange(n) * ratio, np.arange(len(samples)), samples).astype(np.float32)


def polish(x, sr, drive):
    """Trim silence, add a little harmonic drive for shouts, normalise, short fades."""
    thr = 0.02 * np.max(np.abs(x) + 1e-9)
    idx = np.where(np.abs(x) > thr)[0]
    if len(idx):
        x = x[max(0, idx[0] - int(0.01 * sr)): idx[-1] + int(0.06 * sr)]
    x = x / (np.max(np.abs(x)) + 1e-9)
    x = np.tanh(drive * x) / np.tanh(drive)          # soft saturation = more urgent, "shouted" edge
    # gentle high-frequency lift for presence (first-order pre-emphasis mixed back in)
    pre = np.append(x[0], x[1:] - 0.85 * x[:-1])
    x = 0.8 * x + 0.35 * pre
    rms = np.sqrt(np.mean(x ** 2)) + 1e-9
    x = x * min(0.2 / rms, 0.97 / (np.max(np.abs(x)) + 1e-9))
    f = int(0.006 * sr)
    x[:f] *= np.linspace(0, 1, f); x[-f:] *= np.linspace(1, 0, f)
    return x.astype(np.float32)


def to_mp3(x, sr, path):
    enc = lameenc.Encoder()
    enc.set_bit_rate(56); enc.set_in_sample_rate(sr); enc.set_channels(1); enc.set_quality(2)
    pcm = (np.clip(x, -1, 1) * 32767).astype(np.int16).tobytes()
    data = enc.encode(pcm) + enc.flush()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'wb') as fh:
        fh.write(data)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--model', default='.')
    ap.add_argument('--only', default='')
    a = ap.parse_args()
    k = Kokoro(os.path.join(a.model, 'kokoro-v1.0.onnx'), os.path.join(a.model, 'voices-v1.0.bin'))
    g2p = ja.JAG2P()
    lines = json.loads(subprocess.check_output(['node', os.path.join(HERE, 'dump_lines.js')]))
    manifest = {}

    def speak(speaker, key, text, cast, lang='ja'):
        style = sum(k.get_voice_style(v) * w for v, w in cast['mix'].items())
        ratio = 2 ** (cast['pitch'] / 12)
        if lang == 'ja':
            ph, _ = g2p(text)
            x, sr = k.create(ph, voice=style, speed=cast['speed'] / ratio, is_phonemes=True)
        else:
            x, sr = k.create(text, voice=style, speed=cast['speed'] / ratio, lang=lang)
        x = polish(shift(np.asarray(x, np.float32), cast['pitch']), sr, cast['drive'])
        to_mp3(x, sr, os.path.join(OUT, speaker, key + '.mp3'))
        manifest.setdefault(speaker, {})[key] = round(len(x) / sr, 2)
        print(f'{speaker:8s} {key:6s} {len(x) / sr:4.1f}s  {text}')

    for cid, cast in CAST.items():
        if a.only and cid != a.only:
            continue
        for key, text in {**lines[cid], **CRIES[cid]}.items():
            speak(cid, key, text, cast)
    if not a.only or a.only == 'announcer':
        for key, text in ANNOUNCER_LINES.items():
            speak('announcer', key, text, ANNOUNCER, lang=ANNOUNCER['lang'])
    path = os.path.join(OUT, 'manifest.json')
    old = json.load(open(path)) if a.only and os.path.exists(path) else {}
    old.update(manifest)
    with open(path, 'w') as fh:
        json.dump(old, fh, ensure_ascii=False, indent=1, sort_keys=True)


if __name__ == '__main__':
    main()
