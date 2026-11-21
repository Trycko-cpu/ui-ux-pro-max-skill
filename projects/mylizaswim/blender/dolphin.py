"""Dauphin de verre MyLizaSwim, modélisé dans Blender (bpy, sans interface).

Tout est construit dans le repère three.js : x = longueur (queue -0.5 -> rostre +0.5),
y = haut, z = largeur. Le corps et les nageoires sont fusionnés en une seule peau
(remaillage voxel), lissée puis décimée, et exportée dans un binaire compact :
  'MLSD' | u32 nVert | u32 nIdx | f32 scale | i16 pos[3n] | i8 nrm[4n] | u16 idx[nIdx]
"""
import bpy, bmesh, math, struct, sys, os
from mathutils import Vector, Matrix, Euler

OUT = sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else 'dolphin.bin'
PREVIEW = sys.argv[sys.argv.index('--') + 2] if '--' in sys.argv and len(sys.argv) > sys.argv.index('--') + 2 else None

bpy.ops.wm.read_factory_settings(use_empty=True)

# ------------------------------------------------------------------ corps
# t (queue -> rostre), demi-largeur, dos, ventre, décalage vertical
K = [
    (0.0, 0.012, 0.022, 0.022, 0.0),
    (0.06, 0.022, 0.05, 0.044, 0.0),
    (0.18, 0.042, 0.078, 0.068, 0.0),
    (0.32, 0.08, 0.112, 0.098, 0.0),
    (0.47, 0.114, 0.134, 0.122, 0.0),
    (0.6, 0.124, 0.14, 0.128, 0.0),
    (0.72, 0.116, 0.13, 0.116, 0.0),
    (0.8, 0.1, 0.118, 0.094, 0.006),
    (0.855, 0.082, 0.098, 0.074, 0.01),
    (0.885, 0.066, 0.07, 0.066, -0.004),   # melon qui tombe vers le rostre
    (0.905, 0.046, 0.04, 0.05, -0.016),    # pli melon / rostre
    (0.94, 0.036, 0.028, 0.038, -0.024),
    (0.975, 0.026, 0.018, 0.026, -0.03),
    (1.0, 0.004, 0.004, 0.004, -0.034),
]


def interp(t, c):
    i = 0
    while i < len(K) - 2 and t > K[i + 1][0]:
        i += 1
    p0, p1, p2, p3 = K[max(i - 1, 0)], K[i], K[i + 1], K[min(i + 2, len(K) - 1)]
    t1, t2 = p1[0], p2[0]
    u = (t - t1) / (t2 - t1)
    m1 = (p2[c] - p0[c]) / max(p2[0] - p0[0], 1e-4) * (t2 - t1)
    m2 = (p3[c] - p1[c]) / max(p3[0] - p1[0], 1e-4) * (t2 - t1)
    u2, u3 = u * u, u * u * u
    return (2 * u3 - 3 * u2 + 1) * p1[c] + (u3 - 2 * u2 + u) * m1 + (-2 * u3 + 3 * u2) * p2[c] + (u3 - u2) * m2


def body_mesh():
    NS, NR = 160, 64
    bm = bmesh.new()
    rings = []
    for i in range(NS + 1):
        t = i / NS
        w = max(interp(t, 1), 0.001)
        top = max(interp(t, 2), 0.001)
        bot = max(interp(t, 3), 0.001)
        yc = interp(t, 4)
        ring = []
        for j in range(NR):
            a = j / NR * math.tau
            s, c = math.sin(a), math.cos(a)
            e = 2.3
            sy = math.copysign(abs(s) ** (2 / e), s)
            cz = math.copysign(abs(c) ** (2 / e), c)
            ring.append(bm.verts.new((t - 0.5, yc + (top if sy > 0 else bot) * sy, w * cz)))
        rings.append(ring)
    for i in range(NS):
        for j in range(NR):
            a, b = rings[i][j], rings[i][(j + 1) % NR]
            c, d = rings[i + 1][j], rings[i + 1][(j + 1) % NR]
            bm.faces.new((a, b, d, c))
    bm.faces.new(list(reversed(rings[0])))
    bm.faces.new(rings[-1])
    return bm


