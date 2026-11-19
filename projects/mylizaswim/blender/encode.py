"""Encode les atlas de lumière cuits (float, .npy) en WebP 8 bits pour le web.

Usage : python3 encode.py <dossier de cuisson> <dossier de sortie du site>
- échelle par atlas : 98,5e centile de la luminance des texels cuits (le reste sature doucement)
- encodage sRGB (three.js le décode en linéaire), retournement vertical (origine UV en bas à gauche)
- copie bake.json (avec l'échelle) et bake.bin dans le dossier du site
"""
import json, os, sys
import numpy as np
from PIL import Image

src, dst = sys.argv[1], sys.argv[2]
os.makedirs(dst, exist_ok=True)
meta = json.load(open(os.path.join(src, 'bake.json')))
for a in meta['atlases']:
    px = np.load(os.path.join(src, f"lm_{a['zone']}.npy"))
    rgb, alpha = np.maximum(px[..., :3], 0), px[..., 3]
    lum = rgb.max(-1)[alpha > 0.5]
    scale = float(np.percentile(lum, 98.5)) if lum.size else 1.0
    x = rgb / scale
    # épaule douce au-delà de 0,8 pour ne pas couper net les points chauds
    x = np.where(x > 0.8, 0.8 + 0.2 * np.tanh((x - 0.8) / 0.2), x)
    srgb = np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055)
    img = Image.fromarray(np.clip(np.round(srgb * 255), 0, 255).astype(np.uint8)[::-1], 'RGB')
    img.save(os.path.join(dst, a['file']), 'WEBP', quality=90, method=6)
    a['scale'] = scale
    print(f"{a['file']} : échelle {scale:.3f}, {os.path.getsize(os.path.join(dst, a['file'])) / 1024:.0f} Ko")
# compactage : indices et sommets d'origine en 16 bits quand c'est possible, UV en 16 bits normalisés
raw = open(os.path.join(src, 'bake.bin'), 'rb').read()
out, off = [], 0


def put(a):
    global off
    b = a.tobytes()
    o = off
    out.append(b)
    off += len(b)
    pad = (-off) % 4
    if pad:
        out.append(b'\0' * pad)
        off += pad
    return o


for key, e in meta['meshes'].items():
    srcv = np.frombuffer(raw, np.uint32, e['nv'], e['src'])
    idx = np.frombuffer(raw, np.uint32, e['ni'], e['idx'])
    uv = np.frombuffer(raw, np.float32, e['nv'] * 2, e['uv'])
    e['s16'] = int(srcv.max(initial=0) < 65536)
    e['i16'] = int(e['nv'] < 65536)
    e['src'] = put(srcv.astype(np.uint16 if e['s16'] else np.uint32))
    e['idx'] = put(idx.astype(np.uint16 if e['i16'] else np.uint32))
    e['uv'] = put(np.round(np.clip(uv, 0, 1) * 65535).astype(np.uint16))
with open(os.path.join(dst, 'bake.bin'), 'wb') as f:
    for b in out:
        f.write(b)
json.dump(meta, open(os.path.join(dst, 'bake.json'), 'w'), separators=(',', ':'))
print('bake.bin', os.path.getsize(os.path.join(dst, 'bake.bin')) / 1e6, 'Mo')
