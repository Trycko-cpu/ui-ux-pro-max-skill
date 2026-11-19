"""Carte de normales de l'eau, tuilable, tirée de la simulation d'océan de Blender.

  python water.py -- <dossier de travail> <fichier png de sortie>

Le modificateur Ocean (spectre de Phillips, FFT) produit un champ de déplacement
périodique : la carte se répète sans couture. On en tire la hauteur, puis les normales
(différences finies périodiques), encodées en RVB (n * 0,5 + 0,5), plan tangent = xy.
"""
import bpy, os, sys, glob
import numpy as np

argv = sys.argv[sys.argv.index('--') + 1:]
WORK, OUT = os.path.abspath(argv[0]), os.path.abspath(argv[1])
os.makedirs(WORK, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.mesh.primitive_plane_add(size=2)
ob = bpy.context.object
oc = ob.modifiers.new('ocean', 'OCEAN')
oc.spectrum = 'PHILLIPS'
oc.resolution = 16           # grille de calcul (bake : 16 x 16 x ... échantillons)
oc.spatial_size = 6          # un motif couvre 6 m : petites vagues de bassin intérieur
oc.wave_scale = 0.6
oc.wind_velocity = 4.5
oc.wave_alignment = 0.35
oc.wave_direction = 0.6
oc.choppiness = 0.8
oc.damping = 0.5
oc.random_seed = 7
oc.filepath = WORK
oc.frame_start = 1
oc.frame_end = 1
bpy.ops.object.ocean_bake(modifier='ocean', free=False)

import time
for _ in range(600):  # la cuisson de l'océan tourne en tâche de fond : on attend le fichier
    found = sorted(glob.glob(os.path.join(WORK, 'disp_*.exr')))
    if found and os.path.getsize(found[0]) > 0:
        break
    time.sleep(0.1)
time.sleep(0.5)
exr = found[0]
img = bpy.data.images.load(exr)
w, h = img.size
px = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)
height = px[..., 2]  # déplacement vertical
size_m = oc.spatial_size
# pente (périodique) -> normale
dx = (np.roll(height, -1, 1) - np.roll(height, 1, 1)) / (2 * size_m / w)
dy = (np.roll(height, -1, 0) - np.roll(height, 1, 0)) / (2 * size_m / h)
n = np.stack([-dx, -dy, np.ones_like(dx)], -1)
n /= np.linalg.norm(n, axis=-1, keepdims=True)
rgb = np.clip(n * 0.5 + 0.5, 0, 1)
print(f'océan {w}x{h}, hauteur {height.min():.3f}..{height.max():.3f} m, pente max {np.abs(dx).max():.2f}')

out = bpy.data.images.new('water_n', w, h, alpha=False)
out.colorspace_settings.name = 'Non-Color'
flat = np.concatenate([rgb, np.ones((h, w, 1), np.float32)], -1).reshape(-1)
out.pixels.foreach_set(flat)
out.filepath_raw = OUT
out.file_format = 'PNG'
out.save()
print('écrit', OUT, os.path.getsize(OUT) // 1024, 'Ko')
