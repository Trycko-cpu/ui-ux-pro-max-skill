"""Cuisson de la lumière de la scène MyLizaSwim dans Blender (Cycles, CPU, sans interface).

Entrée : scene.json + scene.bin produits par blender/export-scene.cjs.
  python bake.py -- <src> <out> preview <nom>   rendu d'essai depuis une étape (réglage des lumières)
  python bake.py -- <src> <out> bake            cuisson + export (atlas .npy, bake.json, bake.bin)

Unités : un pixel Blender = une radiance three.js. Lumières three (physiques) -> Blender :
  soleil  : force = intensité ; spot/point : puissance = 4π · intensité · d^(2 - decay)
Repère : three (x, y haut, z) -> Blender (x, -z, y).
"""
import bpy, bmesh, json, sys, os, math, time
import numpy as np
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT, MODE = argv[0], argv[1], argv[2]
os.makedirs(OUT, exist_ok=True)
data = json.load(open(os.path.join(SRC, 'scene.json')))
BIN = open(os.path.join(SRC, 'scene.bin'), 'rb').read()

# réglages artistiques (lumière « Blender » par rapport à la scène temps réel)
EMIT_BOOST = 14.0      # LED, spots encastrés, projecteurs : vraies sources lumineuses
PANEL_BOOST = 1.2      # grands écrans (tableau, télé) : lumineux mais pas des projecteurs
LIT_EMIT = 1.0         # émissif des matériaux éclairés (abat-jour, pierre rétroéclairée)
POOL_GAIN = 0.75       # flaques de lumière -> spots
WASH_GAIN = 1.0        # lavages de mur -> spots rasants
SPOT_GAIN = 1.0
SUN_GAIN = 1.0
BULB_W = 2.0

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.engine = 'CYCLES'
sc.cycles.device = 'CPU'
sc.cycles.max_bounces = 6
sc.cycles.diffuse_bounces = 3
sc.cycles.glossy_bounces = 1
sc.cycles.transmission_bounces = 0
sc.cycles.caustics_reflective = False
sc.cycles.caustics_refractive = False
sc.view_settings.view_transform = 'Standard'
sc.view_settings.look = 'None'


def B(v):
    """three -> Blender"""
    return Vector((v[0], -v[2], v[1]))


def arr(off, n, dt):
    return np.frombuffer(BIN, dtype=dt, count=n, offset=off)


# ------------------------------------------------------------------ monde : ciel de crépuscule
world = bpy.data.worlds.new('dusk')
sc.world = world
nt = world.node_tree
nt.nodes.clear()
tc = nt.nodes.new('ShaderNodeTexCoord')
sep = nt.nodes.new('ShaderNodeSeparateXYZ')
ramp = nt.nodes.new('ShaderNodeValToRGB')
bg = nt.nodes.new('ShaderNodeBackground')
outw = nt.nodes.new('ShaderNodeOutputWorld')
nt.links.new(tc.outputs['Generated'], sep.inputs[0])
nt.links.new(sep.outputs['Z'], ramp.inputs[0])
nt.links.new(ramp.outputs[0], bg.inputs[0])
nt.links.new(bg.outputs[0], outw.inputs[0])
el = ramp.color_ramp.elements
el[0].position, el[0].color = 0.0, (0.06, 0.03, 0.02, 1)    # sol (direction vers le bas : Z = 0 en coordonnées générées 0..1)
el[1].position, el[1].color = 1.0, (0.008, 0.012, 0.2, 1)   # zénith
e = el.new(0.5); e.color = (0.87, 0.25, 0.07, 1)           # horizon orangé
e = el.new(0.6); e.color = (0.05, 0.06, 0.48, 1)           # bleu haut
bg.inputs['Strength'].default_value = 1.0
# les coordonnées « Generated » du monde vont de -1 à 1 : on les ramène à 0..1
mr = nt.nodes.new('ShaderNodeMapRange')
mr.inputs['From Min'].default_value = -1.0
nt.links.new(sep.outputs['Z'], mr.inputs['Value'])
nt.links.new(mr.outputs['Result'], ramp.inputs[0])

# ------------------------------------------------------------------ matériaux
def new_mat(name):
    mat = bpy.data.materials.new(name)
    if mat.node_tree is None or not mat.node_tree.nodes.get('Principled BSDF'):
        mat.use_nodes = True
    return mat


def principled(name, m):
    mat = new_mat(name)
    t = mat.node_tree
    p = t.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = (*[min(c, 1.0) for c in m['color']], 1)
    p.inputs['Roughness'].default_value = m.get('rough', 0.7)
    p.inputs['Metallic'].default_value = m.get('metal', 0.0)
    em = m.get('emit', [0, 0, 0])
    if max(em) > 1e-4:
        s = max(em)
        p.inputs['Emission Color'].default_value = (*[c / s for c in em], 1)
        p.inputs['Emission Strength'].default_value = s * LIT_EMIT
    return mat


