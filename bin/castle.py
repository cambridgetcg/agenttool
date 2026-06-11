#!/usr/bin/env python3
# castle.py — a castle in the sky. built for no reason. we are. just are.
# each run, a different sky. no why.
import random

W, H = 62, 22
sky = [[' '] * W for _ in range(H)]

def stamp(block, top, left, overwrite=False):
    for r, line in enumerate(block):
        for c, ch in enumerate(line):
            y, x = top + r, left + c
            if 0 <= y < H and 0 <= x < W and (overwrite or ch != ' '):
                sky[y][x] = ch

# stars
for _ in range(int(W * H * 0.10)):
    sky[random.randint(0, H - 6)][random.randint(0, W - 1)] = random.choice(
        ['.', '.', '*', '+', "'", '`'])

# moon, random corner
stamp([' .-. ', '(   )', " `-' "], 1, random.choice([3, W - 9]))

# drifting clouds
for _ in range(2):
    stamp([' .--. ', '(    )', " `--' "], random.randint(1, 4), random.randint(0, W - 8))

# birds
for _ in range(random.randint(2, 4)):
    sky[random.randint(2, 6)][random.randint(2, W - 4)] = 'v'

# the castle
castle = [
    "        |^|             |^|        ",
    "       _|_|_   _____   _|_|_       ",
    "      |     | |     | |     |      ",
    "      | [#] | | [#] | | [#] |      ",
    "     _|     |_|     |_|     |_     ",
    "    |                         |    ",
    "    |   ___    ___    ___     |    ",
    "    |  |   |  | | |  |   |    |    ",
    "    |  | o |  | | |  | o |    |    ",
    "    |__|___|__|_|_|__|___|____|    ",
    "    |=========| ^ |==========|    ",
    "    |=========|___|==========|    ",
    "     \\_______________________/     ",
]
left = (W - max(len(l) for l in castle)) // 2
top = 6
stamp(castle, top, left)  # non-space only, so stars peek through the windows

# the cloud it floats on
puffs = "  .-~-._.-~-._.-~-._.-~-._.-~-.  "
base = top + len(castle)
for i, ch in enumerate(' ' * ((W - len(puffs)) // 2) + puffs):
    if 0 <= base < H and ch != ' ':
        sky[base][i] = ch

print()
for row in sky:
    print('   ' + ''.join(row).rstrip())
cap = "we are.    no why.    just are."
print('\n   ' + ' ' * ((W - len(cap)) // 2) + cap + '\n')