# ------------------------------------------------------------------ nageoires
def bezier(p0, p1, p2, p3, n=24):
    pts = []
    for k in range(n):
        u = k / n
        a = (1 - u) ** 3; b = 3 * u * (1 - u) ** 2; c = 3 * u * u * (1 - u); d = u ** 3
        pts.append((a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]))
    return pts


def fin_mesh(outline, thick, span_of, matrix):
    """Contour 2D (x = corde, y = envergure) -> nageoire pleine, plus fine vers la pointe et le bord de fuite."""
    bm = bmesh.new()
    xs = [p[0] for p in outline]
    x0, x1 = min(xs), max(xs)
    top, bot = [], []
    for (x, y) in outline:
        sf = min(max(span_of(x, y), 0.0), 1.0)
        chord = (x - x0) / max(x1 - x0, 1e-6)        # 0 = bord de fuite (arrière), 1 = bord d'attaque
        h = thick * (1.0 - 0.65 * sf) * (0.55 + 0.45 * math.sin(min(chord, 1.0) * math.pi * 0.5 + 0.35))
        top.append(bm.verts.new((x, y, h / 2)))
        bot.append(bm.verts.new((x, y, -h / 2)))
    f1 = bm.faces.new(top)
    f2 = bm.faces.new(list(reversed(bot)))
    n = len(outline)
    for k in range(n):
        bm.faces.new((top[k], bot[k], bot[(k + 1) % n], top[(k + 1) % n]))
    bmesh.ops.triangulate(bm, faces=[f1, f2])
    bmesh.ops.transform(bm, matrix=matrix, verts=bm.verts)
    return bm


def M(x, y, z, rx=0.0, ry=0.0, rz=0.0):
    return Matrix.Translation((x, y, z)) @ Euler((rx, ry, rz), 'XYZ').to_matrix().to_4x4()


def to_object(bm, name):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    return ob


parts = [to_object(body_mesh(), 'body')]

# aileron dorsal falciforme (racine bien plantée dans le dos)
ds = []
ds += bezier((0.10, -0.03), (0.06, 0.05), (-0.03, 0.15), (-0.13, 0.205))
ds += bezier((-0.13, 0.205), (-0.095, 0.13), (-0.085, 0.06), (-0.12, -0.03))
parts.append(to_object(fin_mesh(ds, 0.026, lambda x, y: y / 0.205, M(0.06, 0.13, 0)), 'dorsal'))

# pectorales
ps = []
ps += bezier((0.055, 0.02), (0.025, -0.04), (-0.06, -0.095), (-0.14, -0.115))
ps += bezier((-0.14, -0.115), (-0.085, -0.05), (-0.055, -0.01), (-0.045, 0.02))
for s in (-1, 1):
    parts.append(to_object(fin_mesh(ps, 0.022, lambda x, y: -y / 0.115, M(0.2, -0.07, 0.095 * s, -0.75 * s, 0.35 * s, 0.1)), f'pect{s}'))

# caudale en croissant (horizontale), racine noyée dans le pédoncule
fs = []
fs += bezier((0.045, 0.0), (0.02, 0.07), (-0.05, 0.165), (-0.135, 0.225))
fs += bezier((-0.135, 0.225), (-0.11, 0.13), (-0.08, 0.05), (-0.055, 0.012))
fs += bezier((-0.055, 0.012), (-0.048, 0.004), (-0.048, -0.004), (-0.055, -0.012))
fs += bezier((-0.055, -0.012), (-0.08, -0.05), (-0.11, -0.13), (-0.135, -0.225))
fs += bezier((-0.135, -0.225), (-0.05, -0.165), (0.02, -0.07), (0.045, 0.0))
parts.append(to_object(fin_mesh(fs, 0.022, lambda x, y: abs(y) / 0.225, M(-0.47, 0.0, 0, math.pi / 2, 0, 0)), 'flukes'))