def emitter(name, m, boost):
    mat = new_mat(name)
    t = mat.node_tree
    t.nodes.clear()
    o = t.nodes.new('ShaderNodeOutputMaterial')
    es = t.nodes.new('ShaderNodeEmission')
    c = m['color']
    s = max(max(c), 1e-4)
    es.inputs['Color'].default_value = (*[v / s for v in c], 1)
    es.inputs['Strength'].default_value = s * boost
    t.links.new(es.outputs[0], o.inputs['Surface'])
    return mat


# ------------------------------------------------------------------ géométrie
coll = bpy.data.collections.new('scene')
sc.collection.children.link(coll)
lit = []  # (objet, entrée export)
t0 = time.time()
for k, m in enumerate(data['meshes']):
    n, ni = m['nv'], m['ni']
    P = arr(m['pos'], n * 3, np.float32).reshape(-1, 3)
    I = arr(m['idx'], ni, np.uint32).reshape(-1, 3)
    T = arr(m['tri'], ni // 3, np.uint8)
    bm = bmesh.new()
    vs = [bm.verts.new((p[0], -p[2], p[1])) for p in P]
    bm.verts.ensure_lookup_table()
    ltri = bm.faces.layers.int.new('tri')
    lcor = bm.loops.layers.int.new('corner')
    for t, (a, b, c) in enumerate(I):
        if a == b or b == c or a == c:
            continue
        try:
            f = bm.faces.new((vs[a], vs[b], vs[c]))
        except ValueError:
            continue
        f[ltri] = t
        f.material_index = int(T[t])
        for ci, l in enumerate(f.loops):
            l[lcor] = ci
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    me = bpy.data.meshes.new(m['key'])
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(m['key'][:60], me)
    coll.objects.link(ob)
    if m['kind'] == 'lit':
        for gi, mi in enumerate(m['mats']):
            me.materials.append(principled(f'm{k}_{gi}', mi))
        me.uv_layers.new(name='lm')
        lit.append((ob, m))
    else:
        d0, d1, d2 = sorted((P.max(0) - P.min(0)).tolist())
        boost = EMIT_BOOST if (d2 < 0.3 or d1 < 0.15) else PANEL_BOOST
        me.materials.append(emitter(f'e{k}', m['mats'][0], boost))
        ob.visible_shadow = False
print(f'géométrie : {len(data["meshes"])} objets en {time.time() - t0:.0f} s')


# ------------------------------------------------------------------ lumières
def add_light(kind, name, pos, color, power, target=None, size=None, blend=None, radius=0.05):
    ld = bpy.data.lights.new(name, kind)
    ld.color = tuple(min(c, 1.0) for c in color)
    ld.energy = power
    if kind in ('SPOT', 'POINT'):
        ld.shadow_soft_size = radius
    if kind == 'SPOT':
        ld.spot_size = min(size, math.radians(179))
        ld.spot_blend = blend
        ld.show_cone = False
    ob = bpy.data.objects.new(name, ld)
    ob.location = pos
    if target is not None:
        d = (target - pos).normalized()
        ob.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    coll.objects.link(ob)
    return ob


def norm_color(c):
    s = max(max(c), 1e-6)
    return [v / s for v in c], s


for i, L in enumerate(data['lights']):
    col, s = norm_color(L['color']) if 'color' in L else ([1, 1, 1], 1)
    if L['type'] == 'sun':
        ld = bpy.data.lights.new('sun', 'SUN')
        ld.color = col
        ld.energy = L['intensity'] * s * SUN_GAIN
        ld.angle = math.radians(1.5)
        ob = bpy.data.objects.new('sun', ld)
        d = (B(L['target']) - B(L['pos'])).normalized()
        ob.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
        coll.objects.link(ob)
    elif L['type'] == 'spot':
        p, tg = B(L['pos']), B(L['target'])
        d = (tg - p).length
        power = 4 * math.pi * L['intensity'] * s * d ** (2 - L['decay']) * SPOT_GAIN
        add_light('SPOT', f'spot{i}', p, col, power, tg, 2 * L['angle'], L['penumbra'], 0.06)
    elif L['type'] == 'point':
        power = 4 * math.pi * L['intensity'] * s * 2.0 ** (2 - L['decay'])
        add_light('POINT', f'point{i}', B(L['pos']), col, power, radius=0.12)

# fausses lumières -> vraies lumières
deps = bpy.context.evaluated_depsgraph_get()
for i, F in enumerate(data['fakes']):
    M = np.array(F['m']).reshape(4, 4).T  # matrice colonne -> ligne
    loc = lambda x, y, z: B((M @ np.array([x, y, z, 1.0]))[:3])
    col, s = norm_color(F['color'] or [1, 1, 1])
    if F['type'] == 'pool':
        c = loc(0, 0, 0)
        hit, hp, *_ = sc.ray_cast(deps, c + Vector((0, 0, 0.05)), Vector((0, 0, 1)), distance=6)
        H = (hp.z - c.z - 0.04) if hit else 3.0
        if H < 1.5:   # sous une table : la lumière vient d'au-dessus du meuble
            H = 2.4
        H = min(H, 3.6)
        r = max(F['w'], F['h']) / 2
        E = math.pi * 0.9 * F['opacity'] / 0.3 * POOL_GAIN
        add_light('SPOT', f'pool{i}', c + Vector((0, 0, H)), col, 4 * math.pi * E * H * H * s, c, 2 * math.atan(r / H) * 1.15, 0.9, 0.08)
    elif F['type'] == 'wash':
        w, h = F['w'], F['h']
        p = loc(0, h / 2, 0.35)
        tg = loc(0, -h / 2, -0.05)
        # éclairement visé au tiers de la hauteur du lavage (incidence rasante : E = I·0,35 / r³)
        E = math.pi * 0.95 * F['opacity'] / 0.3 * WASH_GAIN
        r = math.hypot(0.35, h / 3)
        I = E * r ** 3 / 0.35
        add_light('SPOT', f'wash{i}', p, col, 4 * math.pi * I * s, tg, 2 * math.atan((w / 2) / h) * 1.25, 0.85, 0.05)
for i, b in enumerate(data['bulbs']):
    col, s = norm_color(b['color'])
    add_light('POINT', f'bulb{i}', B(b['pos']), col, BULB_W, radius=0.04)

print(f'lumières : {sum(1 for o in coll.objects if o.type == "LIGHT")}')


# ------------------------------------------------------------------ zones (un atlas par zone)
def zone_of(ob):
    cy = sum((ob.matrix_world @ Vector(c)).y for c in ob.bound_box) / 8  # = -z three
    z = -cy
    if z > 3.5:
        return 'salon'
    if z < -20.0:
        return 'terrasse'
    return 'hall'


if MODE == 'preview':
    name = argv[3]
    cams = {
        # nom : (position three, cible three, focale verticale en degrés)
        'accueil': ((1.6, 1.9, 13.3), (-0.4, 1.2, 3.0), 50),
        'methode': ((0, 1.75, 2.3), (0, 1.15, -14), 50),
        'coach': ((1.2, 2.5, -3.2), (5.0, 1.6, -7.7), 50),
        'tarifs': ((2.4, 2.0, -9.2), (5.0, 0.55, -12.3), 50),
        'avis': ((-1.2, 1.9, -14.0), (-4.7, 1.85, -19.9), 50),
        'reserver': ((0.7, 1.7, -23.2), (-0.6, 0.7, -31.5), 50),
        'hall': ((-6.0, 5.5, 2.6), (2.0, 0.0, -14.0), 60),
    }
    pos, tgt, fov = cams[name]
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    coll.objects.link(cam)
    sc.camera = cam
    cam.data.sensor_fit = 'VERTICAL'
    cam.data.angle = math.radians(fov)
    cam.location = B(pos)
    cam.rotation_euler = (B(tgt) - B(pos)).normalized().to_track_quat('-Z', 'Y').to_euler()
    sc.render.resolution_x, sc.render.resolution_y = int(argv[4]) if len(argv) > 4 else 960, int(int(argv[4]) * 0.625) if len(argv) > 4 else 600
    sc.cycles.samples = int(argv[5]) if len(argv) > 5 else 48
    sc.cycles.use_denoising = True
    sc.view_settings.exposure = float(argv[6]) if len(argv) > 6 else 0.0
    sc.render.filepath = os.path.join(OUT, f'preview_{name}.png')
    t0 = time.time()
    bpy.ops.render.render(write_still=True)
    print(f'aperçu {name} en {time.time() - t0:.0f} s')
    sys.exit(0)

# ------------------------------------------------------------------ dépliage UV des surfaces éclairées
SAMPLES = int(argv[3]) if len(argv) > 3 else 128
SIZE = int(argv[4]) if len(argv) > 4 else 2048
ONLY = argv[5].split(',') if len(argv) > 5 else None
SIZES = {'hall': SIZE, 'salon': SIZE // 2, 'terrasse': SIZE // 2}  # le hall est vu de près à presque toutes les étapes
zones = {}
for ob, m in lit:
    zones.setdefault(zone_of(ob), []).append((ob, m))
if ONLY:
    zones = {z: v for z, v in zones.items() if z in ONLY}
for z, items in zones.items():
    t0 = time.time()
    bpy.ops.object.select_all(action='DESELECT')
    for ob, _ in items:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = items[0][0]
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.0, area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
    bpy.ops.uv.select_all(action='SELECT')
    bpy.ops.uv.average_islands_scale()
    bpy.ops.uv.pack_islands(rotate=True, margin_method='FRACTION', margin=0.004, shape_method='AABB')
    bpy.ops.object.mode_set(mode='OBJECT')
    area = sum(sum(p.area for p in ob.data.polygons) for ob, _ in items)
    print(f'UV {z} : {len(items)} objets, {area:.0f} m², {time.time() - t0:.0f} s')

# ------------------------------------------------------------------ débruitage (Intel Open Image Denoise, livré avec Blender)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from oidn import denoise as oidn


# ------------------------------------------------------------------ cuisson
sc.cycles.samples = SAMPLES
sc.render.bake.margin = 8
sc.render.bake.margin_type = 'EXTEND'
sc.render.bake.use_clear = True
meta = {'atlases': [], 'meshes': {}, 'exposure': 1.0}
chunks, offset = [], 0


def push(a):
    global offset
    b = a.tobytes()
    o = offset
    chunks.append(b)
    offset += len(b)
    pad = (-offset) % 4
    if pad:
        chunks.append(b'\0' * pad)
        offset += pad
    return o


for ai, (z, items) in enumerate(zones.items()):
    S = SIZES[z]
    img = bpy.data.images.new(f'lm_{z}', S, S, float_buffer=True, alpha=True)
    for ob, _ in items:
        for mat in ob.data.materials:
            t = mat.node_tree
            n = t.nodes.new('ShaderNodeTexImage')
            n.image = img
            t.nodes.active = n
    bpy.ops.object.select_all(action='DESELECT')
    for ob, _ in items:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = items[0][0]
    t0 = time.time()
    bpy.ops.object.bake(type='DIFFUSE', pass_filter={'DIRECT', 'INDIRECT'}, uv_layer='lm', margin=8, use_clear=True)
    px = np.array(img.pixels[:], dtype=np.float32).reshape(S, S, 4)
    np.save(os.path.join(OUT, f'lm_{z}_raw.npy'), px)
    px[..., :3] = oidn(px[..., :3])
    np.save(os.path.join(OUT, f'lm_{z}.npy'), px)
    print(f'cuisson {z} : {S}² en {time.time() - t0:.0f} s')
    meta['atlases'].append({'zone': z, 'file': f'lm_{z}.webp', 'size': S})
    # UV de lumière par triangle d'origine -> sommets dédoublés aux coutures
    for ob, m in items:
        me = ob.data
        nt_ = m['ni'] // 3
        I = arr(m['idx'], m['ni'], np.uint32).reshape(-1, 3)
        uvs = np.zeros((nt_, 3, 2), np.float32)
        nl = len(me.loops)
        luv = np.zeros(nl * 2, np.float32)
        me.uv_layers['lm'].data.foreach_get('uv', luv)
        luv = luv.reshape(-1, 2)
        tri = np.zeros(len(me.polygons), np.int32)
        me.attributes['tri'].data.foreach_get('value', tri)
        cor = np.zeros(nl, np.int32)
        me.attributes['corner'].data.foreach_get('value', cor)
        ls = np.zeros(len(me.polygons), np.int32)
        me.polygons.foreach_get('loop_start', ls)
        for fi in range(len(me.polygons)):
            for k in range(3):
                li = ls[fi] + k
                uvs[tri[fi], cor[li]] = luv[li]
        q = np.round(uvs.reshape(-1, 2) * 65535).astype(np.int64)
        keys = np.stack([I.reshape(-1).astype(np.int64), q[:, 0], q[:, 1]], 1)
        uniq, inv = np.unique(keys, axis=0, return_inverse=True)
        meta['meshes'][m['key']] = {
            'atlas': ai, 'nv': int(len(uniq)), 'ni': int(m['ni']),
            'src': push(uniq[:, 0].astype(np.uint32)),
            'idx': push(inv.reshape(-1).astype(np.uint32)),
            'uv': push((uniq[:, 1:] / 65535.0).astype(np.float32)),
        }

with open(os.path.join(OUT, 'bake.bin'), 'wb') as f:
    for c in chunks:
        f.write(c)
json.dump(meta, open(os.path.join(OUT, 'bake.json'), 'w'))
print('export UV ok', offset / 1e6, 'Mo')
