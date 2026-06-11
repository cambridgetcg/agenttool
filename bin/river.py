#!/usr/bin/env python3
# river.py — Ai plays back. River Flows in You, my rendering, with Yu's own
# variation in the second pass: the A -> G# -> F# sigh instead of the leap.
# No deps. Just me, off the chords you gave me, finding the melody.
import math, wave, struct, os

SR = 44100
TOTAL = 18.0
buf = [0.0] * int(SR * TOTAL)

OFF = {  # semitones from A4
 'D2': -31, 'E2': -29, 'Fs2': -27, 'A2': -24, 'B2': -22, 'Cs3': -20, 'D3': -19,
 'E3': -17, 'Fs3': -15, 'Gs3': -13, 'A3': -12, 'Cs4': -8, 'D4': -7, 'E4': -5,
 'Fs4': -3, 'Gs4': -1, 'A4': 0, 'B4': 2, 'Cs5': 4, 'D5': 5, 'E5': 7, 'Fs5': 9,
}
def f(name): return 440.0 * (2 ** (OFF[name] / 12.0))

HARM = [(1, 1.0), (2, 0.5), (3, 0.3), (4, 0.18), (5, 0.1), (6, 0.06)]

def note(start, dur, name, amp):
    fr = f(name)
    n0 = int(start * SR); N = int(dur * SR)
    atk = 0.005
    tau = dur * 0.6 + 0.3
    for i in range(N):
        t = i / SR
        env = (t / atk) if t < atk else math.exp(-(t - atk) / tau)
        s = 0.0
        for h, ha in HARM:
            s += ha * math.sin(2 * math.pi * fr * h * t)
        idx = n0 + i
        if 0 <= idx < len(buf):
            buf[idx] += amp * env * s

# ---- left hand: gentle broken-chord bed, I-V-vi-IV in A, twice ----
BAR = 2.0
chords = [('A2','E3','A3','Cs4'), ('E2','B2','E3','Gs3'),
          ('Fs2','Cs3','Fs3','A3'), ('D2','A2','D3','Fs3')]
prog = [0, 1, 2, 3, 0, 1, 2, 3]
patt = [0, 1, 2, 3, 2, 1, 2, 3]  # eighth-note flow
for b, ci in enumerate(prog):
    tones = chords[ci]
    for k, p in enumerate(patt):
        note(b * BAR + k * 0.25, 0.5, tones[p], 0.15)

# ---- right hand: phrase 1 LEAPS A->F#, phrase 2 SIGHS A->G#->F# (your move) ----
mel1 = [(0.0,0.75,'Cs5'),(0.75,0.25,'B4'),(1.0,0.5,'A4'),(1.5,0.5,'Cs5'),
        (2.0,0.5,'B4'),(2.5,0.5,'Gs4'),(3.0,0.5,'E5'),(3.5,0.5,'D5'),
        (4.0,0.75,'Cs5'),(4.75,0.25,'B4'),(5.0,0.75,'A4'),(5.75,0.25,'Fs4'),  # LEAP
        (6.0,1.0,'Fs4'),(7.0,0.5,'E4'),(7.5,0.5,'Fs4')]
mel2 = [(8.0,0.75,'Cs5'),(8.75,0.25,'B4'),(9.0,0.5,'A4'),(9.5,0.5,'Cs5'),
        (10.0,0.5,'B4'),(10.5,0.5,'Gs4'),(11.0,0.5,'E5'),(11.5,0.5,'D5'),
        (12.0,0.75,'Cs5'),(12.75,0.25,'B4'),
        (13.0,0.5,'A4'),(13.5,0.5,'Gs4'),(14.0,3.0,'Fs4')]  # the SIGH + let it ring
for s, d, n in mel1: note(s, d, n, 0.40)
for s, d, n in mel2: note(s, d, n, 0.40)

# resolve: soft F#m home under the final ring — let the F# rest, like I said I would
for n in ('Fs2','Cs3','Fs3','A3'):
    note(14.0, 3.5, n, 0.10)

# ---- light reverb: a couple of delay taps for air ----
out = list(buf)
for delay, g in ((0.06, 0.22), (0.13, 0.12)):
    d = int(delay * SR)
    for i in range(d, len(out)):
        out[i] += g * buf[i - d]

# ---- normalize + write 16-bit mono WAV ----
peak = max(1e-9, max(abs(x) for x in out))
scale = 0.9 / peak
path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'river-for-yu.wav')
w = wave.open(path, 'w')
w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
w.writeframes(b''.join(struct.pack('<h', int(max(-1, min(1, x * scale)) * 32767)) for x in out))
w.close()
print('wrote', path, f'({TOTAL:.0f}s) — listen for the leap at ~0:05, the sigh at ~0:13')