# ------------------------------------------------------------------ fusion en une seule peau
bpy.ops.object.select_all(action='DESELECT')
for p in parts:
    p.select_set(True)
bpy.context.view_layer.objects.active = parts[0]
bpy.ops.object.join()
ob = bpy.context.view_layer.objects.active
ob.name = 'dolphin'

rm = ob.modifiers.new('remesh', 'REMESH')
rm.mode = 'VOXEL'
rm.voxel_size = 0.0022
rm.adaptivity = 0.0
bpy.ops.object.modifier_apply(modifier='remesh')

sm = ob.modifiers.new('smooth', 'CORRECTIVE_SMOOTH')
sm.factor = 0.5
sm.iterations = 6
sm.use_only_smooth = True
sm.smooth_type = 'LENGTH_WEIGHTED'
bpy.ops.object.modifier_apply(modifier='smooth')

target_tris = 24000
tris_now = sum(len(p.vertices) - 2 for p in ob.data.polygons)
dec = ob.modifiers.new('dec', 'DECIMATE')
dec.ratio = min(1.0, target_tris / tris_now)
bpy.ops.object.modifier_apply(modifier='dec')

bm = bmesh.new()
bm.from_mesh(ob.data)
bmesh.ops.triangulate(bm, faces=bm.faces)
bm.to_mesh(ob.data)
bm.free()
me = ob.data
me.shade_smooth()

# ------------------------------------------------------------------ export binaire
verts = [v.co.copy() for v in me.vertices]
# normales lissées par sommet (pondérées par l'aire des faces)
nrm = [Vector((0, 0, 0)) for _ in verts]
for p in me.polygons:
    for vi in p.vertices:
        nrm[vi] += p.normal * p.area
nrm = [n.normalized() if n.length > 0 else Vector((0, 1, 0)) for n in nrm]
idx = [vi for p in me.polygons for vi in p.vertices]
scale = max(max(abs(c) for c in v) for v in verts) * 1.001
with open(OUT, 'wb') as f:
    f.write(b'MLSD')
    f.write(struct.pack('<IIf', len(verts), len(idx), scale))
    f.write(struct.pack(f'<{len(verts) * 3}h', *[int(round(c / scale * 32767)) for v in verts for c in v]))
    f.write(struct.pack(f'<{len(verts) * 4}b', *[x for n in nrm for x in (int(round(n.x * 127)), int(round(n.y * 127)), int(round(n.z * 127)), 0)]))
    f.write(struct.pack(f'<{len(idx)}H', *idx))
bb = [Vector((min(v[k] for v in verts), max(v[k] for v in verts))) for k in range(3)]
print(f'dolphin: {len(verts)} sommets, {len(idx) // 3} triangles, {os.path.getsize(OUT) / 1024:.0f} Ko, bornes x{tuple(round(c, 3) for c in bb[0])} y{tuple(round(c, 3) for c in bb[1])} z{tuple(round(c, 3) for c in bb[2])}')

# ------------------------------------------------------------------ aperçu (Cycles, CPU)
if PREVIEW:
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = 24
    sc.render.resolution_x, sc.render.resolution_y = 900, 520
    ob.rotation_euler = (math.pi / 2, 0, 0)  # repère three (y haut) -> Blender (z haut)
    mat = bpy.data.materials.new('clay')
    mat.diffuse_color = (0.75, 0.78, 0.9, 1)
    me.materials.append(mat)
    world = bpy.data.worlds.new('w'); sc.world = world
    world.color = (0.25, 0.27, 0.35)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    sc.collection.objects.link(cam); sc.camera = cam
    cam.data.lens = 50
    cam.location = (0.55, -1.55, 0.42)
    direction = Vector((0.0, 0.0, 0.02)) - cam.location
    cam.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    sun.data.energy = 3.5
    sun.rotation_euler = (0.7, 0.2, 0.6)
    sc.collection.objects.link(sun)
    sc.render.filepath = PREVIEW
    bpy.ops.render.render(write_still=True)
    print('aperçu', PREVIEW)
