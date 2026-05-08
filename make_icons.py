"""Generate PNG icons for the PWA using only Python stdlib."""
import struct, zlib, math

def write_png(filename, width, height, pixels):
    def chunk(name, data):
        c = name + data
        return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xFFFFFFFF)
    raw = b''
    for y in range(height):
        raw += b'\x00'
        for x in range(width):
            r, g, b, a = pixels[y][x]
            raw += bytes([r, g, b, a])
    compressed = zlib.compress(raw, 9)
    with open(filename, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n')
        f.write(chunk(b'IHDR', struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)))
        f.write(chunk(b'IDAT', compressed))
        f.write(chunk(b'IEND', b''))

def hex_to_rgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))

def lerp(a, b, t):
    return a + (b - a) * t

def blend(fg, bg, alpha):
    return tuple(int(lerp(bg[i], fg[i], alpha / 255)) for i in range(3)) + (255,)

def make_icon(size, maskable=False):
    INK = hex_to_rgb('#0c0d0f')
    ACCENT = hex_to_rgb('#ee6c3a')
    CREAM = hex_to_rgb('#f3f0ea')
    pixels = [[(0, 0, 0, 0)] * size for _ in range(size)]
    cx, cy = size / 2, size / 2
    r = size / 2

    for y in range(size):
        for x in range(size):
            if maskable:
                pixels[y][x] = INK + (255,)
            else:
                dist = math.sqrt((x - cx) ** 2 + (y - cy) ** 2)
                if dist <= r - 0.5:
                    pixels[y][x] = INK + (255,)
                elif dist <= r + 0.5:
                    aa = r + 0.5 - dist
                    pixels[y][x] = INK + (int(aa * 255),)

    # Draw a bold italic "u" using a simplified path (filled bezier approximation)
    u_size = size * 0.52
    u_x = cx
    u_y = cy + size * 0.02
    stroke = max(1, int(size * 0.055))

    # Rasterise a simple "u" shape: two vertical strokes + bottom arc
    def fill_rect(px, py, pw, ph, color):
        for iy in range(max(0, int(py)), min(size, int(py + ph))):
            for ix in range(max(0, int(px)), min(size, int(px + pw))):
                pixels[iy][ix] = color + (255,)

    def fill_circle(pcx, pcy, pr, color):
        for iy in range(max(0, int(pcy - pr - 1)), min(size, int(pcy + pr + 2))):
            for ix in range(max(0, int(pcx - pr - 1)), min(size, int(pcx + pr + 2))):
                d = math.sqrt((ix - pcx) ** 2 + (iy - pcy) ** 2)
                if d <= pr:
                    pixels[iy][ix] = color + (255,)

    half_w = u_size * 0.38
    arm_h = u_size * 0.68

    # Left arm of u
    fill_rect(u_x - half_w - stroke/2, u_y - arm_h/2, stroke, arm_h, ACCENT)
    # Right arm of u
    fill_rect(u_x + half_w - stroke/2, u_y - arm_h/2, stroke, arm_h, ACCENT)
    # Bottom arc (semicircle)
    arc_cx = u_x
    arc_cy = u_y - arm_h/2 + stroke/2
    arc_r_outer = half_w + stroke/2
    arc_r_inner = half_w - stroke/2
    for iy in range(max(0, int(arc_cy - arc_r_outer - 1)), min(size, int(arc_cy + arc_r_outer + 2))):
        for ix in range(max(0, int(arc_cx - arc_r_outer - 1)), min(size, int(arc_cx + arc_r_outer + 2))):
            d = math.sqrt((ix - arc_cx) ** 2 + (iy - arc_cy) ** 2)
            if arc_r_inner <= d <= arc_r_outer and iy >= arc_cy:
                pixels[iy][ix] = ACCENT + (255,)

    # Italic slant: shift top portion right
    slant = int(size * 0.04)
    for y in range(size):
        shift = int(slant * (cy - y) / (cy if cy > 0 else 1))
        shift = max(-slant*2, min(slant*2, shift))
        if shift > 0:
            pixels[y] = [(0,0,0,0)] * shift + pixels[y][:size - shift]
        elif shift < 0:
            pixels[y] = pixels[y][-shift:] + [(0,0,0,0)] * (-shift)

    # Text label "UHAMBO" as simple pixel dots (3x5 font at small size, skip for large)
    if size >= 192:
        label_y = int(u_y + u_size * 0.42)
        label_size = max(1, int(size * 0.035))
        letters = {
            'U': [(0,0),(0,1),(0,2),(0,3),(1,4),(2,4),(3,4),(4,0),(4,1),(4,2),(4,3)],
            'H': [(0,0),(0,1),(0,2),(0,3),(0,4),(4,0),(4,1),(4,2),(4,3),(4,4),(0,2),(1,2),(2,2),(3,2),(4,2)],
            'A': [(0,4),(1,0),(1,1),(1,2),(1,3),(1,4),(2,0),(3,0),(3,1),(3,2),(3,3),(3,4),(4,4),(0,2),(1,2),(2,2),(3,2),(4,2)],
            'M': [(0,0),(0,1),(0,2),(0,3),(0,4),(1,1),(2,2),(3,1),(4,0),(4,1),(4,2),(4,3),(4,4)],
            'B': [(0,0),(0,1),(0,2),(0,3),(0,4),(1,0),(2,0),(1,4),(2,4),(3,1),(3,3),(4,2)],
            'O': [(1,0),(2,0),(3,0),(0,1),(4,1),(0,2),(4,2),(0,3),(4,3),(1,4),(2,4),(3,4)],
        }
        word = 'UHAMBO'
        char_w = 5 * label_size
        char_gap = label_size
        total_w = len(word) * char_w + (len(word) - 1) * char_gap
        start_x = int(cx - total_w / 2)
        for ci, ch in enumerate(word):
            ox = start_x + ci * (char_w + char_gap)
            for dot_row, dot_col in letters.get(ch, []):
                px_x = ox + dot_col * label_size
                px_y = label_y + dot_row * label_size
                for dy in range(label_size):
                    for dx in range(label_size):
                        nx, ny = px_x + dx, px_y + dy
                        if 0 <= nx < size and 0 <= ny < size:
                            pixels[ny][nx] = CREAM + (255,)
    return pixels

import os
out_dir = 'public/icons'
os.makedirs(out_dir, exist_ok=True)

for size in [192, 512]:
    print(f'Generating {size}x{size} icons...')
    pix = make_icon(size, maskable=False)
    write_png(f'{out_dir}/icon-{size}.png', size, size, pix)
    pix_m = make_icon(size, maskable=True)
    write_png(f'{out_dir}/icon-maskable-{size}.png', size, size, pix_m)
    print(f'  -> icon-{size}.png and icon-maskable-{size}.png')

print('Done.')
